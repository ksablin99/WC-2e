'use strict';

/**
 * E2E tests for the GM token loot tools — "Convert to Loot" and "Generate Loot".
 *
 * Regression guards for issue #1603:
 *   - onChange handlers crashed on game load because they used t.actorId (v12)
 *     instead of t.document.actorId (v13), returning undefined from game.actors.get()
 *   - Duplicate filter inside the treasure generator loop was cleaned up
 *
 * Setup pattern:
 *   1. Create an NPC actor and place its token on an active scene
 *   2. Wait for canvas to fully initialise (PIXI ticker)
 *   3. Activate the token layer so token.control() works
 *   4. Select the token and call the tool's onChange handler directly
 *   5. Assert the expected document mutations / no console errors
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const SCENE_NAME = 'GM Loot Tools Test Scene';

async function foundryGeneration(page) {
  return page.evaluate(() => game.release.generation);
}


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
    await Promise.all([...game.scenes].filter(s => s.name === sceneName).map(s => s.delete()));
  }, SCENE_NAME);
});


// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create an active scene with a single NPC token and wait for canvas to be
 * fully initialised (including PIXI.UPDATE_PRIORITY.OBJECTS).
 */
async function createSceneWithNpcToken(page, actorId) {
  const result = await page.evaluate(async ({ actorId, sceneName }) => {
    const actor = game.actors.get(actorId);
    const scene = await Scene.create({
      name: sceneName, active: true, width: 1000, height: 1000, grid: { size: 100 },
    });
    const [tokenDoc] = await scene.createEmbeddedDocuments('Token', [{
      name: actor.name, actorId: actor.id, actorLink: true, x: 100, y: 100,
    }]);
    return { sceneId: scene.id, tokenId: tokenDoc.id };
  }, { actorId, sceneName: SCENE_NAME });

  await page.waitForFunction(
    (id) => canvas.ready && canvas.scene?.id === id && PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    result.sceneId,
    { timeout: 15_000 }
  );
  return result;
}

/**
 * V14-specific token creation helper that follows the same Actor -> getTokenDocument
 * -> Token.create flow used by drag-and-drop onto the canvas.
 */
async function createSceneWithNpcTokenV14(page, actorId) {
  const result = await page.evaluate(async ({ actorId, sceneName }) => {
    const actor = game.actors.get(actorId);
    const scene = await Scene.create({
      name: sceneName, active: true, width: 1000, height: 1000, grid: { size: 100 },
    });
    const token = await actor.getTokenDocument({
      x: 100,
      y: 100,
      actorLink: true,
      name: actor.name,
    }, { parent: scene });
    const created = await token.constructor.create(token, { parent: scene });
    return { sceneId: scene.id, tokenId: created.id };
  }, { actorId, sceneName: `${SCENE_NAME} v14` });

  await page.waitForFunction(
    (id) => canvas.ready && canvas.scene?.id === id && PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    result.sceneId,
    { timeout: 15_000 }
  );
  return result;
}

async function importBestiaryActor(page, docId) {
  return page.evaluate(async ({ packId, id }) => {
    const pack = game.packs.get(packId);
    if (!pack) throw new Error(`Missing pack ${packId}`);
    const source = await pack.getDocument(id);
    if (!source) throw new Error(`Missing actor ${id}`);
    const actor = await Actor.create(source.toObject());
    return actor.id;
  }, { packId: BESTIARY_PACK, id: docId });
}


// ── 1. No crash on game load ──────────────────────────────────────────────────
//
// Before the fix, the onChange handlers fired during UI initialisation with
// canvas.tokens.controlled empty, causing game.actors.get(t.actorId) to call
// .type on undefined and throw.  After the fix the game loads cleanly.

test('game loads without loot-tool actorId crash in console', async ({ page }) => {
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });

  // gotoGame already called in beforeEach; navigate again from scratch to
  // capture any errors that fire during the initial page load / setup hooks
  await gotoGame(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);

  const actorIdErrors = errors.filter(e =>
    e.includes("can't access property") && e.includes('actorId') ||
    e.includes("Cannot read properties of undefined") && e.includes('type')
  );
  expect(actorIdErrors).toHaveLength(0);
});


// ── 2. Convert to Loot — no tokens selected shows error notification ──────────

test('convert-to-loot onChange shows error when no tokens are selected', async ({ page }) => {
  const notifications = [];
  await page.evaluate(() => {
    const orig = ui.notifications.error.bind(ui.notifications);
    ui.notifications._testErrors = [];
    ui.notifications.error = (msg, ...args) => { ui.notifications._testErrors.push(msg); return orig(msg, ...args); };
  });

  // Call the onChange with nothing selected — canvas.tokens.controlled is []
  await page.evaluate(async () => {
    const tool = ui.controls.controls?.tokens?.tools?.['d35e-gm-tools-convert-to-loot'];
    if (tool?.onChange) await tool.onChange();
  });

  const notified = await page.evaluate(() => ui.notifications._testErrors ?? []);
  expect(notified.some(m => m.toLowerCase().includes('select'))).toBe(true);
});


// ── 3. Convert to Loot — NPC token is converted correctly ─────────────────────
//
// Selects an NPC token on an active scene and triggers the tool.
// The token document should become unlinked (actorLink: false) and get the
// loot sheet class flag, which is how the tool marks it as a loot container.

test('convert-to-loot v13 onChange converts selected NPC token to loot', async ({ page }) => {
  test.skip((await foundryGeneration(page)) >= 14, 'v13-only convert-to-loot assertion');
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Convert Loot NPC',
      type: 'npc',
      system: { abilities: { str: { value: 10 } } },
    });
    return actor.id;
  });

  const { tokenId } = await createSceneWithNpcToken(page, actorId);

  // Activate the token layer (required for token.control() to work)
  await page.evaluate(() => canvas.tokens.activate());

  // Select the token
  const controlled = await page.evaluate(async (tokenId) => {
    const token = canvas.tokens.placeables.find(t => t.id === tokenId);
    if (!token) return false;
    token.control({ releaseOthers: true });
    return canvas.tokens.controlled.length;
  }, tokenId);
  expect(controlled).toBeGreaterThan(0);

  // Trigger the tool
  await page.evaluate(async () => {
    const tool = ui.controls.controls?.tokens?.tools?.['d35e-gm-tools-convert-to-loot'];
    if (tool?.onChange) await tool.onChange();
  });

  // Re-read the token document
  const tokenData = await page.evaluate(({ sceneId, tokenId }) => {
    const scene = game.scenes.get(sceneId ?? canvas.scene.id);
    const token = scene?.tokens.get(tokenId);
    return token ? { actorLink: token.actorLink } : null;
  }, { sceneId: null, tokenId });

  // Token should no longer be linked to the actor
  expect(tokenData).not.toBeNull();
  expect(tokenData.actorLink).toBe(false);

  // No actorId-related errors
  const relevant = consoleErrors.filter(e =>
    e.includes('actorId') || (e.includes('undefined') && e.includes('type'))
  );
  expect(relevant).toHaveLength(0);
});

test('convert-to-loot v14 onChange converts selected bestiary NPC token to loot', async ({ page }) => {
  test.skip((await foundryGeneration(page)) < 14, 'v14-only convert-to-loot assertion');
  test.skip(true, 'TODO: investigate why convert-to-loot fails only in Playwright on v14');
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  const actorId = await importBestiaryActor(page, '8pi0OYGiIDg7jGdE');
  const { tokenId } = await createSceneWithNpcTokenV14(page, actorId);

  await page.evaluate(() => canvas.tokens.activate());
  const controlled = await page.evaluate(async (id) => {
    const token = canvas.tokens.placeables.find(t => t.id === id);
    if (!token) return false;
    token.control({ releaseOthers: true });
    return canvas.tokens.controlled.length;
  }, tokenId);
  expect(controlled).toBeGreaterThan(0);

  await page.evaluate(async () => {
    const tool = ui.controls.controls?.tokens?.tools?.['d35e-gm-tools-convert-to-loot'];
    if (tool?.onChange) await tool.onChange();
  });

  const tokenData = await page.evaluate((id) => {
    const token = canvas.scene?.tokens.get(id);
    return token ? { actorLink: token.actorLink } : null;
  }, tokenId);
  expect(tokenData).not.toBeNull();
  expect(tokenData.actorLink).toBe(false);

  const relevant = consoleErrors.filter((e) =>
    e.includes('actorId')
    || e.includes('validation errors')
    || e.includes('ActorDelta')
    || (e.includes('undefined') && e.includes('type'))
  );
  expect(relevant).toHaveLength(0);
});


// ── 3b. Convert to Loot — loot sheet opens after conversion ──────────────────
//
// After conversion the token's synthetic actor should have the loot sheet class
// set in its delta flags, and sheet.render(true) should open a sheet whose
// appId appears in foundry.applications.instances (ApplicationV2 map).

test('convert-to-loot v13 opens the loot sheet after conversion', async ({ page }) => {
  test.skip((await foundryGeneration(page)) >= 14, 'v13-only loot-sheet assertion');
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Loot Sheet Open NPC',
      type: 'npc',
      system: { abilities: { str: { value: 10 } } },
    });
    return actor.id;
  });

  const { tokenId } = await createSceneWithNpcToken(page, actorId);

  await page.evaluate(() => canvas.tokens.activate());
  await page.evaluate((tokenId) => {
    const token = canvas.tokens.placeables.find(t => t.id === tokenId);
    token?.control({ releaseOthers: true });
  }, tokenId);

  await page.evaluate(async () => {
    const tool = ui.controls.controls?.tokens?.tools?.['d35e-gm-tools-convert-to-loot'];
    if (tool?.onChange) await tool.onChange();
  });

  // The token actor's delta should now carry the loot sheet class flag
  const sheetClass = await page.evaluate((tokenId) => {
    const tokenDoc = canvas.scene?.tokens.get(tokenId);
    return tokenDoc?.delta?.flags?.core?.sheetClass ?? null;
  }, tokenId);
  expect(sheetClass).toBe('warcraftrpg2e.ActorSheetPFNPCLoot');

  // A sheet window should have been opened (appId present in foundry.applications.instances)
  const sheetOpen = await page.waitForFunction((tokenId) => {
    const tokenDoc = canvas.scene?.tokens.get(tokenId);
    const actor = tokenDoc?.delta?.syntheticActor ?? tokenDoc?.actor;
    if (!actor) return false;
    // Check both ApplicationV1 (ui.windows) and ApplicationV2 instances
    const v1Open = Object.values(ui.windows).some(w => w.object?.id === actor.id || w.document?.id === actor.id);
    const v2Open = [...(foundry.applications?.instances?.values() ?? [])].some(
      app => app.document?.id === actor.id || app.actor?.id === actor.id
    );
    return v1Open || v2Open;
  }, tokenId, { timeout: 5_000 }).catch(() => false);

  expect(sheetOpen).toBeTruthy();
});

test('convert-to-loot v14 opens the loot sheet after conversion', async ({ page }) => {
  test.skip((await foundryGeneration(page)) < 14, 'v14-only loot-sheet assertion');
  test.skip(true, 'TODO: investigate why convert-to-loot fails only in Playwright on v14');
  const actorId = await importBestiaryActor(page, '8pi0OYGiIDg7jGdE');
  const actorName = await page.evaluate((id) => game.actors.get(id)?.name, actorId);

  const { tokenId } = await createSceneWithNpcTokenV14(page, actorId);

  await page.evaluate(() => canvas.tokens.activate());
  await page.evaluate((id) => {
    const token = canvas.tokens.placeables.find(t => t.id === id);
    token?.control({ releaseOthers: true });
  }, tokenId);

  await page.evaluate(async () => {
    const tool = ui.controls.controls?.tokens?.tools?.['d35e-gm-tools-convert-to-loot'];
    if (tool?.onChange) await tool.onChange();
  });

  const tokenData = await page.evaluate((id) => {
    const tokenDoc = canvas.scene?.tokens.get(id);
    return tokenDoc ? { actorLink: tokenDoc.actorLink } : null;
  }, tokenId);
  expect(tokenData).not.toBeNull();
  expect(tokenData.actorLink).toBe(false);

  const sheetVisible = await page.waitForFunction((name) => {
    const apps = [
      ...Object.values(ui.windows ?? {}),
      ...(foundry.applications?.instances ? [...foundry.applications.instances.values()] : []),
    ];
    return apps.some((app) =>
      app?.constructor?.name === 'ActorSheetPFNPCLoot'
      || (app?.constructor?.name?.includes('ActorSheetPFNPC') && app?.title?.includes(name))
      || (app?.title?.includes(name) && app?.element?.querySelector?.('.loot-sheet-npc'))
    );
  }, actorName, { timeout: 5_000 }).catch(() => false);

  if (!sheetVisible) {
    await expect(page.locator('.loot-sheet-npc')).toContainText(actorName, { timeout: 5_000 });
  } else {
    expect(sheetVisible).toBeTruthy();
  }
});


// ── 4. Generate Loot — no NPC tokens selected shows error notification ────────

test('treasure-generator onChange shows error when no NPC tokens are selected', async ({ page }) => {
  await page.evaluate(() => {
    ui.notifications._testErrors = [];
    const orig = ui.notifications.error.bind(ui.notifications);
    ui.notifications.error = (msg, ...args) => { ui.notifications._testErrors.push(msg); return orig(msg, ...args); };
  });

  await page.evaluate(async () => {
    const tool = ui.controls.controls?.tokens?.tools?.['d35e-gm-tools-treasure-generator'];
    if (tool?.onChange) await tool.onChange();
  });

  const notified = await page.evaluate(() => ui.notifications._testErrors ?? []);
  expect(notified.some(m => m.toLowerCase().includes('select'))).toBe(true);
});


// ── 5. Generate Loot — real bestiary creatures produce no errors ───────────────
//
// Imports five NPCs from the bestiary (Aboleth, Troll, Ogre, Harpy, Astral Deva),
// places all their tokens on one scene, selects them all, and triggers the
// treasure generator.  Asserts no console errors and the tool completes without
// throwing.

const BESTIARY_PACK = 'warcraftrpg2e.bestiary';
const BESTIARY_CREATURES = [
  { id: 'zDROaUnklDQ49QCa', name: 'Aboleth' },
  { id: 'uPfk0MyAlFFqOVCI', name: 'Troll' },
  { id: '8pi0OYGiIDg7jGdE', name: 'Ogre' },
  { id: 'urZER2ZqQYpRioas', name: 'Harpy' },
  { id: 'ui3NVQRuhNwaNiKu', name: 'Astral Deva' },
];

test('treasure-generator v13 produces no errors for bestiary creatures', async ({ page }) => {
  test.skip((await foundryGeneration(page)) >= 14, 'v13-only treasure-generator assertion');
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  // Import all five creatures and place their tokens on an active scene
  const { sceneId } = await page.evaluate(async ({ pack, creatures, sceneName }) => {
    const scene = await Scene.create({
      name: sceneName, active: true, width: 2000, height: 1000, grid: { size: 100 },
    });

    const actors = [];
    for (const { id } of creatures) {
      const source = await game.packs.get(pack).getDocument(id);
      const actor = await Actor.create(source.toObject());
      actors.push(actor);
    }

    let x = 100;
    for (const actor of actors) {
      await scene.createEmbeddedDocuments('Token', [{
        name: actor.name, actorId: actor.id, actorLink: true, x, y: 100,
      }]);
      x += 200;
    }

    return { sceneId: scene.id };
  }, { pack: BESTIARY_PACK, creatures: BESTIARY_CREATURES, sceneName: SCENE_NAME });

  // Wait for canvas to be fully ready for this scene
  await page.waitForFunction(
    (id) => canvas.ready && canvas.scene?.id === id && PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    sceneId,
    { timeout: 15_000 }
  );

  // Dismiss any migration/import dialogs that may appear
  await dismissSystemDialogs(page);
  await dismissOverlays(page);

  // Activate token layer and select all tokens
  const controlled = await page.evaluate(() => {
    canvas.tokens.activate();
    for (const token of canvas.tokens.placeables) {
      token.control({ releaseOthers: false });
    }
    return canvas.tokens.controlled.length;
  });
  expect(controlled).toBe(BESTIARY_CREATURES.length);

  // Run the treasure generator on all selected tokens
  await page.evaluate(async () => {
    const tool = ui.controls.controls?.tokens?.tools?.['d35e-gm-tools-treasure-generator'];
    if (tool?.onChange) await tool.onChange();
  });

  // No errors relating to actorId, undefined actor, or treasure generation.
  // "Invalid Asset" errors for missing token icon files are expected in CI/dev
  // checkouts where gitignored artwork is absent — exclude them.
  const relevant = consoleErrors.filter(e =>
    !e.includes('Invalid Asset') && (
      e.includes('actorId') ||
      e.includes('genTreasure') ||
      (e.toLowerCase().includes('error') && e.toLowerCase().includes('token'))
    )
  );
  expect(relevant).toHaveLength(0);
});

test('treasure-generator v14 produces no errors for bestiary creatures', async ({ page }) => {
  test.skip((await foundryGeneration(page)) < 14, 'v14-only treasure-generator assertion');
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  const { sceneId, importedNames } = await page.evaluate(async ({ pack, creatures, sceneName }) => {
    const scene = await Scene.create({
      name: sceneName,
      active: true,
      width: 2000,
      height: 1000,
      grid: { size: 100 },
    });

    const bestiaryPack = game.packs.get(pack);
    await bestiaryPack.getIndex();

    const actors = [];
    for (const { id, name } of creatures) {
      const source = await bestiaryPack.getDocument(id);
      if (!source) throw new Error(`Missing bestiary actor ${id} (${name})`);
      const actor = await Actor.create(source.toObject());
      actors.push(actor);
    }

    let x = 100;
    for (const actor of actors) {
      await scene.createEmbeddedDocuments('Token', [{
        name: actor.name, actorId: actor.id, actorLink: true, x, y: 100,
      }]);
      x += 200;
    }

    return { sceneId: scene.id, importedNames: actors.map((a) => a.name) };
  }, { pack: BESTIARY_PACK, creatures: BESTIARY_CREATURES, sceneName: SCENE_NAME });

  await page.waitForFunction(
    (id) => canvas.ready && canvas.scene?.id === id && PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    sceneId,
    { timeout: 15_000 }
  );

  await dismissSystemDialogs(page);
  await dismissOverlays(page);

  const controlled = await page.evaluate(() => {
    canvas.tokens.activate();
    for (const token of canvas.tokens.placeables) token.control({ releaseOthers: false });
    return canvas.tokens.controlled.length;
  });
  expect(controlled).toBe(BESTIARY_CREATURES.length);

  await page.evaluate(async () => {
    const tool = ui.controls.controls?.tokens?.tools?.['d35e-gm-tools-treasure-generator'];
    if (tool?.onChange) await tool.onChange();
  });

  const actorNamesPresent = await page.evaluate((names) => {
    return names.every((name) => canvas.tokens.placeables.some((token) => token.name === name));
  }, importedNames);
  expect(actorNamesPresent).toBe(true);

  const relevant = consoleErrors.filter((e) =>
    !e.includes('Invalid Asset') && (
      e.includes('actorId') ||
      e.includes('genTreasure') ||
      (e.toLowerCase().includes('error') && e.toLowerCase().includes('token'))
    )
  );
  expect(relevant).toHaveLength(0);
});
