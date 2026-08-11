'use strict';

const { expect } = require('@playwright/test');
const { openSheet } = require('./actor-sheet');
const { setStylizedOptionalChecked } = require('./skill-roll');

const WEAPONS_PACK = 'warcraftrpg2e.weapons-and-ammo';
const LONGSWORD_ID = 'zWRlna42PMJVX6un';
const FIGHTER_ID = 'sgwZt7dg1ZHXQlrW';
const CLASS_PACK = 'warcraftrpg2e.classes';

const BONUS_THRESHOLD = 100;
const NO_BONUS_THRESHOLD = 50;

async function createFighterWithLongsword(page, { level = 6 } = {}) {
  return page.evaluate(
    async ({ WEAPONS_PACK, LONGSWORD_ID, CLASS_PACK, FIGHTER_ID, level }) => {
      const actor = await Actor.create({
        name: 'Full Attack Combat Changes Fighter',
        type: 'character',
      });
      await actor.update({
        'system.abilities.str.value': 16,
        'system.abilities.dex.value': 12,
      });

      const classPack = game.packs.get(CLASS_PACK);
      const classItem = await classPack.getDocument(FIGHTER_ID);
      const classData = classItem.toObject();
      classData.system.levels = level;
      await actor.createEmbeddedDocuments('Item', [classData]);

      const weaponPack = game.packs.get(WEAPONS_PACK);
      const longsword = await weaponPack.getDocument(LONGSWORD_ID);
      const [weapon] = await actor.createEmbeddedDocuments('Item', [longsword.toObject()]);
      await actor.items.get(weapon.id).update({ 'system.equipped': true });

      let a = game.actors.get(actor.id);
      let attack = null;
      for (let i = 0; i < 30; i++) {
        a = game.actors.get(actor.id);
        attack = a.items.find(
          (item) => item.type === 'attack' && item.system.originalWeaponId === weapon.id,
        );
        if (attack) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!attack) throw new Error('Attack item was not auto-created');

      return { actorId: a.id, attackId: attack.id };
    },
    { WEAPONS_PACK, LONGSWORD_ID, CLASS_PACK, FIGHTER_ID, level },
  );
}

async function openAttackDialog(page, sheetId, attackId) {
  const sheet = page.locator(`#${sheetId}`);
  const attackRow = sheet.locator(`li.item[data-item-id="${attackId}"]`);
  const attackBtn = attackRow.locator('a.item-control.item-attack').first();
  await attackBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await attackBtn.click({ force: true });

  const dialog = page.locator('.dialog.roll-defense').last();
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });
  return dialog;
}

async function getLastChatAttackSummary(page) {
  return page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    const attacks = msg?.flags?.D35E?.chatTemplateData?.attacks ?? [];
    return {
      attackCount: attacks.length,
      attackTotals: attacks.map((attack) => attack.attack?.total ?? null),
      attackDamageTotals: attacks.map((attack) => attack.damage?.total ?? null),
      specialLabels: attacks.flatMap((attack) => (attack.special ?? []).map((special) => special.label)),
    };
  });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {string} opts.actorId
 * @param {string} opts.name
 * @param {string} opts.field
 * @param {string} [opts.formula]
 * @param {string} [opts.specialAction]
 * @param {boolean} [opts.applyOnce]
 * @param {string} [opts.itemType]
 * @param {string} [opts.actionType]
 */
async function embedFullAttackFeat(
  page,
  {
    actorId,
    name,
    field,
    formula = '100',
    specialAction = '',
    applyOnce = false,
    itemType = 'allOptional',
    actionType = '',
  },
) {
  await page.evaluate(
    async ({ actorId, name, field, formula, specialAction, applyOnce, itemType, actionType }) => {
      const actor = game.actors.get(actorId);
      const system = {
        combatChanges: [[itemType, actionType, '', field, formula, specialAction]],
        combatChangesRange: { value: 0, maxFormula: '' },
        combatChangesApplySpecialActionsOnce: applyOnce,
      };
      await actor.createEmbeddedDocuments('Item', [{ name, type: 'feat', system }]);
    },
    { actorId, name, field, formula, specialAction, applyOnce, itemType, actionType },
  );
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {string} opts.actorId
 * @param {string} opts.attackId
 * @param {boolean} [opts.checkOptional]
 */
async function rollFullAttackWithOptionalFeat(page, { actorId, attackId, checkOptional = true }) {
  const sheetId = await openSheet(page, actorId);
  const dialog = await openAttackDialog(page, sheetId, attackId);

  if (checkOptional) {
    expect(await dialog.locator('input[data-type="optional"]').count()).toBeGreaterThan(0);
    await setStylizedOptionalChecked(page, true);
  }

  const msgsBefore = await page.evaluate(() => game.messages.size);
  await dialog.locator('button[data-button="multi"]').click({ force: true });
  await page.waitForFunction((before) => game.messages.size > before, msgsBefore, { timeout: 5_000 });

  return getLastChatAttackSummary(page);
}

module.exports = {
  WEAPONS_PACK,
  LONGSWORD_ID,
  FIGHTER_ID,
  CLASS_PACK,
  BONUS_THRESHOLD,
  NO_BONUS_THRESHOLD,
  createFighterWithLongsword,
  openAttackDialog,
  getLastChatAttackSummary,
  embedFullAttackFeat,
  rollFullAttackWithOptionalFeat,
};
