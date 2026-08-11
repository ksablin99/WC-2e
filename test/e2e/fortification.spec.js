'use strict';

/**
 * E2E tests — Fortification (critical hit negation).
 *
 * SRD: Fortification armor gives a % chance to negate a critical hit,
 * treating it as a normal hit instead.
 *
 * Implementation: actorDamageHelper.js lines 155–166 roll 1d100 when
 * `system.attributes.fortification.total > 0`.  If roll ≤ total the
 * crit flag is cleared and normalDamage is applied instead of damage.
 *
 * fortification.total is seeded from system.attributes.fortification.value
 * (actorUpdater.js line 1662) and can be boosted by changes/buffs.
 *
 * Test strategy:
 *   - Set fortification.value = 100 → 1d100 always ≤ 100 → crit always negated.
 *   - Set fortification.value = 0   → no roll → crit damage applied.
 *   - Pass ev = { shiftKey: true } to applyDamage → skips AC dialog (noCheck=true).
 *   - Pass critroll = 25 → with noCheck=true crit=true before fortify check.
 *   - damage (crit roll array) total = 20, normalDamage total = 10.
 *     HP reduction of 10 = fortify succeeded; 20 = fortify absent.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await page.waitForFunction(() => typeof game !== 'undefined' && game.ready === true, {
    timeout: 15_000,
  });
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

/** Create an actor with known HP and fortification value, return id. */
async function createActorWithFortification(page, fortValue, name) {
  return page.evaluate(
    async ({ fortValue, name }) => {
      const actor = await Actor.create({ name, type: 'character' });
      await game.actors.get(actor.id).update({
        'system.attributes.hp.value': 50,
        'system.attributes.hp.base': 50,
        'system.attributes.fortification.value': fortValue,
      });
      return actor.id;
    },
    { fortValue, name },
  );
}

/** Wait until fortification.total settles at expected value. */
async function waitForFortTotal(page, actorId, expected) {
  await page.waitForFunction(
    ({ id, exp }) => (game.actors.get(id)?.system?.attributes?.fortification?.total ?? -1) === exp,
    { id: actorId, exp: expected },
    { timeout: 10_000 },
  );
}

// ── 1. fortification = 100 always negates crit → normal damage applied ─────────

test('fortification 100% always negates crit — applies normal damage', async ({ page }) => {
  const actorId = await createActorWithFortification(page, 100, 'Fort 100 Test');
  await waitForFortTotal(page, actorId, 100);

  const result = await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    const beforeHp = actor.system.attributes.hp.value;

    // ev.shiftKey=true → noCheck=true (skips AC dialog); critroll=25 + noCheck → crit=true before fortify
    const fakeEv = { shiftKey: true, preventDefault: () => {} };
    await game.D35E.ActorDamageHelper.applyDamage(
      fakeEv,
      25,           // roll (hits)
      25,           // critroll
      false,        // natural20
      false,        // natural20Crit
      false,        // fumble
      false,        // fumble20Crit
      [{ damageTypeUid: 'damage-slashing', roll: { total: 20 } }],  // crit damage
      [{ damageTypeUid: 'damage-slashing', roll: { total: 10 } }],  // normal damage
      null,         // material
      null,         // alignment
      0,            // enh
      0,            // nonLethalDamage
      false,        // simpleDamage
      actor,        // pass actor directly (no token targeting)
    );

    // Wait for HP update to propagate
    await new Promise(r => setTimeout(r, 300));
    const afterHp = game.actors.get(id).system.attributes.hp.value;
    return { beforeHp, afterHp, dmgTaken: beforeHp - afterHp };
  }, actorId);

  // Fortification succeeded — normal damage (10) applied, not crit damage (20)
  expect(result.dmgTaken).toBe(10);
});

// ── 2. fortification = 0 does NOT negate crit → crit damage applied ───────────

test('fortification 0% does not negate crit — applies crit damage', async ({ page }) => {
  const actorId = await createActorWithFortification(page, 0, 'Fort 0 Test');
  await waitForFortTotal(page, actorId, 0);

  const result = await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    const beforeHp = actor.system.attributes.hp.value;

    const fakeEv = { shiftKey: true, preventDefault: () => {} };
    await game.D35E.ActorDamageHelper.applyDamage(
      fakeEv,
      25,
      25,
      false,
      false,
      false,
      false,
      [{ damageTypeUid: 'damage-slashing', roll: { total: 20 } }],  // crit damage
      [{ damageTypeUid: 'damage-slashing', roll: { total: 10 } }],  // normal damage
      null,
      null,
      0,
      0,
      false,
      actor,
    );

    await new Promise(r => setTimeout(r, 300));
    const afterHp = game.actors.get(id).system.attributes.hp.value;
    return { beforeHp, afterHp, dmgTaken: beforeHp - afterHp };
  }, actorId);

  // No fortification — crit damage (20) applied
  expect(result.dmgTaken).toBe(20);
});

// ── 3. fortification.total is boosted by setting fortification.value ──────────

test('setting fortification.value stores correctly in fortification.total', async ({ page }) => {
  const actorId = await createActorWithFortification(page, 50, 'Fort 50 Test');
  await waitForFortTotal(page, actorId, 50);

  const total = await page.evaluate(
    ({ id }) => game.actors.get(id)?.system?.attributes?.fortification?.total,
    { id: actorId },
  );
  expect(total).toBe(50);
});
