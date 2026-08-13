'use strict';

/**
 * E2E tests for special-action engine regressions and feat generic
 * requirements — regression coverage for issues #1538 and #1630.
 *
 * Bug: conditions using comparison operators (`>`, `>=`, etc.) were routed
 * through `new Roll35e(condition)`, which crashes because Foundry's Roll
 * grammar does not accept comparison operators. Feat `generic` requirements
 * had the same problem.
 *
 * Fix: both code paths now use `Roll35e.safeEvaluateCondition` which handles
 * the full set of comparison operators (===, !==, >=, <=, >, <).
 *
 * Bug #1538: special actions creating compendium-backed items on Foundry v13
 * failed in two ways:
 *   1. `Create unique ... from <pack>` looked up a compendium index row and
 *      tried `pack.getDocument(entry.id)` even when the index exposed `_id`,
 *      producing `undefined.toObject()`.
 *   2. Legacy `Set ... field data.*` item updates created items but did not
 *      update their system data under v13.
 *
 * Covers:
 *   1. Attack roll with `>` special-action conditions does not crash and
 *      filters actions correctly (passing condition appears in chat specials,
 *      failing condition does not).
 *   2. Produce Flame special action creates and configures its buff and linked
 *      attacks without throwing.
 *   3. Feat generic requirement with `>=` evaluates correctly: unmet when
 *      skill rank is below threshold, met when rank is at or above threshold.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

// ── Lifecycle ─────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── 1. Attack roll does not crash with > special-action conditions ────────────

test('attack roll with > special-action conditions does not crash and filters correctly', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const msgsBefore = await page.evaluate(() => game.messages.size);

  // Create a bard actor at level 5, then add a Bardic Music attack item
  // with specialActions whose conditions use > to test the operator fix.
  // We use @classes.bard.level to avoid depending on subSkill initialization.
  const result = await page.evaluate(async () => {
    // 1. Create a bard character
    const actor = await Actor.create({
      name: 'Bardic Music E2E Actor',
      type: 'character',
      system: {
        abilities: {
          str: { value: 10 },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 10 },
          wis: { value: 10 },
          cha: { value: 16 },
        },
      },
    });

    // 2. Add Bard class at level 5 from the compendium.
    const classPack = game.packs.get('warcraftrpg2e.classes');
    const bardClass = await classPack.getDocument('WRPq41FTQocsxxBU');
    const classData = bardClass.toObject();
    classData.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [classData]);

    // 3. Create an attack item with specialActions using > conditions.
    //    Using @classes.bard.level which is reliably populated after adding the class.
    const [bardicMusic] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Bardic Music',
      type: 'attack',
      system: {
        actionType: 'special',
        specialActions: [
          {
            name: 'Inspire Courage',
            // bard level 5 > 1 → true → should appear in specials
            condition: '@classes.bard.level > 1',
            action: 'Create unique "Inspire Courage" from warcraftrpg2e.commonbuffs on target;',
            img: '',
          },
          {
            name: 'Inspire Greatness',
            // bard level 5 > 9 → false → should NOT appear in specials
            condition: '@classes.bard.level > 9',
            action: 'Create unique "Inspire Greatness" from warcraftrpg2e.commonbuffs on target;',
            img: '',
          },
        ],
      },
    }]);

    return { actorId: actor.id, attackId: bardicMusic.id };
  });

  // 4. Use the Bardic Music item — this must not throw.
  let useError = null;
  try {
    await page.evaluate(async ({ actorId, attackId }) => {
      const actor = game.actors.get(actorId);
      const attack = actor.items.get(attackId);
      await attack.use({ skipDialog: true });
    }, result);
  } catch (err) {
    useError = err.message;
  }

  expect(useError, 'attack.use() should not throw').toBeNull();

  // 5. A chat message should have been posted.
  await page.waitForFunction(
    (before) => game.messages.size > before,
    msgsBefore,
    { timeout: 10_000 }
  );

  // 6. Inspect the last chat message for special actions.
  //    flags.warcraftrpg2e.chatTemplateData.attacks is an array of serialized ChatAttack
  //    objects; each has a .special array with { label, ... } entries.
  const chatPayload = await page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    const attacks = msg?.flags?.warcraftrpg2e?.chatTemplateData?.attacks ?? [];
    const specials = attacks.flatMap(a => (a.special ?? []).map(s => s.label));
    return { specials };
  });

  expect(chatPayload.specials, 'Inspire Courage (bard level 5 > 1 = true) should be present')
    .toContain('Inspire Courage');
  expect(chatPayload.specials, 'Inspire Greatness (bard level 5 not > 9 = false) should be absent')
    .not.toContain('Inspire Greatness');

  // 7. No SyntaxError / roll condition errors in console.
  const badErrors = consoleErrors.filter(e =>
    e.includes('SyntaxError') ||
    (e.includes('Roll') && e.includes('condition')) ||
    e.includes('Unexpected token')
  );
  expect(badErrors, 'no roll/condition SyntaxErrors').toHaveLength(0);
});

// ── 2. Feat generic requirement with >= evaluates correctly ───────────────────

test('produce flame special action creates buff and attacks without throwing', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Produce Flame E2E Actor',
      type: 'character',
      system: {
        abilities: {
          str: { value: 10 },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 10 },
          wis: { value: 16 },
          cha: { value: 10 },
        },
      },
    });

    const action =
      'Create unique "Produce Flame" from "warcraftrpg2e.commonbuffs" on self; ' +
      'Set buff "Produce Flame" field data.level to max(1,5) on self; ' +
      'Activate buff "Produce Flame" on self;' +
      'Create unique "Produce Flame (Melee)" from "warcraftrpg2e.spell-items" on self; ' +
      'Set attack "Produce Flame (Melee)" field data.uses.maxFormula to 5 on self; ' +
      'Set attack "Produce Flame (Melee)" field data.uses.value to +5 on self; ' +
      'Set attack "Produce Flame (Melee)" field data.baseCl to 5 on self; ' +
      'Create unique "Produce Flame (Ranged)" from "warcraftrpg2e.spell-items" on self; ' +
      'Set attack "Produce Flame (Ranged)" field data.uses.maxFormula to 5 on self; ' +
      'Set attack "Produce Flame (Ranged)" field data.uses.value to +5 on self; ' +
      'Set attack "Produce Flame (Ranged)" field data.baseCl to 5 on self;';

    let error = null;
    try {
      await actor.autoApplyActionsOnSelf(action);
    } catch (err) {
      error = {
        message: err?.message ?? String(err),
        stack: err?.stack ?? null,
      };
    }

    const ownedItems = actor.items.map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      active: item.system?.active ?? null,
      level: item.system?.level ?? null,
      usesValue: item.system?.uses?.value ?? null,
      usesMaxFormula: item.system?.uses?.maxFormula ?? null,
      baseCl: item.system?.baseCl ?? null,
    }));

    return { error, ownedItems };
  });

  expect(result.error).toBeNull();

  const buff = result.ownedItems.find(item => item.name === 'Produce Flame' && item.type === 'buff');
  const melee = result.ownedItems.find(item => item.name === 'Produce Flame (Melee)' && item.type === 'attack');
  const ranged = result.ownedItems.find(item => item.name === 'Produce Flame (Ranged)' && item.type === 'attack');

  expect(buff).toBeTruthy();
  expect(melee).toBeTruthy();
  expect(ranged).toBeTruthy();
  expect(buff.active).toBe(true);
  expect(buff.level).toBe(5);
  expect(melee.usesMaxFormula).toBe('5');
  expect(melee.usesValue).toBe(5);
  expect(melee.baseCl).toBe('5');
  expect(ranged.usesMaxFormula).toBe('5');
  expect(ranged.usesValue).toBe(5);
  expect(ranged.baseCl).toBe('5');
  expect(consoleErrors).toHaveLength(0);
});

// ── 3. Feat generic requirement with >= evaluates correctly ───────────────────

test('feat generic requirement with >= correctly reports unmet when rank is low', async ({ page }) => {
  const unmet = await page.evaluate(async () => {
    // Create a character, then set Spellcraft points such that computed rank is 2.
    // D35E computes rank from points: for cross-class (cs=false), rank = floor(points/2).
    // So points=4 → rank=2 (below threshold of 5).
    const actor = await Actor.create({
      name: 'Antipsionic Low Rank Actor',
      type: 'character',
      system: {
        abilities: {
          str: { value: 10 }, dex: { value: 10 }, con: { value: 10 },
          int: { value: 10 }, wis: { value: 10 }, cha: { value: 10 },
        },
      },
    });
    // Use points=4 → rank = floor(4/2) = 2 (cross-class, cs=false for fresh character)
    await actor.update({ 'system.skills.spl.points': 4 });

    // Re-fetch the actor after the update so we get fresh system data.
    const freshActor = game.actors.get(actor.id);

    // Add Antipsionic Magic feat inline with a generic >= requirement.
    const [feat] = await freshActor.createEmbeddedDocuments('Item', [{
      name: 'Antipsionic Magic',
      type: 'feat',
      system: {
        requirements: [
          ['Spellcraft 5 ranks', '@skills.spl.rank >= 5', 'generic'],
        ],
      },
    }]);

    // Call with fresh rollData (force=true to bypass cache).
    const rollData = freshActor.getRollData(null, true);
    const unmetReqs = feat.hasUnmetRequirements(rollData);
    return { unmetReqs, splRank: rollData?.skills?.spl?.rank };
  });

  expect(Array.isArray(unmet.unmetReqs), 'hasUnmetRequirements returns an array').toBe(true);
  expect(unmet.unmetReqs.length, `requirement should be unmet when rank is ${unmet.splRank} < 5`).toBeGreaterThan(0);
  expect(unmet.unmetReqs[0]).toBe('Spellcraft 5 ranks');
});

test('feat generic requirement with >= is met when rank equals threshold', async ({ page }) => {
  const unmet = await page.evaluate(async () => {
    // Create a character, then set Spellcraft points such that computed rank is 5.
    // D35E computes rank from points: for cross-class (cs=false), rank = floor(points/2).
    // So points=10 → rank = floor(10/2) = 5 (meets the >= 5 threshold).
    const actor = await Actor.create({
      name: 'Antipsionic Met Rank Actor',
      type: 'character',
      system: {
        abilities: {
          str: { value: 10 }, dex: { value: 10 }, con: { value: 10 },
          int: { value: 10 }, wis: { value: 10 }, cha: { value: 10 },
        },
      },
    });
    // Use points=10 → rank = floor(10/2) = 5 (cross-class, cs=false)
    await actor.update({ 'system.skills.spl.points': 10 });

    // Re-fetch the actor after the update so we get fresh system data.
    const freshActor = game.actors.get(actor.id);

    const [feat] = await freshActor.createEmbeddedDocuments('Item', [{
      name: 'Antipsionic Magic',
      type: 'feat',
      system: {
        requirements: [
          ['Spellcraft 5 ranks', '@skills.spl.rank >= 5', 'generic'],
        ],
      },
    }]);

    // Call with fresh rollData (force=true to bypass cache).
    const rollData = freshActor.getRollData(null, true);
    const unmetReqs = feat.hasUnmetRequirements(rollData);
    return { unmetReqs, splRank: rollData?.skills?.spl?.rank };
  });

  expect(Array.isArray(unmet.unmetReqs), 'hasUnmetRequirements returns an array').toBe(true);
  expect(unmet.unmetReqs.length, `requirement should be met when rank is ${unmet.splRank} (>= 5)`).toBe(0);
});
