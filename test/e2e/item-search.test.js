'use strict';

/**
 * E2E tests for the Add Item overlay search bar (issue 1589).
 *
 * The bug: _filterData() used document.querySelector('#uuid-...') which fails
 * when the UUID starts with a digit (invalid CSS selector for an id that starts
 * with a digit).  The fix uses document.getElementById() instead.
 *
 * NOTE: The randomUuid is a v4 UUID which can start with a hex digit (0-9).
 * Playwright's page.locator('#..') also uses CSS selectors and would break.
 * All DOM queries that involve the uuid-based ids must go through
 * page.evaluate() or page.waitForFunction() so that getElementById() is used.
 *
 * Tests:
 *   1. Opening the Add Item overlay from the Inventory tab shows the search input
 *      and a populated item list.
 *   2. Typing in the search input filters visible items to only those matching
 *      the search term — without throwing a console error.
 *   3. Clearing the search input (setting value to '') restores all items.
 *   4. The search also works when opened from the Features (feats) tab.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

// ── beforeEach ────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Shared helper: create a minimal character actor and open its sheet ─────────

async function createActorAndOpenSheet(page, name = 'Search Test Actor') {
  const actorId = await page.evaluate(async (name) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });
    return actor.id;
  }, name);

  await dismissOverlays(page);

  const sheetId = await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    const app   = actor.sheet;
    await app.render(true);
    await new Promise(r => setTimeout(r, 500));
    return app.id;
  }, actorId);

  // sheetId is safe for CSS (e.g. "ActorSheetPFCharacter-Actor-AbCdEf123")
  await page.locator(`#${sheetId}`).waitFor({ state: 'visible', timeout: 10_000 });
  await dismissOverlays(page);

  return { actorId, sheetId };
}

// ── Shared helper: navigate a sheet to a named tab ────────────────────────────

async function navigateToTab(page, sheetId, tabName) {
  await page.evaluate(({ sheetId, tabName }) => {
    document
      .querySelector(`#${sheetId} nav.sheet-navigation.tabs a[data-tab="${tabName}"]`)
      ?.click();
  }, { sheetId, tabName });
  // Wait for the tab content to become visible
  await page.locator(`#${sheetId} .tab.${tabName}`).waitFor({ state: 'visible', timeout: 5_000 });
}

// ── Shared helper: get the randomUuid that the sheet uses ────────────────────
// Uses getElementById-safe lookup (no CSS selector with the uuid).

async function getSheetUuid(page, sheetId) {
  return page.evaluate((sheetId) => {
    // The filter input has id "{uuid}-itemList-filter" and class item-search-input.
    // querySelector on the sheetId is safe because sheetId starts with "ActorSheet...".
    const input = document.querySelector(`#${sheetId} .item-search-input`);
    if (!input) return null;
    return input.id.replace(/-itemList-filter$/, '');
  }, sheetId);
}

// ── Shared helper: open the Add Item overlay via the Inventory tab button ─────
// Returns the randomUuid string for subsequent DOM lookups.

async function openAddItemOverlayInventory(page, sheetId) {
  await page.evaluate((sheetId) => {
    const btn = document.querySelector(
      `#${sheetId} a.open-compendium-pack[data-pack^="inline:items:"]`
    );
    if (!btn) throw new Error('Add Item button not found in inventory tab');
    btn.click();
  }, sheetId);

  // Wait for the item-search-input to become visible inside the sheet.
  // We can use page.locator() here because the selector uses sheetId (safe) +
  // class name (safe) — NOT the uuid-based id.
  await page.locator(`#${sheetId} .item-search-input`).waitFor({ state: 'visible', timeout: 10_000 });

  const uuid = await getSheetUuid(page, sheetId);

  // Wait for at least one <li> to appear in the item list (loading is async).
  // Must use waitForFunction/evaluate because the id starts with a digit potentially.
  await page.waitForFunction(
    (uuid) => (document.getElementById(`${uuid}-itemList`)?.querySelectorAll('li').length ?? 0) > 0,
    uuid,
    { timeout: 30_000 }
  );

  return uuid;
}

// ── Shared helper: count visible <li> elements in the item list ───────────────

async function countVisibleItems(page, uuid) {
  return page.evaluate(
    (uuid) => [...(document.getElementById(`${uuid}-itemList`)?.querySelectorAll('li') ?? [])]
      .filter(li => li.style.display !== 'none').length,
    uuid
  );
}

// ── Shared helper: count total <li> elements in the item list ─────────────────

async function countTotalItems(page, uuid) {
  return page.evaluate(
    (uuid) => document.getElementById(`${uuid}-itemList`)?.querySelectorAll('li').length ?? 0,
    uuid
  );
}

// ── Shared helper: type into the search filter and wait for DOM to settle ─────

async function typeInFilter(page, uuid, searchTerm) {
  await page.evaluate(({ uuid, searchTerm }) => {
    const input = document.getElementById(`${uuid}-itemList-filter`);
    if (!input) throw new Error('filter input not found');
    input.value = searchTerm;
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }, { uuid, searchTerm });
  await page.waitForTimeout(300);
}

// ── 1. Overlay opens and shows items + search input ───────────────────────────

test('Add Item overlay shows search input and item list', async ({ page }) => {
  const { sheetId } = await createActorAndOpenSheet(page);
  await navigateToTab(page, sheetId, 'inventory');

  const uuid = await openAddItemOverlayInventory(page, sheetId);

  // The filter input should exist (visible check via evaluate avoids CSS id issue)
  const inputVisible = await page.evaluate(
    (uuid) => {
      const el = document.getElementById(`${uuid}-itemList-filter`);
      return el !== null && el.offsetParent !== null;
    },
    uuid
  );
  expect(inputVisible).toBe(true);

  // There should be at least one list item
  const itemCount = await countTotalItems(page, uuid);
  expect(itemCount).toBeGreaterThan(0);
});

// ── 2. Typing filters items and does NOT throw a CSS selector error ───────────

test('search bar filters items without CSS selector errors', async ({ page }) => {
  // The original bug: _filterData() used document.querySelector('#uuid-...')
  // which throws a SyntaxError when the uuid starts with a digit.
  // The fix: document.getElementById() is used instead.
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const { sheetId } = await createActorAndOpenSheet(page);
  await navigateToTab(page, sheetId, 'inventory');
  const uuid = await openAddItemOverlayInventory(page, sheetId);

  const totalItems = await countTotalItems(page, uuid);
  expect(totalItems).toBeGreaterThan(0);

  // Filter to "sword" — present in D35E weapons-and-ammo pack
  await typeInFilter(page, uuid, 'sword');

  const visibleAfterFilter = await countVisibleItems(page, uuid);

  // Some matching items should be visible
  expect(visibleAfterFilter).toBeGreaterThan(0);

  // Filtering should have hidden at least some items
  expect(visibleAfterFilter).toBeLessThan(totalItems);

  // No CSS selector / SyntaxError thrown (the core bug fix)
  const selectorErrors = consoleErrors.filter(
    e => e.includes('not a valid selector') || e.includes('SyntaxError')
  );
  expect(selectorErrors).toHaveLength(0);
});

// ── 3. Clearing the search restores all items ─────────────────────────────────

test('clearing search input restores all items', async ({ page }) => {
  const { sheetId } = await createActorAndOpenSheet(page);
  await navigateToTab(page, sheetId, 'inventory');
  const uuid = await openAddItemOverlayInventory(page, sheetId);

  const totalItems = await countTotalItems(page, uuid);
  expect(totalItems).toBeGreaterThan(0);

  // Filter to a narrow term
  await typeInFilter(page, uuid, 'longsword');

  const visibleFiltered = await countVisibleItems(page, uuid);
  // Filtering "longsword" should hide at least some items
  expect(visibleFiltered).toBeLessThan(totalItems);

  // Clear the filter
  await typeInFilter(page, uuid, '');

  const visibleAfterClear = await countVisibleItems(page, uuid);

  // All items visible again
  expect(visibleAfterClear).toBe(totalItems);
});

// ── 4. Search works from the Features (feats) tab ─────────────────────────────

test('search bar works in the Features tab Add Feat overlay', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const { sheetId } = await createActorAndOpenSheet(page);

  // Navigate to the feats tab
  await navigateToTab(page, sheetId, 'feats');

  // Click the "Add" (open-compendium-pack) button for feats (data-pack="inline:feats:...")
  await page.evaluate((sheetId) => {
    const btn = document.querySelector(
      `#${sheetId} a.open-compendium-pack[data-pack^="inline:feats:"]`
    );
    if (!btn) throw new Error('Add Feat button not found in feats tab');
    btn.click();
  }, sheetId);

  // Wait for the overlay's search input to appear
  await page.locator(`#${sheetId} .item-search-input`).waitFor({ state: 'visible', timeout: 10_000 });

  const uuid = await getSheetUuid(page, sheetId);

  // Wait for items to load
  await page.waitForFunction(
    (uuid) => (document.getElementById(`${uuid}-itemList`)?.querySelectorAll('li').length ?? 0) > 0,
    uuid,
    { timeout: 30_000 }
  );

  const totalFeats = await countTotalItems(page, uuid);
  expect(totalFeats).toBeGreaterThan(0);

  // Filter to "attack" — Power Attack etc. should match
  await typeInFilter(page, uuid, 'attack');

  const visibleFeats = await countVisibleItems(page, uuid);

  expect(visibleFeats).toBeGreaterThan(0);
  expect(visibleFeats).toBeLessThan(totalFeats);

  // No CSS selector errors
  const selectorErrors = consoleErrors.filter(
    e => e.includes('not a valid selector') || e.includes('SyntaxError')
  );
  expect(selectorErrors).toHaveLength(0);
});
