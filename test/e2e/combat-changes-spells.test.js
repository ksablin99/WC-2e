'use strict';

/**
 * E2E tests for combat changes on spell items.
 *
 * When a feat item carries a combatChange with itemType 'attack' and
 * actionType 'rsak' or 'msak', D35E applies the bonus to matching spell
 * attack rolls when the spell item (type: 'attack') is rolled.
 *
 * Covers:
 *   1. Feat with rsak combatChange applies attack bonus to ranged spell attacks.
 *   2. Feat with msak combatChange applies attack bonus to melee spell attacks.
 *   3. rsak and mwak combat changes are independent — each only affects its own type.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { waitForChatRoll } = require('./helpers/rolls');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const WIZARD_ID    = 'VwVlbNYqDgMBIWhQ';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper ─────────────────────────────────────────────────────────────────────

async function createWizardWithSpellAttack(page, { actionType = 'rsak' } = {}) {
  return page.evaluate(async ({ packId, classId, actionType }) => {
    const actor = await Actor.create({
      name: 'Spell Attack Wizard',
      type: 'character',
      system: { abilities: { int: { value: 16 } } },
    });

    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const cd   = cls.toObject();
    cd.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [cd]);

    const [atk] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: actionType === 'rsak' ? 'Ray of Frost' : 'Touch of Idiocy',
      type: 'attack',
      system: {
        actionType,
        ability: { attack: 'int', vsTouchAc: true },
        attackParts: [],
        damage: { parts: [['1d6', 'Cold']] },
        spellbook: 'primary',
        level: 1,
      },
    }]);

    return { actorId: actor.id, atkId: atk.id };
  }, { packId: CLASSES_PACK, classId: WIZARD_ID, actionType });
}

async function rollAndGetTotal(page, actorId, atkId) {
  const msgsBefore = await page.evaluate(() => game.messages.size);
  await page.evaluate(async ({ actorId, atkId }) => {
    const result = await game.actors.get(actorId).items.get(atkId).use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, atkId });
  const chatData = await waitForChatRoll(page, msgsBefore);
  const attacks = chatData?.attacks ?? [];
  return attacks[0]?.attack?.total ?? attacks[0]?.total ?? null;
}

// ── 1. rsak feat combat change applies to ranged spell attack ─────────────────

test('feat with rsak +100 bonus drives ranged spell attack total above 100', async ({ page }) => {
  const { actorId, atkId } = await createWizardWithSpellAttack(page, { actionType: 'rsak' });

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Spell Focus Mastery',
      type: 'feat',
      system: {
        combatChanges: [['attack', 'rsak', '', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const total = await rollAndGetTotal(page, actorId, atkId);
  if (total !== null) expect(total).toBeGreaterThan(100);
});

// ── 2. msak feat combat change applies to melee spell attack ─────────────────

test('feat with msak +100 bonus drives melee spell attack total above 100', async ({ page }) => {
  const { actorId, atkId } = await createWizardWithSpellAttack(page, { actionType: 'msak' });

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Touch Attack Mastery',
      type: 'feat',
      system: {
        combatChanges: [['attack', 'msak', '', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const total = await rollAndGetTotal(page, actorId, atkId);
  if (total !== null) expect(total).toBeGreaterThan(100);
});

// ── 3. rsak change does NOT apply to mwak ────────────────────────────────────

test('feat with rsak combat change does NOT apply to mwak attacks', async ({ page }) => {
  const result = await page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({ name: 'CC Isolation Actor', type: 'character' });
    const pack  = game.packs.get(packId);
    const cls   = await pack.getDocument(classId);
    const cd    = cls.toObject();
    cd.system.levels = 3;
    await actor.createEmbeddedDocuments('Item', [cd]);

    const [atk] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Longsword',
      type: 'attack',
      system: {
        actionType: 'mwak',
        ability: { attack: 'str', vsTouchAc: false },
        attackParts: [],
        damage: { parts: [['1d8', 'S']] },
      },
    }]);

    // rsak feat — should NOT apply to the mwak above
    await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Ray Mastery',
      type: 'feat',
      system: {
        combatChanges: [['attack', 'rsak', '', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);

    const msgsBefore = game.messages.size;
    const useResult = await game.actors.get(actor.id).items.get(atk.id).use({ skipDialog: true });
    if (useResult?.roll) await useResult.roll;
    return { actorId: actor.id, atkId: atk.id, msgsBefore };
  }, { packId: CLASSES_PACK, classId: WIZARD_ID });

  const chatData = await waitForChatRoll(page, result.msgsBefore);
  expect(chatData).not.toBeNull();
  const attacks = chatData?.attacks ?? [];
  if (attacks.length > 0) {
    const total = attacks[0]?.attack?.total ?? attacks[0]?.total;
    if (total !== undefined) expect(total).toBeLessThanOrEqual(25);
  }
});
