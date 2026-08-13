'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test('ordinary actor updates complete when no caster-advancement classes exist', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Caster Advancement Scope Test', type: 'character' });

    await actor.update({ 'system.abilities.str.value': 14 });

    const fresh = game.actors.get(actor.id);
    return {
      strength: fresh.system.abilities.str.value,
      modifier: fresh.system.abilities.str.mod,
    };
  });

  expect(result).toEqual({ strength: 14, modifier: 2 });
});
