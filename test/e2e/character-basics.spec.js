'use strict';

/**
 * E2E tests — basic character sheet fields and SRD-derived values.
 *
 * Covers gaps identified in the test-coverage survey:
 *   1. Ability modifier formula (SRD table) for all six stats
 *   2. Modifier formula boundary values (score 1 through 20)
 *   3. Initiative total = DEX modifier (data-layer)
 *   4. Flat-footed AC loses DEX bonus; normal/touch retain it
 *   5. Natural armor adds to normal and flat-footed AC, but not touch AC
 *   6. Saving throw totals = class base + ability modifier (Fighter 5)
 *   7. CMD = 10 + BAB + STR mod + DEX mod
 *   8. Currency (pp/gp/sp/cp) tracks independently
 *   9. Character name persists after sheet UI edit
 *  10. Ability score persists and recomputes modifier after sheet UI edit
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { openSheet } = require('./helpers/actor-sheet');

// Compendium Fighter — predictable save progressions (Fort high, Ref/Will low).
// Fort 5 = 4, Ref 5 = 1, Will 5 = 1
const CLASSES_PACK = 'warcraftrpg2e.classes';
const FIGHTER_ID   = 'sgwZt7dg1ZHXQlrW';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  // clearWorld deletes scenes which can trigger an async canvas reset.
  // Wait until game is ready again before continuing.
  await page.waitForFunction(() => typeof game !== 'undefined' && game.ready === true, {
    timeout: 15_000,
  });
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── 1. All six ability score modifiers ────────────────────────────────────────
//
// SRD formula: mod = floor((score - 10) / 2)
// Tests each stat independently so a regression on one stat is easy to spot.
//
// Note: ability mods are derived by _updateChanges, which runs on update() not
// on Actor.create().  Create a bare actor first, then update all six scores.

test('all six ability scores compute correct SRD modifiers', async ({ page }) => {
  const mods = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'All Stats Mod Test', type: 'character' });
    await game.actors.get(actor.id).update({
      'system.abilities.str.value': 18, // +4
      'system.abilities.dex.value': 16, // +3
      'system.abilities.con.value': 14, // +2
      'system.abilities.int.value': 12, // +1
      'system.abilities.wis.value': 10, // +0
      'system.abilities.cha.value':  8, // -1
    });
    const a = game.actors.get(actor.id);
    return {
      str: a.system.abilities.str.mod,
      dex: a.system.abilities.dex.mod,
      con: a.system.abilities.con.mod,
      int: a.system.abilities.int.mod,
      wis: a.system.abilities.wis.mod,
      cha: a.system.abilities.cha.mod,
    };
  });

  expect(mods.str).toBe(4);
  expect(mods.dex).toBe(3);
  expect(mods.con).toBe(2);
  expect(mods.int).toBe(1);
  expect(mods.wis).toBe(0);
  expect(mods.cha).toBe(-1);
});

// ── 2. Modifier formula boundary values ───────────────────────────────────────
//
// Verifies the floor() behaviour at odd/even score boundaries and low scores.

test('ability modifier formula handles representative boundary values', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Modifier Boundary Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    // Representative scores from the SRD table
    const cases = [1, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20];
    const out = [];
    for (const score of cases) {
      await game.actors.get(actor.id).update({ 'system.abilities.str.value': score });
      const mod = game.actors.get(actor.id).system.abilities.str.mod;
      out.push({ score, mod });
    }
    return out;
  });

  for (const { score, mod } of results) {
    const expected = Math.floor((score - 10) / 2);
    expect(mod, `score ${score}`).toBe(expected);
  }
});

// ── 3. Initiative total equals DEX modifier ───────────────────────────────────

test('initiative total equals DEX modifier', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Initiative Test Actor', type: 'character' });
    // update() triggers _updateChanges so derived values (mod, init.total) are correct
    await game.actors.get(actor.id).update({ 'system.abilities.dex.value': 14 }); // DEX +2
    const a = game.actors.get(actor.id);
    return {
      dexMod:    a.system.abilities.dex.mod,
      initTotal: a.system.attributes.init.total,
    };
  });

  expect(result.dexMod).toBe(2);
  expect(result.initTotal).toBe(result.dexMod);
});

test('initiative total matches DEX modifier across a range of DEX scores', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Init DEX Range Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } },
    });
    const cases = [6, 8, 10, 12, 14, 16, 18];
    const out = [];
    for (const dex of cases) {
      await game.actors.get(actor.id).update({ 'system.abilities.dex.value': dex });
      const a = game.actors.get(actor.id);
      out.push({ dex, dexMod: a.system.abilities.dex.mod, initTotal: a.system.attributes.init.total });
    }
    return out;
  });

  for (const { dex, dexMod, initTotal } of results) {
    const expectedMod = Math.floor((dex - 10) / 2);
    expect(dexMod,    `DEX ${dex} mod`).toBe(expectedMod);
    expect(initTotal, `DEX ${dex} init`).toBe(expectedMod);
  }
});

// ── 4. Flat-footed AC ─────────────────────────────────────────────────────────
//
// Normal and touch AC include the DEX bonus; flat-footed does not.
// (No armour — so the only non-base contributor is DEX.)

test('flat-footed AC excludes DEX bonus; normal and touch AC include it', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Flatfoot Test', type: 'character' });
    await game.actors.get(actor.id).update({ 'system.abilities.dex.value': 16 }); // DEX +3
    const a = game.actors.get(actor.id);
    return {
      dexMod:     a.system.abilities.dex.mod,
      normal:     a.system.attributes.ac.normal.total,
      flatFooted: a.system.attributes.ac.flatFooted.total,
      touch:      a.system.attributes.ac.touch.total,
    };
  });

  expect(result.dexMod).toBe(3);
  // No armour: base 10 + DEX = 13 for normal and touch
  expect(result.normal).toBe(10 + result.dexMod);
  expect(result.touch).toBe(10 + result.dexMod);
  // Flat-footed strips DEX: 10
  expect(result.flatFooted).toBe(10);
});

// ── 5. Natural armor ──────────────────────────────────────────────────────────
//
// Natural armor adds to normal AC and flat-footed AC, but NOT to touch AC.
// (SRD: "Your opponent's AC against a touch attack does not include any…
// natural armor bonus.")
// system.attributes.naturalAC is the stored base; _updateChanges converts it
// into an internal 'nac' change and folds it into the AC totals.

test('natural armor adds to normal and flat-footed AC but not touch AC', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Natural Armor Test', type: 'character' });
    // DEX 10 (+0) keeps things simple; naturalAC 3 should add +3 to non-touch AC
    await game.actors.get(actor.id).update({
      'system.abilities.dex.value': 10,
      'system.attributes.naturalAC': 3,
    });
    const a = game.actors.get(actor.id);
    return {
      normal:     a.system.attributes.ac.normal.total,
      flatFooted: a.system.attributes.ac.flatFooted.total,
      touch:      a.system.attributes.ac.touch.total,
    };
  });

  // naturalAC 3, DEX +0: normal = 13, flat-footed = 13, touch = 10
  expect(result.normal).toBe(13);
  expect(result.flatFooted).toBe(13);
  expect(result.touch).toBe(10);
});

// ── 6. Saving throw totals = class base + ability modifier ────────────────────
//
// Fighter 5 save bases (SRD progression):
//   Fort (high): 4    Ref (low): 1    Will (low): 1
//
// Actor: CON 14 (+2), DEX 12 (+1), WIS 10 (+0)
//   Fort total = 4 + 2 = 6
//   Ref  total = 1 + 1 = 2
//   Will total = 1 + 0 = 1

test('saving throw totals equal class base plus ability modifier', async ({ page }) => {
  const result = await page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({
      name: 'Save Total Test',
      type: 'character',
      system: {
        abilities: {
          con: { value: 14 }, // Fort +2
          dex: { value: 12 }, // Ref  +1
          wis: { value: 10 }, // Will +0
        },
      },
    });
    const pack      = game.packs.get(packId);
    const classItem = await pack.getDocument(classId);
    const classData = classItem.toObject();
    classData.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [classData]);
    const a = game.actors.get(actor.id);
    return {
      fort: a.system.attributes.savingThrows.fort.total,
      ref:  a.system.attributes.savingThrows.ref.total,
      will: a.system.attributes.savingThrows.will.total,
    };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID });

  expect(result.fort).toBe(6); // Fighter high Fort base 4 + CON +2
  expect(result.ref).toBe(2);  // Fighter low  Ref  base 1 + DEX +1
  expect(result.will).toBe(1); // Fighter low  Will base 1 + WIS +0
});

test('changing CON updates Fort save total', async ({ page }) => {
  const result = await page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({
      name: 'Fort CON Test',
      type: 'character',
      system: { abilities: { con: { value: 10 } } }, // CON +0
    });
    const pack      = game.packs.get(packId);
    const classItem = await pack.getDocument(classId);
    const classData = classItem.toObject();
    classData.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [classData]);

    const fortBefore = game.actors.get(actor.id).system.attributes.savingThrows.fort.total;
    await game.actors.get(actor.id).update({ 'system.abilities.con.value': 16 }); // CON +3
    const fortAfter = game.actors.get(actor.id).system.attributes.savingThrows.fort.total;
    return { fortBefore, fortAfter };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID });

  // CON 10 → +0: Fort = 4+0 = 4
  // CON 16 → +3: Fort = 4+3 = 7
  expect(result.fortBefore).toBe(4);
  expect(result.fortAfter).toBe(7);
});

// ── 7. Grapple modifier (CMB) ─────────────────────────────────────────────────
//
// In D&D 3.5e grapple is an opposed check: 1d20 + BAB + STR mod + size modifier.
// D35E tracks the bonus as system.attributes.cmb.total (CMB = BAB + STR mod for
// a Medium creature with no size modifier).

test('grapple modifier (CMB) equals BAB + STR modifier', async ({ page }) => {
  const result = await page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({
      name: 'Grapple Test',
      type: 'character',
      system: {
        abilities: { str: { value: 14 } }, // STR +2
      },
    });
    const pack      = game.packs.get(packId);
    const classItem = await pack.getDocument(classId);
    const classData = classItem.toObject();
    classData.system.levels = 5; // Fighter BAB 5
    await actor.createEmbeddedDocuments('Item', [classData]);
    const a = game.actors.get(actor.id);
    return {
      bab:    a.system.attributes.bab.total,
      strMod: a.system.abilities.str.mod,
      cmb:    a.system.attributes.cmb.total,
    };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID });

  // CMB = BAB(5) + STR(+2) = 7 (Medium size — no size modifier)
  expect(result.bab).toBe(5);
  expect(result.strMod).toBe(2);
  expect(result.cmb).toBe(result.bab + result.strMod);
});

test('grapple modifier (CMB) increases when STR score increases', async ({ page }) => {
  const result = await page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({
      name: 'Grapple STR Test',
      type: 'character',
      system: { abilities: { str: { value: 10 } } }, // STR +0
    });
    const pack      = game.packs.get(packId);
    const classItem = await pack.getDocument(classId);
    const classData = classItem.toObject();
    classData.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [classData]);

    const cmbBefore = game.actors.get(actor.id).system.attributes.cmb.total;
    await game.actors.get(actor.id).update({ 'system.abilities.str.value': 18 }); // STR +4
    const cmbAfter  = game.actors.get(actor.id).system.attributes.cmb.total;
    return { cmbBefore, cmbAfter };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID });

  // STR 10 → +0: CMB = 5+0 = 5
  // STR 18 → +4: CMB = 5+4 = 9
  expect(result.cmbBefore).toBe(5);
  expect(result.cmbAfter).toBe(9);
});

// ── 8. Currency ───────────────────────────────────────────────────────────────

test('pp, gp, sp, and cp track independently', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Gold Test', type: 'character' });
    await game.actors.get(actor.id).update({
      'system.currency.pp':  5,
      'system.currency.gp': 100,
      'system.currency.sp':  50,
      'system.currency.cp': 200,
    });
    const a = game.actors.get(actor.id);
    return {
      pp: a.system.currency.pp,
      gp: a.system.currency.gp,
      sp: a.system.currency.sp,
      cp: a.system.currency.cp,
    };
  });

  expect(result.pp).toBe(5);
  expect(result.gp).toBe(100);
  expect(result.sp).toBe(50);
  expect(result.cp).toBe(200);
});

test('currency values start at 0 for a new character', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Empty Pockets', type: 'character' });
    const a = game.actors.get(actor.id);
    return {
      pp: a.system.currency.pp,
      gp: a.system.currency.gp,
      sp: a.system.currency.sp,
      cp: a.system.currency.cp,
    };
  });

  expect(result.pp).toBe(0);
  expect(result.gp).toBe(0);
  expect(result.sp).toBe(0);
  expect(result.cp).toBe(0);
});

// ── 9. Sheet UI — name persists ───────────────────────────────────────────────

test('character name updated via sheet input persists on the actor', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Old Name', type: 'character' });
    return actor.id;
  });

  const sheetId  = await openSheet(page, actorId);
  const nameInput = page.locator(`#${sheetId} input[name="name"]`);
  await nameInput.waitFor({ state: 'visible', timeout: 5_000 });

  await nameInput.fill('New Name');
  await nameInput.press('Tab');

  await page.waitForFunction(
    (id) => game.actors.get(id)?.name === 'New Name',
    actorId,
    { timeout: 5_000 },
  );

  const name = await page.evaluate((id) => game.actors.get(id).name, actorId);
  expect(name).toBe('New Name');
});

// ── 10. Sheet UI — ability score persists and recomputes modifier ──────────────

test('STR updated via sheet input persists and recomputes modifier', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Ability Edit Test',
      type: 'character',
      system: { abilities: { str: { value: 10 } } }, // STR +0 to start
    });
    return actor.id;
  });

  const sheetId  = await openSheet(page, actorId);
  // The STR input appears on multiple tabs (summary + attributes); use .first()
  // to target the first visible instance.
  const strInput = page.locator(`#${sheetId} input[name="system.abilities.str.tempvalue"]`).first();
  await strInput.waitFor({ state: 'visible', timeout: 5_000 });

  await strInput.fill('16');
  await strInput.press('Tab');

  // Wait for the modifier to reflect the new score (+3 for STR 16)
  await page.waitForFunction(
    (id) => game.actors.get(id)?.system.abilities.str.mod === 3,
    actorId,
    { timeout: 5_000 },
  );

  const mod = await page.evaluate(
    (id) => game.actors.get(id).system.abilities.str.mod,
    actorId,
  );
  expect(mod).toBe(3);
});
