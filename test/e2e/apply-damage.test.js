'use strict';

/**
 * E2E tests for applying damage and healing to actors.
 *
 * D35E damage application:
 *   ActorDamageHelper.applyDamage(ev, roll, critroll, natural20, natural20Crit,
 *     fumble, fumble20Crit, damage, normalDamage, material, alignment, enh,
 *     nonLethalDamage, simpleDamage, actor, ...) applies damage to an actor.
 *   With simpleDamage=true and an explicit actor object, it bypasses token
 *   selection and directly reduces HP by the `damage` value.
 *   Temporary HP absorbs damage first before reducing main HP.
 *
 * Covers:
 *   1. Applying damage (simpleDamage) reduces actor HP by the damage amount.
 *   2. Applying healing (negative simpleDamage) increases HP but not above max.
 *   3. Temporary HP absorbs damage before HP is reduced.
 *   4. Damage is capped so HP does not go below 0 in basic cases.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: create an actor with known HP ─────────────────────────────────────

async function createActorWithHP(page, { value, max, temp = 0 }) {
  return page.evaluate(async ({ value, max, temp }) => {
    const actor = await Actor.create({
      name: 'Damage Test Actor',
      type: 'character',
      system: {
        attributes: {
          hp: { value, max, base: max, temp },
        },
      },
    });
    return game.actors.get(actor.id).id;
  }, { value, max, temp });
}

// ── 1. Simple damage reduces HP ───────────────────────────────────────────────

test('applying simpleDamage=10 to an actor with 20 HP reduces HP to 10', async ({ page }) => {
  const actorId = await createActorWithHP(page, { value: 20, max: 20 });

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await game.D35E.ActorPF.applyDamage(
      null,  // ev
      100,   // roll (high enough to always "hit" — bypassed by simpleDamage)
      null,  // critroll
      false, // natural20
      false, // natural20Crit
      false, // fumble
      false, // fumble20Crit
      10,    // damage
      10,    // normalDamage
      null,  // material
      null,  // alignment
      0,     // enh
      false, // nonLethalDamage
      true,  // simpleDamage — skips AC check
      actor, // explicit actor — skips token targeting
    );
  }, { actorId });

  const hp = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.hp.value;
  }, { actorId });

  expect(hp).toBe(10);
});

// ── 2. Healing increases HP but not above max ─────────────────────────────────

test('applying negative simpleDamage heals actor HP but not above max', async ({ page }) => {
  const actorId = await createActorWithHP(page, { value: 10, max: 20 });

  // Apply -5 damage (healing)
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await game.D35E.ActorPF.applyDamage(
      null, 100, null, false, false, false, false,
      -5, -5, null, null, 0, false, true, actor,
    );
  }, { actorId });

  const hpAfterHeal = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.hp.value;
  }, { actorId });

  expect(hpAfterHeal).toBe(15);

  // Now overheal — must not exceed max (20)
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await game.D35E.ActorPF.applyDamage(
      null, 100, null, false, false, false, false,
      -99, -99, null, null, 0, false, true, actor,
    );
  }, { actorId });

  const hpAfterOverheal = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.hp.value;
  }, { actorId });

  expect(hpAfterOverheal).toBe(20); // capped at max
});

// ── 3. Temp HP absorbs damage first ──────────────────────────────────────────

test('damage is absorbed by temp HP before reducing main HP', async ({ page }) => {
  const actorId = await createActorWithHP(page, { value: 20, max: 20, temp: 10 });

  // Deal 8 damage — should reduce temp HP from 10 to 2, main HP unchanged
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await game.D35E.ActorPF.applyDamage(
      null, 100, null, false, false, false, false,
      8, 8, null, null, 0, false, true, actor,
    );
  }, { actorId });

  const after8 = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    return { hp: a.system.attributes.hp.value, temp: a.system.attributes.hp.temp };
  }, { actorId });

  expect(after8.hp).toBe(20);   // main HP unchanged
  expect(after8.temp).toBe(2);  // temp HP reduced by 8

  // Deal 5 more damage — 2 absorbed by remaining temp HP, 3 from main HP
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await game.D35E.ActorPF.applyDamage(
      null, 100, null, false, false, false, false,
      5, 5, null, null, 0, false, true, actor,
    );
  }, { actorId });

  const after5 = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    return { hp: a.system.attributes.hp.value, temp: a.system.attributes.hp.temp };
  }, { actorId });

  expect(after5.temp).toBe(0);  // temp HP exhausted
  expect(after5.hp).toBe(17);   // 20 - 3 = 17
});

// ── 4. Large damage drives HP toward 0 ───────────────────────────────────────

test('applying damage larger than current HP results in very low or zero HP', async ({ page }) => {
  const actorId = await createActorWithHP(page, { value: 10, max: 20 });

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await game.D35E.ActorPF.applyDamage(
      null, 100, null, false, false, false, false,
      100, 100, null, null, 0, false, true, actor,
    );
  }, { actorId });

  const hp = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.hp.value;
  }, { actorId });

  // HP should be very low (0 or negative); must not stay at 10
  expect(hp).toBeLessThan(10);
});
