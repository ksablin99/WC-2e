'use strict';

/**
 * E2E tests for the conditions system.
 *
 * D35E conditions are stored as booleans at:
 *   `actor.system.attributes.conditions.{conditionName}`
 *
 * Conditions can be set via actor.update() or via the specialActions DSL
 * (`Condition set blind to true on target`). When a condition is active, the
 * actor's token should reflect it visually and mechanical effects (e.g., miss
 * chance for blind) should apply in rolls.
 *
 * Covers:
 *   1. Setting a condition flag via actor.update().
 *   2. The flag is readable back as true.
 *   3. Clearing a condition reverts it to false.
 *   4. Multiple conditions can be set simultaneously.
 *   5. The specialActions DSL `Condition set X to true on target` sets the flag.
 *   6. Paralyzed → effective Str/Dex 0 with −5 mods (zeroDex/zeroStr, GL#1505).
 *   7. Helpless → same effective Dex 0 as paralyzed (zeroDex, mod −5).
 *   8. Buff changeFlags.zeroDex forces effective Dex 0 (−5).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper ─────────────────────────────────────────────────────────────────────

async function createActor(page) {
  return page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Condition Test Actor', type: 'character' });
    return actor.id;
  });
}

// ── 1. Setting blind condition via update ─────────────────────────────────────

test('setting blind condition via actor.update stores true flag', async ({ page }) => {
  const actorId = await createActor(page);

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ 'system.attributes.conditions.blind': true });
  }, { actorId });

  const blind = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.conditions.blind;
  }, { actorId });

  expect(blind).toBe(true);
});

// ── 2. Clearing a condition reverts it ───────────────────────────────────────

test('clearing blind condition sets flag back to false', async ({ page }) => {
  const actorId = await createActor(page);

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ 'system.attributes.conditions.blind': true });
    await actor.update({ 'system.attributes.conditions.blind': false });
  }, { actorId });

  const blind = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.conditions.blind;
  }, { actorId });

  expect(blind).toBe(false);
});

// ── 3. Multiple conditions simultaneously ────────────────────────────────────

test('multiple conditions can be set simultaneously', async ({ page }) => {
  const actorId = await createActor(page);

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.update({
      'system.attributes.conditions.blind':    true,
      'system.attributes.conditions.shaken':   true,
      'system.attributes.conditions.staggered': true,
    });
  }, { actorId });

  const result = await page.evaluate(({ actorId }) => {
    const c = game.actors.get(actorId).system.attributes.conditions;
    return { blind: c.blind, shaken: c.shaken, staggered: c.staggered };
  }, { actorId });

  expect(result.blind).toBe(true);
  expect(result.shaken).toBe(true);
  expect(result.staggered).toBe(true);
});

// ── 4. Conditions are independent ────────────────────────────────────────────

test('clearing one condition does not affect others', async ({ page }) => {
  const actorId = await createActor(page);

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    await actor.update({
      'system.attributes.conditions.blind':  true,
      'system.attributes.conditions.shaken': true,
    });
    // Clear only blind
    await actor.update({ 'system.attributes.conditions.blind': false });
  }, { actorId });

  const result = await page.evaluate(({ actorId }) => {
    const c = game.actors.get(actorId).system.attributes.conditions;
    return { blind: c.blind, shaken: c.shaken };
  }, { actorId });

  expect(result.blind).toBe(false);
  expect(result.shaken).toBe(true); // unaffected
});

// ── 5. specialActions DSL sets condition flag ─────────────────────────────────

test('autoApplyActionsOnSelf Condition-set verb sets condition flag', async ({ page }) => {
  const actorId = await createActor(page);

  await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    // The DSL verb: `Condition set <name> to <bool> on <target|self>`
    // autoApplyActionsOnSelf processes "on self" actions; `target` is a separate path.
    // We must use the token route for `on target`, but `on self` works without a token.
    await actor.autoApplyActionsOnSelf('Condition set frightened to true on self');
  }, { actorId });

  // Poll briefly in case it's async
  await page.waitForFunction(({ id }) => {
    return game.actors.get(id)?.system?.attributes?.conditions?.frightened === true;
  }, { id: actorId }, { timeout: 3_000 });

  const frightened = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.conditions.frightened;
  }, { actorId });

  expect(frightened).toBe(true);
});

// ── 6. Paralyzed — effective ability 0 with −5 modifier (GL#1505) ────────────

test('paralyzed sets Dex and Str to effective 0 with −5 modifiers', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'E2E Paralyzed Abilities',
      type: 'character',
      system: {
        abilities: { str: { value: 14 }, dex: { value: 14 } },
      },
    });
    await actor.update({ 'system.attributes.conditions.paralyzed': true });
    const a = game.actors.get(actor.id);
    return {
      strMod: a.system.abilities.str.mod,
      strTot: a.system.abilities.str.total,
      dexMod: a.system.abilities.dex.mod,
      dexTot: a.system.abilities.dex.total,
    };
  });

  expect(r.dexMod).toBe(-5);
  expect(r.strMod).toBe(-5);
  expect(r.dexTot).toBe(0);
  expect(r.strTot).toBe(0);
});

// ── 7. Helpless — effective Dex 0 (−5), same zeroDex path as paralyzed (Dex only) ─

test('helpless sets Dex to effective 0 with modifier −5', async ({ page }) => {
  const r = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'E2E Helpless Dex',
      type: 'character',
      system: { abilities: { dex: { value: 16 } } },
    });
    await actor.update({ 'system.attributes.conditions.helpless': true });
    const a = game.actors.get(actor.id);
    return { mod: a.system.abilities.dex.mod, total: a.system.abilities.dex.total };
  });

  expect(r.total).toBe(0);
  expect(r.mod).toBe(-5);
});

// ── 8. Buff changeFlags.zeroDex ───────────────────────────────────────────────

test('active buff with changeFlags.zeroDex forces Dex mod −5 and total 0', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'E2E Zero Dex Buff',
      type: 'character',
      system: { abilities: { dex: { value: 18 } } },
    });
    await actor.createEmbeddedDocuments('Item', [
      {
        name: 'Effective Zero Dex',
        type: 'buff',
        system: {
          active: true,
          changes: [],
          changeFlags: { zeroDex: true },
        },
      },
    ]);
    const a = game.actors.get(actor.id);
    return { mod: a.system.abilities.dex.mod, total: a.system.abilities.dex.total };
  });

  expect(r.mod).toBe(-5);
  expect(r.total).toBe(0);
});

test('active buff with changeFlags.zeroStr forces Str mod −5 and total 0', async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'E2E Zero Str Buff',
      type: 'character',
      system: { abilities: { str: { value: 17 } } },
    });
    await actor.createEmbeddedDocuments('Item', [
      {
        name: 'Effective Zero Str',
        type: 'buff',
        system: {
          active: true,
          changes: [],
          changeFlags: { zeroStr: true },
        },
      },
    ]);
    const a = game.actors.get(actor.id);
    return { mod: a.system.abilities.str.mod, total: a.system.abilities.str.total };
  });

  expect(r.mod).toBe(-5);
  expect(r.total).toBe(0);
});
