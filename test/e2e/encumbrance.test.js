'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

async function sampleEncumbranceMatrix(page, baseSpeed) {
  return await page.evaluate(async (base) => {
    const actor = await Actor.create({ name: `Encumbrance Speed Base ${base}`, type: 'character' });

    const a = game.actors.get(actor.id);
    await a.update({
      'system.abilities.str.value': 10,
      'system.attributes.speed.land.base': base,
    });

    const levels = game.actors.get(actor.id).system.attributes.encumbrance.levels;
    const checkpoints = {
      light: Math.max(0, Number(levels.light) - 0.1),
      medium: Number(levels.light) + 0.1,
      heavy: Number(levels.medium) + 0.1,
      overloaded: Number(levels.heavy) + 0.1,
    };

    async function setCarriedWeight(targetWeight, label) {
      const current = game.actors.get(actor.id).system.attributes.encumbrance.carriedWeight ?? 0;
      const delta = Math.max(0, Number((targetWeight - current).toFixed(2)));
      if (delta > 0) {
        const [item] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [
          { name: `Weight ${label}`, type: 'loot' },
        ]);
        await game.actors.get(actor.id).items.get(item.id).update({
          'system.carried': true,
          'system.quantity': 1,
          'system.weight': delta,
        });
      }
      const fresh = game.actors.get(actor.id);
      return {
        carriedWeight: fresh.system.attributes.encumbrance.carriedWeight,
        level: fresh.system.attributes.encumbrance.level,
        speed: fresh.system.attributes.speed.land.total,
        run: fresh.system.attributes.speed.land.run,
        maxDexEnc: fresh.system.attributes.maxDex.encumbrance,
        maxDexTotal: fresh.system.attributes.maxDex.total,
        acpEnc: fresh.system.attributes.acp.encumbrance,
        acpTotal: fresh.system.attributes.acp.total,
      };
    }

    return {
      levels,
      light: await setCarriedWeight(checkpoints.light, 'light'),
      medium: await setCarriedWeight(checkpoints.medium, 'medium'),
      heavy: await setCarriedWeight(checkpoints.heavy, 'heavy'),
      overloaded: await setCarriedWeight(checkpoints.overloaded, 'overloaded'),
    };
  }, baseSpeed);
}

test('SRD encumbrance speed matrix for base 30 ft (light/medium/heavy/overloaded)', async ({ page }) => {
  const result = await sampleEncumbranceMatrix(page, 30);

  expect(result.light.level).toBe(0);
  expect(result.light.speed).toBe(30);
  expect(result.light.run).toBe(120);
  expect(result.light.maxDexEnc).toBe(null);
  expect(result.light.acpEnc).toBe(0);

  expect(result.medium.level).toBe(1);
  expect(result.medium.speed).toBe(20);
  expect(result.medium.run).toBe(80);
  expect(result.medium.maxDexEnc).toBe(3);
  expect(result.medium.maxDexTotal).toBe(3);
  expect(result.medium.acpEnc).toBe(3);
  expect(result.medium.acpTotal).toBe(3);

  expect(result.heavy.level).toBe(2);
  expect(result.heavy.speed).toBe(20);
  expect(result.heavy.run).toBe(60);
  expect(result.heavy.maxDexEnc).toBe(1);
  expect(result.heavy.maxDexTotal).toBe(1);
  expect(result.heavy.acpEnc).toBe(6);
  expect(result.heavy.acpTotal).toBe(6);

  // SRD overloaded (above heavy load): move 5 ft. as a full-round action.
  expect(result.overloaded.speed).toBe(5);
  expect(result.overloaded.run).toBe(0);
});

test('SRD encumbrance speed matrix for base 20 ft (light/medium/heavy)', async ({ page }) => {
  const result = await sampleEncumbranceMatrix(page, 20);

  expect(result.light.level).toBe(0);
  expect(result.light.speed).toBe(20);
  expect(result.light.run).toBe(80);
  expect(result.light.maxDexEnc).toBe(null);
  expect(result.light.acpEnc).toBe(0);

  expect(result.medium.level).toBe(1);
  expect(result.medium.speed).toBe(15);
  expect(result.medium.run).toBe(60);
  expect(result.medium.maxDexEnc).toBe(3);
  expect(result.medium.maxDexTotal).toBe(3);
  expect(result.medium.acpEnc).toBe(3);
  expect(result.medium.acpTotal).toBe(3);

  expect(result.heavy.level).toBe(2);
  expect(result.heavy.speed).toBe(15);
  expect(result.heavy.run).toBe(45);
  expect(result.heavy.maxDexEnc).toBe(1);
  expect(result.heavy.maxDexTotal).toBe(1);
  expect(result.heavy.acpEnc).toBe(6);
  expect(result.heavy.acpTotal).toBe(6);
});
