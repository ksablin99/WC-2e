'use strict';

/**
 * E2E tests for the max-uses formula fix (issue #1628).
 *
 * Bug: in Foundry v13, Roll.roll() is async. All call-sites in
 * itemChargeUpdateHelper.js were missing `await`, so `roll.total` was always
 * `undefined` and any max-uses formula silently evaluated to 0.
 *
 * Fix: made setMaxUses/updateMaxUses async and awaited all roll.roll() calls.
 *
 * Covers:
 *   1. Literal formula: uses.maxFormula = "3"   → uses.max becomes 3
 *   2. Actor-referencing formula: uses.maxFormula = "@abilities.str.value"
 *      on an actor with str=14 → uses.max becomes 14
 *   3. Per-use formula: uses.maxPerUseFormula = "2" → uses.maxPerUse becomes 2
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a bare character actor and return its id.
 * strValue is written into system.abilities.str.value so formulas like
 * "@abilities.str.value" resolve to a known number.
 */
async function createCharacter(page, name = 'Test Character', strValue = 10) {
  return page.evaluate(async ({ name, strValue }) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      system: {
        abilities: {
          str: { value: strValue },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 10 },
          wis: { value: 10 },
          cha: { value: 10 },
        },
      },
    });
    return actor.id;
  }, { name, strValue });
}

/**
 * Create a feat item owned by the given actor and return its id.
 * The feat uses the `activatedEffect` template which includes
 * uses.maxFormula and uses.maxPerUseFormula fields.
 */
async function createFeat(page, actorId, featName = 'Test Feat') {
  return page.evaluate(async ({ actorId, featName }) => {
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error(`Actor ${actorId} not found`);
    const [item] = await actor.createEmbeddedDocuments('Item', [{
      name: featName,
      type: 'feat',
    }]);
    return item.id;
  }, { actorId, featName });
}

/**
 * Read the current uses data from an actor-owned item and return a plain object.
 */
async function getItemUses(page, actorId, itemId) {
  return page.evaluate(({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error(`Actor ${actorId} not found`);
    const item = actor.items.get(itemId);
    if (!item) throw new Error(`Item ${itemId} not found on actor ${actorId}`);
    const uses = item.system.uses;
    return {
      max: uses.max,
      maxFormula: uses.maxFormula,
      maxPerUse: uses.maxPerUse,
      maxPerUseFormula: uses.maxPerUseFormula,
    };
  }, { actorId, itemId });
}

// ── 1. Literal formula ────────────────────────────────────────────────────────

test('literal maxFormula "3" sets uses.max to 3', async ({ page }) => {
  const actorId = await createCharacter(page, 'MaxUses Literal Actor');
  const itemId  = await createFeat(page, actorId, 'Feat With Literal Max');

  // Update the item with a literal formula — this triggers _updateMaxUses which
  // must await roll.roll() (the bug fix).  Before the fix, roll.total was
  // undefined and the result would be 0 or NaN.
  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    await item.update({ 'system.uses.maxFormula': '3' });
  }, { actorId, itemId });

  // Poll until the server-side update propagates back.
  await page.waitForFunction(
    ({ actorId, itemId }) => {
      const actor = game.actors.get(actorId);
      const item  = actor?.items.get(itemId);
      return item?.system.uses.max === 3;
    },
    { actorId, itemId },
    { timeout: 8_000 },
  );

  const uses = await getItemUses(page, actorId, itemId);
  expect(uses.max, 'uses.max should be 3 after literal formula "3"').toBe(3);
});

// ── 2. Actor-referencing formula ──────────────────────────────────────────────

test('actor-referencing maxFormula "@abilities.str.value" evaluates to actor str', async ({ page }) => {
  // Create an actor with a distinctive str value so the formula result is unambiguous.
  const STR = 14;
  const actorId = await createCharacter(page, 'MaxUses ActorRef Actor', STR);
  const itemId  = await createFeat(page, actorId, 'Feat With ActorRef Max');

  // Update with the actor-referencing formula.  The actor's getRollData() must
  // be used when rolling, and roll.total must be awaited (the bug fix).
  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    await item.update({ 'system.uses.maxFormula': '@abilities.str.value' });
  }, { actorId, itemId });

  await page.waitForFunction(
    ({ actorId, itemId, expected }) => {
      const actor = game.actors.get(actorId);
      const item  = actor?.items.get(itemId);
      return item?.system.uses.max === expected;
    },
    { actorId, itemId, expected: STR },
    { timeout: 8_000 },
  );

  const uses = await getItemUses(page, actorId, itemId);
  expect(
    uses.max,
    `uses.max should equal actor str (${STR}) after formula "@abilities.str.value"`,
  ).toBe(STR);
});

// ── 3. Per-use formula ────────────────────────────────────────────────────────

test('literal maxPerUseFormula "2" sets uses.maxPerUse to 2', async ({ page }) => {
  const actorId = await createCharacter(page, 'MaxUses PerUse Actor');
  const itemId  = await createFeat(page, actorId, 'Feat With PerUse Max');

  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    await item.update({ 'system.uses.maxPerUseFormula': '2' });
  }, { actorId, itemId });

  await page.waitForFunction(
    ({ actorId, itemId }) => {
      const actor = game.actors.get(actorId);
      const item  = actor?.items.get(itemId);
      return item?.system.uses.maxPerUse === 2;
    },
    { actorId, itemId },
    { timeout: 8_000 },
  );

  const uses = await getItemUses(page, actorId, itemId);
  expect(uses.maxPerUse, 'uses.maxPerUse should be 2 after formula "2"').toBe(2);
});

// ── 4. Regression: empty formula leaves max at 0 ──────────────────────────────

test('empty maxFormula leaves uses.max at 0 (no error)', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const actorId = await createCharacter(page, 'MaxUses Empty Formula Actor');
  const itemId  = await createFeat(page, actorId, 'Feat With Empty Formula');

  // Update something else on the item (description) to trigger the update path
  // while the maxFormula remains empty.  The helper should skip evaluation for
  // empty formulas and leave uses.max at its default value of 0.
  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    // maxFormula is already ""; explicitly update a harmless field to
    // exercise the _updateMaxUses codepath with an empty formula.
    await item.update({ 'system.uses.maxFormula': '' });
  }, { actorId, itemId });

  // Allow time for any async side-effects.
  await page.waitForTimeout(800);

  const uses = await getItemUses(page, actorId, itemId);
  expect(uses.max, 'uses.max should remain 0 when maxFormula is empty').toBe(0);

  // No JS errors should have been thrown.
  const relevantErrors = consoleErrors.filter(
    e => e.includes('roll') || e.includes('uses') || e.includes('undefined'),
  );
  expect(relevantErrors, 'no roll/uses errors with empty formula').toHaveLength(0);
});
