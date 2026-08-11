'use strict';

const { dismissOverlays } = require('../helpers');

/**
 * Open an actor sheet in the browser; return the sheet app DOM id for locators.
 */
async function openSheet(page, actorId) {
  await dismissOverlays(page);

  const sheetId = await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    const app = actor.sheet;
    await app.render(true);
    await new Promise((r) => setTimeout(r, 500));
    return app.id;
  }, actorId);

  await page.locator(`#${sheetId}`).waitFor({ state: 'visible', timeout: 10_000 });
  await dismissOverlays(page);

  return sheetId;
}

module.exports = { openSheet };
