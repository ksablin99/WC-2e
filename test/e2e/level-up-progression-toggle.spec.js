'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { openSheet } = require('./helpers/actor-sheet');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

async function createCharacter(page) {
  return page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Level Progression Toggle Actor',
      type: 'character',
    });
    await actor.update({ 'system.details.levelUpProgression': false });
    return actor.id;
  });
}

async function openFeatsTab(page, sheetId) {
  await page.evaluate((id) => {
    document.querySelector(`#${id} nav[data-group="primary"] a[data-tab="feats"]`)?.click();
    document.querySelector(`#${id} nav.feats[data-group="feats"] a[data-tab="classes"]`)?.click();
  }, sheetId);
  await page.waitForFunction(
    (id) => document.querySelector(`#${id} input.level-up-progression`) != null,
    sheetId,
    { timeout: 5_000 },
  );
}

async function clickProgressionToggle(page, sheetId) {
  await page.evaluate((id) => {
    document.querySelector(`#${id} input.level-up-progression`)?.click();
  }, sheetId);
}

async function confirmProgressionDialog(page) {
  const dialog = page.locator('.app.dialog').last();
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });
  await dialog.locator('button[data-button="do"]').click({ force: true });
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
}

async function cancelProgressionDialog(page) {
  const dialog = page.locator('.app.dialog').last();
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });
  await dialog.locator('button[data-button="dont"]').click({ force: true });
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
}

async function getLevelUpProgression(page, actorId) {
  return page.evaluate(
    (id) => game.actors.get(id).system.details.levelUpProgression,
    actorId,
  );
}

test('use class progression dialog enables levelUpProgression on character sheet', async ({ page }) => {
  const actorId = await createCharacter(page);
  const sheetId = await openSheet(page, actorId);
  await openFeatsTab(page, sheetId);

  expect(await getLevelUpProgression(page, actorId)).toBe(false);
  await expect(page.locator(`#${sheetId} .level-up-boxes`)).toHaveCount(0);

  await clickProgressionToggle(page, sheetId);
  await confirmProgressionDialog(page);

  await expect.poll(() => getLevelUpProgression(page, actorId)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        (id) => document.querySelectorAll(`#${id} .level-up-boxes`).length,
        sheetId,
      ),
    )
    .toBeGreaterThan(0);
});

test('use class progression dialog can disable levelUpProgression on character sheet', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Level Progression Toggle Off Actor',
      type: 'character',
    });
    await actor.update({ 'system.details.levelUpProgression': true });
    return actor.id;
  });

  const sheetId = await openSheet(page, actorId);
  await openFeatsTab(page, sheetId);

  expect(await getLevelUpProgression(page, actorId)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        (id) => document.querySelectorAll(`#${id} .level-up-boxes`).length,
        sheetId,
      ),
    )
    .toBeGreaterThan(0);

  await clickProgressionToggle(page, sheetId);
  await confirmProgressionDialog(page);

  await expect.poll(() => getLevelUpProgression(page, actorId)).toBe(false);
  await expect
    .poll(() =>
      page.evaluate(
        (id) => document.querySelectorAll(`#${id} .level-up-boxes`).length,
        sheetId,
      ),
    )
    .toBe(0);
});

test('use class progression dialog cancel leaves levelUpProgression unchanged', async ({ page }) => {
  const actorId = await createCharacter(page);
  const sheetId = await openSheet(page, actorId);
  await openFeatsTab(page, sheetId);

  await clickProgressionToggle(page, sheetId);
  await cancelProgressionDialog(page);

  expect(await getLevelUpProgression(page, actorId)).toBe(false);
  await expect
    .poll(() =>
      page.evaluate(
        (id) => document.querySelectorAll(`#${id} .level-up-boxes`).length,
        sheetId,
      ),
    )
    .toBe(0);
});
