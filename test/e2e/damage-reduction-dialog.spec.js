'use strict';

/**
 * E2E test for DR/ER dialog persistence (issue #1625).
 *
 * Bug: _updateObject wrote to data.damageReduction / data.energyResistance,
 * which Foundry v13 ignores; saves appeared to work but actor data was unchanged.
 *
 * Fix: persist to system.damageReduction / system.energyResistance.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { openSheet } = require('./helpers/actor-sheet');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

async function createCharacter(page, name = 'DR Dialog Test') {
  return page.evaluate(async (name) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      system: {
        abilities: {
          str: { value: 10 },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 10 },
          wis: { value: 10 },
          cha: { value: 10 },
        },
      },
    });
    return actor.id;
  }, name);
}

test('damage reduction dialog saves system.damageReduction.any', async ({ page }) => {
  const actorId = await createCharacter(page);
  const sheetId = await openSheet(page, actorId);

  await page.locator(`#${sheetId} nav.sheet-navigation.tabs a[data-tab="attributes"]`).click();
  await page.locator(`#${sheetId} .drer-selector`).first().click();

  const dialog = page.locator('#dr-setting');
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });

  await dialog.locator('input[name="dr-value-any"]').fill('5');
  await dialog.locator('button[type="submit"]').click();

  await page.waitForFunction(
    ({ id }) => {
      const a = game.actors.get(id);
      return a?.system?.damageReduction?.any === 5;
    },
    { id: actorId },
    { timeout: 8_000 },
  );

  const anyDr = await page.evaluate((id) => {
    return game.actors.get(id)?.system?.damageReduction?.any;
  }, actorId);
  expect(anyDr).toBe(5);
});
