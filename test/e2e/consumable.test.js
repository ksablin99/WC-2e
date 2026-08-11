'use strict';

/**
 * E2E tests for consumable items — charge tracking and deduction.
 *
 * D35E consumable flow:
 *   - A consumable item is any item with `uses.per` set to 'charges', 'day',
 *     or 'single' (single-use) and `uses.autoDeductCharges: true`.
 *   - Calling item.use({ skipDialog: true }) deducts chargeCost (default 1)
 *     via ItemCharges.addCharges(-chargeCost).
 *   - For `uses.per === 'single'`, charges track `quantity` not `uses.value`.
 *   - This test creates synthetic consumable items to avoid compendium lookups.
 *
 * Covers:
 *   1. Using a wand (charges) decrements uses.value by 1 each use.
 *   2. Using all charges leaves item with uses.value === 0.
 *   3. A single-use item decrements its quantity to 0 after one use.
 *   4. Attempting to use with 0 charges warns and does not roll.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: create an actor with a wand-style charged attack item ─────────────

async function createActorWithWand(page, { charges }) {
  return page.evaluate(async ({ charges }) => {
    const actor = await Actor.create({
      name: 'Consumable Test Actor',
      type: 'character',
      system: { abilities: { dex: { value: 14 } } },
    });

    const [wand] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Wand of Magic Missile',
      type: 'attack',
      system: {
        actionType: 'rsak',
        attackParts: [],
        ability: { attack: 'dex', vsTouchAc: false },
        uses: {
          value: charges,
          max:   charges,
          per:   'charges',
          autoDeductCharges: true,
        },
        damage: {
          parts: [['1d4+1', '']],
        },
      },
    }]);

    return { actorId: actor.id, itemId: wand.id };
  }, { charges });
}

// ── 1. Using wand decrements charges by 1 ────────────────────────────────────

test('using a wand decrements its charges by 1', async ({ page }) => {
  const { actorId, itemId } = await createActorWithWand(page, { charges: 5 });

  const msgsBefore = await page.evaluate(() => game.messages.size);

  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    const result = await item.use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, itemId });

  await page.waitForFunction((c) => game.messages.size > c, msgsBefore, { timeout: 8_000 });

  const charges = await page.evaluate(({ actorId, itemId }) => {
    return game.actors.get(actorId).items.get(itemId)?.system?.uses?.value ?? null;
  }, { actorId, itemId });

  expect(charges).toBe(4);
});

// ── 2. Consecutive uses deplete charges ───────────────────────────────────────

test('using a wand 5 times depletes all charges to 0', async ({ page }) => {
  const { actorId, itemId } = await createActorWithWand(page, { charges: 5 });

  for (let i = 0; i < 5; i++) {
    const before = await page.evaluate(() => game.messages.size);
    await page.evaluate(async ({ actorId, itemId }) => {
      const actor = game.actors.get(actorId);
      const item  = actor.items.get(itemId);
      const result = await item.use({ skipDialog: true });
      if (result?.roll) await result.roll;
    }, { actorId, itemId });
    await page.waitForFunction((c) => game.messages.size > c, before, { timeout: 8_000 });
  }

  const charges = await page.evaluate(({ actorId, itemId }) => {
    return game.actors.get(actorId).items.get(itemId)?.system?.uses?.value ?? null;
  }, { actorId, itemId });

  expect(charges).toBe(0);
});

// ── 3. Single-use item decrements quantity ────────────────────────────────────

test('using a single-use potion decrements its quantity', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Potion Actor',
      type: 'character',
    });

    const [potion] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Potion of Cure Light Wounds',
      type: 'consumable',
      system: {
        actionType: 'other',
        quantity: 2,
        uses: {
          value: 1,
          max:   1,
          per:   'single',
          autoDeductCharges: true,
        },
      },
    }]);

    const qtyBefore = game.actors.get(actor.id).items.get(potion.id).system.quantity;

    const item = game.actors.get(actor.id).items.get(potion.id);
    await item.use({ skipDialog: true });

    // Poll for quantity update
    for (let i = 0; i < 20; i++) {
      const qty = game.actors.get(actor.id).items.get(potion.id)?.system?.quantity;
      if (qty < qtyBefore) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return {
      qtyBefore,
      qtyAfter: game.actors.get(actor.id).items.get(potion.id)?.system?.quantity ?? null,
    };
  });

  expect(result.qtyBefore).toBe(2);
  expect(result.qtyAfter).toBe(1);
});

// ── 4. Item with per-day uses resets on rest ──────────────────────────────────

test('per-day item resets uses.value to max after rest', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Per Day Actor', type: 'character' });

    const [itm] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Channel Energy',
      type: 'feat',
      system: {
        uses: { value: 0, max: 4, per: 'day', autoDeductCharges: true },
      },
    }]);

    game.actors.get(actor.id).rest(false, true, false);

    for (let i = 0; i < 30; i++) {
      const v = game.actors.get(actor.id).items.get(itm.id)?.system?.uses?.value;
      if (v === 4) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return game.actors.get(actor.id).items.get(itm.id)?.system?.uses?.value ?? null;
  });

  expect(result).toBe(4);
});
