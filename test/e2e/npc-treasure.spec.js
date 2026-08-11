'use strict';

/**
 * E2E tests for the NPC treasure data feature (issue #1608).
 *
 * Covers:
 *   - schema defaults (coins/goods/items = 100)
 *   - treasure row on the NPC sheet traits section (attributes tab)
 *   - ActorTreasureConfig dialog (open, preset buttons, manual input, submit)
 *   - pill rendering on the sheet after saving
 *   - NPC-only constraint (treasure row absent on character sheet)
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a bare NPC actor and return its id.
 */
async function createNpcActor(page, name = 'Test NPC') {
  return page.evaluate(async (name) => {
    const actor = await Actor.create({ name, type: 'npc' });
    return actor.id;
  }, name);
}

/**
 * Open the actor sheet and return the sheet's DOM element id.
 * The attributes tab is active by default on the NPC sheet, so the treasure
 * row is immediately visible without any extra tab click.
 */
async function openSheet(page, actorId) {
  await dismissOverlays(page);

  const sheetId = await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    const app   = actor.sheet;
    await app.render(true);
    await new Promise(r => setTimeout(r, 600));
    return app.id;
  }, actorId);

  await page.locator(`#${sheetId}`).waitFor({ state: 'visible', timeout: 10_000 });
  await dismissOverlays(page);
  return sheetId;
}

/**
 * Open the ActorTreasureConfig dialog via the pencil button on the NPC sheet
 * and return the dialog locator.
 * In v13 DocumentSheet, the element id is `ClassName-Actor-{actorId}`.
 */
async function openTreasureDialog(page, sheetId, actorId) {
  const sheet = page.locator(`#${sheetId}`);
  await sheet.locator('.treasure-selector').click({ force: true });
  // v13 DocumentSheet.id = `ActorTreasureConfig-Actor-${actorId}`
  const dialogId = `ActorTreasureConfig-Actor-${actorId}`;
  const dialog = page.locator(`#${dialogId}`);
  await dialog.waitFor({ state: 'visible', timeout: 8_000 });
  return dialog;
}

/**
 * Click a preset button inside the open treasure dialog.
 * @param {import('@playwright/test').Locator} dialog
 * @param {'none'|'standard'|'double'|'triple'} preset
 */
async function clickPreset(dialog, preset) {
  // Preset buttons are matched by their data-coins/goods/items dataset values
  const presetValues = {
    none:     { coins: '0',   goods: '0',   items: '0'   },
    standard: { coins: '100', goods: '100', items: '100' },
    double:   { coins: '200', goods: '200', items: '200' },
    triple:   { coins: '300', goods: '300', items: '300' },
  };
  const v = presetValues[preset];
  await dialog
    .locator(`.treasure-preset[data-coins="${v.coins}"][data-goods="${v.goods}"][data-items="${v.items}"]`)
    .click({ force: true });
}

/**
 * Submit the treasure dialog and wait for it to close (sheet re-renders).
 */
async function submitTreasureDialog(page, dialog) {
  await dialog.locator('button[name="submit"]').click({ force: true });
  await dialog.waitFor({ state: 'hidden', timeout: 8_000 });
  // Brief settle time for the sheet to re-render
  await page.waitForTimeout(600);
}

// ── 1. Default rendering ──────────────────────────────────────────────────────

test('NPC sheet shows Treasure label and Standard pill by default', async ({ page }) => {
  const actorId = await createNpcActor(page, 'Treasure Default NPC');
  const sheetId = await openSheet(page, actorId);
  const sheet   = page.locator(`#${sheetId}`);

  // Treasure label present
  await expect(sheet.locator('label', { hasText: 'Treasure' }).first()).toBeVisible();

  // Default "Standard" pill visible
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Standard' }).first()).toBeVisible();
});

// ── 2. Edit dialog opens with correct default values ─────────────────────────

test('clicking the treasure pencil button opens the config dialog with 100/100/100', async ({ page }) => {
  const actorId = await createNpcActor(page, 'Treasure Dialog NPC');
  const sheetId = await openSheet(page, actorId);
  const dialog  = await openTreasureDialog(page, sheetId, actorId);

  // Inputs present and have default value 100
  const coinsInput = dialog.locator('[name="system.details.treasure.coins"]');
  const goodsInput = dialog.locator('[name="system.details.treasure.goods"]');
  const itemsInput = dialog.locator('[name="system.details.treasure.items"]');

  await expect(coinsInput).toBeVisible();
  await expect(goodsInput).toBeVisible();
  await expect(itemsInput).toBeVisible();

  await expect(coinsInput).toHaveValue('100');
  await expect(goodsInput).toHaveValue('100');
  await expect(itemsInput).toHaveValue('100');

  // Close dialog via Escape (more reliable than clicking the close button in v13)
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
});

// ── 3. Apply None preset ──────────────────────────────────────────────────────

test('None preset sets inputs to 0/0/0 and sheet shows None pill', async ({ page }) => {
  const actorId = await createNpcActor(page, 'Treasure None NPC');
  const sheetId = await openSheet(page, actorId);
  const dialog  = await openTreasureDialog(page, sheetId, actorId);

  await clickPreset(dialog, 'none');

  // Inputs should now read 0
  await expect(dialog.locator('[name="system.details.treasure.coins"]')).toHaveValue('0');
  await expect(dialog.locator('[name="system.details.treasure.goods"]')).toHaveValue('0');
  await expect(dialog.locator('[name="system.details.treasure.items"]')).toHaveValue('0');

  await submitTreasureDialog(page, dialog);

  // Sheet should now show "None" pill, not "Standard"
  const sheet = page.locator(`#${sheetId}`);
  await expect(sheet.locator('.traits-list .tag', { hasText: 'None' }).first()).toBeVisible();
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Standard' })).toHaveCount(0);
});

// ── 4. Apply Double preset ────────────────────────────────────────────────────

test('Double preset sets inputs to 200/200/200 and sheet shows Double pill', async ({ page }) => {
  const actorId = await createNpcActor(page, 'Treasure Double NPC');
  const sheetId = await openSheet(page, actorId);
  const dialog  = await openTreasureDialog(page, sheetId, actorId);

  await clickPreset(dialog, 'double');

  await expect(dialog.locator('[name="system.details.treasure.coins"]')).toHaveValue('200');
  await expect(dialog.locator('[name="system.details.treasure.goods"]')).toHaveValue('200');
  await expect(dialog.locator('[name="system.details.treasure.items"]')).toHaveValue('200');

  await submitTreasureDialog(page, dialog);

  const sheet = page.locator(`#${sheetId}`);
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Double Standard' }).first()).toBeVisible();
});

// ── 5. Custom partial values show three individual pills ──────────────────────

test('custom values coins=100 goods=0 items=50 show three individual pills', async ({ page }) => {
  const actorId = await createNpcActor(page, 'Treasure Custom NPC');
  const sheetId = await openSheet(page, actorId);
  const dialog  = await openTreasureDialog(page, sheetId, actorId);

  // Fill custom values
  const coinsInput = dialog.locator('[name="system.details.treasure.coins"]');
  const goodsInput = dialog.locator('[name="system.details.treasure.goods"]');
  const itemsInput = dialog.locator('[name="system.details.treasure.items"]');

  await coinsInput.fill('100');
  await goodsInput.fill('0');
  await itemsInput.fill('50');

  await submitTreasureDialog(page, dialog);

  const sheet = page.locator(`#${sheetId}`);
  // Three individual pills — not a single "Standard" label
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Coins 100%' }).first()).toBeVisible();
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Goods 0%'   }).first()).toBeVisible();
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Items 50%'  }).first()).toBeVisible();
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Standard' })).toHaveCount(0);
});

// ── 6. Coins-only creature ────────────────────────────────────────────────────

test('coins-only creature shows Coins 100% Goods 0% Items 0% pills', async ({ page }) => {
  const actorId = await createNpcActor(page, 'Coins Only NPC');
  const sheetId = await openSheet(page, actorId);
  const dialog  = await openTreasureDialog(page, sheetId, actorId);

  await dialog.locator('[name="system.details.treasure.coins"]').fill('100');
  await dialog.locator('[name="system.details.treasure.goods"]').fill('0');
  await dialog.locator('[name="system.details.treasure.items"]').fill('0');

  await submitTreasureDialog(page, dialog);

  const sheet = page.locator(`#${sheetId}`);
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Coins 100%' }).first()).toBeVisible();
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Goods 0%'   }).first()).toBeVisible();
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Items 0%'   }).first()).toBeVisible();
});

// ── 7. Items-only creature ────────────────────────────────────────────────────

test('items-only creature shows Coins 0% Goods 0% Items 100% pills', async ({ page }) => {
  const actorId = await createNpcActor(page, 'Items Only NPC');
  const sheetId = await openSheet(page, actorId);
  const dialog  = await openTreasureDialog(page, sheetId, actorId);

  await dialog.locator('[name="system.details.treasure.coins"]').fill('0');
  await dialog.locator('[name="system.details.treasure.goods"]').fill('0');
  await dialog.locator('[name="system.details.treasure.items"]').fill('100');

  await submitTreasureDialog(page, dialog);

  const sheet = page.locator(`#${sheetId}`);
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Coins 0%'   }).first()).toBeVisible();
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Goods 0%'   }).first()).toBeVisible();
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Items 100%' }).first()).toBeVisible();
});

// ── 8. Treasure row absent on character sheet ─────────────────────────────────

test('character sheet does not show a Treasure row', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'No Treasure Character',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });
    return actor.id;
  });

  await dismissOverlays(page);

  const sheetId = await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    const app   = actor.sheet;
    await app.render(true);
    await new Promise(r => setTimeout(r, 600));
    return app.id;
  }, actorId);

  await page.locator(`#${sheetId}`).waitFor({ state: 'visible', timeout: 10_000 });
  await dismissOverlays(page);

  const sheet = page.locator(`#${sheetId}`);
  // Navigate to traits tab on the character sheet (the tab may be named differently)
  // The character sheet also uses attributes as the default tab — no click needed.
  // Either way, the .treasure-selector must not be present anywhere.
  await expect(sheet.locator('.treasure-selector')).toHaveCount(0);
});

// ── 9. Triple preset ──────────────────────────────────────────────────────────

test('Triple preset sets inputs to 300/300/300 and sheet shows Triple pill', async ({ page }) => {
  const actorId = await createNpcActor(page, 'Treasure Triple NPC');
  const sheetId = await openSheet(page, actorId);
  const dialog  = await openTreasureDialog(page, sheetId, actorId);

  await clickPreset(dialog, 'triple');

  await expect(dialog.locator('[name="system.details.treasure.coins"]')).toHaveValue('300');
  await expect(dialog.locator('[name="system.details.treasure.goods"]')).toHaveValue('300');
  await expect(dialog.locator('[name="system.details.treasure.items"]')).toHaveValue('300');

  await submitTreasureDialog(page, dialog);

  const sheet = page.locator(`#${sheetId}`);
  await expect(sheet.locator('.traits-list .tag', { hasText: 'Triple Standard' }).first()).toBeVisible();
});

// ── 10. Schema defaults persisted in actor data ───────────────────────────────

test('fresh NPC actor has treasure schema defaults of 100/100/100', async ({ page }) => {
  const treasure = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Schema Default NPC', type: 'npc' });
    const fresh  = game.actors.get(actor.id);
    return fresh.system.details?.treasure ?? null;
  });

  expect(treasure).not.toBeNull();
  expect(treasure.coins).toBe(100);
  expect(treasure.goods).toBe(100);
  expect(treasure.items).toBe(100);
});
