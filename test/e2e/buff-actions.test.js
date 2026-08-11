'use strict';

/**
 * E2E tests for buff item activation with action formulas in D35E.
 *
 * Regression tests for the bug where `applySingleAction` called
 * `evaluateSync()` on Roll objects — which throws in Foundry v13 when
 * the formula contains dice (e.g. "1d8+@attributes.hd.total").
 * All such calls were fixed to use `await roll.evaluate()` instead.
 *
 * Test groups:
 *   1. Update set (static value)   — buff sets hp.temp to fixed number
 *   2. Update set (dice formula)   — buff sets hp.temp to 1d8 (no sync error)
 *   3. Update add (dice formula)   — buff adds 1d4 to hp.temp
 *   4. Update subtract (static)   — buff subtracts 2 from hp.temp
 *   5. No sync-evaluation error   — page error listener fires on regression
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

test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    await Promise.all([...game.actors.map(a => a.delete())]);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create an actor, attach a buff with the given action string, activate the
 * buff, then return the actor's updated `system.attributes.hp.temp` value.
 */
async function activateBuffWithAction(page, actionString, initialTemp = 0) {
  const actorId = await page.evaluate(async ({ actionString, initialTemp }) => {
    const actor = await Actor.create({ name: 'Buff Test Actor', type: 'character' });

    if (initialTemp !== 0) {
      await actor.update({ 'system.attributes.hp.temp': initialTemp });
      await new Promise(r => setTimeout(r, 300));
    }

    const [buff] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Test Buff',
      type: 'buff',
      system: {
        active: false,
        activateActions: [{ action: actionString, condition: '' }],
      },
    }]);

    await buff.update({ 'system.active': true });
    return actor.id;
  }, { actionString, initialTemp });

  // Poll until hp.temp changes from its initial value (or 1s passes)
  await page.waitForFunction(
    ({ actorId, initialTemp }) => {
      const a = game.actors.get(actorId);
      return a && a.system.attributes.hp.temp !== initialTemp;
    },
    { actorId, initialTemp },
    { timeout: 5000 },
  ).catch(() => {}); // timeout is OK — we'll assert below

  return page.evaluate(
    (actorId) => game.actors.get(actorId)?.system.attributes.hp.temp,
    actorId,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('buff actions — Update set', () => {
  test('static value: sets hp.temp to exact number', async ({ page }) => {
    const result = await activateBuffWithAction(page, 'Update set data.attributes.hp.temp to 5 on self');
    expect(result).toBe(5);
  });

  test('dice formula: sets hp.temp to result of 1d6 (no sync error)', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    const result = await activateBuffWithAction(page, 'Update set data.attributes.hp.temp to 1d6 on self');

    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(6);

    const syncErrors = pageErrors.filter(e => e.includes('cannot be synchronously evaluated'));
    expect(syncErrors).toHaveLength(0);
  });

  test('dice formula 1d8: result is within valid range', async ({ page }) => {
    const result = await activateBuffWithAction(page, 'Update set data.attributes.hp.temp to 1d8 on self');
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(8);
  });
});

test.describe('buff actions — Update add', () => {
  test('static value: adds fixed number to hp.temp', async ({ page }) => {
    const result = await activateBuffWithAction(
      page,
      'Update add data.attributes.hp.temp to 3 on self',
      10,
    );
    expect(result).toBe(13);
  });

  test('dice formula: adds 1d4 to existing hp.temp without sync error', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    const result = await activateBuffWithAction(
      page,
      'Update add data.attributes.hp.temp to 1d4 on self',
      10,
    );

    // 10 + 1..4
    expect(result).toBeGreaterThanOrEqual(11);
    expect(result).toBeLessThanOrEqual(14);

    const syncErrors = pageErrors.filter(e => e.includes('cannot be synchronously evaluated'));
    expect(syncErrors).toHaveLength(0);
  });
});

test.describe('buff actions — Update subtract', () => {
  test('static value: subtracts fixed number from hp.temp', async ({ page }) => {
    const result = await activateBuffWithAction(
      page,
      'Update subtract data.attributes.hp.temp to 2 on self',
      10,
    );
    expect(result).toBe(8);
  });

  test('dice formula: subtracts 1d4 from hp.temp without sync error', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    const result = await activateBuffWithAction(
      page,
      'Update subtract data.attributes.hp.temp to 1d4 on self',
      20,
    );

    // 20 - 1..4
    expect(result).toBeGreaterThanOrEqual(16);
    expect(result).toBeLessThanOrEqual(19);

    const syncErrors = pageErrors.filter(e => e.includes('cannot be synchronously evaluated'));
    expect(syncErrors).toHaveLength(0);
  });
});

test.describe('buff actions — sync-evaluation regression guard', () => {
  test('activating a buff with any dice formula does not throw a sync error', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await activateBuffWithAction(page, 'Update set data.attributes.hp.temp to 1d8 on self');

    const syncErrors = pageErrors.filter(e =>
      e.includes('cannot be synchronously evaluated') ||
      e.includes('evaluateSync')
    );
    expect(syncErrors).toHaveLength(0);
  });
});
