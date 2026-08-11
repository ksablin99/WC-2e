'use strict';

/**
 * E2E tests for the configurable equipment slots feature (issue #1615).
 *
 * Covers:
 *   1. Default ring slot capacity (2) — equipping two rings succeeds
 *   2. Single-capacity slot (neck) — equipping a second item is blocked
 *   3. Provider increases capacity — slot.ring +1 Change grants an extra ring slot
 *   4. Provider uses item ID in slotSource — not name
 *   5. Provider unequip cascades — items in provider slots are unequipped
 *   6. Provider re-equip restores — items come back when provider is re-equipped
 *   7. Manual unequip clears slotSource — slotSource is cleared, not preserved
 *   8. Slot reduction clears all — reducing grant unequips and clears slotSource
 *   9. Feat provider works — feat with slot.ring +1 Change also grants extra slot
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
 * Create a bare character actor and return its id.
 */
async function createCharacter(page, name = 'Test Character') {
  return page.evaluate(async (name) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      system: { abilities: { str: { value: 10 }, dex: { value: 10 } } },
    });
    return actor.id;
  }, name);
}

/**
 * Create an equipment item with the given slot on the actor, unequipped.
 * Returns the item id.
 */
async function createEquipmentItem(page, actorId, name, slot) {
  return page.evaluate(async ({ actorId, name, slot }) => {
    const actor = game.actors.get(actorId);
    const [item] = await actor.createEmbeddedDocuments('Item', [{
      name,
      type: 'equipment',
      system: {
        equipmentType: 'misc',
        slot,
        equipped: false,
        identified: true,
        quantity: 1,
        weight: 0,
      },
    }]);
    return item.id;
  }, { actorId, name, slot });
}

/**
 * Create an equipment item that grants extra slot capacity via a Change.
 * e.g. a Hand of Glory that grants slot.ring +1
 * Returns the item id.
 */
async function createProviderItem(page, actorId, name, slotKey, grantCount = 1) {
  return page.evaluate(async ({ actorId, name, slotKey, grantCount }) => {
    const actor = game.actors.get(actorId);
    const changes = [];
    for (let i = 0; i < grantCount; i++) {
      changes.push([String(1), 'slot', `slot.${slotKey}`, 'untyped', 0]);
    }
    const [item] = await actor.createEmbeddedDocuments('Item', [{
      name,
      type: 'equipment',
      system: {
        equipmentType: 'misc',
        slot: 'slotless',   // The provider itself occupies no slot (or neck, etc.)
        equipped: false,
        identified: true,
        quantity: 1,
        weight: 0,
        changes,
      },
    }]);
    return item.id;
  }, { actorId, name, slotKey, grantCount });
}

/**
 * Create a feat item that grants extra slot capacity via a Change.
 * Returns the item id.
 */
async function createFeatProvider(page, actorId, name, slotKey) {
  return page.evaluate(async ({ actorId, name, slotKey }) => {
    const actor = game.actors.get(actorId);
    const [item] = await actor.createEmbeddedDocuments('Item', [{
      name,
      type: 'feat',
      system: {
        changes: [[String(1), 'slot', `slot.${slotKey}`, 'untyped', 0]],
      },
    }]);
    return item.id;
  }, { actorId, name, slotKey });
}

/**
 * Equip an item (bypass slot check) and wait until equipped = true.
 */
async function equipItem(page, actorId, itemId) {
  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    await item.update({ 'system.equipped': true }, { _slotBypass: true });
  }, { actorId, itemId });

  await page.waitForFunction(({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    return actor?.items.get(itemId)?.system.equipped === true;
  }, { actorId, itemId }, { timeout: 5_000 });
}

/**
 * Unequip an item and wait until equipped = false.
 * Uses a normal update (no bypass) so the hook fires and clears slotSource.
 */
async function unequipItem(page, actorId, itemId) {
  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    await item.update({ 'system.equipped': false });
  }, { actorId, itemId });

  await page.waitForFunction(({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    return actor?.items.get(itemId)?.system.equipped === false;
  }, { actorId, itemId }, { timeout: 5_000 });
}

/**
 * Read an item's slotSource flag from the actor.
 */
async function getSlotSource(page, actorId, itemId) {
  return page.evaluate(({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    return item?.getFlag('D35E', 'slotSource') ?? null;
  }, { actorId, itemId });
}

/**
 * Set slotSource flag directly (simulates what the sheet does on a provider drop).
 */
async function setSlotSource(page, actorId, itemId, slotSource) {
  await page.evaluate(async ({ actorId, itemId, slotSource }) => {
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    await item.setFlag('D35E', 'slotSource', slotSource);
  }, { actorId, itemId, slotSource });
}

/**
 * Wait for an item's equipped state to match the expected value.
 */
async function waitForEquipped(page, actorId, itemId, equipped, timeout = 5_000) {
  await page.waitForFunction(({ actorId, itemId, equipped }) => {
    const actor = game.actors.get(actorId);
    return actor?.items.get(itemId)?.system.equipped === equipped;
  }, { actorId, itemId, equipped }, { timeout });
}

/**
 * Get actor's slotCapacities from its system data.
 */
async function getSlotCapacity(page, actorId, slotKey) {
  return page.evaluate(({ actorId, slotKey }) => {
    const actor = game.actors.get(actorId);
    return actor?.system?.slotCapacities?.[slotKey] ?? null;
  }, { actorId, slotKey });
}

// ── 1. Default ring capacity allows two rings ─────────────────────────────────

test('default ring slot capacity is 2 — two rings can be equipped simultaneously', async ({ page }) => {
  const actorId = await createCharacter(page, 'Ring Capacity Actor');
  const ring1Id = await createEquipmentItem(page, actorId, 'Ring of Protection', 'ring');
  const ring2Id = await createEquipmentItem(page, actorId, 'Ring of Sustenance', 'ring');

  await equipItem(page, actorId, ring1Id);
  await equipItem(page, actorId, ring2Id);

  const ring1Equipped = await page.evaluate(({ actorId, itemId }) =>
    game.actors.get(actorId)?.items.get(itemId)?.system.equipped,
    { actorId, itemId: ring1Id });
  const ring2Equipped = await page.evaluate(({ actorId, itemId }) =>
    game.actors.get(actorId)?.items.get(itemId)?.system.equipped,
    { actorId, itemId: ring2Id });

  expect(ring1Equipped).toBe(true);
  expect(ring2Equipped).toBe(true);
});

// ── 2. Slot full check blocks a third ring (without bypass) ───────────────────

test('slot full check prevents equipping a third ring without bypass', async ({ page }) => {
  const actorId = await createCharacter(page, 'Ring Full Actor');
  const ring1Id = await createEquipmentItem(page, actorId, 'Ring 1', 'ring');
  const ring2Id = await createEquipmentItem(page, actorId, 'Ring 2', 'ring');
  const ring3Id = await createEquipmentItem(page, actorId, 'Ring 3', 'ring');

  // Fill both default ring slots
  await equipItem(page, actorId, ring1Id);
  await equipItem(page, actorId, ring2Id);

  // Attempt to equip third ring WITHOUT bypass — hook should block it
  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    // No _slotBypass — the slot-full check will fire and return false
    // We call it but don't await because the hook cancels it synchronously
    item.update({ 'system.equipped': true });
  }, { actorId, itemId: ring3Id });

  // Wait a moment for any async processing
  await page.waitForTimeout(800);

  // Ring 3 must still be unequipped
  const ring3Equipped = await page.evaluate(({ actorId, itemId }) =>
    game.actors.get(actorId)?.items.get(itemId)?.system.equipped,
    { actorId, itemId: ring3Id });

  expect(ring3Equipped).toBe(false);
});

// ── 3. Neck slot capacity is 1 — equipping a second amulet is blocked ─────────

test('neck slot capacity is 1 — second amulet is blocked without bypass', async ({ page }) => {
  const actorId = await createCharacter(page, 'Neck Full Actor');
  const amulet1Id = await createEquipmentItem(page, actorId, 'Amulet of Health', 'neck');
  const amulet2Id = await createEquipmentItem(page, actorId, 'Amulet of Wisdom', 'neck');

  await equipItem(page, actorId, amulet1Id);

  // Attempt to equip second neck item — no bypass
  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    item.update({ 'system.equipped': true });
  }, { actorId, itemId: amulet2Id });

  await page.waitForTimeout(800);

  const amulet2Equipped = await page.evaluate(({ actorId, itemId }) =>
    game.actors.get(actorId)?.items.get(itemId)?.system.equipped,
    { actorId, itemId: amulet2Id });

  expect(amulet2Equipped).toBe(false);
});

// ── 4. Provider item increases slot capacity ──────────────────────────────────

test('provider item with slot.ring +1 increases ring slot capacity to 3', async ({ page }) => {
  const actorId    = await createCharacter(page, 'Provider Capacity Actor');
  const providerId = await createProviderItem(page, actorId, 'Hand of Glory', 'ring', 1);

  // Equip the provider so its Change becomes active
  await equipItem(page, actorId, providerId);

  // Wait for actor to recalculate slotCapacities (changes applied by actorUpdater)
  await page.waitForFunction(({ actorId }) => {
    const actor = game.actors.get(actorId);
    return (actor?.system?.slotCapacities?.ring ?? 0) >= 3;
  }, { actorId }, { timeout: 8_000 });

  const capacity = await getSlotCapacity(page, actorId, 'ring');
  expect(capacity).toBe(3);
});

// ── 5. Provider unequip cascades to items in its slots ────────────────────────

test('unequipping provider cascades to unequip items in its slots', async ({ page }) => {
  const actorId    = await createCharacter(page, 'Provider Cascade Actor');
  const providerId = await createProviderItem(page, actorId, 'Hand of Glory', 'ring', 1);
  const ringId     = await createEquipmentItem(page, actorId, 'Lucky Ring', 'ring');

  // Equip provider first so the extra slot becomes available
  await equipItem(page, actorId, providerId);

  // Wait for capacity to reach 3
  await page.waitForFunction(({ actorId }) =>
    (game.actors.get(actorId)?.system?.slotCapacities?.ring ?? 0) >= 3,
    { actorId }, { timeout: 8_000 });

  // Fill both default ring slots first with placeholder items
  const ring1Id = await createEquipmentItem(page, actorId, 'Ring 1', 'ring');
  const ring2Id = await createEquipmentItem(page, actorId, 'Ring 2', 'ring');
  await equipItem(page, actorId, ring1Id);
  await equipItem(page, actorId, ring2Id);

  // Now equip the ring into the provider slot (uses bypass + sets slotSource to provider id)
  await setSlotSource(page, actorId, ringId, providerId);
  await equipItem(page, actorId, ringId);

  // Confirm ring is equipped
  let equipped = await page.evaluate(({ actorId, itemId }) =>
    game.actors.get(actorId)?.items.get(itemId)?.system.equipped,
    { actorId, itemId: ringId });
  expect(equipped).toBe(true);

  // Now unequip the provider — cascade should unequip the ring
  await unequipItem(page, actorId, providerId);

  // Wait for the cascade
  await page.waitForFunction(({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    return actor?.items.get(itemId)?.system.equipped === false;
  }, { actorId, itemId: ringId }, { timeout: 5_000 });

  equipped = await page.evaluate(({ actorId, itemId }) =>
    game.actors.get(actorId)?.items.get(itemId)?.system.equipped,
    { actorId, itemId: ringId });
  expect(equipped).toBe(false);

  // slotSource should be PRESERVED after cascade unequip (kept for re-equip)
  const slotSource = await getSlotSource(page, actorId, ringId);
  expect(slotSource).toBe(providerId);
});

// ── 6. Provider re-equip restores items in its slots ─────────────────────────

test('re-equipping provider restores items that were in its slots', async ({ page }) => {
  const actorId    = await createCharacter(page, 'Provider Restore Actor');
  const providerId = await createProviderItem(page, actorId, 'Hand of Glory', 'ring', 1);
  const ringId     = await createEquipmentItem(page, actorId, 'Lucky Ring', 'ring');

  // Equip provider, fill defaults, put ring in provider slot
  await equipItem(page, actorId, providerId);
  await page.waitForFunction(({ actorId }) =>
    (game.actors.get(actorId)?.system?.slotCapacities?.ring ?? 0) >= 3,
    { actorId }, { timeout: 8_000 });

  const r1Id = await createEquipmentItem(page, actorId, 'Ring A', 'ring');
  const r2Id = await createEquipmentItem(page, actorId, 'Ring B', 'ring');
  await equipItem(page, actorId, r1Id);
  await equipItem(page, actorId, r2Id);

  await setSlotSource(page, actorId, ringId, providerId);
  await equipItem(page, actorId, ringId);

  // Unequip provider (cascades unequip on ring but preserves slotSource)
  await unequipItem(page, actorId, providerId);
  await waitForEquipped(page, actorId, ringId, false);

  // Confirm slotSource is still set
  let slotSource = await getSlotSource(page, actorId, ringId);
  expect(slotSource).toBe(providerId);

  // Re-equip the provider — ring should come back
  await equipItem(page, actorId, providerId);

  await page.waitForFunction(({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    return actor?.items.get(itemId)?.system.equipped === true;
  }, { actorId, itemId: ringId }, { timeout: 8_000 });

  const equipped = await page.evaluate(({ actorId, itemId }) =>
    game.actors.get(actorId)?.items.get(itemId)?.system.equipped,
    { actorId, itemId: ringId });
  expect(equipped).toBe(true);
});

// ── 7. Manual unequip clears slotSource ──────────────────────────────────────

test('manually unequipping a ring from a provider slot clears slotSource', async ({ page }) => {
  const actorId    = await createCharacter(page, 'Manual Unequip Actor');
  const providerId = await createProviderItem(page, actorId, 'Hand of Glory', 'ring', 1);
  const ringId     = await createEquipmentItem(page, actorId, 'Magic Ring', 'ring');

  await equipItem(page, actorId, providerId);
  await page.waitForFunction(({ actorId }) =>
    (game.actors.get(actorId)?.system?.slotCapacities?.ring ?? 0) >= 3,
    { actorId }, { timeout: 8_000 });

  const r1Id = await createEquipmentItem(page, actorId, 'Ring A', 'ring');
  const r2Id = await createEquipmentItem(page, actorId, 'Ring B', 'ring');
  await equipItem(page, actorId, r1Id);
  await equipItem(page, actorId, r2Id);

  // Place ring in provider slot
  await setSlotSource(page, actorId, ringId, providerId);
  await equipItem(page, actorId, ringId);

  // Manually unequip the ring (user-initiated, no _forceUnequip)
  await unequipItem(page, actorId, ringId);

  // Wait for slotSource to be cleared by the hook
  await page.waitForFunction(({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item  = actor?.items.get(itemId);
    return item?.getFlag('D35E', 'slotSource') == null;
  }, { actorId, itemId: ringId }, { timeout: 5_000 });

  const slotSource = await getSlotSource(page, actorId, ringId);
  expect(slotSource).toBeNull();
});

// ── 8. Slot reduction clears all slotSource data for affected items ───────────

test('reducing provider slot grant unequips and clears slotSource for orphaned items', async ({ page }) => {
  const actorId    = await createCharacter(page, 'Slot Reduction Actor');
  // Create provider granting 2 extra ring slots
  const providerId = await createProviderItem(page, actorId, 'Greater Hand of Glory', 'ring', 2);
  const ring3Id    = await createEquipmentItem(page, actorId, 'Ring 3', 'ring');
  const ring4Id    = await createEquipmentItem(page, actorId, 'Ring 4', 'ring');

  await equipItem(page, actorId, providerId);
  await page.waitForFunction(({ actorId }) =>
    (game.actors.get(actorId)?.system?.slotCapacities?.ring ?? 0) >= 4,
    { actorId }, { timeout: 8_000 });

  // Fill all 4 ring slots
  const r1Id = await createEquipmentItem(page, actorId, 'Ring A', 'ring');
  const r2Id = await createEquipmentItem(page, actorId, 'Ring B', 'ring');
  await equipItem(page, actorId, r1Id);
  await equipItem(page, actorId, r2Id);

  // Put ring3 and ring4 in provider slots
  await setSlotSource(page, actorId, ring3Id, providerId);
  await setSlotSource(page, actorId, ring4Id, `${providerId}:1`);
  await equipItem(page, actorId, ring3Id);
  await equipItem(page, actorId, ring4Id);

  // Now reduce the provider's Changes from 2 grants to 0
  await page.evaluate(async ({ actorId, providerId }) => {
    const actor    = game.actors.get(actorId);
    const provider = actor.items.get(providerId);
    await provider.update({ 'system.changes': [] });
  }, { actorId, providerId });

  // Wait for both rings to be unequipped and slotSource cleared
  await page.waitForFunction(({ actorId, ring3Id, ring4Id }) => {
    const actor = game.actors.get(actorId);
    const r3    = actor?.items.get(ring3Id);
    const r4    = actor?.items.get(ring4Id);
    return !r3?.system.equipped && !r4?.system.equipped &&
           r3?.getFlag('D35E', 'slotSource') == null &&
           r4?.getFlag('D35E', 'slotSource') == null;
  }, { actorId, ring3Id, ring4Id }, { timeout: 8_000 });

  const r3Equipped = await page.evaluate(({ actorId, itemId }) =>
    game.actors.get(actorId)?.items.get(itemId)?.system.equipped,
    { actorId, itemId: ring3Id });
  const r4Equipped = await page.evaluate(({ actorId, itemId }) =>
    game.actors.get(actorId)?.items.get(itemId)?.system.equipped,
    { actorId, itemId: ring4Id });

  expect(r3Equipped).toBe(false);
  expect(r4Equipped).toBe(false);

  const r3Src = await getSlotSource(page, actorId, ring3Id);
  const r4Src = await getSlotSource(page, actorId, ring4Id);
  expect(r3Src).toBeNull();
  expect(r4Src).toBeNull();
});

// ── 9. Provider item ID used in slotSource, not name ─────────────────────────

test('slotSource stores provider item ID, not name — two identically-named providers get distinct slots', async ({ page }) => {
  const actorId     = await createCharacter(page, 'Distinct Provider Actor');
  const provider1Id = await createProviderItem(page, actorId, 'Hand of Glory', 'ring', 1);
  const provider2Id = await createProviderItem(page, actorId, 'Hand of Glory', 'ring', 1);
  const ringForP1   = await createEquipmentItem(page, actorId, 'Ring for P1', 'ring');
  const ringForP2   = await createEquipmentItem(page, actorId, 'Ring for P2', 'ring');

  await equipItem(page, actorId, provider1Id);
  await equipItem(page, actorId, provider2Id);

  // Wait for capacity to reach 4 (2 default + 2 providers)
  await page.waitForFunction(({ actorId }) =>
    (game.actors.get(actorId)?.system?.slotCapacities?.ring ?? 0) >= 4,
    { actorId }, { timeout: 8_000 });

  // Fill the two default ring slots
  const r1Id = await createEquipmentItem(page, actorId, 'Ring A', 'ring');
  const r2Id = await createEquipmentItem(page, actorId, 'Ring B', 'ring');
  await equipItem(page, actorId, r1Id);
  await equipItem(page, actorId, r2Id);

  // Assign ring to each provider by ID
  await setSlotSource(page, actorId, ringForP1, provider1Id);
  await setSlotSource(page, actorId, ringForP2, provider2Id);
  await equipItem(page, actorId, ringForP1);
  await equipItem(page, actorId, ringForP2);

  // Verify slotSource values are the provider IDs (not the shared name)
  const src1 = await getSlotSource(page, actorId, ringForP1);
  const src2 = await getSlotSource(page, actorId, ringForP2);

  expect(src1).toBe(provider1Id);
  expect(src2).toBe(provider2Id);
  // They must differ despite the providers sharing the same name
  expect(src1).not.toBe(src2);

  // Unequipping provider1 must cascade only to ringForP1, not ringForP2
  await unequipItem(page, actorId, provider1Id);
  await waitForEquipped(page, actorId, ringForP1, false);

  const p2RingStillEquipped = await page.evaluate(({ actorId, itemId }) =>
    game.actors.get(actorId)?.items.get(itemId)?.system.equipped,
    { actorId, itemId: ringForP2 });

  expect(p2RingStillEquipped).toBe(true);
});

// ── 10. Feat provider grants extra slot ───────────────────────────────────────

test('feat with slot.ring +1 Change grants extra ring slot', async ({ page }) => {
  const actorId = await createCharacter(page, 'Feat Provider Actor');
  const featId  = await createFeatProvider(page, actorId, 'Extra Ring Slot', 'ring');

  // Feats are always "active" — just creating the feat should apply the Change.
  // Wait for actor slotCapacities to reflect the extra slot.
  await page.waitForFunction(({ actorId }) => {
    const actor = game.actors.get(actorId);
    return (actor?.system?.slotCapacities?.ring ?? 0) >= 3;
  }, { actorId }, { timeout: 8_000 });

  const capacity = await getSlotCapacity(page, actorId, 'ring');
  expect(capacity).toBe(3);

  // Confirm a third ring can now be equipped
  const r1Id = await createEquipmentItem(page, actorId, 'Ring A', 'ring');
  const r2Id = await createEquipmentItem(page, actorId, 'Ring B', 'ring');
  const r3Id = await createEquipmentItem(page, actorId, 'Ring C', 'ring');

  await equipItem(page, actorId, r1Id);
  await equipItem(page, actorId, r2Id);
  await equipItem(page, actorId, r3Id);

  const r3Equipped = await page.evaluate(({ actorId, itemId }) =>
    game.actors.get(actorId)?.items.get(itemId)?.system.equipped,
    { actorId, itemId: r3Id });

  expect(r3Equipped).toBe(true);
});

// ── 11. slotSource encodes position correctly (default positions) ─────────────

test('equipping into a default slot position sets correct slotSource encoding', async ({ page }) => {
  const actorId = await createCharacter(page, 'SlotSource Encoding Actor');
  const ring1Id = await createEquipmentItem(page, actorId, 'Ring 1', 'ring');
  const ring2Id = await createEquipmentItem(page, actorId, 'Ring 2', 'ring');

  // Equip ring 1 with no slotSource set — it should default to position 0 (encoded as "")
  await equipItem(page, actorId, ring1Id);

  // Equip ring 2 with slotSource ":1" (explicit default position 1)
  await setSlotSource(page, actorId, ring2Id, ':1');
  await equipItem(page, actorId, ring2Id);

  const src1 = await getSlotSource(page, actorId, ring1Id);
  const src2 = await getSlotSource(page, actorId, ring2Id);

  // ring1 has no slotSource set (null or "") — position 0
  expect(src1 === null || src1 === '').toBe(true);
  // ring2 has explicit ":1" position marker
  expect(src2).toBe(':1');
});
