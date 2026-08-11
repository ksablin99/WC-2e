'use strict';

/**
 * E2E tests for actor.rollAbility(abilityId).
 *
 * SRD 3.5e rule: Ability check = 1d20 + ability modifier.
 * Possible range = [1 + mod, 20 + mod].
 *
 * rollAbility delegates to rollAbilityTest which calls DicePF.d20Roll with
 * fastForward=true (default), so no dialog is opened — the roll resolves
 * immediately and posts a chat message using the roll-ext.html template.
 *
 * Covers:
 *   1. STR 16 (+3): total in [4, 23]
 *   2. DEX  8 (−1): total in [0, 19]
 *   3. INT 14 (+2): total in [3, 22]
 *   4. WIS 10 (±0): total in [1, 20]
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: create a character and set specific ability scores ────────────────

/**
 * Create a character actor and update the provided ability scores.
 * Returns the actor id and the computed ability modifiers.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} abilities  Map of abilityId → score value, e.g. { str: 16 }
 * @param {string} [name]
 * @returns {Promise<{ actorId: string, mods: Record<string,number> }>}
 */
async function createActorWithAbilities(page, abilities, name = 'Ability Roll Test') {
  return page.evaluate(async ({ abilities, name }) => {
    const actor = await Actor.create({ name, type: 'character' });
    const updateData = {};
    for (const [id, value] of Object.entries(abilities)) {
      updateData[`system.abilities.${id}.value`] = value;
    }
    await actor.update(updateData);
    const a = game.actors.get(actor.id);
    const mods = {};
    for (const id of Object.keys(abilities)) {
      mods[id] = a.system.abilities[id].mod;
    }
    return { actorId: a.id, mods };
  }, { abilities, name });
}

/**
 * Call actor.rollAbility(abilityId), wait for a new chat message, and return
 * the roll total from msg.rolls[0].total (the roll is embedded in the message
 * because d20Roll merges roll.toMessage({create:false}) into chatData).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} actorId
 * @param {string} abilityId
 * @returns {Promise<number>}
 */
async function rollAbilityAndGetTotal(page, actorId, abilityId) {
  const msgsBefore = await page.evaluate(() => game.messages.size);

  // rollAbilityTest uses fastForward=true so no dialog opens — fire and forget
  page.evaluate(
    ({ actorId, abilityId }) => {
      game.actors.get(actorId).rollAbility(abilityId).catch(() => {});
    },
    { actorId, abilityId },
  ).catch(() => {});

  // Wait for a new chat message to appear
  await page.waitForFunction((c) => game.messages.size > c, msgsBefore, {
    timeout: 8_000,
  });

  return page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    // The roll is embedded via roll.toMessage({create:false}) merge
    return msg?.rolls?.[0]?.total ?? null;
  });
}

// ── 1. STR 16 (+3): total in [4, 23] ─────────────────────────────────────────

test('STR 16 ability check total is in range [4, 23]', async ({ page }) => {
  const { actorId, mods } = await createActorWithAbilities(page, { str: 16 });

  // Sanity: STR 16 should give mod +3
  expect(mods.str).toBe(3);

  const total = await rollAbilityAndGetTotal(page, actorId, 'str');

  expect(total).not.toBeNull();
  expect(total).toBeGreaterThanOrEqual(1 + mods.str); // 4
  expect(total).toBeLessThanOrEqual(20 + mods.str);   // 23
});

// ── 2. DEX 8 (−1): total in [0, 19] ──────────────────────────────────────────

test('DEX 8 ability check total is in range [0, 19]', async ({ page }) => {
  const { actorId, mods } = await createActorWithAbilities(page, { dex: 8 });

  // Sanity: DEX 8 should give mod −1
  expect(mods.dex).toBe(-1);

  const total = await rollAbilityAndGetTotal(page, actorId, 'dex');

  expect(total).not.toBeNull();
  expect(total).toBeGreaterThanOrEqual(1 + mods.dex); // 0
  expect(total).toBeLessThanOrEqual(20 + mods.dex);   // 19
});

// ── 3. INT 14 (+2): total in [3, 22] ─────────────────────────────────────────

test('INT 14 ability check total is in range [3, 22]', async ({ page }) => {
  const { actorId, mods } = await createActorWithAbilities(page, { int: 14 });

  // Sanity: INT 14 should give mod +2
  expect(mods.int).toBe(2);

  const total = await rollAbilityAndGetTotal(page, actorId, 'int');

  expect(total).not.toBeNull();
  expect(total).toBeGreaterThanOrEqual(1 + mods.int); // 3
  expect(total).toBeLessThanOrEqual(20 + mods.int);   // 22
});

// ── 4. WIS 10 (±0): total in [1, 20] ─────────────────────────────────────────

test('WIS 10 ability check total is in range [1, 20]', async ({ page }) => {
  const { actorId, mods } = await createActorWithAbilities(page, { wis: 10 });

  // Sanity: WIS 10 should give mod 0
  expect(mods.wis).toBe(0);

  const total = await rollAbilityAndGetTotal(page, actorId, 'wis');

  expect(total).not.toBeNull();
  expect(total).toBeGreaterThanOrEqual(1 + mods.wis); // 1
  expect(total).toBeLessThanOrEqual(20 + mods.wis);   // 20
});
