'use strict';

/**
 * E2E tests for the Point Buy Calculator dialog.
 *
 * The bug (issue 1635) was that clicking Apply/Submit never persisted ability
 * scores because _updateObject used `data.abilities.*` paths instead of the
 * v13-correct `system.abilities.*` paths.  These tests verify the full flow:
 * opening the dialog, reading default values, adjusting scores, applying, and
 * confirming the actor's system data was actually saved.
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

// ── Helper: create a basic character actor with all abilities at 10 ───────────

async function createBasicCharacter(page, name = 'Point Buy Test Actor') {
  return page.evaluate(async (name) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      system: {
        abilities: {
          str: { value: 10 },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 10 },
          wis: { value: 10 },
          cha: { value: 10 },
        },
      },
    });
    return actor.id;
  }, name);
}

// ── Helper: open the point buy dialog from an actor sheet ─────────────────────
// Returns the Playwright locator for the #pointbuy-calculator app element.

async function openPointBuyDialog(page, sheetId) {
  // The button has class "point-buy" — click it via DOM to fire the registered
  // event listener (same pattern used by the level-up and configure-level tests).
  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} a.point-buy`)?.click();
  }, sheetId);

  const dialog = page.locator('#pointbuy-calculator');
  await dialog.waitFor({ state: 'visible', timeout: 8_000 });
  return dialog;
}

// ── 1. Opening the dialog ──────────────────────────────────────────────────────
//
// Clicking the "Use Point Buy" button on the Attributes tab of a character sheet
// must open the Point Buy Calculator dialog (id="pointbuy-calculator").

test('clicking Use Point Buy opens the Point Buy Calculator dialog', async ({ page }) => {
  const actorId = await createBasicCharacter(page);
  const sheetId = await openSheet(page, actorId);

  // Navigate to the Attributes tab where the button lives
  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} nav.tabs a[data-tab="attributes"]`)?.click();
  }, sheetId);

  await page.locator(`#${sheetId} .tab.attributes`).waitFor({ state: 'visible', timeout: 5_000 });

  const dialog = await openPointBuyDialog(page, sheetId);

  // Dialog should be visible and have the expected title
  await expect(dialog).toBeVisible();
  const title = dialog.locator('.window-title');
  await expect(title).toContainText('Point Buy');
});

// ── 2. Default values ─────────────────────────────────────────────────────────
//
// When the dialog opens it initialises every ability at 10 (regardless of the
// actor's current values — the calculator is a fresh scratch pad).

test('point buy dialog initialises all six ability scores to 10', async ({ page }) => {
  const actorId = await createBasicCharacter(page);
  const sheetId = await openSheet(page, actorId);

  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} nav.tabs a[data-tab="attributes"]`)?.click();
  }, sheetId);
  await page.locator(`#${sheetId} .tab.attributes`).waitFor({ state: 'visible', timeout: 5_000 });

  const dialog = await openPointBuyDialog(page, sheetId);

  // Read all six ability value spans
  const values = await dialog.locator('li.item .ability-value').allInnerTexts();

  expect(values).toHaveLength(6);
  for (const v of values) {
    expect(v.trim()).toBe('10');
  }
});

// ── 3. Adjusting values — increment and decrement ─────────────────────────────
//
// Clicking "+" on an ability row increments its value (capped at 18).
// Clicking "−" decrements (floored at 7).

test('clicking + increments an ability score and clicking - decrements it', async ({ page }) => {
  const actorId = await createBasicCharacter(page);
  const sheetId = await openSheet(page, actorId);

  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} nav.tabs a[data-tab="attributes"]`)?.click();
  }, sheetId);
  await page.locator(`#${sheetId} .tab.attributes`).waitFor({ state: 'visible', timeout: 5_000 });

  const dialog = await openPointBuyDialog(page, sheetId);

  // Target the first ability row (STR)
  const firstRow = dialog.locator('li.item').first();

  // Click + three times → value should become 13
  const addBtn = firstRow.locator('a.ability-control.add');
  await addBtn.click({ force: true });
  await addBtn.click({ force: true });
  await addBtn.click({ force: true });

  // After each render the dialog re-renders; wait for stable DOM
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#pointbuy-calculator li.item:first-child .ability-value');
      return el && el.textContent.trim() === '13';
    },
    { timeout: 5_000 }
  );

  // Now click - once → 12
  const subtractBtn = firstRow.locator('a.ability-control.subtract');
  await subtractBtn.click({ force: true });

  await page.waitForFunction(
    () => {
      const el = document.querySelector('#pointbuy-calculator li.item:first-child .ability-value');
      return el && el.textContent.trim() === '12';
    },
    { timeout: 5_000 }
  );

  const valueText = await dialog.locator('li.item:first-child .ability-value').innerText();
  expect(valueText.trim()).toBe('12');
});

// ── 4. Minimum value floor at 7 ───────────────────────────────────────────────
//
// Clicking "−" when a score is already 7 must not push it below 7.

test('ability score cannot be reduced below 7', async ({ page }) => {
  const actorId = await createBasicCharacter(page);
  const sheetId = await openSheet(page, actorId);

  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} nav.tabs a[data-tab="attributes"]`)?.click();
  }, sheetId);
  await page.locator(`#${sheetId} .tab.attributes`).waitFor({ state: 'visible', timeout: 5_000 });

  const dialog = await openPointBuyDialog(page, sheetId);

  // Starting at 10 — click − 4 times to reach 7, then once more
  const firstRow = dialog.locator('li.item').first();
  const subtractBtn = firstRow.locator('a.ability-control.subtract');

  for (let i = 0; i < 5; i++) {
    await subtractBtn.click({ force: true });
  }

  // Give the dialog time to re-render after the last click
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#pointbuy-calculator li.item:first-child .ability-value');
      return el && parseInt(el.textContent.trim(), 10) <= 7;
    },
    { timeout: 5_000 }
  );

  const valueText = await dialog.locator('li.item:first-child .ability-value').innerText();
  expect(parseInt(valueText.trim(), 10)).toBe(7);
});

// ── 5. Maximum value cap at 18 ────────────────────────────────────────────────
//
// Clicking "+" when a score is already 18 must not push it above 18.

test('ability score cannot be raised above 18', async ({ page }) => {
  const actorId = await createBasicCharacter(page);
  const sheetId = await openSheet(page, actorId);

  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} nav.tabs a[data-tab="attributes"]`)?.click();
  }, sheetId);
  await page.locator(`#${sheetId} .tab.attributes`).waitFor({ state: 'visible', timeout: 5_000 });

  const dialog = await openPointBuyDialog(page, sheetId);

  // Starting at 10 — click + 9 times to reach 18, then one more
  const firstRow = dialog.locator('li.item').first();
  const addBtn = firstRow.locator('a.ability-control.add');

  for (let i = 0; i < 10; i++) {
    await addBtn.click({ force: true });
  }

  await page.waitForFunction(
    () => {
      const el = document.querySelector('#pointbuy-calculator li.item:first-child .ability-value');
      return el && parseInt(el.textContent.trim(), 10) >= 18;
    },
    { timeout: 5_000 }
  );

  const valueText = await dialog.locator('li.item:first-child .ability-value').innerText();
  expect(parseInt(valueText.trim(), 10)).toBe(18);
});

// ── 6. Point cost tracking ────────────────────────────────────────────────────
//
// All scores default to 10 → cost 0 each → total spent = 0.
// Raising STR from 10 to 13 costs 3 points (1 per step from 10 to 13).
// The "Points spent" paragraph in the dialog reflects the running total.

test('points spent counter updates as ability scores change', async ({ page }) => {
  const actorId = await createBasicCharacter(page);
  const sheetId = await openSheet(page, actorId);

  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} nav.tabs a[data-tab="attributes"]`)?.click();
  }, sheetId);
  await page.locator(`#${sheetId} .tab.attributes`).waitFor({ state: 'visible', timeout: 5_000 });

  const dialog = await openPointBuyDialog(page, sheetId);

  // Read the initial "Points spent" text — all at 10, cost per score = 0,
  // total = 0.  The paragraph renders as "<localized label>: <number>".
  const initialPointsText = await dialog.locator('.info p').first().innerText();
  const initialMatch = initialPointsText.match(/(\d+)\s*$/);
  expect(initialMatch).not.toBeNull();
  const initialSpent = parseInt(initialMatch[1], 10);

  // Click + 3 times on the first ability (STR: 10 → 13; each step costs 1 pt)
  const firstRow = dialog.locator('li.item').first();
  const addBtn = firstRow.locator('a.ability-control.add');
  await addBtn.click({ force: true });
  await addBtn.click({ force: true });
  await addBtn.click({ force: true });

  // Wait for the ability display to show 13 (confirms the re-render completed)
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#pointbuy-calculator li.item:first-child .ability-value');
      return el && el.textContent.trim() === '13';
    },
    { timeout: 5_000 }
  );

  // The "Points spent" paragraph must now show a higher number
  const afterPointsText = await dialog.locator('.info p').first().innerText();
  const afterMatch = afterPointsText.match(/(\d+)\s*$/);
  expect(afterMatch).not.toBeNull();
  const spentAfter = parseInt(afterMatch[1], 10);

  // Moving 10→13 adds 3 points of cost (1 each); total must have grown
  expect(spentAfter).toBeGreaterThan(initialSpent);
});

// ── 7. Applying saves ability scores to the actor (regression for issue 1635) ─
//
// This is the core regression test.  The bug was that _updateObject wrote to
// `data.abilities.*` instead of `system.abilities.*`, so the actor was never
// updated.  After the fix, clicking the Submit/Confirm button must persist the
// calculator's values onto the actor's system.abilities.

test('clicking Apply updates the actor system.abilities values (regression #1635)', async ({ page }) => {
  const actorId = await createBasicCharacter(page);
  const sheetId = await openSheet(page, actorId);

  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} nav.tabs a[data-tab="attributes"]`)?.click();
  }, sheetId);
  await page.locator(`#${sheetId} .tab.attributes`).waitFor({ state: 'visible', timeout: 5_000 });

  const dialog = await openPointBuyDialog(page, sheetId);

  // Raise STR (first ability) from 10 → 14 (4 clicks)
  const firstRow = dialog.locator('li.item').first();
  const addBtn = firstRow.locator('a.ability-control.add');
  await addBtn.click({ force: true });
  await addBtn.click({ force: true });
  await addBtn.click({ force: true });
  await addBtn.click({ force: true });

  // Wait for the display to show 14
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#pointbuy-calculator li.item:first-child .ability-value');
      return el && el.textContent.trim() === '14';
    },
    { timeout: 5_000 }
  );

  // Verify first ability key is "str" so we know what to assert on
  const firstAbilityKey = await page.evaluate(() => {
    const row = document.querySelector('#pointbuy-calculator li.item:first-child');
    return row ? row.dataset.ability : null;
  });
  expect(firstAbilityKey).toBe('str');

  // Submit the form — the Confirm button is a <button type="submit">
  const submitBtn = dialog.locator('button[type="submit"][name="submit"]');
  await submitBtn.waitFor({ state: 'visible', timeout: 3_000 });
  await submitBtn.click({ force: true });

  // Dialog should close after submission
  await dialog.waitFor({ state: 'hidden', timeout: 8_000 });

  // Read the actor's STR value back from Foundry — must be 14
  const strValue = await page.evaluate((actorId) => {
    return game.actors.get(actorId)?.system?.abilities?.str?.value ?? null;
  }, actorId);

  expect(strValue).toBe(14);
});

// ── 8. All six abilities are saved, not just the first ────────────────────────
//
// _updateObject iterates all abilities.  Verify that raising DEX alongside STR
// causes both to be persisted correctly.

test('applying saves all modified ability scores, not just the first', async ({ page }) => {
  const actorId = await createBasicCharacter(page);
  const sheetId = await openSheet(page, actorId);

  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} nav.tabs a[data-tab="attributes"]`)?.click();
  }, sheetId);
  await page.locator(`#${sheetId} .tab.attributes`).waitFor({ state: 'visible', timeout: 5_000 });

  const dialog = await openPointBuyDialog(page, sheetId);

  // Determine the order of ability rows so we can click the right ones
  const abilityKeys = await page.evaluate(() => {
    return [...document.querySelectorAll('#pointbuy-calculator li.item')].map(el => el.dataset.ability);
  });

  // We'll raise the ability at index 1 (expected to be DEX) by 2 points (→ 12)
  const dexIndex = abilityKeys.indexOf('dex');
  expect(dexIndex).toBeGreaterThanOrEqual(0);

  const dexRow = dialog.locator('li.item').nth(dexIndex);
  const addBtn = dexRow.locator('a.ability-control.add');
  await addBtn.click({ force: true });
  await addBtn.click({ force: true });

  // Wait for DEX to show 12
  await page.waitForFunction(
    (dexIndex) => {
      const rows = document.querySelectorAll('#pointbuy-calculator li.item');
      const el = rows[dexIndex]?.querySelector('.ability-value');
      return el && el.textContent.trim() === '12';
    },
    dexIndex,
    { timeout: 5_000 }
  );

  // Submit
  const submitBtn = dialog.locator('button[type="submit"][name="submit"]');
  await submitBtn.waitFor({ state: 'visible', timeout: 3_000 });
  await submitBtn.click({ force: true });

  await dialog.waitFor({ state: 'hidden', timeout: 8_000 });

  // Read actor abilities back
  const abilities = await page.evaluate((actorId) => {
    const a = game.actors.get(actorId);
    return {
      str: a?.system?.abilities?.str?.value ?? null,
      dex: a?.system?.abilities?.dex?.value ?? null,
      con: a?.system?.abilities?.con?.value ?? null,
    };
  }, actorId);

  // STR was never touched in this test — should still be 10 (the dialog default)
  expect(abilities.str).toBe(10);
  // DEX was raised by 2 in the calculator → 12
  expect(abilities.dex).toBe(12);
  // CON was never touched → 10
  expect(abilities.con).toBe(10);
});
