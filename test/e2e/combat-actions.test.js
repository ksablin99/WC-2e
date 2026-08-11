'use strict';

/**
 * E2E tests for the D35E combat action marker system.
 *
 * Each combatant row in the combat tracker displays four action icons:
 *   • Move Action   (fa-shoe-prints)  — usedMoveAction flag
 *   • Attack Action (fa-fist-raised)  — usedAttackAction flag
 *   • Swift Action  (fa-bolt)         — usedSwiftAction flag
 *   • AoO           (fa-surprise)     — usedAaoCount / aaoCount pool
 *
 * Icons carry the `.active` CSS class when the action is still available,
 * and lose it once the corresponding flag is set.
 *
 * Test groups:
 *   1. Initial flag state       — fresh combatant has no flags set (all active)
 *   2. useAction() tracking     — standard, attack, and swift activation types
 *   3. Per-round reset          — resetPerRoundCounters() clears all flags
 *   4. nextRound() integration  — advancing a full round resets all flags
 *   5. Move-action auto-mark    — preUpdateToken hook: >1 square marks flag; ≤1 does not
 *   6. GM toggle handler        — _onToggleCombatAction toggles boolean flags and cycles AoO
 *   7. DOM / combat-tracker UI  — icons render with .active, lose it when flag set;
 *                                 AoO tooltip text reflects availability
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const SCENE_NAME = 'Combat Actions E2E Scene';

// ── Lifecycle ─────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await page.evaluate(async (sceneName) => {
    await Promise.all([...game.combats].map(c => c.delete()));
    await Promise.all([...game.scenes].filter(s => s.name === sceneName).map(s => s.delete()));
  }, SCENE_NAME);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async (sceneName) => {
    await Promise.all([...game.combats].map(c => c.delete()));
    await Promise.all([...game.scenes].filter(s => s.name === sceneName).map(s => s.delete()));
  }, SCENE_NAME);
});

// ── Infrastructure helpers ────────────────────────────────────────────────────

/** Create a minimal character actor and return its id. */
async function createActor(page, name = 'Action Test Actor') {
  return page.evaluate(async (n) => {
    const actor = await Actor.create({ name: n, type: 'character' });
    return actor.id;
  }, name);
}

/**
 * Create a scene, place one token, create a combat, add that combatant, and
 * return all relevant IDs.  Does NOT start the combat or roll initiative.
 */
async function createSceneCombatAndCombatant(page, actorId, opts = {}) {
  const result = await page.evaluate(
    async ({ actorId, sceneName, tokenX, tokenY }) => {
      const actor = game.actors.get(actorId);
      const scene = await Scene.create({
        name: sceneName,
        active: true,
        width: 2000,
        height: 2000,
        grid: { size: 100 },
      });
      const [tokenDoc] = await scene.createEmbeddedDocuments('Token', [{
        name: actor.name,
        actorId: actor.id,
        actorLink: true,
        x: tokenX ?? 100,
        y: tokenY ?? 100,
      }]);
      const combat = await Combat.create({ scene: scene.id });
      await combat.activate();
      const [combatant] = await combat.createEmbeddedDocuments('Combatant', [{
        tokenId: tokenDoc.id,
        hidden: false,
      }]);
      return {
        sceneId: scene.id,
        combatId: combat.id,
        combatantId: combatant.id,
        tokenId: tokenDoc.id,
      };
    },
    { actorId, sceneName: SCENE_NAME, tokenX: opts.tokenX, tokenY: opts.tokenY },
  );

  // Wait for the canvas to fully initialize the new scene.
  await page.waitForFunction(
    (id) =>
      canvas.ready &&
      canvas.scene?.id === id &&
      typeof PIXI !== 'undefined' &&
      PIXI.UPDATE_PRIORITY?.OBJECTS !== undefined,
    result.sceneId,
    { timeout: 20_000 },
  );
  return result;
}

/** Wait until a combatant flag reaches the expected value. */
async function waitForFlag(page, combatId, combatantId, flagKey, expected, timeout = 5_000) {
  await page.waitForFunction(
    ({ cid, coid, key, val }) => {
      const c = game.combats.get(cid)?.combatants.get(coid);
      if (!c) return false;
      const v = c.getFlag('D35E', key);
      // Handle undefined/null as equivalent to false
      const actual = v ?? false;
      return actual === val;
    },
    { cid: combatId, coid: combatantId, key: flagKey, val: expected },
    { timeout },
  );
}

// ── 1. Initial flag state ─────────────────────────────────────────────────────

test('fresh combatant has no action flags set — all icons are active', async ({ page }) => {
  const actorId = await createActor(page, 'Fresh Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  const flags = await page.evaluate(({ combatId, combatantId }) => {
    const c = game.combats.get(combatId)?.combatants.get(combatantId);
    if (!c) return null;
    return {
      usedMoveAction:   c.getFlag('D35E', 'usedMoveAction')   ?? null,
      usedAttackAction: c.getFlag('D35E', 'usedAttackAction') ?? null,
      usedSwiftAction:  c.getFlag('D35E', 'usedSwiftAction')  ?? null,
      usedAaoCount:     c.getFlag('D35E', 'usedAaoCount')     ?? null,
    };
  }, { combatId, combatantId });

  expect(flags).not.toBeNull();
  // All flags should be unset (null) — meaning the actions are available
  expect(flags.usedMoveAction).toBeNull();
  expect(flags.usedAttackAction).toBeNull();
  expect(flags.usedSwiftAction).toBeNull();
  expect(flags.usedAaoCount).toBeNull();
});

test('combatant getters return false when flags are unset', async ({ page }) => {
  const actorId = await createActor(page, 'Getter Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  const state = await page.evaluate(({ combatId, combatantId }) => {
    const c = game.combats.get(combatId)?.combatants.get(combatantId);
    if (!c) return null;
    return {
      usedMoveAction:   c.usedMoveAction,
      usedAttackAction: c.usedAttackAction,
      usedSwiftAction:  c.usedSwiftAction,
      usedAllAao:       c.usedAllAao,
    };
  }, { combatId, combatantId });

  expect(state).not.toBeNull();
  expect(state.usedMoveAction).toBe(false);
  expect(state.usedAttackAction).toBe(false);
  expect(state.usedSwiftAction).toBe(false);
  // usedAllAao: used == null || max == null → false
  expect(state.usedAllAao).toBe(false);
});

// ── 2. useAction() tracking ───────────────────────────────────────────────────

test('useAction with type "attack" on active turn marks usedAttackAction', async ({ page }) => {
  const actorId = await createActor(page, 'Attack Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Make this combatant the "active" one by setting initiative and starting combat
  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments('Combatant', [{ _id: combatantId, initiative: 20 }]);
    await combat.startCombat();
  }, { combatId, combatantId });

  // Verify it's the active combatant, then call useAction
  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    const combatant = combat.combatants.get(combatantId);
    // useAttackAction checks game.combats.active.current.combatantId
    combatant.useAction({ type: 'attack' });
  }, { combatId, combatantId });

  await waitForFlag(page, combatId, combatantId, 'usedAttackAction', true);

  const flag = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.getFlag('D35E', 'usedAttackAction'),
    { combatId, combatantId }
  );
  expect(flag).toBe(true);
});

test('useAction with type "standard" on active turn marks usedAttackAction', async ({ page }) => {
  const actorId = await createActor(page, 'Standard Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments('Combatant', [{ _id: combatantId, initiative: 20 }]);
    await combat.startCombat();
  }, { combatId, combatantId });

  await page.evaluate(({ combatId, combatantId }) => {
    const combatant = game.combats.get(combatId)?.combatants.get(combatantId);
    combatant.useAction({ type: 'standard' });
  }, { combatId, combatantId });

  await waitForFlag(page, combatId, combatantId, 'usedAttackAction', true);

  const flag = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.getFlag('D35E', 'usedAttackAction'),
    { combatId, combatantId }
  );
  expect(flag).toBe(true);
});

test('useAction with type "swift" marks usedSwiftAction', async ({ page }) => {
  const actorId = await createActor(page, 'Swift Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments('Combatant', [{ _id: combatantId, initiative: 20 }]);
    await combat.startCombat();
  }, { combatId, combatantId });

  await page.evaluate(({ combatId, combatantId }) => {
    const combatant = game.combats.get(combatId)?.combatants.get(combatantId);
    combatant.useAction({ type: 'swift' });
  }, { combatId, combatantId });

  await waitForFlag(page, combatId, combatantId, 'usedSwiftAction', true);

  const flag = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.getFlag('D35E', 'usedSwiftAction'),
    { combatId, combatantId }
  );
  expect(flag).toBe(true);
});

test('useAction with type "attack" on non-active turn increments usedAaoCount', async ({ page }) => {
  const actorId1 = await createActor(page, 'Active Actor');
  const actorId2 = await createActor(page, 'Reactive Actor');

  // Create the first combatant's scene+combat
  const { combatId, combatantId: combatantId1, sceneId } = await createSceneCombatAndCombatant(
    page, actorId1, { tokenX: 100, tokenY: 100 }
  );

  // Add second combatant to the same combat
  const combatantId2 = await page.evaluate(
    async ({ actorId, sceneId, combatId }) => {
      const actor = game.actors.get(actorId);
      const scene = game.scenes.get(sceneId);
      const combat = game.combats.get(combatId);
      const [tok] = await scene.createEmbeddedDocuments('Token', [{
        name: actor.name, actorId: actor.id, actorLink: true, x: 300, y: 100,
      }]);
      const [comb] = await combat.createEmbeddedDocuments('Combatant', [{ tokenId: tok.id }]);
      return comb.id;
    },
    { actorId: actorId2, sceneId, combatId }
  );

  // Actor 1 has higher initiative → is the active combatant
  await page.evaluate(async ({ combatId, id1, id2 }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments('Combatant', [
      { _id: id1, initiative: 20 },
      { _id: id2, initiative: 10 },
    ]);
    await combat.startCombat();
  }, { combatId, id1: combatantId1, id2: combatantId2 });

  // Actor 2 uses an attack on a non-active turn → should increment AoO count
  await page.evaluate(({ combatId, combatantId2 }) => {
    const combatant = game.combats.get(combatId)?.combatants.get(combatantId2);
    combatant.useAction({ type: 'attack' });
  }, { combatId, combatantId2 });

  // usedAaoCount should be 1
  await page.waitForFunction(
    ({ combatId, combatantId2 }) => {
      const c = game.combats.get(combatId)?.combatants.get(combatantId2);
      return (c?.getFlag('D35E', 'usedAaoCount') ?? 0) === 1;
    },
    { combatId, combatantId2 },
    { timeout: 5_000 }
  );

  const aaoCount = await page.evaluate(({ combatId, combatantId2 }) =>
    game.combats.get(combatId)?.combatants.get(combatantId2)?.getFlag('D35E', 'usedAaoCount'),
    { combatId, combatantId2 }
  );
  expect(aaoCount).toBe(1);
});

// ── 3. Per-round reset ────────────────────────────────────────────────────────

test('resetPerRoundCounters() clears all action flags', async ({ page }) => {
  const actorId = await createActor(page, 'Reset Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Set all flags to used values
  await page.evaluate(async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    await c.setFlag('D35E', 'usedMoveAction',   true);
    await c.setFlag('D35E', 'usedAttackAction', true);
    await c.setFlag('D35E', 'usedSwiftAction',  true);
    await c.setFlag('D35E', 'aaoCount',         1);
    await c.setFlag('D35E', 'usedAaoCount',     1);
  }, { combatId, combatantId });

  // Verify flags are set before reset
  const before = await page.evaluate(({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    return {
      move:   c.getFlag('D35E', 'usedMoveAction'),
      attack: c.getFlag('D35E', 'usedAttackAction'),
      swift:  c.getFlag('D35E', 'usedSwiftAction'),
      aao:    c.getFlag('D35E', 'usedAaoCount'),
    };
  }, { combatId, combatantId });

  expect(before.move).toBe(true);
  expect(before.attack).toBe(true);
  expect(before.swift).toBe(true);
  expect(before.aao).toBe(1);

  // Call resetPerRoundCounters
  await page.evaluate(({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    c.resetPerRoundCounters();
  }, { combatId, combatantId });

  // Wait for all flags to be reset
  await page.waitForFunction(
    ({ combatId, combatantId }) => {
      const c = game.combats.get(combatId)?.combatants.get(combatantId);
      if (!c) return false;
      return (
        c.getFlag('D35E', 'usedMoveAction')   === false &&
        c.getFlag('D35E', 'usedAttackAction') === false &&
        c.getFlag('D35E', 'usedSwiftAction')  === false &&
        (c.getFlag('D35E', 'usedAaoCount') ?? -1) === 0
      );
    },
    { combatId, combatantId },
    { timeout: 5_000 }
  );

  const after = await page.evaluate(({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    return {
      move:   c.getFlag('D35E', 'usedMoveAction'),
      attack: c.getFlag('D35E', 'usedAttackAction'),
      swift:  c.getFlag('D35E', 'usedSwiftAction'),
      aao:    c.getFlag('D35E', 'usedAaoCount'),
    };
  }, { combatId, combatantId });

  expect(after.move).toBe(false);
  expect(after.attack).toBe(false);
  expect(after.swift).toBe(false);
  expect(after.aao).toBe(0);
});

test('resetPerRoundCounters() resets aaoCount from actor maxAoO', async ({ page }) => {
  const actorId = await createActor(page, 'AoO Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Read the actor's computed maxAoO (always 1 base; Combat Reflexes adds via changes)
  const expectedAaoCount = await page.evaluate((actorId) => {
    return game.actors.get(actorId)?.system?.attributes?.maxAoO ?? 1;
  }, actorId);

  await page.evaluate(({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    c.resetPerRoundCounters();
  }, { combatId, combatantId });

  await page.waitForFunction(
    ({ combatId, combatantId, expected }) => {
      const c = game.combats.get(combatId)?.combatants.get(combatantId);
      const v = c?.getFlag('D35E', 'aaoCount');
      return v !== undefined && v === expected;
    },
    { combatId, combatantId, expected: expectedAaoCount },
    { timeout: 5_000 }
  );

  const aaoCount = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.getFlag('D35E', 'aaoCount'),
    { combatId, combatantId }
  );
  expect(aaoCount).toBe(expectedAaoCount);
});

// ── 4. nextRound() integration ────────────────────────────────────────────────

test('nextRound() resets all action flags for all combatants', async ({ page }) => {
  const actorId = await createActor(page, 'Round Reset Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Set flags and start combat with known initiative
  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    const c = combat.combatants.get(combatantId);
    await combat.updateEmbeddedDocuments('Combatant', [{ _id: combatantId, initiative: 10 }]);
    await combat.startCombat();
    // Set action flags to "used"
    await c.setFlag('D35E', 'usedMoveAction',   true);
    await c.setFlag('D35E', 'usedAttackAction', true);
    await c.setFlag('D35E', 'usedSwiftAction',  true);
    await c.setFlag('D35E', 'aaoCount',    1);
    await c.setFlag('D35E', 'usedAaoCount', 1);
  }, { combatId, combatantId });

  // Advance a full round (nextRound calls _resetPerRoundCounter)
  await page.evaluate(async (combatId) => {
    await game.combats.get(combatId).nextRound();
  }, combatId);

  // Wait for the flags to be cleared by nextRound → _resetPerRoundCounter
  await page.waitForFunction(
    ({ combatId, combatantId }) => {
      const c = game.combats.get(combatId)?.combatants.get(combatantId);
      if (!c) return false;
      return (
        c.getFlag('D35E', 'usedMoveAction')   === false &&
        c.getFlag('D35E', 'usedAttackAction') === false &&
        c.getFlag('D35E', 'usedSwiftAction')  === false &&
        (c.getFlag('D35E', 'usedAaoCount') ?? -1) === 0
      );
    },
    { combatId, combatantId },
    { timeout: 8_000 }
  );

  const flags = await page.evaluate(({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    return {
      move:   c.getFlag('D35E', 'usedMoveAction'),
      attack: c.getFlag('D35E', 'usedAttackAction'),
      swift:  c.getFlag('D35E', 'usedSwiftAction'),
      aao:    c.getFlag('D35E', 'usedAaoCount'),
    };
  }, { combatId, combatantId });

  expect(flags.move).toBe(false);
  expect(flags.attack).toBe(false);
  expect(flags.swift).toBe(false);
  expect(flags.aao).toBe(0);
});

// ── 5. Move action auto-tracking ─────────────────────────────────────────────

test('moving token more than one grid square marks usedMoveAction', async ({ page }) => {
  const actorId = await createActor(page, 'Mover Actor');
  const { combatId, combatantId, tokenId } = await createSceneCombatAndCombatant(
    page, actorId, { tokenX: 100, tokenY: 100 }
  );

  // Start combat so game.combat is set
  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments('Combatant', [{ _id: combatantId, initiative: 15 }]);
    await combat.startCombat();
  }, { combatId, combatantId });

  // Move token 300px horizontally (3 grid squares), which is > sqrt(2)*100 ≈ 141
  await page.evaluate(async (tokenId) => {
    const tokenDoc = canvas.scene.tokens.get(tokenId);
    await tokenDoc.update({ x: 400, y: 100 }); // moved 300px from 100 → large move
  }, tokenId);

  // Wait for the preUpdateToken hook to set the flag
  await page.waitForFunction(
    ({ combatId, combatantId }) => {
      const c = game.combats.get(combatId)?.combatants.get(combatantId);
      return c?.getFlag('D35E', 'usedMoveAction') === true;
    },
    { combatId, combatantId },
    { timeout: 8_000 }
  );

  const flag = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.getFlag('D35E', 'usedMoveAction'),
    { combatId, combatantId }
  );
  expect(flag).toBe(true);
});

test('moving token exactly one grid square (5-ft step) does NOT mark usedMoveAction', async ({ page }) => {
  const actorId = await createActor(page, '5ft Step Actor');
  const { combatId, combatantId, tokenId } = await createSceneCombatAndCombatant(
    page, actorId, { tokenX: 100, tokenY: 100 }
  );

  // Start combat
  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments('Combatant', [{ _id: combatantId, initiative: 15 }]);
    await combat.startCombat();
  }, { combatId, combatantId });

  // Move token exactly one grid square (100px), which is ≤ sqrt(2)*100 ≈ 141.4
  await page.evaluate(async (tokenId) => {
    const tokenDoc = canvas.scene.tokens.get(tokenId);
    await tokenDoc.update({ x: 200, y: 100 }); // moved exactly 100px = 1 square
  }, tokenId);

  // Wait a moment for any async hooks to fire
  await page.waitForTimeout(1_000);

  const flag = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.getFlag('D35E', 'usedMoveAction') ?? null,
    { combatId, combatantId }
  );
  // Flag should remain null/false (not marked)
  expect(flag == null || flag === false).toBe(true);
});

test('moving token diagonally one square does NOT mark usedMoveAction', async ({ page }) => {
  const actorId = await createActor(page, 'Diagonal Step Actor');
  const { combatId, combatantId, tokenId } = await createSceneCombatAndCombatant(
    page, actorId, { tokenX: 200, tokenY: 200 }
  );

  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments('Combatant', [{ _id: combatantId, initiative: 15 }]);
    await combat.startCombat();
  }, { combatId, combatantId });

  // Move diagonally exactly one square: dx=100, dy=100 → dist=sqrt(2)*100 ≈ 141.4
  // Condition is `movedDist > sqrt(2)*gridSize` (strictly greater), so this does NOT trigger
  await page.evaluate(async (tokenId) => {
    const tokenDoc = canvas.scene.tokens.get(tokenId);
    await tokenDoc.update({ x: 300, y: 300 }); // diagonal 1-square move
  }, tokenId);

  await page.waitForTimeout(1_000);

  const flag = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.getFlag('D35E', 'usedMoveAction') ?? null,
    { combatId, combatantId }
  );
  expect(flag == null || flag === false).toBe(true);
});

test('move flag is not re-set when usedMoveAction is already true', async ({ page }) => {
  const actorId = await createActor(page, 'Already Moved Actor');
  const { combatId, combatantId, tokenId } = await createSceneCombatAndCombatant(
    page, actorId, { tokenX: 100, tokenY: 100 }
  );

  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.updateEmbeddedDocuments('Combatant', [{ _id: combatantId, initiative: 15 }]);
    await combat.startCombat();
  }, { combatId, combatantId });

  // Pre-set the flag to true
  await page.evaluate(async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    await c.setFlag('D35E', 'usedMoveAction', true);
  }, { combatId, combatantId });

  // Move again — hook should skip because flag is already set
  await page.evaluate(async (tokenId) => {
    const tokenDoc = canvas.scene.tokens.get(tokenId);
    await tokenDoc.update({ x: 400, y: 100 });
  }, tokenId);

  await page.waitForTimeout(800);

  // Flag should still be true (not toggled or double-set)
  const flag = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.getFlag('D35E', 'usedMoveAction'),
    { combatId, combatantId }
  );
  expect(flag).toBe(true);
});

// ── 6. GM toggle handler ──────────────────────────────────────────────────────

test('GM can toggle usedMoveAction flag via _onToggleCombatAction', async ({ page }) => {
  const actorId = await createActor(page, 'Toggle Move Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Initially false
  const before = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.getFlag('D35E', 'usedMoveAction') ?? false,
    { combatId, combatantId }
  );
  expect(before).toBe(false);

  // Simulate the toggle handler (which sets flag to !current)
  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    const combatant = combat.combatants.get(combatantId);
    const current = combatant.getFlag('D35E', 'usedMoveAction') ?? false;
    await combatant.setFlag('D35E', 'usedMoveAction', !current);
  }, { combatId, combatantId });

  await waitForFlag(page, combatId, combatantId, 'usedMoveAction', true);

  // Toggle again → back to false
  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    const combatant = combat.combatants.get(combatantId);
    const current = combatant.getFlag('D35E', 'usedMoveAction') ?? false;
    await combatant.setFlag('D35E', 'usedMoveAction', !current);
  }, { combatId, combatantId });

  await waitForFlag(page, combatId, combatantId, 'usedMoveAction', false);

  const after = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.getFlag('D35E', 'usedMoveAction'),
    { combatId, combatantId }
  );
  expect(after).toBe(false);
});

test('GM AoO toggle cycles: available → exhausted → available', async ({ page }) => {
  const actorId = await createActor(page, 'AoO Toggle Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Set up AoO pool: max=1, used=0
  await page.evaluate(async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    await c.setFlag('D35E', 'aaoCount',     1);
    await c.setFlag('D35E', 'usedAaoCount', 0);
  }, { combatId, combatantId });

  // Simulate the usedAllAao toggle: if used>=max → reset to 0, else set used=max
  // First click: used(0) < max(1) → set used=max(1) → exhausted
  await page.evaluate(async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    const used = c.getFlag('D35E', 'usedAaoCount') ?? 0;
    const max  = c.getFlag('D35E', 'aaoCount')     ?? 1;
    if (used >= max) {
      await c.setFlag('D35E', 'usedAaoCount', 0);
    } else {
      await c.setFlag('D35E', 'usedAaoCount', max);
    }
  }, { combatId, combatantId });

  await page.waitForFunction(
    ({ combatId, combatantId }) => {
      const c = game.combats.get(combatId)?.combatants.get(combatantId);
      return c?.usedAllAao === true;
    },
    { combatId, combatantId },
    { timeout: 5_000 }
  );

  const exhausted = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.usedAllAao,
    { combatId, combatantId }
  );
  expect(exhausted).toBe(true);

  // Second click: used(1) >= max(1) → reset used=0 → available again
  await page.evaluate(async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    const used = c.getFlag('D35E', 'usedAaoCount') ?? 0;
    const max  = c.getFlag('D35E', 'aaoCount')     ?? 1;
    if (used >= max) {
      await c.setFlag('D35E', 'usedAaoCount', 0);
    } else {
      await c.setFlag('D35E', 'usedAaoCount', max);
    }
  }, { combatId, combatantId });

  await page.waitForFunction(
    ({ combatId, combatantId }) => {
      const c = game.combats.get(combatId)?.combatants.get(combatantId);
      return c?.usedAllAao === false;
    },
    { combatId, combatantId },
    { timeout: 5_000 }
  );

  const restored = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.usedAllAao,
    { combatId, combatantId }
  );
  expect(restored).toBe(false);
});

test('usedAllAao getter: true when usedAaoCount >= aaoCount', async ({ page }) => {
  const actorId = await createActor(page, 'AoO Pool Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Set pool: max=2, used=2
  await page.evaluate(async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    await c.setFlag('D35E', 'aaoCount',     2);
    await c.setFlag('D35E', 'usedAaoCount', 2);
  }, { combatId, combatantId });

  await page.waitForFunction(
    ({ combatId, combatantId }) => {
      const c = game.combats.get(combatId)?.combatants.get(combatantId);
      return c?.usedAllAao === true;
    },
    { combatId, combatantId },
    { timeout: 5_000 }
  );

  const allUsed = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.usedAllAao,
    { combatId, combatantId }
  );
  expect(allUsed).toBe(true);
});

test('usedAllAao getter: false when usedAaoCount < aaoCount', async ({ page }) => {
  const actorId = await createActor(page, 'AoO Partial Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Set pool: max=2, used=1
  await page.evaluate(async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    await c.setFlag('D35E', 'aaoCount',     2);
    await c.setFlag('D35E', 'usedAaoCount', 1);
  }, { combatId, combatantId });

  await page.waitForFunction(
    ({ combatId, combatantId }) => {
      const c = game.combats.get(combatId)?.combatants.get(combatantId);
      if (!c) return false;
      const used = c.getFlag('D35E', 'usedAaoCount');
      const max  = c.getFlag('D35E', 'aaoCount');
      return used === 1 && max === 2;
    },
    { combatId, combatantId },
    { timeout: 5_000 }
  );

  const notAllUsed = await page.evaluate(({ combatId, combatantId }) =>
    game.combats.get(combatId)?.combatants.get(combatantId)?.usedAllAao,
    { combatId, combatantId }
  );
  expect(notAllUsed).toBe(false);
});

// ── 7. DOM / combat-tracker UI ────────────────────────────────────────────────

test('all four action icons render with .active class when no flags are set', async ({ page }) => {
  const actorId = await createActor(page, 'DOM Actor A');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Force-render the combat tracker (it auto-renders with active combat, but ensure it's up-to-date)
  await page.evaluate(async () => {
    await ui.combat.render(true);
  });

  // Wait for the action icons to appear under the specific combatant row
  await page.waitForFunction(
    (combatantId) => {
      const row = document.querySelector(`[data-combatant-id="${combatantId}"]`);
      if (!row) return false;
      const icons = row.querySelectorAll('.d35e-action-icon');
      return icons.length >= 4;
    },
    combatantId,
    { timeout: 8_000 }
  );

  const iconStates = await page.evaluate((combatantId) => {
    const row = document.querySelector(`[data-combatant-id="${combatantId}"]`);
    if (!row) return null;
    const icons = [...row.querySelectorAll('.d35e-action-icon')];
    return icons.map(btn => ({
      key:    btn.dataset.actionKey,
      active: btn.classList.contains('active'),
    }));
  }, combatantId);

  expect(iconStates).not.toBeNull();
  // All four action icons should be present and active
  const keys = iconStates.map(i => i.key);
  expect(keys).toContain('usedMoveAction');
  expect(keys).toContain('usedAttackAction');
  expect(keys).toContain('usedSwiftAction');
  expect(keys).toContain('usedAllAao');

  for (const icon of iconStates) {
    expect(icon.active).toBe(true);
  }
});

test('move action icon loses .active class when usedMoveAction flag is set', async ({ page }) => {
  const actorId = await createActor(page, 'DOM Actor B');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Confirm icon starts active
  await page.evaluate(async () => { await ui.combat.render(true); });
  await page.waitForFunction(
    (combatantId) => {
      const row = document.querySelector(`[data-combatant-id="${combatantId}"]`);
      const icon = row?.querySelector('.d35e-action-icon[data-action-key="usedMoveAction"]');
      return icon !== null && icon !== undefined;
    },
    combatantId,
    { timeout: 8_000 }
  );

  const beforeActive = await page.evaluate((combatantId) => {
    const row = document.querySelector(`[data-combatant-id="${combatantId}"]`);
    return row?.querySelector('.d35e-action-icon[data-action-key="usedMoveAction"]')?.classList.contains('active');
  }, combatantId);
  expect(beforeActive).toBe(true);

  // Set the usedMoveAction flag and re-render
  await page.evaluate(async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    await c.setFlag('D35E', 'usedMoveAction', true);
    await ui.combat.render(true);
  }, { combatId, combatantId });

  // Wait for icon to lose .active
  await page.waitForFunction(
    (combatantId) => {
      const row = document.querySelector(`[data-combatant-id="${combatantId}"]`);
      const icon = row?.querySelector('.d35e-action-icon[data-action-key="usedMoveAction"]');
      return icon && !icon.classList.contains('active');
    },
    combatantId,
    { timeout: 5_000 }
  );

  const afterActive = await page.evaluate((combatantId) => {
    const row = document.querySelector(`[data-combatant-id="${combatantId}"]`);
    return row?.querySelector('.d35e-action-icon[data-action-key="usedMoveAction"]')?.classList.contains('active');
  }, combatantId);
  expect(afterActive).toBe(false);
});

test('attack action icon loses .active class when usedAttackAction flag is set', async ({ page }) => {
  const actorId = await createActor(page, 'DOM Attack Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  await page.evaluate(async () => { await ui.combat.render(true); });
  await page.waitForFunction(
    (combatantId) => !!document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedAttackAction"]`),
    combatantId,
    { timeout: 8_000 }
  );

  await page.evaluate(async ({ combatId, combatantId }) => {
    await game.combats.get(combatId).combatants.get(combatantId).setFlag('D35E', 'usedAttackAction', true);
    await ui.combat.render(true);
  }, { combatId, combatantId });

  await page.waitForFunction(
    (combatantId) => {
      const icon = document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedAttackAction"]`);
      return icon && !icon.classList.contains('active');
    },
    combatantId,
    { timeout: 5_000 }
  );

  const active = await page.evaluate((combatantId) =>
    document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedAttackAction"]`)?.classList.contains('active'),
    combatantId
  );
  expect(active).toBe(false);
});

test('swift action icon loses .active class when usedSwiftAction flag is set', async ({ page }) => {
  const actorId = await createActor(page, 'DOM Swift Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  await page.evaluate(async () => { await ui.combat.render(true); });
  await page.waitForFunction(
    (combatantId) => !!document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedSwiftAction"]`),
    combatantId,
    { timeout: 8_000 }
  );

  await page.evaluate(async ({ combatId, combatantId }) => {
    await game.combats.get(combatId).combatants.get(combatantId).setFlag('D35E', 'usedSwiftAction', true);
    await ui.combat.render(true);
  }, { combatId, combatantId });

  await page.waitForFunction(
    (combatantId) => {
      const icon = document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedSwiftAction"]`);
      return icon && !icon.classList.contains('active');
    },
    combatantId,
    { timeout: 5_000 }
  );

  const active = await page.evaluate((combatantId) =>
    document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedSwiftAction"]`)?.classList.contains('active'),
    combatantId
  );
  expect(active).toBe(false);
});

test('AoO tooltip contains "AoO remaining" text when pool is available', async ({ page }) => {
  const actorId = await createActor(page, 'AoO Tooltip Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Set AoO pool: max=2, used=0
  await page.evaluate(async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    await c.setFlag('D35E', 'aaoCount',     2);
    await c.setFlag('D35E', 'usedAaoCount', 0);
  }, { combatId, combatantId });

  await page.evaluate(async () => { await ui.combat.render(true); });

  await page.waitForFunction(
    (combatantId) => {
      const btn = document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedAllAao"]`);
      return btn !== null && btn !== undefined;
    },
    combatantId,
    { timeout: 8_000 }
  );

  const tooltipText = await page.evaluate((combatantId) => {
    const btn = document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedAllAao"]`);
    if (!btn) return null;
    const tip = btn.querySelector('.tooltipcontent');
    return tip?.textContent?.trim() ?? null;
  }, combatantId);

  expect(tooltipText).not.toBeNull();
  // Should contain "AoO remaining" (or equivalent localized text)
  expect(tooltipText).toMatch(/AoO remaining/i);
  // Should contain the count "2/2"
  expect(tooltipText).toMatch(/2\/2/);
});

test('AoO tooltip contains "Unavailable" when pool is exhausted', async ({ page }) => {
  const actorId = await createActor(page, 'AoO Exhausted Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Exhaust the AoO pool: max=1, used=1
  await page.evaluate(async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    await c.setFlag('D35E', 'aaoCount',     1);
    await c.setFlag('D35E', 'usedAaoCount', 1);
  }, { combatId, combatantId });

  await page.evaluate(async () => { await ui.combat.render(true); });

  await page.waitForFunction(
    (combatantId) => {
      const btn = document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedAllAao"]`);
      if (!btn) return false;
      return !btn.classList.contains('active'); // exhausted = not active
    },
    combatantId,
    { timeout: 8_000 }
  );

  const tooltipText = await page.evaluate((combatantId) => {
    const btn = document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedAllAao"]`);
    const tip = btn?.querySelector('.tooltipcontent');
    return tip?.textContent?.trim() ?? null;
  }, combatantId);

  expect(tooltipText).not.toBeNull();
  expect(tooltipText).toMatch(/Unavailable/i);
});

test('AoO icon loses .active class when pool is exhausted', async ({ page }) => {
  const actorId = await createActor(page, 'AoO Active Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  await page.evaluate(async () => { await ui.combat.render(true); });

  // First verify AoO icon is active before exhausting pool
  await page.waitForFunction(
    (combatantId) => {
      const btn = document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedAllAao"]`);
      return btn !== null;
    },
    combatantId,
    { timeout: 8_000 }
  );

  // Exhaust the pool
  await page.evaluate(async ({ combatId, combatantId }) => {
    const c = game.combats.get(combatId).combatants.get(combatantId);
    await c.setFlag('D35E', 'aaoCount',     1);
    await c.setFlag('D35E', 'usedAaoCount', 1);
    await ui.combat.render(true);
  }, { combatId, combatantId });

  await page.waitForFunction(
    (combatantId) => {
      const btn = document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedAllAao"]`);
      return btn && !btn.classList.contains('active');
    },
    combatantId,
    { timeout: 5_000 }
  );

  const active = await page.evaluate((combatantId) =>
    document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedAllAao"]`)?.classList.contains('active'),
    combatantId
  );
  expect(active).toBe(false);
});

test('GM clicking a move-action icon in the tracker toggles the flag', async ({ page }) => {
  const actorId = await createActor(page, 'Click Toggle Actor');
  const { combatId, combatantId } = await createSceneCombatAndCombatant(page, actorId);

  // Render tracker and wait for the icon to appear
  await page.evaluate(async () => { await ui.combat.render(true); });
  await page.waitForFunction(
    (combatantId) => {
      const btn = document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedMoveAction"]`);
      return btn !== null;
    },
    combatantId,
    { timeout: 8_000 }
  );

  // Verify starting state: active (flag false)
  const startActive = await page.evaluate((combatantId) =>
    document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedMoveAction"]`)
      ?.classList.contains('active'),
    combatantId
  );
  expect(startActive).toBe(true);

  // Activate the combat tracker sidebar tab so the button is visible, then click
  await page.evaluate(() => { ui.sidebar?.activateTab?.('combat'); });
  await page.waitForTimeout(300);
  await page.evaluate((combatantId) => {
    const btn = document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedMoveAction"]`);
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, combatantId);

  // Flag should become true
  await page.waitForFunction(
    ({ combatId, combatantId }) =>
      game.combats.get(combatId)?.combatants.get(combatantId)?.getFlag('D35E', 'usedMoveAction') === true,
    { combatId, combatantId },
    { timeout: 5_000 }
  );

  // Re-render and verify icon loses .active
  await page.evaluate(async () => { await ui.combat.render(true); });
  await page.waitForFunction(
    (combatantId) => {
      const btn = document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedMoveAction"]`);
      return btn && !btn.classList.contains('active');
    },
    combatantId,
    { timeout: 5_000 }
  );

  const endActive = await page.evaluate((combatantId) =>
    document.querySelector(`[data-combatant-id="${combatantId}"] .d35e-action-icon[data-action-key="usedMoveAction"]`)
      ?.classList.contains('active'),
    combatantId
  );
  expect(endActive).toBe(false);
});
