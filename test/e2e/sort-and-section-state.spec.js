'use strict';

/**
 * E2E tests for inventory/spellbook section sort button and collapse-state persistence.
 *
 * Covers:
 *   1. Sort button sorts inventory-weapon section items A→Z.
 *   2. Sort button toggles to Z→A on second click.
 *   3. Sort button sorts spellbook level-1 section items A→Z.
 *   4. Section collapse state persists across a sheet re-render.
 *   5. Section open state persists across a sheet re-render.
 *
 * Implementation note: The inventory sections in the sheet template are indexed
 * numerically (inventory-0, inventory-1, ...) because `sheetData.inventory` is
 * an Object.values() array. Tests locate the weapon section dynamically using a
 * known item ID as an anchor to find the parent .inventory-sublist element.
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a character actor with three weapons whose names start with letters
 * chosen so alphabetical order differs from creation order.
 * Returns { actorId, anchorItemId } where anchorItemId is the first weapon's id,
 * used to locate the weapon section in the DOM.
 */
async function createActorWithThreeWeapons(page, actorName = 'Sort Weapon Actor') {
  return page.evaluate(async (name) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    const items = await actor.createEmbeddedDocuments('Item', [
      { name: 'Zebra Blade',  type: 'weapon', system: {} },
      { name: 'Apple Sword',  type: 'weapon', system: {} },
      { name: 'Mango Dagger', type: 'weapon', system: {} },
    ]);

    return {
      actorId: actor.id,
      anchorItemId: items[0].id,  // Zebra Blade — used to locate the weapon section
    };
  }, actorName);
}

/**
 * Navigate to the inventory tab. Uses Playwright click so Foundry's tab
 * listener fires; waits for the tab pane to gain the "active" class.
 */
async function openInventoryTab(page, sheetId) {
  await page.locator(`#${sheetId} nav.sheet-navigation.tabs a[data-tab="inventory"]`).click({ force: true });
  await page.waitForFunction(
    (sheetId) => document.querySelector(`#${sheetId} .tab[data-tab="inventory"]`)?.classList.contains('active') ?? false,
    sheetId,
    { timeout: 8_000 }
  );
  await page.waitForTimeout(200);
}

/**
 * Find the data-sublist-id of the section wrapper div that contains a given item.
 * Item rows (<li>) also carry data-sublist-id (set to item.id), so we must target
 * the parent <div class="inventory-sublist"> element specifically.
 */
async function findSublistIdForItem(page, sheetId, itemId) {
  return page.evaluate(({ sheetId, itemId }) => {
    const sheet = document.getElementById(sheetId);
    const row = sheet?.querySelector(`li[data-item-id="${itemId}"]`);
    // Walk up to the nearest <div> with data-sublist-id (skip the li itself)
    let el = row?.parentElement;
    while (el && el !== sheet) {
      if (el.tagName === 'DIV' && el.dataset.sublistId) return el.dataset.sublistId;
      el = el.parentElement;
    }
    return null;
  }, { sheetId, itemId });
}

/**
 * Read the display order of item names in a specific sublist section of an open sheet.
 * Returns an array of name strings in DOM order.
 */
async function readSectionItemOrder(page, sheetId, sublistId) {
  return page.evaluate(({ sheetId, sublistId }) => {
    const sheet = document.getElementById(sheetId);
    const sublist = sheet?.querySelector(`[data-sublist-id="${sublistId}"]`);
    if (!sublist) return null;
    const rows = Array.from(sublist.querySelectorAll('ol.item-list > li[data-item-id]'));
    return rows.map(row => {
      const h4 = row.querySelector('h4');
      return (h4?.firstChild?.textContent ?? '').trim();
    });
  }, { sheetId, sublistId });
}

/**
 * Click the sort button for a given sublist-id on the open sheet via DOM click.
 */
async function clickSortButton(page, sheetId, sublistId) {
  await page.evaluate(({ sheetId, sublistId }) => {
    const sheet = document.getElementById(sheetId);
    const btn = sheet?.querySelector(`a.sort-section[data-sublist-id="${sublistId}"]`);
    if (!btn) throw new Error(`Sort button not found for sublist "${sublistId}"`);
    btn.click();
  }, { sheetId, sublistId });
}

/**
 * Wait until the item sort values on the actor have changed from the initial set.
 * Filters to a specific item type if provided.
 */
async function waitForSortUpdate(page, actorId, originalSortValues, itemType = null) {
  await page.waitForFunction(
    ({ actorId, originalSortValues, itemType }) => {
      const actor = game.actors.get(actorId);
      if (!actor) return false;
      const items = itemType ? actor.items.filter(i => i.type === itemType) : [...actor.items];
      const currentSorts = items.map(i => i.sort);
      return currentSorts.some(v => !originalSortValues.includes(v));
    },
    { actorId, originalSortValues, itemType },
    { timeout: 8_000 }
  );
  // Give the sheet a moment to re-render after the actor update
  await page.waitForTimeout(600);
}

// ── 1. Sort button sorts inventory section A→Z ────────────────────────────────

test('sort button orders weapon section items alphabetically A→Z', async ({ page }) => {
  const { actorId, anchorItemId } = await createActorWithThreeWeapons(page);
  const sheetId = await openSheet(page, actorId);
  await openInventoryTab(page, sheetId);

  // Find the actual sublist id for the weapon section using one of our items
  const sublistId = await findSublistIdForItem(page, sheetId, anchorItemId);
  expect(sublistId).not.toBeNull();

  // Capture current sort values before clicking
  const originalSorts = await page.evaluate((actorId) =>
    game.actors.get(actorId).items.filter(i => i.type === 'weapon').map(i => i.sort),
    actorId
  );

  await clickSortButton(page, sheetId, sublistId);
  await waitForSortUpdate(page, actorId, originalSorts, 'weapon');

  const order = await readSectionItemOrder(page, sheetId, sublistId);
  expect(order).not.toBeNull();
  expect(order.length).toBe(3);
  expect(order[0]).toBe('Apple Sword');
  expect(order[1]).toBe('Mango Dagger');
  expect(order[2]).toBe('Zebra Blade');
});

// ── 2. Second click toggles to Z→A ───────────────────────────────────────────

test('sort button second click reverses order to Z→A', async ({ page }) => {
  const { actorId, anchorItemId } = await createActorWithThreeWeapons(page);
  const sheetId = await openSheet(page, actorId);
  await openInventoryTab(page, sheetId);

  const sublistId = await findSublistIdForItem(page, sheetId, anchorItemId);
  expect(sublistId).not.toBeNull();

  // First click → A→Z
  const sorts1 = await page.evaluate((actorId) =>
    game.actors.get(actorId).items.filter(i => i.type === 'weapon').map(i => i.sort), actorId);
  await clickSortButton(page, sheetId, sublistId);
  await waitForSortUpdate(page, actorId, sorts1, 'weapon');

  // Second click → Z→A
  // After the first sort, values are 100000/200000/300000. The second sort assigns
  // the same numbers to different items. waitForSortUpdate can't detect this change
  // (same set of values), so we instead wait for the DOM order to reflect Z→A.
  await clickSortButton(page, sheetId, sublistId);

  // Wait for the sheet to re-render with the new order
  await page.waitForFunction(
    ({ sheetId, sublistId }) => {
      const sheet = document.getElementById(sheetId);
      const sublist = sheet?.querySelector(`[data-sublist-id="${sublistId}"]`);
      const rows = Array.from(sublist?.querySelectorAll('ol.item-list > li[data-item-id]') ?? []);
      if (rows.length < 3) return false;
      const firstName = (rows[0].querySelector('h4')?.firstChild?.textContent ?? '').trim();
      return firstName === 'Zebra Blade';
    },
    { sheetId, sublistId },
    { timeout: 10_000 }
  );

  const order = await readSectionItemOrder(page, sheetId, sublistId);
  expect(order).not.toBeNull();
  expect(order.length).toBe(3);
  expect(order[0]).toBe('Zebra Blade');
  expect(order[1]).toBe('Mango Dagger');
  expect(order[2]).toBe('Apple Sword');
});

// ── 3. Sort button sorts spellbook level-1 section A→Z ───────────────────────

test('sort button orders spellbook level-1 section items alphabetically A→Z', async ({ page }) => {
  const CLASSES_PACK = 'warcraftrpg2e.classes';
  const WIZARD_ID    = 'VwVlbNYqDgMBIWhQ';

  const { actorId, anchorSpellId } = await page.evaluate(async ({ classesPack, wizardId }) => {
    const actor = await Actor.create({
      name: 'Sort Spell Wizard',
      type: 'character',
      system: { abilities: { int: { value: 18 } } },
    });

    const pack = game.packs.get(classesPack);
    const cls  = await pack.getDocument(wizardId);
    const cd   = cls.toObject();
    cd.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [cd]);

    // Create three level-1 spells directly — anchor on the first one
    const spells = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [
      { name: 'Zebra Bolt', type: 'spell', system: { spellbook: 'primary', level: 1 } },
      { name: 'Apple Ray',  type: 'spell', system: { spellbook: 'primary', level: 1 } },
      { name: 'Mango Zap',  type: 'spell', system: { spellbook: 'primary', level: 1 } },
    ]);

    return { actorId: actor.id, anchorSpellId: spells[0].id };
  }, { classesPack: CLASSES_PACK, wizardId: WIZARD_ID });

  const sheetId = await openSheet(page, actorId);

  // Navigate to spells tab via Playwright click.
  // In the character sheet template the nav item uses data-tab="spellbook".
  await page.locator(`#${sheetId} nav.sheet-navigation.tabs a[data-tab="spellbook"]`).click({ force: true });
  await page.waitForFunction(
    (sheetId) => document.querySelector(`#${sheetId} .tab[data-tab="spellbook"]`)?.classList.contains('active') ?? false,
    sheetId,
    { timeout: 8_000 }
  );
  await page.waitForTimeout(300);

  // Find the spellbook sublist containing our anchor spell
  const sublistId = await findSublistIdForItem(page, sheetId, anchorSpellId);
  expect(sublistId).not.toBeNull();

  const originalSorts = await page.evaluate((actorId) =>
    game.actors.get(actorId).items.filter(i => i.type === 'spell').map(i => i.sort),
    actorId
  );

  await clickSortButton(page, sheetId, sublistId);
  await waitForSortUpdate(page, actorId, originalSorts, 'spell');

  // Read spell names from the section
  const order = await readSectionItemOrder(page, sheetId, sublistId);
  expect(order).not.toBeNull();
  expect(order.length).toBeGreaterThanOrEqual(3);

  // The three test spells should appear in A→Z order
  const testSpells = order.filter(n => ['Zebra Bolt', 'Apple Ray', 'Mango Zap'].includes(n));
  expect(testSpells.length).toBe(3);
  expect(testSpells[0]).toBe('Apple Ray');
  expect(testSpells[1]).toBe('Mango Zap');
  expect(testSpells[2]).toBe('Zebra Bolt');
});

// ── 4. Section collapse state persists across re-render ───────────────────────

test('collapsing a section persists across sheet re-render', async ({ page }) => {
  const { actorId, anchorItemId } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Collapse Persist Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });
    const items = await actor.createEmbeddedDocuments('Item', [
      { name: 'Test Sword', type: 'weapon', system: {} },
    ]);
    return { actorId: actor.id, anchorItemId: items[0].id };
  });

  const sheetId = await openSheet(page, actorId);
  await openInventoryTab(page, sheetId);

  // Find the weapon sublist dynamically
  const sublistId = await findSublistIdForItem(page, sheetId, anchorItemId);
  expect(sublistId).not.toBeNull();

  // Verify the section is currently visible (item-list display is not "none")
  const visibleBefore = await page.evaluate(({ sheetId, sublistId }) => {
    const sheet = document.getElementById(sheetId);
    const sublist = sheet?.querySelector(`[data-sublist-id="${sublistId}"]`);
    const itemList = sublist?.querySelector('.item-list');
    return itemList ? itemList.style.display !== 'none' : null;
  }, { sheetId, sublistId });
  expect(visibleBefore).toBe(true);

  // Click the section header toggle (within the sublist) to collapse it
  await page.evaluate(({ sheetId, sublistId }) => {
    const sheet = document.getElementById(sheetId);
    const header = sheet?.querySelector(`[data-sublist-id="${sublistId}"] .inventory-toggleable-header`);
    if (!header) throw new Error('Toggle header not found in sublist ' + sublistId);
    header.click();
  }, { sheetId, sublistId });
  await page.waitForTimeout(400);

  // Confirm it is now collapsed (item-list hidden)
  const hiddenAfterCollapse = await page.evaluate(({ sheetId, sublistId }) => {
    const sheet = document.getElementById(sheetId);
    const sublist = sheet?.querySelector(`[data-sublist-id="${sublistId}"]`);
    const itemList = sublist?.querySelector('.item-list');
    return itemList ? itemList.style.display === 'none' : null;
  }, { sheetId, sublistId });
  expect(hiddenAfterCollapse).toBe(true);

  // Trigger a re-render by updating the actor name
  await page.evaluate(async (actorId) => {
    await game.actors.get(actorId).update({ name: 'Collapse Persist Actor (updated)' });
    await new Promise(r => setTimeout(r, 1000));
  }, actorId);
  await page.waitForTimeout(500);

  // After re-render the section should still be collapsed
  const hiddenAfterRerender = await page.evaluate(({ sheetId, sublistId }) => {
    const sheet = document.getElementById(sheetId);
    const sublist = sheet?.querySelector(`[data-sublist-id="${sublistId}"]`);
    const itemList = sublist?.querySelector('.item-list');
    return itemList ? itemList.style.display === 'none' : null;
  }, { sheetId, sublistId });
  expect(hiddenAfterRerender).toBe(true);
});

// ── 5. Section open state persists across re-render ───────────────────────────

test('re-opening a collapsed section persists across sheet re-render', async ({ page }) => {
  const { actorId, anchorItemId } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Expand Persist Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });
    const items = await actor.createEmbeddedDocuments('Item', [
      { name: 'Test Axe', type: 'weapon', system: {} },
    ]);
    return { actorId: actor.id, anchorItemId: items[0].id };
  });

  const sheetId = await openSheet(page, actorId);
  await openInventoryTab(page, sheetId);

  const sublistId = await findSublistIdForItem(page, sheetId, anchorItemId);
  expect(sublistId).not.toBeNull();

  const clickHeader = async () => {
    await page.evaluate(({ sheetId, sublistId }) => {
      const sheet = document.getElementById(sheetId);
      const header = sheet?.querySelector(`[data-sublist-id="${sublistId}"] .inventory-toggleable-header`);
      if (!header) throw new Error('Toggle header not found in sublist ' + sublistId);
      header.click();
    }, { sheetId, sublistId });
    await page.waitForTimeout(400);
  };

  // Collapse then immediately re-open
  await clickHeader(); // collapse
  await clickHeader(); // expand

  // Confirm it is open now
  const visibleAfterExpand = await page.evaluate(({ sheetId, sublistId }) => {
    const sheet = document.getElementById(sheetId);
    const sublist = sheet?.querySelector(`[data-sublist-id="${sublistId}"]`);
    const itemList = sublist?.querySelector('.item-list');
    return itemList ? itemList.style.display !== 'none' : null;
  }, { sheetId, sublistId });
  expect(visibleAfterExpand).toBe(true);

  // Force a re-render via actor update
  await page.evaluate(async (actorId) => {
    await game.actors.get(actorId).update({ name: 'Expand Persist Actor (updated)' });
    await new Promise(r => setTimeout(r, 800));
  }, actorId);
  await page.waitForTimeout(400);

  // Section should remain open after re-render
  const visibleAfterRerender = await page.evaluate(({ sheetId, sublistId }) => {
    const sheet = document.getElementById(sheetId);
    const sublist = sheet?.querySelector(`[data-sublist-id="${sublistId}"]`);
    const itemList = sublist?.querySelector('.item-list');
    return itemList ? itemList.style.display !== 'none' : null;
  }, { sheetId, sublistId });
  expect(visibleAfterRerender).toBe(true);
});
