'use strict';

/**
 * E2E tests for temporary hit points (temp HP).
 *
 * D35E temp HP mechanics (from ActorDamageHelper.applyDamage):
 *   - `system.attributes.hp.temp` holds the temp HP pool.
 *   - Damage is absorbed from temp HP before reducing main HP.
 *   - Temp HP is NOT restored by rest — it must be reapplied.
 *   - A buff with `temp` changeTarget grants temp HP when activated.
 *
 * Covers:
 *   1. Setting temp HP directly via actor.update().
 *   2. Damage consumes temp HP before main HP.
 *   3. Damage overflow reduces main HP after temp HP is exhausted.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── 1. Temp HP can be set via actor update ────────────────────────────────────

test('setting temp HP directly via update is readable on actor', async ({ page }) => {
  const temp = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Temp HP Set Actor',
      type: 'character',
      system: { attributes: { hp: { value: 20, max: 20, temp: 0 } } },
    });
    await actor.update({ 'system.attributes.hp.temp': 15 });
    return game.actors.get(actor.id).system.attributes.hp.temp;
  });

  expect(temp).toBe(15);
});

// ── 2. Damage absorbs temp HP before main HP ─────────────────────────────────

test('damage absorbs temp HP before reducing main HP', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Temp HP Absorb Actor',
      type: 'character',
      system: { attributes: { hp: { value: 20, max: 20, temp: 10 } } },
    });

    await game.D35E.ActorPF.applyDamage(
      null, 100, null, false, false, false, false,
      7, 7, null, null, 0, false, true,
      game.actors.get(actor.id),
    );

    const a = game.actors.get(actor.id);
    return { hp: a.system.attributes.hp.value, temp: a.system.attributes.hp.temp };
  });

  expect(result.temp).toBe(3);   // 10 - 7 = 3
  expect(result.hp).toBe(20);    // main HP untouched
});

// ── 3. Damage overflow reduces main HP after temp HP exhausted ────────────────

test('damage exceeding temp HP reduces main HP by the overflow', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Temp HP Overflow Actor',
      type: 'character',
      system: { attributes: { hp: { value: 20, max: 20, temp: 5 } } },
    });

    await game.D35E.ActorPF.applyDamage(
      null, 100, null, false, false, false, false,
      12, 12, null, null, 0, false, true,
      game.actors.get(actor.id),
    );

    const a = game.actors.get(actor.id);
    return { hp: a.system.attributes.hp.value, temp: a.system.attributes.hp.temp };
  });

  expect(result.temp).toBe(0);    // temp HP fully consumed
  expect(result.hp).toBe(13);     // 20 - (12 - 5) = 20 - 7 = 13
});

// ── 4. Temp HP is independent of main HP pool ─────────────────────────────────

test('setting temp HP does not affect main HP value', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Temp HP Independent Actor',
      type: 'character',
      system: { attributes: { hp: { value: 20, max: 20, temp: 0 } } },
    });
    await game.actors.get(actor.id).update({ 'system.attributes.hp.temp': 10 });
    const a = game.actors.get(actor.id);
    return { hp: a.system.attributes.hp.value, temp: a.system.attributes.hp.temp };
  });

  expect(result.temp).toBe(10);
  expect(result.hp).toBe(20); // main HP unchanged
});
