'use strict';

/**
 * E2E attributes tests — verify that actor changes (buffs/equipment) apply
 * correctly and that ability scores update and persist.
 *
 * Covers issue #1588: `rollData.data` was changed to `rollData.system` in
 * actorUpdater.js#applyChanges (line 1290).  Using `.data` caused
 * `curData.attributes` / `curData.skills` to be undefined, silently crashing
 * the entire `updateChanges` call so no changes were ever written.
 *
 * Change array format (raw): [formula, subTarget, changeTarget, modifier, value]
 *   [0] formula  — roll formula string
 *   [1] subTarget — grouping (e.g. "misc")
 *   [2] changeTarget — key passed to ActorChangesHelper.getChangeFlat
 *   [3] modifier  — bonus type ("untyped", "enhancement", …)
 *   [4] value     — evaluated at runtime, set to 0 on creation
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


// ── 1. Speed buff applies correctly ──────────────────────────────────────────

test('active buff with landSpeed change increases actor land speed total', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Speed Buff Actor',
      type: 'character',
      system: {
        abilities: { str: { value: 10 }, dex: { value: 10 } },
        attributes: { speed: { land: { base: 30 } } },
      },
    });

    // Capture base speed before buff
    const baseLand = game.actors.get(actor.id).system.attributes.speed.land.total;

    await actor.createEmbeddedDocuments('Item', [{
      name: 'Haste Buff',
      type: 'buff',
      system: {
        active: true,
        // raw change: [formula, subTarget, changeTarget, modifier, value]
        changes: [['10', 'misc', 'landSpeed', 'untyped', 0]],
      },
    }]);

    const fresh = game.actors.get(actor.id);
    return {
      base: baseLand,
      total: fresh.system.attributes.speed.land.total,
    };
  });

  // The buff adds 10 ft, so total must be strictly greater than base
  expect(result.total).toBeGreaterThan(result.base);
  expect(result.total).toBe(result.base + 10);
});


// ── 2. Inactive buff does NOT apply ──────────────────────────────────────────

test('inactive buff with landSpeed change does not affect actor land speed', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Inactive Buff Actor',
      type: 'character',
      system: {
        abilities: { str: { value: 10 }, dex: { value: 10 } },
        attributes: { speed: { land: { base: 30 } } },
      },
    });

    const baseLand = game.actors.get(actor.id).system.attributes.speed.land.total;

    await actor.createEmbeddedDocuments('Item', [{
      name: 'Inactive Speed Buff',
      type: 'buff',
      system: {
        active: false,
        changes: [['10', 'misc', 'landSpeed', 'untyped', 0]],
      },
    }]);

    const fresh = game.actors.get(actor.id);
    return {
      base: baseLand,
      total: fresh.system.attributes.speed.land.total,
    };
  });

  expect(result.total).toBe(result.base);
});


// ── 3. Ability score update persists ─────────────────────────────────────────

test('updating STR to 14 persists and yields +2 modifier', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'STR Update Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    await actor.update({ 'system.abilities.str.value': 14 });

    const fresh = game.actors.get(actor.id);
    return {
      value: fresh.system.abilities.str.value,
      mod:   fresh.system.abilities.str.mod,
    };
  });

  expect(result.value).toBe(14);
  expect(result.mod).toBe(2);
});


// ── 4. Race item change grants STR bonus ─────────────────────────────────────
//
// Race items always have their changes applied (no equipped/active condition).
// This tests that a non-buff item's changes also go through the fixed code path.

test('race item with STR change increases str total', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'STR Race Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    const baseStr = game.actors.get(actor.id).system.abilities.str.total;

    await actor.createEmbeddedDocuments('Item', [{
      name: 'Half-Orc',
      type: 'race',
      system: {
        changes: [['2', 'misc', 'str', 'racial', 0]],
      },
    }]);

    const fresh = game.actors.get(actor.id);
    return {
      base:  baseStr,
      total: fresh.system.abilities.str.total,
    };
  });

  expect(result.total).toBeGreaterThan(result.base);
  expect(result.total).toBe(result.base + 2);
});


// ── 5. Skills change does not crash updateChanges ────────────────────────────
//
// The `skills` changeTarget iterates over `curData.skills` inside
// ActorChangesHelper.getChangeFlat.  Before the fix, curData came from
// rollData.data (undefined in v13), causing a crash.  A successful run with
// no console errors confirms the fix.

test('buff targeting skills changeTarget does not crash updateChanges', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Skills Change Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    await actor.createEmbeddedDocuments('Item', [{
      name: 'Skill Buff',
      type: 'buff',
      system: {
        active: true,
        changes: [['2', 'misc', 'skills', 'untyped', 0]],
      },
    }]);

    // If updateChanges crashed, the actor would still exist but changes
    // would not be applied.  We simply check the actor is still readable.
    const fresh = game.actors.get(actor.id);
    return { actorId: fresh.id, hasSystem: fresh.system != null };
  });

  expect(result.hasSystem).toBe(true);

  // No TypeError / "Cannot read properties of undefined" errors expected
  const crashErrors = consoleErrors.filter(e =>
    e.includes('Cannot read properties of undefined') ||
    e.includes('curData') ||
    e.includes('TypeError')
  );
  expect(crashErrors).toHaveLength(0);
});
