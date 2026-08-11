'use strict';

/**
 * E2E token light tests — verify that updateTokenLight() does not crash in
 * Foundry v13 and that token light values are actually applied.
 *
 * Covers issue #1602: updateTokenLight() crashed with
 *   TypeError: o.light is undefined
 * because v13 Token placeables expose light data on o.document.light, not o.light.
 * The fix reads: const tokenLight = o.document?.light ?? o.light;
 *
 * Two code paths exercise updateTokenLight():
 *   A. actor.isToken === false  — linked tokens returned by actor.getActiveTokens()
 *   B. actor.isToken === true   — unlinked tokens via actor.token
 *
 * We test path A (linked tokens on a scene) because that is the path reachable
 * without a synthetic actor context.  Both paths go through the same fixed line.
 *
 * What triggers the light update:
 *   actorUpdater.js reads system.light on equipped/active items and then calls
 *   actor.updateTokenLight() for every active linked token on the current scene.
 *   So we need:
 *     1. An actor with a placed, actorLink=true token on the active scene
 *     2. An item (equipment or buff) with system.light.emitLight = true and a
 *        non-zero radius, so the light values differ from the token defaults and
 *        the update is actually sent
 *     3. An actor update that triggers _updateChanges (e.g. adding/updating an item)
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const SCENE_NAME = 'Token Light E2E Scene';

// ── Lifecycle ──────────────────────────────────────────────────────────────────

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
    await Promise.all([...game.scenes].filter(s => s.name === sceneName).map(s => s.delete()));
  }, SCENE_NAME);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Create a character actor and place a linked token on a new active scene.
 * Waits for PIXI.UPDATE_PRIORITY.OBJECTS to be defined before returning.
 */
async function createActorWithToken(page, actorName = 'Light Test Actor') {
  const result = await page.evaluate(async ({ actorName, sceneName }) => {
    const actor = await Actor.create({
      name: actorName,
      type: 'character',
      system: { abilities: { str: { value: 10 }, dex: { value: 10 } } },
    });

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

    return { actorId: actor.id, sceneId: scene.id, tokenId: tokenDoc.id };
  }, { actorName, sceneName: SCENE_NAME });

  // Wait for the canvas to fully initialize the new scene.
  // Canvas#_activateTicker() injects PIXI.UPDATE_PRIORITY.OBJECTS only once a
  // scene is actually rendered; without this guard updateTokenLight() can run
  // before the canvas is ready and produce unrelated PIXI errors.
  await page.waitForFunction(
    (id) => canvas.ready && canvas.scene?.id === id && PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    result.sceneId,
    { timeout: 15_000 }
  );

  return result;
}

// ── 1. Equipped item with emitLight — no crash ─────────────────────────────────

test('equipped item with emitLight does not crash updateTokenLight', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const { actorId, tokenId } = await createActorWithToken(page, 'LightEquip Actor');

  // Add an equipment item with emitLight — items always land unequipped,
  // so equip it explicitly to trigger updateTokenLight via the equip hook.
  const itemId = await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    const [item] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Everburning Torch',
      type: 'equipment',
      system: {
        melded: false,
        light: {
          emitLight: true,
          radius: 20,
          dimRadius: 40,
          color: '#ffaa00',
          alpha: 0.5,
          lightAngle: 360,
          type: '',
          animationSpeed: '',
          animationIntensity: '',
        },
      },
    }]);
    return item.id;
  }, { actorId });

  // Now equip it — this fires D35E.ItemEquip.postEquipItem → updateTokenLight
  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    await actor.items.get(itemId).update({ 'system.equipped': true });
  }, { actorId, itemId });

  // Allow async Foundry updates to complete.
  await page.waitForTimeout(1500);

  // Filter for the specific error that the fix addresses.
  const lightErrors = consoleErrors.filter(e =>
    e.includes('o.light is undefined') ||
    e.includes('Cannot read properties of undefined') ||
    (e.includes('updateTokenLight') && e.includes('undefined'))
  );
  expect(lightErrors, 'No updateTokenLight crash errors should appear').toHaveLength(0);

  // Verify token light was actually updated to the item values.
  const tokenLight = await page.evaluate(({ tokenId, sceneId }) => {
    const scene = game.scenes.get(sceneId);
    const tokenDoc = scene?.tokens.get(tokenId);
    if (!tokenDoc) return null;
    return {
      dim: tokenDoc.light.dim,
      bright: tokenDoc.light.bright,
      color: tokenDoc.light.color,
    };
  }, { tokenId, sceneId: (await page.evaluate((name) => game.scenes.find(s => s.name === name)?.id, SCENE_NAME)) });

  // The token should have received light values from the item (radius=20 → bright=20, dimRadius=40 → dim=40).
  expect(tokenLight).not.toBeNull();
  expect(tokenLight.bright).toBe(20);
  expect(tokenLight.dim).toBe(40);
});

// ── 2. Active buff with emitLight — no crash ──────────────────────────────────

test('active buff with emitLight does not crash updateTokenLight', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const { actorId } = await createActorWithToken(page, 'LightBuff Actor');

  // Add an active buff that emits light.
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Dancing Lights Buff',
      type: 'buff',
      system: {
        active: true,
        light: {
          emitLight: true,
          radius: 10,
          dimRadius: 20,
          color: '#8888ff',
          alpha: 0.4,
          lightAngle: 360,
          type: '',
          animationSpeed: '',
          animationIntensity: '',
        },
      },
    }]);
  }, { actorId });

  await page.waitForTimeout(1500);

  const lightErrors = consoleErrors.filter(e =>
    e.includes('o.light is undefined') ||
    e.includes('Cannot read properties of undefined') ||
    (e.includes('updateTokenLight') && e.includes('undefined'))
  );
  expect(lightErrors, 'No updateTokenLight crash errors from buff').toHaveLength(0);
});

// ── 3. Inactive buff with emitLight — token light unchanged ───────────────────

test('inactive buff with emitLight does not update token light', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const { actorId, tokenId } = await createActorWithToken(page, 'InactiveBuff Actor');

  // Capture token light before adding the inactive buff.
  const sceneId = await page.evaluate(
    (name) => game.scenes.find(s => s.name === name)?.id,
    SCENE_NAME
  );

  const lightBefore = await page.evaluate(({ tokenId, sceneId }) => {
    const tokenDoc = game.scenes.get(sceneId)?.tokens.get(tokenId);
    return tokenDoc ? { dim: tokenDoc.light.dim, bright: tokenDoc.light.bright } : null;
  }, { tokenId, sceneId });

  // Add an inactive buff — should not contribute light.
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Inactive Glow Buff',
      type: 'buff',
      system: {
        active: false,
        light: {
          emitLight: true,
          radius: 30,
          dimRadius: 60,
          color: '#ff0000',
          alpha: 0.5,
          lightAngle: 360,
          type: '',
          animationSpeed: '',
          animationIntensity: '',
        },
      },
    }]);
  }, { actorId });

  // Give Foundry time to process any updates.
  await page.waitForTimeout(1000);

  // No crashes.
  const lightErrors = consoleErrors.filter(e =>
    e.includes('o.light is undefined') ||
    e.includes('Cannot read properties of undefined') ||
    (e.includes('updateTokenLight') && e.includes('undefined'))
  );
  expect(lightErrors).toHaveLength(0);

  // Token light should remain at defaults (dim=0, bright=0) since buff is inactive.
  const lightAfter = await page.evaluate(({ tokenId, sceneId }) => {
    const tokenDoc = game.scenes.get(sceneId)?.tokens.get(tokenId);
    return tokenDoc ? { dim: tokenDoc.light.dim, bright: tokenDoc.light.bright } : null;
  }, { tokenId, sceneId });

  expect(lightAfter).not.toBeNull();
  expect(lightAfter.dim).toBe(lightBefore?.dim ?? 0);
  expect(lightAfter.bright).toBe(lightBefore?.bright ?? 0);
});

// ── 4. Equipment with emitLight=false — token light unchanged ─────────────────

test('equipped item with emitLight=false does not update token light', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const { actorId, tokenId } = await createActorWithToken(page, 'NoLight Actor');

  const sceneId = await page.evaluate(
    (name) => game.scenes.find(s => s.name === name)?.id,
    SCENE_NAME
  );

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Normal Armor',
      type: 'equipment',
      system: {
        equipped: true,
        melded: false,
        light: {
          emitLight: false,
          radius: 0,
          dimRadius: 0,
          color: '',
          alpha: 0.5,
          lightAngle: 360,
          type: '',
          animationSpeed: '',
          animationIntensity: '',
        },
      },
    }]);
  }, { actorId });

  await page.waitForTimeout(1000);

  const lightErrors = consoleErrors.filter(e =>
    e.includes('o.light is undefined') ||
    e.includes('Cannot read properties of undefined') ||
    (e.includes('updateTokenLight') && e.includes('undefined'))
  );
  expect(lightErrors).toHaveLength(0);

  // Token light should remain at defaults.
  const tokenLight = await page.evaluate(({ tokenId, sceneId }) => {
    const tokenDoc = game.scenes.get(sceneId)?.tokens.get(tokenId);
    return tokenDoc ? { dim: tokenDoc.light.dim, bright: tokenDoc.light.bright } : null;
  }, { tokenId, sceneId });

  expect(tokenLight).not.toBeNull();
  expect(tokenLight.bright).toBe(0);
  expect(tokenLight.dim).toBe(0);
});

// ── 5. noLightOverride=true — token light never changed even with emitLight item ──

test('noLightOverride actor flag prevents updateTokenLight from running', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const { actorId, tokenId } = await createActorWithToken(page, 'NoOverride Actor');

  const sceneId = await page.evaluate(
    (name) => game.scenes.find(s => s.name === name)?.id,
    SCENE_NAME
  );

  // Capture token light defaults before doing anything.
  const lightBefore = await page.evaluate(({ tokenId, sceneId }) => {
    const tokenDoc = game.scenes.get(sceneId)?.tokens.get(tokenId);
    return tokenDoc ? { dim: tokenDoc.light.dim, bright: tokenDoc.light.bright } : null;
  }, { tokenId, sceneId });

  // Set noLightOverride = true on the actor, then add an equipped emitLight item.
  // The guard in actorUpdater.js should prevent updateTokenLight from being called.
  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);

    // Enable the "do not override token light" flag.
    await actor.update({ 'system.noLightOverride': true });

    // Add an equipped item that would normally cause a light update.
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Lantern of Override',
      type: 'equipment',
      system: {
        equipped: true,
        melded: false,
        light: {
          emitLight: true,
          radius: 30,
          dimRadius: 60,
          color: '#ffff00',
          alpha: 0.6,
          lightAngle: 360,
          type: '',
          animationSpeed: '',
          animationIntensity: '',
        },
      },
    }]);
  }, { actorId });

  // Allow async Foundry updates to settle.
  await page.waitForTimeout(1500);

  // No JS errors should have been thrown.
  const lightErrors = consoleErrors.filter(e =>
    e.includes('o.light is undefined') ||
    e.includes('Cannot read properties of undefined') ||
    (e.includes('updateTokenLight') && e.includes('undefined'))
  );
  expect(lightErrors, 'No updateTokenLight crash errors should appear').toHaveLength(0);

  // Token light must remain at defaults — updateTokenLight was skipped.
  const lightAfter = await page.evaluate(({ tokenId, sceneId }) => {
    const tokenDoc = game.scenes.get(sceneId)?.tokens.get(tokenId);
    return tokenDoc ? { dim: tokenDoc.light.dim, bright: tokenDoc.light.bright } : null;
  }, { tokenId, sceneId });

  expect(lightAfter).not.toBeNull();
  expect(lightAfter.dim).toBe(lightBefore?.dim ?? 0);
  expect(lightAfter.bright).toBe(lightBefore?.bright ?? 0);
});
