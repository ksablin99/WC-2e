"use strict";

const { test, expect } = require("@playwright/test");
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require("./helpers");

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test("repertoire capacity, pooled casting, and rest preserve membership", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Warcraft Repertoire Caster",
      type: "character",
      system: {
        abilities: { int: { value: 10 } },
        skills: { spl: { rank: 0 } },
      },
    });

    const bookPath = "system.attributes.spells.spellbooks.primary";
    await actor.update({
      [`${bookPath}.autoSetup`]: false,
      [`${bookPath}.autoSpellLevels`]: false,
      [`${bookPath}.ability`]: "int",
      [`${bookPath}.preparationMode`]: "repertoire",
      [`${bookPath}.repertoireSkill`]: "spl",
      [`${bookPath}.spontaneous`]: false,
      [`${bookPath}.spells.spell1.base`]: 3,
    });
    await actor.update({ [`${bookPath}.spells.spell1.value`]: 3 });

    const spells = await actor.createEmbeddedDocuments(
      "Item",
      Array.from({ length: 4 }, (_, index) => ({
        name: `Repertoire Spell ${index + 1}`,
        type: "spell",
        system: {
          spellbook: "primary",
          level: 1,
          preparation: {
            mode: "prepared",
            prepared: false,
            preparedAmount: 0,
            maxAmount: 0,
          },
          description: { value: `Repertoire test spell ${index + 1}` },
        },
      }))
    );

    const spellEvent = (spellId) => ({
      preventDefault() {},
      currentTarget: {
        closest() {
          return { getAttribute: () => spellId };
        },
      },
    });

    for (const spell of spells) await actor.sheet._onSpellAddUses(spellEvent(spell.id));

    const preparedAfterCapacityCheck = spells.map((spell) => actor.items.get(spell.id).system.preparation.prepared);
    const poolBeforeRejectedCast = actor.system.attributes.spells.spellbooks.primary.spells.spell1.value;
    await actor.items.get(spells[3].id).use({ skipDialog: true });
    const poolAfterRejectedCast = actor.system.attributes.spells.spellbooks.primary.spells.spell1.value;

    await actor.items.get(spells[0].id).use({ skipDialog: true });
    const poolAfterPreparedCast = actor.system.attributes.spells.spellbooks.primary.spells.spell1.value;
    const membershipAfterCast = actor.items.get(spells[0].id).system.preparation.prepared;

    actor.rest(false, true, false);
    for (let attempt = 0; attempt < 30; attempt++) {
      if (actor.system.attributes.spells.spellbooks.primary.spells.spell1.value === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const poolAfterRest = actor.system.attributes.spells.spellbooks.primary.spells.spell1.value;
    const membershipAfterRest = actor.items.get(spells[0].id).system.preparation.prepared;

    await actor.sheet._onSpellRemoveUses(spellEvent(spells[0].id));
    const membershipAfterUnprepare = actor.items.get(spells[0].id).system.preparation.prepared;

    return {
      preparedAfterCapacityCheck,
      poolBeforeRejectedCast,
      poolAfterRejectedCast,
      poolAfterPreparedCast,
      membershipAfterCast,
      poolAfterRest,
      membershipAfterRest,
      membershipAfterUnprepare,
    };
  });

  expect(result.preparedAfterCapacityCheck).toEqual([true, true, true, false]);
  expect(result.poolAfterRejectedCast).toBe(result.poolBeforeRejectedCast);
  expect(result.poolAfterPreparedCast).toBe(result.poolBeforeRejectedCast - 1);
  expect(result.membershipAfterCast).toBe(true);
  expect(result.poolAfterRest).toBe(3);
  expect(result.membershipAfterRest).toBe(true);
  expect(result.membershipAfterUnprepare).toBe(false);
});

test("ability-keyed pools combine slots, substitute upward, and keep repertoires separate", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Warcraft Multiclass Pools",
      type: "character",
      system: { abilities: { int: { value: 18 } }, skills: { spl: { rank: 8 } } },
    });
    const update = {};
    for (const [key, first, second] of [["primary", 1, 0], ["secondary", 2, 1]]) {
      const root = `system.attributes.spells.spellbooks.${key}`;
      update[`${root}.autoSetup`] = false;
      update[`${root}.autoSpellLevels`] = false;
      update[`${root}.ability`] = "int";
      update[`${root}.spellslotAbility`] = "int";
      update[`${root}.preparationMode`] = "repertoire";
      update[`${root}.repertoireSkill`] = "spl";
      update[`${root}.usesWarcraftSlotPool`] = true;
      update[`${root}.warcraftPoolKey`] = "int";
      update[`${root}.spells.spell1.base`] = first;
      update[`${root}.spells.spell2.base`] = second;
    }
    await actor.update(update);
    await actor.update({
      "system.attributes.spells.warcraftPools.int.spells.spell1.value": 0,
      "system.attributes.spells.warcraftPools.int.spells.spell2.value": 1,
    });
    const [primarySpell, secondarySpell] = await actor.createEmbeddedDocuments("Item", [
      {
        name: "Primary Repertoire Spell",
        type: "spell",
        system: { spellbook: "primary", level: 1, preparation: { mode: "prepared", prepared: true } },
      },
      {
        name: "Secondary Repertoire Spell",
        type: "spell",
        system: { spellbook: "secondary", level: 1, preparation: { mode: "prepared", prepared: false } },
      },
    ]);
    const before = foundry.utils.duplicate(actor.system.attributes.spells.warcraftPools.int);
    await actor.items.get(primarySpell.id).use({ skipDialog: true });
    const after = foundry.utils.duplicate(actor.system.attributes.spells.warcraftPools.int);
    return {
      max1: before.spells.spell1.max,
      max2: before.spells.spell2.max,
      after1: after.spells.spell1.value,
      after2: after.spells.spell2.value,
      primaryPrepared: actor.items.get(primarySpell.id).system.preparation.prepared,
      secondaryPrepared: actor.items.get(secondarySpell.id).system.preparation.prepared,
    };
  });

  expect(result.max1).toBe(3);
  expect(result.max2).toBe(1);
  expect(result.after1).toBe(0);
  expect(result.after2).toBe(0);
  expect(result.primaryPrepared).toBe(true);
  expect(result.secondaryPrepared).toBe(false);
});

test("level-zero Arcanist path slots and Healer domain slots remain restricted and refill on rest", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: "Restricted Spell Slots", type: "character" });
    const [arcanist] = await actor.createEmbeddedDocuments("Item", [{
      name: "Arcanist",
      type: "class",
      system: {
        classType: "base",
        levels: 1,
        classPaths: { enabled: true, default: "mage", choices: [{ id: "mage", name: "Mage" }] },
        pathLevels: { mage: 1 },
        currentPath: "mage",
      },
    }]);
    await actor.update({
      "system.attributes.spells.spellbooks.primary.class": "arcanist",
      "system.attributes.spells.spellbooks.primary.hasSpecialSlot": true,
      "system.attributes.spells.spellbooks.primary.warcraftPathBonusSlot": true,
      "system.attributes.spells.spellbooks.primary.specialSlotLevel0": true,
      "system.attributes.spells.spellbooks.primary.preparationMode": "repertoire",
    });
    const [pathSpell, generalSpell, domainSpell] = await actor.createEmbeddedDocuments("Item", [
      {
        name: "Mage Cantrip",
        type: "spell",
        system: {
          spellbook: "primary", level: 0, warcraftLearnedPath: "mage",
          learnedAt: { class: [["Mage", 0]] },
          preparation: { mode: "prepared", prepared: true },
        },
      },
      {
        name: "General Cantrip",
        type: "spell",
        system: {
          spellbook: "primary", level: 0,
          learnedAt: { class: [["Arcanist", 0]] },
          preparation: { mode: "prepared", prepared: true },
        },
      },
      {
        name: "Domain Spell",
        type: "spell",
        system: { spellbook: "primary", level: 1, isDomainSpell: true, preparation: { mode: "prepared" } },
      },
    ]);
    const eventFor = (id, level = 0) => ({
      preventDefault() {},
      currentTarget: {
        closest(selector) {
          if (selector === ".spellbook-group") return { dataset: { tab: "primary" } };
          if (selector === ".spellbook-list") return { getAttribute: () => String(level) };
          if (selector === ".item") return { getAttribute: () => id };
          return null;
        },
      },
    });
    await actor.sheet._onSpellPrepareSpecialUses(eventFor(generalSpell.id));
    const rejectedGeneral = actor.system.attributes.spells.spellbooks.primary.specialSlots.level0 || "";
    await actor.sheet._onSpellPrepareSpecialUses(eventFor(pathSpell.id));
    const specialId = actor.system.attributes.spells.spellbooks.primary.specialSlots.level0;
    const special = actor.items.get(specialId);
    await special.use({ skipDialog: true });
    const afterCast = actor.items.get(specialId).system.preparation.preparedAmount;
    await actor.rest(false, true, false);
    const afterRest = actor.items.get(specialId).system.preparation.preparedAmount;

    await actor.update({ "system.attributes.spells.spellbooks.primary.warcraftPathBonusSlot": false });
    await actor.sheet._onSpellPrepareSpecialUses(eventFor(generalSpell.id, 1));
    const rejectedNonDomain = actor.system.attributes.spells.spellbooks.primary.specialSlots.level1 || "";
    await actor.sheet._onSpellPrepareSpecialUses(eventFor(domainSpell.id, 1));
    const acceptedDomain = actor.system.attributes.spells.spellbooks.primary.specialSlots.level1 || "";
    return { rejectedGeneral, specialId, afterCast, afterRest, rejectedNonDomain, acceptedDomain };
  });

  expect(result.rejectedGeneral).toBe("");
  expect(result.specialId).toBeTruthy();
  expect(result.afterCast).toBe(0);
  expect(result.afterRest).toBe(1);
  expect(result.rejectedNonDomain).toBe("");
  expect(result.acceptedDomain).toBeTruthy();
});
