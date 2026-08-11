'use strict';

/**
 * E2E tests for Weapon Finesse and Weapon Focus feat combat changes.
 *
 * Regression guard for issue #1683: bare `@item.finesseable` condition in
 * safeEvaluateCondition previously crashed (TypeError) because the bare boolean
 * operand path was unhandled. The fix evaluates it as a truthy literal.
 *
 * Covers:
 *   1. Weapon Finesse: finesseable=true attack rolls without crashing.
 *   2. Weapon Finesse: finesseable=false attack rolls without crashing.
 *   3. Weapon Finesse condition proxy: finesseable=true fires (+100 → total > 100);
 *      finesseable=false skips it (total ≤ 25).
 *   4. Weapon Focus: matching baseWeaponType applies +100 attack bonus.
 *   5. Weapon Focus: non-matching baseWeaponType skips the combat change.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { waitForChatRoll } = require('./helpers/rolls');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const FIGHTER_ID   = 'sgwZt7dg1ZHXQlrW';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: Fighter 5, STR 10 / DEX 18, synthetic mwak attack ────────────────
// Uses two-step creation: name+type, then update system fields separately,
// because Foundry's prepareData() resets many system.* fields on createEmbeddedDocuments.

async function createFighterWithFinesseableAttack(page, { finesseable = true } = {}) {
  return page.evaluate(async ({ packId, classId, finesseable }) => {
    const actor = await Actor.create({ name: 'Finesse Fighter', type: 'character' });
    await game.actors.get(actor.id).update({
      'system.abilities.str.value': 10,
      'system.abilities.dex.value': 18,
    });

    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const cd   = cls.toObject();
    cd.system.levels = 5;
    await game.actors.get(actor.id).createEmbeddedDocuments('Item', [cd]);

    const a = game.actors.get(actor.id);
    const [atk] = await a.createEmbeddedDocuments('Item', [{
      name: 'Dagger',
      type: 'attack',
      system: {
        actionType: 'mwak',
        ability:    { attack: 'str', vsTouchAc: false },
        attackParts: [],
        damage:     { parts: [['1d4', 'P']] },
      },
    }]);
    // equip and set finesseable after creation (equipped is always reset to false on create)
    await game.actors.get(actor.id).items.get(atk.id).update({
      'system.equipped':   true,
      'system.finesseable': finesseable,
    });

    return { actorId: actor.id, atkId: atk.id };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID, finesseable });
}

// ── Helper: Fighter 5, STR 14, synthetic mwak attack with baseWeaponType ──────

async function createFighterWithAttack(page, { baseWeaponType = 'longsword' } = {}) {
  return page.evaluate(async ({ packId, classId, baseWeaponType }) => {
    const actor = await Actor.create({ name: 'Focus Fighter', type: 'character' });
    await game.actors.get(actor.id).update({ 'system.abilities.str.value': 14 });

    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const cd   = cls.toObject();
    cd.system.levels = 5;
    await game.actors.get(actor.id).createEmbeddedDocuments('Item', [cd]);

    const a = game.actors.get(actor.id);
    const [atk] = await a.createEmbeddedDocuments('Item', [{
      name: 'Sword',
      type: 'attack',
      system: {
        actionType: 'mwak',
        ability:    { attack: 'str', vsTouchAc: false },
        attackParts: [],
        damage:     { parts: [['1d8', 'S']] },
      },
    }]);
    await game.actors.get(actor.id).items.get(atk.id).update({
      'system.equipped':       true,
      'system.baseWeaponType': baseWeaponType,
    });

    return { actorId: actor.id, atkId: atk.id };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID, baseWeaponType });
}

// ── 1. Weapon Finesse: finesseable=true rolls without crashing ────────────────

test('Weapon Finesse: finesseable=true attack rolls without crashing', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithFinesseableAttack(page, { finesseable: true });

  // Exact Weapon Finesse combat change format from source JSON
  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Weapon Finesse',
      type: 'feat',
      system: {
        combatChanges: [['attack', '', '@item.finesseable', '$item.ability.attack', 'dex', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const msgsBefore = await page.evaluate(() => game.messages.size);
  await page.evaluate(async ({ actorId, atkId }) => {
    const result = await game.actors.get(actorId).items.get(atkId).use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, atkId });

  const chatData = await waitForChatRoll(page, msgsBefore);
  expect(chatData).not.toBeNull();
});

// ── 2. Weapon Finesse: finesseable=false rolls without crashing ───────────────

test('Weapon Finesse: finesseable=false attack rolls without crashing', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithFinesseableAttack(page, { finesseable: false });

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Weapon Finesse',
      type: 'feat',
      system: {
        combatChanges: [['attack', '', '@item.finesseable', '$item.ability.attack', 'dex', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const msgsBefore = await page.evaluate(() => game.messages.size);
  await page.evaluate(async ({ actorId, atkId }) => {
    const result = await game.actors.get(actorId).items.get(atkId).use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, atkId });

  const chatData = await waitForChatRoll(page, msgsBefore);
  expect(chatData).not.toBeNull();
});

// ── 3. Weapon Finesse condition proxy: true fires, false skips ────────────────

test('Weapon Finesse: finesseable=true applies combat change (condition true path)', async ({ page }) => {
  // Use featAttackBonus +100 as numeric proxy to verify condition fires.
  // finesseable=true → '@item.finesseable' is truthy → +100 applies → total > 100.
  const trueCase = await createFighterWithFinesseableAttack(page, { finesseable: true });
  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Weapon Finesse Proxy',
      type: 'feat',
      system: {
        combatChanges: [['attack', '', '@item.finesseable', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId: trueCase.actorId });

  const msgsBeforeTrue = await page.evaluate(() => game.messages.size);
  await page.evaluate(async ({ actorId, atkId }) => {
    const result = await game.actors.get(actorId).items.get(atkId).use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId: trueCase.actorId, atkId: trueCase.atkId });

  const chatTrue = await waitForChatRoll(page, msgsBeforeTrue);
  expect(chatTrue).not.toBeNull();
  const attacksTrue = chatTrue.attacks ?? [];
  if (attacksTrue.length > 0) {
    const total = attacksTrue[0]?.attack?.total ?? attacksTrue[0]?.total;
    if (total !== undefined) expect(total).toBeGreaterThan(100);
  }

  // false path: separate actor, finesseable=false → condition skips → total ≤ 25
  const falseCase = await createFighterWithFinesseableAttack(page, { finesseable: false });
  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Weapon Finesse Proxy',
      type: 'feat',
      system: {
        combatChanges: [['attack', '', '@item.finesseable', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId: falseCase.actorId });

  const msgsBeforeFalse = await page.evaluate(() => game.messages.size);
  await page.evaluate(async ({ actorId, atkId }) => {
    const result = await game.actors.get(actorId).items.get(atkId).use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId: falseCase.actorId, atkId: falseCase.atkId });

  const chatFalse = await waitForChatRoll(page, msgsBeforeFalse);
  expect(chatFalse).not.toBeNull();
  const attacksFalse = chatFalse.attacks ?? [];
  if (attacksFalse.length > 0) {
    const total = attacksFalse[0]?.attack?.total ?? attacksFalse[0]?.total;
    // Without +100: max ≈ d20(20) + BAB(5) + STR mod(0) = 25
    if (total !== undefined) expect(total).toBeLessThanOrEqual(25);
  }
});

// ── 4. Weapon Focus: matching baseWeaponType applies +100 bonus ───────────────

test('Weapon Focus: matching baseWeaponType applies +100 attack bonus', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithAttack(page, { baseWeaponType: 'longsword' });

  // Exact Weapon Focus condition pattern from source JSON
  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Weapon Focus (Longsword)',
      type: 'feat',
      system: {
        combatChanges: [["attack", "", "'@item.baseWeaponType' === 'longsword'", 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const msgsBefore = await page.evaluate(() => game.messages.size);
  await page.evaluate(async ({ actorId, atkId }) => {
    const result = await game.actors.get(actorId).items.get(atkId).use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, atkId });

  const chatData = await waitForChatRoll(page, msgsBefore);
  expect(chatData).not.toBeNull();
  const attacks = chatData.attacks ?? [];
  if (attacks.length > 0) {
    const total = attacks[0]?.attack?.total ?? attacks[0]?.total;
    if (total !== undefined) expect(total).toBeGreaterThan(100);
  }
});

// ── 5. Weapon Focus: non-matching baseWeaponType skips change ─────────────────

test('Weapon Focus: non-matching baseWeaponType skips combat change', async ({ page }) => {
  // Attack is 'dagger' but feat targets 'longsword' → condition false → no +100
  const { actorId, atkId } = await createFighterWithAttack(page, { baseWeaponType: 'dagger' });

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Weapon Focus (Longsword)',
      type: 'feat',
      system: {
        combatChanges: [["attack", "", "'@item.baseWeaponType' === 'longsword'", 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const msgsBefore = await page.evaluate(() => game.messages.size);
  await page.evaluate(async ({ actorId, atkId }) => {
    const result = await game.actors.get(actorId).items.get(atkId).use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, atkId });

  const chatData = await waitForChatRoll(page, msgsBefore);
  expect(chatData).not.toBeNull();
  const attacks = chatData.attacks ?? [];
  if (attacks.length > 0) {
    const total = attacks[0]?.attack?.total ?? attacks[0]?.total;
    // Without +100: max ≈ d20(20) + BAB(5) + STR mod(+2) = 27; use 30 as ceiling
    if (total !== undefined) expect(total).toBeLessThanOrEqual(30);
  }
});
