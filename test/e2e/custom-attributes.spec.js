'use strict';

/**
 * E2E tests for the D35E custom attributes feature on feat item sheets.
 *
 * Custom attributes live in system.customAttributes on items (primarily feats).
 * Each entry has: id, name, value, selectList (pipe-separated), selectListArray
 * (auto-built from selectList on update), and showOnDetails (boolean).
 *
 * Covers:
 *   Data-level tests (page.evaluate):
 *   1.  Add custom attr — persists in system.customAttributes
 *   2.  selectList generates selectListArray correctly
 *   3.  Removing an option from selectList removes it from selectListArray
 *   4.  Delete via -= removes the attribute
 *   5.  Custom roll data — getRollData().custom reflects attr value
 *   6.  customNames roll data — getRollData().customNames reflects selectList label
 *   7.  nameFormula renames item when nameFromFormula=true
 *   8.  firstChangeTarget updates changes[0][2]
 *
 *   UI-level tests (Playwright sheet interactions):
 *   9.  Add button creates a new row in the custom-fields list
 *   10. Delete button removes the row
 *   11. showOnDetails attr appears on description tab
 *   12. showOnDetails dropdown on description tab — selecting changes stored value
 *   13. customAttributesLocked hides add/delete controls
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

// ── Lifecycle ─────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a world-level feat item and return its id.
 */
async function createFeatItem(page, name = 'Test Feat') {
  return page.evaluate(async (name) => {
    const item = await Item.create({ name, type: 'feat' });
    return item.id;
  }, name);
}

/**
 * Open a world-level item sheet, wait for it to be visible, and return the
 * Foundry app DOM id string (e.g. "app-42").
 */
async function openItemSheet(page, itemId) {
  const sheetId = await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    const app = item.sheet;
    await app.render(true);
    await new Promise((r) => setTimeout(r, 500));
    return app.id;
  }, itemId);
  await page.locator(`#${sheetId}`).waitFor({ state: 'visible', timeout: 10_000 });
  await dismissOverlays(page);
  return sheetId;
}

/**
 * Navigate to the Configuration tab of an open item sheet.
 * The feat sheet has "description" active by default; clicking "configuration"
 * nav link is required before the details sub-tab is accessible.
 */
async function openConfigurationTab(page, sheetId) {
  await page.locator(`#${sheetId} nav.sheet-navigation.tabs a[data-tab="configuration"]`).click({ force: true });
  await page.waitForFunction(
    (sheetId) =>
      document.querySelector(`#${sheetId} .tab[data-group="primary"][data-tab="configuration"]`)
        ?.classList.contains('active') ?? false,
    sheetId,
    { timeout: 8_000 }
  );
  await page.waitForTimeout(200);
}

/**
 * Navigate to the Description tab of an open item sheet.
 */
async function openDescriptionTab(page, sheetId) {
  await page.locator(`#${sheetId} nav.sheet-navigation.tabs a[data-tab="description"]`).click({ force: true });
  await page.waitForFunction(
    (sheetId) =>
      document.querySelector(`#${sheetId} .tab[data-group="primary"][data-tab="description"]`)
        ?.classList.contains('active') ?? false,
    sheetId,
    { timeout: 8_000 }
  );
  await page.waitForTimeout(200);
}

// ── 1. Add custom attr persists ───────────────────────────────────────────────

test('adding a custom attribute persists in system.customAttributes', async ({ page }) => {
  const itemId = await createFeatItem(page, 'Attr Add Feat');

  const result = await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._test1': {
        id: '_test1',
        name: 'TestAttr',
        value: '5',
      },
    });
    // Re-fetch after update
    const updated = game.items.get(itemId);
    const attr = updated.system.customAttributes?._test1;
    return attr ? { id: attr.id, name: attr.name, value: attr.value } : null;
  }, itemId);

  expect(result).not.toBeNull();
  expect(result.name).toBe('TestAttr');
  expect(result.value).toBe('5');
});

// ── 2. selectList generates selectListArray ───────────────────────────────────

test('updating selectList generates selectListArray with correct key→label pairs', async ({ page }) => {
  const itemId = await createFeatItem(page, 'SelectList Feat');

  // First create the attribute
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._sel': {
        id: '_sel',
        name: 'WeaponType',
        value: 'opt_a',
      },
    });
  }, itemId);

  // Now update with a selectList — this triggers the selectListArray build
  const result = await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._sel.selectList': 'Option A:opt_a|Option B:opt_b',
    });
    await new Promise((r) => setTimeout(r, 300));
    const updated = game.items.get(itemId);
    const attr = updated.system.customAttributes?._sel;
    return attr?.selectListArray ?? null;
  }, itemId);

  expect(result).not.toBeNull();
  expect(result['opt_a']).toBe('Option A');
  expect(result['opt_b']).toBe('Option B');
});

// ── 3. Removing an option from selectList removes it from selectListArray ─────

test('removing an option from selectList removes its key from selectListArray', async ({ page }) => {
  const itemId = await createFeatItem(page, 'SelectList Remove Feat');

  // Step 1: create the attribute without selectList so it exists in the DB
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._rem': {
        id: '_rem',
        name: 'Choice',
        value: 'opt_a',
      },
    });
  }, itemId);

  await page.waitForFunction(
    (itemId) => !!game.items.get(itemId)?.system.customAttributes?._rem,
    itemId,
    { timeout: 8_000 }
  );

  // Step 2: set the selectList — attribute already exists, so the code can read
  // existingCustomAttribute.selectListArray (which is undefined/empty) safely.
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._rem.selectList': 'Option A:opt_a|Option B:opt_b',
    });
  }, itemId);

  // Wait for selectListArray to be built
  await page.waitForFunction(
    (itemId) => {
      const item = game.items.get(itemId);
      const arr = item?.system.customAttributes?._rem?.selectListArray;
      return arr && 'opt_a' in arr && 'opt_b' in arr;
    },
    itemId,
    { timeout: 8_000 }
  );

  // Now update selectList to only have one option
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._rem.selectList': 'Option A:opt_a',
    });
  }, itemId);

  // Wait for opt_b to disappear
  await page.waitForFunction(
    (itemId) => {
      const item = game.items.get(itemId);
      const arr = item?.system.customAttributes?._rem?.selectListArray;
      return arr && 'opt_a' in arr && !('opt_b' in arr);
    },
    itemId,
    { timeout: 8_000 }
  );

  const result = await page.evaluate((itemId) => {
    const item = game.items.get(itemId);
    return item.system.customAttributes?._rem?.selectListArray ?? null;
  }, itemId);

  expect(result).not.toBeNull();
  expect('opt_a' in result).toBe(true);
  expect('opt_b' in result).toBe(false);
});

// ── 4. Delete via -= removes the attribute ─────────────────────────────────────

test('deleting a custom attribute via -= removes it from system.customAttributes', async ({ page }) => {
  const itemId = await createFeatItem(page, 'Attr Delete Feat');

  // Create the attribute
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._del': {
        id: '_del',
        name: 'ToDelete',
        value: 'gone',
      },
    });
  }, itemId);

  // Confirm it exists
  const before = await page.evaluate((itemId) => {
    const item = game.items.get(itemId);
    return item.system.customAttributes?._del?.name ?? null;
  }, itemId);
  expect(before).toBe('ToDelete');

  // Delete via -= notation
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({ 'system.customAttributes.-=_del': null });
  }, itemId);

  // Wait for it to be gone
  await page.waitForFunction(
    (itemId) => {
      const item = game.items.get(itemId);
      return !item?.system.customAttributes?.hasOwnProperty('_del');
    },
    itemId,
    { timeout: 8_000 }
  );

  const after = await page.evaluate((itemId) => {
    const item = game.items.get(itemId);
    return item.system.customAttributes?._del ?? 'GONE';
  }, itemId);
  expect(after).toBe('GONE');
});

// ── 5. Custom roll data ────────────────────────────────────────────────────────

test('custom attr with name "WeaponType" is accessible via getRollData().custom.weapontype', async ({ page }) => {
  const itemId = await createFeatItem(page, 'Roll Data Feat');

  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._rd': {
        id: '_rd',
        name: 'WeaponType',
        value: 'sword',
      },
    });
  }, itemId);

  // Wait for the update to settle
  await page.waitForFunction(
    (itemId) => game.items.get(itemId)?.system.customAttributes?._rd?.value === 'sword',
    itemId,
    { timeout: 8_000 }
  );

  const rollCustom = await page.evaluate((itemId) => {
    const item = game.items.get(itemId);
    return item.getRollData().custom ?? null;
  }, itemId);

  expect(rollCustom).not.toBeNull();
  expect(rollCustom['weapontype']).toBe('sword');
});

// ── 6. customNames roll data with selectList ───────────────────────────────────

test('getRollData().customNames returns display label when selectList is set', async ({ page }) => {
  const itemId = await createFeatItem(page, 'CustomNames Feat');

  // Step 1: create the attribute without selectList so it exists in the DB
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._cn': {
        id: '_cn',
        name: 'AttrName',
        value: 'opt_a',
      },
    });
  }, itemId);

  await page.waitForFunction(
    (itemId) => !!game.items.get(itemId)?.system.customAttributes?._cn,
    itemId,
    { timeout: 8_000 }
  );

  // Step 2: set the selectList — attr now exists, so the code won't crash on
  // existingCustomAttribute being undefined.
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._cn.selectList': 'Option A:opt_a|Option B:opt_b',
    });
  }, itemId);

  // Wait for selectListArray to be populated
  await page.waitForFunction(
    (itemId) => {
      const item = game.items.get(itemId);
      const arr = item?.system.customAttributes?._cn?.selectListArray;
      return arr && 'opt_a' in arr;
    },
    itemId,
    { timeout: 8_000 }
  );

  const customNames = await page.evaluate((itemId) => {
    const item = game.items.get(itemId);
    return item.getRollData().customNames ?? null;
  }, itemId);

  expect(customNames).not.toBeNull();
  // name "AttrName" → key "attrname", value is opt_a → label "Option A"
  expect(customNames['attrname']).toBe('Option A');
});

// ── 7. nameFormula renames item when nameFromFormula = true ───────────────────

test('nameFormula using custom attr renames the item on update', async ({ page }) => {
  const itemId = await createFeatItem(page, 'Formula Feat Original');

  // Step 1: create the custom attr
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._wp': {
        id: '_wp',
        name: 'weapon',
        value: 'Sword',
      },
    });
  }, itemId);

  await page.waitForFunction(
    (itemId) => game.items.get(itemId)?.system.customAttributes?._wp?.value === 'Sword',
    itemId,
    { timeout: 8_000 }
  );

  // Step 2: enable nameFromFormula and set the formula
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.nameFromFormula': true,
      'system.nameFormula': '${this.custom.weapon} Proficiency',
    });
  }, itemId);

  // Step 3: trigger a value update to force the name re-computation
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._wp.value': 'Sword',
    });
  }, itemId);

  // Wait for the name to update
  await page.waitForFunction(
    (itemId) => game.items.get(itemId)?.name === 'Sword Proficiency',
    itemId,
    { timeout: 8_000 }
  );

  const name = await page.evaluate((itemId) => game.items.get(itemId)?.name, itemId);
  expect(name).toBe('Sword Proficiency');
});

// ── 8. firstChangeTarget updates changes[0][2] ────────────────────────────────

test('updating firstChangeTarget sets system.changes[0][2] to the target key', async ({ page }) => {
  const itemId = await createFeatItem(page, 'FirstChangeTarget Feat');

  // Add a change entry first
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.changes': [['1', 'skill', 'skill.per', 'untyped', 0]],
    });
  }, itemId);

  await page.waitForFunction(
    (itemId) => (game.items.get(itemId)?.system.changes?.length ?? 0) > 0,
    itemId,
    { timeout: 8_000 }
  );

  // Send firstChangeTarget — only the special key is needed; the flat
  // "system.changes.0.2" path is sufficient to update the target.
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      firstChangeTarget: 'newSkill:New Skill Name',
    });
  }, itemId);

  await page.waitForFunction(
    (itemId) => game.items.get(itemId)?.system.changes?.[0]?.[2] === 'newSkill',
    itemId,
    { timeout: 8_000 }
  );

  const changeTarget = await page.evaluate((itemId) => {
    const item = game.items.get(itemId);
    return item.system.changes?.[0]?.[2] ?? null;
  }, itemId);
  expect(changeTarget).toBe('newSkill');
});

// ── 9. Add button creates a new row ───────────────────────────────────────────

test('clicking Add Custom Attribute creates a new row in the custom-fields list', async ({ page }) => {
  const itemId = await createFeatItem(page, 'UI Add Row Feat');
  const sheetId = await openItemSheet(page, itemId);

  // Open the configuration tab, then the details sub-tab should already be active
  await openConfigurationTab(page, sheetId);

  // Count rows before click
  const sheet = page.locator(`#${sheetId}`);
  const rowsBefore = await sheet.locator('.custom-fields .custom-field').count();

  // Click the add button
  await sheet.locator('.custom-field-control.add').click({ force: true });

  // Wait for a new row to appear
  await page.waitForFunction(
    ({ sheetId, expected }) => {
      const s = document.getElementById(sheetId);
      return (s?.querySelectorAll('.custom-fields .custom-field').length ?? 0) > expected;
    },
    { sheetId, expected: rowsBefore },
    { timeout: 8_000 }
  );

  const rowsAfter = await sheet.locator('.custom-fields .custom-field').count();
  expect(rowsAfter).toBe(rowsBefore + 1);
});

// ── 10. Delete button removes a row ──────────────────────────────────────────

test('clicking Remove custom attribute deletes the row from the custom-fields list', async ({ page }) => {
  const itemId = await createFeatItem(page, 'UI Delete Row Feat');

  // Pre-create a custom attribute so the sheet renders with one row
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._uirow': {
        id: '_uirow',
        name: 'ToRemove',
        value: 'yes',
      },
    });
  }, itemId);

  await page.waitForFunction(
    (itemId) => !!game.items.get(itemId)?.system.customAttributes?._uirow,
    itemId,
    { timeout: 8_000 }
  );

  const sheetId = await openItemSheet(page, itemId);
  await openConfigurationTab(page, sheetId);

  const sheet = page.locator(`#${sheetId}`);

  // There should be exactly 1 row
  await page.waitForFunction(
    (sheetId) => (document.getElementById(sheetId)?.querySelectorAll('.custom-fields .custom-field').length ?? 0) >= 1,
    sheetId,
    { timeout: 8_000 }
  );
  const rowsBefore = await sheet.locator('.custom-fields .custom-field').count();
  expect(rowsBefore).toBeGreaterThanOrEqual(1);

  // Click the delete button for the row
  await sheet.locator('.custom-field-control.delete').first().click({ force: true });

  // Wait for the row to disappear
  await page.waitForFunction(
    ({ sheetId, expected }) => {
      const s = document.getElementById(sheetId);
      return (s?.querySelectorAll('.custom-fields .custom-field').length ?? 0) < expected;
    },
    { sheetId, expected: rowsBefore },
    { timeout: 8_000 }
  );

  const rowsAfter = await sheet.locator('.custom-fields .custom-field').count();
  expect(rowsAfter).toBe(rowsBefore - 1);
});

// ── 11. showOnDetails attr appears on description tab ────────────────────────

test('custom attr with showOnDetails=true appears on the Description tab', async ({ page }) => {
  const itemId = await createFeatItem(page, 'ShowOnDetails Feat');

  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._sod': {
        id: '_sod',
        name: 'VisibleProp',
        value: 'hello',
        showOnDetails: true,
      },
    });
  }, itemId);

  await page.waitForFunction(
    (itemId) => !!game.items.get(itemId)?.system.customAttributes?._sod,
    itemId,
    { timeout: 8_000 }
  );

  const sheetId = await openItemSheet(page, itemId);
  await openDescriptionTab(page, sheetId);

  const sheet = page.locator(`#${sheetId}`);

  // The label "VisibleProp" should appear in the description tab's detailsbox
  const label = sheet.locator('.tab[data-tab="description"] .detailsbox label').filter({ hasText: 'VisibleProp' });
  await label.waitFor({ state: 'visible', timeout: 8_000 });
  await expect(label).toBeVisible();

  // The input with value "hello" should be visible
  const input = sheet.locator('.tab[data-tab="description"] .detailsbox input[name="system.customAttributes._sod.value"]');
  await input.waitFor({ state: 'visible', timeout: 8_000 });
  await expect(input).toHaveValue('hello');
});

// ── 12. showOnDetails dropdown updates value on selection ─────────────────────

test('selecting a different option in showOnDetails dropdown saves the new value', async ({ page }) => {
  const itemId = await createFeatItem(page, 'ShowOnDetails Dropdown Feat');

  // Step 1: create the attribute without selectList so it exists first
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._dd': {
        id: '_dd',
        name: 'DamageType',
        value: 'opt_a',
        showOnDetails: true,
      },
    });
  }, itemId);

  await page.waitForFunction(
    (itemId) => !!game.items.get(itemId)?.system.customAttributes?._dd,
    itemId,
    { timeout: 8_000 }
  );

  // Step 2: set selectList — attr already exists, no crash on selectListArray
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._dd.selectList': 'Slashing:opt_a|Bludgeoning:opt_b',
    });
  }, itemId);

  // Wait for selectListArray to be built
  await page.waitForFunction(
    (itemId) => {
      const item = game.items.get(itemId);
      const arr = item?.system.customAttributes?._dd?.selectListArray;
      return arr && 'opt_a' in arr && 'opt_b' in arr;
    },
    itemId,
    { timeout: 8_000 }
  );

  const sheetId = await openItemSheet(page, itemId);
  await openDescriptionTab(page, sheetId);

  const sheet = page.locator(`#${sheetId}`);
  const select = sheet.locator('.tab[data-tab="description"] select[name="system.customAttributes._dd.value"]');
  await select.waitFor({ state: 'visible', timeout: 8_000 });

  // Verify initial value
  await expect(select).toHaveValue('opt_a');

  // Select the second option and fire a change event so the sheet picks it up
  await select.selectOption('opt_b');
  await page.evaluate((sheetId) => {
    const sel = document.querySelector(`#${sheetId} .tab[data-tab="description"] select[name="system.customAttributes._dd.value"]`);
    if (sel) sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, sheetId);

  // Wait for the item to update in the world
  await page.waitForFunction(
    (itemId) => game.items.get(itemId)?.system.customAttributes?._dd?.value === 'opt_b',
    itemId,
    { timeout: 8_000 }
  );

  const value = await page.evaluate((itemId) => {
    return game.items.get(itemId)?.system.customAttributes?._dd?.value;
  }, itemId);
  expect(value).toBe('opt_b');
});

// ── 13. customAttributesLocked hides add/delete controls ─────────────────────

test('customAttributesLocked=true hides the add button and delete buttons', async ({ page }) => {
  const itemId = await createFeatItem(page, 'Locked Attrs Feat');

  // Add one attr, then lock
  await page.evaluate(async (itemId) => {
    const item = game.items.get(itemId);
    await item.update({
      'system.customAttributes._lk': {
        id: '_lk',
        name: 'LockedAttr',
        value: '1',
      },
      'system.customAttributesLocked': true,
    });
  }, itemId);

  await page.waitForFunction(
    (itemId) =>
      !!game.items.get(itemId)?.system.customAttributes?._lk &&
      game.items.get(itemId)?.system.customAttributesLocked === true,
    itemId,
    { timeout: 8_000 }
  );

  const sheetId = await openItemSheet(page, itemId);
  await openConfigurationTab(page, sheetId);

  const sheet = page.locator(`#${sheetId}`);

  // The add button must NOT be present (rendered with {{#unless locked}})
  const addBtn = sheet.locator('.custom-field-control.add');
  await expect(addBtn).toHaveCount(0);

  // The delete buttons must NOT be present
  const deleteBtns = sheet.locator('.custom-field-control.delete');
  await expect(deleteBtns).toHaveCount(0);
});
