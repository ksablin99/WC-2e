"use strict";

const { test, expect } = require("@playwright/test");
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require("./helpers");

const PACK = "warcraftrpg2e.warcraft-bestiary";
const CASES = [
  { id: "d3a5a4049581f81a", name: "Black Drake", hp: 324, hd: 24, ac: [31, 8, 31], bab: 24, cmb: 43, saves: [21, 14, 17], attack: ["Bite", 33, "2d8+11"] },
  { id: "8730e6a2de9203de", name: "Whirlwind Stormwalker", hp: 204, hd: 24, ac: [30, 19, 19], bab: 18, cmb: 34, saves: [12, 25, 8], attack: ["Slam", 27, "2d8+8"] },
  { id: "04a6e935109d2bb7", name: "Rot Hide Gnoll", hp: 19, hd: 3, ac: [18, 11, 17], bab: 3, cmb: 9, saves: [3, 2, 2], attack: ["Battleaxe", 10, "1d8+6"] },
  { id: "2376518b94156d65", name: "Lady Onyxia", hp: 550, hd: 36, ac: [33, 6, 33], bab: 33, cmb: 60, saves: [28, 19, 27], attack: ["Bite", 44, "6d6+15"] },
  { id: "48edf0811a768d89", name: "Mekgineer Thermaplugg", hp: 182, hd: 12, ac: [21, 11, 19], bab: 8, cmb: 31, saves: [7, 10, 9], attack: ["Club", 17, "1d8+6"] },
];

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test("representative Monster Guide actors import with exact derived numbers and attacks", async ({ page }) => {
  const result = await page.evaluate(async ({ packId, cases }) => {
    const pack = game.packs.get(packId);
    if (!pack) throw new Error(`Missing compendium ${packId}`);
    const output = [];
    for (const expected of cases) {
      const source = await pack.getDocument(expected.id);
      if (!source) throw new Error(`Missing ${expected.name} (${expected.id})`);
      const actor = await Actor.create(source.toObject());
      await actor.sheet.getData();
      const attack = actor.items.find((item) => item.type === "attack" && item.name === expected.attack[0]);
      const rollData = actor.getRollData();
      rollData.item = attack.getRollData();
      const attackBonus = await attack.rolls.rollAttack({
        data: rollData,
        bonusOnly: true,
        primaryAttack: true,
        replacedEnh: attack.system.enh,
      });
      output.push({
        name: actor.name,
        hp: actor.system.attributes.hp.max,
        hd: actor.system.attributes.hd.total,
        ac: [
          actor.system.attributes.ac.normal.total,
          actor.system.attributes.ac.touch.total,
          actor.system.attributes.ac.flatFooted.total,
        ],
        bab: actor.system.attributes.bab.total,
        cmb: actor.system.attributes.cmb.total,
        saves: [
          actor.system.attributes.savingThrows.fort.total,
          actor.system.attributes.savingThrows.ref.total,
          actor.system.attributes.savingThrows.will.total,
        ],
        attack: [attack.name, attackBonus.total, attack.system.damage.parts[0][0]],
      });
    }
    return output;
  }, { packId: PACK, cases: CASES });

  expect(result).toEqual(CASES.map(({ id: _id, ...entry }) => entry));
});

test("alternative and repeated full attacks remain separate executable routines", async ({ page }) => {
  const result = await page.evaluate(async (packId) => {
    const pack = game.packs.get(packId);
    const readRoutines = async (name) => {
      const index = await pack.getIndex({ fields: ["name"] });
      const entry = index.find((document) => document.name === name);
      const source = await pack.getDocument(entry._id);
      const actor = await Actor.create(source.toObject());
      return actor.items.filter((item) => item.type === "full-attack").map((item) => ({
        name: item.name,
        attacks: Object.values(item.system.attacks).filter((slot) => slot.id).map((slot) => [slot.name, slot.count]),
      }));
    };
    return {
      archaedas: await readRoutines("Archaedas"),
      mechanostrider: await readRoutines("Mechanostrider"),
    };
  }, PACK);

  expect(result.archaedas.map((routine) => routine.attacks)).toEqual([
    [["+4 Axiomatic Greatsword", 1]],
    [["Slam", 2]],
    [["Rock", 1]],
  ]);
  expect(result.mechanostrider.map((routine) => routine.attacks)).toEqual([
    [["Bite", 1], ["Claws", 2]],
    [["Slam", 1]],
  ]);
});
