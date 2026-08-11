'use strict';

/**
 * E2E regression tests for Foundry v13+ status-effect APIs used by D35E (v14 prep).
 *
 * Covers paths that replaced deprecated Token#toggleEffect, label/icon status config,
 * and temporary Item construction — see GitLab #1645.
 *
 * 1. CONFIG.statusEffects D35E rows expose v13 `name` + `img` (HUD / fromStatusEffect).
 * 2. Actor#toggleStatusEffect can apply/remove core `dead` with overlay (no canvas).
 * 3. ActorPF update sets conditions.dead / banished flags (no token → no icon sync loop).
 * 4. With a linked token on the scene, dead update completes, adds ActiveEffects, and exercises
 *    prepareUpdateData token + toggleConditionStatusIcons paths.
 * 5. Temporary melee-shaped Item35E can be constructed with { parent, temporary }.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs, ensureCanvasReady } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

/**
 * Create an active scene with one linked token; wait only for canvas.ready + matching scene id
 * (do not require PIXI.UPDATE_PRIORITY — undefined in some headless timings).
 */
async function createSceneWithLinkedToken(page, actorId) {
  await page.waitForFunction((id) => !!game.actors.get(id), actorId, { timeout: 20_000 });

  const result = await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error(`actor ${actorId} missing`);
    const sceneName = `Token Status E2E ${foundry.utils.randomID()}`;
    const scene = await Scene.create({
      name: sceneName,
      active: true,
      width: 1000,
      height: 1000,
      grid: { size: 100 },
    });
    await scene.createEmbeddedDocuments('Token', [{
      name: actor.name,
      actorId: actor.id,
      actorLink: true,
      x: 100,
      y: 100,
    }]);
    return { sceneId: scene.id };
  }, { actorId });

  await page.waitForFunction(
    (id) => typeof canvas !== 'undefined' && canvas.ready && canvas.scene?.id === id,
    result.sceneId,
    { timeout: 30_000 },
  );
  return result;
}

// ── 1. CONFIG.statusEffects shape (v13 name/img) ────────────────────────────

test('CONFIG.statusEffects D35E-only banished entry uses name and img', async ({ page }) => {
  const ok = await page.evaluate(() => {
    const b = CONFIG.statusEffects.find((e) => e.id === 'banished');
    if (!b) return { ok: false, reason: 'missing banished' };
    if (typeof b.name !== 'string' || !b.name.length) return { ok: false, reason: 'bad name' };
    if (typeof b.img !== 'string' || !b.img.length) return { ok: false, reason: 'bad img' };
    return { ok: true };
  });
  expect(ok.ok, ok.reason).toBe(true);
});

// ── 2. Actor#toggleStatusEffect (dead + overlay) — no canvas required ─────────

test('Actor.toggleStatusEffect dead with overlay creates then removes status effect', async ({ page }) => {
  const afterOn = await page.evaluate(async () => {
    const hasStatus = (e, k) => e.statuses?.has(k) || e.getFlag('core', 'statusId') === k;
    const actor = await Actor.create({
      name: 'Status Toggle Actor',
      type: 'character',
      system: { attributes: { hp: { value: 10, max: 10 } } },
    });
    await actor.toggleStatusEffect('dead', { active: true, overlay: true });
    const effects = [...actor.effects];
    const deadFx = effects.filter((e) => hasStatus(e, 'dead'));
    const overlay = deadFx.some((e) => e.getFlag('core', 'overlay') === true);
    return { actorId: actor.id, count: deadFx.length, overlay };
  });

  expect(afterOn.count).toBeGreaterThanOrEqual(1);
  expect(afterOn.overlay).toBe(true);

  const afterOff = await page.evaluate(async (id) => {
    const hasStatus = (e, k) => e.statuses?.has(k) || e.getFlag('core', 'statusId') === k;
    const actor = game.actors.get(id);
    await actor.toggleStatusEffect('dead', { active: false, overlay: true });
    return [...actor.effects].filter((e) => hasStatus(e, 'dead')).length;
  }, afterOn.actorId);

  expect(afterOff).toBe(0);
});

// ── 3. ActorPF update (no token on canvas) ─────────────────────────────────────
//
// toggleConditionStatusIcons() only syncs ActiveEffects when it has at least one
// token in its loop; without a placed token, assert the condition flag only.

test('Actor update setting dead true sets dead condition flag', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const deadFlag = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Dead Condition Actor',
      type: 'character',
      system: {
        attributes: {
          hp: { value: 10, max: 10 },
          conditions: { dead: false },
        },
      },
    });
    await actor.update({ 'system.attributes.conditions.dead': true });
    return game.actors.get(actor.id).system.attributes.conditions.dead === true;
  });

  expect(deadFlag).toBe(true);
  const fatal = errors.filter((e) => e.includes('toggleEffect') || e.includes('Invalid status ID'));
  expect(fatal, fatal.join('\n')).toHaveLength(0);
});

test('Actor update setting banished true sets banished condition flag', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const banishedFlag = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Banished Condition Actor',
      type: 'character',
      system: {
        attributes: {
          hp: { value: 10, max: 10 },
          conditions: { banished: false },
        },
      },
    });
    await actor.update({ 'system.attributes.conditions.banished': true });
    return game.actors.get(actor.id).system.attributes.conditions.banished === true;
  });

  expect(banishedFlag).toBe(true);
  const fatal = errors.filter((e) => e.includes('toggleEffect') || e.includes('Invalid status ID'));
  expect(fatal, fatal.join('\n')).toHaveLength(0);
});

// ── 4. Token on canvas + dead update (ActorUpdater await toggleStatusEffect path) ──

test('Actor update setting dead true with linked token on canvas completes without error', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await ensureCanvasReady(page);

  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Dead Token Canvas Actor',
      type: 'character',
      system: {
        attributes: {
          hp: { value: 10, max: 10 },
          conditions: { dead: false },
        },
      },
    });
    return actor.id;
  });

  await createSceneWithLinkedToken(page, actorId);

  const deadEffects = await page.evaluate(async (id) => {
    const hasStatus = (e, k) => e.statuses?.has(k) || e.getFlag('core', 'statusId') === k;
    const actor = game.actors.get(id);
    await actor.update({ 'system.attributes.conditions.dead': true });
    return [...game.actors.get(id).effects].filter((e) => hasStatus(e, 'dead')).length;
  }, actorId);

  expect(deadEffects).toBeGreaterThanOrEqual(1);
  const fatal = errors.filter((e) => e.includes('toggleEffect') || e.includes('Invalid status ID'));
  expect(fatal, fatal.join('\n')).toHaveLength(0);
});

// ── 5. Temporary Item35E (replaces Document.create temporary) ───────────────

test('temporary Item35E melee-shaped data constructs with parent actor', async ({ page }) => {
  const ok = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Melee Item Actor', type: 'character' });
    const beforeCount = actor.items.size;
    const meleeAttack = {
      name: 'E2E Melee',
      img: '/icons/skills/melee/hand-grip-sword-red.webp',
      type: 'attack',
      system: {
        actionType: 'mwak',
        ability: { attack: 'str' },
        nonLethal: true,
        effectNotes: '',
      },
    };
    const item = new game.D35E.Item35E(meleeAttack, { parent: actor, temporary: true });
    return {
      ok:
        item.parent?.id === actor.id &&
        item.actor?.id === actor.id &&
        item.type === 'attack' &&
        item.name === 'E2E Melee' &&
        actor.items.size === beforeCount,
    };
  });
  expect(ok.ok).toBe(true);
});
