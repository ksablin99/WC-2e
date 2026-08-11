'use strict';

/**
 * E2E tests — Rogue sneak attack dice pool accumulation.
 *
 * SRD: A rogue deals 1d6 extra damage at level 1, plus 1d6 for every 2 rogue
 * levels thereafter (+1d6 at 1, 3, 5, 7, 9, 11, 13, 15, 17, 19).
 *
 * Implementation: actorUpdater.js aggregates rogue-group class levels into
 * system.attributes.sneakAttackDiceTotal.  Other classes with sneakAttackGroup
 * (Assassin, Arcane Trickster, Blackguard) stack using their own group formula.
 *
 * Pack IDs:
 *   Rogue   — warcraftrpg2e.classes, _id: Peiv9Y6pDYt6hR5v
 *   Assassin — warcraftrpg2e.classes, _id: Oe4aFdZE8p7HSgXV
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const ROGUE_ID = 'Peiv9Y6pDYt6hR5v';
const ASSASSIN_ID = 'Oe4aFdZE8p7HSgXV';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await page.waitForFunction(() => typeof game !== 'undefined' && game.ready === true, {
    timeout: 15_000,
  });
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

/** Add a class from the compendium at a given level and return the actor id. */
async function createActorWithClass(page, classId, level, name = 'SA Test') {
  return page.evaluate(
    async ({ classId, level, name, packId }) => {
      const actor = await Actor.create({ name, type: 'character' });
      const pack = game.packs.get(packId);
      const classDoc = await pack.getDocument(classId);
      const classData = classDoc.toObject();
      classData.system.levels = level;
      await game.actors.get(actor.id).createEmbeddedDocuments('Item', [classData]);
      return actor.id;
    },
    { classId, level, name, packId: CLASSES_PACK },
  );
}

/**
 * Poll until sneakAttackDiceTotal matches expected value.
 * The formula `(ceil(@level/2))` evaluates to an integer (1, 2, 3…), not a "Nd6" string.
 */
async function waitForSneakAttack(page, actorId, expected) {
  await page.waitForFunction(
    ({ id, exp }) => game.actors.get(id)?.system?.attributes?.sneakAttackDiceTotal === exp,
    { id: actorId, exp: expected },
    { timeout: 10_000 },
  );
}

// ── 1. Rogue 1 → 1 die ───────────────────────────────────────────────────────

test('Rogue 1 has sneakAttackDiceTotal of 1', async ({ page }) => {
  const actorId = await createActorWithClass(page, ROGUE_ID, 1, 'Rogue 1');
  await waitForSneakAttack(page, actorId, 1);

  const total = await page.evaluate(({ id }) =>
    game.actors.get(id).system.attributes.sneakAttackDiceTotal,
    { id: actorId },
  );
  expect(total).toBe(1);
});

// ── 2. Rogue 3 → 2 dice ──────────────────────────────────────────────────────

test('Rogue 3 has sneakAttackDiceTotal of 2', async ({ page }) => {
  const actorId = await createActorWithClass(page, ROGUE_ID, 3, 'Rogue 3');
  await waitForSneakAttack(page, actorId, 2);

  const total = await page.evaluate(({ id }) =>
    game.actors.get(id).system.attributes.sneakAttackDiceTotal,
    { id: actorId },
  );
  expect(total).toBe(2);
});

// ── 3. Rogue progression: 5 → 3, 7 → 4 ──────────────────────────────────────

test('Rogue 5 has sneakAttackDiceTotal 3 and Rogue 7 has 4', async ({ page }) => {
  const id5 = await createActorWithClass(page, ROGUE_ID, 5, 'Rogue 5');
  const id7 = await createActorWithClass(page, ROGUE_ID, 7, 'Rogue 7');

  await waitForSneakAttack(page, id5, 3);
  await waitForSneakAttack(page, id7, 4);

  const [t5, t7] = await page.evaluate(({ a, b }) => [
    game.actors.get(a).system.attributes.sneakAttackDiceTotal,
    game.actors.get(b).system.attributes.sneakAttackDiceTotal,
  ], { a: id5, b: id7 });

  expect(t5).toBe(3);
  expect(t7).toBe(4);
});

// ── 4. Rogue 10 → 5 dice ─────────────────────────────────────────────────────

test('Rogue 10 has sneakAttackDiceTotal of 5', async ({ page }) => {
  const actorId = await createActorWithClass(page, ROGUE_ID, 10, 'Rogue 10');
  await waitForSneakAttack(page, actorId, 5);

  const total = await page.evaluate(({ id }) =>
    game.actors.get(id).system.attributes.sneakAttackDiceTotal,
    { id: actorId },
  );
  expect(total).toBe(5);
});
