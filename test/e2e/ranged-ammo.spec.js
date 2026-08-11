'use strict';

/**
 * E2E tests for ranged weapon ammo behaviour in D35E.
 *
 * Covers four scenarios introduced / fixed in the ranged-ammo feature branch:
 *
 *  1. Normal ammo consumption  – selecting an ammo item via the synthetic form
 *     causes its quantity to drop by 1 after rollAttack().
 *
 *  2. noAmmoRequired flag      – when the attack item has `noAmmoRequired: true`
 *     the template renders a hidden "none" ammunition-id input; rolling with that
 *     form leaves ammo quantity unchanged AND still produces a chat message.
 *
 *  3. infiniteAmmo flag        – when the selected ammo item has
 *     `infiniteAmmo: true` the quantity is NOT decremented even though the ammo
 *     item IS selected in the form.
 *
 *  4. Auto ammo recovery       – the world setting `useAutoAmmoRecovery` enables
 *     a 50 % chance of recovering 1 ammo on a miss via
 *     `actor.quickChangeItemQuantity(ammoId, 1)`.  This test verifies:
 *       a) rolling an attack decrements quantity from 10 → 9, and
 *       b) calling `quickChangeItemQuantity(ammoId, 1)` restores it to 10,
 *          which is exactly what `actorDamageHelper.js` does on recovery.
 *     The probabilistic nature of the 50 % roll means the full damage-helper
 *     path is tested separately; here we confirm the helper function itself
 *     and the setting infrastructure work correctly.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

// ── Shared helper: build a synthetic attack-roll dialog form ──────────────────

/**
 * Returns JS source (a string) that, when eval'd inside page.evaluate, creates
 * a <div> element that looks like the populated attack-roll dialog form so that
 * rollAttack() can read ammunition-id and related fields from it.
 *
 * @param {'ammoId'|'none'} ammoSelector  'ammoId' means we insert the variable
 *   `ammoId` as the value; 'none' means the string literal 'none'.
 */
function syntheticFormSrc(ammoSelector) {
  const idValue = ammoSelector === 'none' ? "'none'" : 'ammoId';
  return `
    const form = document.createElement('div');
    const addInput = (name, value) => {
      const el = document.createElement('input');
      el.setAttribute('name', name);
      el.value = String(value === undefined ? '' : value);
      form.appendChild(el);
    };
    addInput('ammunition-id',    ${idValue});
    addInput('ammo-dmg-formula', '');
    addInput('ammo-dmg-type',    '');
    addInput('ammo-dmg-uid',     '');
    addInput('ammo-attack',      '');
    addInput('ammo-enh',         '');
    addInput('ammo-note',        '');
    addInput('ammo-name',        ammoName);
  `;
}

// ── beforeEach ────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── 1. Normal ammo consumption ────────────────────────────────────────────────
//
// Rolling a ranged attack with a real ammo item selected should decrement that
// item's quantity by 1.

test('normal ammo consumption: quantity decreases by 1 after rollAttack', async ({ page }) => {
  const { actorId, ammoId } = await page.evaluate(async () => {
    // ── Create actor ──────────────────────────────────────────────────────────
    const actor = await Actor.create({ name: 'Ammo Archer', type: 'character' });
    await actor.update({
      'system.abilities.dex.value': 14,
      'system.attributes.hp.value': 10,
      'system.attributes.hp.max': 10,
    });

    // ── Create ranged attack item ─────────────────────────────────────────────
    const a = game.actors.get(actor.id);
    const [attack] = await a.createEmbeddedDocuments('Item', [{
      name: 'Shortbow',
      type: 'attack',
    }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': 'dex',
      'system.attackParts': [],
      'system.damage.parts': [['1d6', 'P']],
    });

    // ── Create ammo item (quantity 10) ────────────────────────────────────────
    const [ammo] = await a.createEmbeddedDocuments('Item', [{ name: 'Arrows', type: 'loot' }]);
    await game.actors.get(actor.id).items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.quantity': 10,
    });

    // ── Build synthetic form ──────────────────────────────────────────────────
    const freshActor  = game.actors.get(actor.id);
    const freshAttack = freshActor.items.get(attack.id);
    const freshAmmo   = freshActor.items.get(ammo.id);
    const ammoId      = freshAmmo.id;
    const ammoName    = freshAmmo.name;

    const form = document.createElement('div');
    const addInput = (name, value) => {
      const el = document.createElement('input');
      el.setAttribute('name', name);
      el.value = String(value === undefined ? '' : value);
      form.appendChild(el);
    };
    addInput('ammunition-id',    ammoId);
    addInput('ammo-dmg-formula', '');
    addInput('ammo-dmg-type',    '');
    addInput('ammo-dmg-uid',     '');
    addInput('ammo-attack',      '');
    addInput('ammo-enh',         '');
    addInput('ammo-note',        '');
    addInput('ammo-name',        ammoName);

    // ── Roll attack ───────────────────────────────────────────────────────────
    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    await freshAttack.uses.rollAttack(false, form, false, freshActor, rollData, true);

    return { actorId: actor.id, ammoId };
  });

  // Poll until quantity drops to 9 (async DB write)
  await page.waitForFunction(
    ({ actorId, ammoId }) => {
      const actor = game.actors.get(actorId);
      return actor?.items.get(ammoId)?.system.quantity === 9;
    },
    { actorId, ammoId },
    { timeout: 8_000 },
  );

  const qty = await page.evaluate(
    ({ actorId, ammoId }) => game.actors.get(actorId)?.items.get(ammoId)?.system.quantity,
    { actorId, ammoId },
  );
  expect(qty).toBe(9);
});

// ── 2. noAmmoRequired — ammo quantity unchanged ───────────────────────────────
//
// When attack item has `noAmmoRequired: true`, the dialog renders a hidden
// `ammunition-id = "none"` input.  Rolling with that form must NOT consume any
// ammo, but a chat message must still be created.

test('noAmmoRequired: quantity unchanged and chat message created', async ({ page }) => {
  const msgsBefore = await page.evaluate(() => game.messages.size);

  const { actorId, ammoId } = await page.evaluate(async () => {
    // ── Create actor ──────────────────────────────────────────────────────────
    const actor = await Actor.create({ name: 'No-Ammo Archer', type: 'character' });
    await actor.update({
      'system.abilities.dex.value': 14,
      'system.attributes.hp.value': 10,
      'system.attributes.hp.max': 10,
    });

    const a = game.actors.get(actor.id);

    // ── Create ranged attack with noAmmoRequired: true ────────────────────────
    const [attack] = await a.createEmbeddedDocuments('Item', [{ name: 'Magic Bow', type: 'attack' }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': 'dex',
      'system.attackParts': [],
      'system.damage.parts': [['1d6', 'P']],
      'system.noAmmoRequired': true,
    });

    // ── Create ammo item (quantity 10, should not be consumed) ────────────────
    const [ammo] = await a.createEmbeddedDocuments('Item', [{ name: 'Standard Arrows', type: 'loot' }]);
    await game.actors.get(actor.id).items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.quantity': 10,
    });

    // ── Build synthetic form — ammunition-id = "none" (as noAmmoRequired renders) ─
    const freshActor  = game.actors.get(actor.id);
    const freshAttack = freshActor.items.get(attack.id);
    const freshAmmo   = freshActor.items.get(ammo.id);
    const ammoName    = freshAmmo.name;

    const form = document.createElement('div');
    const addInput = (name, value) => {
      const el = document.createElement('input');
      el.setAttribute('name', name);
      el.value = String(value === undefined ? '' : value);
      form.appendChild(el);
    };
    addInput('ammunition-id',    'none');   // noAmmoRequired template renders this
    addInput('ammo-dmg-formula', '');
    addInput('ammo-dmg-type',    '');
    addInput('ammo-dmg-uid',     '');
    addInput('ammo-attack',      '');
    addInput('ammo-enh',         '');
    addInput('ammo-note',        '');
    addInput('ammo-name',        ammoName);

    // ── Roll attack ───────────────────────────────────────────────────────────
    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    await freshAttack.uses.rollAttack(false, form, false, freshActor, rollData, true);

    return { actorId: actor.id, ammoId: freshAmmo.id };
  });

  // 1. A chat message should have been created
  await page.waitForFunction(
    (before) => game.messages.size > before,
    msgsBefore,
    { timeout: 8_000 },
  );
  const msgsAfter = await page.evaluate(() => game.messages.size);
  expect(msgsAfter).toBeGreaterThan(msgsBefore);

  // 2. Ammo quantity must still be 10 (no ammo was consumed)
  //    Wait a moment to ensure any DB write that might happen has settled
  await page.waitForTimeout(800);

  const qty = await page.evaluate(
    ({ actorId, ammoId }) => game.actors.get(actorId)?.items.get(ammoId)?.system.quantity,
    { actorId, ammoId },
  );
  expect(qty).toBe(10);
});

// ── 3. infiniteAmmo — ammo quantity unchanged even when selected ──────────────
//
// When the ammo loot item has `infiniteAmmo: true`, selecting it in the form
// must NOT decrement its quantity.

test('infiniteAmmo: quantity unchanged when ammo is selected but infiniteAmmo is true', async ({ page }) => {
  const { actorId, ammoId } = await page.evaluate(async () => {
    // ── Create actor ──────────────────────────────────────────────────────────
    const actor = await Actor.create({ name: 'Infinite Quiver Archer', type: 'character' });
    await actor.update({
      'system.abilities.dex.value': 14,
      'system.attributes.hp.value': 10,
      'system.attributes.hp.max': 10,
    });

    const a = game.actors.get(actor.id);

    // ── Create ranged attack item ─────────────────────────────────────────────
    const [attack] = await a.createEmbeddedDocuments('Item', [{ name: 'Longbow', type: 'attack' }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': 'dex',
      'system.attackParts': [],
      'system.damage.parts': [['1d8', 'P']],
    });

    // ── Create ammo item with infiniteAmmo: true, quantity 5 ─────────────────
    const [ammo] = await a.createEmbeddedDocuments('Item', [{ name: 'Infinite Arrows', type: 'loot' }]);
    await game.actors.get(actor.id).items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.quantity': 5,
      'system.infiniteAmmo': true,
    });

    // ── Build synthetic form with the infinite ammo item selected ─────────────
    const freshActor  = game.actors.get(actor.id);
    const freshAttack = freshActor.items.get(attack.id);
    const freshAmmo   = freshActor.items.get(ammo.id);
    const ammoId      = freshAmmo.id;
    const ammoName    = freshAmmo.name;

    const form = document.createElement('div');
    const addInput = (name, value) => {
      const el = document.createElement('input');
      el.setAttribute('name', name);
      el.value = String(value === undefined ? '' : value);
      form.appendChild(el);
    };
    addInput('ammunition-id',    ammoId);   // selected, but infiniteAmmo prevents consumption
    addInput('ammo-dmg-formula', '');
    addInput('ammo-dmg-type',    '');
    addInput('ammo-dmg-uid',     '');
    addInput('ammo-attack',      '');
    addInput('ammo-enh',         '');
    addInput('ammo-note',        '');
    addInput('ammo-name',        ammoName);

    // ── Roll attack ───────────────────────────────────────────────────────────
    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    await freshAttack.uses.rollAttack(false, form, false, freshActor, rollData, true);

    return { actorId: actor.id, ammoId };
  });

  // Wait to let any DB write settle, then assert quantity is still 5
  await page.waitForTimeout(800);

  const qty = await page.evaluate(
    ({ actorId, ammoId }) => game.actors.get(actorId)?.items.get(ammoId)?.system.quantity,
    { actorId, ammoId },
  );
  expect(qty).toBe(5);
});

// ── 4. Auto ammo recovery — quickChangeItemQuantity restores quantity ─────────
//
// The `useAutoAmmoRecovery` world setting, when true, causes actorDamageHelper
// to call `actor.quickChangeItemQuantity(ammoId, 1)` on a miss (50 % chance).
// This test:
//   a) Verifies ammo quantity decrements from 10 → 9 after rollAttack (normal consumption)
//   b) Verifies that calling quickChangeItemQuantity(ammoId, 1) restores it to 10,
//      which is precisely the recovery call in actorDamageHelper.js line 238.
// The setting is restored to false after the test.

test('auto ammo recovery: quickChangeItemQuantity restores quantity after miss', async ({ page }) => {
  // Enable the setting
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'useAutoAmmoRecovery', true);
  });

  const { actorId, ammoId } = await page.evaluate(async () => {
    // ── Create actor ──────────────────────────────────────────────────────────
    const actor = await Actor.create({ name: 'Recovery Archer', type: 'character' });
    await actor.update({
      'system.abilities.dex.value': 14,
      'system.attributes.hp.value': 10,
      'system.attributes.hp.max': 10,
    });

    const a = game.actors.get(actor.id);

    // ── Create ranged attack item ─────────────────────────────────────────────
    const [attack] = await a.createEmbeddedDocuments('Item', [{ name: 'Recovery Bow', type: 'attack' }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': 'dex',
      'system.attackParts': [],
      'system.damage.parts': [['1d6', 'P']],
    });

    // ── Create ammo item (quantity 10) ────────────────────────────────────────
    const [ammo] = await a.createEmbeddedDocuments('Item', [{ name: 'Recovery Arrows', type: 'loot' }]);
    await game.actors.get(actor.id).items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.quantity': 10,
    });

    // ── Roll attack — consume 1 ammo ──────────────────────────────────────────
    const freshActor  = game.actors.get(actor.id);
    const freshAttack = freshActor.items.get(attack.id);
    const freshAmmo   = freshActor.items.get(ammo.id);
    const ammoId      = freshAmmo.id;
    const ammoName    = freshAmmo.name;

    const form = document.createElement('div');
    const addInput = (name, value) => {
      const el = document.createElement('input');
      el.setAttribute('name', name);
      el.value = String(value === undefined ? '' : value);
      form.appendChild(el);
    };
    addInput('ammunition-id',    ammoId);
    addInput('ammo-dmg-formula', '');
    addInput('ammo-dmg-type',    '');
    addInput('ammo-dmg-uid',     '');
    addInput('ammo-attack',      '');
    addInput('ammo-enh',         '');
    addInput('ammo-note',        '');
    addInput('ammo-name',        ammoName);

    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    await freshAttack.uses.rollAttack(false, form, false, freshActor, rollData, true);

    return { actorId: actor.id, ammoId };
  });

  // a) Confirm ammo was consumed (10 → 9)
  await page.waitForFunction(
    ({ actorId, ammoId }) => {
      const actor = game.actors.get(actorId);
      return actor?.items.get(ammoId)?.system.quantity === 9;
    },
    { actorId, ammoId },
    { timeout: 8_000 },
  );

  const qtyAfterShot = await page.evaluate(
    ({ actorId, ammoId }) => game.actors.get(actorId)?.items.get(ammoId)?.system.quantity,
    { actorId, ammoId },
  );
  expect(qtyAfterShot).toBe(9);

  // b) Simulate the recovery call that actorDamageHelper.js performs on a miss
  await page.evaluate(async ({ actorId, ammoId }) => {
    const actor = game.actors.get(actorId);
    await actor.quickChangeItemQuantity(ammoId, 1);
  }, { actorId, ammoId });

  // Confirm quantity is back to 10
  await page.waitForFunction(
    ({ actorId, ammoId }) => {
      const actor = game.actors.get(actorId);
      return actor?.items.get(ammoId)?.system.quantity === 10;
    },
    { actorId, ammoId },
    { timeout: 8_000 },
  );

  const qtyAfterRecovery = await page.evaluate(
    ({ actorId, ammoId }) => game.actors.get(actorId)?.items.get(ammoId)?.system.quantity,
    { actorId, ammoId },
  );
  expect(qtyAfterRecovery).toBe(10);

  // Restore setting to default
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'useAutoAmmoRecovery', false);
  });
});

// ── 8. ammoDamageParts single replace: replaces weapon damage formula ──────────
//
// When an ammo item has ammoDamageParts: [["5", "Fire", "", "replace"]], the
// weapon's base damage ("10") must be replaced so the attack total = 5, not 10.

test('ammoDamageParts single replace: replaces weapon base damage formula', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Replace Damage Archer', type: 'character' });
    await actor.update({
      'system.attributes.hp.value': 20,
      'system.attributes.hp.max': 20,
    });
    const a = game.actors.get(actor.id);

    const [attack] = await a.createEmbeddedDocuments('Item', [{ name: 'Replace Bow', type: 'attack' }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': '',
      'system.ability.damage': '',
      'system.attackParts': [],
      'system.damage.parts': [['10', 'P', '']],
    });

    const [ammo] = await a.createEmbeddedDocuments('Item', [{ name: 'ReplaceArrow', type: 'loot' }]);
    await a.items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.quantity': 5,
      'system.ammoDamageParts': [['5', 'Fire', '', 'replace']],
    });

    const freshActor  = game.actors.get(actor.id);
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
    addInput('ammo-note',        '');
    addInput('ammo-name',        freshAmmo.name);

    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    const msgCountBefore = game.messages.size;
    await freshAttack.uses.rollAttack(false, form, false, freshActor, rollData, true);

    for (let i = 0; i < 30; i++) {
      if (game.messages.size > msgCountBefore) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const msg = game.messages.contents.at(-1);
    if (!msg) return { error: 'no message', damageTotal: -1 };

    const chatTD  = msg.flags?.D35E?.chatTemplateData ?? {};
    const firstAtk = (chatTD.attacks ?? [])[0];
    return {
      damageTotal: firstAtk?.damage?.total ?? -1,
      newMessages: game.messages.size - msgCountBefore,
    };
  });

  expect(result.newMessages).toBeGreaterThan(0);
  // Weapon had flat "10", ammo replace part has flat "5" → total must be 5
  expect(result.damageTotal).toBe(5);
});

// ── 9. ammoDamageParts type-override: keeps weapon dice when formula is empty ──
//
// When the replace part has an empty formula, the weapon's own formula is kept
// but the damage type changes.  Weapon has flat "9" Pierce, ammo replace part
// has ("", "Fire", "", "replace") → total must still be 9.

test('ammoDamageParts type-override: keeps weapon dice when replace formula is empty', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Type Override Archer', type: 'character' });
    await actor.update({
      'system.attributes.hp.value': 20,
      'system.attributes.hp.max': 20,
    });
    const a = game.actors.get(actor.id);

    const [attack] = await a.createEmbeddedDocuments('Item', [{ name: 'Type Override Bow', type: 'attack' }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': '',
      'system.ability.damage': '',
      'system.attackParts': [],
      'system.damage.parts': [['9', 'P', '']],
    });

    const [ammo] = await a.createEmbeddedDocuments('Item', [{ name: 'TypeOverrideArrow', type: 'loot' }]);
    await a.items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.quantity': 5,
      // Empty formula = keep weapon dice, change type to Fire
      'system.ammoDamageParts': [['', 'Fire', '', 'replace']],
    });

    const freshActor  = game.actors.get(actor.id);
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
    addInput('ammo-note',        '');
    addInput('ammo-name',        freshAmmo.name);

    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    const msgCountBefore = game.messages.size;
    await freshAttack.uses.rollAttack(false, form, false, freshActor, rollData, true);

    for (let i = 0; i < 30; i++) {
      if (game.messages.size > msgCountBefore) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const msg = game.messages.contents.at(-1);
    if (!msg) return { error: 'no message', damageTotal: -1 };

    const chatTD  = msg.flags?.D35E?.chatTemplateData ?? {};
    const firstAtk = (chatTD.attacks ?? [])[0];
    return {
      damageTotal: firstAtk?.damage?.total ?? -1,
      newMessages: game.messages.size - msgCountBefore,
    };
  });

  expect(result.newMessages).toBeGreaterThan(0);
  // Empty ammo formula → weapon's "9" must be kept intact
  expect(result.damageTotal).toBe(9);
});

// ── 10. ammoDamageParts multiple replace: replaces ALL weapon damage parts ─────
//
// When there are 2+ replace parts, ALL weapon base damage.parts are replaced.
// Weapon has two parts: flat "10" + flat "3" (total 13).
// Ammo replaces with flat "4" + flat "2" (total 6) → expected total = 6.

test('ammoDamageParts multiple replace: replaces all weapon damage parts', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Multi Replace Archer', type: 'character' });
    await actor.update({
      'system.attributes.hp.value': 20,
      'system.attributes.hp.max': 20,
    });
    const a = game.actors.get(actor.id);

    const [attack] = await a.createEmbeddedDocuments('Item', [{ name: 'Multi Replace Bow', type: 'attack' }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': '',
      'system.ability.damage': '',
      'system.attackParts': [],
      // Two weapon damage parts: 10 + 3
      'system.damage.parts': [['10', 'P', ''], ['3', 'P', '']],
    });

    const [ammo] = await a.createEmbeddedDocuments('Item', [{ name: 'MultiReplaceArrow', type: 'loot' }]);
    await a.items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.quantity': 5,
      // Two replace parts: 4 + 2 — replaces both weapon parts entirely
      'system.ammoDamageParts': [
        ['4', 'Fire', '', 'replace'],
        ['2', 'Cold', '', 'replace'],
      ],
    });

    const freshActor  = game.actors.get(actor.id);
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
    addInput('ammo-note',        '');
    addInput('ammo-name',        freshAmmo.name);

    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    const msgCountBefore = game.messages.size;
    await freshAttack.uses.rollAttack(false, form, false, freshActor, rollData, true);

    for (let i = 0; i < 30; i++) {
      if (game.messages.size > msgCountBefore) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const msg = game.messages.contents.at(-1);
    if (!msg) return { error: 'no message', damageTotal: -1 };

    const chatTD  = msg.flags?.D35E?.chatTemplateData ?? {};
    const firstAtk = (chatTD.attacks ?? [])[0];
    return {
      damageTotal: firstAtk?.damage?.total ?? -1,
      newMessages: game.messages.size - msgCountBefore,
    };
  });

  expect(result.newMessages).toBeGreaterThan(0);
  // Weapon would have been 10+3=13, but ammo replaces ALL parts → 4+2=6
  expect(result.damageTotal).toBe(6);
});

// ── 11. ammoDamageParts add mode: stacks on top of weapon damage ──────────────
//
// When an ammo part has mode "add", it is appended as extra damage (like
// bonusAmmoDamage) and does NOT replace weapon base damage.
// Weapon: flat "6". Ammo add part: flat "4". Expected total = 10.

test('ammoDamageParts add mode: stacks on top of weapon damage', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Add Damage Archer', type: 'character' });
    await actor.update({
      'system.attributes.hp.value': 20,
      'system.attributes.hp.max': 20,
    });
    const a = game.actors.get(actor.id);

    const [attack] = await a.createEmbeddedDocuments('Item', [{ name: 'Add Damage Bow', type: 'attack' }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': '',
      'system.ability.damage': '',
      'system.attackParts': [],
      'system.damage.parts': [['6', 'P', '']],
    });

    const [ammo] = await a.createEmbeddedDocuments('Item', [{ name: 'AddDamageArrow', type: 'loot' }]);
    await a.items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.quantity': 5,
      // Add mode: 4 extra fire damage stacked on top
      'system.ammoDamageParts': [['4', 'Fire', '', 'add']],
    });

    const freshActor  = game.actors.get(actor.id);
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
    addInput('ammo-note',        '');
    addInput('ammo-name',        freshAmmo.name);

    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    const msgCountBefore = game.messages.size;
    await freshAttack.uses.rollAttack(false, form, false, freshActor, rollData, true);

    for (let i = 0; i < 30; i++) {
      if (game.messages.size > msgCountBefore) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const msg = game.messages.contents.at(-1);
    if (!msg) return { error: 'no message', damageTotal: -1 };

    const chatTD  = msg.flags?.D35E?.chatTemplateData ?? {};
    const firstAtk = (chatTD.attacks ?? [])[0];
    return {
      damageTotal: firstAtk?.damage?.total ?? -1,
      newMessages: game.messages.size - msgCountBefore,
    };
  });

  expect(result.newMessages).toBeGreaterThan(0);
  // Weapon flat "6" + ammo add flat "4" = 10
  expect(result.damageTotal).toBe(10);
});

//
// When an ammo item has `bonusAmmoAttack: "2"`, that +2 is pushed to
// `attackExtraParts` with source = "<ammoName> Bonus".  The source string
// ends up in the attack roll's descriptionParts and therefore in the tooltip
// HTML rendered inside chatTemplateData.attacks[0].attack.tooltip.

test('ammo bonusAmmoAttack: attack tooltip contains ammo bonus source', async ({ page }) => {
  const AMMO_NAME = 'BonusAttackTestArrow';

  const result = await page.evaluate(async (ammoName) => {
    // ── Create actor ──────────────────────────────────────────────────────────
    const actor = await Actor.create({ name: 'Attack Bonus Archer', type: 'character' });
    await actor.update({
      'system.abilities.dex.value': 14,
      'system.attributes.hp.value': 20,
      'system.attributes.hp.max': 20,
    });
    const a = game.actors.get(actor.id);

    // ── Create ranged attack item ─────────────────────────────────────────────
    const [attack] = await a.createEmbeddedDocuments('Item', [{
      name: 'Attack Bonus Bow',
      type: 'attack',
    }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': 'dex',
      'system.attackParts': [],
      'system.damage.parts': [['1d6', 'P']],
    });

    // ── Create ammo with bonusAmmoAttack: "2" ─────────────────────────────────
    const [ammo] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: ammoName,
      type: 'loot',
    }]);
    await game.actors.get(actor.id).items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.quantity': 5,
      'system.bonusAmmoAttack': '2',
    });

    // ── Build synthetic form ──────────────────────────────────────────────────
    const freshActor  = game.actors.get(actor.id);
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
    addInput('ammo-note',        '');
    addInput('ammo-name',        freshAmmo.name);

    // ── Roll attack ───────────────────────────────────────────────────────────
    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    const msgCountBefore = game.messages.size;
    await freshAttack.uses.rollAttack(false, form, false, freshActor, rollData, true);

    // Poll for new chat message
    for (let i = 0; i < 30; i++) {
      if (game.messages.size > msgCountBefore) break;
      await new Promise(r => setTimeout(r, 100));
    }

    const msg = game.messages.contents.at(-1);
    if (!msg) return { error: 'no chat message', attackTooltip: '', newMessages: 0 };

    const chatTD   = msg.flags?.D35E?.chatTemplateData ?? {};
    const attacks  = chatTD.attacks ?? [];
    const firstAtk = attacks[0];

    return {
      attackTooltip: firstAtk?.attack?.tooltip ?? '',
      newMessages:   game.messages.size - msgCountBefore,
    };
  }, AMMO_NAME);

  // A chat message must have been posted
  expect(result.newMessages).toBeGreaterThan(0);

  // The ammo name must appear in the attack roll tooltip (it comes from
  // attackExtraParts source = "${ammoName} Bonus")
  expect(result.attackTooltip).toContain(AMMO_NAME);
});

// ── 6. Ammo bonusAmmoDamage adds flat bonus to damage ────────────────────────
//
// When an ammo item has `bonusAmmoDamage: "4"`, a flat-4 extra roll is pushed
// into `damageExtraParts`.  The resulting chatTemplateData.attacks[0].damage
// must have total >= 5 (1d8 min 1 + 4) and the tooltip must contain "4".

test('ammo bonusAmmoDamage: flat bonus raises damage total and appears in tooltip', async ({ page }) => {
  const result = await page.evaluate(async () => {
    // ── Create actor ──────────────────────────────────────────────────────────
    const actor = await Actor.create({ name: 'Damage Bonus Archer', type: 'character' });
    await actor.update({
      'system.abilities.dex.value': 14,
      'system.attributes.hp.value': 20,
      'system.attributes.hp.max': 20,
    });
    const a = game.actors.get(actor.id);

    // ── Create ranged attack item (1d8 base damage) ───────────────────────────
    const [attack] = await a.createEmbeddedDocuments('Item', [{
      name: 'Damage Bonus Bow',
      type: 'attack',
    }]);
    await a.items.get(attack.id).update({
      'system.actionType': 'rwak',
      'system.ability.attack': 'dex',
      'system.attackParts': [],
      'system.damage.parts': [['1d8', 'P']],
    });

    // ── Create ammo with flat +4 damage bonus ─────────────────────────────────
    const [ammo] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'DamageBonusAmmo',
      type: 'loot',
    }]);
    await game.actors.get(actor.id).items.get(ammo.id).update({
      'system.subType': 'ammo',
      'system.quantity': 5,
      'system.bonusAmmoDamage': '4',
      'system.bonusAmmoDamageType': 'P',
    });

    // ── Build synthetic form ──────────────────────────────────────────────────
    const freshActor  = game.actors.get(actor.id);
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
    addInput('ammo-note',        '');
    addInput('ammo-name',        freshAmmo.name);

    // ── Roll attack ───────────────────────────────────────────────────────────
    const rollData = foundry.utils.duplicate(freshActor.getRollData(null, true));
    rollData.item  = foundry.utils.duplicate(freshAttack.getRollData());

    const msgCountBefore = game.messages.size;
    await freshAttack.uses.rollAttack(false, form, false, freshActor, rollData, true);

    // Poll for new chat message
    for (let i = 0; i < 30; i++) {
      if (game.messages.size > msgCountBefore) break;
      await new Promise(r => setTimeout(r, 100));
    }

    const msg = game.messages.contents.at(-1);
    if (!msg) return { error: 'no chat message', damageTotal: -1, damageTooltip: '', newMessages: 0 };

    const chatTD   = msg.flags?.D35E?.chatTemplateData ?? {};
    const attacks  = chatTD.attacks ?? [];
    const firstAtk = attacks[0];

    return {
      damageTotal:   firstAtk?.damage?.total    ?? -1,
      damageTooltip: firstAtk?.damage?.tooltip  ?? '',
      newMessages:   game.messages.size - msgCountBefore,
    };
  });

  // A chat message must have been posted
  expect(result.newMessages).toBeGreaterThan(0);

  // 1d8 (min 1) + flat 4 = minimum 5
  expect(result.damageTotal).toBeGreaterThanOrEqual(5);

  // The flat "4" damage entry appears as <b>4</b> in the tooltip
  expect(result.damageTooltip).toContain('>4<');
});

// ── 7. applyDamage: auto-recovery increments ammo quantity on a miss ──────────
//
// `ActorDamageHelper.applyDamage` (accessible via game.D35E.ActorDamageHelper)
// rolls 1d100 on a miss when `useAutoAmmoRecovery` is enabled; if < 50 it calls
// `attacker.quickChangeItemQuantity(ammoId, 1)`.
//
// Because the roll is probabilistic (50 % each call) we loop up to 20 times:
//   P(no recovery in 20 tries) = 0.5^20 ≈ 1e-6  — essentially deterministic.
//
// The test verifies the full applyDamage → quickChangeItemQuantity path, not
// just the helper function in isolation.
//
// Roll value -9999 is used because:
//   • -9999 < SPELL_AUTO_HIT (-1337)  → skips rollDefenseDialog (no UI popup)
//   • -9999 < any realistic AC         → guarantees a miss (hit = false)

test('applyDamage: auto-recovery increments ammo quantity when useAutoAmmoRecovery enabled', async ({ page }) => {
  test.setTimeout(90_000); // 20 iterations × ~400 ms wait + async overhead

  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'useAutoAmmoRecovery', true);
  });

  const { attackerActorId, targetActorId, ammoId } = await page.evaluate(async () => {
    // ── Attacker (owns the ammo that may be recovered) ────────────────────────
    const attacker = await Actor.create({ name: 'Recovery Full Path Archer', type: 'character' });
    await attacker.update({
      'system.attributes.hp.value': 20,
      'system.attributes.hp.max':  20,
    });
    const a = game.actors.get(attacker.id);
    const [ammo] = await a.createEmbeddedDocuments('Item', [{ name: 'Recovery Path Arrow', type: 'loot' }]);
    await game.actors.get(attacker.id).items.get(ammo.id).update({
      'system.subType':  'ammo',
      'system.quantity': 10,
    });

    // ── Target (receives the damage application; must have HP data) ───────────
    const target = await Actor.create({ name: 'Recovery Full Path Target', type: 'character' });
    await target.update({
      'system.attributes.hp.value': 50,
      'system.attributes.hp.max':  50,
    });

    return {
      attackerActorId: attacker.id,
      targetActorId:   target.id,
      ammoId:          ammo.id,
    };
  });

  // Loop inside a single page.evaluate so we can read live actor data cheaply.
  const recovered = await page.evaluate(async ({ attackerActorId, targetActorId, ammoId }) => {
    const { ActorDamageHelper } = game.D35E;
    let recovered = false;

    for (let i = 0; i < 20 && !recovered; i++) {
      const attackerActor = game.actors.get(attackerActorId);
      const targetActor   = game.actors.get(targetActorId);
      const qtyBefore     = attackerActor.items.get(ammoId)?.system.quantity ?? 0;

      // roll=-9999: below SPELL_AUTO_HIT (-1337) → no dialog; definitely misses
      await ActorDamageHelper.applyDamage(
        null,         // ev
        -9999,        // roll
        0,            // critroll
        false,        // natural20
        false,        // natural20Crit
        false,        // fumble  (param is named 'fubmle' in source – typo)
        false,        // fumble20Crit
        [],           // damage      (empty → 0 damage; target HP unchanged)
        [],           // normalDamage
        {},           // material
        {},           // alignment
        0,            // enh
        0,            // nonLethalDamage
        false,        // simpleDamage
        targetActor,  // actor  (the target that "takes" the hit)
        attackerActorId, // attackerId (source of the ammo)
        null,            // attackerTokenId
        ammoId           // ammoId
      );

      // Give the async DB write time to settle
      await new Promise(r => setTimeout(r, 400));

      const qtyAfter = game.actors.get(attackerActorId).items.get(ammoId)?.system.quantity ?? 0;
      if (qtyAfter > qtyBefore) recovered = true;
    }

    return recovered;
  }, { attackerActorId, targetActorId, ammoId });

  // With P(failure) = 0.5^20 ≈ 1e-6 this should never fail in practice
  expect(recovered).toBe(true);

  // Restore setting
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'useAutoAmmoRecovery', false);
  });
});
