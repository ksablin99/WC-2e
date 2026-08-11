'use strict';

/**
 * E2E tests for automatic spellbook initialisation.
 *
 * D35E spellbook auto-setup:
 *   - Each character actor has a primary spellbook with autoSetup=true (template default).
 *   - Setting system.attributes.spells.spellbooks.primary.class to a class slug
 *     triggers full auto-initialisation: copies spontaneous flag, spellcasting ability,
 *     and computes spell-level maxima from the class's spellsPerLevel table.
 *   - Spell-slot maxima are: classBase + getSpellSlotIncrease(abilityMod, spellLevel)
 *     where getSpellSlotIncrease(mod, level) = Math.max(0, Math.ceil((mod+1-level)/4))
 *     (matches the D&D 3.5e SRD bonus-spells-by-ability-score table, basics.html).
 *
 * SRD sources for base slots (basics.html, wizard.html, sorcerer.html):
 *   Wizard level 5 base:    0th:4  1st:3  2nd:2  3rd:1
 *   Sorcerer level 5 base:  0th:6  1st:6  2nd:4  3rd:— (can't cast 3rd yet)
 *
 * Bonus spells from ability modifier (SRD bonus-spells table, basics.html):
 *   mod +4 (INT 18):  +1 bonus for spell levels 1–4
 *   mod +3 (CHA 16):  +1 bonus for spell levels 1–3
 *   (Bonus only applies for levels the caster can already cast; levels with base −1
 *    are capped to 0 by the engine and receive no bonus.)
 *
 * Expected totals:
 *   Wizard 5 / INT 18:    0th:4  1st:4  2nd:3  3rd:2
 *   Sorcerer 5 / CHA 16:  0th:6  1st:7  2nd:5  3rd:0
 *
 * Covers:
 *   1. Wizard 5 / INT 18  — spell-slot maxima match SRD values.
 *   2. Sorcerer 5 / CHA 16 — spell-slot maxima match SRD values.
 *   3. Wizard spellbook is marked non-spontaneous; Sorcerer spellbook is spontaneous.
 *   4. Spellcasting ability is correctly propagated (int / cha).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const WIZARD_ID    = 'VwVlbNYqDgMBIWhQ';
const SORCERER_ID  = 'u0ULzrnt9daT9Ygq';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── helper ────────────────────────────────────────────────────────────────────

async function createCasterLevel5(page, { classId, intScore, wisScore, chaScore, abilityKey }) {
  return page.evaluate(async ({ packId, classId, intScore, wisScore, chaScore, abilityKey }) => {
    const actor = await Actor.create({
      name: 'Caster Test Actor',
      type: 'character',
      system: {
        abilities: {
          int: { value: intScore },
          wis: { value: wisScore },
          cha: { value: chaScore },
        },
      },
    });

    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const clsData = cls.toObject();
    clsData.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [clsData]);

    // Link primary spellbook — autoSetup=true (template default) triggers full init
    await game.actors.get(actor.id).update({
      'system.attributes.spells.spellbooks.primary.class': abilityKey,
    });

    const a = game.actors.get(actor.id);
    const pb = a.system.attributes.spells.spellbooks.primary;
    return {
      actorId:       a.id,
      spontaneous:   pb.spontaneous,
      ability:       pb.ability,
      spell0max:     pb.spells?.spell0?.max ?? null,
      spell1max:     pb.spells?.spell1?.max ?? null,
      spell2max:     pb.spells?.spell2?.max ?? null,
      spell3max:     pb.spells?.spell3?.max ?? null,
    };
  }, { packId: CLASSES_PACK, classId, intScore, wisScore, chaScore, abilityKey });
}

// ── 1. Wizard 5 / INT 18 spell-slot maxima ───────────────────────────────────

test('Wizard level 5 with INT 18 gets correct spell-slot maxima', async ({ page }) => {
  // SRD base (wizard.html level 5): 0th:4  1st:3  2nd:2  3rd:1
  // INT 18 (+4 mod) bonus (basics.html): +1 for levels 1, 2, 3  (level 4 has no base at lv5)
  // Expected totals:                     0th:4  1st:4  2nd:3  3rd:2
  const result = await createCasterLevel5(page, {
    classId:    WIZARD_ID,
    intScore:   18,
    wisScore:   10,
    chaScore:   10,
    abilityKey: 'wizard',
  });

  expect(result.spell0max, 'wizard 5 / INT 18: 0th-level slots').toBe(4);
  expect(result.spell1max, 'wizard 5 / INT 18: 1st-level slots').toBe(4); // 3 base + 1 INT bonus
  expect(result.spell2max, 'wizard 5 / INT 18: 2nd-level slots').toBe(3); // 2 base + 1 INT bonus
  expect(result.spell3max, 'wizard 5 / INT 18: 3rd-level slots').toBe(2); // 1 base + 1 INT bonus
});

// ── 2. Sorcerer 5 / CHA 16 spell-slot maxima ─────────────────────────────────

test('Sorcerer level 5 with CHA 16 gets correct spell-slot maxima', async ({ page }) => {
  // SRD base (sorcerer.html level 5): 0th:6  1st:6  2nd:4  3rd:— (no 3rd yet)
  // CHA 16 (+3 mod) bonus (basics.html): +1 for levels 1, 2  (level 3 has no base at lv5)
  // Expected totals:                     0th:6  1st:7  2nd:5  3rd:0
  const result = await createCasterLevel5(page, {
    classId:    SORCERER_ID,
    intScore:   10,
    wisScore:   10,
    chaScore:   16,
    abilityKey: 'sorcerer',
  });

  expect(result.spell0max, 'sorcerer 5 / CHA 16: 0th-level slots').toBe(6);
  expect(result.spell1max, 'sorcerer 5 / CHA 16: 1st-level slots').toBe(7); // 6 base + 1 CHA bonus
  expect(result.spell2max, 'sorcerer 5 / CHA 16: 2nd-level slots').toBe(5); // 4 base + 1 CHA bonus
  expect(result.spell3max, 'sorcerer 5 / CHA 16: 3rd-level slots').toBe(0); // no base at lv5
});

// ── 3. Spontaneous flag is correct for each class ────────────────────────────

test('Wizard spellbook is non-spontaneous, Sorcerer spellbook is spontaneous', async ({ page }) => {
  const wizard = await createCasterLevel5(page, {
    classId:    WIZARD_ID,
    intScore:   10,
    wisScore:   10,
    chaScore:   10,
    abilityKey: 'wizard',
  });
  expect(wizard.spontaneous, 'wizard primary spellbook should not be spontaneous').toBe(false);

  await page.evaluate(async () => {
    for (const a of game.actors.contents) await a.delete();
    for (const m of game.messages.contents) await m.delete();
  });

  const sorcerer = await createCasterLevel5(page, {
    classId:    SORCERER_ID,
    intScore:   10,
    wisScore:   10,
    chaScore:   10,
    abilityKey: 'sorcerer',
  });
  expect(sorcerer.spontaneous, 'sorcerer primary spellbook should be spontaneous').toBe(true);
});

// ── 4. Spellcasting ability is propagated from class ──────────────────────────

test('spellcasting ability is copied to primary spellbook from class', async ({ page }) => {
  const wizard = await createCasterLevel5(page, {
    classId:    WIZARD_ID,
    intScore:   10,
    wisScore:   10,
    chaScore:   10,
    abilityKey: 'wizard',
  });
  expect(wizard.ability, 'wizard spellcasting ability should be int').toBe('int');

  await page.evaluate(async () => {
    for (const a of game.actors.contents) await a.delete();
    for (const m of game.messages.contents) await m.delete();
  });

  const sorcerer = await createCasterLevel5(page, {
    classId:    SORCERER_ID,
    intScore:   10,
    wisScore:   10,
    chaScore:   10,
    abilityKey: 'sorcerer',
  });
  expect(sorcerer.ability, 'sorcerer spellcasting ability should be cha').toBe('cha');
});
