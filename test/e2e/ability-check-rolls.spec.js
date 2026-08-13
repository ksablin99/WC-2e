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
const { openSheet } = require('./helpers/actor-sheet');

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

test('clicking an ability name on the character sheet posts the ability check', async ({ page }) => {
  const { actorId, mods } = await createActorWithAbilities(page, { str: 16 }, 'Sheet Ability Click Test');
  const sheetId = await openSheet(page, actorId);
  const messagesBefore = await page.evaluate(() => game.messages.size);
  const pageErrors = [];
  const invalidFlagScopeErrors = [];

  // Install listeners after setup so failures are attributable to the sheet
  // click and ensuing ChatMessage render, not unrelated world initialization.
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/invalid.{0,40}(flag )?scope|flag scope.{0,40}(invalid|D35E)|scope.{0,40}D35E/i.test(text)) {
      invalidFlagScopeErrors.push(text);
    }
  });

  await page.locator(`#${sheetId} [data-ability="str"] .ability-name`).first().click();
  await page.waitForFunction((count) => game.messages.size > count, messagesBefore, { timeout: 8_000 });

  const message = await page.evaluate(() => {
    const chatMessage = game.messages.contents.at(-1);
    return {
      id: chatMessage?.id ?? null,
      total: chatMessage?.rolls?.[0]?.total ?? null,
      hasLegacyScope: Object.hasOwn(chatMessage?.flags ?? {}, 'D35E'),
    };
  });
  expect(message.id).not.toBeNull();
  expect(message.total).not.toBeNull();
  expect(message.total).toBeGreaterThanOrEqual(1 + mods.str);
  expect(message.total).toBeLessThanOrEqual(20 + mods.str);
  expect(message.hasLegacyScope).toBe(false);

  // A ChatMessage document alone is insufficient: the original regression
  // created the document but crashed while rendering it into the sidebar.
  // Foundry v14 chat templates use `.chat-log`; the old `#chat-log` id no
  // longer exists (templates/sidebar/tabs/chat/log.hbs).
  const renderedMessage = page.locator(`.chat-log [data-message-id="${message.id}"]`).first();
  await expect(renderedMessage).toBeVisible({ timeout: 8_000 });
  await expect(renderedMessage.locator('.D35E.chat-card')).toBeVisible();
  await expect(renderedMessage).toContainText('Strength Ability Test');
  await expect(renderedMessage.locator('.dice-total')).toHaveText(String(message.total));

  expect(pageErrors, 'Ability-check chat rendering emitted a page error').toEqual([]);
  expect(invalidFlagScopeErrors, 'Ability-check chat rendering used an invalid flag scope').toEqual([]);
});
