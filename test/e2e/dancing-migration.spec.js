'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const OLD_DANCING_SYSTEM = {
  actionType: "",
  enhancementType: "weapon",
  properties: {},
  // summonWeapon intentionally absent
};

const OLD_EVERDANCING_SYSTEM = {
  actionType: "",
  enhancementType: "weapon",
  properties: { def: false, dis: false, kee: false, mnk: false, spd: false, thr: false },
  // summonWeapon intentionally absent
};

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test('dancing migration updates standalone Dancing enhancement item', async ({ page }) => {
  const result = await page.evaluate(async ({ oldSystem }) => {
    const item = await Item.create({
      name: 'Dancing',
      type: 'enhancement',
      system: oldSystem,
    });

    await game.D35E.migrations.migrateDancingEnhancements();

    const updated = game.items.get(item.id);
    return {
      actionType: updated.system.actionType,
      dnc: updated.system.properties?.dnc,
      hasSummonWeapon: !!updated.system.summonWeapon,
      behavior: updated.system.summonWeapon?.behavior,
      dancingRounds: updated.system.summonWeapon?.dancingRounds,
      cooldownRounds: updated.system.summonWeapon?.cooldownRounds,
    };
  }, { oldSystem: OLD_DANCING_SYSTEM });

  expect(result.actionType).toBe('summonWeapon');
  expect(result.dnc).toBe(true);
  expect(result.hasSummonWeapon).toBe(true);
  expect(result.behavior).toBe('dancing');
  expect(result.dancingRounds).toBe(4);
  expect(result.cooldownRounds).toBe(4);
});

test('dancing migration updates standalone Everdancing enhancement item', async ({ page }) => {
  const result = await page.evaluate(async ({ oldSystem }) => {
    const item = await Item.create({
      name: 'Everdancing',
      type: 'enhancement',
      system: oldSystem,
    });

    await game.D35E.migrations.migrateDancingEnhancements();

    const updated = game.items.get(item.id);
    return {
      actionType: updated.system.actionType,
      dnc: updated.system.properties?.dnc,
      hasSummonWeapon: !!updated.system.summonWeapon,
      behavior: updated.system.summonWeapon?.behavior,
      dancingRounds: updated.system.summonWeapon?.dancingRounds,
      cooldownRounds: updated.system.summonWeapon?.cooldownRounds,
    };
  }, { oldSystem: OLD_EVERDANCING_SYSTEM });

  expect(result.actionType).toBe('summonWeapon');
  expect(result.dnc).toBe(true);
  expect(result.hasSummonWeapon).toBe(true);
  expect(result.behavior).toBe('dancing');
  expect(result.dancingRounds).toBe(0);
  expect(result.cooldownRounds).toBe(0);
});

test('dancing migration updates Dancing enhancement embedded in weapon on actor', async ({ page }) => {
  const result = await page.evaluate(async ({ oldSystem }) => {
    const actor = await Actor.create({ name: 'Migration Test Fighter', type: 'character' });
    const [weapon] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Test Longsword',
      type: 'weapon',
      system: {
        enhancements: {
          items: [{
            _id: 'dnctest0000000001',
            name: 'Dancing',
            type: 'enhancement',
            system: oldSystem,
          }],
          uses: { value: 0, max: 0, per: null, autoDeductCharges: true, allowMultipleUses: false },
          clFormula: '',
        },
      },
    }]);

    await game.D35E.migrations.migrateDancingEnhancements();

    const updatedWeapon = game.actors.get(actor.id).items.get(weapon.id);
    const enh = updatedWeapon.system.enhancements.items[0];
    return {
      actionType: enh?.system?.actionType,
      dnc: enh?.system?.properties?.dnc,
      hasSummonWeapon: !!enh?.system?.summonWeapon,
      behavior: enh?.system?.summonWeapon?.behavior,
      dancingRounds: enh?.system?.summonWeapon?.dancingRounds,
      cooldownRounds: enh?.system?.summonWeapon?.cooldownRounds,
    };
  }, { oldSystem: OLD_DANCING_SYSTEM });

  expect(result.actionType).toBe('summonWeapon');
  expect(result.dnc).toBe(true);
  expect(result.hasSummonWeapon).toBe(true);
  expect(result.behavior).toBe('dancing');
  expect(result.dancingRounds).toBe(4);
  expect(result.cooldownRounds).toBe(4);
});

test('dancing migration is idempotent — re-run does not alter already-migrated items', async ({ page }) => {
  const result = await page.evaluate(async ({ oldSystem }) => {
    const item = await Item.create({
      name: 'Dancing',
      type: 'enhancement',
      system: oldSystem,
    });

    await game.D35E.migrations.migrateDancingEnhancements();
    const afterFirst = game.items.get(item.id).toObject();

    await game.D35E.migrations.migrateDancingEnhancements();
    const afterSecond = game.items.get(item.id).toObject();

    return {
      firstDnc: afterFirst.system.properties?.dnc,
      secondDnc: afterSecond.system.properties?.dnc,
      firstActionType: afterFirst.system.actionType,
      secondActionType: afterSecond.system.actionType,
      firstRounds: afterFirst.system.summonWeapon?.dancingRounds,
      secondRounds: afterSecond.system.summonWeapon?.dancingRounds,
    };
  }, { oldSystem: OLD_DANCING_SYSTEM });

  expect(result.firstDnc).toBe(true);
  expect(result.secondDnc).toBe(true);
  expect(result.firstActionType).toBe('summonWeapon');
  expect(result.secondActionType).toBe('summonWeapon');
  expect(result.firstRounds).toBe(4);
  expect(result.secondRounds).toBe(4);
});
