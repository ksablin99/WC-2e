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
