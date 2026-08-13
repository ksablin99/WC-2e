'use strict';

/**
 * Issue #1566: combat changes targeting item fields (e.g. &item.baseCl) must affect
 * spell-like consumable rolls — CL from adjustSpellCL should use rollData.item after
 * _addCombatChangesToRollData so attackCountFormula scales (e.g. scorching-ray-style rays).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld } = require('./helpers');

const ITEMS_PACK = 'warcraftrpg2e.items';
const FEATS_PACK = 'warcraftrpg2e.feats';
const FEAT_TEMPLATE_ID = 'yhG9H9S51ysYIlvC';
const THUNDERSTONE_ID = 'Rwwll19LISUgCJIA';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
});

test('consumable rsak: &item.baseCl combat change bumps CL-driven attack count (#1566)', async ({
  page,
}) => {
  const result = await page.evaluate(
    async ({ ITEMS_PACK, FEATS_PACK, FEAT_TEMPLATE_ID, THUNDERSTONE_ID }) => {
      const actor = await Actor.create({
        name: 'Wand CL Test',
        type: 'character',
        system: { abilities: { dex: { value: 14 } } },
      });

      const itemPack = game.packs.get(ITEMS_PACK);
      const baseItem = await itemPack.getDocument(THUNDERSTONE_ID);
      const wandObj = baseItem.toObject();
      delete wandObj._id;
      wandObj.name = 'E2E CL Wand';
      wandObj.system = foundry.utils.duplicate(wandObj.system);
      wandObj.system.actionType = 'rsak';
      wandObj.system.baseCl = '9';
      // At CL 9 → 1 attack total; at CL 11 (9 + feat +2) → 3 attacks — no floor() dependency in Roll35e
      wandObj.system.attackCountFormula = '@cl - 8';
      wandObj.system.attackParts = [];
      wandObj.system.ability = foundry.utils.mergeObject(wandObj.system.ability || {}, {
        attack: 'dex',
        vsTouchAc: true,
      });

      const [wand] = await actor.createEmbeddedDocuments('Item', [wandObj]);

      const featPack = game.packs.get(FEATS_PACK);
      const featDoc = await featPack.getDocument(FEAT_TEMPLATE_ID);
      const featObj = featDoc.toObject();
      delete featObj._id;
      featObj.name = 'E2E +2 item CL';
      featObj.system = foundry.utils.duplicate(featObj.system);
      featObj.system.combatChanges = [['consumable', '', '', '&item.baseCl', '2', '']];
      featObj.system.changes = [];
      await actor.createEmbeddedDocuments('Item', [featObj]);

      const a = game.actors.get(actor.id);
      const item = a.items.get(wand.id);
      const before = game.messages.size;
      const useResult = await item.use({ skipDialog: true });
      if (useResult?.roll) await useResult.roll;
      for (let i = 0; i < 30; i++) {
        if (game.messages.size > before) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      const msg = game.messages.contents.at(-1);
      const attacks = msg?.flags?.warcraftrpg2e?.chatTemplateData?.attacks ?? [];
      return {
        wasRolled: useResult?.wasRolled ?? false,
        newMessages: game.messages.size - before,
        attackCount: attacks.length,
      };
    },
    { ITEMS_PACK, FEATS_PACK, FEAT_TEMPLATE_ID, THUNDERSTONE_ID },
  );

  expect(result.wasRolled).toBe(true);
  expect(result.newMessages).toBeGreaterThan(0);
  // baseCl 9 + 2 → effective CL 11 → @cl-8 = 3 → 3 ChatAttack entries (would be 1 at CL 9 without the change)
  expect(result.attackCount).toBe(3);
});
