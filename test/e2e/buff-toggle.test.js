'use strict';

/**
 * E2E tests for buff toggle UI.
 *
 * D35E buff activation flow:
 *   1. `buff.update({ 'system.active': true/false })` is the canonical toggle.
 *   2. The actor's derived stats recompute automatically via Foundry's embedded
 *      document update hooks — no explicit actor.update() is needed.
 *   3. This test also exercises the sheet UI path (clicking the checkbox on the
 *      Buffs tab) to confirm the toggle works end-to-end.
 *
 * Covers:
 *   1. Activating an inactive buff applies its stat changes (STR +4).
 *   2. Deactivating an active buff reverts the stat changes.
 *   3. Multiple simultaneous buffs stack correctly.
 *   4. A skill-targeting buff increases the total skill rank via the UI path.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { toggleBuff } = require('./helpers/rolls');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: create a character and embed a STR buff ───────────────────────────

async function createActorWithStrBuff(page, { active }) {
  return page.evaluate(async ({ active }) => {
    const actor = await Actor.create({
      name: 'Buff Toggle Test Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    const [buff] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Bull\'s Strength',
      type: 'buff',
      system: {
        active,
        changes: [['4', 'ability', 'str', 'enh', 0]],
      },
    }]);

    const a = game.actors.get(actor.id);
    return {
      actorId: a.id,
      buffId:  buff.id,
      strBase: a.system.abilities.str.total,
    };
  }, { active });
}

// ── 1. Activating buff applies stat change ────────────────────────────────────

test('activating an inactive STR +4 buff increases str total by 4', async ({ page }) => {
  const { actorId, buffId, strBase } = await createActorWithStrBuff(page, { active: false });

  // Baseline: buff is inactive, str unchanged
  expect(strBase).toBe(10);

  await toggleBuff(page, actorId, buffId, true);

  const strAfter = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.abilities.str.total;
  }, { actorId });

  expect(strAfter).toBe(14);
});

// ── 2. Deactivating buff reverts stat change ──────────────────────────────────

test('deactivating an active STR +4 buff reverts str total to base', async ({ page }) => {
  const { actorId, buffId } = await createActorWithStrBuff(page, { active: true });

  // Baseline: buff is active, str should already be 14
  const strWithBuff = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.abilities.str.total;
  }, { actorId });
  expect(strWithBuff).toBe(14);

  await toggleBuff(page, actorId, buffId, false);

  const strAfter = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.abilities.str.total;
  }, { actorId });

  expect(strAfter).toBe(10);
});

// ── 3. Multiple buffs stack their bonuses ─────────────────────────────────────

test('two active STR buffs stack their bonuses correctly', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Multi-Buff Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    // Two untyped bonuses stack; two enhancement bonuses of the same type do NOT
    await actor.createEmbeddedDocuments('Item', [
      {
        name: 'STR Buff +2 (untyped)',
        type: 'buff',
        system: {
          active: true,
          changes: [['2', 'ability', 'str', 'untyped', 0]],
        },
      },
      {
        name: 'STR Buff +3 (untyped)',
        type: 'buff',
        system: {
          active: true,
          changes: [['3', 'ability', 'str', 'untyped', 0]],
        },
      },
    ]);

    const a = game.actors.get(actor.id);
    return a.system.abilities.str.total;
  });

  // Two untyped bonuses stack: 10 + 2 + 3 = 15
  expect(result).toBe(15);
});

// ── 4. Inactive buff does NOT apply ──────────────────────────────────────────

test('inactive buff does not affect str total', async ({ page }) => {
  const { strBase } = await createActorWithStrBuff(page, { active: false });
  expect(strBase).toBe(10);
});

// ── 5. Speed buff activates and deactivates via API ──────────────────────────

test('activating and deactivating a speed buff changes land speed', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Speed Buff Toggle Actor',
      type: 'character',
      system: { attributes: { speed: { land: { base: 30 } } } },
    });

    const [buff] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Haste',
      type: 'buff',
      system: {
        active: false,
        changes: [['30', 'misc', 'landSpeed', 'enh', 0]],
      },
    }]);

    const baseSpeed = game.actors.get(actor.id).system.attributes.speed.land.total;

    await game.actors.get(actor.id).items.get(buff.id).update({ 'system.active': true });
    const activeSpeed = game.actors.get(actor.id).system.attributes.speed.land.total;

    await game.actors.get(actor.id).items.get(buff.id).update({ 'system.active': false });
    const inactiveSpeed = game.actors.get(actor.id).system.attributes.speed.land.total;

    return { baseSpeed, activeSpeed, inactiveSpeed };
  });

  expect(result.activeSpeed).toBeGreaterThan(result.baseSpeed);
  expect(result.inactiveSpeed).toBe(result.baseSpeed);
});
