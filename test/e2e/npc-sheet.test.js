'use strict';

/**
 * E2E tests for the NPC actor sheet.
 *
 * The NPC sheet (module/actor/sheets/npc.js) is a separate code path from the
 * character sheet. It is rendered by NpcActorSheetPF and uses different templates
 * for displaying combat stats and executing attacks.
 *
 * Key differences from character sheet:
 *   - NPC actors have type 'npc' (not 'character').
 *   - The sheet opens to a different default tab.
 *   - Attack rolls from NPC sheet use the same Item35E.use() flow.
 *
 * Covers:
 *   1. NPC actor can be created with attack items.
 *   2. Calling item.use() on an NPC's attack item posts a chat message.
 *   3. Chat template data is present and includes the NPC actor name.
 *   4. Multiple attack items can be rolled independently.
 *   5. NPC without class progression: sheet skillRanks allowed/used stay numeric (GL#1478).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { waitForChatRoll } = require('./helpers/rolls');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper ─────────────────────────────────────────────────────────────────────

async function createNpcWithAttack(page, { attackName = 'Bite', actionType = 'mwak' } = {}) {
  return page.evaluate(async ({ attackName, actionType }) => {
    const actor = await Actor.create({
      name: 'Test Goblin',
      type: 'npc',
      system: {
        abilities: { str: { value: 12 }, dex: { value: 14 } },
        attributes: { hp: { value: 15, max: 15 }, cr: 1 },
      },
    });

    const [atk] = await actor.createEmbeddedDocuments('Item', [{
      name: attackName,
      type: 'attack',
      system: {
        actionType,
        ability: { attack: actionType === 'mwak' ? 'str' : 'dex', vsTouchAc: false },
        attackParts: [],
        damage: { parts: [['1d4', 'P']] },
      },
    }]);

    return { actorId: actor.id, atkId: atk.id };
  }, { attackName, actionType });
}

// ── 1. NPC can be created and has correct type ────────────────────────────────

test('NPC actor has type npc and is accessible in game.actors', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Orc Warrior',
      type: 'npc',
      system: { attributes: { hp: { value: 20, max: 20 }, cr: 1 } },
    });
    const a = game.actors.get(actor.id);
    return { type: a.type, name: a.name };
  });

  expect(result.type).toBe('npc');
  expect(result.name).toBe('Orc Warrior');
});

// ── 2. NPC attack roll posts chat message ─────────────────────────────────────

test('NPC attack item.use() posts a chat message', async ({ page }) => {
  const { actorId, atkId } = await createNpcWithAttack(page);

  const msgsBefore = await page.evaluate(() => game.messages.size);

  await page.evaluate(async ({ actorId, atkId }) => {
    const actor  = game.actors.get(actorId);
    const attack = actor.items.get(atkId);
    const result = await attack.use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, atkId });

  await page.waitForFunction((c) => game.messages.size > c, msgsBefore, { timeout: 8_000 });

  const msgCount = await page.evaluate(() => game.messages.size);
  expect(msgCount).toBeGreaterThan(msgsBefore);
});

// ── 3. Chat template data present with actor info ────────────────────────────

test('NPC attack chat message has system chatTemplateData', async ({ page }) => {
  const { actorId, atkId } = await createNpcWithAttack(page, { attackName: 'Claws' });

  const msgsBefore = await page.evaluate(() => game.messages.size);

  await page.evaluate(async ({ actorId, atkId }) => {
    const actor  = game.actors.get(actorId);
    const attack = actor.items.get(atkId);
    const result = await attack.use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, atkId });

  const chatData = await waitForChatRoll(page, msgsBefore);

  expect(chatData).not.toBeNull();
  // Should have item name or actor name in chat template data
  const itemName = chatData.item?.name ?? chatData.name ?? '';
  expect(itemName).toContain('Claws');
});

// ── 4. Multiple NPC attacks roll independently ───────────────────────────────

test('NPC with two attack items can roll both independently', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Troll',
      type: 'npc',
      system: { abilities: { str: { value: 18 } }, attributes: { hp: { value: 63, max: 63 }, cr: 5 } },
    });

    const [claw1, claw2] = await actor.createEmbeddedDocuments('Item', [
      {
        name: 'Claw',
        type: 'attack',
        system: { actionType: 'mwak', ability: { attack: 'str' }, attackParts: [], damage: { parts: [['1d6+5', 'S']] } },
      },
      {
        name: 'Bite',
        type: 'attack',
        system: { actionType: 'mwak', ability: { attack: 'str' }, attackParts: [], damage: { parts: [['1d6+3', 'P']] } },
      },
    ]);

    const msgsBefore = game.messages.size;

    const r1 = await game.actors.get(actor.id).items.get(claw1.id).use({ skipDialog: true });
    if (r1?.roll) await r1.roll;
    const r2 = await game.actors.get(actor.id).items.get(claw2.id).use({ skipDialog: true });
    if (r2?.roll) await r2.roll;

    return { msgsAfter: game.messages.size, msgsBefore };
  });

  expect(result.msgsAfter).toBeGreaterThan(result.msgsBefore + 1);
});

// ── 5. Skill rank summary without class progression (GL#1478) ─────────────────

test('GL#1478 NPC without class progression has numeric skillRanks (not NaN)', async ({
  page,
}) => {
  const ranks = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'E2E NaN Skill Ranks',
      type: 'npc',
      system: {
        details: { levelUpProgression: false, level: { value: 1 } },
        abilities: { int: { value: 10 } },
      },
    });
    const a = game.actors.get(actor.id);
    await a.update({
      'system.skills.clm.points': 2,
      'system.skills.clm.enabled': true,
    });
    const data = await a.sheet.getData();
    return {
      allowed: data.skillRanks?.allowed,
      used: data.skillRanks?.used,
    };
  });

  expect(Number.isNaN(Number(ranks.allowed))).toBe(false);
  expect(Number.isNaN(Number(ranks.used))).toBe(false);
  expect(String(ranks.allowed)).not.toMatch(/^nan$/i);
  expect(String(ranks.used)).not.toMatch(/^nan$/i);
});
