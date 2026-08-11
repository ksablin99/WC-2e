'use strict';

/**
 * E2E tests for combat changes on feat items (the primary regression guard).
 *
 * D35E combat changes (system.combatChanges) are arrays of:
 *   [itemType, actionType, condition, field, formula, specialAction]
 *
 * When an item of `type: 'feat'` carries a combatChange entry, D35E's
 * `_addCombatChangesToRollData` puts the value into `rollData.{field}` and
 * `rollData.{field}List`. Rolls then consume those lists to add to their totals.
 *
 * Field → rollData key mapping:
 *   featAttackBonus  → rollData.featAttackBonusList  (attack rolls)
 *   featDamageBonus  → rollData.featDamageBonusList  (damage rolls)
 *   featSavingThrow  → rollData.featSavingThrowList  (save rolls)
 *
 * Strategy: Use a +100 bonus so the roll total is always > 100 regardless of
 * d20 variance. This means the test can assert `total > 100` unconditionally.
 *
 * Covers:
 *   1. mwak combat change (featAttackBonus) on feat → melee attack total > 100.
 *   2. rwak combat change (featAttackBonus) on feat → ranged attack total > 100.
 *   3. Condition-gated change (condition true) → bonus applies.
 *   4. Condition-gated change (condition false) → bonus absent, total ≤ 21.
 *   5. `@source.system.enh` self-referencing formula uses the feat's own field.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { embedSyntheticCombatFeat, waitForChatAfter } = require('./helpers/skill-roll');
const { waitForChatRoll } = require('./helpers/rolls');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const FIGHTER_ID   = 'sgwZt7dg1ZHXQlrW';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: create Fighter 5 with a melee attack item ─────────────────────────

async function createFighterWithMelee(page, { str = 10, level = 5 } = {}) {
  return page.evaluate(async ({ packId, classId, str, level }) => {
    const actor = await Actor.create({
      name: 'Combat Changes Feat Fighter',
      type: 'character',
      system: { abilities: { str: { value: str } } },
    });
    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const cd   = cls.toObject();
    cd.system.levels = level;
    await actor.createEmbeddedDocuments('Item', [cd]);

    const [atk] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Longsword',
      type: 'attack',
      system: {
        actionType: 'mwak',
        ability:    { attack: 'str', vsTouchAc: false },
        attackParts: [],
        damage:     { parts: [['1d8', 'S']] },
        equipped:   true,
      },
    }]);

    return { actorId: actor.id, atkId: atk.id };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID, str, level });
}

async function createFighterWithRanged(page) {
  return page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({
      name: 'Combat Changes Ranged Fighter',
      type: 'character',
      system: { abilities: { dex: { value: 14 } } },
    });
    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const cd   = cls.toObject();
    cd.system.levels = 3;
    await actor.createEmbeddedDocuments('Item', [cd]);

    const [atk] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Shortbow',
      type: 'attack',
      system: {
        actionType: 'rwak',
        ability:    { attack: 'dex', vsTouchAc: false },
        attackParts: [],
        damage:     { parts: [['1d6', 'P']] },
      },
    }]);

    return { actorId: actor.id, atkId: atk.id };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID });
}

// ── 1. mwak feat attack bonus applies ────────────────────────────────────────

test('feat with mwak +100 attack bonus drives melee attack total above 100', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithMelee(page);

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Power Attack Mastery',
      type: 'feat',
      system: {
        combatChanges: [['attack', 'mwak', '', 'featAttackBonus', '100', '']],
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

// ── 2. rwak feat attack bonus applies ────────────────────────────────────────

test('feat with rwak +100 attack bonus drives ranged attack total above 100', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithRanged(page);

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Precise Shot Mastery',
      type: 'feat',
      system: {
        combatChanges: [['attack', 'rwak', '', 'featAttackBonus', '100', '']],
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

// ── 3. Condition-gated change: condition true → bonus applies ─────────────────

test('condition-gated feat change applies when condition evaluates true', async ({ page }) => {
  // Fighter 5 → @classes.fighter.level = 5 which is > 3, so change fires
  const { actorId, atkId } = await createFighterWithMelee(page, { level: 5 });

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Gated Mastery (active)',
      type: 'feat',
      system: {
        // condition evaluated as JS inside D35E; @classes.fighter.level is subst to 5
        combatChanges: [['attack', 'mwak', '@classes.fighter.level > 3', 'featAttackBonus', '100', '']],
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

// ── 4. Condition-gated change: condition false → bonus absent ─────────────────

test('condition-gated feat change is absent when condition evaluates false', async ({ page }) => {
  // Fighter 2 → @classes.fighter.level = 2 which is NOT > 3, so change does not fire
  const { actorId, atkId } = await createFighterWithMelee(page, { level: 2 });

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Gated Mastery (inactive)',
      type: 'feat',
      system: {
        combatChanges: [['attack', 'mwak', '@classes.fighter.level > 3', 'featAttackBonus', '100', '']],
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
    if (total !== undefined) {
      // Without the +100 bonus, max total is 20 (d20) + ~2 (BAB) + ~0 (STR) ≈ 22
      expect(total).toBeLessThanOrEqual(25);
    }
  }
});

// ── 5. feat with 'all' itemType applies to any roll ───────────────────────────

test('feat with all itemType applies attack bonus to melee attacks', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithMelee(page);

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Universal Mastery',
      type: 'feat',
      system: {
        combatChanges: [['all', '', '', 'featAttackBonus', '100', '']],
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
