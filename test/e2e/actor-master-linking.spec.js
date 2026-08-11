'use strict';

/**
 * E2E tests for ActorPF._setMaster() — the function that links an NPC to a
 * master (Character) actor, used for animal companions and familiars.
 *
 * Bug (pre-fix): _setMaster used `data: { master: {...} }` (v12 path) instead
 * of `system: { master: {...} }` (v13 path), so the master was never stored.
 *
 * Fix: update path changed to `system: { master: {...} }`.
 *
 * Covers:
 *   1. Calling _setMaster() on an NPC stores master.id on actor.system.master.
 *   2. Master data includes id, img, and name fields.
 *   3. Calling _setMaster(null) clears actor.system.master.
 *
 * Note: _setMaster() does not await its internal this.update() call, so tests
 * use page.waitForFunction() to poll until the Foundry document store reflects
 * the expected change rather than relying on a single synchronous read.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);

  // Start listening for a potential page-load event BEFORE clearWorld so we
  // don't miss it.  Deleting scenes can trigger an async Foundry canvas reload;
  // if that reload fires after our post-clearWorld waitForFunction returns, the
  // next page.evaluate hits "Execution context was destroyed".
  const loadSettled = page.waitForEvent('load', { timeout: 5_000 }).catch(() => null);
  await clearWorld(page);
  await loadSettled; // wait for the reload if it happened; no-op if it didn't

  await page.waitForFunction(
    () => typeof game !== 'undefined' && game.ready === true && game.scenes.size === 0,
    { timeout: 15_000 },
  );
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── 1. Linking — _setMaster() stores master id in system.master ──────────────

test('_setMaster() stores master id in npc.system.master', async ({ page }) => {
  // Create both actors and call _setMaster inside page.evaluate
  const ids = await page.evaluate(async () => {
    const master = await Actor.create({ name: 'Master Hero', type: 'character' });
    const npc    = await Actor.create({ name: 'Familiar Cat', type: 'npc' });

    // Mimics dropping a character sheet onto the NPC sheet
    npc._setMaster({ id: master.id, img: master.img, name: master.name });

    return { masterId: master.id, npcId: npc.id };
  });

  // _setMaster fires this.update() without awaiting it; poll until persisted
  await page.waitForFunction(
    ({ npcId, masterId }) => {
      const npc = game.actors.get(npcId);
      return npc?.system?.master?.id === masterId;
    },
    ids,
    { timeout: 5_000 }
  );

  const masterOnNpc = await page.evaluate(({ npcId }) => {
    const m = game.actors.get(npcId).system.master;
    return m ?? null;
  }, { npcId: ids.npcId });

  expect(masterOnNpc).not.toBeNull();
  expect(masterOnNpc.id).toBe(ids.masterId);
});

// ── 2. Master data fields — id, img, and name are all stored ─────────────────

test('_setMaster() stores id, img, and name on npc.system.master', async ({ page }) => {
  const ids = await page.evaluate(async () => {
    const master = await Actor.create({ name: 'Master Wizard', type: 'character' });
    const npc    = await Actor.create({ name: 'Imp Familiar', type: 'npc' });

    npc._setMaster({ id: master.id, img: master.img, name: master.name });

    return { masterId: master.id, masterName: master.name, npcId: npc.id };
  });

  // Poll until system.master.id is set
  await page.waitForFunction(
    ({ npcId, masterId }) => game.actors.get(npcId)?.system?.master?.id === masterId,
    ids,
    { timeout: 5_000 }
  );

  const result = await page.evaluate(({ npcId }) => {
    const m = game.actors.get(npcId).system.master;
    if (!m) return null;
    return { id: m.id, img: m.img, name: m.name };
  }, { npcId: ids.npcId });

  expect(result).not.toBeNull();
  expect(result.id).toBe(ids.masterId);
  expect(result.name).toBe(ids.masterName);
  // img should be a defined property (may be empty string or path)
  expect(Object.prototype.hasOwnProperty.call(result, 'img')).toBe(true);
});

// ── 3. Unlinking — _setMaster(null) clears system.master ─────────────────────

test('_setMaster(null) clears npc.system.master', async ({ page }) => {
  // Step 1: create actors and link them
  const ids = await page.evaluate(async () => {
    const master = await Actor.create({ name: 'Master Druid', type: 'character' });
    const npc    = await Actor.create({ name: 'Wolf Companion', type: 'npc' });

    npc._setMaster({ id: master.id, img: master.img, name: master.name });

    return { masterId: master.id, npcId: npc.id };
  });

  // Step 2: wait until the link is confirmed before unlinking
  await page.waitForFunction(
    ({ npcId, masterId }) => game.actors.get(npcId)?.system?.master?.id === masterId,
    ids,
    { timeout: 5_000 }
  );

  // Step 3: unlink
  await page.evaluate(({ npcId }) => {
    game.actors.get(npcId)._setMaster(null);
  }, { npcId: ids.npcId });

  // Step 4: poll until system.master is gone
  await page.waitForFunction(
    ({ npcId }) => {
      const npc = game.actors.get(npcId);
      // `system.-=master: null` removes the key; treat missing / falsy as cleared
      return !npc?.system?.master;
    },
    { npcId: ids.npcId },
    { timeout: 5_000 }
  );

  const masterField = await page.evaluate(({ npcId }) => {
    return game.actors.get(npcId).system.master ?? null;
  }, { npcId: ids.npcId });

  expect(masterField).toBeNull();
});
