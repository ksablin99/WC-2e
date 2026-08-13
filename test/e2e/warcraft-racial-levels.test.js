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
    const created = await actor.createEmbeddedDocuments("Item", [tauren.toObject(), taurenClass.toObject()]);
    await actor.refresh();

    return {
      created: created.map((item) => item.name),
      racialClasses: actor.items
        .filter((item) => item.type === "class" && item.system.classType === "racial")
        .map((item) => ({ name: item.name, levels: item.system.levels, maxLevel: item.system.maxLevel })),
      features: actor.items.filter((item) => item.type === "feat").map((item) => ({
        name: item.name,
        automatic: item.system.userNonRemovable,
      })),
      attacks: actor.items.filter((item) => item.type === "attack").map((item) => ({
        name: item.name,
        damage: item.system.damage.parts,
        actionType: item.system.actionType,
      })),
      strength: actor.system.abilities.str.total,
    };
  });

  expect(result.created).toEqual(expect.arrayContaining(["Tauren", "Tauren Racial Levels"]));
  expect(result.racialClasses).toEqual([{ name: "Tauren Racial Levels", levels: 1, maxLevel: 3 }]);
  expect(result.features).toEqual(expect.arrayContaining([
    { name: "Tauren Strength", automatic: true },
    { name: "Tauren Charge", automatic: true },
  ]));
  expect(result.attacks).toEqual(expect.arrayContaining([{
    name: "Horns",
    damage: [["1d8", "Piercing", "damage-piercing"]],
    actionType: "mwak",
  }]));
  expect(result.strength).toBe(13);
});

test("racial-level ability and natural-armor increments stack across their listed levels", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const pack = game.packs.get("warcraftrpg2e.warcraft-races");
    await pack.getIndex();
    const getDocument = async (name, type) => {
      const entry = pack.index.find((candidate) => candidate.name === name && candidate.type === type);
      return pack.getDocument(entry._id ?? entry.id);
    };
    const cases = [
      { race: "Tauren", className: "Tauren Racial Levels", feature: "Tauren Strength" },
      { race: "Forsaken", className: "Forsaken Racial Levels", feature: "Forsaken Racial Advancement" },
      { race: "High Elf", className: "High Elf Racial Levels", feature: "High Elf Agility" },
      { race: "Jungle Troll", className: "Jungle Troll Racial Levels", feature: "Jungle Troll Stamina" },
    ];
    const actors = {};

    for (const entry of cases) {
      const race = await getDocument(entry.race, "race");
      const racialClass = await getDocument(entry.className, "class");
      const classData = racialClass.toObject();
      classData.system.levels = 3;
      classData.system.hp = Number(classData.system.hd) * 3;
      const actor = await Actor.create({ name: `${entry.race} Level Three`, type: "character" });
      await actor.createEmbeddedDocuments("Item", [race.toObject(), classData]);
      await actor.refresh();
      actors[entry.race] = {
        str: actor.system.abilities.str.total,
        dex: actor.system.abilities.dex.total,
        con: actor.system.abilities.con.total,
        wis: actor.system.abilities.wis.total,
        naturalArmor: actor.system.attributes.naturalACTotal,
        featureCount: actor.items.filter((item) => item.name === entry.feature).length,
        racialClassLevels: actor.items.find((item) => item.name === entry.className)?.system.levels ?? 0,
      };
    }
    return actors;
  });

  expect(result.Tauren).toMatchObject({ str: 14, wis: 12, featureCount: 2, racialClassLevels: 3 });
  expect(result.Forsaken).toMatchObject({ str: 15, naturalArmor: 3, featureCount: 3, racialClassLevels: 3 });
  expect(result["High Elf"]).toMatchObject({ dex: 12, featureCount: 2, racialClassLevels: 3 });
  expect(result["Jungle Troll"]).toMatchObject({ dex: 13, con: 12, featureCount: 2, racialClassLevels: 3 });
});

test("a mismatched racial class is rejected by level-up validation", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const progression = await import("/systems/warcraftrpg2e/module/actor/helpers/racialProgressionHelper.js");
    const pack = game.packs.get("warcraftrpg2e.warcraft-races");
    await pack.getIndex();
    const getDocument = async (name, type) => {
      const entry = pack.index.find((candidate) => candidate.name === name && candidate.type === type);
      return pack.getDocument(entry._id ?? entry.id);
    };
    const tauren = await getDocument("Tauren", "race");
    const highElfClass = await getDocument("High Elf Racial Levels", "class");
    const actor = await Actor.create({ name: "Mismatched Racial Progression", type: "character" });
    const created = await actor.createEmbeddedDocuments("Item", [tauren.toObject(), highElfClass.toObject()]);
    const virtualActor = { race: { name: "Tauren" } };
    return {
      valid: progression.isEligibleRacialClass(virtualActor, highElfClass, { plannedLevels: 0 }),
      validation: progression.validateRacialProgressionRows(virtualActor, [highElfClass], [
        { classId: highElfClass.id },
      ]),
      created: created.map((item) => item.name),
      embeddedClasses: actor.items.filter((item) => item.type === "class").map((item) => item.name),
    };
  });

  expect(result.valid).toBe(false);
  expect(result.validation.valid).toBe(false);
  expect(result.validation.errors.map((error) => error.code)).toContain("race-mismatch");
  expect(result.created).toEqual(["Tauren"]);
  expect(result.embeddedClasses).toEqual([]);
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
