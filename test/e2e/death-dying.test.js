'use strict';

/**
 * E2E tests for the death and dying mechanics.
 *
 * D35E death/dying rules (D&D 3.5e):
 *   - At 0 HP: unconscious and dying (losing 1 HP per round).
 *   - At –CON modifier HP: dead.
 *   - `system.attributes.hp.value` can go negative.
 *   - `system.attributes.conditions.dead` / `dying` track the state.
 *   - Stabilization: a successful CON check (DC 10) prevents further loss.
 *
 * These tests verify the data model reflects damage correctly near and below 0
 * and that dead/dying conditions can be set and queried.
 *
 * Covers:
 *   1. HP can go negative (dying).
 *   2. Setting dying condition flag marks the actor as dying.
 *   3. Setting dead condition flag marks the actor as dead.
 *   4. Applying massive damage drives HP far negative.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── 1. HP can go below zero (dying range) ────────────────────────────────────

test('applying damage to an actor at 1 HP drives HP negative', async ({ page }) => {
  const hp = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Dying Actor',
      type: 'character',
      system: { attributes: { hp: { value: 1, max: 20 } } },
    });

    // Apply 10 damage (more than remaining HP)
    await game.D35E.ActorPF.applyDamage(
      null, 100, null, false, false, false, false,
      10, 10, null, null, 0, false, true,
      game.actors.get(actor.id),
    );

    return game.actors.get(actor.id).system.attributes.hp.value;
  });

  expect(hp).toBeLessThan(0);
});

// ── 2. Dying condition flag can be set ───────────────────────────────────────

test('setting dying condition flag marks actor as dying', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Dying Flag Actor',
      type: 'character',
      system: { attributes: { hp: { value: -3, max: 20 } } },
    });

    await actor.update({ 'system.attributes.conditions.dying': true });
    const a = game.actors.get(actor.id);
    return a.system.attributes.conditions.dying;
  });

  expect(result).toBe(true);
});

// ── 3. Dead condition flag can be set ────────────────────────────────────────

test('setting dead condition flag marks actor as dead', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Dead Actor',
      type: 'character',
      system: {
        attributes: { hp: { value: -15, max: 20 } },
        abilities:  { con: { value: 10 } },
      },
    });

    await actor.update({ 'system.attributes.conditions.dead': true });
    const a = game.actors.get(actor.id);
    return a.system.attributes.conditions.dead;
  });

  expect(result).toBe(true);
});

// ── 4. Massive damage drives HP far negative ─────────────────────────────────

test('applying 100 damage to actor with 1 HP results in HP at least -99', async ({ page }) => {
  const hp = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Massive Damage Actor',
      type: 'character',
      system: { attributes: { hp: { value: 1, max: 50 } } },
    });

    await game.D35E.ActorPF.applyDamage(
      null, 100, null, false, false, false, false,
      100, 100, null, null, 0, false, true,
      game.actors.get(actor.id),
    );

    return game.actors.get(actor.id).system.attributes.hp.value;
  });

  expect(hp).toBeLessThanOrEqual(-99);
});

// ── 5. Dying and dead flags are independent ───────────────────────────────────

test('dead and dying conditions are stored independently', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Flag Test', type: 'character' });
    await actor.update({
      'system.attributes.conditions.dying': true,
      'system.attributes.conditions.dead':  false,
    });
    const c = game.actors.get(actor.id).system.attributes.conditions;
    return { dying: c.dying, dead: c.dead };
  });

  expect(result.dying).toBe(true);
  expect(result.dead).toBe(false);
});
