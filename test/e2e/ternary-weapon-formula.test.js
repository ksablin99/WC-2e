'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { waitForChatRoll } = require('./helpers/rolls');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

async function createWeaponAttackFromTernaryFormula(page, { str = 16 } = {}) {
  return page.evaluate(async ({ str }) => {
    const actor = await Actor.create({
      name: `Ternary Weapon Actor ${str}`,
      type: 'character',
      system: { abilities: { str: { value: str } } },
    });

    const [weapon] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Ternary Test Weapon',
      type: 'weapon',
      system: {
        masterwork: false,
        identified: true,
        enh: 0,
        weaponSubtype: 'light',
        properties: {
          thr: false,
          fin: false,
          nnl: false,
          kee: false,
          inc: false,
          spd: false,
          dis: false,
          ret: false,
        },
        weaponData: {
          damageRoll: '1d6',
          damageType: 'slashing',
          damageTypeId: 'slashing',
          critRange: 20,
          critMult: 2,
          attackFormula: '(@abilities.str.mod > 2 ? 100 : 0)',
          damageFormula: '',
          alignment: {},
        },
        description: { value: '', unidentified: '' },
        unidentified: { name: 'Unknown Weapon' },
        enhancements: { items: [] },
      },
    }]);

    await actor.createAttackFromWeapon(weapon);
    const attack = actor.items.find((item) => item.type === 'attack' && item.system.originalWeaponId === weapon.id);
    return { actorId: actor.id, attackId: attack?.id ?? null };
  }, { str });
}

async function rollAttackTotal(page, actorId, attackId) {
  const msgsBefore = await page.evaluate(() => game.messages.size);
  await page.evaluate(async ({ actorId, attackId }) => {
    const actor = game.actors.get(actorId);
    const attack = actor.items.get(attackId);
    const result = await attack.use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, attackId });

  const chatData = await waitForChatRoll(page, msgsBefore);
  const attacks = chatData?.attacks ?? [];
  return attacks[0]?.attack?.total ?? attacks[0]?.total ?? null;
}

test('weapon attack formula ternary applies the true branch in live attack rolls', async ({ page }) => {
  const { actorId, attackId } = await createWeaponAttackFromTernaryFormula(page, { str: 16 });
  expect(attackId).not.toBeNull();

  const total = await rollAttackTotal(page, actorId, attackId);
  expect(total).not.toBeNull();
  expect(total).toBeGreaterThan(100);
});

test('weapon attack formula ternary applies the false branch in live attack rolls', async ({ page }) => {
  const { actorId, attackId } = await createWeaponAttackFromTernaryFormula(page, { str: 10 });
  expect(attackId).not.toBeNull();

  const total = await rollAttackTotal(page, actorId, attackId);
  expect(total).not.toBeNull();
  expect(total).toBeLessThanOrEqual(25);
});
