/**
 * E2E actor tests — drive Foundry's JS API directly via page.evaluate().
 * No UI interaction; assertions are on data returned from the engine.
 *
 * HP / create pipeline (GL#1523):
 *   - prepareData mirrors positive hp.base into hp.max when max is still 0
 *   - _onCreate persists derived stats via Actor.update / _updateChanges
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissSystemDialogs, dismissOverlays } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Basic actor creation ──────────────────────────────────────────────────────

test('creates a character actor', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Test Hero', type: 'character' });
    return { id: actor.id, name: actor.name, type: actor.type };
  });
  expect(result.name).toBe('Test Hero');
  expect(result.type).toBe('character');
  expect(result.id).toBeTruthy();
});

// ── Fighter BAB and attack bonus ──────────────────────────────────────────────

test('Fighter level 5 STR 16 → BAB 5, STR mod +3', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Test Fighter',
      type: 'character',
      system: { abilities: { str: { value: 16 } } },
    });

    await actor.createEmbeddedDocuments('Item', [
      {
        name: 'Fighter',
        type: 'class',
        system: { levels: 5, hd: 10, bab: 'high' },
      },
    ]);

    const a = game.actors.get(actor.id);
    return {
      bab:    a.system.attributes.bab.total,
      strMod: a.system.abilities.str.mod,
    };
  });

  expect(result.bab).toBe(5);
  expect(result.strMod).toBe(3);
});

// ── NPC actor ────────────────────────────────────────────────────────────────

test('creates an NPC actor', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Goblin', type: 'npc' });
    return { name: actor.name, type: actor.type };
  });
  expect(result.type).toBe('npc');
});

// ── HP ────────────────────────────────────────────────────────────────────────

test('actor HP can be set and read back', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Test HP Actor',
      type: 'character',
      system: { attributes: { hp: { value: 20, max: 20 } } },
    });
    return actor.system.attributes.hp.max;
  });
  expect(result).toBe(20);
});

test('GL#1523 hp.max mirrors hp.base on new character when max was default 0', async ({ page }) => {
  const hp = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'E2E HP Base→Max',
      type: 'character',
      system: {
        attributes: {
          hp: { base: 42, value: 42 },
        },
      },
    });
    const a = game.actors.get(actor.id);
    return { max: a.system.attributes.hp.max, base: a.system.attributes.hp.base };
  });
  expect(hp.base).toBe(42);
  expect(hp.max).toBe(42);
});

test('hp.max keeps explicit positive max when hp.base is unset (NaN coalesce path)', async ({
  page,
}) => {
  const hp = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'E2E HP Max Only',
      type: 'character',
      system: {
        attributes: {
          hp: { value: 8, max: 17, base: 0 },
        },
      },
    });
    const a = game.actors.get(actor.id);
    return { max: a.system.attributes.hp.max, base: a.system.attributes.hp.base };
  });
  expect(hp.max).toBe(17);
});

test('NPC hp.max mirrors hp.base when max starts at 0', async ({ page }) => {
  const hp = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'E2E NPC HP',
      type: 'npc',
      system: {
        attributes: { hp: { base: 33, value: 33, max: 0 } },
      },
    });
    const a = game.actors.get(actor.id);
    return { max: a.system.attributes.hp.max, base: a.system.attributes.hp.base };
  });
  expect(hp.base).toBe(33);
  expect(hp.max).toBe(33);
});
