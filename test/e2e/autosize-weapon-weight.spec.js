'use strict';

/**
 * GL#1579 — compendium item weight / weapon sizing vs actor size.
 * SRD: weapon weight ×2 per size step from Medium; longsword damage Medium 1d8 → Large 2d6, Small 1d6
 * (`.srd/weapons.html` + DMG progression via `sizeDie`). World setting `autosizeWeapons` disables weapon
 * scaling only; `constantWeight` skips per item.
 * Compendium and world (`dataType: 'world'`) imports resize; actor-to-actor uses `dataType: 'data'` and does not.
 *
 * @see `.srd/` — weapon size / damage scaling (DMG)
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

/** warcraftrpg2e.summon — `traits.actualSize` is authoritative on these NPCs */
const SUMMON_LARGE_ELEMENTAL = '8MssFSQlujfSz11v';
const SUMMON_SMALL_ELEMENTAL = 'KRQ1aXdRxZeMoc4F';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {string} opts.summonActorId — compendium actor id in warcraftrpg2e.summon
 * @param {boolean} opts.autosizeWeapons
 * @param {'longsword'|'leather'} opts.item
 * @param {boolean} [opts.constantWeight]
 * @param {'compendium'|'world'|'data'} [opts.dataType]
 */
async function dropPackItemOntoSummonActor(page, opts) {
  return page.evaluate(
    async ({ summonActorId, autosizeWeapons, item, constantWeight, dataType }) => {
      const prevAutosize = game.settings.get('warcraftrpg2e', 'autosizeWeapons');
      await game.settings.set('warcraftrpg2e', 'autosizeWeapons', autosizeWeapons);
      const summonPack = game.packs.get('warcraftrpg2e.summon');
      let actor = null;
      try {
        actor = await game.actors.importFromCompendium(summonPack, summonActorId);
        const itemPack =
          item === 'leather' ? 'warcraftrpg2e.armors-and-shields' : 'warcraftrpg2e.weapons-and-ammo';
        const docId = item === 'leather' ? '6YCQkebsf4vR508H' : 'zWRlna42PMJVX6un';
        const pack = game.packs.get(itemPack);
        const src = await pack.getDocument(docId);
        const itemData = src.toObject(false);
        delete itemData._id;
        if (constantWeight) itemData.system.constantWeight = true;
        const dt = dataType ?? 'compendium';
        await actor.createEmbeddedDocuments('Item', [itemData], { dataType: dt });
        const created = actor.items.find((i) =>
          item === 'leather' ? i.type === 'equipment' : i.type === 'weapon',
        );
        return {
          weight: created.system.weight,
          name: created.name,
          damageRoll: created.system.weaponData?.damageRoll ?? null,
          weaponSize: created.system.weaponData?.size ?? null,
          baseWeight: src.system.weight,
          actorActualSize: actor.system.traits.actualSize,
        };
      } finally {
        await game.settings.set('warcraftrpg2e', 'autosizeWeapons', prevAutosize);
        if (actor) await actor.delete();
      }
    },
    opts,
  );
}

test('GL#1579 Large + autosize on: longsword weight doubles (SRD ×2 per step from Medium)', async ({
  page,
}) => {
  const r = await dropPackItemOntoSummonActor(page, {
    summonActorId: SUMMON_LARGE_ELEMENTAL,
    autosizeWeapons: true,
    item: 'longsword',
  });
  expect(r.actorActualSize).toBe('lg');
  expect(r.baseWeight).toBe(4);
  expect(r.weight).toBe(8);
  // SRD: Medium longsword 1d8 → Large 2d6 (DMG weapon size / PHB Small column 1d6 for Small)
  expect(r.damageRoll).toBe('2d6');
  expect(r.weaponSize).toBe('lg');
});

test('GL#1579 Large + autosize off: longsword keeps Medium weight and damage', async ({ page }) => {
  const r = await dropPackItemOntoSummonActor(page, {
    summonActorId: SUMMON_LARGE_ELEMENTAL,
    autosizeWeapons: false,
    item: 'longsword',
  });
  expect(r.weight).toBe(4);
  expect(r.damageRoll).toBe('1d8');
  expect(r.name).toBe('Longsword');
});

test('GL#1579 Small + autosize on: longsword weight halves vs Medium', async ({ page }) => {
  const r = await dropPackItemOntoSummonActor(page, {
    summonActorId: SUMMON_SMALL_ELEMENTAL,
    autosizeWeapons: true,
    item: 'longsword',
  });
  expect(r.actorActualSize).toBe('sm');
  expect(r.baseWeight).toBe(4);
  expect(r.weight).toBe(2);
  expect(r.damageRoll).toBe('1d6');
  expect(r.weaponSize).toBe('sm');
});

test('GL#1579 Large + autosize off: leather armor still scales (setting is weapon-only)', async ({
  page,
}) => {
  const r = await dropPackItemOntoSummonActor(page, {
    summonActorId: SUMMON_LARGE_ELEMENTAL,
    autosizeWeapons: false,
    item: 'leather',
  });
  expect(r.baseWeight).toBe(15);
  expect(r.weight).toBe(30);
});

test('GL#1579 constantWeight on weapon skips resize even when autosize on', async ({ page }) => {
  const r = await dropPackItemOntoSummonActor(page, {
    summonActorId: SUMMON_LARGE_ELEMENTAL,
    autosizeWeapons: true,
    item: 'longsword',
    constantWeight: true,
  });
  expect(r.weight).toBe(4);
  expect(r.damageRoll).toBe('1d8');
  expect(r.name).toBe('Longsword');
});

test('GL#1579 dataType world: longsword resizes like compendium (Items directory path)', async ({
  page,
}) => {
  const r = await dropPackItemOntoSummonActor(page, {
    summonActorId: SUMMON_LARGE_ELEMENTAL,
    autosizeWeapons: true,
    item: 'longsword',
    dataType: 'world',
  });
  expect(r.weight).toBe(8);
  expect(r.damageRoll).toBe('2d6');
  expect(r.weaponSize).toBe('lg');
});

test('GL#1579 dataType data: actor-to-actor copy keeps Medium longsword stats', async ({ page }) => {
  const r = await dropPackItemOntoSummonActor(page, {
    summonActorId: SUMMON_LARGE_ELEMENTAL,
    autosizeWeapons: true,
    item: 'longsword',
    dataType: 'data',
  });
  expect(r.weight).toBe(4);
  expect(r.damageRoll).toBe('1d8');
  expect(r.name).toBe('Longsword');
});
