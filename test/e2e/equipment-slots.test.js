'use strict';

/**
 * E2E equipment-slots tests — verify that per-creature slot capacities are
 * enforced when equipping items, and that the Changes system can increase them.
 *
 * Covers issue #1615: configurable equipment slots per creature.
 *
 * Scenarios:
 *   1. Default slotCapacities on a new actor
 *   2. Items added to an actor always land unequipped
 *   3. Equip into an empty slot → succeeds without dialog
 *   4. Equip into full slot (GM) → confirm dialog → item gets equipped
 *   5. Equip into full slot (GM) → cancel dialog → item stays unequipped
 *   6. Ring slot allows two items; third triggers dialog
 *   7. Active buff with slot.ring change increases ring capacity; third ring equips without dialog
 *   8. Slotless items never blocked
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');


// ── Lifecycle ──────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});


// ── helpers ────────────────────────────────────────────────────────────────────

/** Create a character actor and return its id. */
async function createActor(page, name) {
  return page.evaluate(async (name) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });
    return actor.id;
  }, name);
}

/** Create an unequipped equipment item on actor, return its id. */
async function createItem(page, actorId, { name, slot, equipmentType = "misc" }) {
  return page.evaluate(async ({ actorId, name, slot, equipmentType }) => {
    const actor = game.actors.get(actorId);
    const [item] = await actor.createEmbeddedDocuments('Item', [{
      name,
      type: 'equipment',
      system: { slot, equipped: false, equipmentType },
    }]);
    return item.id;
  }, { actorId, name, slot, equipmentType });
}

/** Equip an existing item by id (fire-and-forget — may trigger the dialog). */
async function equipItem(page, actorId, itemId) {
  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(itemId);
    // fire-and-forget so the hook can intercept and show a dialog
    item.update({ 'system.equipped': true });
  }, { actorId, itemId });
}

/** Equip an existing item and await its completion (no dialog expected). */
async function equipItemAwait(page, actorId, itemId) {
  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(itemId);
    await item.update({ 'system.equipped': true });
  }, { actorId, itemId });
}

/** Count equipped items with a given slot on an actor. */
async function countEquipped(page, actorId, slot) {
  return page.evaluate(({ actorId, slot }) => {
    const actor = game.actors.get(actorId);
    return actor.items.filter(i =>
      i.type === 'equipment' && i.system.slot === slot && i.system.equipped
    ).length;
  }, { actorId, slot });
}

/** Count equipped items with a given equipmentType on an actor. */
async function countEquippedByType(page, actorId, equipmentType) {
  return page.evaluate(({ actorId, equipmentType }) => {
    const actor = game.actors.get(actorId);
    return actor.items.filter(i =>
      i.type === 'equipment' && i.system.equipmentType === equipmentType && i.system.equipped
    ).length;
  }, { actorId, equipmentType });
}


// ── 1. Default slotCapacities on new actor ────────────────────────────────────

test('new character actor has expected default slotCapacities', async ({ page }) => {
  const caps = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Slots Default Actor', type: 'character' });
    return game.actors.get(actor.id).system.slotCapacities;
  });

  expect(caps).toBeTruthy();
  expect(caps.ring).toBe(2);
  expect(caps.head).toBe(1);
  expect(caps.armor).toBe(1);
  expect(caps.shield).toBe(1);
  expect(caps.headband).toBe(1);
  expect(caps.eyes).toBe(1);
  expect(caps.shoulders).toBe(1);
  expect(caps.neck).toBe(1);
  expect(caps.chest).toBe(1);
  expect(caps.body).toBe(1);
  expect(caps.belt).toBe(1);
  expect(caps.wrists).toBe(1);
  expect(caps.hands).toBe(1);
  expect(caps.feet).toBe(1);
  expect(caps.slotless).toBe(999);
});


// ── 2. Items land unequipped by default when added to an actor ────────────────

test('items added to an actor always land unequipped even if source has equipped:true', async ({ page }) => {
  const equipped = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Land Unequipped Actor', type: 'character' });
    const [item] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Magic Helmet',
      type: 'equipment',
      system: { slot: 'head', equipped: true },
    }]);
    // Wait briefly for the force-unequip update to arrive
    await new Promise(r => setTimeout(r, 600));
    return game.actors.get(actor.id).items.get(item.id)?.system?.equipped;
  });

  expect(equipped).toBe(false);
});


// ── 3. Equip into an empty slot → succeeds without dialog ─────────────────────

test('equipping an item into an empty slot succeeds without a dialog', async ({ page }) => {
  const actorId = await createActor(page, 'Empty Slot Actor');
  const itemId  = await createItem(page, actorId, { name: 'Iron Helmet', slot: 'slotless', equipmentType: 'armor' });

  await equipItemAwait(page, actorId, itemId);

  expect(await countEquippedByType(page, actorId, 'armor')).toBe(1);
  expect(await page.locator('button[data-action="yes"]').isVisible().catch(() => false)).toBe(false);
});


// ── 4. Full slot (GM) → confirm → item gets equipped ──────────────────────────

test('equipping into a full slot as GM shows confirm dialog and equips on yes', async ({ page }) => {
  const actorId  = await createActor(page, 'Full Slot Confirm Actor');
  const helmet1  = await createItem(page, actorId, { name: 'Helmet One', slot: 'slotless', equipmentType: 'armor' });
  const helmet2  = await createItem(page, actorId, { name: 'Helmet Two', slot: 'slotless', equipmentType: 'armor' });

  // Fill the slot
  await equipItemAwait(page, actorId, helmet1);
  expect(await countEquippedByType(page, actorId, 'armor')).toBe(1);

  // Attempt to equip second — slot full → dialog appears
  await equipItem(page, actorId, helmet2);

  const yesButton = page.locator('button[data-action="yes"]');
  await yesButton.waitFor({ state: 'visible', timeout: 8_000 });
  await yesButton.click();

  await page.waitForFunction(({ actorId }) => {
    const actor = game.actors.get(actorId);
    return actor.items.filter(i =>
      i.type === 'equipment' && i.system.equipmentType === 'armor' && i.system.equipped
    ).length >= 2;
  }, { actorId }, { timeout: 8_000 });

  expect(await countEquippedByType(page, actorId, 'armor')).toBe(2);
});


// ── 5. Full slot (GM) → cancel → item stays unequipped ────────────────────────

test('equipping into a full slot as GM shows confirm dialog and cancels on no', async ({ page }) => {
  const actorId  = await createActor(page, 'Full Slot Cancel Actor');
  const helmet1  = await createItem(page, actorId, { name: 'Helmet One', slot: 'slotless', equipmentType: 'armor' });
  const helmet2  = await createItem(page, actorId, { name: 'Helmet Two', slot: 'slotless', equipmentType: 'armor' });

  await equipItemAwait(page, actorId, helmet1);
  expect(await countEquippedByType(page, actorId, 'armor')).toBe(1);

  await equipItem(page, actorId, helmet2);

  const noButton = page.locator('button[data-action="no"]');
  await noButton.waitFor({ state: 'visible', timeout: 8_000 });
  await noButton.click();

  await page.waitForFunction(
    () => !document.querySelector('button[data-action="yes"]'),
    { timeout: 5_000 }
  );
  await page.waitForTimeout(500);

  expect(await countEquippedByType(page, actorId, 'armor')).toBe(1);
});


// ── 6. Ring slot allows two items; third triggers dialog ──────────────────────

test('ring slot allows two rings then triggers dialog on third', async ({ page }) => {
  const actorId = await createActor(page, 'Ring Slots Actor');
  const ring1   = await createItem(page, actorId, { name: 'Ring of Protection',     slot: 'ring' });
  const ring2   = await createItem(page, actorId, { name: 'Ring of Feather Falling', slot: 'ring' });
  const ring3   = await createItem(page, actorId, { name: 'Ring of Sustenance',     slot: 'ring' });

  await equipItemAwait(page, actorId, ring1);
  expect(await countEquipped(page, actorId, 'ring')).toBe(1);

  await equipItemAwait(page, actorId, ring2);
  expect(await countEquipped(page, actorId, 'ring')).toBe(2);

  // Third ring — slot full → dialog
  await equipItem(page, actorId, ring3);

  const yesButton = page.locator('button[data-action="yes"]');
  await yesButton.waitFor({ state: 'visible', timeout: 8_000 });

  // Cancel — just verifying the dialog appeared
  await page.locator('button[data-action="no"]').click();
  await page.waitForTimeout(500);

  expect(await countEquipped(page, actorId, 'ring')).toBe(2);
});


// ── 7. Buff with slot.ring change raises capacity; third ring equips freely ────

test('active buff with slot.ring change increases ring capacity so third ring equips without dialog', async ({ page }) => {
  const actorId = await createActor(page, 'Ring Capacity Buff Actor');

  // Add an active buff granting +1 ring capacity
  await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Many-Ringed Blessing',
      type: 'buff',
      system: {
        active: true,
        changes: [['1', 'misc', 'slot.ring', 'untyped', 0]],
      },
    }]);
  }, actorId);

  // Wait for capacity to be applied
  await page.waitForFunction((actorId) => {
    return (game.actors.get(actorId).system.slotCapacities?.ring ?? 2) >= 3;
  }, actorId, { timeout: 8_000 });

  expect(await page.evaluate(actorId =>
    game.actors.get(actorId).system.slotCapacities?.ring, actorId)
  ).toBe(3);

  // Create and equip three rings — all should succeed without a dialog
  const ring1 = await createItem(page, actorId, { name: 'Ring One',   slot: 'ring' });
  const ring2 = await createItem(page, actorId, { name: 'Ring Two',   slot: 'ring' });
  const ring3 = await createItem(page, actorId, { name: 'Ring Three', slot: 'ring' });

  await equipItemAwait(page, actorId, ring1);
  await equipItemAwait(page, actorId, ring2);
  await equipItemAwait(page, actorId, ring3);

  expect(await countEquipped(page, actorId, 'ring')).toBe(3);
  expect(await page.locator('button[data-action="yes"]').isVisible().catch(() => false)).toBe(false);
});


// ── 8. Slotless items never blocked ───────────────────────────────────────────

test('equipping many slotless items never triggers the slot dialog', async ({ page }) => {
  const actorId = await createActor(page, 'Slotless Actor');

  for (let i = 1; i <= 5; i++) {
    const itemId = await createItem(page, actorId, { name: `Slotless Item ${i}`, slot: 'slotless' });
    await equipItemAwait(page, actorId, itemId);
  }

  expect(await countEquipped(page, actorId, 'slotless')).toBe(5);
  expect(await page.locator('button[data-action="yes"]').isVisible().catch(() => false)).toBe(false);
});
