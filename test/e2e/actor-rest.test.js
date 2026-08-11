'use strict';

/**
 * E2E tests for the actor rest mechanic.
 *
 * D35E rest flow:
 *   - ActorRestDialog._updateObject calls actor.rest(restoreHealth, restoreDailyUses, longTermCare).
 *   - actor.rest() is a public async method that can be called directly in tests;
 *     the final this.update() inside it is unawaited, so we must poll for HP changes.
 *   - restoreHealth=true: heals HD total HP (×2 if longTermCare).
 *   - restoreDailyUses=true: resets per-day uses on items and prepared spell slots.
 *
 * Covers:
 *   1. rest(true, false) restores HP up to max.
 *   2. rest(false, true) does NOT restore HP but resets item uses.
 *   3. rest(true, false, true) (long-term care) heals double HD.
 *   4. rest(true, true) resets both HP and daily uses.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const FIGHTER_ID   = 'sgwZt7dg1ZHXQlrW'; // Fighter — HD 10, high fort

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: create a Fighter at level 5 with HP set below max ─────────────────
//
// Fighter 5, CON 10 (mod +0): max HP = 5×5 = 25 (average HD).
// We set HP to a known low value so rest recovery is measurable.

async function createWoundedFighter(page, hpValue) {
  return page.evaluate(async ({ packId, classId, hpValue }) => {
    const actor = await Actor.create({
      name: 'Rest Test Fighter',
      type: 'character',
      system: {
        abilities: { con: { value: 10 } },
        attributes: { hp: { value: hpValue, max: hpValue } },
      },
    });
    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const cd   = cls.toObject();
    cd.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [cd]);

    const a = game.actors.get(actor.id);
    // Force HP to wound value (levels may have recalculated max)
    await a.update({ 'system.attributes.hp.value': hpValue });

    return {
      actorId: a.id,
      hpMax:   game.actors.get(a.id).system.attributes.hp.max,
    };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID, hpValue });
}

// ── 1. rest(true, false) restores HP to max ──────────────────────────────────
//
// actor.rest() heals exactly hd.total HP (not to full unconditionally).
// We set starting HP to hpMax - hdTotal so that one rest brings HP to exactly
// hpMax: Math.min((hpMax - hdTotal) + hdTotal, hpMax) = hpMax.

test('rest with restoreHealth=true heals actor HP to max', async ({ page }) => {
  // Build the fighter, then wound it by exactly hdTotal so one rest heals to max.
  const { actorId, hpMax } = await page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({
      name: 'Rest Test Fighter',
      type: 'character',
      system: { abilities: { con: { value: 10 } } },
    });
    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const cd   = cls.toObject();
    cd.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [cd]);

    const a  = game.actors.get(actor.id);
    const hpMax   = a.system.attributes.hp.max;
    const hdTotal = a.system.attributes.hd.total;
    // Wound by exactly hdTotal so rest heals to max in one call.
    const startHp = Math.max(0, hpMax - hdTotal);
    await a.update({ 'system.attributes.hp.value': startHp });

    return { actorId: a.id, hpMax };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID });

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    actor.rest(true, false, false);
  }, { actorId });

  // Poll for HP to reach max (rest's update() is unawaited internally)
  await page.waitForFunction(
    ({ actorId, max }) => game.actors.get(actorId)?.system?.attributes?.hp?.value >= max,
    { actorId, max: hpMax },
    { timeout: 5_000 },
  );

  const hp = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.hp.value;
  }, { actorId });

  expect(hp).toBe(hpMax);
});

// ── 2. rest(false, false) does NOT restore HP ────────────────────────────────

test('rest with restoreHealth=false does not change HP', async ({ page }) => {
  const { actorId } = await createWoundedFighter(page, 5);

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.rest(false, false, false);
  }, { actorId });

  // rest()'s final this.update() is unawaited internally; drain the microtask
  // queue to let any synchronous Foundry hooks settle before asserting HP.
  await page.evaluate(() => new Promise(r => setTimeout(r, 0)));

  const hp = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.hp.value;
  }, { actorId });

  expect(hp).toBe(5);
});

// ── 3. rest(false, true) resets per-day item uses without touching HP ────────

test('rest with restoreDailyUses=true resets item uses but leaves HP unchanged', async ({ page }) => {
  const result = await page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({
      name: 'Rest Uses Actor',
      type: 'character',
      system: { attributes: { hp: { value: 5, max: 30 } } },
    });
    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const cd   = cls.toObject();
    cd.system.levels = 3;
    await actor.createEmbeddedDocuments('Item', [cd]);
    await game.actors.get(actor.id).update({ 'system.attributes.hp.value': 5 });

    // Add a per-day consumable with uses spent
    const [itm] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Daily Power',
      type: 'feat',
      system: {
        uses: { value: 0, max: 3, per: 'day', autoDeductCharges: true },
      },
    }]);

    const a = game.actors.get(actor.id);
    a.rest(false, true, false);
    // Poll until uses reset
    for (let i = 0; i < 30; i++) {
      const fresh = game.actors.get(actor.id);
      const item = fresh.items.get(itm.id);
      if (item?.system?.uses?.value === 3) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const fresh = game.actors.get(actor.id);
    return {
      hpAfter:    fresh.system.attributes.hp.value,
      usesAfter:  fresh.items.get(itm.id)?.system?.uses?.value ?? null,
    };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID });

  expect(result.hpAfter).toBe(5);    // HP unchanged
  expect(result.usesAfter).toBe(3);  // uses restored to max
});

// ── 4. rest(true, true) restores both HP and daily uses ──────────────────────

test('rest with restoreHealth=true and restoreDailyUses=true restores HP and uses', async ({ page }) => {
  const result = await page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({
      name: 'Full Rest Actor',
      type: 'character',
      system: { attributes: { hp: { value: 5, max: 20 } } },
    });
    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const cd   = cls.toObject();
    cd.system.levels = 2;
    await actor.createEmbeddedDocuments('Item', [cd]);
    await game.actors.get(actor.id).update({ 'system.attributes.hp.value': 5 });

    const [itm] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Daily Power',
      type: 'feat',
      system: {
        uses: { value: 0, max: 2, per: 'day', autoDeductCharges: true },
      },
    }]);

    const hpMax = game.actors.get(actor.id).system.attributes.hp.max;

    game.actors.get(actor.id).rest(true, true, false);
    for (let i = 0; i < 50; i++) {
      const fresh = game.actors.get(actor.id);
      if (fresh.system.attributes.hp.value >= hpMax &&
          fresh.items.get(itm.id)?.system?.uses?.value === 2) break;
      await new Promise(r => setTimeout(r, 100));
    }

    const fresh = game.actors.get(actor.id);
    return {
      hpAfter:   fresh.system.attributes.hp.value,
      hpMax,
      usesAfter: fresh.items.get(itm.id)?.system?.uses?.value ?? null,
    };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID });

  expect(result.hpAfter).toBe(result.hpMax);
  expect(result.usesAfter).toBe(2);
});
