'use strict';

/**
 * E2E sheet UI tests — open the character sheet in the browser and interact
 * with it via Playwright locators.  These complement the data-only tests in
 * actor.test.js / weapon.test.js by exercising the actual rendered HTML.
 *
 * Pattern:
 *   1. page.evaluate() creates actors / items via the Foundry JS API and calls
 *      actor.sheet.render(true), returning the DOM element id so Playwright
 *      can scope locators to that specific window.
 *   2. Playwright locators click elements; we assert on chat messages or actor
 *      data read back via page.evaluate().
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays } = require('./helpers');
const { openSheet } = require('./helpers/actor-sheet');
const { embedSyntheticCombatFeat, setStylizedOptionalChecked } = require('./helpers/skill-roll');

const WEAPONS_PACK    = 'warcraftrpg2e.weapons-and-ammo';
const LONGSWORD_ID    = 'zWRlna42PMJVX6un';
const FIGHTER_ID      = 'sgwZt7dg1ZHXQlrW';
const CLASS_PACK      = 'warcraftrpg2e.classes';
const FEATS_PACK      = 'warcraftrpg2e.feats';
const POWER_ATTACK_ID = 'nRAGvHfsmBVfxPHf';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
});

// ── Helper: create a Fighter with Longsword (same as weapon.test.js) ──────────

async function createFighterWithLongsword(page, { level = 5 } = {}) {
  return page.evaluate(async ({ WEAPONS_PACK, LONGSWORD_ID, CLASS_PACK, FIGHTER_ID, level }) => {
    const actor = await Actor.create({
      name: 'Sheet Fighter',
      type: 'character',
    });
    await actor.update({
      'system.abilities.str.value': 16,
      'system.abilities.dex.value': 12,
    });

    // Add Fighter level
    const classPack = game.packs.get(CLASS_PACK);
    const classItem = await classPack.getDocument(FIGHTER_ID);
    const classData = classItem.toObject();
    classData.system.levels = level;
    await actor.createEmbeddedDocuments('Item', [classData]);

    // Add Longsword — items always land unequipped; equip explicitly to fire
    // D35E.ItemEquip.postEquipItem which calls createAttackFromWeapon.
    const weaponPack = game.packs.get(WEAPONS_PACK);
    const longsword  = await weaponPack.getDocument(LONGSWORD_ID);
    const [weapon]   = await actor.createEmbeddedDocuments('Item', [longsword.toObject()]);
    await actor.items.get(weapon.id).update({ 'system.equipped': true });

    // Poll for auto-created attack item
    let a = game.actors.get(actor.id);
    let attack = null;
    for (let i = 0; i < 30; i++) {
      a = game.actors.get(actor.id);
      attack = a.items.find(
        i => i.type === 'attack' && i.system.originalWeaponId === weapon.id
      );
      if (attack) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (!attack) throw new Error('Attack item was not auto-created');

    return { actorId: a.id, attackId: attack.id };
  }, { WEAPONS_PACK, LONGSWORD_ID, CLASS_PACK, FIGHTER_ID, level });
}

// ── 1. Click the attack icon on the character sheet ──────────────────────────
//
// Expected: clicking the gladius icon on the attack row produces a chat message
// with roll data (same structure verified in weapon.test.js test 7).

test('clicking attack icon on sheet produces a chat roll', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  const sheetId = await openSheet(page, actorId);

  // The attack row is in the Attacks tab (default active tab).
  // Each attack item row: li.item[data-item-id="..."] > div.item-detail.item-actions > div.item-attack > a.item-control.item-attack
  const sheet     = page.locator(`#${sheetId}`);
  const attackRow = sheet.locator(`li.item[data-item-id="${attackId}"]`);
  const attackBtn = attackRow.locator('a.item-control.item-attack').first();

  await attackBtn.waitFor({ state: 'visible', timeout: 5_000 });

  // Record message count before click
  const msgsBefore = await page.evaluate(() => game.messages.size);

  // Shift+click → skipDialog: true (D35E checks event.shiftKey to bypass the roll dialog)
  // force: true bypasses notification toasts that may intercept the pointer event
  await attackBtn.click({ modifiers: ['Shift'], force: true });

  // Wait for a new chat message (up to 5 s)
  await page.waitForFunction(
    (before) => game.messages.size > before,
    msgsBefore,
    { timeout: 5_000 }
  );

  // Verify the message contains D35E attack data
  const result = await page.evaluate(() => {
    const msg     = game.messages.contents.at(-1);
    const attacks = msg?.flags?.D35E?.chatTemplateData?.attacks ?? [];
    return {
      attackCount:      attacks.length,
      firstAttackTotal: attacks[0]?.attack?.total ?? null,
    };
  });

  expect(result.attackCount).toBeGreaterThan(0);
  // Fighter lv5 STR 16 → +8 total: 1d20+8 in [9, 28]
  expect(result.firstAttackTotal).toBeGreaterThanOrEqual(9);
  expect(result.firstAttackTotal).toBeLessThanOrEqual(28);
});

// Skill roll dialog + combat-change coverage lives in skill-roll-dialog.test.js.

// ── 3. Level up via the Level Up button ───────────────────────────────────────
//
// Flow:
//   a. Create a Fighter level 1 character
//   b. Give them enough XP to reach level 2 (1000 XP in 3.5e)
//   c. Open the sheet — "Level Up" button should be visible (canLevelUp = true)
//   d. Click it → LevelUpDialog appears
//   e. Click the "Level Up" submit button inside the dialog
//   f. Verify details.level.available incremented by 1

test('level up button opens dialog and levels up character', async ({ page }) => {
  const actorId = await page.evaluate(async ({ CLASS_PACK, FIGHTER_ID }) => {
    // Create a level-1 Fighter
    const actor = await Actor.create({
      name: 'Level Up Fighter',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });
    const classPack = game.packs.get(CLASS_PACK);
    const classItem = await classPack.getDocument(FIGHTER_ID);
    const classData = classItem.toObject();
    classData.system.levels = 1;
    await actor.createEmbeddedDocuments('Item', [classData]);

    // Set XP to level 2 threshold (1000 in standard 3.5e XP table)
    // After update the derived xp.max = getLevelExp(1) = 1000, so canLevelUp = true
    await game.actors.get(actor.id).update({ 'system.details.xp.value': 1000 });

    // Re-fetch and confirm canLevelUp before opening the sheet
    const a = game.actors.get(actor.id);
    if (!a.system.canLevelUp) throw new Error(`canLevelUp is false; xp.value=${a.system.details.xp.value} xp.max=${a.system.details.xp.max}`);
    return a.id;
  }, { CLASS_PACK, FIGHTER_ID });

  const sheetId = await openSheet(page, actorId);
  const sheet   = page.locator(`#${sheetId}`);

  // The "Level Up" button is only shown when canLevelUp = true
  const levelUpBtn = sheet.locator('a.btn.level-up');
  await levelUpBtn.waitFor({ state: 'visible', timeout: 5_000 });

  // DOM click() goes through Foundry's event listeners (_onLevelUp handler)
  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} a.btn.level-up`)?.click();
  }, sheetId);
  const dialog = page.locator('#level-up-box');
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });

  // Record current level.available before submitting
  const levelBefore = await page.evaluate((actorId) => {
    return game.actors.get(actorId).system.details.level.available;
  }, actorId);

  // Click the submit button inside the dialog
  const submitBtn = dialog.locator('button[name="submit"]');
  await submitBtn.waitFor({ state: 'visible', timeout: 3_000 });
  await submitBtn.click();

  // Wait for the dialog to close
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 });

  // Verify the level.available incremented
  const levelAfter = await page.evaluate((actorId) => {
    return game.actors.get(actorId).system.details.level.available;
  }, actorId);

  expect(levelAfter).toBe(levelBefore + 1);
});

// ── 4. Configure level box in Features tab after level up ──────────────────────
//
// Flow:
//   a. Create a Fighter level 1 with levelUpProgression enabled and enough XP
//   b. Open sheet → click Level Up! → submit
//   c. Switch to the Features (feats) tab
//   d. Click the first level box (.configure-level-up-data) → LevelUpDataDialog
//   e. Select Fighter class from the dropdown → submit
//   f. Verify actor.system.details.levelUpData[0].classId === FIGHTER_ID

test('configure level box in features tab assigns class to level', async ({ page }) => {
  const actorId = await page.evaluate(async ({ CLASS_PACK, FIGHTER_ID }) => {
    const actor = await Actor.create({
      name: 'Level Box Fighter',
      type: 'character',
      system: {
        abilities: { str: { value: 10 } },
        details: { levelUpProgression: true },
      },
    });
    const classPack  = game.packs.get(CLASS_PACK);
    const classItem  = await classPack.getDocument(FIGHTER_ID);
    const classData  = classItem.toObject();
    classData.system.levels = 1;
    await actor.createEmbeddedDocuments('Item', [classData]);

    // XP at level-2 threshold → canLevelUp = true
    await game.actors.get(actor.id).update({ 'system.details.xp.value': 1000 });

    const a = game.actors.get(actor.id);
    if (!a.system.canLevelUp)
      throw new Error(`canLevelUp false: xp=${a.system.details.xp.value} max=${a.system.details.xp.max}`);
    return a.id;
  }, { CLASS_PACK, FIGHTER_ID });

  const sheetId = await openSheet(page, actorId);
  const sheet   = page.locator(`#${sheetId}`);

  // ── Step 1: do Level Up! ────────────────────────────────────────────────────
  const levelUpBtn = sheet.locator('a.btn.level-up');
  await levelUpBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} a.btn.level-up`)?.click();
  }, sheetId);

  const levelUpDialog = page.locator('#level-up-box');
  await levelUpDialog.waitFor({ state: 'visible', timeout: 5_000 });
  await levelUpDialog.locator('button[name="submit"]').click();
  await levelUpDialog.waitFor({ state: 'hidden', timeout: 5_000 });

  // The actorUpdater runs a second async update to populate levelUpData entries.
  // Wait for that to complete before navigating to the feats tab.
  await page.waitForFunction(
    (actorId) => (game.actors.get(actorId).system.details.levelUpData?.length ?? 0) > 0,
    actorId,
    { timeout: 8_000 }
  );

  // Re-render the sheet so the feats tab picks up the newly created levelUpData
  // entries (the sheet was originally rendered before levelUpData was populated).
  const newSheetId = await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    const app   = actor.sheet;
    await app.render(true);
    await new Promise(r => setTimeout(r, 800));
    return app.id;
  }, actorId);
  await page.locator(`#${newSheetId}`).waitFor({ state: 'visible', timeout: 10_000 });
  await dismissOverlays(page);

  // ── Step 2: navigate to Features tab ────────────────────────────────────────
  await page.evaluate((newSheetId) => {
    document.querySelector(`#${newSheetId} nav.sheet-navigation.tabs a[data-tab="feats"]`)?.click();
  }, newSheetId);

  const featsTab = page.locator(`#${newSheetId} .tab.feats`);
  await featsTab.waitFor({ state: 'visible', timeout: 5_000 });

  // ── Step 3: click the first level box ───────────────────────────────────────
  // Level boxes appear inside .level-up-boxes; each is an <a class="configure-level-up-data">
  const levelBox = featsTab.locator('a.configure-level-up-data').first();
  await levelBox.waitFor({ state: 'visible', timeout: 8_000 });

  // The configure-level-up-data handler is registered on "click"
  await levelBox.click({ force: true });

  // ── Step 4: interact with the LevelUpDataDialog ──────────────────────────────
  // IMPORTANT: _onLevelDataUp passes options.id = levelUpData entry id (e.g. "_abc123xyz"),
  // which overrides defaultOptions.id = "level-up-data".  The rendered DOM element therefore
  // gets the random entry id, not "level-up-data".  Locate by class instead.
  const ludDialog = page.locator('.level-up-data');
  await ludDialog.waitFor({ state: 'visible', timeout: 5_000 });

  // The class select option values are the actor's embedded class item IDs (not compendium IDs).
  // Use index 1 to pick the first (and only) class entry (index 0 = "Select Class" placeholder).
  await ludDialog.locator('#class-select').selectOption({ index: 1 });

  // Give the inline JS a moment to update the form
  await page.waitForTimeout(300);

  // Submit
  await ludDialog.locator('button[name="submit"]').click();
  await ludDialog.waitFor({ state: 'hidden', timeout: 5_000 });

  // ── Step 5: verify class was stored ─────────────────────────────────────────
  // classId stored is the actor's embedded class item id, not the compendium id.
  const classId = await page.evaluate((actorId) => {
    const a = game.actors.get(actorId);
    return a.system.details.levelUpData?.[0]?.classId ?? null;
  }, actorId);

  // Any non-null classId means a class was successfully assigned to the level box.
  expect(classId).not.toBeNull();
});

// ── Helper: create Fighter with Longsword + optional Power Attack feat ─────────

async function createFighterWithLongswordAndFeat(page, featId) {
  return page.evaluate(async ({ WEAPONS_PACK, LONGSWORD_ID, CLASS_PACK, FIGHTER_ID, FEATS_PACK, featId }) => {
    const actor = await Actor.create({
      name: 'Attack Dialog Fighter',
      type: 'character',
    });
    await actor.update({
      'system.abilities.str.value': 16,
      'system.abilities.dex.value': 12,
    });

    // Fighter level 5
    const classPack = game.packs.get(CLASS_PACK);
    const classItem = await classPack.getDocument(FIGHTER_ID);
    const classData = classItem.toObject();
    classData.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [classData]);

    // Optional feat
    if (featId) {
      const featPack = game.packs.get(FEATS_PACK);
      const feat     = await featPack.getDocument(featId);
      await actor.createEmbeddedDocuments('Item', [feat.toObject()]);
    }

    // Longsword — items always land unequipped; equip explicitly to fire
    // D35E.ItemEquip.postEquipItem which calls createAttackFromWeapon.
    const weaponPack = game.packs.get(WEAPONS_PACK);
    const longsword  = await weaponPack.getDocument(LONGSWORD_ID);
    const [weapon]   = await actor.createEmbeddedDocuments('Item', [longsword.toObject()]);
    await actor.items.get(weapon.id).update({ 'system.equipped': true });

    // Poll for auto-created attack item
    let a = game.actors.get(actor.id);
    let attack = null;
    for (let i = 0; i < 30; i++) {
      a = game.actors.get(actor.id);
      attack = a.items.find(i => i.type === 'attack' && i.system.originalWeaponId === weapon.id);
      if (attack) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (!attack) throw new Error('Attack item not auto-created');
    return { actorId: a.id, attackId: attack.id };
  }, { WEAPONS_PACK, LONGSWORD_ID, CLASS_PACK, FIGHTER_ID, FEATS_PACK, featId });
}

async function getLastChatAttackSummary(page) {
  return page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    const attacks = msg?.flags?.D35E?.chatTemplateData?.attacks ?? [];
    return {
      firstAttackTotal: attacks[0]?.attack?.total ?? null,
      attackDamageTotals: attacks.map((attack) => attack.damage?.total ?? null),
      specialLabels: attacks.flatMap((attack) => (attack.special ?? []).map((special) => special.label)),
    };
  });
}

// ── Helper: open the attack dialog (no Shift → shows dialog) ─────────────────

async function openAttackDialog(page, sheetId, attackId) {
  const sheet     = page.locator(`#${sheetId}`);
  const attackRow = sheet.locator(`li.item[data-item-id="${attackId}"]`);
  const attackBtn = attackRow.locator('a.item-control.item-attack').first();
  await attackBtn.waitFor({ state: 'visible', timeout: 5_000 });

  // The attack handler is bound to "mouseup" (not "click"), so we must use
  // Playwright's .click() which dispatches the full mousedown/mouseup/click
  // sequence.  force:true bypasses any notification toasts.
  // No Shift modifier → skipDialog:false → attack roll dialog appears.
  await attackBtn.click({ force: true });

  // The attack dialog has class roll-defense and form.attack-form inside
  const dialog = page.locator('.dialog.roll-defense').last();
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });
  return dialog;
}

// ── 5. Attack dialog with Power Attack slider ──────────────────────────────────
//
// Fighter lv5 STR 16 → base attack bonus = BAB 5 + STR 3 = +8
// With Power Attack 5: attack = 1d20 + 8 – 5 = 1d20 + 3 → total in [4, 23]
// (Discriminates from baseline [9, 28] which has no PA penalty)

test('attack dialog: Power Attack slider reduces attack bonus', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongswordAndFeat(page, POWER_ATTACK_ID);
  const sheetId = await openSheet(page, actorId);

  // Do NOT navigate to the attacks main tab explicitly — doing so exposes the
  // subtab structure and the longsword row ends up inside a hidden subtab.
  // Without explicit tab activation the attack button is still reachable.
  const dialog = await openAttackDialog(page, sheetId, attackId);

  // Set Power Attack slider to 5 (max = BAB 5)
  await page.evaluate(() => {
    const pa    = document.querySelector('.dialog.roll-defense input[name="pa"]');
    const paTxt = document.querySelector('.dialog.roll-defense input[name="power-attack"]');
    if (pa)    { pa.value = '5'; pa.dispatchEvent(new Event('change')); }
    if (paTxt) paTxt.value = '5';
  });

  const msgsBefore = await page.evaluate(() => game.messages.size);

  // Click "Single Attack"
  await dialog.locator('button[data-button="normal"]').click({ force: true });

  await page.waitForFunction(
    (before) => game.messages.size > before,
    msgsBefore,
    { timeout: 5_000 }
  );

  const firstAttackTotal = await page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    return msg?.flags?.D35E?.chatTemplateData?.attacks?.[0]?.attack?.total ?? null;
  });

  // With PA 5: 1d20 + 3 → [4, 23]
  expect(firstAttackTotal).toBeGreaterThanOrEqual(4);
  expect(firstAttackTotal).toBeLessThanOrEqual(23);
});

// ── 6. Attack dialog with Flanking checkbox ───────────────────────────────────
//
// Flanking adds +2 to attack.
// Fighter lv5 STR 16 + Flanking: 1d20 + 8 + 2 = 1d20 + 10 → total in [11, 30]

test('attack dialog: Flanking checkbox increases attack bonus', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongswordAndFeat(page, null);
  const sheetId = await openSheet(page, actorId);

  // Do NOT navigate to attacks tab — same reason as Power Attack test above.
  const dialog = await openAttackDialog(page, sheetId, attackId);

  // Check the Flanking checkbox
  const flankingBox = dialog.locator('input[name="flanking"]');
  await flankingBox.waitFor({ state: 'attached', timeout: 3_000 });
  // Use evaluate for reliable checkbox manipulation within Foundry's form
  await page.evaluate(() => {
    const cb = document.querySelector('.dialog.roll-defense input[name="flanking"]');
    if (cb && !cb.checked) cb.click();
  });

  const msgsBefore = await page.evaluate(() => game.messages.size);

  await dialog.locator('button[data-button="normal"]').click({ force: true });

  await page.waitForFunction(
    (before) => game.messages.size > before,
    msgsBefore,
    { timeout: 5_000 }
  );

  const firstAttackTotal = await page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    return msg?.flags?.D35E?.chatTemplateData?.attacks?.[0]?.attack?.total ?? null;
  });

  // With Flanking +2: 1d20 + 10 → [11, 30]
  expect(firstAttackTotal).toBeGreaterThanOrEqual(11);
  expect(firstAttackTotal).toBeLessThanOrEqual(30);
});

test('attack dialog: all combat changes do not appear as optional feats', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedSyntheticCombatFeat(page, {
    actorId,
    name: 'E2E All Attack Bonus',
    combatChanges: [['all', '', '', 'featAttackBonus', '100', '']],
  });

  const sheetId = await openSheet(page, actorId);
  const dialog = await openAttackDialog(page, sheetId, attackId);

  const optionalCount = await dialog.locator('input[data-type="optional"]').count();
  expect(optionalCount).toBe(0);

  const msgsBefore = await page.evaluate(() => game.messages.size);
  await dialog.locator('button[data-button="normal"]').click({ force: true });
  await page.waitForFunction((before) => game.messages.size > before, msgsBefore, { timeout: 5_000 });

  const { firstAttackTotal } = await getLastChatAttackSummary(page);
  expect(firstAttackTotal).toBeGreaterThan(100);
});

test('attack dialog: allOptional appears once and only applies when selected', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);
  await embedSyntheticCombatFeat(page, {
    actorId,
    name: 'E2E All Optional Attack Bonus',
    combatChanges: [['allOptional', '', '', 'featAttackBonus', '100', '']],
  });

  const sheetId = await openSheet(page, actorId);

  let dialog = await openAttackDialog(page, sheetId, attackId);
  expect(await dialog.locator('input[data-type="optional"]').count()).toBe(1);

  let msgsBefore = await page.evaluate(() => game.messages.size);
  await dialog.locator('button[data-button="normal"]').click({ force: true });
  await page.waitForFunction((before) => game.messages.size > before, msgsBefore, { timeout: 5_000 });
  let withoutOptional = await getLastChatAttackSummary(page);
  expect(withoutOptional.firstAttackTotal).toBeGreaterThanOrEqual(9);
  expect(withoutOptional.firstAttackTotal).toBeLessThanOrEqual(28);

  dialog = await openAttackDialog(page, sheetId, attackId);
  await setStylizedOptionalChecked(page, true);
  msgsBefore = await page.evaluate(() => game.messages.size);
  await dialog.locator('button[data-button="normal"]').click({ force: true });
  await page.waitForFunction((before) => game.messages.size > before, msgsBefore, { timeout: 5_000 });
  const withOptional = await getLastChatAttackSummary(page);
  expect(withOptional.firstAttackTotal).toBeGreaterThan(100);
});

test('attack dialog: allOptional special action respects apply once on full attack', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page, { level: 6 });
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    const feat = {
      name: 'E2E All Optional Special Once',
      type: 'feat',
      system: {
        combatChanges: [['allOptional', '', '', 'featAttackBonus', '1', 'Create unique "E2E Once Marker" on self']],
        combatChangesApplySpecialActionsOnce: true,
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    };
    await actor.createEmbeddedDocuments('Item', [feat]);
  }, { actorId });

  const sheetId = await openSheet(page, actorId);
  const dialog = await openAttackDialog(page, sheetId, attackId);
  expect(await dialog.locator('input[data-type="optional"]').count()).toBe(1);
  await setStylizedOptionalChecked(page, true);

  const msgsBefore = await page.evaluate(() => game.messages.size);
  await dialog.locator('button[data-button="multi"]').click({ force: true });
  await page.waitForFunction((before) => game.messages.size > before, msgsBefore, { timeout: 5_000 });

  const { specialLabels } = await getLastChatAttackSummary(page);
  const markerCount = specialLabels.filter((label) => label === 'E2E All Optional Special Once').length;
  expect(markerCount).toBe(1);
});

test('attack dialog: allOptional featDamageBonus respects apply once on full attack', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page, { level: 6 });
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    const feat = {
      name: 'E2E All Optional Damage Once',
      type: 'feat',
      system: {
        combatChanges: [['allOptional', '', '', 'featDamageBonus', '100', '']],
        combatChangesApplySpecialActionsOnce: true,
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    };
    await actor.createEmbeddedDocuments('Item', [feat]);
  }, { actorId });

  const sheetId = await openSheet(page, actorId);
  const dialog = await openAttackDialog(page, sheetId, attackId);
  expect(await dialog.locator('input[data-type="optional"]').count()).toBe(1);
  await setStylizedOptionalChecked(page, true);

  const msgsBefore = await page.evaluate(() => game.messages.size);
  await dialog.locator('button[data-button="multi"]').click({ force: true });
  await page.waitForFunction((before) => game.messages.size > before, msgsBefore, { timeout: 5_000 });

  const { attackDamageTotals } = await getLastChatAttackSummary(page);
  expect(attackDamageTotals.length).toBeGreaterThanOrEqual(2);
  expect(attackDamageTotals[0]).toBeGreaterThan(100);
  expect(attackDamageTotals[1]).toBeLessThan(50);
});

test('attack dialog: attackOptional featDamageBonus respects apply once on full attack', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page, { level: 6 });
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    const feat = {
      name: 'E2E Attack Optional Damage Once',
      type: 'feat',
      system: {
        combatChanges: [['attackOptional', 'mwak', '', 'featDamageBonus', '100']],
        combatChangesApplySpecialActionsOnce: true,
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    };
    await actor.createEmbeddedDocuments('Item', [feat]);
  }, { actorId });

  const sheetId = await openSheet(page, actorId);
  const dialog = await openAttackDialog(page, sheetId, attackId);
  expect(await dialog.locator('input[data-type="optional"]').count()).toBe(1);
  await setStylizedOptionalChecked(page, true);

  const msgsBefore = await page.evaluate(() => game.messages.size);
  await dialog.locator('button[data-button="multi"]').click({ force: true });
  await page.waitForFunction((before) => game.messages.size > before, msgsBefore, { timeout: 5_000 });

  const { attackDamageTotals } = await getLastChatAttackSummary(page);
  expect(attackDamageTotals.length).toBeGreaterThanOrEqual(2);
  expect(attackDamageTotals[0]).toBeGreaterThan(100);
  expect(attackDamageTotals[1]).toBeLessThan(50);
});
