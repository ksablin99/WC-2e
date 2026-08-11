'use strict';

/**
 * E2E: combat changes on full attacks (iterative / multi-attack rolls).
 *
 * Covers persistent vs apply-once for all damage field families handled by
 * #appendFeatDamagePartsFromRollData, featAttackBonus, and special-action DSL.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { openSheet } = require('./helpers/actor-sheet');
const {
  BONUS_THRESHOLD,
  NO_BONUS_THRESHOLD,
  createFighterWithLongsword,
  embedFullAttackFeat,
  rollFullAttackWithOptionalFeat,
} = require('./helpers/combat-changes-full-attack');

const SPECIAL_MARKER = 'E2E All Iter Marker';
const SPECIAL_ONCE_MARKER = 'E2E Once Marker Colocated';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

function expectDamageOnAllIteratives(attackDamageTotals) {
  expect(attackDamageTotals.length).toBeGreaterThanOrEqual(2);
  expect(attackDamageTotals[0]).toBeGreaterThan(BONUS_THRESHOLD);
  expect(attackDamageTotals[1]).toBeGreaterThan(BONUS_THRESHOLD);
}

function expectDamageOnlyOnFirst(attackDamageTotals) {
  expect(attackDamageTotals.length).toBeGreaterThanOrEqual(2);
  expect(attackDamageTotals[0]).toBeGreaterThan(BONUS_THRESHOLD);
  expect(attackDamageTotals[1]).toBeLessThan(NO_BONUS_THRESHOLD);
}

function expectAttackOnAllIteratives(attackTotals) {
  expect(attackTotals.length).toBeGreaterThanOrEqual(2);
  expect(attackTotals[0]).toBeGreaterThan(BONUS_THRESHOLD);
  expect(attackTotals[1]).toBeGreaterThan(BONUS_THRESHOLD);
}

function expectAttackOnlyOnFirst(attackTotals) {
  expect(attackTotals.length).toBeGreaterThanOrEqual(2);
  expect(attackTotals[0]).toBeGreaterThan(BONUS_THRESHOLD);
  expect(attackTotals[1]).toBeLessThan(NO_BONUS_THRESHOLD);
}

// ── A. Persistent — bonus on every iterative attack ───────────────────────────

test('persistent featDamageBonus applies to all full-attack iteratives', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: 'E2E Persistent featDamageBonus',
    field: 'featDamageBonus',
  });

  const { attackDamageTotals } = await rollFullAttackWithOptionalFeat(page, { actorId, attackId });
  expectDamageOnAllIteratives(attackDamageTotals);
});

test('persistent &featDamageBonus applies to all full-attack iteratives', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: 'E2E Persistent &featDamageBonus',
    field: '&featDamageBonus',
  });

  const { attackDamageTotals } = await rollFullAttackWithOptionalFeat(page, { actorId, attackId });
  expectDamageOnAllIteratives(attackDamageTotals);
});

test('persistent &featDamage.fire applies to all full-attack iteratives', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: 'E2E Persistent &featDamage.fire',
    field: '&featDamage.fire',
  });

  const { attackDamageTotals } = await rollFullAttackWithOptionalFeat(page, { actorId, attackId });
  expectDamageOnAllIteratives(attackDamageTotals);
});

test('persistent &featDamagePrecision applies to all full-attack iteratives', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: 'E2E Persistent &featDamagePrecision',
    field: '&featDamagePrecision',
  });

  const { attackDamageTotals } = await rollFullAttackWithOptionalFeat(page, { actorId, attackId });
  expectDamageOnAllIteratives(attackDamageTotals);
});

test('persistent featAttackBonus applies to all full-attack iteratives', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: 'E2E Persistent featAttackBonus',
    field: 'featAttackBonus',
  });

  const { attackTotals } = await rollFullAttackWithOptionalFeat(page, { actorId, attackId });
  expectAttackOnAllIteratives(attackTotals);
});

test('persistent all itemType featDamageBonus applies without optional checkbox', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: 'E2E Persistent All featDamageBonus',
    field: 'featDamageBonus',
    itemType: 'all',
  });

  const sheetId = await openSheet(page, actorId);
  const dialog = await page.locator('.dialog.roll-defense').last();
  const attackRow = page.locator(`#${sheetId} li.item[data-item-id="${attackId}"]`);
  await attackRow.locator('a.item-control.item-attack').first().click({ force: true });
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });

  expect(await dialog.locator('input[data-type="optional"]').count()).toBe(0);

  const msgsBefore = await page.evaluate(() => game.messages.size);
  await dialog.locator('button[data-button="multi"]').click({ force: true });
  await page.waitForFunction((before) => game.messages.size > before, msgsBefore, { timeout: 5_000 });

  const { attackDamageTotals } = await page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    const attacks = msg?.flags?.D35E?.chatTemplateData?.attacks ?? [];
    return {
      attackDamageTotals: attacks.map((attack) => attack.damage?.total ?? null),
    };
  });
  expectDamageOnAllIteratives(attackDamageTotals);
});

test('persistent special action DSL appears on every full-attack iterative', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: SPECIAL_MARKER,
    field: 'featAttackBonus',
    formula: '1',
    specialAction: `Create unique "${SPECIAL_MARKER}" on self`,
  });

  const { attackCount, specialLabels } = await rollFullAttackWithOptionalFeat(page, { actorId, attackId });
  expect(attackCount).toBeGreaterThanOrEqual(2);
  expect(specialLabels.filter((label) => label === SPECIAL_MARKER).length).toBe(attackCount);
});

// ── B. Apply-once — bonus only on first iterative ─────────────────────────────

test('apply-once featAttackBonus only on first full-attack iterative', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: 'E2E Apply Once featAttackBonus',
    field: 'featAttackBonus',
    applyOnce: true,
  });

  const { attackTotals } = await rollFullAttackWithOptionalFeat(page, { actorId, attackId });
  expectAttackOnlyOnFirst(attackTotals);
});

test('apply-once &featDamageBonus only on first full-attack iterative', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: 'E2E Apply Once &featDamageBonus',
    field: '&featDamageBonus',
    applyOnce: true,
  });

  const { attackDamageTotals } = await rollFullAttackWithOptionalFeat(page, { actorId, attackId });
  expectDamageOnlyOnFirst(attackDamageTotals);
});

test('apply-once &featDamage.fire only on first full-attack iterative', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: 'E2E Apply Once &featDamage.fire',
    field: '&featDamage.fire',
    applyOnce: true,
  });

  const { attackDamageTotals } = await rollFullAttackWithOptionalFeat(page, { actorId, attackId });
  expectDamageOnlyOnFirst(attackDamageTotals);
});

test('apply-once &featDamagePrecision only on first full-attack iterative', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: 'E2E Apply Once &featDamagePrecision',
    field: '&featDamagePrecision',
    applyOnce: true,
  });

  const { attackDamageTotals } = await rollFullAttackWithOptionalFeat(page, { actorId, attackId });
  expectDamageOnlyOnFirst(attackDamageTotals);
});

test('apply-once special action DSL only on first full-attack iterative', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: SPECIAL_ONCE_MARKER,
    field: 'featAttackBonus',
    formula: '1',
    specialAction: `Create unique "${SPECIAL_ONCE_MARKER}" on self`,
    applyOnce: true,
  });

  const { specialLabels } = await rollFullAttackWithOptionalFeat(page, { actorId, attackId });
  expect(specialLabels.filter((label) => label === SPECIAL_ONCE_MARKER).length).toBe(1);
});

// ── C. Negative control ───────────────────────────────────────────────────────

test('optional feat unchecked: no bonus on any full-attack iterative', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedFullAttackFeat(page, {
    actorId,
    name: 'E2E Unchecked Optional Damage',
    field: 'featDamageBonus',
  });

  const { attackDamageTotals } = await rollFullAttackWithOptionalFeat(page, {
    actorId,
    attackId,
    checkOptional: false,
  });
  expect(attackDamageTotals.length).toBeGreaterThanOrEqual(2);
  expect(attackDamageTotals[0]).toBeLessThan(NO_BONUS_THRESHOLD);
  expect(attackDamageTotals[1]).toBeLessThan(NO_BONUS_THRESHOLD);
});
