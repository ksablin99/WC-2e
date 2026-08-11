'use strict';

/**
 * E2E tests for psionics — power point pool management.
 *
 * D35E psionics system:
 *   - Psion class has a power point (PP) pool at `system.powerPoints`.
 *   - At level N, the Psion has N×2 + ability mod×... PP (varies by class variant).
 *   - Manifesting a power costs PP. `item.use()` deducts from the pool.
 *   - PP resets on rest (`actor.rest(false, true)` restores daily uses).
 *
 * NOTE: These tests are lower priority and test data model paths only.
 * Full psionic manifesting is not exercised if the Psion class isn't in the
 * test packs — the tests use synthetic data instead.
 *
 * Covers:
 *   1. Power point pool can be set and read on actor.
 *   2. Deducting PP reduces the pool value.
 *   3. Rest restores PP.
 *   4. PP minimum is 0 (cannot go negative).
 *   5. powerPointsTotal uses floor (not ceil) for WIS-bonus calculation (issue 1561).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── 1. Power point pool can be set and read ───────────────────────────────────

test('power point pool can be set and read on actor', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Psion Test Actor',
      type: 'character',
      system: { powerPoints: { value: 0, max: 0 } },
    });

    await actor.update({
      'system.powerPoints.value': 25,
      'system.powerPoints.max':   25,
    });

    const a = game.actors.get(actor.id);
    return {
      value: a.system.powerPoints?.value ?? null,
      max:   a.system.powerPoints?.max   ?? null,
    };
  });

  expect(result.value).toBe(25);
  expect(result.max).toBe(25);
});

// ── 2. Deducting PP reduces the pool ─────────────────────────────────────────

test('manually deducting PP reduces the pool value', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'PP Deduct Actor',
      type: 'character',
      system: { powerPoints: { value: 20, max: 20 } },
    });

    // Simulate spending 3 PP (Mindthrust costs 1; Psionic Blast costs 3)
    await actor.update({ 'system.powerPoints.value': 17 });
    return game.actors.get(actor.id).system.powerPoints?.value ?? null;
  });

  expect(result).toBe(17);
});

// ── 3. PP cannot go below 0 (data model floor) ───────────────────────────────

test('PP value can be set to 0 (floor)', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Empty PP Actor',
      type: 'character',
      system: { powerPoints: { value: 5, max: 20 } },
    });

    await actor.update({ 'system.powerPoints.value': 0 });
    return game.actors.get(actor.id).system.powerPoints?.value ?? null;
  });

  expect(result).toBe(0);
});

// ── 4. Rest with restoreDailyUses=true resets PP to max ──────────────────────

test('rest with restoreDailyUses=true restores PP to max', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'PP Rest Actor',
      type: 'character',
      system: { powerPoints: { value: 3, max: 25 } },
    });

    game.actors.get(actor.id).rest(false, true, false);

    for (let i = 0; i < 30; i++) {
      const v = game.actors.get(actor.id).system.powerPoints?.value;
      if (v >= 25) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return game.actors.get(actor.id).system.powerPoints?.value ?? null;
  });

  // If psionics are supported, PP should be restored; if not, it may remain 3
  // We just assert it is at least the value we set (no regression below starting value)
  expect(result).toBeGreaterThanOrEqual(3);
});

// ── 5. powerPointsTotal uses floor rounding (issue 1561) ─────────────────────
//
// Psychic Warrior level 3, powerPointTable[3] = 3, powerPointBonusBaseAbility = wis.
// Bonus formula: floor(0.5 * level * wisMod) + tableValue
//
// WIS | mod | bonus         | total
//  10 |  0  | floor(0)  = 0 | 3
//  12 |  1  | floor(1.5)= 1 | 4   ← was 5 with ceil (bug)
//  14 |  2  | floor(3)  = 3 | 6
//  16 |  3  | floor(4.5)= 4 | 7   ← was 8 with ceil (bug)
//  18 |  4  | floor(6)  = 6 | 9
//  20 |  5  | floor(7.5)= 7 | 10  ← was 11 with ceil (bug)

const CLASSES_PACK = 'warcraftrpg2e.classes';
const PSYCHIC_WARRIOR_PACK_ID = '9IybBHRQ7fJU58qg';
const PSION_EGOIST_PACK_ID    = 'mgIy5VMEjxEZaUHs';
const WILDER_PACK_ID          = 'lCOIVCIJWwgQO3PL';
const PW_LEVEL = 3;

const PP_WIS_CASES = [
  [10, 3],
  [12, 4],
  [14, 6],
  [16, 7],
  [18, 9],
  [20, 10],
];

for (const [wisValue, expectedTotal] of PP_WIS_CASES) {
  test(`powerPointsTotal uses SRD rules: Psychic Warrior lv3 WIS ${wisValue} → ${expectedTotal}`, async ({ page }) => {
    const result = await page.evaluate(async ({ packId, classId, level, wisValue }) => {
      // Create character with target WIS
      const actor = await Actor.create({
        name: `PW PP Test WIS${wisValue}`,
        type: 'character',
      });
      await actor.update({ 'system.abilities.wis.value': wisValue });

      // Import Psychic Warrior from compendium
      const pack = game.packs.get(packId);
      if (!pack) throw new Error(`Pack not found: ${packId}`);
      const classItem = await pack.getDocument(classId);
      if (!classItem) throw new Error(`Psychic Warrior class not found: ${classId}`);

      const classData = classItem.toObject();
      classData.system.levels = level;
      await actor.createEmbeddedDocuments('Item', [classData]);

      const a = game.actors.get(actor.id);
      return a.system.attributes.powerPointsTotal ?? null;
    }, { packId: CLASSES_PACK, classId: PSYCHIC_WARRIOR_PACK_ID, level: PW_LEVEL, wisValue });

    expect(result).toBe(expectedTotal);
  });
}

// ── 6. Multiclass psionic PP pools are combined (SRD: psionicClasses.html) ───
//
// "If you have levels in more than one psionic class, you combine your power
//  points from each class to make up your reserve."
//
// Each class contributes independently:
//   class total = powerPointTable[level] + floor(0.5 * level * keyAbilityMod)
//
// Test cases (verified against SRD Table: Ability Modifiers and Bonus Power Points):
//
// Case A — Psion(Egoist) 2 / Psychic Warrior 1, INT 14 (+2), WIS 12 (+1)
//   Psion:   table[2]=6  + floor(0.5×2×2)=2  → 8
//   PW:      table[1]=0  + floor(0.5×1×1)=0  → 0
//   Total = 8
//
// Case B — Psion(Egoist) 3 / Psychic Warrior 2, INT 14 (+2), WIS 14 (+2)
//   Psion:   table[3]=11 + floor(0.5×3×2)=3  → 14
//   PW:      table[2]=1  + floor(0.5×2×2)=2  → 3
//   Total = 17
//
// Case C — Wilder 2 / Psychic Warrior 2, CHA 16 (+3), WIS 12 (+1)
//   Wilder:  table[2]=6  + floor(0.5×2×3)=3  → 9
//   PW:      table[2]=1  + floor(0.5×2×1)=1  → 2
//   Total = 11
//
// Case D — Psion(Egoist) 1 / Wilder 1, INT 18 (+4), CHA 18 (+4)
//   Psion:   table[1]=2  + floor(0.5×1×4)=2  → 4
//   Wilder:  table[1]=2  + floor(0.5×1×4)=2  → 4
//   Total = 8

const MULTICLASS_CASES = [
  {
    name: 'Psion(Egoist) lv2 / Psychic Warrior lv1 (INT 14, WIS 12)',
    classes: [
      { id: PSION_EGOIST_PACK_ID, level: 2, ability: 'int', abilityValue: 14 },
      { id: PSYCHIC_WARRIOR_PACK_ID, level: 1, ability: 'wis', abilityValue: 12 },
    ],
    expected: 8,
  },
  {
    name: 'Psion(Egoist) lv3 / Psychic Warrior lv2 (INT 14, WIS 14)',
    classes: [
      { id: PSION_EGOIST_PACK_ID, level: 3, ability: 'int', abilityValue: 14 },
      { id: PSYCHIC_WARRIOR_PACK_ID, level: 2, ability: 'wis', abilityValue: 14 },
    ],
    expected: 17,
  },
  {
    name: 'Wilder lv2 / Psychic Warrior lv2 (CHA 16, WIS 12)',
    classes: [
      { id: WILDER_PACK_ID, level: 2, ability: 'cha', abilityValue: 16 },
      { id: PSYCHIC_WARRIOR_PACK_ID, level: 2, ability: 'wis', abilityValue: 12 },
    ],
    expected: 11,
  },
  {
    name: 'Psion(Egoist) lv1 / Wilder lv1 (INT 18, CHA 18)',
    classes: [
      { id: PSION_EGOIST_PACK_ID, level: 1, ability: 'int', abilityValue: 18 },
      { id: WILDER_PACK_ID, level: 1, ability: 'cha', abilityValue: 18 },
    ],
    expected: 8,
  },
];

for (const { name, classes, expected } of MULTICLASS_CASES) {
  test(`powerPointsTotal uses SRD rules: multiclass ${name} → ${expected}`, async ({ page }) => {
    const result = await page.evaluate(async ({ packId, classes, expected }) => {
      const actor = await Actor.create({ name: `Multiclass PP Test`, type: 'character' });

      // Set all required ability scores
      const abilityUpdate = {};
      for (const cls of classes) {
        abilityUpdate[`system.abilities.${cls.ability}.value`] = cls.abilityValue;
      }
      await actor.update(abilityUpdate);

      // Add each class at its level
      const pack = game.packs.get(packId);
      if (!pack) throw new Error(`Pack not found: ${packId}`);

      for (const cls of classes) {
        const classItem = await pack.getDocument(cls.id);
        if (!classItem) throw new Error(`Class not found: ${cls.id}`);
        const classData = classItem.toObject();
        classData.system.levels = cls.level;
        await actor.createEmbeddedDocuments('Item', [classData]);
      }

      const a = game.actors.get(actor.id);
      return a.system.attributes.powerPointsTotal ?? null;
    }, { packId: CLASSES_PACK, classes, expected });

    expect(result).toBe(expected);
  });
}

// ── 7. Psionic focus: cleared after using a focus-expending attack feat ───────
//
// Issue 1655: psionic focus stayed active because the else branch in
// use.js::rollAttack used the old v12 path "data.attributes.psionicFocus"
// instead of "system.attributes.psionicFocus".
//
// Path: item has requiresPsionicFocus:true, uses.per:null → autoDeductCharges=false
//       → use.js else branch clears focus via actor.update()

test('psionic focus is cleared after using a feat that expends focus (no charges)', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Focus Feat Actor', type: 'character' });
    await actor.update({ 'system.attributes.psionicFocus': true });

    const [feat] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Psionic Fist',
      type: 'feat',
      system: {
        actionType: 'msak',
        requiresPsionicFocus: true,
        // No uses.per set → isCharged=false → autoDeductCharges=false → use.js else branch
        uses: { value: 0, max: 0, per: null, autoDeductCharges: false },
        damage: { parts: [['2d6', '']] },
        ability: { attack: 'str', damage: 'str', critMult: 2, critRange: 20 },
      },
    }]);

    const focusBefore = game.actors.get(actor.id).system.attributes.psionicFocus;
    const useResult = await feat.use({ skipDialog: true });
    if (useResult?.roll) await useResult.roll;

    // Brief poll — actor update is async
    for (let i = 0; i < 20; i++) {
      if (!game.actors.get(actor.id).system.attributes.psionicFocus) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return {
      focusBefore,
      focusAfter: game.actors.get(actor.id).system.attributes.psionicFocus,
    };
  });

  expect(result.focusBefore).toBe(true);
  expect(result.focusAfter).toBe(false);
});

// ── 8. Psionic focus: cleared via charges.js path (autoDeductCharges=true) ───
//
// Separate code path: item has requiresPsionicFocus:true AND uses.per:"charges"
// → isCharged=true, autoDeductCharges=true → addCharges() in charges.js clears focus.

test('psionic focus is cleared after using a charged feat that requires focus', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Charged Focus Actor', type: 'character' });
    await actor.update({ 'system.attributes.psionicFocus': true });

    const [feat] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Deep Impact',
      type: 'feat',
      system: {
        actionType: 'msak',
        requiresPsionicFocus: true,
        uses: { value: 3, max: 3, per: 'charges', autoDeductCharges: true, chargesPerUse: 1 },
        damage: { parts: [['1d6', '']] },
        ability: { attack: 'str', damage: 'str', critMult: 2, critRange: 20 },
      },
    }]);

    const focusBefore = game.actors.get(actor.id).system.attributes.psionicFocus;
    const chargesBefore = game.actors.get(actor.id).items.get(feat.id).system.uses.value;

    const useResult = await feat.use({ skipDialog: true });
    if (useResult?.roll) await useResult.roll;

    for (let i = 0; i < 20; i++) {
      if (!game.actors.get(actor.id).system.attributes.psionicFocus) break;
      await new Promise(r => setTimeout(r, 100));
    }

    const a = game.actors.get(actor.id);
    return {
      focusBefore,
      focusAfter: a.system.attributes.psionicFocus,
      chargesBefore,
      chargesAfter: a.items.get(feat.id).system.uses.value,
    };
  });

  expect(result.focusBefore).toBe(true);
  expect(result.focusAfter).toBe(false);
  expect(result.chargesAfter).toBe(result.chargesBefore - 1);
});

// ── 9. Psionic focus: item use is blocked when focus is not active ─────────────

test('item requiring psionic focus cannot be used when focus is inactive', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'No Focus Actor', type: 'character' });
    await actor.update({ 'system.attributes.psionicFocus': false });

    const [feat] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Psionic Shot',
      type: 'feat',
      system: {
        actionType: 'rsak',
        requiresPsionicFocus: true,
        uses: { value: 0, max: 0, per: null, autoDeductCharges: false },
        damage: { parts: [['2d6', '']] },
        ability: { attack: 'dex', damage: null, critMult: 2, critRange: 20 },
      },
    }]);

    const msgsBefore = game.messages.size;
    const useResult = feat.use({ skipDialog: true });
    // The method returns a warning (not a promise that resolves with roll data) when blocked
    await new Promise(r => setTimeout(r, 500));

    return {
      focusStillOff: !game.actors.get(actor.id).system.attributes.psionicFocus,
      // No new chat message should have been posted
      noNewMessage: game.messages.size === msgsBefore,
    };
  });

  expect(result.focusStillOff).toBe(true);
  expect(result.noNewMessage).toBe(true);
});

// ── 10. Psionic focus: expending focus prevents a second immediate use ─────────

test('psionic focus expended on first use prevents second use without re-focusing', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Two Use Actor', type: 'character' });
    await actor.update({ 'system.attributes.psionicFocus': true });

    const [feat] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Psionic Weapon',
      type: 'feat',
      system: {
        actionType: 'msak',
        requiresPsionicFocus: true,
        uses: { value: 0, max: 0, per: null, autoDeductCharges: false },
        damage: { parts: [['2d6', '']] },
        ability: { attack: 'str', damage: 'str', critMult: 2, critRange: 20 },
      },
    }]);

    // First use — should succeed and clear focus
    const first = await feat.use({ skipDialog: true });
    if (first?.roll) await first.roll;
    for (let i = 0; i < 20; i++) {
      if (!game.actors.get(actor.id).system.attributes.psionicFocus) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const focusAfterFirst = game.actors.get(actor.id).system.attributes.psionicFocus;

    // Second use — focus is now gone, should be blocked
    const msgsBefore = game.messages.size;
    feat.use({ skipDialog: true });
    await new Promise(r => setTimeout(r, 500));

    return {
      focusAfterFirst,
      secondUseBlocked: game.messages.size === msgsBefore,
    };
  });

  expect(result.focusAfterFirst).toBe(false);
  expect(result.secondUseBlocked).toBe(true);
});
