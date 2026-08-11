"use strict";

const { test, expect } = require("@playwright/test");
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require("./helpers");
const { openSheet } = require("./helpers/actor-sheet");

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test("character sheet persists Warcraft affiliation and Hero Points", async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: "Warcraft Character Fields", type: "character" });
    return actor.id;
  });

  const sheetId = await openSheet(page, actorId);
  const sheet = page.locator(`#${sheetId}`);

  for (const [name, value] of [
    ["system.details.deity", "The Holy Light"],
    ["system.details.affiliation", "Alliance"],
    ["system.details.affiliationRating", "7"],
    ["system.attributes.heroPoints.value", "2"],
    ["system.attributes.heroPoints.max", "3"],
  ]) {
    const input = sheet.locator(`input[name="${name}"]`);
    await input.fill(value);
    await input.press("Tab");
  }

  await expect.poll(async () => page.evaluate((id) => {
    const actor = game.actors.get(id);
    return {
      faith: actor.system.details.deity,
      affiliation: actor.system.details.affiliation,
      rating: actor.system.details.affiliationRating,
      heroPoints: actor.system.attributes.heroPoints,
    };
  }, actorId)).toEqual({
    faith: "The Holy Light",
    affiliation: "Alliance",
    rating: 7,
    heroPoints: { value: 2, max: 3 },
  });
});
