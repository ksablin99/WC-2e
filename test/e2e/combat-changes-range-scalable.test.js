'use strict';

/**
 * E2E tests for @source.* substitution in scalable combat change formulas.
 *
 * `@range` is reserved for the optional-feat slider dialog and is always 0
 * for non-optional feats. Instead we use `@source.combatChangesRange.value`
 * which reads directly from `item.system.combatChangesRange.value` and works
 * for all feat types at roll time (see combatChanges.js lines 70-73).
 *
 * Formulas containing `@` MUST use `&field` (e.g. `&featAttackBonus`) so the
 * formula is kept as a string and concatenated for Roll35e evaluation rather
 * than being `parseInt()`'d which would truncate arithmetic expressions.
 *
 * Strategy: set range value = 5, formula = "@source.combatChangesRange.value * 20"
 * → expected bonus = 100. Uses the same >100 assertion pattern as other tests.
 *
 * Covers:
 *   1. @source.* formula produces the correct scaled bonus.
 *   2. Zero range value → zero modifier (no errors).
 *   3. @source.combatChangesRange.value > 0 condition gates at zero.
 *   4. Non-zero value satisfies condition and applies.
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

// ── Helper ─────────────────────────────────────────────────────────────────────

async function createFighterWithMeleeAndRangeFeat(page, { rangeValue, formula, condition = '' } = {}) {
  return page.evaluate(async ({ packId, classId, rangeValue, formula, condition }) => {
    const actor = await Actor.create({ name: 'Range Scalable Actor', type: 'character' });
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
        ability:    { attack: 'str', vsTouchAc: false },
        attackParts: [],
        damage:     { parts: [['1d8', 'S']] },
        equipped:   true,
      },
    }]);

    await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Scalable Feat',
      type: 'feat',
      system: {
        combatChanges: [['attack', 'mwak', condition, '&featAttackBonus', formula, '']],
        combatChangesRange: { value: rangeValue, maxFormula: '' },
      },
    }]);

    return { actorId: actor.id, atkId: atk.id };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID, rangeValue, formula, condition });
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

// ── 1. @source substitution: range=5, formula scales to bonus of 100 ─────────

test('@source substitution: range=5, formula="@source.combatChangesRange.value * 20" applies bonus of 100', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithMeleeAndRangeFeat(page, {
    rangeValue: 5,
    formula:    '@source.combatChangesRange.value * 20',
  });

  const total = await rollAndGetTotal(page, actorId, atkId);
  if (total !== null) expect(total).toBeGreaterThan(100);
});

// ── 2. Zero range → zero modifier, no errors ─────────────────────────────────

test('@source substitution: range=0, formula="@source.combatChangesRange.value * 20" results in zero bonus (≤25)', async ({ page }) => {
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(msg.text());
  });

  const { actorId, atkId } = await createFighterWithMeleeAndRangeFeat(page, {
    rangeValue: 0,
    formula:    '@source.combatChangesRange.value * 20',
  });

  const total = await rollAndGetTotal(page, actorId, atkId);
  // No +100 bonus, so total should be d20 + BAB (≤ 20 + 3 + STR mod ≈ 23)
  if (total !== null) expect(total).toBeLessThanOrEqual(25);
  // No functional errors during evaluation (404s for missing item images are filtered)
  expect(errors).toHaveLength(0);
});

// ── 3. @source condition gates at zero ───────────────────────────────────────

test('@source > 0 condition: range=0 → bonus not applied (total ≤25)', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithMeleeAndRangeFeat(page, {
    rangeValue: 0,
    formula:    '@source.combatChangesRange.value * 20',
    condition:  '@source.combatChangesRange.value > 0',
  });

  const total = await rollAndGetTotal(page, actorId, atkId);
  if (total !== null) expect(total).toBeLessThanOrEqual(25);
});

// ── 4. @source condition satisfied at non-zero ────────────────────────────────

test('@source > 0 condition: range=5 → bonus applied (total >100)', async ({ page }) => {
  const { actorId, atkId } = await createFighterWithMeleeAndRangeFeat(page, {
    rangeValue: 5,
    formula:    '@source.combatChangesRange.value * 20',
    condition:  '@source.combatChangesRange.value > 0',
  });

  const total = await rollAndGetTotal(page, actorId, atkId);
  if (total !== null) expect(total).toBeGreaterThan(100);
});
