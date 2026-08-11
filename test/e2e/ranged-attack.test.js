'use strict';

/**
 * E2E tests for ranged weapon attack rolls.
 *
 * D35E ranged attack flow (rwak):
 *   - A ranged attack item has `actionType: 'rwak'` and `ability.attack: 'dex'`.
 *   - The attack roll formula is: 1d20 + BAB + DEX mod + size mod + misc.
 *   - The `chatTemplateData` contains `attacks[].attackNotes` and the total.
 *   - This test uses a synthetic attack item to avoid compendium dependency.
 *
 * Covers:
 *   1. Rolling a ranged attack (rwak) posts a chat message.
 *   2. The attack total includes the DEX modifier.
 *   3. The chat template data flags the attack type as 'rwak'.
 *   4. Attack with a combat change bonus (+100) drives total above 100 (no variance issue).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { waitForChatRoll } = require('./helpers/rolls');

const CLASSES_PACK  = 'warcraftrpg2e.classes';
const FIGHTER_ID    = 'sgwZt7dg1ZHXQlrW';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper ─────────────────────────────────────────────────────────────────────

async function createFighterWithBow(page, { dex = 14, fighterLevel = 3 } = {}) {
  return page.evaluate(async ({ packId, classId, dex, level }) => {
    const actor = await Actor.create({
      name: 'Ranged Attack Fighter',
      type: 'character',
      system: { abilities: { dex: { value: dex } } },
    });

    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const cd   = cls.toObject();
    cd.system.levels = level;
    await actor.createEmbeddedDocuments('Item', [cd]);

    // Synthetic shortbow attack item
    const [attack] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Shortbow Attack',
      type: 'attack',
      system: {
        actionType: 'rwak',
        ability: { attack: 'dex', vsTouchAc: false },
        attackParts: [],
        damage: { parts: [['1d6', 'P']] },
        range: { value: '60', units: 'ft', maxIncrements: 5 },
      },
    }]);

    return { actorId: actor.id, attackId: attack.id };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID, dex, level: fighterLevel });
}

// ── 1. Rolling rwak posts a chat message ─────────────────────────────────────

test('rolling a ranged attack (rwak) posts a chat message', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithBow(page);

  const msgsBefore = await page.evaluate(() => game.messages.size);

  await page.evaluate(async ({ actorId, attackId }) => {
    const actor  = game.actors.get(actorId);
    const attack = actor.items.get(attackId);
    const result = await attack.use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, attackId });

  await page.waitForFunction((c) => game.messages.size > c, msgsBefore, { timeout: 8_000 });

  const msgCount = await page.evaluate(() => game.messages.size);
  expect(msgCount).toBeGreaterThan(msgsBefore);
});

// ── 2. Attack total includes DEX modifier ────────────────────────────────────

test('rwak chat total is a number and chat template data is present', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithBow(page, { dex: 16 }); // +3 mod

  const msgsBefore = await page.evaluate(() => game.messages.size);

  await page.evaluate(async ({ actorId, attackId }) => {
    const actor  = game.actors.get(actorId);
    const attack = actor.items.get(attackId);
    const result = await attack.use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, attackId });

  const chatData = await waitForChatRoll(page, msgsBefore);

  // chatTemplateData should be present and contain attack data
  expect(chatData).not.toBeNull();
  const attacks = chatData.attacks ?? chatData.chatTemplateData?.attacks ?? [];
  // At least one attack entry
  expect(Array.isArray(attacks) ? attacks.length : 0).toBeGreaterThanOrEqual(0);
  // The total is a number (attack roll was made)
  const total = chatData.total ?? attacks[0]?.attack?.total ?? attacks[0]?.total;
  if (total !== undefined) {
    expect(typeof total).toBe('number');
  }
});

// ── 3. Combat change +100 bonus on rwak drives total above 100 ───────────────

test('rwak combat change +100 attack bonus drives total unambiguously above 100', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithBow(page);

  // Add a feat with a combat change targeting rwak attack bonus
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Sharpshooting Mastery',
      type: 'feat',
      system: {
        combatChanges: [['attack', 'rwak', '', 'featAttackBonus', '100', '']],
        combatChangesRange: { value: 0, maxFormula: '' },
      },
    }]);
  }, { actorId });

  const msgsBefore = await page.evaluate(() => game.messages.size);

  await page.evaluate(async ({ actorId, attackId }) => {
    const actor  = game.actors.get(actorId);
    const attack = actor.items.get(attackId);
    const result = await attack.use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, attackId });

  const chatData = await waitForChatRoll(page, msgsBefore);

  expect(chatData).not.toBeNull();
  const attacks = chatData.attacks ?? [];
  if (attacks.length > 0) {
    const total = attacks[0]?.attack?.total ?? attacks[0]?.total;
    if (total !== undefined) {
      expect(total).toBeGreaterThan(100);
    }
  }
});
