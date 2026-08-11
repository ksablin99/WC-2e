'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const CLASS_PACK = 'warcraftrpg2e.classes';
const FIGHTER_ID = 'sgwZt7dg1ZHXQlrW';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
  await page.evaluate(async () => {
    localStorage.removeItem('D35E-portraitbar-y-location');
    localStorage.removeItem('D35E-portraitbar-x-location');
    await game.settings.set('warcraftrpg2e', 'showPartyHud', 'none');
  });
});

test('party HUD stays hidden when disabled even with party members', async ({ page }) => {
  await page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({
      name: 'Hidden Party HUD Actor',
      type: 'character',
      img: 'icons/svg/mystery-man.svg',
      system: {
        isPartyMember: true,
        abilities: {
          str: { value: 10 }, dex: { value: 10 }, con: { value: 10 },
          int: { value: 10 }, wis: { value: 10 }, cha: { value: 10 },
        },
      },
    });

    const classItem = await game.packs.get(packId).getDocument(classId);
    const classData = classItem.toObject();
    classData.system.levels = 1;
    classData.system.hp = classData.system.hd;
    await actor.createEmbeddedDocuments('Item', [classData]);

    await game.settings.set('warcraftrpg2e', 'showPartyHud', 'none');
  }, { packId: CLASS_PACK, classId: FIGHTER_ID });

  await expect(page.locator('#portrait-bar')).toBeHidden();
  await expect(page.locator('[id^="actor-portrait-"]')).toHaveCount(0);
});

test('party HUD renders party members and follows display mode setting', async ({ page }) => {
  const fixture = await page.evaluate(async ({ packId, classId }) => {
    async function createCharacter(name, isPartyMember) {
      const actor = await Actor.create({
        name,
        type: 'character',
        img: 'icons/svg/mystery-man.svg',
        system: {
          isPartyMember,
          abilities: {
            str: { value: 10 }, dex: { value: 10 }, con: { value: 10 },
            int: { value: 10 }, wis: { value: 10 }, cha: { value: 10 },
          },
        },
      });
      const classItem = await game.packs.get(packId).getDocument(classId);
      const classData = classItem.toObject();
      classData.system.levels = 1;
      classData.system.hp = classData.system.hd;
      await actor.createEmbeddedDocuments('Item', [classData]);
      const updated = game.actors.get(actor.id);
      await updated.update({});
      const prepared = game.actors.get(actor.id);
      await prepared.update({ 'system.attributes.hp.value': prepared.system.attributes.hp.max });
      return game.actors.get(actor.id);
    }

    const partyActor = await createCharacter('Party HUD Actor', true);
    const nonPartyActor = await createCharacter('Non Party HUD Actor', false);

    await game.settings.set('warcraftrpg2e', 'showPartyHud', 'full');
    return {
      partyActorId: partyActor.id,
      nonPartyActorId: nonPartyActor.id,
      hp: {
        value: game.actors.get(partyActor.id).system.attributes.hp.value,
        max: game.actors.get(partyActor.id).system.attributes.hp.max,
      },
    };
  }, { packId: CLASS_PACK, classId: FIGHTER_ID });

  expect(fixture.hp.max).toBeGreaterThan(0);

  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'showPartyHud', 'none');
  });
  await expect(page.locator('#portrait-bar')).toBeHidden();
  await expect(page.locator(`#actor-portrait-${fixture.partyActorId}`)).toBeHidden();

  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'showPartyHud', 'full');
  });

  const bar = page.locator('#portrait-bar');
  const portrait = page.locator(`#actor-portrait-${fixture.partyActorId}`);

  await expect(bar).toBeVisible({ timeout: 10_000 });
  await expect(portrait).toBeVisible();
  await expect(portrait).toHaveClass(/full/);
  await expect(portrait.locator('.life')).toHaveText(`${fixture.hp.value} / ${fixture.hp.max}`);
  await expect(page.locator(`#actor-portrait-${fixture.nonPartyActorId}`)).toHaveCount(0);

  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'showPartyHud', 'none');
  });
  await expect(bar).toBeHidden();
  await expect(page.locator(`#actor-portrait-${fixture.partyActorId}`)).toBeHidden();

  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'showPartyHud', 'narrow');
  });
  await expect(bar).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(`#actor-portrait-${fixture.partyActorId}`)).toHaveClass(/narrow/);
  await expect(page.locator(`#actor-portrait-${fixture.nonPartyActorId}`)).toHaveCount(0);
});
