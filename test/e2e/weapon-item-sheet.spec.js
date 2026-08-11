'use strict';

/**
 * E2E: weapon (and equipment) item sheets must render after intelligent-item UI was added.
 * Regression: missing `system.intelligent` on compendium items broke Handlebars (#select / #each).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const WEAPONS_PACK = 'warcraftrpg2e.weapons-and-ammo';
const LONGSWORD_ID = 'zWRlna42PMJVX6un';

/** Actor with one Longsword (unequipped — no attack churn needed for sheet tests). */
async function createActorWithLongsword(page) {
  return page.evaluate(async ({ WEAPONS_PACK, LONGSWORD_ID }) => {
    const actor = await Actor.create({ name: 'Sheet Test Fighter', type: 'character' });
    await actor.update({ 'system.abilities.str.value': 14, 'system.abilities.dex.value': 12 });
    const weaponPack = game.packs.get(WEAPONS_PACK);
    const doc = await weaponPack.getDocument(LONGSWORD_ID);
    const [weapon] = await actor.createEmbeddedDocuments('Item', [doc.toObject()]);
    return { actorId: actor.id, weaponId: weapon.id };
  }, { WEAPONS_PACK, LONGSWORD_ID });
}

/** Torch from warcraftrpg2e.items (type equipment) — stable compendium id from source/items. */
async function createActorWithTorchEquipment(page) {
  return page.evaluate(async () => {
    const ITEMS_PACK = 'warcraftrpg2e.items';
    const TORCH_ID = 'HrWNpJaAnLyChj1x';
    const actor = await Actor.create({
      name: 'Sheet Test Equipment',
      type: 'character',
    });
    const pack = game.packs.get(ITEMS_PACK);
    const doc = await pack.getDocument(TORCH_ID);
    if (!doc) throw new Error(`Missing compendium item ${TORCH_ID} in ${ITEMS_PACK}`);
    const [eq] = await actor.createEmbeddedDocuments('Item', [doc.toObject()]);
    return { actorId: actor.id, equipmentId: eq.id };
  });
}

/**
 * Same pattern as custom-attributes `openItemSheet`: render, resolve the actual
 * window element id (app.element may be jQuery-wrapped), wait for it, clear toasts.
 */
async function openActorItemSheet(page, actorId, itemId) {
  const sheetId = await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(itemId);
    if (!item) throw new Error(`Item ${itemId} not on actor ${actorId}`);
    const app = item.sheet;
    await app.render(true);
    await new Promise((r) => setTimeout(r, 500));
    const el = app.element;
    const node = el?.jquery ? el[0] : el;
    const domId = node?.id;
    return domId && domId.length ? domId : app.id;
  }, { actorId, itemId });

  await page.locator(`#${sheetId}`).waitFor({ state: 'visible', timeout: 20_000 });
  await dismissSystemDialogs(page);
  await page.locator('text=Welcome to Foundry Virtual Tabletop').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => null);
  await dismissOverlays(page);
  return sheetId;
}

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
  // Same extra pass as welcome-onboarding-persistence: D35E welcome/onboarding ids vary by core version.
  for (const sel of ['.app.welcome-screen', '.app.onboarding']) {
    const btn = page.locator(`${sel} .header-button.close, ${sel} a.close`).first();
    if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
      await btn.click({ force: true });
      await page.waitForTimeout(200);
    }
  }
});

/** Navigate to the configuration primary tab. */
async function goToConfigTab(page, win, sheetId) {
  await win.locator('nav.sheet-navigation.tabs a[data-tab="configuration"]').click({ force: true });
  await page.waitForFunction(
    (id) =>
      document.querySelector(`#${id} .tab[data-group="primary"][data-tab="configuration"]`)?.classList.contains('active') ?? false,
    sheetId,
    { timeout: 10_000 },
  );
}

/** Navigate to the intelligent primary tab. */
async function goToIntelligentTab(page, win, sheetId) {
  await win.locator('nav.sheet-navigation.tabs a[data-tab="intelligent"]').click({ force: true });
  await page.waitForFunction(
    (id) =>
      document.querySelector(`#${id} .tab[data-group="primary"][data-tab="intelligent"]`)?.classList.contains('active') ?? false,
    sheetId,
    { timeout: 10_000 },
  );
}

test('weapon item sheet renders and Intelligent tab activates', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));

  const { actorId, weaponId } = await createActorWithLongsword(page);

  // Enable intelligent so the tab appears in nav
  await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    await item.update({ 'system.intelligent.enabled': true });
  }, { actorId, weaponId });

  const sheetId = await openActorItemSheet(page, actorId, weaponId);

  const win = page.locator(`#${sheetId}`);

  await expect(win.locator('.window-title')).toContainText(/longsword/i);
  await expect(win.locator('nav.sheet-navigation.tabs a[data-tab="description"]')).toBeVisible();
  await expect(win.locator('nav.sheet-navigation.tabs a[data-tab="details"]')).toBeVisible();
  await expect(win.locator('nav.sheet-navigation.tabs a[data-tab="intelligent"]')).toBeVisible();

  // Intelligent enabled toggle is in details tab
  await win.locator('nav.sheet-navigation.tabs a[data-tab="details"]').click({ force: true });
  await page.waitForFunction(
    (id) => document.querySelector(`#${id} .tab[data-group="primary"][data-tab="details"]`)?.classList.contains('active') ?? false,
    sheetId, { timeout: 8_000 },
  );
  await expect(win.locator('.tab[data-tab="details"] input[name="system.intelligent.enabled"]')).toBeVisible();

  // Intelligent tab has senses fields (not freeform visionRange)
  await goToIntelligentTab(page, win, sheetId);
  await expect(win.locator('.tab[data-tab="intelligent"] input[name="system.intelligent.senses.darkvision"]')).toBeVisible();
  await expect(win.locator('.tab[data-tab="intelligent"] .intelligent-tier-picker')).toBeVisible();

  expect(jsErrors.filter((m) => /handlebars|mustache|parse error|undefined is not/i.test(m))).toEqual([]);
});

test('equipment item sheet renders and Intelligent tab activates', async ({ page }) => {
  const { actorId, equipmentId } = await createActorWithTorchEquipment(page);

  // Enable intelligent so the tab appears in nav
  await page.evaluate(async ({ actorId, equipmentId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(equipmentId);
    await item.update({ 'system.intelligent.enabled': true });
  }, { actorId, equipmentId });

  const sheetId = await openActorItemSheet(page, actorId, equipmentId);

  const win = page.locator(`#${sheetId}`);

  await expect(win.locator('nav.sheet-navigation.tabs a[data-tab="intelligent"]')).toBeVisible();

  // Intelligent enabled toggle is in details tab
  await win.locator('nav.sheet-navigation.tabs a[data-tab="details"]').click({ force: true });
  await page.waitForFunction(
    (id) => document.querySelector(`#${id} .tab[data-group="primary"][data-tab="details"]`)?.classList.contains('active') ?? false,
    sheetId, { timeout: 8_000 },
  );
  await expect(win.locator('.tab[data-tab="details"] input[name="system.intelligent.enabled"]')).toBeVisible();

  await goToIntelligentTab(page, win, sheetId);
  await expect(win.locator('.tab[data-tab="intelligent"] input[name="system.intelligent.senses.darkvision"]')).toBeVisible();
});

test('weapon intelligent tab add-power button inserts a power row', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));

  const { actorId, weaponId } = await createActorWithLongsword(page);

  // Enable intelligent on the item so powers list renders
  await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    await item.update({ 'system.intelligent.enabled': true });
  }, { actorId, weaponId });

  const sheetId = await openActorItemSheet(page, actorId, weaponId);
  const win = page.locator(`#${sheetId}`);

  await goToIntelligentTab(page, win, sheetId);

  // Verify the power picker row is present
  const tierPicker = win.locator('.intelligent-tier-picker');
  const powerPicker = win.locator('.intelligent-power-picker');
  const addBtn = win.locator('button[data-action="intelligent-add-power"]');
  await expect(tierPicker).toBeVisible();
  await expect(powerPicker).toBeVisible();
  await expect(addBtn).toBeVisible();

  // Select "lesser" and click add — power list should gain a row
  await tierPicker.selectOption('lesser');
  // Wait for repopulation
  await page.waitForTimeout(200);
  const optCount = await powerPicker.evaluate((el) => el.options.length);

  // Only click if there are options to pick
  if (optCount > 0) {
    await addBtn.click();
    await page.waitForTimeout(600);
    // Should now have at least one power row
    const rows = win.locator('ol.inventory-list li[data-power-id]');
    await expect(rows).toHaveCount(1, { timeout: 8_000 });
  }

  expect(jsErrors.filter((m) => /handlebars|mustache|parse error|undefined is not/i.test(m))).toEqual([]);
});

test('intelligent powers persist after sheet close and reopen', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));

  const { actorId, weaponId } = await createActorWithLongsword(page);

  // Add a feat power directly via the API, simulating a drag-drop of a feat item
  const powerId = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    await item.update({ 'system.intelligent.enabled': true });

    // Create a minimal feat item data snapshot
    const fakeFeaData = {
      name: 'Iron Will',
      type: 'feat',
      img: 'icons/svg/item-bag.svg',
      system: { description: { value: 'Test feat' } },
    };
    await item.intelligentPowers.addPowerFromFeat(fakeFeaData, 2);

    const powers = foundry.utils.getProperty(item.system, 'intelligent.powers') || [];
    return powers[0]?._id ?? null;
  }, { actorId, weaponId });

  expect(powerId).toBeTruthy();

  // Open sheet and navigate to Intelligent tab
  const sheetId = await openActorItemSheet(page, actorId, weaponId);
  const win = page.locator(`#${sheetId}`);
  await goToIntelligentTab(page, win, sheetId);

  // Verify the power row is visible
  const row = win.locator(`ol.inventory-list li[data-power-id="${powerId}"]`);
  await expect(row).toBeVisible({ timeout: 8_000 });
  await expect(row).toContainText('Iron Will');

  // Close the sheet
  await page.evaluate((id) => {
    const app = [...foundry.applications.instances.values()].find((a) => (a.element instanceof HTMLElement ? a.element.id : a.element?.[0]?.id) === id);
    app?.close();
  }, sheetId);
  await page.waitForTimeout(300);

  // Reopen the sheet and verify power still there
  const sheetId2 = await openActorItemSheet(page, actorId, weaponId);
  const win2 = page.locator(`#${sheetId2}`);
  await goToIntelligentTab(page, win2, sheetId2);

  const row2 = win2.locator(`ol.inventory-list li[data-power-id="${powerId}"]`);
  await expect(row2).toBeVisible({ timeout: 8_000 });
  await expect(row2).toContainText('Iron Will');

  expect(jsErrors.filter((m) => /handlebars|mustache|parse error|undefined is not/i.test(m))).toEqual([]);
});

test('intelligent power ego field is editable and persists', async ({ page }) => {
  const { actorId, weaponId } = await createActorWithLongsword(page);

  const powerId = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    await item.update({ 'system.intelligent.enabled': true });
    await item.intelligentPowers.addPowerFromFeat({ name: 'Toughness', type: 'feat', img: 'icons/svg/item-bag.svg', system: {} }, 0);
    const powers = foundry.utils.getProperty(item.system, 'intelligent.powers') || [];
    return powers[0]?._id ?? null;
  }, { actorId, weaponId });

  const sheetId = await openActorItemSheet(page, actorId, weaponId);
  const win = page.locator(`#${sheetId}`);
  await goToIntelligentTab(page, win, sheetId);

  const egoInput = win.locator(`ol.inventory-list li[data-power-id="${powerId}"] .intel-power-ego`);
  await expect(egoInput).toBeVisible({ timeout: 8_000 });

  // Change ego to 3
  await egoInput.fill('3');
  await egoInput.press('Tab');
  await page.waitForTimeout(600);

  // Verify persisted in actor data
  const savedEgo = await page.evaluate(({ actorId, weaponId, powerId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    const powers = foundry.utils.getProperty(item.system, 'intelligent.powers') || [];
    return powers.find((p) => p._id === powerId)?.egoPoints ?? null;
  }, { actorId, weaponId, powerId });

  expect(savedEgo).toBe(3);
});

test('ego box title is rollable and fires conflict roll when item is on an actor', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));

  const { actorId, weaponId } = await createActorWithLongsword(page);

  // Enable intelligent and set non-trivial mental scores so ego > 0
  await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    await item.update({
      'system.intelligent.enabled': true,
      'system.intelligent.int': 14,
      'system.intelligent.wis': 12,
      'system.intelligent.cha': 10,
    });
  }, { actorId, weaponId });

  const sheetId = await openActorItemSheet(page, actorId, weaponId);
  const win = page.locator(`#${sheetId}`);
  await goToIntelligentTab(page, win, sheetId);

  // The ego h4 should have the rollable class (owner = item is on an actor)
  const egoTitle = win.locator('ul.intelligent-scores li.intelligent-score h4.ability-name.rollable');
  await expect(egoTitle).toBeVisible({ timeout: 8_000 });
  await expect(egoTitle).toHaveAttribute('data-action', 'intelligent-conflict-roll');

  // CSS: cursor should be pointer (visual rollable indicator)
  const cursor = await egoTitle.evaluate((el) => window.getComputedStyle(el).cursor);
  expect(cursor).toBe('pointer');

  // Click should fire the conflict roll handler without JS errors
  // rollSavingThrow opens a dialog — watch for it or just confirm no crash
  const dialogPromise = page.locator('.dialog').first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => null);
  await egoTitle.click();
  await dialogPromise;

  // Dismiss any opened dialog
  const dialogClose = page.locator('.dialog .header-button.close, .dialog button.cancel').first();
  if (await dialogClose.isVisible({ timeout: 500 }).catch(() => false)) {
    await dialogClose.click({ force: true });
  }

  expect(jsErrors.filter((m) => /handlebars|parse error|TypeError|is not a function/i.test(m))).toEqual([]);
});

test('intelligent item skill table — add, edit and delete a skill row', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));

  const { actorId, weaponId } = await createActorWithLongsword(page);

  await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    await item.update({
      'system.intelligent.enabled': true,
      'system.intelligent.wis': 14,
    });
  }, { actorId, weaponId });

  const sheetId = await openActorItemSheet(page, actorId, weaponId);
  const win = page.locator(`#${sheetId}`);
  await goToIntelligentTab(page, win, sheetId);

  // Add a skill via the Add Skill button
  const addSkillBtn = win.locator('button[data-action="intelligent-add-skill"]');
  await expect(addSkillBtn).toBeVisible({ timeout: 8_000 });
  await addSkillBtn.click();
  await page.waitForTimeout(600);

  // A skill row should appear
  const skillRow = win.locator('li[data-skill-id]').first();
  await expect(skillRow).toBeVisible({ timeout: 8_000 });

  // Select "Spot" (key "spt") from the skill name dropdown
  const nameInput = skillRow.locator('.intel-skill-name');
  await nameInput.selectOption('spt');
  await nameInput.dispatchEvent('change');
  await page.waitForTimeout(400);

  // Change ability to wis
  const abilitySelect = skillRow.locator('.intel-skill-ability');
  await abilitySelect.selectOption('wis');
  // Trigger change event
  await abilitySelect.dispatchEvent('change');
  await page.waitForTimeout(400);

  // Set ranks to 4
  const ranksInput = skillRow.locator('.intel-skill-ranks');
  await ranksInput.fill('4');
  await ranksInput.press('Tab');
  await page.waitForTimeout(400);

  // Verify persisted in item data
  const skillId = await skillRow.getAttribute('data-skill-id');
  const saved = await page.evaluate(({ actorId, weaponId, skillId }) => {
    const item = game.actors.get(actorId).items.get(weaponId);
    const skills = foundry.utils.getProperty(item.system, 'intelligent.skills') || [];
    return skills.find((s) => s._id === skillId) ?? null;
  }, { actorId, weaponId, skillId });

  expect(saved).toBeTruthy();
  expect(saved.name).toBe('spt');
  expect(saved.ranks).toBe(4);

  // Total column should reflect wis mod (+2 for 14) + 4 ranks = +6
  const totalSpan = skillRow.locator('.item-detail.item-total span');
  await expect(totalSpan).toHaveText('+6', { timeout: 4_000 });

  // Delete the skill (shift-click to skip confirm dialog)
  const delBtn = skillRow.locator('.intel-skill-delete');
  await delBtn.click({ modifiers: ['Shift'] });
  await page.waitForTimeout(400);

  // Row should be gone
  await expect(win.locator(`li[data-skill-id="${skillId}"]`)).not.toBeVisible({ timeout: 4_000 });

  expect(jsErrors.filter((m) => /handlebars|parse error|TypeError|is not a function/i.test(m))).toEqual([]);
});

test('intelligent item skill powers create derived skill rows and roll totals', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));

  const { actorId, weaponId } = await createActorWithLongsword(page);

  const powerId = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ 'system.abilities.wis.value': 14 });
    const item = actor.items.get(weaponId);
    await item.update({
      'system.intelligent.enabled': true,
      'system.intelligent.wis': 14,
      'system.intelligent.powers': [{
        _id: foundry.utils.randomID(),
        name: 'Spotting',
        type: 'feat',
        img: 'icons/svg/item-bag.svg',
        powerType: 'feat',
        egoPoints: 1,
        system: { changes: [['10', 'skill', 'skill.spt', 'untyped']] },
      }],
    });
    return item.system.intelligent.powers[0]._id;
  }, { actorId, weaponId });

  expect(powerId).toBeTruthy();

  const sheetId = await openActorItemSheet(page, actorId, weaponId);
  const win = page.locator(`#${sheetId}`);
  await goToIntelligentTab(page, win, sheetId);

  const derivedRow = win.locator('li[data-skill-id="power-spt"]');
  await expect(derivedRow).toBeVisible({ timeout: 8_000 });
  await expect(derivedRow).toContainText(/spot/i);
  await expect(derivedRow.locator('.item-detail.item-total span')).toHaveText('+12');

  await derivedRow.locator('.intel-skill-roll').click({ force: true });
  await expect(page.locator('.chat-message').last()).toContainText(/Spot/i, { timeout: 8_000 });

  await page.evaluate(async ({ actorId, weaponId }) => {
    const item = game.actors.get(actorId).items.get(weaponId);
    await item.update({
      'system.intelligent.skills': [{
        _id: 'manual-spot',
        name: 'spt',
        ability: 'wis',
        ranks: 3,
        misc: 1,
      }],
    });
  }, { actorId, weaponId });
  await page.waitForTimeout(600);

  const manualRow = win.locator('li[data-skill-id="manual-spot"]');
  await expect(manualRow).toBeVisible({ timeout: 8_000 });
  await expect(manualRow.locator('.item-detail.item-total span')).toHaveText('+16');
  await expect(win.locator('li[data-skill-id="power-spt"]')).not.toBeVisible();

  expect(jsErrors.filter((m) => /handlebars|parse error|TypeError|is not a function/i.test(m))).toEqual([]);
});

test('intelligent profile mental score draw randomizes which ability is 10', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { IntelligentItemHelper } = await import('/systems/warcraftrpg2e/module/item/helpers/intelligentItemHelper.js');
    const originalRandom = Math.random;
    const values = [0.1, 0.4, 0.8];
    const updates = [];
    try {
      for (const value of values) {
        Math.random = () => value;
        updates.push(IntelligentItemHelper.capabilitiesToUpdate({
          int: 12,
          wis: 12,
          cha: 10,
          empathy: true,
        }));
      }
    } finally {
      Math.random = originalRandom;
    }
    return updates.map((u) => ({
      int: u['system.intelligent.int'],
      wis: u['system.intelligent.wis'],
      cha: u['system.intelligent.cha'],
    }));
  });

  expect(result).toEqual([
    { int: 10, wis: 12, cha: 12 },
    { int: 12, wis: 10, cha: 12 },
    { int: 12, wis: 12, cha: 10 },
  ]);
});

test('intelligent item alignment compatibility handles SRD footnotes and actor partial axes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { IntelligentItemHelper } = await import('/systems/warcraftrpg2e/module/item/helpers/intelligentItemHelper.js');
    return {
      cnWithCg: IntelligentItemHelper.alignmentActorCompatible('cn', 'cg'),
      neWithLe: IntelligentItemHelper.alignmentActorCompatible('ne', 'le'),
      lnWithLg: IntelligentItemHelper.alignmentActorCompatible('ln', 'lg'),
      ngWithCg: IntelligentItemHelper.alignmentActorCompatible('ng', 'cg'),
      anyGoodWithGood: IntelligentItemHelper.alignmentActorCompatible('lg', 'anyg'),
      anyGoodWithNeutralGood: IntelligentItemHelper.alignmentActorCompatible('ng', 'anyg'),
      anyGoodWithChaoticNeutral: IntelligentItemHelper.alignmentActorCompatible('cn', 'anyg'),
      lawfulAnyWithLawfulEvil: IntelligentItemHelper.alignmentActorCompatible('le', 'lany'),
      lawfulAnyWithNeutralEvil: IntelligentItemHelper.alignmentActorCompatible('ne', 'lany'),
    };
  });

  expect(result).toEqual({
    cnWithCg: true,
    neWithLe: true,
    lnWithLg: true,
    ngWithCg: true,
    anyGoodWithGood: true,
    anyGoodWithNeutralGood: true,
    anyGoodWithChaoticNeutral: false,
    lawfulAnyWithLawfulEvil: true,
    lawfulAnyWithNeutralEvil: false,
  });
});

// ── A. intelligent power delete removes the row ──────────────────────────────
test('intelligent power delete removes the row', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));

  const { actorId, weaponId } = await createActorWithLongsword(page);

  const powerId = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    await item.update({ 'system.intelligent.enabled': true });
    await item.intelligentPowers.addPowerFromFeat(
      { name: 'Power Attack', type: 'feat', img: 'icons/svg/item-bag.svg', system: {} }, 1,
    );
    const powers = foundry.utils.getProperty(item.system, 'intelligent.powers') || [];
    return powers[0]?._id ?? null;
  }, { actorId, weaponId });

  expect(powerId).toBeTruthy();

  const sheetId = await openActorItemSheet(page, actorId, weaponId);
  const win = page.locator(`#${sheetId}`);
  await goToIntelligentTab(page, win, sheetId);

  // Verify the power row is visible before deletion
  const row = win.locator(`ol.inventory-list li[data-power-id="${powerId}"]`);
  await expect(row).toBeVisible({ timeout: 8_000 });

  // Shift-click the delete button to skip the confirmation dialog
  const delBtn = row.locator('a.intel-power-delete');
  await delBtn.click({ modifiers: ['Shift'] });
  await page.waitForTimeout(600);

  // Row should be gone from the DOM
  await expect(win.locator(`ol.inventory-list li[data-power-id="${powerId}"]`)).not.toBeVisible({
    timeout: 4_000,
  });

  // Verify data layer: power is no longer in item.system.intelligent.powers
  const remainingCount = await page.evaluate(({ actorId, weaponId, powerId }) => {
    const item = game.actors.get(actorId).items.get(weaponId);
    const powers = foundry.utils.getProperty(item.system, 'intelligent.powers') || [];
    return powers.filter((p) => p._id === powerId).length;
  }, { actorId, weaponId, powerId });

  expect(remainingCount).toBe(0);

  const badErrors = jsErrors.filter((m) => /TypeError|is not a function|Cannot read/i.test(m));
  expect(badErrors).toHaveLength(0);
});

// ── B. spell power usePower fires and decrements X/day charges ───────────────
test('spell power usePower fires and decrements X/day charges', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));

  const { actorId, weaponId } = await createActorWithLongsword(page);

  const powerId = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    await item.update({ 'system.intelligent.enabled': true });

    const spellSnap = {
      _id: foundry.utils.randomID(),
      name: 'Test Burning Hands',
      type: 'enhancement',
      img: 'icons/svg/item-bag.svg',
      powerType: 'spell',
      egoPoints: 0,
      system: {
        isFromSpell: true,
        baseCl: '1',
        uses: { per: 'day', max: 3, value: 3 },
        atWill: false,
      },
    };
    await item.update({ 'system.intelligent.powers': [spellSnap] });
    return spellSnap._id;
  }, { actorId, weaponId });

  const result = await page.evaluate(async ({ actorId, weaponId, powerId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    try {
      // Monkey-patch getPowerItem so the virtual item's use() resolves immediately
      // with wasRolled:true — this bypasses the attack-roll dialog while still
      // exercising the full usePower charge-decrement logic.
      const intellPowers = item.intelligentPowers;
      const origGetPowerItem = intellPowers.getPowerItem.bind(intellPowers);
      intellPowers.getPowerItem = function (pid) {
        const vItem = origGetPowerItem(pid);
        if (vItem) vItem.use = async () => ({ wasRolled: true });
        return vItem;
      };

      await item.intelligentPowers.usePower(powerId);

      // Restore original
      intellPowers.getPowerItem = origGetPowerItem;

      await new Promise((r) => setTimeout(r, 800));
      const powers = foundry.utils.getProperty(item.system, 'intelligent.powers') || [];
      const power = powers.find((p) => p._id === powerId);
      return { ok: true, usesValue: power?.system?.uses?.value ?? -1 };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, { actorId, weaponId, powerId });

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.usesValue).toBe(2);

  const badErrors = jsErrors.filter((m) => /TypeError|is not a function|Cannot read/i.test(m));
  expect(badErrors).toHaveLength(0);
});

// ── C. at-will spell power usePower does not decrement charges ────────────────
test('at-will spell power usePower does not decrement charges', async ({ page }) => {
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(err.message));

  const { actorId, weaponId } = await createActorWithLongsword(page);

  const powerId = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    await item.update({ 'system.intelligent.enabled': true });

    const spellSnap = {
      _id: foundry.utils.randomID(),
      name: 'Test At-Will Ray',
      type: 'enhancement',
      img: 'icons/svg/item-bag.svg',
      powerType: 'spell',
      egoPoints: 0,
      system: {
        isFromSpell: true,
        baseCl: '3',
        uses: { per: '', max: 0, value: 0 },
        atWill: true,
      },
    };
    await item.update({ 'system.intelligent.powers': [spellSnap] });
    return spellSnap._id;
  }, { actorId, weaponId });

  const result = await page.evaluate(async ({ actorId, weaponId, powerId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    try {
      // Same monkey-patch to bypass dialog and actual dice rolling
      const intellPowers = item.intelligentPowers;
      const origGetPowerItem = intellPowers.getPowerItem.bind(intellPowers);
      intellPowers.getPowerItem = function (pid) {
        const vItem = origGetPowerItem(pid);
        if (vItem) vItem.use = async () => ({ wasRolled: true });
        return vItem;
      };

      await item.intelligentPowers.usePower(powerId);

      // Restore original
      intellPowers.getPowerItem = origGetPowerItem;

      await new Promise((r) => setTimeout(r, 800));
      const powers = foundry.utils.getProperty(item.system, 'intelligent.powers') || [];
      const power = powers.find((p) => p._id === powerId);
      return { ok: true, usesValue: power?.system?.uses?.value ?? -1 };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, { actorId, weaponId, powerId });

  expect(result.ok, result.error ?? '').toBe(true);
  // at-will powers must never decrement — value stays 0
  expect(result.usesValue).toBe(0);

  const badErrors = jsErrors.filter((m) => /TypeError|is not a function|Cannot read/i.test(m));
  expect(badErrors).toHaveLength(0);
});

// ── D. spell power CL field is editable and persists ─────────────────────────
test('spell power CL field is editable and persists', async ({ page }) => {
  const { actorId, weaponId } = await createActorWithLongsword(page);

  const powerId = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    await item.update({ 'system.intelligent.enabled': true });

    // powerType:'spell' is required so the template renders the .intel-power-cl input
    const spellSnap = {
      _id: foundry.utils.randomID(),
      name: 'Test Magic Missile',
      type: 'enhancement',
      img: 'icons/svg/item-bag.svg',
      powerType: 'spell',
      egoPoints: 0,
      system: {
        isFromSpell: true,
        baseCl: '3',
      },
    };
    await item.update({ 'system.intelligent.powers': [spellSnap] });
    return spellSnap._id;
  }, { actorId, weaponId });

  const sheetId = await openActorItemSheet(page, actorId, weaponId);
  const win = page.locator(`#${sheetId}`);
  await goToIntelligentTab(page, win, sheetId);

  // The CL input is only rendered for spell powers ({{#if pow.isSpell}})
  const row = win.locator(`ol.inventory-list li[data-power-id="${powerId}"]`);
  await expect(row).toBeVisible({ timeout: 8_000 });

  const clInput = row.locator('.intel-power-cl');
  await expect(clInput).toBeVisible({ timeout: 4_000 });

  // Update the CL value
  await clInput.fill('7');
  await clInput.press('Tab');
  await page.waitForTimeout(600);

  // Verify persisted in item data (onClChange stores String(value))
  const savedCl = await page.evaluate(({ actorId, weaponId, powerId }) => {
    const item = game.actors.get(actorId).items.get(weaponId);
    const powers = foundry.utils.getProperty(item.system, 'intelligent.powers') || [];
    return powers.find((p) => p._id === powerId)?.system?.baseCl ?? null;
  }, { actorId, weaponId, powerId });

  expect(savedCl).toBe('7');
});

// ── E. rollPowerPool draws from lesser table and adds a power ─────────────────
test('rollPowerPool draws from lesser table and adds a power', async ({ page }) => {
  const { actorId, weaponId } = await createActorWithLongsword(page);
  await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    await item.update({ 'system.intelligent.enabled': true });
  }, { actorId, weaponId });

  const result = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);

    // Verify the pack is loaded before proceeding
    const pack = game.packs.get('warcraftrpg2e.intelligent-item-tables');
    if (!pack) return { ok: false, error: 'intelligent-item-tables pack not found' };

    const { IntelligentItemHelper } = await import(
      '/systems/warcraftrpg2e/module/item/helpers/intelligentItemHelper.js'
    );
    const powers = await IntelligentItemHelper.rollPowerPool(item, 'lesser', 1);
    if (!powers || powers.length === 0) return { ok: false, error: 'rollPowerPool returned empty array' };
    await item.update({ 'system.intelligent.powers': powers });
    await new Promise((r) => setTimeout(r, 400));
    const saved = foundry.utils.getProperty(item.system, 'intelligent.powers') || [];
    return { ok: true, count: saved.length, firstName: saved[0]?.name ?? null };
  }, { actorId, weaponId });

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.count).toBeGreaterThanOrEqual(1);
  expect(result.firstName).not.toBeNull();
});
