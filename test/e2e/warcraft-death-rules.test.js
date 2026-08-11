"use strict";

const { test, expect } = require("@playwright/test");
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require("./helpers");

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test("Warcraft living death thresholds use Stamina score and modifier", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Warcraft Living Health Actor",
      type: "character",
      system: {
        abilities: { con: { value: 14 } },
        attributes: {
          deathRule: "warcraft",
          hp: { value: 10, max: 10 },
        },
      },
    });

    const states = {};
    for (const hp of [0, -2, -3, -14, -15, 1]) {
      await actor.update({ "system.attributes.hp.value": hp });
      const conditions = game.actors.get(actor.id).system.attributes.conditions;
      states[hp] = {
        disabled: conditions.disabled,
        dying: conditions.dying,
        dead: conditions.dead,
      };
    }

    return { stamina: actor.system.abilities.con.total, states };
  });

  expect(result.stamina).toBe(14);
  expect(result.states["0"]).toEqual({ disabled: true, dying: false, dead: false });
  expect(result.states["-2"]).toEqual({ disabled: true, dying: false, dead: false });
  expect(result.states["-3"]).toEqual({ disabled: false, dying: true, dead: false });
  expect(result.states["-14"]).toEqual({ disabled: false, dying: true, dead: false });
  expect(result.states["-15"]).toEqual({ disabled: false, dying: false, dead: true });
  expect(result.states["1"]).toEqual({ disabled: false, dying: false, dead: false });
});

test("Warcraft health state recalculates when Stamina changes", async ({ page }) => {
  const conditions = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Warcraft Stamina Threshold Actor",
      type: "character",
      system: {
        abilities: { con: { value: 14 } },
        attributes: {
          deathRule: "warcraft",
          hp: { value: -3, max: 10 },
        },
      },
    });

    await actor.update({ "system.attributes.hp.value": -3 });
    await actor.update({ "system.abilities.con.value": 20 });
    const current = game.actors.get(actor.id).system.attributes.conditions;
    return {
      disabled: current.disabled,
      dying: current.dying,
      dead: current.dead,
      unconscious: current.unconscious,
      helpless: current.helpless,
    };
  });

  expect(conditions).toEqual({
    disabled: true,
    dying: false,
    dead: false,
    unconscious: false,
    helpless: false,
  });
});

test("Forsaken race marker ignores Stamina and uses fixed destroyed threshold", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Forsaken Health Actor",
      type: "character",
      system: {
        abilities: { con: { value: 30 } },
        attributes: { hp: { value: 10, max: 10 } },
      },
    });
    await actor.createEmbeddedDocuments("Item", [
      {
        name: "Forsaken",
        type: "race",
        system: { deathRule: "forsaken" },
      },
    ]);

    const states = {};
    for (const hp of [0, -1, -9, -10]) {
      await actor.update({ "system.attributes.hp.value": hp });
      const conditions = game.actors.get(actor.id).system.attributes.conditions;
      states[hp] = {
        disabled: conditions.disabled,
        dying: conditions.dying,
        dead: conditions.dead,
      };
    }

    return { states };
  });

  expect(result.states["0"]).toEqual({ disabled: true, dying: false, dead: false });
  expect(result.states["-1"]).toEqual({ disabled: false, dying: true, dead: false });
  expect(result.states["-9"]).toEqual({ disabled: false, dying: true, dead: false });
  expect(result.states["-10"]).toEqual({ disabled: false, dying: false, dead: true });
});

test("unmarked actors retain the legacy fixed -10 threshold", async ({ page }) => {
  const conditions = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Legacy Health Actor",
      type: "character",
      system: {
        abilities: { con: { value: 20 } },
        attributes: { hp: { value: 10, max: 10 } },
      },
    });
    await actor.update({ "system.attributes.hp.value": -10 });
    const current = game.actors.get(actor.id).system.attributes.conditions;
    return { dying: current.dying, dead: current.dead };
  });

  expect(conditions).toEqual({ dying: false, dead: true });
});

test("Forsaken do not recover hit points from ordinary rest", async ({ page }) => {
  const hitPoints = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Forsaken Rest Actor",
      type: "character",
      system: {
        attributes: {
          deathRule: "forsaken",
          hd: { total: 5 },
          hp: { value: 3, base: 10, max: 10 },
        },
      },
    });

    await actor.rest(true, false, false);
    return game.actors.get(actor.id).system.attributes.hp.value;
  });

  expect(hitPoints).toBe(3);
});

test("Warcraft constructs are destroyed at 0 HP and do not heal from rest", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Warcraft Construct Health Actor",
      type: "npc",
      system: {
        attributes: {
          deathRule: "warcraft-construct",
          hd: { total: 5 },
          hp: { value: 1, base: 10, max: 10 },
        },
      },
    });

    await actor.rest(true, false, false);
    const hitPointsAfterRest = game.actors.get(actor.id).system.attributes.hp.value;
    await actor.update({ "system.attributes.hp.value": 0 });
    const conditions = game.actors.get(actor.id).system.attributes.conditions;
    return {
      hitPointsAfterRest,
      disabled: conditions.disabled,
      dying: conditions.dying,
      dead: conditions.dead,
    };
  });

  expect(result).toEqual({
    hitPointsAfterRest: 1,
    disabled: false,
    dying: false,
    dead: true,
  });
});
