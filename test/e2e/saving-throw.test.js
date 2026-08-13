'use strict';

/**
 * E2E tests for saving throw rolls.
 *
 * D35E saving throw flow:
 *   1. actor.rollSavingThrow(type) always opens a Dialog (no skipDialog path).
 *   2. User clicks the "Roll" button.
 *   3. createCustomChatMessage posts a chat message with flags.warcraftrpg2e.chatTemplateData.
 *   4. chatTemplateData.total is the final roll total (1d20 + save bonus).
 *
 * Covers:
 *   1. Fort, Ref, and Will saves each post a chat message with a numeric total.
 *   2. Roll totals fall within the expected range (1d20 + base bonus).
 *   3. An active save-boosting buff increases the actor's save total.
 *   4. Combat change targeting savingThrow adds a feat bonus to the roll range.
 *   5. Situational save bonus field (st-bonus) in the dialog on Fort/Ref/Will (GL#1424).
 *   6. Negative situational bonus reduces the rolled total range (GL#1424).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { rollSavingThrowViaDialog, rollSavingThrowViaDialogWithStBonus } = require('./helpers/rolls');
const { embedSyntheticCombatFeat } = require('./helpers/skill-roll');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const FIGHTER_ID   = 'sgwZt7dg1ZHXQlrW'; // Fighter — predictable fort/ref/will at lv5

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: create a Fighter with predictable save bonuses ────────────────────
//
// Fighter 5, CON 14 (+2), DEX 12 (+1), WIS 10 (+0)
// Fort base: 4 → total = 4 + 2 = +6 → roll in [7, 26]
// Ref  base: 1 → total = 1 + 1 = +2 → roll in [3, 22]
// Will base: 1 → total = 1 + 0 = +1 → roll in [2, 21]

async function createFighterLevel5(page) {
  return page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({
      name: 'Save Test Fighter',
      type: 'character',
      system: {
        abilities: {
          con: { value: 14 },
          dex: { value: 12 },
          wis: { value: 10 },
        },
      },
    });
    const pack = game.packs.get(packId);
    const classItem = await pack.getDocument(classId);
    const classData = classItem.toObject();
    classData.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [classData]);
    const a = game.actors.get(actor.id);
    return {
      actorId:   a.id,
      fortTotal: a.system.attributes.savingThrows.fort.total,
      refTotal:  a.system.attributes.savingThrows.ref.total,
      willTotal: a.system.attributes.savingThrows.will.total,
    };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID });
}

// ── 1. Fort save posts chat with numeric total in expected range ──────────────

test('Fort saving throw posts chat message with total in expected range', async ({ page }) => {
  const { actorId, fortTotal } = await createFighterLevel5(page);

  const chatData = await rollSavingThrowViaDialog(page, actorId, 'fort');

  expect(chatData).not.toBeNull();
  expect(typeof chatData.total).toBe('number');
  // 1d20 + fortTotal; d20 ∈ [1, 20]
  expect(chatData.total).toBeGreaterThanOrEqual(1 + fortTotal);
  expect(chatData.total).toBeLessThanOrEqual(20 + fortTotal);
});

// ── 2. Ref save ───────────────────────────────────────────────────────────────

test('Ref saving throw posts chat message with total in expected range', async ({ page }) => {
  const { actorId, refTotal } = await createFighterLevel5(page);

  const chatData = await rollSavingThrowViaDialog(page, actorId, 'ref');

  expect(chatData).not.toBeNull();
  expect(typeof chatData.total).toBe('number');
  expect(chatData.total).toBeGreaterThanOrEqual(1 + refTotal);
  expect(chatData.total).toBeLessThanOrEqual(20 + refTotal);
});

// ── 3. Will save ──────────────────────────────────────────────────────────────

test('Will saving throw posts chat message with total in expected range', async ({ page }) => {
  const { actorId, willTotal } = await createFighterLevel5(page);

  const chatData = await rollSavingThrowViaDialog(page, actorId, 'will');

  expect(chatData).not.toBeNull();
  expect(typeof chatData.total).toBe('number');
  expect(chatData.total).toBeGreaterThanOrEqual(1 + willTotal);
  expect(chatData.total).toBeLessThanOrEqual(20 + willTotal);
});

// ── 4. Active save-boosting buff increases fort total ─────────────────────────

test('active resistance buff increases fort save total on the actor', async ({ page }) => {
  const { actorId, fortTotal } = await createFighterLevel5(page);

  // Add +5 resistance buff to all saving throws
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Cloak of Resistance +5',
      type: 'buff',
      system: {
        active: true,
        changes: [['5', 'savingThrows', 'allSavingThrows', 'resist', 0]],
      },
    }]);
  }, { actorId });

  const buffedFort = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.savingThrows.fort.total;
  }, { actorId });

  expect(buffedFort).toBe(fortTotal + 5);
});

// ── 5. Combat change (feat) adds bonus to saving throw roll range ─────────────
//
// Feat with featSavingThrow field +100 → roll total always > 100.
// Without the feat: total ≤ 20 + fortTotal (< 100 for any normal character).

test('combat change feat with featSavingThrow +100 shifts fort save total above 100', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  const { actorId, fortTotal } = await createFighterLevel5(page);

  // Base roll: max is 20 + fortTotal ≈ 26 — well below 100
  const baseData = await rollSavingThrowViaDialog(page, actorId, 'fort');
  expect(baseData.total).toBeLessThanOrEqual(26);

  // Add feat with +100 featSavingThrow combat change targeting fort saves
  await embedSyntheticCombatFeat(page, {
    actorId,
    name: 'E2E Iron Will +100',
    combatChanges: [['savingThrow', '', '', 'featSavingThrow', '100', '']],
  });

  const boostedData = await rollSavingThrowViaDialog(page, actorId, 'fort');
  // 1d20 + fortTotal + 100 → minimum is 101+fortTotal > 100
  expect(boostedData.total).toBeGreaterThan(100);

  const badErrors = consoleErrors.filter(e =>
    e.includes('SyntaxError') || e.includes('TypeError') || e.includes('Error')
  );
  expect(badErrors, 'no errors during saving throw with combat change').toHaveLength(0);
});

// ── 6. Situational fort bonus in save dialog (GL#1424) ────────────────────────

test('GL#1424 situational save bonus (+10) is included in fort roll total', async ({
  page,
}) => {
  const { actorId, fortTotal } = await createFighterLevel5(page);
  const chatData = await rollSavingThrowViaDialogWithStBonus(page, actorId, 'fort', '10');

  expect(chatData).not.toBeNull();
  expect(typeof chatData.total).toBe('number');
  expect(chatData.total).toBeGreaterThanOrEqual(1 + fortTotal + 10);
  expect(chatData.total).toBeLessThanOrEqual(20 + fortTotal + 10);
});

test('GL#1424 situational save bonus (+10) is included in ref roll total', async ({
  page,
}) => {
  const { actorId, refTotal } = await createFighterLevel5(page);
  const chatData = await rollSavingThrowViaDialogWithStBonus(page, actorId, 'ref', '10');

  expect(chatData).not.toBeNull();
  expect(typeof chatData.total).toBe('number');
  expect(chatData.total).toBeGreaterThanOrEqual(1 + refTotal + 10);
  expect(chatData.total).toBeLessThanOrEqual(20 + refTotal + 10);
});

test('GL#1424 situational save bonus (+10) is included in will roll total', async ({
  page,
}) => {
  const { actorId, willTotal } = await createFighterLevel5(page);
  const chatData = await rollSavingThrowViaDialogWithStBonus(page, actorId, 'will', '10');

  expect(chatData).not.toBeNull();
  expect(typeof chatData.total).toBe('number');
  expect(chatData.total).toBeGreaterThanOrEqual(1 + willTotal + 10);
  expect(chatData.total).toBeLessThanOrEqual(20 + willTotal + 10);
});

test('GL#1424 negative situational save bonus is included in fort roll total', async ({
  page,
}) => {
  const { actorId, fortTotal } = await createFighterLevel5(page);
  const bonus = -5;
  const chatData = await rollSavingThrowViaDialogWithStBonus(page, actorId, 'fort', String(bonus));

  expect(chatData).not.toBeNull();
  expect(typeof chatData.total).toBe('number');
  expect(chatData.total).toBeGreaterThanOrEqual(1 + fortTotal + bonus);
  expect(chatData.total).toBeLessThanOrEqual(20 + fortTotal + bonus);
});
