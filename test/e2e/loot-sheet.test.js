'use strict';

/**
 * E2E tests for the loot actor sheet.
 *
 * D35E loot actors (type: 'npc' with flags or type-specific variant) serve as
 * containers for treasure. The loot sheet allows players to take items and
 * currency from the container.
 *
 * Key data model:
 *   - Loot actor has items (type: 'loot', 'weapon', etc.) in its inventory.
 *   - Currency is at `system.currency.gp/sp/cp/pp`.
 *   - Taking items is done via `actor.lootItems()` or direct transfer.
 *
 * These tests cover the data model and basic API — not the full drag-drop UI
 * which requires a scene with tokens.
 *
 * Covers:
 *   1. A loot actor can hold items and currency.
 *   2. Items can be transferred between loot and character actors.
 *   3. Currency is readable and settable on a loot actor.
 *   4. NPC loot sheet getData() exposes itemGroups buckets including tools/containers (GL#1454).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── 1. Loot actor holds items and currency ────────────────────────────────────

test('loot actor can hold items and currency', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const loot = await Actor.create({
      name: 'Treasure Chest',
      type: 'npc',
      system: {
        currency: { gp: 150, sp: 30, cp: 5, pp: 0 },
      },
    });

    await loot.createEmbeddedDocuments('Item', [
      { name: 'Magic Ring',   type: 'loot', system: { quantity: 1, weight: 0.1 } },
      { name: 'Dagger',       type: 'weapon', system: { quantity: 2, weight: 1 } },
    ]);

    const a = game.actors.get(loot.id);
    return {
      itemCount:  a.items.size,
      gp:         a.system.currency.gp,
      sp:         a.system.currency.sp,
    };
  });

  expect(result.itemCount).toBe(2);
  expect(result.gp).toBe(150);
  expect(result.sp).toBe(30);
});

// ── 2. Item can be transferred from loot to character ─────────────────────────

test('item can be transferred from loot actor to character actor via createEmbedded', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const loot = await Actor.create({
      name: 'Loot Box',
      type: 'npc',
    });

    const character = await Actor.create({
      name: 'Adventurer',
      type: 'character',
    });

    const [ring] = await loot.createEmbeddedDocuments('Item', [{
      name: 'Ring of Protection',
      type: 'loot',
      system: { quantity: 1, weight: 0 },
    }]);

    // Transfer: copy item data to character and delete from loot
    const itemData = game.actors.get(loot.id).items.get(ring.id).toObject();
    await game.actors.get(character.id).createEmbeddedDocuments('Item', [itemData]);
    await game.actors.get(loot.id).items.get(ring.id).delete();

    return {
      lootItems:      game.actors.get(loot.id).items.size,
      characterItems: game.actors.get(character.id).items.size,
      itemName:       game.actors.get(character.id).items.contents[0]?.name ?? null,
    };
  });

  expect(result.lootItems).toBe(0);
  expect(result.characterItems).toBe(1);
  expect(result.itemName).toBe('Ring of Protection');
});

// ── 3. Currency on loot actor is transferable ─────────────────────────────────

test('currency can be transferred from loot actor to character by update', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const loot = await Actor.create({
      name: 'Coin Purse',
      type: 'npc',
      system: { currency: { gp: 50, sp: 0, cp: 0, pp: 0 } },
    });

    const character = await Actor.create({
      name: 'Collector',
      type: 'character',
      system: { currency: { gp: 10, sp: 0, cp: 0, pp: 0 } },
    });

    // Transfer 25 gp from loot to character
    const lootGp = game.actors.get(loot.id).system.currency.gp;
    const charGp = game.actors.get(character.id).system.currency.gp;
    const transfer = 25;

    await game.actors.get(loot.id).update({ 'system.currency.gp': lootGp - transfer });
    await game.actors.get(character.id).update({ 'system.currency.gp': charGp + transfer });

    return {
      lootGpAfter: game.actors.get(loot.id).system.currency.gp,
      charGpAfter: game.actors.get(character.id).system.currency.gp,
    };
  });

  expect(result.lootGpAfter).toBe(25);
  expect(result.charGpAfter).toBe(35);
});

// ── 4. Loot sheet itemGroups includes tools and containers (GL#1454) ────────

test('GL#1454 loot sheet itemGroups includes tools and containers buckets', async ({
  page,
}) => {
  const keys = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'E2E Loot Buckets', type: 'npc' });
    await actor.update({
      flags: { core: { sheetClass: 'warcraftrpg2e.ActorSheetPFNPCLoot' } },
    });
    const a = game.actors.get(actor.id);
    const data = await a.sheet.getData();
    return Object.keys(data.actor.itemGroups || {});
  });
  expect(keys).toContain('weapons');
  expect(keys).toContain('loot');
  expect(keys).toContain('valuables');
  expect(keys).toContain('tools');
  expect(keys).toContain('containers');
});
