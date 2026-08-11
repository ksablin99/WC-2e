'use strict';

/**
 * E2E tests for monster HD advancement (advanceHd).
 *
 * Covers the fix that wraps initial stat assignments in parseInt() so that
 * size-step bonuses use numeric addition instead of string concatenation.
 *
 * The advanceHd() function in module/actor/entity.js:
 *   1. Takes a new HD count
 *   2. Looks up size advancement from system.details.advancement.hd
 *   3. Applies stat changes (str/dex/con/naturalAC/cr) for each size step crossed
 *   4. Updates the racial HD item's levels and hp
 *   5. Updates the actor
 *
 * Bug (regression): before the fix, naturalAC/str/dex/con were read without
 * parseInt(). If they were stored as strings (e.g., from JSON import),
 * `+= bonus` caused string concatenation: "5" + 3 = "53" instead of 8.
 *
 * CONFIG.D35E.actorSizes order: fine, dim, tiny, sm, med, lg, huge, grg, col
 * CONFIG.D35E.sizeAdvancementChanges:
 *   med:  { str: 4,  dex: -2, con: 2, nac: 0 }
 *   lg:   { str: 8,  dex: -2, con: 4, nac: 2 }
 *   huge: { str: 8,  dex: -2, con: 4, nac: 3 }
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper ─────────────────────────────────────────────────────────────────────

/**
 * Create a test NPC monster with a racial HD class item.
 *
 * Uses the two-step pattern: Actor.create (name+type only) then actor.update,
 * and similarly for the racial HD item.
 */
async function createTestMonster(page, opts = {}) {
  const {
    name = 'Test Monster',
    size = 'sm',
    naturalAC = 5,
    str = 10,
    dex = 12,
    con = 14,
    cr = 3,
    advancement = [],
    racialHdLevels = 4,
    racialHdHp = 20,
    racialHdDie = 8,
    racialHdCrPerHD = 4,
  } = opts;

  return page.evaluate(async (o) => {
    // Step 1: create actor with name + type only
    const actor = await Actor.create({ name: o.name, type: 'npc' });

    // Step 2: update actor fields
    await actor.update({
      'system.abilities.str.value': o.str,
      'system.abilities.dex.value': o.dex,
      'system.abilities.con.value': o.con,
      'system.attributes.naturalAC': o.naturalAC,
      'system.details.cr': o.cr,
      'system.traits.size': o.size,
      'system.details.advancement.hd': o.advancement,
    });

    // Step 3: create racial HD item (name + type only)
    const a = game.actors.get(actor.id);
    const [racialHd] = await a.createEmbeddedDocuments('Item', [{
      name: 'Racial HD',
      type: 'class',
    }]);

    // Step 4: update racial HD fields
    await a.items.get(racialHd.id).update({
      'system.classType': 'racial',
      'system.levels': o.racialHdLevels,
      'system.hp': o.racialHdHp,
      'system.hd': o.racialHdDie,
      'system.crPerHD': o.racialHdCrPerHD,
    });

    return { actorId: actor.id, racialHdId: racialHd.id };
  }, { name, size, naturalAC, str, dex, con, cr, advancement, racialHdLevels, racialHdHp, racialHdDie, racialHdCrPerHD });
}

// ── 1. Advance HD without size change ─────────────────────────────────────────

test('advanceHd without size change updates HD levels and CR, leaves stats unchanged', async ({ page }) => {
  // Monster stays at size "sm" throughout its entire advancement range.
  // Start: 4 HD, CR 3. Advance to 8 HD.
  // Expected: levels=8, CR = 3 + floor(4/4) = 4, stats unchanged.
  const { actorId } = await createTestMonster(page, {
    size: 'sm',
    naturalAC: 5,
    str: 10,
    dex: 12,
    con: 14,
    cr: 3,
    advancement: [{ lower: 1, upper: 16, size: 'sm' }],
    racialHdLevels: 4,
    racialHdHp: 20,
    racialHdDie: 8,
    racialHdCrPerHD: 4,
  });

  // Run the advancement
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.advanceHd(8);
  }, { actorId });

  // Read back actor state
  const result = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    const racialHd = a.items.find(
      (i) => i.type === 'class' && i.system.classType === 'racial',
    );
    return {
      hdLevels: racialHd.system.levels,
      cr: a.system.details.cr,
      naturalAC: a.system.attributes.naturalAC,
      str: a.system.abilities.str.value,
      dex: a.system.abilities.dex.value,
      con: a.system.abilities.con.value,
      size: a.system.traits.size,
    };
  }, { actorId });

  // Racial HD levels updated to requested value
  expect(result.hdLevels).toBe(8);

  // CR increased by floor(deltaHD / crPerHD) = floor(4/4) = 1
  expect(result.cr).toBe(4);

  // No size change — all stats unchanged
  expect(result.size).toBe('sm');
  expect(result.naturalAC).toBe(5);
  expect(result.str).toBe(10);
  expect(result.dex).toBe(12);
  expect(result.con).toBe(14);

  // All values must be numbers (not strings)
  expect(typeof result.naturalAC).toBe('number');
  expect(typeof result.str).toBe('number');
  expect(typeof result.dex).toBe('number');
  expect(typeof result.con).toBe('number');
  expect(typeof result.cr).toBe('number');
});

// ── 2. Advance HD with one size change (sm → med) ─────────────────────────────

test('advanceHd crossing sm→med applies numeric stat bonuses (regression: not string concat)', async ({ page }) => {
  // Advancement table triggers sm→med at HD 9.
  // CONFIG.D35E.sizeAdvancementChanges.med = { str: 4, dex: -2, con: 2, nac: 0 }
  //
  // Start: 4 HD, CR 3.  Advance to 9 HD (delta = 5).
  // Expected:
  //   size = 'med'
  //   hdLevels = 9
  //   cr = 3 + 1 (size step) + floor(5/4) = 5
  //   naturalAC = 5 + 0  = 5   (number, not "50" from "5"+0)
  //   str       = 10 + 4 = 14  (number, not "104" from "10"+4)
  //   dex       = 12 - 2 = 10  (number, not "12-2" from "12"+-2)
  //   con       = 14 + 2 = 16  (number, not "142" from "14"+2)
  const { actorId } = await createTestMonster(page, {
    size: 'sm',
    naturalAC: 5,
    str: 10,
    dex: 12,
    con: 14,
    cr: 3,
    advancement: [
      { lower: 1, upper: 8,  size: 'sm' },
      { lower: 9, upper: 16, size: 'med' },
    ],
    racialHdLevels: 4,
    racialHdHp: 20,
    racialHdDie: 8,
    racialHdCrPerHD: 4,
  });

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.advanceHd(9);
  }, { actorId });

  const result = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    const racialHd = a.items.find(
      (i) => i.type === 'class' && i.system.classType === 'racial',
    );
    return {
      hdLevels: racialHd.system.levels,
      cr: a.system.details.cr,
      naturalAC: a.system.attributes.naturalAC,
      str: a.system.abilities.str.value,
      dex: a.system.abilities.dex.value,
      con: a.system.abilities.con.value,
      size: a.system.traits.size,
    };
  }, { actorId });

  // Size advanced to medium
  expect(result.size).toBe('med');

  // HD levels updated
  expect(result.hdLevels).toBe(9);

  // CR: 3 + 1 (size step for med) + floor(5/4)=1 = 5
  expect(result.cr).toBe(5);

  // ── Regression: values must be numbers, not strings ──
  expect(typeof result.naturalAC).toBe('number');
  expect(typeof result.str).toBe('number');
  expect(typeof result.dex).toBe('number');
  expect(typeof result.con).toBe('number');

  // ── Correct numeric arithmetic ──
  // Without fix: "5"+0="50", "10"+4="104", "12"+-2="12-2", "14"+2="142"
  expect(result.naturalAC).toBe(5);   // 5 + 0 (nac for med = 0)
  expect(result.str).toBe(14);        // 10 + 4
  expect(result.dex).toBe(10);        // 12 + (-2)
  expect(result.con).toBe(16);        // 14 + 2
});

// ── 3. Advance HD crossing two size steps (sm → lg) ───────────────────────────

test('advanceHd crossing two size steps (sm→med→lg) accumulates stats numerically', async ({ page }) => {
  // Advancement table: sm up to 8 HD, med up to 12 HD, lg up to 20 HD.
  // CONFIG.D35E.sizeAdvancementChanges:
  //   med:  { str: 4,  dex: -2, con: 2, nac: 0 }
  //   lg:   { str: 8,  dex: -2, con: 4, nac: 2 }
  // Cumulative: str+12, dex-4, con+6, nac+2
  //
  // Start: 4 HD, CR 1.  Advance to 15 HD (delta = 11).
  // Expected:
  //   size = 'lg'
  //   hdLevels = 15
  //   cr = 1 + 1 (med) + 1 (lg) + floor(11/4)=2 = 5
  //   naturalAC = 5 + 0 + 2 = 7   (number, not "502" from "5"+0+2)
  //   str       = 10 + 4 + 8 = 22  (number, not "10412" from "10"+4+8)
  //   dex       = 12 - 2 - 2 = 8   (number, not "12-2-2" from string ops)
  //   con       = 14 + 2 + 4 = 20  (number, not "1424" from "14"+2+4)
  const { actorId } = await createTestMonster(page, {
    size: 'sm',
    naturalAC: 5,
    str: 10,
    dex: 12,
    con: 14,
    cr: 1,
    advancement: [
      { lower: 1,  upper: 8,  size: 'sm'  },
      { lower: 9,  upper: 12, size: 'med' },
      { lower: 13, upper: 20, size: 'lg'  },
    ],
    racialHdLevels: 4,
    racialHdHp: 20,
    racialHdDie: 8,
    racialHdCrPerHD: 4,
  });

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.advanceHd(15);
  }, { actorId });

  const result = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    const racialHd = a.items.find(
      (i) => i.type === 'class' && i.system.classType === 'racial',
    );
    return {
      hdLevels: racialHd.system.levels,
      cr: a.system.details.cr,
      naturalAC: a.system.attributes.naturalAC,
      str: a.system.abilities.str.value,
      dex: a.system.abilities.dex.value,
      con: a.system.abilities.con.value,
      size: a.system.traits.size,
    };
  }, { actorId });

  // Size advanced to large
  expect(result.size).toBe('lg');

  // HD levels
  expect(result.hdLevels).toBe(15);

  // CR: 1 + 1 (med) + 1 (lg) + floor(11/4)=2 = 5
  expect(result.cr).toBe(5);

  // ── Regression: all values must be numbers ──
  expect(typeof result.naturalAC).toBe('number');
  expect(typeof result.str).toBe('number');
  expect(typeof result.dex).toBe('number');
  expect(typeof result.con).toBe('number');

  // ── Correct numeric accumulation across two size steps ──
  // Without fix (string concat): naturalAC "502", str "10412", dex "12-2-2", con "1424"
  expect(result.naturalAC).toBe(7);   // 5 + 0 (med.nac=0) + 2 (lg.nac=2)
  expect(result.str).toBe(22);        // 10 + 4 (med.str=4) + 8 (lg.str=8)
  expect(result.dex).toBe(8);         // 12 + (-2) (med.dex=-2) + (-2) (lg.dex=-2)
  expect(result.con).toBe(20);        // 14 + 2 (med.con=2) + 4 (lg.con=4)
});
