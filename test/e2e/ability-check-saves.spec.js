'use strict';

/**
 * E2E tests for issue #1527: "Enhancing ability checks also effects saves"
 *
 * SRD 3.5e rule: A bonus to an ability CHECK (checkMod) is separate from the
 * ability modifier that governs saving throws.  A +4 bonus to Dex checks must
 * NOT add to Reflex saves; a +4 bonus to Con checks must NOT add to Fort saves;
 * a +4 bonus to Wis checks must NOT add to Will saves.
 *
 * Change format (raw): [formula, buffTarget_group, changeTarget_key, bonusType, value]
 *   e.g. ["4", "abilityChecks", "dexChecks", "untyped", 0]
 *
 * Saving throw totals: system.attributes.savingThrows.{fort|ref|will}.total
 * Ability checkMod:    system.abilities.{str|dex|con|int|wis|cha}.checkMod
 *
 * Covers:
 *   1. dexChecks +4 buff → Reflex save total unchanged; dex.checkMod = +4
 *   2. conChecks +4 buff → Fort save total unchanged;   con.checkMod = +4
 *   3. wisChecks +4 buff → Will save total unchanged;   wis.checkMod = +4
 *   4. allChecks +4 buff → ALL saving throws unchanged; all checkMods = +4
 *   5. Inactive ability-check buff has no effect on saves OR checkMod
 *   6. allChecks buff does NOT affect ability score totals/mods (it is NOT a
 *      bonus to the ability score itself)
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: create a character with predictable ability scores ────────────────
//
// DEX 14 (+2)  → affects Ref save
// CON 14 (+2)  → affects Fort save
// WIS 14 (+2)  → affects Will save
// No class items → base saving throw contribution = 0 for all three
// so save totals = just the ability modifier (+ any changes applied)

async function createAbilityCheckActor(page, name = 'AbilityCheck Test Actor') {
  return page.evaluate(async (name) => {
    const actor = await Actor.create({ name, type: 'character' });
    await actor.update({
      'system.abilities.dex.value': 14,
      'system.abilities.con.value': 14,
      'system.abilities.wis.value': 14,
      'system.abilities.str.value': 10,
      'system.abilities.int.value': 10,
      'system.abilities.cha.value': 10,
    });
    const a = game.actors.get(actor.id);
    return {
      actorId: a.id,
      fort:    a.system.attributes.savingThrows.fort.total,
      ref:     a.system.attributes.savingThrows.ref.total,
      will:    a.system.attributes.savingThrows.will.total,
      dexMod:  a.system.abilities.dex.mod,
      conMod:  a.system.abilities.con.mod,
      wisMod:  a.system.abilities.wis.mod,
    };
  }, name);
}

// ── 1. dexChecks buff does NOT change Reflex save ────────────────────────────

test('dexChecks +4 buff does not change Reflex save total', async ({ page }) => {
  const { actorId, ref: refBefore } = await createAbilityCheckActor(page);

  // Sanity: DEX 14 → mod +2 → ref save should be +2 (no class levels)
  expect(refBefore).toBe(2);

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Dex Check Buff',
      type: 'buff',
      system: {
        active: true,
        // format: [formula, buffTarget_group, changeTarget_key, bonusType, value]
        changes: [['4', 'abilityChecks', 'dexChecks', 'untyped', 0]],
      },
    }]);
  }, { actorId });

  const after = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    return {
      ref:         a.system.attributes.savingThrows.ref.total,
      fort:        a.system.attributes.savingThrows.fort.total,
      will:        a.system.attributes.savingThrows.will.total,
      dexCheckMod: a.system.abilities.dex.checkMod,
    };
  }, { actorId });

  // Reflex save must NOT be affected by a Dex *check* bonus
  expect(after.ref).toBe(refBefore);

  // Fort and Will must also be untouched
  expect(after.fort).toBe(2);
  expect(after.will).toBe(2);

  // But the checkMod on DEX must reflect the buff
  expect(after.dexCheckMod).toBe(4);
});

// ── 2. conChecks buff does NOT change Fortitude save ─────────────────────────

test('conChecks +4 buff does not change Fortitude save total', async ({ page }) => {
  const { actorId, fort: fortBefore } = await createAbilityCheckActor(page);

  expect(fortBefore).toBe(2); // CON 14 → mod +2

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Con Check Buff',
      type: 'buff',
      system: {
        active: true,
        changes: [['4', 'abilityChecks', 'conChecks', 'untyped', 0]],
      },
    }]);
  }, { actorId });

  const after = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    return {
      fort:        a.system.attributes.savingThrows.fort.total,
      ref:         a.system.attributes.savingThrows.ref.total,
      will:        a.system.attributes.savingThrows.will.total,
      conCheckMod: a.system.abilities.con.checkMod,
    };
  }, { actorId });

  // Fort save must NOT be affected by a Con *check* bonus
  expect(after.fort).toBe(fortBefore);

  // Ref and Will untouched too
  expect(after.ref).toBe(2);
  expect(after.will).toBe(2);

  // checkMod must be applied
  expect(after.conCheckMod).toBe(4);
});

// ── 3. wisChecks buff does NOT change Will save ───────────────────────────────

test('wisChecks +4 buff does not change Will save total', async ({ page }) => {
  const { actorId, will: willBefore } = await createAbilityCheckActor(page);

  expect(willBefore).toBe(2); // WIS 14 → mod +2

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Wis Check Buff',
      type: 'buff',
      system: {
        active: true,
        changes: [['4', 'abilityChecks', 'wisChecks', 'untyped', 0]],
      },
    }]);
  }, { actorId });

  const after = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    return {
      will:        a.system.attributes.savingThrows.will.total,
      fort:        a.system.attributes.savingThrows.fort.total,
      ref:         a.system.attributes.savingThrows.ref.total,
      wisCheckMod: a.system.abilities.wis.checkMod,
    };
  }, { actorId });

  // Will save must NOT be affected by a Wis *check* bonus
  expect(after.will).toBe(willBefore);

  // Fort and Ref untouched
  expect(after.fort).toBe(2);
  expect(after.ref).toBe(2);

  // checkMod must be applied
  expect(after.wisCheckMod).toBe(4);
});

// ── 4. allChecks buff does NOT change ANY saving throw ────────────────────────

test('allChecks +4 buff does not change any saving throw total', async ({ page }) => {
  const { actorId, fort: fortBefore, ref: refBefore, will: willBefore } =
    await createAbilityCheckActor(page);

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'All Checks Buff',
      type: 'buff',
      system: {
        active: true,
        changes: [['4', 'abilityChecks', 'allChecks', 'untyped', 0]],
      },
    }]);
  }, { actorId });

  const after = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    return {
      fort:        a.system.attributes.savingThrows.fort.total,
      ref:         a.system.attributes.savingThrows.ref.total,
      will:        a.system.attributes.savingThrows.will.total,
      strCheckMod: a.system.abilities.str.checkMod,
      dexCheckMod: a.system.abilities.dex.checkMod,
      conCheckMod: a.system.abilities.con.checkMod,
      intCheckMod: a.system.abilities.int.checkMod,
      wisCheckMod: a.system.abilities.wis.checkMod,
      chaCheckMod: a.system.abilities.cha.checkMod,
    };
  }, { actorId });

  // No saving throw must be affected
  expect(after.fort).toBe(fortBefore);
  expect(after.ref).toBe(refBefore);
  expect(after.will).toBe(willBefore);

  // But ALL checkMods must reflect the buff
  expect(after.strCheckMod).toBe(4);
  expect(after.dexCheckMod).toBe(4);
  expect(after.conCheckMod).toBe(4);
  expect(after.intCheckMod).toBe(4);
  expect(after.wisCheckMod).toBe(4);
  expect(after.chaCheckMod).toBe(4);
});

// ── 5. Inactive ability-check buff has no effect ──────────────────────────────

test('inactive dexChecks buff does not affect Reflex save or checkMod', async ({ page }) => {
  const { actorId, ref: refBefore } = await createAbilityCheckActor(page);

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Inactive Dex Check Buff',
      type: 'buff',
      system: {
        active: false,
        changes: [['4', 'abilityChecks', 'dexChecks', 'untyped', 0]],
      },
    }]);
  }, { actorId });

  const after = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    return {
      ref:         a.system.attributes.savingThrows.ref.total,
      dexCheckMod: a.system.abilities.dex.checkMod,
    };
  }, { actorId });

  expect(after.ref).toBe(refBefore);
  // An inactive buff should not apply checkMod either
  expect(after.dexCheckMod).toBe(0);
});

// ── 6. allChecks buff does NOT modify the ability score total or mod ──────────
//
// This confirms that checkMod and the core ability modifier (used for saves,
// attacks, etc.) are distinct values.  A check bonus must not raise DEX's
// effective total.

test('allChecks buff does not change ability score totals or mods', async ({ page }) => {
  const { actorId } = await createAbilityCheckActor(page);

  // Record base ability totals/mods before the buff
  const before = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    return {
      dexTotal: a.system.abilities.dex.total,
      dexMod:   a.system.abilities.dex.mod,
      conTotal: a.system.abilities.con.total,
      conMod:   a.system.abilities.con.mod,
      wisTotal: a.system.abilities.wis.total,
      wisMod:   a.system.abilities.wis.mod,
    };
  }, { actorId });

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'All Checks Score Test Buff',
      type: 'buff',
      system: {
        active: true,
        changes: [['4', 'abilityChecks', 'allChecks', 'untyped', 0]],
      },
    }]);
  }, { actorId });

  const after = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    return {
      dexTotal: a.system.abilities.dex.total,
      dexMod:   a.system.abilities.dex.mod,
      conTotal: a.system.abilities.con.total,
      conMod:   a.system.abilities.con.mod,
      wisTotal: a.system.abilities.wis.total,
      wisMod:   a.system.abilities.wis.mod,
    };
  }, { actorId });

  // Ability score totals must be unchanged
  expect(after.dexTotal).toBe(before.dexTotal);
  expect(after.conTotal).toBe(before.conTotal);
  expect(after.wisTotal).toBe(before.wisTotal);

  // Ability score mods must be unchanged
  expect(after.dexMod).toBe(before.dexMod);
  expect(after.conMod).toBe(before.conMod);
  expect(after.wisMod).toBe(before.wisMod);
});
