'use strict';

/**
 * E2E tests for issue 1543: ammunition notes should appear in attack chat cards.
 *
 * Two bugs were fixed:
 *  1. use.js line 1331: `ammo.system.bonusAmmoNote` → `ammo.system.bonusAmmoAttackNote`
 *     (useAmmoNote was always "" so ammo notes never reached the chat card).
 *  2. valuable.html line 109: `{{data.systembonusAmmoAttackNote}}` →
 *     `{{data.system.bonusAmmoAttackNote}}` (textarea rendered blank when re-opening sheet).
 *
 * Tests:
 *  1. Ammo bonusAmmoAttackNote appears in the attack chat card extraText.
 *  2. Re-opening an ammo item sheet shows the correct bonusAmmoAttackNote value.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── 1. Ammo note appears in attack chat card ──────────────────────────────────
//
// Creates a ranged attack item + an ammo item with bonusAmmoAttackNote.
// Calls rollAttack() with a synthetic form so the ammo is "selected" — this
// is exactly the path fixed by the bonusAmmoNote → bonusAmmoAttackNote change.

test('ammo bonusAmmoAttackNote is included in the attack chat card', async ({ page }) => {
  const AMMO_NOTE = 'Test ammo note';

  const msgsBefore = await page.evaluate(() => game.messages.size);

  const result = await page.evaluate(async (ammoNote) => {
    // ── 1. Create actor ───────────────────────────────────────────────────────
    const actor = await Actor.create({ name: 'Ammo Note Archer', type: 'character' });
    await actor.update({
      'system.abilities.dex.value': 14,
      'system.attributes.hp.value': 20,
      'system.attributes.hp.max': 20,
    });
    const a = game.actors.get(actor.id);

    // ── 2. Create ranged attack item ──────────────────────────────────────────
    const [attack] = await a.createEmbeddedDocuments('Item', [{
      name: 'Shortbow Attack',
      type: 'attack',
    }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': 'dex',
      'system.attackParts': [],
      'system.damage.parts': [['1d6', 'P']],
    });

    // ── 3. Create ammo item with bonusAmmoAttackNote ──────────────────────────
    const [ammo] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Magic Arrows',
      type: 'loot',
    }]);
    await game.actors.get(actor.id).items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.quantity': 20,
      'system.bonusAmmoAttackNote': ammoNote,
    });

    // ── 4. Build a synthetic form with ammo inputs ────────────────────────────
    // extractFormData() reads these inputs to populate useAmmoNote, then
    // overrides it with ammo.system.bonusAmmoAttackNote (the bug fix).
    const freshActor = game.actors.get(actor.id);
    const freshAttack = freshActor.items.get(attack.id);
    const freshAmmo   = freshActor.items.get(ammo.id);

    const form = document.createElement('div');
    const addInput = (name, value = '') => {
      const el = document.createElement('input');
      el.setAttribute('name', name);
      el.value = String(value);
      form.appendChild(el);
    };
    addInput('ammunition-id',    freshAmmo.id);
    addInput('ammo-dmg-formula', '');
    addInput('ammo-dmg-type',    '');
    addInput('ammo-dmg-uid',     '');
    addInput('ammo-attack',      '');
    addInput('ammo-enh',         '');
    addInput('ammo-note',        ''); // initially blank — gets overridden from item data
    addInput('ammo-name',        freshAmmo.name);

    // ── 5. Set up rollData (mirrors the setup in useAttack) ───────────────────
    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    // ── 6. Roll the attack with the ammo form ─────────────────────────────────
    const msgCountBefore = game.messages.size;
    await freshAttack.uses.rollAttack(false, form, false, freshActor, rollData, true);

    // Poll up to 3 s for the new chat message
    for (let i = 0; i < 30; i++) {
      if (game.messages.size > msgCountBefore) break;
      await new Promise(r => setTimeout(r, 100));
    }

    const msg = game.messages.contents.at(-1);
    if (!msg) return { error: 'no chat message created', extraText: '' };

    const chatTD = msg.flags?.warcraftrpg2e?.chatTemplateData ?? {};
    return {
      extraText:   chatTD.extraText   ?? '',
      msgContent:  msg.content        ?? '',
      newMessages: game.messages.size - msgCountBefore,
    };
  }, AMMO_NOTE);

  // A new message should have appeared
  expect(result.newMessages).toBeGreaterThan(0);

  // The ammo note must appear somewhere in the chat card data
  const noteFound = result.extraText.includes(AMMO_NOTE) || result.msgContent.includes(AMMO_NOTE);
  expect(noteFound).toBe(true);
});

// ── 2. Ammo item sheet textarea shows bonusAmmoAttackNote (template fix) ──────
//
// Verifies that the <textarea name="system.bonusAmmoAttackNote"> in the loot
// sheet is pre-populated with the saved value when the sheet is re-opened.
// This exercises the template path fixed by adding the missing dot in
// `{{data.system.bonusAmmoAttackNote}}`.

test('ammo item sheet textarea shows bonusAmmoAttackNote value', async ({ page }) => {
  const AMMO_NOTE = 'Arrow note template fix';

  // Create a world-level loot item of subType ammo with the note set
  const { itemId, sheetId } = await page.evaluate(async (ammoNote) => {
    // Create minimal, then update (two-step pattern)
    const item = await Item.create({ name: 'Test Ammo Item', type: 'loot' });
    await item.update({
      'system.subType': 'ammo',
      'system.bonusAmmoAttackNote': ammoNote,
    });

    // Open the item sheet
    const fresh = game.items.get(item.id);
    await fresh.sheet.render(true);
    await new Promise(r => setTimeout(r, 600));
    return { itemId: item.id, sheetId: fresh.sheet.id };
  }, AMMO_NOTE);

  // Wait for the sheet to appear in the DOM
  const sheetLocator = page.locator(`#${sheetId}`);
  await sheetLocator.waitFor({ state: 'visible', timeout: 10_000 });
  await dismissOverlays(page);

  // Navigate to the "Details" tab where the ammo bonus fields live
  await page.evaluate((sheetId) => {
    document.querySelector(`#${sheetId} nav.tabs a[data-tab="details"]`)?.click();
  }, sheetId);
  await page.locator(`#${sheetId} .tab.details`).waitFor({ state: 'visible', timeout: 5_000 });

  // The textarea must show the saved note (not empty after the template fix)
  const textarea = sheetLocator.locator('textarea[name="system.bonusAmmoAttackNote"]');
  await textarea.waitFor({ state: 'visible', timeout: 5_000 });
  const value = await textarea.inputValue();
  expect(value).toBe(AMMO_NOTE);
});

// ── 3. Without ammo the extraText does NOT contain a stale note ───────────────
//
// Regression guard: rolling without any ammo selected (skipDialog=true) must
// not produce any note in the chat card.  The attack item's own attackNotes
// field is empty, so extraText should be empty / not contain the ammo note.

test('attack without ammo selected does not inject ammo note into chat card', async ({ page }) => {
  const AMMO_NOTE = 'Should not appear';

  const result = await page.evaluate(async (ammoNote) => {
    const actor = await Actor.create({ name: 'No-Ammo Archer', type: 'character' });
    await actor.update({ 'system.abilities.dex.value': 14 });

    const a = game.actors.get(actor.id);
    const [attack] = await a.createEmbeddedDocuments('Item', [{ name: 'Shortbow', type: 'attack' }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': 'dex',
      'system.attackParts': [],
      'system.damage.parts': [['1d6', 'P']],
    });

    // Also create an ammo item with a note – but do NOT select it in the form
    const [ammo] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{ name: 'Magic Arrows', type: 'loot' }]);
    await game.actors.get(actor.id).items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.bonusAmmoAttackNote': ammoNote,
    });

    const freshActor  = game.actors.get(actor.id);
    const freshAttack = freshActor.items.get(attack.id);

    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    const msgCountBefore = game.messages.size;
    // Roll with NO form (skipDialog path — ammo is never processed)
    await freshAttack.uses.rollAttack(false, null, false, freshActor, rollData, true);

    for (let i = 0; i < 30; i++) {
      if (game.messages.size > msgCountBefore) break;
      await new Promise(r => setTimeout(r, 100));
    }

    const msg = game.messages.contents.at(-1);
    const chatTD = msg?.flags?.warcraftrpg2e?.chatTemplateData ?? {};
    return {
      extraText:  chatTD.extraText ?? '',
      msgContent: msg?.content ?? '',
    };
  }, AMMO_NOTE);

  // The note must NOT appear in the chat card
  const noteFound = result.extraText.includes(AMMO_NOTE) || result.msgContent.includes(AMMO_NOTE);
  expect(noteFound).toBe(false);
});
