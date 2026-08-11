'use strict';

/**
 * E2E: BAB from buffs vs `bab.nonepic` (GitLab #1467) and full-attack iteratives.
 *
 * SRD 3.5e (https://www.d20srd.org/srd/combat/combatStatistics.htm — Base Attack Bonus):
 * “A second attack is gained when a base attack bonus reaches +6, a third with +11
 * or higher, and a fourth with +16 or higher.” So manufactured full-attack count from
 * non‑epic BAB `n` is **1 + max(0, floor((n − 1) / 5))** (one attack at BAB +1…+5).
 *
 * `babattack` item changes must update **both** `bab.total` and `bab.nonepic` so buffs
 * stay consistent (including with `useFractionalBaseBonuses`).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const FIGHTER_ID = 'sgwZt7dg1ZHXQlrW';
const WIZARD_ID = 'VwVlbNYqDgMBIWhQ';

/** SRD 3.5e manufactured full-attack count from non-epic BAB (matches `use.js` autoScale). */
function manufacturedFullAttackCount(nonepic) {
  const n = Math.max(0, Number(nonepic) || 0);
  return 1 + Math.max(0, Math.floor((n - 1) / 5));
}

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

async function createFighter(page, level, name = 'E2E BAB Fighter') {
  return page.evaluate(
    async ({ packId, classId, level, name }) => {
      const actor = await Actor.create({
        name,
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
      classData.system.levels = level;
      await actor.createEmbeddedDocuments('Item', [classData]);
      const a = game.actors.get(actor.id);
      return {
        actorId: a.id,
        babTotal: a.system.attributes.bab.total,
        babNonepic: a.system.attributes.bab.nonepic,
      };
    },
    { packId: CLASSES_PACK, classId: FIGHTER_ID, level, name },
  );
}

async function addBabattackBuff(page, actorId, bonus, name = 'E2E BAB Buff') {
  await page.evaluate(
    async ({ actorId, bonus, name }) => {
      const actor = game.actors.get(actorId);
      await actor.createEmbeddedDocuments('Item', [
        {
          name,
          type: 'buff',
          system: {
            active: true,
            changes: [[String(bonus), 'attack', 'babattack', 'untyped', 0]],
          },
        },
      ]);
    },
    { actorId, bonus, name },
  );
}

test('GL#1467 +1 babattack buff raises bab.total and bab.nonepic and gains second attack at +6', async ({
  page,
}) => {
  const { actorId, babTotal: beforeT, babNonepic: beforeN } = await createFighter(page, 5);

  expect(beforeT).toBe(5);
  expect(beforeN).toBe(5);
  expect(manufacturedFullAttackCount(beforeN)).toBe(1);

  await addBabattackBuff(page, actorId, 1);

  const after = await page.evaluate(({ actorId }) => {
    const a = game.actors.get(actorId);
    return { total: a.system.attributes.bab.total, nonepic: a.system.attributes.bab.nonepic };
  }, { actorId });

  expect(after.total).toBe(beforeT + 1);
  expect(after.nonepic).toBe(beforeN + 1);
  expect(manufacturedFullAttackCount(after.nonepic)).toBe(2);
});

test('Fighter 10 baseline matches SRD (+10/+5 — two attacks)', async ({ page }) => {
  const { babNonepic } = await createFighter(page, 10, 'E2E BAB F10');
  expect(babNonepic).toBe(10);
  expect(manufacturedFullAttackCount(babNonepic)).toBe(2);
});

test('Fighter 11 baseline matches SRD (three attacks: +11/+6/+1)', async ({ page }) => {
  const { babNonepic } = await createFighter(page, 11, 'E2E BAB F11');
  expect(babNonepic).toBe(11);
  expect(manufacturedFullAttackCount(babNonepic)).toBe(3);
});

test('fractional base BAB: +2 babattack reaches +6 and adds second attack (F2/W4)', async ({
  page,
}) => {
  const prev = await page.evaluate(() => game.settings.get('warcraftrpg2e', 'useFractionalBaseBonuses'));
  try {
    await page.evaluate(async () => {
      await game.settings.set('warcraftrpg2e', 'useFractionalBaseBonuses', true);
    });

    const { actorId, babTotal: t0, babNonepic: n0 } = await page.evaluate(
      async ({ packId, fId, wId }) => {
        const actor = await Actor.create({
          name: 'E2E Fractional BAB',
          type: 'character',
          system: { abilities: { str: { value: 10 }, dex: { value: 10 }, con: { value: 10 } } },
        });
        const pack = game.packs.get(packId);
        const f = await pack.getDocument(fId);
        const w = await pack.getDocument(wId);
        const fd = f.toObject();
        fd.system.levels = 2;
        const wd = w.toObject();
        wd.system.levels = 4;
        await actor.createEmbeddedDocuments('Item', [fd, wd]);
        const a = game.actors.get(actor.id);
        return {
          actorId: a.id,
          babTotal: a.system.attributes.bab.total,
          babNonepic: a.system.attributes.bab.nonepic,
        };
      },
      { packId: CLASSES_PACK, fId: FIGHTER_ID, wId: WIZARD_ID },
    );

    expect(t0).toBe(n0);
    expect(t0).toBe(4);
    expect(manufacturedFullAttackCount(n0)).toBe(1);

    await addBabattackBuff(page, actorId, 2, 'Fractional BAB +2');

    const { t1, n1 } = await page.evaluate(({ actorId }) => {
      const a = game.actors.get(actorId);
      return { t1: a.system.attributes.bab.total, n1: a.system.attributes.bab.nonepic };
    }, { actorId });

    expect(t1).toBe(t0 + 2);
    expect(n1).toBe(n0 + 2);
    expect(manufacturedFullAttackCount(n1)).toBe(2);
  } finally {
    await page.evaluate(async (p) => {
      await game.settings.set('warcraftrpg2e', 'useFractionalBaseBonuses', p);
    }, prev);
  }
});
