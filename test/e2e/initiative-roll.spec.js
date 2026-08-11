'use strict';

/**
 * E2E tests — clicking the initiative attribute link on the character sheet.
 *
 * Regression guards for issue #1658 (v12→v13 regressions in rollInitiative):
 *   - `t.document` accessor was broken (fix: `this.isToken ? t : t.document`)
 *   - combat.rollInitiative payload used wrong key
 *
 * The fix lives in module/actor/entity.js (commit 038841cc9).
 *
 * Test cases:
 *   1. Linked actor on canvas — clicking `.attribute.initiative .attribute-name`
 *      adds the token to the active combat tracker and rolls a numeric initiative.
 *   2. GM re-roll — clicking initiative when the actor is already in combat
 *      (with a sentinel initiative of 99) replaces it with a freshly-rolled value.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const SCENE_NAME = 'Initiative Roll E2E Scene';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a character actor (name + type only, then update abilities).
 * Returns the actor id.
 */
async function createBasicActor(page, name = 'Initiative Test Actor') {
  return page.evaluate(async (name) => {
    const actor = await Actor.create({ name, type: 'character' });
    await game.actors.get(actor.id).update({
      'system.abilities.dex.value': 14, // +2 mod → initiative bonus
    });
    return actor.id;
  }, name);
}

/**
 * Create a scene, place a linked token for the actor, make it active, and wait
 * for the canvas (including PIXI.UPDATE_PRIORITY.OBJECTS) to fully initialize.
 * Returns { sceneId, tokenId }.
 */
async function createSceneWithToken(page, actorId) {
  const result = await page.evaluate(async ({ actorId, sceneName }) => {
    const actor = game.actors.get(actorId);
    const scene = await Scene.create({
      name: sceneName,
      active: true,
      width: 1000,
      height: 1000,
      grid: { size: 100 },
    });
    const [tokenDoc] = await scene.createEmbeddedDocuments('Token', [{
      name: actor.name,
      actorId: actor.id,
      actorLink: true,
      x: 100,
      y: 100,
    }]);
    return { sceneId: scene.id, tokenId: tokenDoc.id };
  }, { actorId, sceneName: SCENE_NAME });

  // Wait for the canvas to fully initialize the new scene.
  // Canvas#_activateTicker() injects PIXI.UPDATE_PRIORITY.OBJECTS only when a
  // scene is rendered. canvas.ready alone may be true from a prior scene.
  await page.waitForFunction(
    (id) => canvas.ready && canvas.scene?.id === id && PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    result.sceneId,
    { timeout: 15_000 }
  );
  return result;
}

/**
 * Open the actor's character sheet via the Foundry JS API; return the sheet's
 * DOM element id so Playwright locators can be scoped to it.
 */
async function openActorSheet(page, actorId) {
  await dismissOverlays(page);
  const sheetId = await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    await actor.sheet.render(true);
    await new Promise(r => setTimeout(r, 600));
    return actor.sheet.id;
  }, actorId);
  await page.locator(`#${sheetId}`).waitFor({ state: 'visible', timeout: 10_000 });
  await dismissOverlays(page);
  return sheetId;
}

/**
 * Trigger a DOM click on the initiative attribute-name element inside the sheet.
 * The element lives in the "attributes" tab which may be inactive (hidden);
 * using element.click() in page.evaluate fires the registered event listener
 * regardless of CSS display state.
 */
async function clickInitiativeLink(page, sheetId) {
  await page.evaluate((sheetId) => {
    const el = document.querySelector(
      `#${sheetId} .attribute.initiative .attribute-name`
    );
    if (!el) throw new Error('Initiative attribute-name element not found in sheet');
    el.click();
  }, sheetId);
}

// ── 1. Clicking initiative link adds token to combat and rolls a numeric value ─
//
// Regression: before the fix, `this.getActiveTokens()` returned Token
// placeables and the code tried to read `t.id` instead of `t.document.id`,
// causing combatant creation to fail silently.  Also, `combat.rollInitiative`
// received a malformed payload, so initiative stayed null.

test('clicking initiative link on sheet adds linked token to combat with numeric initiative', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const actorId = await createBasicActor(page, 'Init Click Actor');
  const { sceneId } = await createSceneWithToken(page, actorId);

  // Ensure there is no existing combat so the GM path creates one automatically
  await page.evaluate(async () => {
    await Promise.all([...game.combats].map(c => c.delete()));
  });

  const sheetId = await openActorSheet(page, actorId);

  // Trigger the click on the initiative attribute name
  await clickInitiativeLink(page, sheetId);

  // Wait for game.combat to exist and for this actor to be a combatant with a
  // numeric initiative value (rollInitiative is async so we poll).
  await page.waitForFunction(
    (actorId) => {
      const combat = game.combat;
      if (!combat) return false;
      const combatant = combat.combatants.find(c => c.actor?.id === actorId);
      return combatant != null && typeof combatant.initiative === 'number';
    },
    actorId,
    { timeout: 10_000 }
  );

  const result = await page.evaluate((actorId) => {
    const combat = game.combat;
    const combatant = combat?.combatants.find(c => c.actor?.id === actorId);
    return {
      combatantExists: combatant != null,
      initiative: combatant?.initiative ?? null,
      sceneId: combat?.scene?.id ?? null,
    };
  }, actorId);

  expect(result.combatantExists).toBe(true);
  expect(typeof result.initiative).toBe('number');
  // DEX 14 → +2 mod; d20+2 gives [3, 22] (plus the small tiebreak fraction)
  expect(result.initiative).toBeGreaterThanOrEqual(3);
  expect(result.initiative).toBeLessThanOrEqual(23);
  expect(result.sceneId).toBe(sceneId);

  // No errors about missing _id, PIXI, or initiative
  const badErrors = consoleErrors.filter(e =>
    e.includes('_id') || e.includes('OBJECTS') || e.includes('initiative')
  );
  expect(badErrors).toHaveLength(0);
});

// ── 2. GM re-roll replaces the existing initiative value ──────────────────────
//
// When the GM (rerollInitiative: true) clicks the initiative link for an actor
// that is already in combat, the combatant's initiative is replaced with a
// freshly-rolled value.  We seed it with a sentinel (99) that no real d20+mod
// roll can produce, so we can detect the re-roll definitively.

test('GM clicking initiative link re-rolls an existing combatant initiative', async ({ page }) => {
  const SENTINEL_INITIATIVE = 99;

  const actorId = await createBasicActor(page, 'Init Reroll Actor');
  const { tokenId } = await createSceneWithToken(page, actorId);

  // Create a combat, add the token as a combatant, and set a sentinel initiative
  const { combatId, combatantId } = await page.evaluate(
    async ({ actorId, tokenId, sceneId, sentinel }) => {
      const scene  = canvas.scene;
      const combat = await Combat.create({ scene: scene.id, active: true });
      await combat.activate();
      const [combatant] = await combat.createEmbeddedDocuments('Combatant', [{
        tokenId,
        hidden: false,
      }]);
      // Seed a sentinel initiative value so we can confirm a re-roll happened
      await combat.updateEmbeddedDocuments('Combatant', [{
        _id: combatant.id,
        initiative: sentinel,
      }]);
      return { combatId: combat.id, combatantId: combatant.id };
    },
    { actorId, tokenId, sceneId: null /* derived inside */, sentinel: SENTINEL_INITIATIVE }
  );

  // Confirm the sentinel is in place
  const initialInit = await page.evaluate(({ combatId, combatantId }) => {
    return game.combats.get(combatId)?.combatants.get(combatantId)?.initiative ?? null;
  }, { combatId, combatantId });
  expect(initialInit).toBe(SENTINEL_INITIATIVE);

  // Open the sheet and click the initiative link (as GM → rerollInitiative: true)
  const sheetId = await openActorSheet(page, actorId);
  await clickInitiativeLink(page, sheetId);

  // Wait for the initiative to change away from the sentinel
  await page.waitForFunction(
    ({ combatId, combatantId, sentinel }) => {
      const c = game.combats.get(combatId)?.combatants.get(combatantId);
      return c != null && c.initiative !== sentinel && typeof c.initiative === 'number';
    },
    { combatId, combatantId, sentinel: SENTINEL_INITIATIVE },
    { timeout: 10_000 }
  );

  const result = await page.evaluate(({ combatId, combatantId }) => {
    const c = game.combats.get(combatId)?.combatants.get(combatantId);
    return { initiative: c?.initiative ?? null };
  }, { combatId, combatantId });

  expect(typeof result.initiative).toBe('number');
  expect(result.initiative).not.toBe(SENTINEL_INITIATIVE);
  // DEX 14 → +2 mod; d20+2+tiebreak → roughly [3.02, 22.02]
  expect(result.initiative).toBeGreaterThanOrEqual(3);
  expect(result.initiative).toBeLessThanOrEqual(23);
});
