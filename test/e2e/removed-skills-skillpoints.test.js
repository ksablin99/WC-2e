'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test('issue #1285: hidden default skill points are not counted as used', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const original = foundry.utils.deepClone(game.settings.get('warcraftrpg2e', 'worldDefaults'));
    const updated = foundry.utils.deepClone(original ?? {});
    updated.worldDefaults = updated.worldDefaults ?? {};
    updated.worldDefaults.skills = updated.worldDefaults.skills ?? {};
    updated.worldDefaults.skills.spt = 'hide';

    await game.settings.set('warcraftrpg2e', 'worldDefaults', updated);

    try {
      const actor = await Actor.create({
        name: 'Issue 1285 Hidden Skill Actor',
        type: 'npc',
      });

      await actor.update({
        'system.details.levelUpProgression': false,
        'system.details.level.value': 1,
        'system.abilities.int.value': 10,
        'system.skills.spt.points': 4,
      });

      const sheetData = await actor.sheet.getData();
      return {
        hiddenSkillShown: sheetData.skillsets?.all?.skills?.spt != null,
        spotPoints: Number(actor.system.skills?.spt?.points ?? 0),
        usedRanks: Number(sheetData.skillRanks?.used ?? 0),
      };
    } finally {
      await game.settings.set('warcraftrpg2e', 'worldDefaults', original);
    }
  });

  expect(result.hiddenSkillShown).toBe(false);
  expect(result.spotPoints).toBe(4);
  expect(result.usedRanks).toBe(0);
});
