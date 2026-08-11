'use strict';

/**
 * E2E tests for the Treasure Generator.
 *
 * Tests cover:
 *   - Compendium document fetch works (pack.getDocument resolves)
 *   - TreasureGenerator._makeItem fetches an item from compendium correctly
 *   - Magic item name update after creation (regression for #1607 — item.updateMagicItemName
 *     no longer existed; items were created but names were never updated)
 *   - Full genTreasure() flow via dialog with a selected NPC token
 *   - genTreasure() gracefully handles no selected token
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissSystemDialogs, dismissOverlays, ensureCanvasReady } = require('./helpers');

// Known stable item IDs for deterministic tests
const ITEM_ID_LOOT     = '2ZDbuFeHoQXzBXqZ';  // warcraftrpg2e.items — "Case, map or scroll"
const ITEM_ID_ARMOR    = '5TzaS38RPAx1oj9p';  // warcraftrpg2e.armors-and-shields — "Breastplate"

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// no canvas-scene helpers needed — tests 4 & 5 use a synthetic token mock

// ── Tests: compendium access ───────────────────────────────────────────────────

test('pack.getDocument() resolves for a known item ID', async ({ page }) => {
  const result = await page.evaluate(async (id) => {
    const pack = game.packs.get('warcraftrpg2e.items');
    if (!pack) return { ok: false, error: 'pack not found' };
    await pack.getIndex();
    const doc = await pack.getDocument(id);
    if (!doc) return { ok: false, error: 'document not found' };
    return { ok: true, name: doc.name, type: doc.type };
  }, ITEM_ID_LOOT);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.name).toBeTruthy();
});

// ── Tests: TreasureGenerator API ──────────────────────────────────────────────

test('TreasureGenerator._makeItem fetches a loot item from compendium', async ({ page }) => {
  const result = await page.evaluate(async (itemId) => {
    const gen = new game.D35E.TreasureGenerator();
    const itemObj = await gen._makeItem({
      id: `warcraftrpg2e.items.${itemId}`,
      type: 'Loot',
      enhancement: 0,
      ability: [],
      amount: 1,
    });
    if (!itemObj) return { ok: false, error: '_makeItem returned null/undefined' };
    return { ok: true, name: itemObj.name, type: itemObj.type };
  }, ITEM_ID_LOOT);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.name).toBeTruthy();
});

test('updateBaseItemName runs without error on a created equipment item (regression #1607)', async ({ page }) => {
  // Regression: item.updateMagicItemName() and item.updateMagicItemProperties() no longer
  // existed — calling them crashed silently. Fixed by using item.enhancements.updateBaseItemName().
  const result = await page.evaluate(async ({ armorId }) => {
    // Create a temporary actor to hold the item
    const actor = await Actor.create({ name: 'Treasure Test Actor', type: 'npc' });

    // Fetch a real equipment item from the compendium
    const pack = game.packs.get('warcraftrpg2e.armors-and-shields');
    await pack.getIndex();
    const doc = await pack.getDocument(armorId);
    if (!doc) return { ok: false, error: 'armor not found in pack' };

    const itemData = doc.toObject();
    delete itemData._id;

    // Create the item on the actor (same as genTreasure does)
    const [created] = await actor.createEmbeddedDocuments('Item', [itemData], { stopUpdates: true });

    // This is the code path that previously crashed:
    //   TypeError: item.updateMagicItemName is not a function
    try {
      await created.enhancements.updateBaseItemName(true);
      return { ok: true, name: created.name };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, { armorId: ITEM_ID_ARMOR });

  expect(result.ok, result.error ?? '').toBe(true);
});

// ── Tests: full genTreasure() dialog flow ─────────────────────────────────────
//
// These tests inject a synthetic "controlled token" into canvas.tokens so that
// genTreasure() can pass its token-selection guard without needing a rendered
// canvas scene (headless-safe). The actor is a real Foundry document; items are
// created on it normally. canvas.tokens.controlled is restored via `delete`
// after the call so the prototype property takes over again.

test('genTreasure() dialog: mundane items are added to NPC actor', async ({ page }) => {
  await ensureCanvasReady(page);

  const actorId = await page.evaluate(async () => {
    const a = await Actor.create({ name: 'Treasure NPC', type: 'npc', system: { details: { cr: 3 } } });
    return a.id;
  });

  const result = await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    const fakeToken    = { id: '__treasure_test__', document: { actorId } };
    const fakeTokenObj = { id: '__treasure_test__', actor };

    Object.defineProperty(canvas.tokens, 'controlled', { get: () => [fakeToken], configurable: true });
    const origGet     = canvas.tokens.get.bind(canvas.tokens);
    canvas.tokens.get = id => id === '__treasure_test__' ? fakeTokenObj : origGet(id);

    try {
      const dlg = new game.D35E.TreasureGeneratorDialog();
      dlg.treasures.push({
        treasureType: 'armors', treasureTypeDesc: 'Armor and shields',
        treasureAmount: 1, treasureQuality: 'mundane',
        treasureQualityDesc: 'Mundane', identified: true,
      });
      await dlg.genTreasure();
      return { ok: true, itemCount: actor.items.size };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      delete canvas.tokens.controlled;
      canvas.tokens.get = origGet;
    }
  }, actorId);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.itemCount, 'NPC actor should have at least 1 item after generation').toBeGreaterThan(0);
});

test('genTreasure() dialog: magic armor/shield is added to NPC actor', async ({ page }) => {
  await ensureCanvasReady(page);

  const actorId = await page.evaluate(async () => {
    const a = await Actor.create({ name: 'Treasure NPC Magic', type: 'npc', system: { details: { cr: 5 } } });
    return a.id;
  });

  const result = await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    const fakeToken    = { id: '__treasure_test2__', document: { actorId } };
    const fakeTokenObj = { id: '__treasure_test2__', actor };

    Object.defineProperty(canvas.tokens, 'controlled', { get: () => [fakeToken], configurable: true });
    const origGet     = canvas.tokens.get.bind(canvas.tokens);
    canvas.tokens.get = id => id === '__treasure_test2__' ? fakeTokenObj : origGet(id);

    try {
      const dlg = new game.D35E.TreasureGeneratorDialog();
      dlg.treasures.push({
        treasureType: 'armors', treasureTypeDesc: 'Armor and shields',
        treasureAmount: 1, treasureQuality: 'minor',
        treasureQualityDesc: 'Minor', identified: true,
      });
      await dlg.genTreasure();
      return { ok: true, itemCount: actor.items.size };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      delete canvas.tokens.controlled;
      canvas.tokens.get = origGet;
    }
  }, actorId);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.itemCount, 'NPC should have at least one item').toBeGreaterThan(0);
});

test('genTreasure() dialog: gracefully handles no selected token', async ({ page }) => {
  await ensureCanvasReady(page);

  // Ensure no tokens are selected
  await page.evaluate(() => canvas.tokens.releaseAll());

  const result = await page.evaluate(async () => {
    const dlg = new game.D35E.TreasureGeneratorDialog();
    dlg.treasures.push({
      treasureType: 'armors', treasureTypeDesc: 'Armor and shields',
      treasureAmount: 1, treasureQuality: 'mundane',
      treasureQualityDesc: 'Mundane', identified: true,
    });
    try {
      await dlg.genTreasure();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // genTreasure() calls ui.notifications.info() and returns — no throw
  expect(result.ok).toBe(true);
});
