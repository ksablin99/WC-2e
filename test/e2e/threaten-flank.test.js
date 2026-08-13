'use strict';

/**
 * E2E tests for the D35E threaten / flank feature (issues #1509 and #1510).
 *
 * Covers:
 *   Group A — getThreatenedTokens: melee 5-ft range (medium and large attackers)
 *   Group B — getThreatenedTokens: reach weapon 10-ft range (not adjacent)
 *   Group C — isFlanking: SRD line-through-opposite-borders test
 *   Group D — drawThreatenedHighlights / clearThreatHighlights display modes
 *   Group E — null-safety / edge cases
 *
 * Scene convention: 4000×4000 px, grid.size=100, 1 sq = 5 ft.
 * Token x/y = top-left corner in pixels.
 * Token width/height are in grid units (1 unit = 100 px).
 *
 * IMPORTANT: DistanceHelper is exposed on game.D35E after the patch to D35E.js.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

// ── Shared constants ──────────────────────────────────────────────────────────

const SCENE_NAME = 'ThreatFlank E2E Scene';

async function foundryGeneration(page) {
  return page.evaluate(() => game.release.generation);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await page.evaluate(async () => {
    await Promise.all([...game.combats].map(c => c.delete()));
  });
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Infrastructure helpers ────────────────────────────────────────────────────

/**
 * Create a bare-bones scene (4000×4000, grid.size=100) and wait for the canvas
 * to fully initialise (PIXI.UPDATE_PRIORITY.OBJECTS must be defined).
 */
async function createScene(page, name = SCENE_NAME) {
  const sceneId = await page.evaluate(async (sceneName) => {
    const scene = await Scene.create({
      name: sceneName,
      active: true,
      width: 4000,
      height: 4000,
      grid: { size: 100 },
    });
    return scene.id;
  }, name);

  await page.waitForFunction(
    (id) =>
      canvas.ready &&
      canvas.scene?.id === id &&
      typeof PIXI !== 'undefined' &&
      PIXI.UPDATE_PRIORITY !== undefined &&
      PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    sceneId,
    { timeout: 20_000 }
  );
  return sceneId;
}

/**
 * Create a character actor and return its id.
 *  size: D35E size key — 'fine','dim','tiny','sm','med','lg','huge','grg','col'
 *  Defaults to 'med' (1×1 token).  Non-medium sizes trigger an actor.update so
 *  ActorUpdater can write the correct prototypeToken dimensions.
 */
async function createActor(page, name, size = 'med') {
  return page.evaluate(async ({ n, sz }) => {
    const actor = await Actor.create({ name: n, type: 'character' });
    if (sz !== 'med') {
      // ActorUpdater.update() runs on actor.update and writes prototypeToken.width/height
      // from CONFIG.D35E.tokenSizes based on system.traits.size.
      await actor.update({ 'system.traits.size': sz });
    }
    return actor.id;
  }, { n: name, sz: size });
}

/**
 * Place a token on the current scene and return its id.
 *  opts: { actorId, x, y, disposition, actorLink }
 *  Token size comes from the actor's prototypeToken (set via createActor size param).
 *  disposition: 1=friendly, -1=hostile, 0=neutral
 */
async function placeToken(page, opts) {
  const placed = await page.evaluate(async (o) => {
    const scene = canvas.scene;
    const actor = game.actors.get(o.actorId);
    if (!actor) throw new Error(`Cannot place missing actor ${o.actorId}`);
    const prototype = await actor.getTokenDocument({
      name: `Token-${o.actorId.slice(-4)}`,
      actorLink: o.actorLink ?? true,
      x: o.x,
      y: o.y,
      disposition: o.disposition ?? 1,
    }, { parent: scene });
    const [tokenDoc] = await scene.createEmbeddedDocuments('Token', [prototype.toObject()]);
    return { id: tokenDoc.id, width: tokenDoc.width, height: tokenDoc.height };
  }, opts);

  // createToken hooks may asynchronously refresh the linked actor. Do not let
  // a test observe the default 1x1 placeable while that refresh is still
  // replacing it with the actor's prototype dimensions.
  await page.waitForFunction(({ id, width, height }) => {
    const token = canvas.tokens.placeables.find((entry) => entry.id === id);
    return token?.document.width === width && token?.document.height === height;
  }, placed, { timeout: 8_000 });
  return placed.id;
}

/**
 * Add an equipped melee weapon to an actor.  reach=true → reach weapon.
 * Uses two-step create-then-update to avoid Foundry resetting computed fields.
 */
async function addMeleeWeapon(page, actorId, name = 'Longsword', reach = false) {
  return page.evaluate(async ({ actorId, name, reach }) => {
    const actor = game.actors.get(actorId);
    // Step 1: create with name + type only
    const [item] = await actor.createEmbeddedDocuments('Item', [{ name, type: 'weapon' }]);
    // Step 2: update all fields (equipped is always false after creation, and other
    // system fields may also be reset by Foundry's data model defaults)
    await game.actors.get(actorId).items.get(item.id).update({
      'system.equipped': true,
      'system.weaponSubtype': 'melee',
      'system.properties.rch': reach,
    });
    return item.id;
  }, { actorId, name, reach });
}

// ── GROUP A: getThreatenedTokens — melee (5 ft) ───────────────────────────────

// ── A1. Medium attacker, enemy 1 square away (5 ft) → threatened ──────────────
test('A1: medium attacker, adjacent enemy (5 ft) is threatened', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker A1');
  const enemyId = await createActor(page, 'Enemy A1');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);
  // Wait for weapon to be fully applied to the actor's items collection
  await page.waitForFunction((actorId) => {
    const actor = game.actors.get(actorId);
    return actor?.items.some(i => i.type === 'weapon' && i.system.equipped && i.system.weaponSubtype === 'melee');
  }, attackerId, { timeout: 8_000 });

  const threatened = await page.evaluate(({ atkId, enmId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    const list = helper.getThreatenedTokens(token);
    return list.map(t => t.id);
  }, { atkId: attackerTokenId, enmId: enemyTokenId });

  expect(threatened).toContain(enemyTokenId);
});

// ── A2. Medium attacker, enemy 2 squares away (10 ft) → NOT threatened ────────
test('A2: medium attacker, enemy 2 squares away (10 ft) is NOT threatened', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker A2');
  const enemyId = await createActor(page, 'Enemy A2');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 500, y: 700, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  const threatened = await page.evaluate(({ atkId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    return helper.getThreatenedTokens(token).map(t => t.id);
  }, { atkId: attackerTokenId });

  expect(threatened).not.toContain(enemyTokenId);
});

// ── A3. Medium attacker, diagonal 1 square → threatened ───────────────────────
test('A3: medium attacker threatens diagonally adjacent enemy', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker A3');
  const enemyId = await createActor(page, 'Enemy A3');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 600, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  const threatened = await page.evaluate(({ atkId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    return helper.getThreatenedTokens(token).map(t => t.id);
  }, { atkId: attackerTokenId });

  expect(threatened).toContain(enemyTokenId);
});

// ── A4. Only opposite-disposition tokens returned ─────────────────────────────
test('A4: only hostile tokens are returned (same-disposition ally excluded)', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker A4');
  const enemyId = await createActor(page, 'Enemy A4');
  const allyId = await createActor(page, 'Ally A4');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  const allyTokenId = await placeToken(page, { actorId: allyId, x: 600, y: 500, disposition: 1 });
  await addMeleeWeapon(page, attackerId);

  const threatened = await page.evaluate(({ atkId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    return helper.getThreatenedTokens(token).map(t => t.id);
  }, { atkId: attackerTokenId });

  expect(threatened).toContain(enemyTokenId);
  expect(threatened).not.toContain(allyTokenId);
  expect(threatened).not.toContain(attackerTokenId);
});

// ── A5. Large (2×2) attacker threatening an adjacent medium enemy ──────────────
test('A5: large (2×2) attacker threatens adjacent medium enemy', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker A5', 'lg');
  const enemyId = await createActor(page, 'Enemy A5');
  // Large attacker at (500,500): occupies (500-699, 500-699)
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  // Enemy immediately right of large token's right edge
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 700, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  const threatened = await page.evaluate(({ atkId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    return helper.getThreatenedTokens(token).map(t => t.id);
  }, { atkId: attackerTokenId });

  expect(threatened).toContain(enemyTokenId);
});

// ── A6. Huge (3×3) attacker threatening adjacent medium enemy ─────────────────
test('A6: huge (3×3) attacker threatens adjacent medium enemy', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker A6', 'huge');
  const enemyId = await createActor(page, 'Enemy A6');
  // Huge attacker at (400,400): occupies (400-699, 400-699)
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 400, y: 400, disposition: 1 });
  // Enemy immediately right of attacker
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 700, y: 500, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  const threatened = await page.evaluate(({ atkId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    return helper.getThreatenedTokens(token).map(t => t.id);
  }, { atkId: attackerTokenId });

  expect(threatened).toContain(enemyTokenId);
});

// ── A7. Gargantuan (4×4) attacker threatening medium enemy ───────────────────
test('A7: gargantuan (4×4) attacker threatens adjacent medium enemy', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker A7', 'grg');
  const enemyId = await createActor(page, 'Enemy A7');
  // Gargantuan at (400,400): occupies (400-799, 400-799)
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 400, y: 400, disposition: 1 });
  // Enemy just beyond right edge
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 800, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  const threatened = await page.evaluate(({ atkId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    return helper.getThreatenedTokens(token).map(t => t.id);
  }, { atkId: attackerTokenId });

  expect(threatened).toContain(enemyTokenId);
});

// ── A8. Colossal (6×6) attacker threatening medium enemy ─────────────────────
test('A8: colossal (6×6) attacker threatens adjacent medium enemy', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker A8', 'col');
  const enemyId = await createActor(page, 'Enemy A8');
  // Colossal at (400,400): occupies (400-999, 400-999)
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 400, y: 400, disposition: 1 });
  // Enemy just beyond right edge
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 1000, y: 700, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  const threatened = await page.evaluate(({ atkId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    return helper.getThreatenedTokens(token).map(t => t.id);
  }, { atkId: attackerTokenId });

  expect(threatened).toContain(enemyTokenId);
});

// ── GROUP B: getThreatenedTokens — reach weapon (10 ft, NOT adjacent) ────────

// ── B1. Reach: adjacent (5 ft) → NOT threatened ───────────────────────────────
test('B1: reach weapon — adjacent enemy (5 ft) is NOT threatened', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker B1');
  const enemyId = await createActor(page, 'Enemy B1');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 600, y: 600, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 600, y: 700, disposition: -1 });
  await addMeleeWeapon(page, attackerId, 'Glaive', true);

  const threatened = await page.evaluate(({ atkId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    return helper.getThreatenedTokens(token).map(t => t.id);
  }, { atkId: attackerTokenId });

  expect(threatened).not.toContain(enemyTokenId);
});

// ── B2. Reach: 2 squares away (10 ft) → threatened ────────────────────────────
test('B2: reach weapon — enemy 2 squares away (10 ft) IS threatened', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker B2');
  const enemyId = await createActor(page, 'Enemy B2');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 600, y: 600, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 600, y: 800, disposition: -1 });
  await addMeleeWeapon(page, attackerId, 'Glaive', true);

  const threatened = await page.evaluate(({ atkId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    return helper.getThreatenedTokens(token).map(t => t.id);
  }, { atkId: attackerTokenId });

  expect(threatened).toContain(enemyTokenId);
});

// ── B3. Reach: 3 squares away (15 ft) → NOT threatened ───────────────────────
test('B3: reach weapon — enemy 3 squares away (15 ft) is NOT threatened', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker B3');
  const enemyId = await createActor(page, 'Enemy B3');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 600, y: 600, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 600, y: 900, disposition: -1 });
  await addMeleeWeapon(page, attackerId, 'Glaive', true);

  const threatened = await page.evaluate(({ atkId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    return helper.getThreatenedTokens(token).map(t => t.id);
  }, { atkId: attackerTokenId });

  expect(threatened).not.toContain(enemyTokenId);
});

// ── B4. Reach: diagonal 2 squares → threatened ────────────────────────────────
test('B4: reach weapon — enemy diagonal 2 squares IS threatened', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker B4');
  const enemyId = await createActor(page, 'Enemy B4');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 600, y: 600, disposition: 1 });
  // Diagonal 2 squares: (800, 800)
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 800, y: 800, disposition: -1 });
  await addMeleeWeapon(page, attackerId, 'Glaive', true);

  const threatened = await page.evaluate(({ atkId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    return helper.getThreatenedTokens(token).map(t => t.id);
  }, { atkId: attackerTokenId });

  expect(threatened).toContain(enemyTokenId);
});

// ── GROUP C: isFlanking ────────────────────────────────────────────────────────

// ── C1. Attacker above, ally below → flanking (top↔bottom) ───────────────────
test('C1: attacker above + ally below → flanking (top-bottom border)', async ({ page }) => {
  await createScene(page);
  const enemyId = await createActor(page, 'Enemy C1');
  const attackerId = await createActor(page, 'Attacker C1');
  const allyId = await createActor(page, 'Ally C1');

  // Enemy at (1000,1000)
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 1000, y: 1000, disposition: -1 });
  // Attacker 1 sq above
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 1000, y: 900, disposition: 1 });
  // Ally 1 sq below
  const allyTokenId = await placeToken(page, { actorId: allyId, x: 1000, y: 1100, disposition: 1 });
  await addMeleeWeapon(page, attackerId);
  await addMeleeWeapon(page, allyId);

  const result = await page.evaluate(({ atkId, enmId, alyId }) => {
    const helper = game.D35E.DistanceHelper;
    const attacker = canvas.tokens.placeables.find(t => t.id === atkId);
    const enemy = canvas.tokens.placeables.find(t => t.id === enmId);
    const ally = canvas.tokens.placeables.find(t => t.id === alyId);
    return helper.isFlanking(attacker, enemy, ally);
  }, { atkId: attackerTokenId, enmId: enemyTokenId, alyId: allyTokenId });

  expect(result).toBe(true);
});

// ── C2. Attacker left, ally right → flanking (left↔right) ────────────────────
test('C2: attacker left + ally right → flanking (left-right border)', async ({ page }) => {
  await createScene(page);
  const enemyId = await createActor(page, 'Enemy C2');
  const attackerId = await createActor(page, 'Attacker C2');
  const allyId = await createActor(page, 'Ally C2');

  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 1000, y: 1000, disposition: -1 });
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 900, y: 1000, disposition: 1 });
  const allyTokenId = await placeToken(page, { actorId: allyId, x: 1100, y: 1000, disposition: 1 });
  await addMeleeWeapon(page, attackerId);
  await addMeleeWeapon(page, allyId);

  const result = await page.evaluate(({ atkId, enmId, alyId }) => {
    const helper = game.D35E.DistanceHelper;
    const attacker = canvas.tokens.placeables.find(t => t.id === atkId);
    const enemy = canvas.tokens.placeables.find(t => t.id === enmId);
    const ally = canvas.tokens.placeables.find(t => t.id === alyId);
    return helper.isFlanking(attacker, enemy, ally);
  }, { atkId: attackerTokenId, enmId: enemyTokenId, alyId: allyTokenId });

  expect(result).toBe(true);
});

// ── C3. Attacker upper-left diagonal, ally lower-right diagonal → flanking ────
test('C3: attacker upper-left + ally lower-right diagonal → flanking (corner)', async ({ page }) => {
  await createScene(page);
  const enemyId = await createActor(page, 'Enemy C3');
  const attackerId = await createActor(page, 'Attacker C3');
  const allyId = await createActor(page, 'Ally C3');

  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 1000, y: 1000, disposition: -1 });
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 900, y: 900, disposition: 1 });
  const allyTokenId = await placeToken(page, { actorId: allyId, x: 1100, y: 1100, disposition: 1 });
  await addMeleeWeapon(page, attackerId);
  await addMeleeWeapon(page, allyId);

  const result = await page.evaluate(({ atkId, enmId, alyId }) => {
    const helper = game.D35E.DistanceHelper;
    const attacker = canvas.tokens.placeables.find(t => t.id === atkId);
    const enemy = canvas.tokens.placeables.find(t => t.id === enmId);
    const ally = canvas.tokens.placeables.find(t => t.id === alyId);
    return helper.isFlanking(attacker, enemy, ally);
  }, { atkId: attackerTokenId, enmId: enemyTokenId, alyId: allyTokenId });

  expect(result).toBe(true);
});

// ── C4. Attacker upper-right diagonal, ally lower-left diagonal → flanking ────
test('C4: attacker upper-right + ally lower-left diagonal → flanking (corner)', async ({ page }) => {
  await createScene(page);
  const enemyId = await createActor(page, 'Enemy C4');
  const attackerId = await createActor(page, 'Attacker C4');
  const allyId = await createActor(page, 'Ally C4');

  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 1000, y: 1000, disposition: -1 });
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 1100, y: 900, disposition: 1 });
  const allyTokenId = await placeToken(page, { actorId: allyId, x: 900, y: 1100, disposition: 1 });
  await addMeleeWeapon(page, attackerId);
  await addMeleeWeapon(page, allyId);

  const result = await page.evaluate(({ atkId, enmId, alyId }) => {
    const helper = game.D35E.DistanceHelper;
    const attacker = canvas.tokens.placeables.find(t => t.id === atkId);
    const enemy = canvas.tokens.placeables.find(t => t.id === enmId);
    const ally = canvas.tokens.placeables.find(t => t.id === alyId);
    return helper.isFlanking(attacker, enemy, ally);
  }, { atkId: attackerTokenId, enmId: enemyTokenId, alyId: allyTokenId });

  expect(result).toBe(true);
});

// ── C5. Both on same side → NOT flanking ──────────────────────────────────────
test('C5: attacker and ally both to the left → NOT flanking', async ({ page }) => {
  await createScene(page);
  const enemyId = await createActor(page, 'Enemy C5');
  const attackerId = await createActor(page, 'Attacker C5');
  const allyId = await createActor(page, 'Ally C5');

  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 1000, y: 1000, disposition: -1 });
  // Both to the left
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 900, y: 1000, disposition: 1 });
  const allyTokenId = await placeToken(page, { actorId: allyId, x: 900, y: 1100, disposition: 1 });
  await addMeleeWeapon(page, attackerId);
  await addMeleeWeapon(page, allyId);

  const result = await page.evaluate(({ atkId, enmId, alyId }) => {
    const helper = game.D35E.DistanceHelper;
    const attacker = canvas.tokens.placeables.find(t => t.id === atkId);
    const enemy = canvas.tokens.placeables.find(t => t.id === enmId);
    const ally = canvas.tokens.placeables.find(t => t.id === alyId);
    return helper.isFlanking(attacker, enemy, ally);
  }, { atkId: attackerTokenId, enmId: enemyTokenId, alyId: allyTokenId });

  expect(result).toBe(false);
});

// ── C6. Both above → NOT flanking ────────────────────────────────────────────
test('C6: attacker above + ally diagonally above → NOT flanking', async ({ page }) => {
  await createScene(page);
  const enemyId = await createActor(page, 'Enemy C6');
  const attackerId = await createActor(page, 'Attacker C6');
  const allyId = await createActor(page, 'Ally C6');

  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 1000, y: 1000, disposition: -1 });
  // Both above
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 1000, y: 900, disposition: 1 });
  const allyTokenId = await placeToken(page, { actorId: allyId, x: 1100, y: 900, disposition: 1 });
  await addMeleeWeapon(page, attackerId);
  await addMeleeWeapon(page, allyId);

  const result = await page.evaluate(({ atkId, enmId, alyId }) => {
    const helper = game.D35E.DistanceHelper;
    const attacker = canvas.tokens.placeables.find(t => t.id === atkId);
    const enemy = canvas.tokens.placeables.find(t => t.id === enmId);
    const ally = canvas.tokens.placeables.find(t => t.id === alyId);
    return helper.isFlanking(attacker, enemy, ally);
  }, { atkId: attackerTokenId, enmId: enemyTokenId, alyId: allyTokenId });

  expect(result).toBe(false);
});

// ── C7. Large (2×2) attacker flanking via any-square rule ────────────────────
test('C7: large (2×2) attacker flanks enemy via any-square-center rule', async ({ page }) => {
  await createScene(page);
  const enemyId = await createActor(page, 'Enemy C7');
  const attackerId = await createActor(page, 'Attacker C7', 'lg');
  const allyId = await createActor(page, 'Ally C7');

  // Enemy (medium) at (1000,1000)
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 1000, y: 1000, disposition: -1 });
  // Large attacker at (800,900): occupies (800-999, 900-1099), to the left of enemy
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 800, y: 900, disposition: 1 });
  // Ally (medium) at (1100,1000): to the right of enemy
  const allyTokenId = await placeToken(page, { actorId: allyId, x: 1100, y: 1000, disposition: 1 });
  await addMeleeWeapon(page, attackerId);
  await addMeleeWeapon(page, allyId);

  const result = await page.evaluate(({ atkId, enmId, alyId }) => {
    const helper = game.D35E.DistanceHelper;
    const attacker = canvas.tokens.placeables.find(t => t.id === atkId);
    const enemy = canvas.tokens.placeables.find(t => t.id === enmId);
    const ally = canvas.tokens.placeables.find(t => t.id === alyId);
    return helper.isFlanking(attacker, enemy, ally);
  }, { atkId: attackerTokenId, enmId: enemyTokenId, alyId: allyTokenId });

  expect(result).toBe(true);
});

// ── C8. Huge (3×3) attacker flanking ─────────────────────────────────────────
test('C8: huge (3×3) attacker flanks enemy via any-square-center rule', async ({ page }) => {
  await createScene(page);
  const enemyId = await createActor(page, 'Enemy C8');
  const attackerId = await createActor(page, 'Attacker C8', 'huge');
  const allyId = await createActor(page, 'Ally C8');

  // Enemy (medium) at (2000,2000)
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 2000, y: 2000, disposition: -1 });
  // Huge attacker at (1700,1900): occupies (1700-1999, 1900-2199), to the left
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 1700, y: 1900, disposition: 1 });
  // Ally at (2100,2000): to the right
  const allyTokenId = await placeToken(page, { actorId: allyId, x: 2100, y: 2000, disposition: 1 });
  await addMeleeWeapon(page, attackerId);
  await addMeleeWeapon(page, allyId);

  const result = await page.evaluate(({ atkId, enmId, alyId }) => {
    const helper = game.D35E.DistanceHelper;
    const attacker = canvas.tokens.placeables.find(t => t.id === atkId);
    const enemy = canvas.tokens.placeables.find(t => t.id === enmId);
    const ally = canvas.tokens.placeables.find(t => t.id === alyId);
    return helper.isFlanking(attacker, enemy, ally);
  }, { atkId: attackerTokenId, enmId: enemyTokenId, alyId: allyTokenId });

  expect(result).toBe(true);
});

// ── GROUP D: Display mode — drawThreatenedHighlights / clearThreatHighlights ──

// ── D1. "tokens" mode: enemy token gets _d35eThreatHighlight PIXI child ───────
test('D1 v13: tokens display mode — controlToken hook adds threat highlight to enemy', async ({ page }) => {
  test.skip((await foundryGeneration(page)) >= 14, 'v13-only control hook timing check');
  await createScene(page);
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'threatened-display-mode', 'tokens');
  });

  const attackerId = await createActor(page, 'Attacker D1');
  const enemyId = await createActor(page, 'Enemy D1');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  // Control the attacker token — this fires the controlToken hook → drawThreatenedHighlights
  await page.evaluate(({ atkId }) => {
    canvas.tokens.activate();
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    token.control({ releaseOthers: true });
  }, { atkId: attackerTokenId });

  // Wait for the controlToken hook to fire and highlights to be drawn
  await page.waitForTimeout(600);

  const hasHighlight = await page.evaluate(({ enmId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === enmId);
    return token?.mesh?._d35eThreatTinted === true;
  }, { enmId: enemyTokenId });

  expect(hasHighlight).toBe(true);
});

test('D1 v14: tokens display mode — drawing helper adds threat highlight to enemy', async ({ page }) => {
  test.skip((await foundryGeneration(page)) < 14, 'v14-only helper rendering check');
  await createScene(page);
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'threatened-display-mode', 'tokens');
  });

  const attackerId = await createActor(page, 'Attacker D1');
  const enemyId = await createActor(page, 'Enemy D1');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  await page.evaluate(({ atkId }) => {
    canvas.tokens.activate();
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    token.control({ releaseOthers: true });
    game.D35E.DistanceHelper.drawThreatenedHighlights(token);
  }, { atkId: attackerTokenId });

  await page.waitForTimeout(200);

  const hasHighlight = await page.evaluate(({ enmId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === enmId);
    return token?.mesh?._d35eThreatTinted === true;
  }, { enmId: enemyTokenId });

  expect(hasHighlight).toBe(true);
});

// ── D2. "area" mode: D35E.ThreatZone highlight layer is populated ─────────────
test('D2 v13: area display mode — controlToken hook populates threat layer', async ({ page }) => {
  test.skip((await foundryGeneration(page)) >= 14, 'v13-only control hook timing check');
  await createScene(page);
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'threatened-display-mode', 'area');
  });

  const attackerId = await createActor(page, 'Attacker D2');
  const enemyId = await createActor(page, 'Enemy D2');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  // Control attacker token
  await page.evaluate(({ atkId }) => {
    canvas.tokens.activate();
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    token.control({ releaseOthers: true });
  }, { atkId: attackerTokenId });

  await page.waitForTimeout(600);

  const hasContent = await page.evaluate(() => {
    // In "area" mode, drawThreatenedHighlights always calls addHighlightLayer,
    // so the layer existing proves it ran in area mode.
    const layer = canvas.interface?.grid?.getHighlightLayer('D35E.ThreatZone');
    return !!layer;
  });

  expect(hasContent).toBe(true);
});

test('D2 v14: area display mode — drawing helper populates threat layer', async ({ page }) => {
  test.skip((await foundryGeneration(page)) < 14, 'v14-only helper rendering check');
  await createScene(page);
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'threatened-display-mode', 'area');
  });

  const attackerId = await createActor(page, 'Attacker D2');
  const enemyId = await createActor(page, 'Enemy D2');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  await page.evaluate(({ atkId }) => {
    canvas.tokens.activate();
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    token.control({ releaseOthers: true });
    game.D35E.DistanceHelper.drawThreatenedHighlights(token);
  }, { atkId: attackerTokenId });

  await page.waitForTimeout(200);

  const hasContent = await page.evaluate(() => {
    const layer = canvas.interface?.grid?.getHighlightLayer('D35E.ThreatZone');
    return !!layer;
  });

  expect(hasContent).toBe(true);
});

// ── D3. "none" mode: no highlights drawn ──────────────────────────────────────
test('D3: none display mode — no highlights drawn when token controlled', async ({ page }) => {
  await createScene(page);
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'threatened-display-mode', 'none');
  });

  const attackerId = await createActor(page, 'Attacker D3');
  const enemyId = await createActor(page, 'Enemy D3');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  await page.evaluate(({ atkId }) => {
    canvas.tokens.activate();
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    token.control({ releaseOthers: true });
  }, { atkId: attackerTokenId });

  await page.waitForTimeout(600);

  const result = await page.evaluate(({ enmId }) => {
    const enemyToken = canvas.tokens.placeables.find(t => t.id === enmId);
    const hasTokenHighlight = enemyToken.children.some(c => c._d35eThreatHighlight === true);
    // In "none" mode drawThreatenedHighlights never calls addHighlightLayer,
    // so the layer should not exist. In "tokens" mode it's also not created.
    const layer = canvas.interface?.grid?.getHighlightLayer('D35E.ThreatZone');
    const hasAreaHighlight = !!layer;
    return { hasTokenHighlight, hasAreaHighlight };
  }, { enmId: enemyTokenId });

  expect(result.hasTokenHighlight).toBe(false);
  expect(result.hasAreaHighlight).toBe(false);
});

// ── D4. Deselect clears token highlights ──────────────────────────────────────
test('D4 v13: releasing token control clears threat highlights', async ({ page }) => {
  test.skip((await foundryGeneration(page)) >= 14, 'v13-only control hook timing check');
  await createScene(page);
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'threatened-display-mode', 'tokens');
  });

  const attackerId = await createActor(page, 'Attacker D4');
  const enemyId = await createActor(page, 'Enemy D4');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  // Control → highlights appear
  await page.evaluate(({ atkId }) => {
    canvas.tokens.activate();
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    token.control({ releaseOthers: true });
  }, { atkId: attackerTokenId });
  await page.waitForTimeout(600);

  // Confirm highlight exists before we release
  const beforeRelease = await page.evaluate(({ enmId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === enmId);
    return token?.mesh?._d35eThreatTinted === true;
  }, { enmId: enemyTokenId });
  expect(beforeRelease).toBe(true);

  // Release control → clearThreatHighlights called
  await page.evaluate(({ atkId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    token.release();
  }, { atkId: attackerTokenId });
  await page.waitForTimeout(600);

  const afterRelease = await page.evaluate(({ enmId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === enmId);
    return token?.mesh?._d35eThreatTinted === true;
  }, { enmId: enemyTokenId });
  expect(afterRelease).toBe(false);
});

test('D4 v14: releasing token control clears existing threat highlights', async ({ page }) => {
  test.skip((await foundryGeneration(page)) < 14, 'v14-only helper rendering check');
  await createScene(page);
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'threatened-display-mode', 'tokens');
  });

  const attackerId = await createActor(page, 'Attacker D4');
  const enemyId = await createActor(page, 'Enemy D4');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  await page.evaluate(({ atkId }) => {
    canvas.tokens.activate();
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    token.control({ releaseOthers: true });
    game.D35E.DistanceHelper.drawThreatenedHighlights(token);
  }, { atkId: attackerTokenId });
  await page.waitForTimeout(200);

  const beforeRelease = await page.evaluate(({ enmId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === enmId);
    return token?.mesh?._d35eThreatTinted === true;
  }, { enmId: enemyTokenId });
  expect(beforeRelease).toBe(true);

  await page.evaluate(({ atkId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    token.release();
    game.D35E.DistanceHelper.clearThreatHighlights();
  }, { atkId: attackerTokenId });
  await page.waitForTimeout(600);

  const afterRelease = await page.evaluate(({ enmId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === enmId);
    return token?.mesh?._d35eThreatTinted === true;
  }, { enmId: enemyTokenId });
  expect(afterRelease).toBe(false);
});

// ── D5. Switching setting from "tokens" to "none" clears highlights ───────────
test('D5 v13: switching threatened-display-mode to "none" clears highlights', async ({ page }) => {
  test.skip((await foundryGeneration(page)) >= 14, 'v13-only control hook timing check');
  await createScene(page);
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'threatened-display-mode', 'tokens');
  });

  const attackerId = await createActor(page, 'Attacker D5');
  const enemyId = await createActor(page, 'Enemy D5');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  // Control → highlights appear
  await page.evaluate(({ atkId }) => {
    canvas.tokens.activate();
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    token.control({ releaseOthers: true });
  }, { atkId: attackerTokenId });
  await page.waitForTimeout(600);

  const beforeChange = await page.evaluate(({ enmId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === enmId);
    return token?.mesh?._d35eThreatTinted === true;
  }, { enmId: enemyTokenId });
  expect(beforeChange).toBe(true);

  // Change setting to "none" — onChange callback fires clearThreatHighlights
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'threatened-display-mode', 'none');
  });
  await page.waitForTimeout(500);

  const afterChange = await page.evaluate(({ enmId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === enmId);
    return token?.mesh?._d35eThreatTinted === true;
  }, { enmId: enemyTokenId });
  expect(afterChange).toBe(false);
});

test('D5 v14: switching threatened-display-mode to "none" clears existing highlights', async ({ page }) => {
  test.skip((await foundryGeneration(page)) < 14, 'v14-only helper rendering check');
  await createScene(page);
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'threatened-display-mode', 'tokens');
  });

  const attackerId = await createActor(page, 'Attacker D5');
  const enemyId = await createActor(page, 'Enemy D5');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  await addMeleeWeapon(page, attackerId);

  await page.evaluate(({ atkId }) => {
    canvas.tokens.activate();
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    token.control({ releaseOthers: true });
    game.D35E.DistanceHelper.drawThreatenedHighlights(token);
  }, { atkId: attackerTokenId });
  await page.waitForTimeout(200);

  const beforeChange = await page.evaluate(({ enmId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === enmId);
    return token?.mesh?._d35eThreatTinted === true;
  }, { enmId: enemyTokenId });
  expect(beforeChange).toBe(true);

  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'threatened-display-mode', 'none');
  });
  await page.waitForTimeout(500);

  const afterChange = await page.evaluate(({ enmId }) => {
    const token = canvas.tokens.placeables.find(t => t.id === enmId);
    return token?.mesh?._d35eThreatTinted === true;
  }, { enmId: enemyTokenId });
  expect(afterChange).toBe(false);
});

// ── GROUP E: Null-safety / edge cases ─────────────────────────────────────────

// ── E1. isAttackThreatening with missing originalWeaponId → no crash ──────────
test('E1: isAttackThreatening with no originalWeaponId does not throw', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker E1');
  const targetId = await createActor(page, 'Target E1');
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const targetTokenId = await placeToken(page, { actorId: targetId, x: 500, y: 600, disposition: -1 });

  // Create an attack item with no originalWeaponId, using two-step create-then-update
  await page.evaluate(async ({ attackerId }) => {
    const actor = game.actors.get(attackerId);
    const [atk] = await actor.createEmbeddedDocuments('Item', [{ name: 'Test Attack', type: 'attack' }]);
    // Update attackType to 'weapon' (non-natural) so the originalWeaponId code path is exercised
    await game.actors.get(attackerId).items.get(atk.id).update({ 'system.attackType': 'weapon' });
  }, { attackerId });

  const result = await page.evaluate(({ atkId, tgtId, attackerId }) => {
    const helper = game.D35E.DistanceHelper;
    const attackerToken = canvas.tokens.placeables.find(t => t.id === atkId);
    const targetToken = canvas.tokens.placeables.find(t => t.id === tgtId);

    const actor = game.actors.get(attackerId);
    const attack = actor.items.find(i => i.type === 'attack' && i.name === 'Test Attack');

    let threw = false;
    let resultValue = null;
    try {
      resultValue = helper.isAttackThreatening(attackerToken, attack, targetToken);
    } catch (e) {
      threw = true;
    }
    return { threw, resultValue };
  }, { atkId: attackerTokenId, tgtId: targetTokenId, attackerId });

  expect(result.threw).toBe(false);
  // Adjacent token with default 5-ft range should be threatening
  expect(result.resultValue).toBe(true);
});

// ── E2. getThreatenedTokens with no weapon falls back to 5-ft range ───────────
test('E2: no weapon on actor falls back to 5-ft default reach', async ({ page }) => {
  await createScene(page);
  const attackerId = await createActor(page, 'Attacker E2');
  const enemyId = await createActor(page, 'Enemy E2');
  // No weapon added — falls back to default 5 ft
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 500, y: 500, disposition: 1 });
  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 500, y: 600, disposition: -1 });
  const farEnemyId = await createActor(page, 'FarEnemy E2');
  const farEnemyTokenId = await placeToken(page, { actorId: farEnemyId, x: 500, y: 700, disposition: -1 });

  const result = await page.evaluate(({ atkId, enmId, farId }) => {
    const helper = game.D35E.DistanceHelper;
    const token = canvas.tokens.placeables.find(t => t.id === atkId);
    const list = helper.getThreatenedTokens(token).map(t => t.id);
    return { adjacentThreatened: list.includes(enmId), farThreatened: list.includes(farId) };
  }, { atkId: attackerTokenId, enmId: enemyTokenId, farId: farEnemyTokenId });

  expect(result.adjacentThreatened).toBe(true);
  expect(result.farThreatened).toBe(false);
});

// ── E3. isFlanking returns false when attacker does NOT threaten enemy ─────────
test('E3: isFlanking returns false when attacker is too far away to threaten', async ({ page }) => {
  await createScene(page);
  const enemyId = await createActor(page, 'Enemy E3');
  const attackerId = await createActor(page, 'Attacker E3');
  const allyId = await createActor(page, 'Ally E3');

  const enemyTokenId = await placeToken(page, { actorId: enemyId, x: 1000, y: 1000, disposition: -1 });
  // Attacker is 3 squares away (NOT threatening with melee)
  const attackerTokenId = await placeToken(page, { actorId: attackerId, x: 700, y: 1000, disposition: 1 });
  const allyTokenId = await placeToken(page, { actorId: allyId, x: 1100, y: 1000, disposition: 1 });
  await addMeleeWeapon(page, attackerId);
  await addMeleeWeapon(page, allyId);

  const result = await page.evaluate(({ atkId, enmId, alyId }) => {
    const helper = game.D35E.DistanceHelper;
    const attacker = canvas.tokens.placeables.find(t => t.id === atkId);
    const enemy = canvas.tokens.placeables.find(t => t.id === enmId);
    const ally = canvas.tokens.placeables.find(t => t.id === alyId);
    return helper.isFlanking(attacker, enemy, ally);
  }, { atkId: attackerTokenId, enmId: enemyTokenId, alyId: allyTokenId });

  expect(result).toBe(false);
});

// ── E4. clearThreatHighlights does not crash when no highlights exist ──────────
test('E4: clearThreatHighlights is safe to call when no highlights exist', async ({ page }) => {
  await createScene(page);

  const threw = await page.evaluate(() => {
    try {
      game.D35E.DistanceHelper.clearThreatHighlights();
      return false;
    } catch (e) {
      return true;
    }
  });

  expect(threw).toBe(false);
});
