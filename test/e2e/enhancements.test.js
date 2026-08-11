/**
 * E2E tests — magic weapon enhancements: compendium rows on weapons, pricing,
 * standalone enhancement items (formulas / clear), and world Item creation.
 *
 * Uses the in-browser Foundry API (page.evaluate) like weapon.test.js; no sheet UI.
 */

'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissSystemDialogs, dismissOverlays } = require('./helpers');

const WEAPONS_PACK = 'warcraftrpg2e.weapons-and-ammo';
const ENH_PACK = 'warcraftrpg2e.enhancements';
const LONGSWORD_ID = 'zWRlna42PMJVX6un';
const PLUS1_WEAPON_ENH_ID = 'Ng5AlRupmkMOgqQi';
const FLAMING_ENH_ID = '8ymQFRb8BnIsKViV';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test('+1 weapon enhancement from compendium updates magic weapon price (SRD formula)', async ({ page }) => {
  const r = await page.evaluate(
    async ({ WEAPONS_PACK, LONGSWORD_ID, ENH_PACK, PLUS1_WEAPON_ENH_ID }) => {
      const actor = await Actor.create({ name: 'Plus One Price', type: 'character' });
      const wPack = game.packs.get(WEAPONS_PACK);
      const ePack = game.packs.get(ENH_PACK);
      const [weapon] = await actor.createEmbeddedDocuments('Item', [
        (await wPack.getDocument(LONGSWORD_ID)).toObject(),
      ]);
      const plus1 = await ePack.getDocument(PLUS1_WEAPON_ENH_ID);
      if (!plus1) return { ok: false, error: '+1 enhancement doc missing' };

      await weapon.enhancements.addEnhancementFromData(plus1.toObject());
      await weapon.enhancements.updateBaseItemName();

      const w = game.actors.get(actor.id).items.get(weapon.id);
      // Longsword base 15 gp; +1 equivalent: +300 + (1^2)*2000 = 2300 → 2315
      return {
        ok: true,
        price: w.system.price,
        weaponEnhTotal: w.system.enh,
      };
    },
    { WEAPONS_PACK, LONGSWORD_ID, ENH_PACK, PLUS1_WEAPON_ENH_ID },
  );

  expect(r.ok, r.error ?? '').toBe(true);
  expect(r.price).toBe(2315);
  expect(r.weaponEnhTotal).toBe(1);
});

test('flat gp enhancement row increases weapon price without +1 equiv square cost', async ({ page }) => {
  const r = await page.evaluate(
    async ({ WEAPONS_PACK, LONGSWORD_ID, ENH_PACK, FLAMING_ENH_ID }) => {
      const actor = await Actor.create({ name: 'Flat Price', type: 'character' });
      const wPack = game.packs.get(WEAPONS_PACK);
      const ePack = game.packs.get(ENH_PACK);
      const [weapon] = await actor.createEmbeddedDocuments('Item', [
        (await wPack.getDocument(LONGSWORD_ID)).toObject(),
      ]);
      const flaming = await ePack.getDocument(FLAMING_ENH_ID);
      if (!flaming) return { ok: false, error: 'Flaming enhancement doc missing' };

      const row = flaming.toObject();
      row.name = 'E2E Flat Surcharge';
      row.system = foundry.utils.mergeObject(row.system, {
        enhIncrease: 0,
        enhIncreaseFormula: '',
        price: 444,
        priceFormula: '',
        nameExtension: { prefix: '', suffix: '' },
      });

      await weapon.enhancements.addEnhancementFromData(row);
      await weapon.enhancements.updateBaseItemName();

      const w = game.actors.get(actor.id).items.get(weapon.id);
      return { ok: true, price: w.system.price };
    },
    { WEAPONS_PACK, LONGSWORD_ID, ENH_PACK, FLAMING_ENH_ID },
  );

  expect(r.ok, r.error ?? '').toBe(true);
  // Base 15 + flat 444; no +300 / no square term because enhIncrease sum is 0
  expect(r.price).toBe(459);
});

test('can create a standalone enhancement Item in the world', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const item = await Item.create({
      name: 'E2E World Enhancement',
      type: 'enhancement',
      img: 'icons/svg/item-bag.svg',
      system: {
        enhancementType: 'weapon',
        enh: 0,
        enhIsLevel: true,
        enhIncrease: 0,
        enhIncreaseFormula: '',
        price: 0,
        priceFormula: '',
        enhancementRequirements: '',
        nameExtension: { prefix: '', suffix: '' },
        description: { value: '', chat: '', unidentified: '' },
      },
    });
    const again = game.items.get(item.id);
    return { id: item.id, type: again.type, name: again.name };
  });

  expect(r.type).toBe('enhancement');
  expect(r.name).toBe('E2E World Enhancement');
});

test('standalone enhancement: priceFormula drives system.price', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const item = await Item.create({
      name: 'E2E Formula Enh',
      type: 'enhancement',
      img: 'icons/svg/item-bag.svg',
      system: {
        enhancementType: 'weapon',
        enh: 3,
        enhIsLevel: true,
        enhIncrease: 0,
        enhIncreaseFormula: '',
        price: 0,
        priceFormula: '100*@enhancement',
        enhancementRequirements: '',
        nameExtension: { prefix: '', suffix: '' },
        description: { value: '', chat: '', unidentified: '' },
      },
    });
    await item.update({ 'system.enh': 3, 'system.priceFormula': '100*@enhancement' });
    const fresh = game.items.get(item.id);
    return { price: fresh.system.price, enh: fresh.system.enh };
  });

  expect(r.enh).toBe(3);
  expect(r.price).toBe(300);
});

test('standalone enhancement: clearing priceFormula clears rolled system.price', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const item = await Item.create({
      name: 'E2E Clear Formula',
      type: 'enhancement',
      img: 'icons/svg/item-bag.svg',
      system: {
        enhancementType: 'weapon',
        enh: 2,
        enhIsLevel: true,
        enhIncrease: 0,
        enhIncreaseFormula: '',
        price: 0,
        priceFormula: '500*@enhancement',
        enhancementRequirements: '',
        nameExtension: { prefix: '', suffix: '' },
        description: { value: '', chat: '', unidentified: '' },
      },
    });
    await item.update({ 'system.priceFormula': '500*@enhancement', 'system.enh': 2 });
    let w = game.items.get(item.id);
    const afterRoll = w.system.price;
    await item.update({ 'system.priceFormula': '' });
    w = game.items.get(item.id);
    return { afterRoll, afterClear: w.system.price };
  });

  expect(r.afterRoll).toBe(1000);
  expect(r.afterClear).toBe(0);
});

test('removing last enhancement from weapon restores base price after updateBaseItemName', async ({ page }) => {
  const r = await page.evaluate(
    async ({ WEAPONS_PACK, LONGSWORD_ID, ENH_PACK, PLUS1_WEAPON_ENH_ID }) => {
      function createTagBrowser(str) {
        if (!str.length) str = 'tag';
        return str
          .replace(/[^a-zA-Z0-9\s]/g, '')
          .split(/\s+/)
          .map((s, a) => {
            s = s.toLowerCase();
            if (a > 0) s = s.substring(0, 1).toUpperCase() + s.substring(1);
            return s;
          })
          .join('');
      }

      const actor = await Actor.create({ name: 'Remove Enh', type: 'character' });
      const wPack = game.packs.get(WEAPONS_PACK);
      const ePack = game.packs.get(ENH_PACK);
      const [weapon] = await actor.createEmbeddedDocuments('Item', [
        (await wPack.getDocument(LONGSWORD_ID)).toObject(),
      ]);
      const plus1 = await ePack.getDocument(PLUS1_WEAPON_ENH_ID);
      await weapon.enhancements.addEnhancementFromData(plus1.toObject());
      await weapon.enhancements.updateBaseItemName();
      let w = game.actors.get(actor.id).items.get(weapon.id);
      const withEnh = w.system.price;

      await w.enhancements.deleteEnhancement(createTagBrowser(plus1.name));
      await w.enhancements.updateBaseItemName();
      w = game.actors.get(actor.id).items.get(weapon.id);

      return { withEnh, afterRemove: w.system.price };
    },
    { WEAPONS_PACK, LONGSWORD_ID, ENH_PACK, PLUS1_WEAPON_ENH_ID },
  );

  expect(r.withEnh).toBe(2315);
  expect(r.afterRemove).toBe(15);
});

test('two flat enhancements: description edits, staged removes, price returns to base; delete does not recalc price when only updateName is on', async ({
  page,
}) => {
  const r = await page.evaluate(
    async ({ WEAPONS_PACK, LONGSWORD_ID, ENH_PACK, FLAMING_ENH_ID }) => {
      function createTagBrowser(str) {
        if (!str.length) str = 'tag';
        return str
          .replace(/[^a-zA-Z0-9\s]/g, '')
          .split(/\s+/)
          .map((s, a) => {
            s = s.toLowerCase();
            if (a > 0) s = s.substring(0, 1).toUpperCase() + s.substring(1);
            return s;
          })
          .join('');
      }

      const actor = await Actor.create({ name: 'Two Flat Flow', type: 'character' });
      const wPack = game.packs.get(WEAPONS_PACK);
      const ePack = game.packs.get(ENH_PACK);
      const [weapon] = await actor.createEmbeddedDocuments('Item', [
        (await wPack.getDocument(LONGSWORD_ID)).toObject(),
      ]);
      const flaming = await ePack.getDocument(FLAMING_ENH_ID);
      if (!flaming) return { ok: false, error: 'Flaming enhancement doc missing' };

      const flatRow = (name, flatGp) => {
        const row = flaming.toObject();
        row.name = name;
        row.system = foundry.utils.mergeObject(row.system, {
          enhIncrease: 0,
          enhIncreaseFormula: '',
          price: flatGp,
          priceFormula: '',
          nameExtension: { prefix: '', suffix: '' },
        });
        return row;
      };

      await weapon.update({
        'system.enhancements.automation.updateName': true,
        'system.enhancements.automation.updatePrice': false,
      });

      await weapon.enhancements.addEnhancementFromData(flatRow('E2E Flat Alpha', 100));
      await weapon.enhancements.addEnhancementFromData(flatRow('E2E Flat Beta', 250));
      await weapon.enhancements.updateBaseItemName();

      let w = game.actors.get(actor.id).items.get(weapon.id);
      const pAfterBoth = w.system.price;

      await w.update({ 'system.description.value': '<p>Two flats</p>' });
      w = game.actors.get(actor.id).items.get(weapon.id);
      const pAfterDesc1 = w.system.price;

      await w.enhancements.deleteEnhancement(createTagBrowser('E2E Flat Alpha'));
      w = game.actors.get(actor.id).items.get(weapon.id);
      const pAfterDelAlphaNoBtn = w.system.price;

      await w.enhancements.updateBaseItemName();
      w = game.actors.get(actor.id).items.get(weapon.id);
      const pAfterDelAlphaBtn = w.system.price;

      await w.update({ 'system.description.value': '<p>One flat</p>' });
      w = game.actors.get(actor.id).items.get(weapon.id);
      const pAfterDesc2 = w.system.price;

      await w.enhancements.deleteEnhancement(createTagBrowser('E2E Flat Beta'));
      w = game.actors.get(actor.id).items.get(weapon.id);
      const pAfterDelBetaNoBtn = w.system.price;

      await w.enhancements.updateBaseItemName();
      w = game.actors.get(actor.id).items.get(weapon.id);
      const pAfterDelBetaBtn = w.system.price;

      await w.update({ 'system.description.value': '<p>Base longsword</p>' });
      w = game.actors.get(actor.id).items.get(weapon.id);

      return {
        ok: true,
        pAfterBoth,
        pAfterDesc1,
        pAfterDelAlphaNoBtn,
        pAfterDelAlphaBtn,
        pAfterDesc2,
        pAfterDelBetaNoBtn,
        pAfterDelBetaBtn,
        pAfterFinalBtn: w.system.price,
        descSnippet: (w.system.description?.value || '').slice(0, 40),
      };
    },
    { WEAPONS_PACK, LONGSWORD_ID, ENH_PACK, FLAMING_ENH_ID },
  );

  expect(r.ok, r.error ?? '').toBe(true);
  expect(r.pAfterBoth).toBe(365);
  expect(r.pAfterDesc1).toBe(365);
  expect(r.pAfterDelAlphaNoBtn).toBe(365);
  expect(r.pAfterDelAlphaBtn).toBe(265);
  expect(r.pAfterDesc2).toBe(265);
  expect(r.pAfterDelBetaNoBtn).toBe(265);
  expect(r.pAfterDelBetaBtn).toBe(15);
  expect(r.pAfterFinalBtn).toBe(15);
  expect(r.descSnippet).toContain('Base longsword');
});
