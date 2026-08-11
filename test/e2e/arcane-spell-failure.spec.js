'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

async function createActorWithAsfSpell(page, actorName, asfChance = 35, { hasAction = true } = {}) {
  return page.evaluate(async ({ actorName, asfChance, hasAction }) => {
    const actor = await Actor.create({
      name: actorName,
      type: 'character',
      system: {
        abilities: {
          str: { value: 10 },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 16 },
          wis: { value: 10 },
          cha: { value: 10 },
        },
      },
    });

    const [armor] = await actor.createEmbeddedDocuments('Item', [
      {
        name: 'ASF Test Armor',
        type: 'equipment',
      },
    ]);
    await armor.update({
      'system.equipped': true,
      'system.spellFailure': asfChance,
    });

    const spellSystem = {
      spellbook: 'primary',
      preparation: { mode: 'atwill' },
      level: 1,
      sr: false,
      pr: false,
      description: {
        value: hasAction ? 'ASF action spell description' : 'ASF no-action spell description',
      },
    };

    if (hasAction) {
      spellSystem.actionType = 'rsak';
      spellSystem.ability = {
        attack: 'int',
        damage: '',
        damageMult: 1,
        critRange: 20,
        critMult: 2,
      };
      spellSystem.damage = {
        parts: [['1d4', 'force', 'energy-force']],
      };
      spellSystem.save = { type: 'will', description: 'Will negates', dc: '10' };
    }

    await actor.createEmbeddedDocuments('Item', [
      {
        name: 'ASF Test Spell',
        type: 'spell',
        system: spellSystem,
      },
    ]);

    const createdSpell = actor.items.find((i) => i.type === 'spell' && i.name === 'ASF Test Spell');
    const armorSpellFailure = actor.items
      .filter((i) => i.type === 'equipment')
      .map((i) => ({ equipped: i.system.equipped, spellFailure: i.system.spellFailure }));
    return {
      actorId: actor.id,
      spellId: createdSpell?.id,
      actorSpellFailure: actor.spellFailure,
      spellHasAction: createdSpell?.hasAction,
      armorSpellFailure,
    };
  }, { actorName, asfChance, hasAction });
}

async function castSpellAndWaitForNewMessages(page, actorId, spellId, expectedNewMessageCount) {
  const messagesBefore = await page.evaluate(() => game.messages.size);
  await page.evaluate(async ({ actorId, spellId }) => {
    const actor = game.actors.get(actorId);
    const spell = actor.items.get(spellId);
    await spell.use({ skipDialog: true });
  }, { actorId, spellId });

  await page.waitForFunction(
    ({ before, count }) => game.messages.size >= before + count,
    { before: messagesBefore, count: expectedNewMessageCount },
    { timeout: 10_000 },
  );

  return page.evaluate((before) => {
    return game.messages.contents
      .slice(before)
      .map((m) => m.content ?? '');
  }, messagesBefore);
}

function countMatches(text, pattern) {
  return (text.match(pattern) ?? []).length;
}

function expectSingleAsfBlock(allHtml, message) {
  expect(countMatches(allHtml, /<div class="spell-failure spell-failure-boxed">/g), message).toBe(1);
  expect(countMatches(allHtml, /Arcane Spell Failure/g), `${message}: heading should not duplicate`).toBe(1);
}

test('rolls and displays arcane spell failure when hide spell descriptions is enabled', async ({ page }) => {
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'hideSpellDescriptionsIfHasAction', true);
    await game.settings.set('warcraftrpg2e', 'fizzleSpellOnArcaneFailure', false);
  });

  const { actorId, spellId, actorSpellFailure, spellHasAction, armorSpellFailure } = await createActorWithAsfSpell(page, 'ASF Hide Description True');
  expect(spellId, 'test spell should be created').toBeTruthy();
  expect(armorSpellFailure.length, 'test actor should have armor').toBeGreaterThan(0);
  expect(actorSpellFailure, 'actor should have arcane spell failure chance').toBeGreaterThan(0);
  expect(spellHasAction, 'test spell should go through hasAction flow').toBeTruthy();

  const newMessages = await castSpellAndWaitForNewMessages(page, actorId, spellId, 1);
  const allHtml = newMessages.join('\n');

  expect(newMessages, 'hidden-description action spell should render one attack card').toHaveLength(1);
  expect(allHtml, 'chat output should include spell failure block when description is hidden').toContain('spell-failure');
  expect(allHtml, 'chat output should include Arcane Spell Failure heading').toContain('Arcane Spell Failure');
  expectSingleAsfBlock(allHtml, 'a cast should display exactly one ASF block');
});

test('still displays arcane spell failure when hide spell descriptions is disabled', async ({ page }) => {
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'hideSpellDescriptionsIfHasAction', false);
    await game.settings.set('warcraftrpg2e', 'fizzleSpellOnArcaneFailure', false);
  });

  const { actorId, spellId, actorSpellFailure, spellHasAction, armorSpellFailure } = await createActorWithAsfSpell(page, 'ASF Hide Description False');
  expect(spellId, 'test spell should be created').toBeTruthy();
  expect(armorSpellFailure.length, 'test actor should have armor').toBeGreaterThan(0);
  expect(actorSpellFailure, 'actor should have arcane spell failure chance').toBeGreaterThan(0);
  expect(spellHasAction, 'test spell should go through hasAction flow').toBeTruthy();

  const newMessages = await castSpellAndWaitForNewMessages(page, actorId, spellId, 3);
  const allHtml = newMessages.join('\n');

  expect(newMessages, 'visible-description action spell should render spell, ASF, and attack cards').toHaveLength(3);
  expect(allHtml, 'chat output should include spell failure block').toContain('spell-failure');
  expectSingleAsfBlock(allHtml, 'a cast should display exactly one ASF block');
});

test('fizzles spell and posts only ASF card when world setting is enabled', async ({ page }) => {
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'hideSpellDescriptionsIfHasAction', true);
    await game.settings.set('warcraftrpg2e', 'fizzleSpellOnArcaneFailure', true);
  });

  const { actorId, spellId } = await createActorWithAsfSpell(page, 'ASF Fizzle Enabled', 100);
  expect(spellId, 'test spell should be created').toBeTruthy();

  const newMessages = await castSpellAndWaitForNewMessages(page, actorId, spellId, 1);
  const allHtml = newMessages.join('\n');

  expect(newMessages, 'hidden-description fizzled action spell should only render ASF card').toHaveLength(1);
  expectSingleAsfBlock(allHtml, 'fizzled cast should show exactly one ASF block');
  expect(allHtml, 'fizzled cast should not render attack chat content').not.toContain('chat-attack compact');
});

test('fizzled action spell does not duplicate ASF when spell descriptions are visible', async ({ page }) => {
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'hideSpellDescriptionsIfHasAction', false);
    await game.settings.set('warcraftrpg2e', 'fizzleSpellOnArcaneFailure', true);
  });

  const { actorId, spellId } = await createActorWithAsfSpell(page, 'ASF Fizzle Visible Description', 100);
  expect(spellId, 'test spell should be created').toBeTruthy();

  const newMessages = await castSpellAndWaitForNewMessages(page, actorId, spellId, 2);
  const allHtml = newMessages.join('\n');

  expect(newMessages, 'visible-description fizzled action spell should render spell card and ASF card').toHaveLength(2);
  expectSingleAsfBlock(allHtml, 'visible-description fizzled action spell should show exactly one ASF block');
  expect(allHtml, 'fizzled cast should not render attack chat content').not.toContain('chat-attack compact');
});

test('rolls arcane spell failure for spells without action data', async ({ page }) => {
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'hideSpellDescriptionsIfHasAction', false);
    await game.settings.set('warcraftrpg2e', 'fizzleSpellOnArcaneFailure', false);
  });

  const { actorId, spellId, actorSpellFailure, spellHasAction } = await createActorWithAsfSpell(
    page,
    'ASF No Action Spell',
    35,
    { hasAction: false },
  );
  expect(spellId, 'test spell should be created').toBeTruthy();
  expect(actorSpellFailure, 'actor should have arcane spell failure chance').toBeGreaterThan(0);
  expect(spellHasAction, 'test spell should not go through action flow').toBeFalsy();

  const newMessages = await castSpellAndWaitForNewMessages(page, actorId, spellId, 2);
  const allHtml = newMessages.join('\n');

  expect(newMessages, 'plain spell cast should render spell card plus ASF card').toHaveLength(2);
  expect(allHtml, 'plain spell cast should still render spell card').toContain('spell-description');
  expectSingleAsfBlock(allHtml, 'plain spell cast should display exactly one ASF block');
});

test('fizzles spells without action data when world setting is enabled', async ({ page }) => {
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'hideSpellDescriptionsIfHasAction', false);
    await game.settings.set('warcraftrpg2e', 'fizzleSpellOnArcaneFailure', true);
  });

  const { actorId, spellId, spellHasAction } = await createActorWithAsfSpell(
    page,
    'ASF No Action Fizzle',
    100,
    { hasAction: false },
  );
  expect(spellId, 'test spell should be created').toBeTruthy();
  expect(spellHasAction, 'test spell should not go through action flow').toBeFalsy();

  const newMessages = await castSpellAndWaitForNewMessages(page, actorId, spellId, 1);
  const allHtml = newMessages.join('\n');

  expect(newMessages, 'fizzled plain spell should only render ASF card').toHaveLength(1);
  expectSingleAsfBlock(allHtml, 'fizzled plain spell should show exactly one ASF block');
  expect(allHtml, 'fizzled plain spell should not render spell description').not.toContain('spell-description');
});
