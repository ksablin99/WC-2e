'use strict';

/**
 * E2E senses tests — verify that feat items grant senses to their owning actor.
 *
 * Covers issue #1535: feats can directly grant senses (darkvision, blindsight,
 * tremorsense, truesight, low-light vision) without requiring a linked buff.
 *
 * Setup pattern:
 *   1. Create actor via Foundry JS API in page.evaluate()
 *   2. Add feat item(s) with senses fields set
 *   3. Read back actor.system.senses (the prepared/aggregated value)
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


// ── 1. Feat grants darkvision ─────────────────────────────────────────────────

test('feat with darkvision grants darkvision to actor', async ({ page }) => {
  const senses = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Darkvision Test Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    await actor.createEmbeddedDocuments('Item', [{
      name: 'Darkvision (Feat)',
      type: 'feat',
      system: {
        senses: { darkvision: 60, blindsight: 0, tremorsense: 0, truesight: 0, lowLight: false, lowLightMultiplier: 2 },
      },
    }]);

    // Re-fetch to get prepared data
    const fresh = game.actors.get(actor.id);
    return {
      darkvision: fresh.system.senses?.darkvision ?? null,
    };
  });

  expect(senses.darkvision).toBe(60);
});


// ── 2. Feat grants low-light vision ──────────────────────────────────────────

test('feat with lowLight grants low-light vision to actor', async ({ page }) => {
  const senses = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'LowLight Test Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    await actor.createEmbeddedDocuments('Item', [{
      name: 'Low-Light Vision (Feat)',
      type: 'feat',
      system: {
        senses: { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0, lowLight: true, lowLightMultiplier: 2 },
      },
    }]);

    const fresh = game.actors.get(actor.id);
    return {
      lowLight: fresh.system.senses?.lowLight ?? null,
    };
  });

  expect(senses.lowLight).toBe(true);
});


// ── 3. Multiple feats — highest darkvision wins ───────────────────────────────

test('actor with two darkvision feats gets the higher value', async ({ page }) => {
  const senses = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Multi-Darkvision Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    await actor.createEmbeddedDocuments('Item', [
      {
        name: 'Darkvision 30',
        type: 'feat',
        system: {
          senses: { darkvision: 30, blindsight: 0, tremorsense: 0, truesight: 0, lowLight: false, lowLightMultiplier: 2 },
        },
      },
      {
        name: 'Darkvision 60',
        type: 'feat',
        system: {
          senses: { darkvision: 60, blindsight: 0, tremorsense: 0, truesight: 0, lowLight: false, lowLightMultiplier: 2 },
        },
      },
    ]);

    const fresh = game.actors.get(actor.id);
    return {
      darkvision: fresh.system.senses?.darkvision ?? null,
    };
  });

  expect(senses.darkvision).toBe(60);
});


// ── 4. Feat with default (zero) senses does not inflate actor senses ──────────

test('feat with default senses does not change actor senses from base', async ({ page }) => {
  const senses = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'No-Senses Feat Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    await actor.createEmbeddedDocuments('Item', [{
      name: 'Toughness',
      type: 'feat',
      system: {
        senses: { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0, lowLight: false, lowLightMultiplier: 2 },
      },
    }]);

    const fresh = game.actors.get(actor.id);
    return {
      darkvision:   fresh.system.senses?.darkvision   ?? 0,
      blindsight:   fresh.system.senses?.blindsight   ?? 0,
      tremorsense:  fresh.system.senses?.tremorsense  ?? 0,
      truesight:    fresh.system.senses?.truesight    ?? 0,
      lowLight:     fresh.system.senses?.lowLight     ?? false,
    };
  });

  expect(senses.darkvision).toBe(0);
  expect(senses.blindsight).toBe(0);
  expect(senses.tremorsense).toBe(0);
  expect(senses.truesight).toBe(0);
  expect(senses.lowLight).toBe(false);
});


// ── 5. Feat grants blindsight, tremorsense, truesight ────────────────────────

test('feat grants blindsight tremorsense and truesight to actor', async ({ page }) => {
  const senses = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'All-Senses Actor',
      type: 'character',
      system: { abilities: { str: { value: 10 } } },
    });

    await actor.createEmbeddedDocuments('Item', [{
      name: 'Exotic Senses (Feat)',
      type: 'feat',
      system: {
        senses: { darkvision: 0, blindsight: 30, tremorsense: 15, truesight: 10, lowLight: false, lowLightMultiplier: 2 },
      },
    }]);

    const fresh = game.actors.get(actor.id);
    return {
      blindsight:  fresh.system.senses?.blindsight  ?? null,
      tremorsense: fresh.system.senses?.tremorsense ?? null,
      truesight:   fresh.system.senses?.truesight   ?? null,
    };
  });

  expect(senses.blindsight).toBe(30);
  expect(senses.tremorsense).toBe(15);
  expect(senses.truesight).toBe(10);
});

// ── 6. ActorUpdater syncs prototypeToken sight and detection modes ───────────

test('actor senses update syncs prototypeToken sight and detectionModes for new tokens', async ({ page }) => {
  const tokenData = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Prototype Token Senses Actor',
      type: 'character',
      system: {
        abilities: { str: { value: 10 } },
        attributes: {
          hp: { value: 10, max: 10 },
          senses: {
            darkvision: 0,
            blindsight: 0,
            tremorsense: 0,
            truesight: 0,
            lowLight: false,
            lowLightMultiplier: 2,
          },
        },
      },
    });

    await actor.update({
      'system.attributes.senses.darkvision': 60,
      'system.attributes.senses.blindsight': 30,
      'system.attributes.senses.tremorsense': 15,
      'system.attributes.senses.truesight': 10,
    });

    const fresh = game.actors.get(actor.id);
    const token = fresh.prototypeToken.toObject();
    const detectionModes = Array.isArray(token.detectionModes)
      ? token.detectionModes
      : Object.entries(token.detectionModes ?? {}).map(([id, mode]) => ({
          id,
          ...mode,
        }));
    return {
      sight: token.sight,
      detectionModes: detectionModes.map((mode) => ({
        id: mode.id,
        enabled: mode.enabled,
        range: mode.range,
      })),
    };
  });

  expect(tokenData.sight.range).toBe(60);
  expect(tokenData.sight.visionMode).toBe('darkvision');
  expect(tokenData.sight.enabled).toBe(true);
  expect(tokenData.detectionModes).toEqual(expect.arrayContaining([
    { id: 'lightPerception', enabled: true, range: null },
    { id: 'basicSight', enabled: true, range: 60 },
    { id: 'blindSight', enabled: true, range: 30 },
    { id: 'feelTremor', enabled: true, range: 15 },
    { id: 'seeInvisibility', enabled: true, range: 10 },
  ]));
});
