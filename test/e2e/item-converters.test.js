'use strict';

/**
 * E2E tests for item converter functions.
 *
 * Tests cover:
 *   - Actor35E.createConsumableSpell: spell → consumable via the actor method
 *     (exercises ItemConsumableConverter.toConsumable end-to-end)
 *   - Item35E.toAttack: spell → attack item (static method)
 *   - Item35E.toTrait: spell → trait/feat item (static method)
 *
 * Regressions fixed:
 *   - v12 `getProperty(origData, "data.xxx")` paths → direct `origData.system.xxx` access
 *   - `data: data` in constructed item object → `system: data` (v13)
 *   - Undefined `system` variable (ReferenceError) in toAttack/toTrait
 *   - `origdata` (lowercase d) typos in toAttack/toTrait
 *   - jQuery html arg in createConsumableSpell → native DOM unwrap guard
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissSystemDialogs, dismissOverlays } = require('./helpers');

// Known stable spell IDs
const SPELL_MAGIC_MISSILE_ID = 'POLwho3lpuKuCo6q'; // warcraftrpg2e.spells — "Magic Missile" (1st level)
const SPELL_FIREBALL_ID      = 'D1KgQc1fRyoNPNwY'; // warcraftrpg2e.spells — "Fireball" (3rd level, has damage parts)

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── createConsumableSpell / ItemConsumableConverter.toConsumable ───────────────

for (const consumableType of ['wand', 'potion', 'scroll', 'dorje', 'tattoo', 'powerstone']) {
  test(`createConsumableSpell: spell → ${consumableType} is created on actor`, async ({ page }) => {
    const result = await page.evaluate(async ({ spellId, type }) => {
      try {
        const pack = game.packs.get('warcraftrpg2e.spells');
        await pack.getIndex();
        const doc = await pack.getDocument(spellId);
        if (!doc) return { ok: false, error: 'spell not found in pack' };
        const itemData = doc.toObject();

        const actor = await Actor.create({ name: `Converter Test (${type})`, type: 'character' });

        // Simulate the native DOM element the dialog callback passes
        const fakeRoot = document.createElement('div');
        fakeRoot.innerHTML = `
          <input name="caster-level" value="5" />
          <select name="scroll-type">
            <option value="arcane" selected>Arcane</option>
          </select>
        `;

        await actor.createConsumableSpell(itemData, type, fakeRoot);

        const item = actor.items.find(i => i.type === 'consumable');
        if (!item) return { ok: false, error: 'no consumable item found on actor' };
        if (item.system.consumableType !== type) {
          return { ok: false, error: `consumableType mismatch: expected ${type}, got ${item.system.consumableType}` };
        }

        return { ok: true, name: item.name, consumableType: item.system.consumableType };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, { spellId: SPELL_MAGIC_MISSILE_ID, type: consumableType });

    expect(result.ok, result.error ?? '').toBe(true);
    expect(result.name).toBeTruthy();
    expect(result.consumableType).toBe(consumableType);
  });
}

test('createConsumableSpell: wand has 50 charges', async ({ page }) => {
  const result = await page.evaluate(async (spellId) => {
    try {
      const pack = game.packs.get('warcraftrpg2e.spells');
      await pack.getIndex();
      const doc = await pack.getDocument(spellId);
      const itemData = doc.toObject();

      const actor = await Actor.create({ name: 'Wand Charge Test', type: 'character' });
      const fakeRoot = document.createElement('div');
      fakeRoot.innerHTML = '<input name="caster-level" value="1" /><select name="scroll-type"><option value="arcane" selected>Arcane</option></select>';
      await actor.createConsumableSpell(itemData, 'wand', fakeRoot);

      const item = actor.items.find(i => i.type === 'consumable');
      return { ok: true, uses: item?.system?.uses };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, SPELL_MAGIC_MISSILE_ID);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.uses.value).toBe(50);
  expect(result.uses.max).toBe(50);
  expect(result.uses.per).toBe('charges');
});

test('createConsumableSpell: potion has single use', async ({ page }) => {
  const result = await page.evaluate(async (spellId) => {
    try {
      const pack = game.packs.get('warcraftrpg2e.spells');
      await pack.getIndex();
      const doc = await pack.getDocument(spellId);
      const itemData = doc.toObject();

      const actor = await Actor.create({ name: 'Potion Use Test', type: 'character' });
      const fakeRoot = document.createElement('div');
      fakeRoot.innerHTML = '<input name="caster-level" value="1" /><select name="scroll-type"><option value="arcane" selected>Arcane</option></select>';
      await actor.createConsumableSpell(itemData, 'potion', fakeRoot);

      const item = actor.items.find(i => i.type === 'consumable');
      return { ok: true, uses: item?.system?.uses };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, SPELL_MAGIC_MISSILE_ID);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.uses.per).toBe('single');
});

test('createConsumableSpell: custom CL is applied to wand', async ({ page }) => {
  const result = await page.evaluate(async (spellId) => {
    try {
      const pack = game.packs.get('warcraftrpg2e.spells');
      await pack.getIndex();
      const doc = await pack.getDocument(spellId);
      const itemData = doc.toObject();

      const actor = await Actor.create({ name: 'CL Test', type: 'character' });
      const fakeRoot = document.createElement('div');
      fakeRoot.innerHTML = '<input name="caster-level" value="10" /><select name="scroll-type"><option value="arcane" selected>Arcane</option></select>';
      await actor.createConsumableSpell(itemData, 'wand', fakeRoot);

      const item = actor.items.find(i => i.type === 'consumable');
      return { ok: true, baseCl: item?.system?.baseCl };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, SPELL_MAGIC_MISSILE_ID);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.baseCl).toBe('10');
});

test('createConsumableSpell: Fireball (damage parts) converts without error', async ({ page }) => {
  const result = await page.evaluate(async (spellId) => {
    try {
      const pack = game.packs.get('warcraftrpg2e.spells');
      await pack.getIndex();
      const doc = await pack.getDocument(spellId);
      const itemData = doc.toObject();

      const actor = await Actor.create({ name: 'Fireball Scroll Test', type: 'character' });
      const fakeRoot = document.createElement('div');
      fakeRoot.innerHTML = '<input name="caster-level" value="5" /><select name="scroll-type"><option value="arcane" selected>Arcane</option></select>';
      await actor.createConsumableSpell(itemData, 'scroll', fakeRoot);

      const item = actor.items.find(i => i.type === 'consumable');
      return { ok: true, name: item?.name };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, SPELL_FIREBALL_ID);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.name).toContain('Fireball');
});

test('createConsumableSpell: works with jQuery-wrapped html (legacy path)', async ({ page }) => {
  const result = await page.evaluate(async (spellId) => {
    try {
      const pack = game.packs.get('warcraftrpg2e.spells');
      await pack.getIndex();
      const doc = await pack.getDocument(spellId);
      const itemData = doc.toObject();

      const actor = await Actor.create({ name: 'jQuery HTML Test', type: 'character' });

      // Simulate jQuery-wrapped html: array-like with [0] = native element, no .nodeType
      const nativeEl = document.createElement('div');
      nativeEl.innerHTML = '<input name="caster-level" value="3" /><select name="scroll-type"><option value="divine" selected>Divine</option></select>';
      const jqueryLike = [nativeEl]; // array-like, nativeEl at index 0
      // .nodeType is undefined → triggers the html?.[0] branch

      await actor.createConsumableSpell(itemData, 'potion', jqueryLike);

      const item = actor.items.find(i => i.type === 'consumable');
      return { ok: true, itemCount: actor.items.size, name: item?.name };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, SPELL_MAGIC_MISSILE_ID);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.itemCount).toBe(1);
});

// ── Item35E.toAttack ──────────────────────────────────────────────────────────

test('toAttack: spell → attack item succeeds', async ({ page }) => {
  const result = await page.evaluate(async (spellId) => {
    try {
      const pack = game.packs.get('warcraftrpg2e.spells');
      await pack.getIndex();
      const doc = await pack.getDocument(spellId);
      if (!doc) return { ok: false, error: 'spell not found' };
      const itemData = doc.toObject();

      const Item35E = game.D35E.Item35E;
      const converted = await Item35E.toAttack(itemData, null);

      if (!converted) return { ok: false, error: 'toAttack returned null' };
      if (converted.type !== 'attack') return { ok: false, error: `expected type attack, got ${converted.type}` };
      if (!converted.system) return { ok: false, error: 'no system property on result' };
      if (converted.system.attackType !== 'misc') return { ok: false, error: `expected attackType misc, got ${converted.system.attackType}` };

      return { ok: true, name: converted.name, attackType: converted.system.attackType };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, SPELL_MAGIC_MISSILE_ID);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.name).toBeTruthy();
  expect(result.attackType).toBe('misc');
});

test('toAttack: Fireball (with damage parts) converts without error', async ({ page }) => {
  const result = await page.evaluate(async (spellId) => {
    try {
      const pack = game.packs.get('warcraftrpg2e.spells');
      await pack.getIndex();
      const doc = await pack.getDocument(spellId);
      const itemData = doc.toObject();

      const Item35E = game.D35E.Item35E;
      const converted = await Item35E.toAttack(itemData, null);

      return {
        ok: true,
        name: converted.name,
        damageParts: converted.system?.damage?.parts ?? [],
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, SPELL_FIREBALL_ID);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.name).toContain('Fireball');
});

test('toAttack: result has activation type set', async ({ page }) => {
  const result = await page.evaluate(async (spellId) => {
    try {
      const pack = game.packs.get('warcraftrpg2e.spells');
      await pack.getIndex();
      const doc = await pack.getDocument(spellId);
      const itemData = doc.toObject();

      const converted = await game.D35E.Item35E.toAttack(itemData, null);
      return { ok: true, activationType: converted.system?.activation?.type };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, SPELL_MAGIC_MISSILE_ID);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.activationType).toBe('standard');
});

// ── Item35E.toTrait ───────────────────────────────────────────────────────────

test('toTrait: spell → trait/feat item succeeds', async ({ page }) => {
  const result = await page.evaluate(async (spellId) => {
    try {
      const pack = game.packs.get('warcraftrpg2e.spells');
      await pack.getIndex();
      const doc = await pack.getDocument(spellId);
      if (!doc) return { ok: false, error: 'spell not found' };
      const itemData = doc.toObject();

      const Item35E = game.D35E.Item35E;
      const converted = await Item35E.toTrait(itemData, 'trait');

      if (!converted) return { ok: false, error: 'toTrait returned null' };
      if (converted.type !== 'feat') return { ok: false, error: `expected type feat, got ${converted.type}` };
      if (!converted.system) return { ok: false, error: 'no system property on result' };
      if (converted.system.featType !== 'trait') return { ok: false, error: `expected featType trait, got ${converted.system.featType}` };

      return { ok: true, name: converted.name, featType: converted.system.featType };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, SPELL_MAGIC_MISSILE_ID);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.name).toBeTruthy();
  expect(result.featType).toBe('trait');
});

test('toTrait: Fireball (with damage parts) converts without error', async ({ page }) => {
  const result = await page.evaluate(async (spellId) => {
    try {
      const pack = game.packs.get('warcraftrpg2e.spells');
      await pack.getIndex();
      const doc = await pack.getDocument(spellId);
      const itemData = doc.toObject();

      const Item35E = game.D35E.Item35E;
      const converted = await Item35E.toTrait(itemData, 'trait');

      return {
        ok: true,
        name: converted.name,
        damageParts: converted.system?.damage?.parts ?? [],
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, SPELL_FIREBALL_ID);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.name).toContain('Fireball');
});

test('toTrait: result has activation type set', async ({ page }) => {
  const result = await page.evaluate(async (spellId) => {
    try {
      const pack = game.packs.get('warcraftrpg2e.spells');
      await pack.getIndex();
      const doc = await pack.getDocument(spellId);
      const itemData = doc.toObject();

      const converted = await game.D35E.Item35E.toTrait(itemData, 'trait');
      return { ok: true, activationType: converted.system?.activation?.type };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, SPELL_MAGIC_MISSILE_ID);

  expect(result.ok, result.error ?? '').toBe(true);
  expect(result.activationType).toBe('standard');
});
