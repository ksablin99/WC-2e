"use strict";

const { test, expect } = require("@playwright/test");
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require("./helpers");
const { openSheet } = require("./helpers/actor-sheet");

const BESTIARY_PACK = "warcraftrpg2e.warcraft-bestiary";
const HARVEST_GOLEM_ID = "wcHarvestGolem01";

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

async function importHarvestGolem(page) {
  return page.evaluate(async ({ packId, actorId }) => {
    const pack = game.packs.get(packId);
    if (!pack) throw new Error(`Missing compendium ${packId}`);
    const source = await pack.getDocument(actorId);
    if (!source) throw new Error(`Missing Harvest Golem ${actorId}`);
    const actor = await Actor.create(source.toObject());
    await actor.update({ "system.attributes.hp.value": 58 });
    return actor.id;
  }, { packId: BESTIARY_PACK, actorId: HARVEST_GOLEM_ID });
}

test("Harvest Golem imports with the printed statistics and renders corrected sheet totals", async ({ page }) => {
  const actorId = await importHarvestGolem(page);

  const prepared = await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    const sheetData = await actor.sheet.getData();
    return {
      abilities: Object.fromEntries(Object.entries(actor.system.abilities).map(([key, ability]) => [key, {
        value: ability.value,
        mod: ability.mod,
        isZero: ability.isZero,
      }])),
      ac: {
        normal: actor.system.attributes.ac.normal.total,
        touch: actor.system.attributes.ac.touch.total,
        flatFooted: actor.system.attributes.ac.flatFooted.total,
      },
      bab: actor.system.attributes.bab.total,
      cmb: actor.system.attributes.cmb.total,
      deathRule: actor.system.attributes.deathRule,
      fortification: actor.system.attributes.fortification.total,
      hd: actor.system.attributes.hd.total,
      hp: {
        value: actor.system.attributes.hp.value,
        max: actor.system.attributes.hp.max,
      },
      initiative: actor.system.attributes.init.total,
      itemNames: actor.items.map((item) => item.name),
      saves: Object.fromEntries(Object.entries(actor.system.attributes.savingThrows)
        .map(([key, save]) => [key, save.total])),
      senses: {
        darkvision: actor.system.attributes.senses.darkvision,
        lowLight: actor.system.attributes.senses.lowLight,
      },
      skillRanks: sheetData.skillRanks,
      speed: actor.system.attributes.speed.land.total,
      stealth: {
        abilityModifier: actor.system.skills.hid.abilityModifier,
        changeBonus: actor.system.skills.hid.changeBonus,
        mod: actor.system.skills.hid.mod,
        rank: actor.system.skills.hid.rank,
      },
    };
  }, actorId);

  expect(prepared).toMatchObject({
    abilities: {
      cha: { value: 1, mod: -5 },
      con: { value: 0, mod: 0, isZero: true },
      dex: { value: 14, mod: 2 },
      int: { value: 0, mod: 0, isZero: true },
      str: { value: 23, mod: 6 },
      wis: { value: 12, mod: 1 },
    },
    ac: { normal: 20, touch: 12, flatFooted: 18 },
    bab: 5,
    cmb: 11,
    deathRule: "warcraft-construct",
    fortification: 100,
    hd: 7,
    hp: { value: 58, max: 58 },
    initiative: 2,
    itemNames: expect.arrayContaining([
      "Backstab (Ex)",
      "Keen Claws (Ex)",
      "Immunity to Magic (Su)",
      "Lifeless Mien (Ex)",
      "Construct Traits",
    ]),
    saves: { fort: 2, ref: 4, will: 3 },
    senses: { darkvision: 60, lowLight: true },
    skillRanks: { allowed: 0, used: 0 },
    speed: 40,
    stealth: { abilityModifier: 2, changeBonus: 8, mod: 10, rank: 0 },
  });

  const sheetId = await openSheet(page, actorId);
  const sheet = page.locator(`#${sheetId}`);

  await sheet.locator('nav.sheet-navigation [data-tab="attacks"]').click({ force: true });
  const clawRow = sheet.locator('li.item[data-item-id="wcHvgClaw0000001"]:visible').first();
  await expect(clawRow).toBeVisible();
  const clawText = (await clawRow.textContent()).replace(/\s+/g, " ");
  expect(clawText).toContain("+12");
  expect(clawText).toMatch(/1d4\s*\+\s*6\s*\+\s*1|1d4\s*\+\s*7/);

  await sheet.locator('nav.sheet-navigation [data-tab="skills"]').click({ force: true });
  const stealthValue = sheet.locator('li.skill[data-skill="hid"] .skill-mod-total input');
  await expect(stealthValue).toHaveValue("+10");

  await sheet.locator('nav.sheet-navigation [data-tab="feats"]').click({ force: true });
  await sheet.locator("nav.sheet-navigation.feats > a", { hasText: /^Traits$/ }).click({ force: true });
  for (const [itemId, name] of [
    ["wcHvgBackstab001", "Backstab (Ex)"],
    ["wcHvgKeenClaw001", "Keen Claws (Ex)"],
    ["wcHvgMagicImmune", "Immunity to Magic (Su)"],
    ["wcHvgLifeless001", "Lifeless Mien (Ex)"],
    ["wcHvgTraits00001", "Construct Traits"],
  ]) {
    const featureRow = sheet.locator(`li.item[data-item-id="${itemId}"]:visible`).first();
    await expect(featureRow).toBeVisible();
    await expect(featureRow).toContainText(name);
  }
});

test("Harvest Golem claw rolls at +12, deals 1d4+7, and is linked to its rules", async ({ page }) => {
  const actorId = await importHarvestGolem(page);

  const result = await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    const claw = actor.items.get("wcHvgClaw0000001");
    const fullAttack = actor.items.get("wcHvgFullAtk0001");
    const backstab = actor.items.get("wcHvgBackstab001");

    const attackData = actor.getRollData();
    attackData.item = claw.getRollData();
    const attack = await claw.rolls.rollAttack({
      data: attackData,
      bonusOnly: true,
      primaryAttack: true,
      replacedEnh: claw.system.enh,
    });

    const damageData = actor.getRollData();
    damageData.item = claw.getRollData();
    const damage = await claw.rolls.rollDamage({
      data: damageData,
      primaryAttack: true,
      replacedEnh: claw.system.enh,
    });

    return {
      attackBonus: attack.total,
      critMult: claw.system.ability.critMult,
      critRange: claw.system.ability.critRange,
      damage: damage.map((part) => ({ base: part.base, formula: part.roll.formula, total: part.roll.total })),
      damageTotal: damage.reduce((sum, part) => sum + part.roll.total, 0),
      fullAttack: fullAttack.system.attacks.attack1,
      backstab: backstab.system.combatChanges,
      backstabAppliesOnce: backstab.system.combatChangesApplySpecialActionsOnce,
    };
  }, actorId);

  expect(result.attackBonus).toBe(12);
  expect(result.critRange).toBe(17);
  expect(result.critMult).toBe(2);
  expect(result.damage[0].base).toBe("1d4");
  expect(result.damage.slice(1).map((part) => part.total).sort((a, b) => a - b)).toEqual([1, 6]);
  expect(result.damageTotal).toBeGreaterThanOrEqual(8);
  expect(result.damageTotal).toBeLessThanOrEqual(11);
  expect(result.fullAttack).toMatchObject({
    attackMode: "primary",
    count: 2,
    id: "wcHvgClaw0000001",
    primary: true,
  });
  expect(result.backstab).toContainEqual([
    "attackOptional",
    "mwak",
    "",
    "&featDamage.precision",
    "2d6",
  ]);
  expect(result.backstabAppliesOnce).toBe(false);
});
