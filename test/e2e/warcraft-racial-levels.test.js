"use strict";

const { test, expect } = require("@playwright/test");
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require("./helpers");

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test("racial class records enforce race identity and grant their first-level features", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const pack = game.packs.get("warcraftrpg2e.warcraft-races");
    await pack.getIndex();
    const getDocument = async (name, type) => {
      const entry = pack.index.find((candidate) => candidate.name === name && (!type || candidate.type === type));
      return entry ? pack.getDocument(entry._id ?? entry.id) : null;
    };
    const tauren = await getDocument("Tauren", "race");
    const taurenClass = await getDocument("Tauren Racial Levels", "class");
    const actor = await Actor.create({
      name: "Tauren Racial Progression Actor",
      type: "character",
      system: { attributes: { deathRule: "warcraft", hp: { value: 10, max: 10 } } },
    });
    await actor.createEmbeddedDocuments("Item", [tauren.toObject(), taurenClass.toObject()]);
    await actor.update({});

    return {
      racialClasses: actor.items
        .filter((item) => item.type === "class" && item.system.classType === "racial")
        .map((item) => ({ name: item.name, levels: item.system.levels, maxLevel: item.system.maxLevel })),
      features: actor.items.filter((item) => item.type === "feat").map((item) => item.name),
      attacks: actor.items.filter((item) => item.type === "attack").map((item) => ({
        name: item.name,
        damage: item.system.damage.parts,
        actionType: item.system.actionType,
      })),
      strength: actor.system.abilities.str.total,
    };
  });

  expect(result.racialClasses).toEqual([{ name: "Tauren Racial Levels", levels: 1, maxLevel: 3 }]);
  expect(result.features).toEqual(expect.arrayContaining(["Tauren Strength", "Tauren Charge"]));
  expect(result.attacks).toEqual(expect.arrayContaining([{
    name: "Horns",
    damage: [["1d8", "Piercing", "damage-piercing"]],
    actionType: "mwak",
  }]));
  expect(result.strength).toBeGreaterThanOrEqual(13);
});

test("a mismatched racial class is rejected by level-up validation", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const progression = await import("/systems/warcraftrpg2e/module/actor/helpers/racialProgressionHelper.js");
    const pack = game.packs.get("warcraftrpg2e.warcraft-races");
    await pack.getIndex();
    const entry = pack.index.find((candidate) => candidate.name === "High Elf Racial Levels" && candidate.type === "class");
    const highElfClass = await pack.getDocument(entry._id ?? entry.id);
    const actor = { race: { name: "Tauren" } };
    return {
      valid: progression.isEligibleRacialClass(actor, highElfClass, { plannedLevels: 0 }),
      validation: progression.validateRacialProgressionRows(actor, [highElfClass], [
        { classId: highElfClass.id },
      ]),
    };
  });

  expect(result.valid).toBe(false);
  expect(result.validation.valid).toBe(false);
  expect(result.validation.errors.map((error) => error.code)).toContain("race-mismatch");
});

test("Forsaken racial level 3 improves only future Hit Die rolls", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const progression = await import("/systems/warcraftrpg2e/module/actor/helpers/racialProgressionHelper.js");
    return {
      before: progression.effectiveWarcraftHitDie(8, { forsakenRacialLevels: 2 }),
      after: progression.effectiveWarcraftHitDie(8, { forsakenRacialLevels: 3 }),
      capped: progression.effectiveWarcraftHitDie(12, { forsakenRacialLevels: 3 }),
    };
  });

  expect(result).toEqual({
    before: { die: 8, flat: 0 },
    after: { die: 10, flat: 0 },
    capped: { die: 12, flat: 2 },
  });
});
