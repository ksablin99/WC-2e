'use strict';

/**
 * E2E tests — adding a race to a character and verifying the resulting changes.
 *
 * Covers:
 *   1. Adding "Elf, High" race applies +2 DEX racial bonus
 *   2. Adding "Elf, High" race applies -2 CON racial penalty
 *   3. Adding "Elf, High" race applies +2 Listen, +2 Search, +2 Spot racial bonuses
 *   4. Adding "Elf, High" race auto-adds the "Elven Blood" racial feat via CACHE.RacialFeatures
 *
 * SRD source: "Elf" entry in the Races chapter — +2 DEX, -2 CON; +2 racial bonus
 * to Listen, Search, and Spot checks; treated as Elven for all effects.
 *
 * Implementation note:
 *   Race changes are applied via actorUpdater._updateChanges().  That pipeline
 *   runs asynchronously after createEmbeddedDocuments() — ability mods and skill
 *   totals are not immediately available.  Tests poll via page.waitForFunction().
 *
 *   The "Elven Blood" feat is added by actorUpdater lines 2169+ which iterate
 *   CACHE.RacialFeatures.get(raceObject.name).  The feat item has
 *   system.uniqueId === 'racial-elvenblood-2'.
 *
 * Pack IDs:
 *   Race item  — pack: warcraftrpg2e.racialfeatures, _id: z5p39RR9V7lNlTK0 ("Elf, High")
 *   Elven Blood — pack: warcraftrpg2e.racial-abilities, uniqueId: racial-elvenblood-2
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const RACIALFEATURES_PACK = 'warcraftrpg2e.racialfeatures';
const ELF_HIGH_ID = 'z5p39RR9V7lNlTK0';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await page.waitForFunction(() => typeof game !== 'undefined' && game.ready === true, {
    timeout: 15_000,
  });
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Shared helper — create actor + add elf race, return actor id ──────────────

async function createElfActor(page, name, abilities = {}) {
  return page.evaluate(
    async ({ name, abilities, packId, elfId }) => {
      // Create bare actor then update abilities so _updateChanges computes mods
      const actor = await Actor.create({ name, type: 'character' });
      if (Object.keys(abilities).length) {
        const patch = {};
        for (const [k, v] of Object.entries(abilities)) {
          patch[`system.abilities.${k}.value`] = v;
        }
        await game.actors.get(actor.id).update(patch);
      }

      // Load race item from compendium and embed it
      const pack = game.packs.get(packId);
      const raceDoc = await pack.getDocument(elfId);
      await game.actors.get(actor.id).createEmbeddedDocuments('Item', [raceDoc.toObject()]);

      return actor.id;
    },
    { name, abilities, packId: RACIALFEATURES_PACK, elfId: ELF_HIGH_ID },
  );
}

// ── 1 & 2. DEX racial +2, CON racial -2 ──────────────────────────────────────

test('Elf, High race applies +2 DEX and -2 CON racial modifiers', async ({ page }) => {
  // Use neutral base scores so the delta is purely the racial bonus/penalty
  const actorId = await createElfActor(page, 'Elf DEX CON Test', {
    dex: 10, // base mod +0; elf +2 → expected mod +1
    con: 10, // base mod +0; elf -2 → expected mod -1
  });

  // Poll until actorUpdater propagates changes from the race item
  await page.waitForFunction(
    ({ id }) => {
      const a = game.actors.get(id);
      return a?.system?.abilities?.dex?.mod === 1 && a?.system?.abilities?.con?.mod === -1;
    },
    { id: actorId },
    { timeout: 10_000 },
  );

  const result = await page.evaluate(({ id }) => {
    const a = game.actors.get(id);
    return {
      dexMod: a.system.abilities.dex.mod,
      conMod: a.system.abilities.con.mod,
    };
  }, { id: actorId });

  expect(result.dexMod).toBe(1);  // 10 base + 2 racial = 12 → mod +1
  expect(result.conMod).toBe(-1); // 10 base - 2 racial = 8  → mod -1
});

// ── 3. Skill bonuses — Listen, Search, Spot each +2 ─────────────────────────

test('Elf, High race grants +2 racial bonus to Listen, Search, and Spot', async ({ page }) => {
  const actorId = await createElfActor(page, 'Elf Skill Test');

  // Poll until skill totals reflect the racial bonus.
  // Skills start at 0; racial +2 → total 2 (no ranks, no WIS/INT mod contribution).
  await page.waitForFunction(
    ({ id }) => {
      const a = game.actors.get(id);
      const sk = a?.system?.skills;
      return sk?.lis?.cs !== undefined; // wait for skills object to be fully populated
    },
    { id: actorId },
    { timeout: 10_000 },
  );

  // Wait for racial bonuses to propagate
  await page.waitForFunction(
    ({ id }) => {
      const a = game.actors.get(id);
      const sk = a?.system?.skills;
      return (
        (sk?.lis?.changeBonus ?? 0) >= 2 &&
        (sk?.src?.changeBonus ?? 0) >= 2 &&
        (sk?.spt?.changeBonus ?? 0) >= 2
      );
    },
    { id: actorId },
    { timeout: 10_000 },
  );

  const result = await page.evaluate(({ id }) => {
    const a = game.actors.get(id);
    const sk = a.system.skills;
    return {
      lisBonus: sk.lis.changeBonus ?? 0,
      srcBonus: sk.src.changeBonus ?? 0,
      sptBonus: sk.spt.changeBonus ?? 0,
    };
  }, { id: actorId });

  expect(result.lisBonus).toBeGreaterThanOrEqual(2);
  expect(result.srcBonus).toBeGreaterThanOrEqual(2);
  expect(result.sptBonus).toBeGreaterThanOrEqual(2);
});

// ── 4. Elven Blood feat is auto-added via CACHE.RacialFeatures ───────────────

test('Elf, High race auto-adds Elven Blood feat to actor items', async ({ page }) => {
  const actorId = await createElfActor(page, 'Elf Elven Blood Test');

  // The actorUpdater adds racial ability items asynchronously; poll until present
  await page.waitForFunction(
    ({ id }) => {
      const a = game.actors.get(id);
      return a?.items.some(
        (i) => i.system?.uniqueId === 'racial-elvenblood-2' || i.name === 'Elven Blood',
      );
    },
    { id: actorId },
    { timeout: 10_000 },
  );

  const found = await page.evaluate(({ id }) => {
    const a = game.actors.get(id);
    const item = a.items.find(
      (i) => i.system?.uniqueId === 'racial-elvenblood-2' || i.name === 'Elven Blood',
    );
    if (!item) return null;
    return { name: item.name, uniqueId: item.system.uniqueId, type: item.type };
  }, { id: actorId });

  expect(found).not.toBeNull();
  expect(found.name).toBe('Elven Blood');
  expect(found.uniqueId).toBe('racial-elvenblood-2');
});
