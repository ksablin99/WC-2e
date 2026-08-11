'use strict';

/**
 * E2E tests for ActorMinionsHelper.calculateMinionDistance().
 *
 * The system hooks into "moveToken" (Foundry v13) and, when a token finishes
 * moving (movement.state === "completed"), calls calculateMinionDistance on
 * the relevant actor.  The helper:
 *   - For NPC (minion): reads master from npc.system.master.id, measures
 *     distance to master's token, writes npc.system.master.distance AND
 *     character.system.attributes.minionDistance.<key>.
 *   - For Character (master): loops all NPCs linked to this master, measures
 *     each distance, writes both actors.
 *
 * Scene convention: 2000×2000 px, grid.size=100 (1 square = 100 px = 5 ft).
 * Token x/y is the top-left corner in pixels.
 *
 * Covers:
 *   1. Distance updates on NPC (minion) token move.
 *   2. Distance updates on Character (master) token move.
 *   3. Distance is 0 when master and minion tokens occupy the same tile.
 *   4. Character.system.attributes.minionDistance map gets the correct key/value.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

// ── Lifecycle ─────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Infrastructure helpers ────────────────────────────────────────────────────

/**
 * Create and activate a 2000×2000 scene (grid 100 px/sq = 5 ft/sq).
 * Waits until PIXI.UPDATE_PRIORITY.OBJECTS is defined (canvas fully ready).
 */
async function createScene(page) {
  const sceneId = await page.evaluate(async () => {
    const scene = await Scene.create({
      name: 'Minion Distance Test Scene',
      active: true,
      width: 2000,
      height: 2000,
      grid: { size: 100, distance: 5, units: 'ft' },
    });
    return scene.id;
  });

  await page.waitForFunction(
    (id) =>
      canvas.ready &&
      canvas.scene?.id === id &&
      typeof PIXI !== 'undefined' &&
      PIXI.UPDATE_PRIORITY !== undefined &&
      PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    sceneId,
    { timeout: 20_000 },
  );
  return sceneId;
}

/**
 * Create a Character ("Master Hero") and an NPC ("Wolf Companion"), link the
 * NPC to the character via _setMaster(), wait for the link to persist in the
 * DB, then place both as linked tokens on the active scene.
 *
 * Returns { masterId, minionId, masterTokenId, minionTokenId }.
 */
async function setupLinkedPair(page, { masterX, masterY, minionX, minionY }) {
  // Step 1 – create actors (name+type only; no system fields at creation time)
  const ids = await page.evaluate(async () => {
    const master = await Actor.create({ name: 'Master Hero', type: 'character' });
    const minion = await Actor.create({ name: 'Wolf Companion', type: 'npc' });
    return { masterId: master.id, minionId: minion.id };
  });

  // Step 2 – link minion to master (_setMaster fires update without await)
  await page.evaluate(({ masterId, minionId }) => {
    const master = game.actors.get(masterId);
    const minion = game.actors.get(minionId);
    minion._setMaster({ id: master.id, img: master.img, name: master.name });
  }, ids);

  // Step 3 – wait for link to persist
  await page.waitForFunction(
    ({ minionId, masterId }) =>
      game.actors.get(minionId)?.system?.master?.id === masterId,
    ids,
    { timeout: 5_000 },
  );

  // Step 4 – place tokens on the active scene
  const tokenIds = await page.evaluate(
    async ({ masterId, minionId, masterX, masterY, minionX, minionY }) => {
      const scene = canvas.scene;
      const [masterToken] = await scene.createEmbeddedDocuments('Token', [{
        name: 'Master Hero Token',
        actorId: masterId,
        actorLink: true,
        x: masterX,
        y: masterY,
      }]);
      const [minionToken] = await scene.createEmbeddedDocuments('Token', [{
        name: 'Wolf Companion Token',
        actorId: minionId,
        actorLink: true,
        x: minionX,
        y: minionY,
      }]);
      return { masterTokenId: masterToken.id, minionTokenId: minionToken.id };
    },
    { masterId: ids.masterId, minionId: ids.minionId, masterX, masterY, minionX, minionY },
  );

  return { ...ids, ...tokenIds };
}

// ── 1. Distance updates when the NPC (minion) token moves ─────────────────────

test('1: distance updates on npc.system.master.distance when minion token moves', async ({ page }) => {
  await createScene(page);

  // Place both tokens at the same spot, then move the minion away.
  const { minionId, minionTokenId } = await setupLinkedPair(page, {
    masterX: 200, masterY: 200,
    minionX: 200, minionY: 200,
  });

  // Move minion 2 squares east (200 px → 2 × 5 ft = 10 ft).
  await page.evaluate(async ({ minionTokenId }) => {
    const tokenDoc = canvas.scene.tokens.get(minionTokenId);
    await tokenDoc.update({ x: 400, y: 200 });
  }, { minionTokenId });

  // calculateMinionDistance is called asynchronously by the moveToken hook;
  // poll until npc.system.master.distance reflects the expected value.
  await page.waitForFunction(
    ({ minionId }) => game.actors.get(minionId)?.system?.master?.distance === 10,
    { minionId },
    { timeout: 12_000 },
  );

  const distance = await page.evaluate(
    ({ minionId }) => game.actors.get(minionId).system.master.distance,
    { minionId },
  );
  expect(distance).toBe(10);
});

// ── 2. Distance updates when the Character (master) token moves ───────────────

test('2: distance updates on npc.system.master.distance when master token moves', async ({ page }) => {
  await createScene(page);

  // Both tokens start at the same spot.
  const { minionId, masterTokenId } = await setupLinkedPair(page, {
    masterX: 200, masterY: 200,
    minionX: 200, minionY: 200,
  });

  // Move master 3 squares east (300 px → 3 × 5 ft = 15 ft from minion).
  await page.evaluate(async ({ masterTokenId }) => {
    const tokenDoc = canvas.scene.tokens.get(masterTokenId);
    await tokenDoc.update({ x: 500, y: 200 });
  }, { masterTokenId });

  await page.waitForFunction(
    ({ minionId }) => game.actors.get(minionId)?.system?.master?.distance === 15,
    { minionId },
    { timeout: 12_000 },
  );

  const distance = await page.evaluate(
    ({ minionId }) => game.actors.get(minionId).system.master.distance,
    { minionId },
  );
  expect(distance).toBe(15);
});

// ── 3. Distance is 0 when tokens share the same tile ─────────────────────────

test('3: distance is 0 when master and minion tokens are on the same tile', async ({ page }) => {
  await createScene(page);

  // Start both at the same spot.
  const { minionId, minionTokenId } = await setupLinkedPair(page, {
    masterX: 200, masterY: 200,
    minionX: 200, minionY: 200,
  });

  // First: move minion away to establish a confirmed non-zero distance.
  await page.evaluate(async ({ minionTokenId }) => {
    const tokenDoc = canvas.scene.tokens.get(minionTokenId);
    await tokenDoc.update({ x: 400, y: 200 });
  }, { minionTokenId });

  await page.waitForFunction(
    ({ minionId }) => (game.actors.get(minionId)?.system?.master?.distance ?? -1) > 0,
    { minionId },
    { timeout: 12_000 },
  );

  // Now move minion back onto the master's tile (same coordinates → 0 ft).
  await page.evaluate(async ({ minionTokenId }) => {
    const tokenDoc = canvas.scene.tokens.get(minionTokenId);
    await tokenDoc.update({ x: 200, y: 200 });
  }, { minionTokenId });

  await page.waitForFunction(
    ({ minionId }) => game.actors.get(minionId)?.system?.master?.distance === 0,
    { minionId },
    { timeout: 12_000 },
  );

  const distance = await page.evaluate(
    ({ minionId }) => game.actors.get(minionId).system.master.distance,
    { minionId },
  );
  expect(distance).toBe(0);
});

// ── 4. Character's minionDistance map is keyed correctly ─────────────────────

test('4: character.system.attributes.minionDistance is keyed by normalised minion name', async ({ page }) => {
  await createScene(page);

  const { masterId, minionTokenId } = await setupLinkedPair(page, {
    masterX: 200, masterY: 200,
    minionX: 200, minionY: 200,
  });

  // Move minion 4 squares east (400 px → 4 × 5 ft = 20 ft).
  await page.evaluate(async ({ minionTokenId }) => {
    const tokenDoc = canvas.scene.tokens.get(minionTokenId);
    await tokenDoc.update({ x: 600, y: 200 });
  }, { minionTokenId });

  // Key = "Wolf Companion".toLowerCase().replace(/ /g,'').replace(/,/g,'') = "wolfcompanion"
  const expectedKey = 'wolfcompanion';

  await page.waitForFunction(
    ({ masterId, key }) =>
      game.actors.get(masterId)?.system?.attributes?.minionDistance?.[key] === 20,
    { masterId, key: expectedKey },
    { timeout: 12_000 },
  );

  const minionDist = await page.evaluate(
    ({ masterId, key }) =>
      game.actors.get(masterId).system.attributes.minionDistance?.[key],
    { masterId, key: expectedKey },
  );
  expect(minionDist).toBe(20);
});
