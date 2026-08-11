'use strict';

/**
 * E2E tests for bug fix #1624.
 *
 * Bug: in `actor.rest()`, calculating `system.combatChangesRange.max` and
 * `system.combatChangesAdditionalRanges.slider{N}.max` from their `maxFormula`
 * fields used `.roll()` (async, unawaited), so `.total` was a Promise — never
 * a number.  The max values were effectively never updated after rest.
 *
 * Fix: switched to `.evaluateSync()` so `.total` is always a plain number.
 *
 * Covers:
 *   1. Literal formula "10" → combatChangesRange.max becomes 10 after rest
 *   2. Actor-referencing formula "@attributes.hd.total" → resolves to HD
 *   3. Additional ranges (slider1, slider2, slider3) literal formula updated
 *   4. Items with an empty maxFormula are untouched (no error, max stays 0)
 *   5. Rest with restoreDailyUses=false does NOT update combatChangesRange.max
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

// ── Shared helpers ────────────────────────────────────────────────────────────

/**
 * Create a bare character actor and return its id.
 * hdTotal is the effective class-based HD (level 1 = 1 by default).
 */
async function createCharacter(page, name = 'Rest Range Test Actor') {
  return page.evaluate(async (name) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      system: {
        abilities: {
          str: { value: 10 },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 10 },
          wis: { value: 10 },
          cha: { value: 10 },
        },
      },
    });
    return actor.id;
  }, name);
}

/**
 * Add a feat item to the actor with the given combatChangesRange fields,
 * then return the item id.
 */
async function addFeatWithRangeFormula(page, actorId, {
  maxFormula = '',
  maxInitial = 0,
  slider1MaxFormula = '',
  slider2MaxFormula = '',
  slider3MaxFormula = '',
} = {}) {
  return page.evaluate(async ({ actorId, maxFormula, maxInitial, slider1MaxFormula, slider2MaxFormula, slider3MaxFormula }) => {
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error(`Actor ${actorId} not found`);

    const [item] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Combat Range Feat',
      type: 'feat',
      system: {
        combatChangesRange: {
          maxFormula,
          max: maxInitial,
        },
        combatChangesAdditionalRanges: {
          slider1: { maxFormula: slider1MaxFormula, max: 0, name: 'Slider1' },
          slider2: { maxFormula: slider2MaxFormula, max: 0, name: 'Slider2' },
          slider3: { maxFormula: slider3MaxFormula, max: 0, name: 'Slider3' },
        },
      },
    }]);
    return item.id;
  }, { actorId, maxFormula, maxInitial, slider1MaxFormula, slider2MaxFormula, slider3MaxFormula });
}

/**
 * Call actor.rest(false, true, false) — restore daily uses, no health restore.
 */
async function callRest(page, actorId) {
  return page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error(`Actor ${actorId} not found`);
    await actor.rest(false, true, false);
  }, actorId);
}

/**
 * Return the combat-change-range data of an actor-owned item as a plain object.
 */
async function getRangeData(page, actorId, itemId) {
  return page.evaluate(({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    if (!actor) throw new Error(`Actor ${actorId} not found`);
    const item = actor.items.get(itemId);
    if (!item) throw new Error(`Item ${itemId} not found on actor ${actorId}`);
    return {
      max: item.system.combatChangesRange.max,
      maxFormula: item.system.combatChangesRange.maxFormula,
      slider1Max: item.system.combatChangesAdditionalRanges?.slider1?.max,
      slider2Max: item.system.combatChangesAdditionalRanges?.slider2?.max,
      slider3Max: item.system.combatChangesAdditionalRanges?.slider3?.max,
    };
  }, { actorId, itemId });
}

// ── 1. Literal formula "10" ───────────────────────────────────────────────────

test('rest updates combatChangesRange.max from literal formula "10"', async ({ page }) => {
  const actorId = await createCharacter(page, 'Range Literal Actor');
  const itemId  = await addFeatWithRangeFormula(page, actorId, {
    maxFormula: '10',
    maxInitial: 0,
  });

  // Confirm the initial state has max = 0 (or whatever was set).
  const before = await getRangeData(page, actorId, itemId);
  expect(before.maxFormula).toBe('10');

  // Trigger rest — restoreDailyUses = true is what activates the formula path.
  await callRest(page, actorId);

  // Poll until the embedded-document update propagates.
  await page.waitForFunction(
    ({ actorId, itemId }) => {
      const actor = game.actors.get(actorId);
      const item  = actor?.items.get(itemId);
      return item?.system.combatChangesRange.max === 10;
    },
    { actorId, itemId },
    { timeout: 8_000 },
  );

  const after = await getRangeData(page, actorId, itemId);
  expect(after.max, 'combatChangesRange.max should be 10 after rest with formula "10"').toBe(10);
});

// ── 2. Actor-referencing formula "@abilities.str.value" ──────────────────────

test('rest updates combatChangesRange.max from actor-referencing formula "@abilities.str.value"', async ({ page }) => {
  // Use a distinctive STR value so the formula result is unambiguous and
  // clearly different from the initial max value.
  const STR = 16;
  const actorId = await page.evaluate(async (str) => {
    const actor = await Actor.create({
      name: 'Range ActorRef Actor',
      type: 'character',
      system: {
        abilities: {
          str: { value: str },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 10 },
          wis: { value: 10 },
          cha: { value: 10 },
        },
      },
    });
    return actor.id;
  }, STR);

  const itemId = await addFeatWithRangeFormula(page, actorId, {
    maxFormula: '@abilities.str.value',
    maxInitial: 0, // starts at 0; fix should bring it to STR (16)
  });

  await callRest(page, actorId);

  await page.waitForFunction(
    ({ actorId, itemId, expected }) => {
      const actor = game.actors.get(actorId);
      const item  = actor?.items.get(itemId);
      return item?.system.combatChangesRange.max === expected;
    },
    { actorId, itemId, expected: STR },
    { timeout: 8_000 },
  );

  const after = await getRangeData(page, actorId, itemId);
  expect(
    after.max,
    `combatChangesRange.max should equal @abilities.str.value (${STR}) after rest`,
  ).toBe(STR);
});

// ── 3. Additional ranges (slider1, slider2, slider3) ─────────────────────────

test('rest updates combatChangesAdditionalRanges slider1/2/3 max from literal formulas', async ({ page }) => {
  const actorId = await createCharacter(page, 'Range Sliders Actor');
  const itemId  = await addFeatWithRangeFormula(page, actorId, {
    maxFormula: '',          // primary range left empty
    slider1MaxFormula: '5',
    slider2MaxFormula: '7',
    slider3MaxFormula: '3',
  });

  await callRest(page, actorId);

  // Wait until all three sliders have been updated.
  await page.waitForFunction(
    ({ actorId, itemId }) => {
      const actor = game.actors.get(actorId);
      const item  = actor?.items.get(itemId);
      const ar = item?.system.combatChangesAdditionalRanges;
      return ar?.slider1?.max === 5 && ar?.slider2?.max === 7 && ar?.slider3?.max === 3;
    },
    { actorId, itemId },
    { timeout: 8_000 },
  );

  const after = await getRangeData(page, actorId, itemId);
  expect(after.slider1Max, 'slider1.max should be 5').toBe(5);
  expect(after.slider2Max, 'slider2.max should be 7').toBe(7);
  expect(after.slider3Max, 'slider3.max should be 3').toBe(3);
});

// ── 4. Empty maxFormula leaves max unchanged (no error) ───────────────────────

test('rest leaves combatChangesRange.max unchanged when maxFormula is empty', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const actorId = await createCharacter(page, 'Range Empty Formula Actor');
  const itemId  = await addFeatWithRangeFormula(page, actorId, {
    maxFormula: '',
    maxInitial: 0,
  });

  await callRest(page, actorId);

  // Give async operations time to settle.
  await page.waitForTimeout(1_000);

  const after = await getRangeData(page, actorId, itemId);
  expect(after.max, 'combatChangesRange.max should remain 0 when maxFormula is empty').toBe(0);

  // No JS errors related to combatChangesRange should have been thrown.
  const relevant = consoleErrors.filter(
    e => e.includes('combatChangesRange') || e.includes('maxFormula') || e.includes('evaluateSync'),
  );
  expect(relevant, 'no errors with empty maxFormula').toHaveLength(0);
});

// ── 5. Regression: restoreDailyUses=false skips the formula evaluation ────────

test('rest with restoreDailyUses=false does NOT update combatChangesRange.max', async ({ page }) => {
  const actorId = await createCharacter(page, 'Range No Rest Actor');
  const itemId  = await addFeatWithRangeFormula(page, actorId, {
    maxFormula: '10',
    maxInitial: 0,
  });

  // Call rest with restoreDailyUses = false — the combatChangesRange block
  // is inside the `if (restoreDailyUses)` branch and must NOT run.
  await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    await actor.rest(false, false, false);
  }, actorId);

  // Allow time for any (incorrect) async update to land.
  await page.waitForTimeout(1_000);

  const after = await getRangeData(page, actorId, itemId);
  expect(
    after.max,
    'combatChangesRange.max should remain 0 when restoreDailyUses is false',
  ).toBe(0);
});
