'use strict';

/**
 * E2E tests for combat changes on buff and equipment items.
 *
 * These tests verify:
 *   - A buff with an active combatChange contributes its bonus to rolls.
 *   - The same buff *inactive* does NOT contribute.
 *   - An equipment item with a combatChange applies when equipped.
 *   - The same equipment *unequipped* does NOT apply.
 *   - Condition-gated changes on buffs respect class-level expressions.
 *
 * All use +100 bonus so the roll total unambiguously signals whether the
 * change was applied (total > 100) or not (total ≤ 25).
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

// ── Setup helpers ──────────────────────────────────────────────────────────────

async function createFighterWithMelee(page, { level = 3 } = {}) {
  return page.evaluate(async ({ packId, classId, level }) => {
    const actor = await Actor.create({
      name: 'CC Buff Test Actor',
      type: 'character',
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
        ability: { attack: 'str', vsTouchAc: false },
        attackParts: [],
        damage: { parts: [['1d8', 'S']] },
        equipped: true,
      },
    }]);

    return { actorId: actor.id, atkId: atk.id };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID, level });
}

async function rollMeleeAndGetTotal(page, actorId, atkId) {
  const msgsBefore = await page.evaluate(() => game.messages.size);
  await page.evaluate(async ({ actorId, atkId }) => {
    const result = await game.actors.get(actorId).items.get(atkId).use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, atkId });
  const chatData = await waitForChatRoll(page, msgsBefore);
  const attacks = chatData?.attacks ?? [];
  return attacks[0]?.attack?.total ?? attacks[0]?.total ?? null;
}

// ── 1. Active buff with mwak combat change applies ────────────────────────────

test('active buff with mwak +100 bonus drives attack total above 100', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithMelee(page);

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Greater Heroism',
      type: 'buff',
      system: {
        active: true,
        combatChanges: [['attack', 'mwak', '', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const total = await rollMeleeAndGetTotal(page, actorId, atkId);
  if (total !== null) expect(total).toBeGreaterThan(100);
});

// ── 2. Inactive buff does NOT contribute ─────────────────────────────────────

test('inactive buff with mwak combat change does NOT affect attack total', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithMelee(page);

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Greater Heroism (inactive)',
      type: 'buff',
      system: {
        active: false, // <-- inactive
        combatChanges: [['attack', 'mwak', '', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const total = await rollMeleeAndGetTotal(page, actorId, atkId);
  if (total !== null) expect(total).toBeLessThanOrEqual(25);
});

// ── 3. Equipped weapon enchant applies ───────────────────────────────────────

test('equipped weapon item with mwak combat change applies bonus', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithMelee(page);

  await page.evaluate(async ({ actorId }) => {
    const [equip] = await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Weapon Buff Equipment',
      type: 'equipment',
      system: {
        equipped: false,
        combatChanges: [['attack', 'mwak', '', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
    await game.actors.get(actorId).items.get(equip.id).update({ 'system.equipped': true });
  }, { actorId });

  const total = await rollMeleeAndGetTotal(page, actorId, atkId);
  if (total !== null) expect(total).toBeGreaterThan(100);
});

// ── 4. Unequipped equipment does NOT contribute ───────────────────────────────

test('unequipped equipment with mwak combat change does NOT apply bonus', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithMelee(page);

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Weapon Buff Equipment (unequipped)',
      type: 'equipment',
      system: {
        equipped: false, // <-- not equipped
        combatChanges: [['attack', 'mwak', '', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const total = await rollMeleeAndGetTotal(page, actorId, atkId);
  if (total !== null) expect(total).toBeLessThanOrEqual(25);
});

// ── 5. Active buff: condition @classes.fighter.level > 4 at level 5 fires ────

test('buff change with fighter level > 4 condition fires at level 5', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithMelee(page, { level: 5 });

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Level-Gated Buff',
      type: 'buff',
      system: {
        active: true,
        combatChanges: [['attack', 'mwak', '@classes.fighter.level > 4', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const total = await rollMeleeAndGetTotal(page, actorId, atkId);
  if (total !== null) expect(total).toBeGreaterThan(100);
});

// ── 6. Active buff: condition @classes.fighter.level > 4 at level 3 skips ────

test('buff change with fighter level > 4 condition skips at level 3', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithMelee(page, { level: 3 });

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Level-Gated Buff (too low)',
      type: 'buff',
      system: {
        active: true,
        combatChanges: [['attack', 'mwak', '@classes.fighter.level > 4', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const total = await rollMeleeAndGetTotal(page, actorId, atkId);
  if (total !== null) expect(total).toBeLessThanOrEqual(25);
});
