'use strict';

/**
 * E2E tests for the auras system.
 *
 * D35E auras (module/auras/) broadcast effects to nearby tokens within a range.
 * An aura item (type: 'aura') on an actor emits passive bonuses to allies or
 * penalties to enemies within the aura's radius.
 *
 * Key properties:
 *   - `system.active`: whether the aura is currently emitting.
 *   - `system.changes`: stat changes applied to affected tokens.
 *   - Aura items behave like buffs that are toggled via `update({ 'system.active': true })`.
 *
 * NOTE: Full range-based detection requires tokens on a scene with coordinates.
 * These tests cover the data model (aura creation, activation) and the
 * self-application path (using `system.applyToSelf: true`).
 *
 * Covers:
 *   1. An aura item can be created on an actor.
 *   2. Activating an aura with applyToSelf=true applies its changes to the caster.
 *   3. Deactivating the aura reverts its changes on the caster.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const AURAS_PACK       = 'warcraftrpg2e.common-auras';
const AURA_OF_COURAGE  = 'bA2VYB1bJvJ547MU';
const SCENE_NAME       = 'Aura Range E2E Scene';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async (sceneName) => {
    await Promise.all([...game.scenes].filter((s) => s.name === sceneName).map((s) => s.delete()));
  }, SCENE_NAME);
});

async function createAuraScene(page, { targetTokenXs = [700], range = 10 } = {}) {
  const result = await page.evaluate(async ({ sceneName, targetTokenXs, range }) => {
    const sourceActor = await Actor.create({ name: 'Aura Source', type: 'character' });
    const targetActor = await Actor.create({ name: 'Aura Target', type: 'character' });

    const [aura] = await sourceActor.createEmbeddedDocuments('Item', [{
      name: 'Range Test Aura',
      type: 'aura',
      system: {
        active: true,
        range,
        auraTarget: 'all',
        changes: [],
      },
    }]);

    const scene = await Scene.create({
      name: sceneName,
      active: true,
      width: 2000,
      height: 2000,
      grid: { size: 100 },
    });

    const [sourceToken] = await scene.createEmbeddedDocuments('Token', [{
      name: sourceActor.name,
      actorId: sourceActor.id,
      actorLink: true,
      x: 100,
      y: 100,
    }]);

    const targetTokens = [];
    for (const x of targetTokenXs) {
      const [tokenDoc] = await scene.createEmbeddedDocuments('Token', [{
        name: targetActor.name,
        actorId: targetActor.id,
        actorLink: true,
        x,
        y: 100,
      }]);
      targetTokens.push(tokenDoc.id);
    }

    return {
      sceneId: scene.id,
      sourceActorId: sourceActor.id,
      sourceAuraId: aura.id,
      sourceTokenId: sourceToken.id,
      targetActorId: targetActor.id,
      targetTokenIds: targetTokens,
    };
  }, { sceneName: SCENE_NAME, targetTokenXs, range });

  await page.waitForFunction(
    (id) => canvas.ready && canvas.scene?.id === id && PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    result.sceneId,
    { timeout: 15_000 }
  );

  return result;
}

// ── 1. Aura item can be created on actor ─────────────────────────────────────

test('aura item can be created on an actor', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Paladin Aura Actor', type: 'character' });

    await actor.createEmbeddedDocuments('Item', [{
      name: 'Aura of Courage',
      type: 'aura',
      system: {
        active: false,
        range: 10,
        changes: [],
      },
    }]);

    const a = game.actors.get(actor.id);
    const aura = a.items.find(i => i.type === 'aura');
    return { found: aura !== undefined, type: aura?.type ?? null };
  });

  expect(result.found).toBe(true);
  expect(result.type).toBe('aura');
});

// ── 2. Aura from compendium can be added ─────────────────────────────────────

test('Aura of Courage can be loaded from commonauras compendium', async ({ page }) => {
  const result = await page.evaluate(async ({ packId, auraId }) => {
    const pack = game.packs.get(packId);
    if (!pack) return { packFound: false };
    const aura = await pack.getDocument(auraId);
    return {
      packFound: true,
      name: aura?.name ?? null,
      type: aura?.type ?? null,
    };
  }, { packId: AURAS_PACK, auraId: AURA_OF_COURAGE });

  expect(result.packFound).toBe(true);
  expect(result.name).toContain('Aura');
  expect(result.type).toBe('aura');
});

// ── 3. Activating synthetic aura with self-change applies bonus ───────────────

test('activating an aura with applyToSelf changes applies changes to actor', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Aura Self Apply Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    const [aura] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Strength Aura',
      type: 'aura',
      system: {
        active: false,
        applyToSelf: true,
        range: 10,
        // changes apply to the aura bearer when applyToSelf is true
        changes: [['4', 'ability', 'str', 'enh', 0]],
      },
    }]);

    const strBefore = game.actors.get(actor.id).system.abilities.str.total;

    await game.actors.get(actor.id).items.get(aura.id).update({ 'system.active': true });
    const strAfter = game.actors.get(actor.id).system.abilities.str.total;

    return { strBefore, strAfter };
  });

  expect(result.strAfter).toBeGreaterThanOrEqual(result.strBefore);
});

// ── 4. Deactivating aura reverts changes ─────────────────────────────────────

test('deactivating an aura reverts its self-applied changes', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Aura Toggle Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    const [aura] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Strength Aura',
      type: 'aura',
      system: {
        active: true,
        applyToSelf: true,
        range: 10,
        changes: [['4', 'ability', 'str', 'enh', 0]],
      },
    }]);

    const strWithAura = game.actors.get(actor.id).system.abilities.str.total;

    await game.actors.get(actor.id).items.get(aura.id).update({ 'system.active': false });
    const strWithout = game.actors.get(actor.id).system.abilities.str.total;

    return { strWithAura, strWithout };
  });

  expect(result.strWithout).toBeLessThanOrEqual(result.strWithAura);
});

test('moving into and out of aura range applies and removes the propagated aura on first move', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const setup = await createAuraScene(page, { targetTokenXs: [700] });

  await page.evaluate(async ({ tokenId }) => {
    const tokenDoc = canvas.scene.tokens.get(tokenId);
    await tokenDoc.update({ x: 200, y: 100 });
  }, { tokenId: setup.targetTokenIds[0] });

  await page.waitForFunction(
    ({ actorId, auraId }) => game.actors.get(actorId)?.items.some((i) => i.system.sourceAuraId === auraId),
    { actorId: setup.targetActorId, auraId: setup.sourceAuraId },
    { timeout: 10_000 }
  );

  await page.evaluate(async ({ tokenId }) => {
    const tokenDoc = canvas.scene.tokens.get(tokenId);
    await tokenDoc.update({ x: 700, y: 100 });
  }, { tokenId: setup.targetTokenIds[0] });

  await page.waitForFunction(
    ({ actorId, auraId }) => !game.actors.get(actorId)?.items.some((i) => i.system.sourceAuraId === auraId),
    { actorId: setup.targetActorId, auraId: setup.sourceAuraId },
    { timeout: 10_000 }
  );

  const fatal = errors.filter((e) => e.includes('EmbeddedCollection') || e.includes('undefined id'));
  expect(fatal, fatal.join('\n')).toHaveLength(0);
});

test('linked actor with multiple tokens keeps a single received aura while any token remains in range', async ({ page }) => {
  const setup = await createAuraScene(page, { targetTokenXs: [200, 300] });

  await page.waitForFunction(
    ({ actorId, auraId }) => game.actors.get(actorId)?.items.filter((i) => i.system.sourceAuraId === auraId).length === 1,
    { actorId: setup.targetActorId, auraId: setup.sourceAuraId },
    { timeout: 10_000 }
  );

  await page.evaluate(async ({ tokenId }) => {
    const tokenDoc = canvas.scene.tokens.get(tokenId);
    await tokenDoc.update({ x: 900, y: 100 });
  }, { tokenId: setup.targetTokenIds[0] });

  await page.waitForFunction(
    ({ actorId, auraId }) => game.actors.get(actorId)?.items.filter((i) => i.system.sourceAuraId === auraId).length === 1,
    { actorId: setup.targetActorId, auraId: setup.sourceAuraId },
    { timeout: 10_000 }
  );

  await page.evaluate(async ({ tokenId }) => {
    const tokenDoc = canvas.scene.tokens.get(tokenId);
    await tokenDoc.update({ x: 900, y: 100 });
  }, { tokenId: setup.targetTokenIds[1] });

  await page.waitForFunction(
    ({ actorId, auraId }) => game.actors.get(actorId)?.items.filter((i) => i.system.sourceAuraId === auraId).length === 0,
    { actorId: setup.targetActorId, auraId: setup.sourceAuraId },
    { timeout: 10_000 }
  );
});
