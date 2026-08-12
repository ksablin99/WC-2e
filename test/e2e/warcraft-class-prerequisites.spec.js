"use strict";

const { test, expect } = require("@playwright/test");
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require("./helpers");

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test("class creation blocks automated prerequisites but leaves narrative gates to the GM", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Prerequisite Candidate",
      type: "character",
      system: { attributes: { bab: { value: 2 } } },
    });
    const blocked = await actor.createEmbeddedDocuments("Item", [{
      name: "Blocked Prestige",
      type: "class",
      system: { levels: 1, classType: "prestige", warcraftPrerequisites: [{ type: "bab", minimum: 5 }] },
    }]);
    const manual = await actor.createEmbeddedDocuments("Item", [{
      name: "GM-Gated Prestige",
      type: "class",
      system: { levels: 1, classType: "prestige", warcraftPrerequisites: [{ type: "manual", label: "GM approval" }] },
    }]);
    return { blocked: blocked.length, manual: manual.length };
  });

  expect(result.blocked).toBe(0);
  expect(result.manual).toBe(1);
});
