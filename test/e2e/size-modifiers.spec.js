'use strict';

/**
 * E2E tests — Size modifiers to AC and attack rolls.
 *
 * SRD: Size affects both attack rolls and AC:
 *   Fine +8, Diminutive +4, Tiny +2, Small +1, Medium ±0,
 *   Large −1, Huge −2, Gargantuan −4, Colossal −8.
 *
 * Implementation:
 *   actorUpdater.js pushes CONFIG.D35E.sizeMods[sizeKey] to "ac" changes
 *   when sizeKey !== "med".
 *   module/item/extensions/rolls.js line 87 sets rollData.sizeBonus from
 *   CONFIG.D35E.sizeMods[rollData.traits.actualSize] and adds @sizeBonus
 *   to the attack roll parts.
 *
 * The base AC for a new character is 10 (no DEX mod, no armor).
 * Small actor: AC = 10 + 1 = 11
 * Large actor: AC = 10 − 1 = 9
 *
 * Size is set via system.traits.size; system.traits.actualSize reflects
 * the effective size after change pipeline.
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

/** Wait until an actor's normal AC total reaches an expected value. */
async function waitForAC(page, actorId, expected) {
  await page.waitForFunction(
    ({ id, exp }) => (game.actors.get(id)?.system?.attributes?.ac?.normal?.total ?? null) === exp,
    { id: actorId, exp: expected },
    { timeout: 10_000 },
  );
}

// ── 1. Small actor → AC +1, attack sizeBonus +1 ──────────────────────────────

test('Small actor has AC 11 (10 + size +1) and sizeBonus +1 for attack rolls', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Small Test', type: 'character' });
    await game.actors.get(actor.id).update({
      'system.abilities.dex.value': 10,  // DEX 10 → +0 mod, no dex to AC
      'system.traits.size': 'sm',
    });
    return actor.id;
  });

  await waitForAC(page, actorId, 11);

  const result = await page.evaluate((id) => {
    const actor = game.actors.get(id);
    const ac = actor.system.attributes.ac.normal.total;
    const actualSize = actor.system.traits.actualSize;
    const sizeBonus = CONFIG.D35E.sizeMods[actualSize] ?? 0;
    return { ac, actualSize, sizeBonus };
  }, actorId);

  expect(result.ac).toBe(11);
  expect(result.actualSize).toBe('sm');
  expect(result.sizeBonus).toBe(1);
});

// ── 2. Large actor → AC −1, attack sizeBonus −1 ──────────────────────────────

test('Large actor has AC 9 (10 − size 1) and sizeBonus −1 for attack rolls', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Large Test', type: 'character' });
    await game.actors.get(actor.id).update({
      'system.abilities.dex.value': 10,
      'system.traits.size': 'lg',
    });
    return actor.id;
  });

  await waitForAC(page, actorId, 9);

  const result = await page.evaluate((id) => {
    const actor = game.actors.get(id);
    const ac = actor.system.attributes.ac.normal.total;
    const actualSize = actor.system.traits.actualSize;
    const sizeBonus = CONFIG.D35E.sizeMods[actualSize] ?? 0;
    return { ac, actualSize, sizeBonus };
  }, actorId);

  expect(result.ac).toBe(9);
  expect(result.actualSize).toBe('lg');
  expect(result.sizeBonus).toBe(-1);
});

// ── 3. Medium actor → AC 10, sizeBonus 0 (no modifier) ───────────────────────

test('Medium actor has AC 10 and sizeBonus 0 (baseline, no modifier)', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Medium Test', type: 'character' });
    await game.actors.get(actor.id).update({
      'system.abilities.dex.value': 10,
      'system.traits.size': 'med',
    });
    return actor.id;
  });

  await waitForAC(page, actorId, 10);

  const result = await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    const ac = actor.system.attributes.ac.normal.total;
    const actualSize = actor.system.traits.actualSize;
    const sizeBonus = CONFIG.D35E.sizeMods[actualSize] ?? 0;
    return { ac, actualSize, sizeBonus };
  }, actorId);

  expect(result.ac).toBe(10);
  expect(result.actualSize).toBe('med');
  expect(result.sizeBonus).toBe(0);
});

// ── 4. Size change updates modifiers dynamically ──────────────────────────────

test('Changing size from Medium to Small dynamically updates AC from 10 to 11', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Size Change Test', type: 'character' });
    await game.actors.get(actor.id).update({
      'system.abilities.dex.value': 10,
      'system.traits.size': 'med',
    });
    return actor.id;
  });

  await waitForAC(page, actorId, 10);

  // Change size to Small
  await page.evaluate(
    ({ id }) => game.actors.get(id).update({ 'system.traits.size': 'sm' }),
    { id: actorId },
  );

  await waitForAC(page, actorId, 11);

  const ac = await page.evaluate(
    ({ id }) => game.actors.get(id).system.attributes.ac.normal.total,
    { id: actorId },
  );
  expect(ac).toBe(11);
});
