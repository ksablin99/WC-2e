import { evaluateWarcraftPrerequisites } from "../../module/item/helpers/warcraftPrerequisiteHelper.js";

describe("Warcraft typed prerequisites", () => {
  const actor = {
    system: {
      abilities: { dex: { total: 16 } },
      attributes: { bab: { total: 6 } },
      skills: { tum: { rank: 5 } },
      details: { race: "Night Elf", affiliation: "Alliance", alignment: "Chaotic Good" },
    },
    items: [
      { type: "feat", name: "Dodge", system: {} },
      { type: "class", name: "Arcanist", system: { customTag: "arcanist", levels: 5, pathLevels: { mage: 4 } } },
    ],
  };

  it("evaluates numeric, item, identity, and path requirements", () => {
    const result = evaluateWarcraftPrerequisites(
      [
        { type: "ability", key: "dex", minimum: 13 },
        { type: "bab", minimum: 6 },
        { type: "skill", key: "tum", minimum: 5 },
        { type: "feat", name: "Dodge" },
        { type: "race", value: "Night Elf" },
        { type: "path", parentClass: "Arcanist", key: "Mage", minimum: 4 },
      ],
      actor
    );
    expect(result.met).toBe(true);
    expect(result.unmet).toEqual([]);
  });

  it("keeps narrative gates explicit and manual", () => {
    const result = evaluateWarcraftPrerequisites([{ type: "manual", label: "Complete a sanctioned duel" }], actor);
    expect(result.met).toBe(false);
    expect(result.automatedMet).toBe(true);
    expect(result.unmet[0].label).toBe("Complete a sanctioned duel");
  });

  it("supports nested any/all requirements", () => {
    expect(
      evaluateWarcraftPrerequisites(
        [{ type: "any", requirements: [{ type: "race", value: "Orc" }, { type: "affiliation", value: "Alliance" }] }],
        actor
      ).met
    ).toBe(true);
  });

  it("supports count requirements without reducing them to prose", () => {
    actor.system.skills.blf = { rank: 8 };
    actor.system.skills.dip = { rank: 8 };
    expect(
      evaluateWarcraftPrerequisites(
        [{ type: "skill-count", skills: ["blf", "dip", "dis"], minimum: 8, count: 2 }],
        actor
      ).met
    ).toBe(true);
  });

  it("derives castable spell level from actual slots instead of caster level", () => {
    actor.system.attributes.spells = {
      spellbooks: {
        primary: {
          spellcastingType: "arcane",
          cl: { total: 20 },
          spells: { spell6: { max: 2 }, spell7: { max: 0 } },
        },
      },
    };
    expect(
      evaluateWarcraftPrerequisites(
        [{ type: "spell-level", spellcastingType: "arcane", minimum: 7 }],
        actor
      ).met
    ).toBe(false);
    actor.system.attributes.spells.spellbooks.primary.spells.spell7.max = 1;
    expect(
      evaluateWarcraftPrerequisites(
        [{ type: "spell-level", spellcastingType: "arcane", minimum: 7 }],
        actor
      ).met
    ).toBe(true);
  });

  it("supports explicit exclusions for barred paths", () => {
    const exclusion = {
      type: "not",
      requirement: { type: "path", parentClass: "Arcanist", key: "warlock", minimum: 1 },
    };
    expect(evaluateWarcraftPrerequisites([exclusion], actor).met).toBe(true);
    actor.items[1].system.pathLevels.warlock = 1;
    expect(evaluateWarcraftPrerequisites([exclusion], actor).met).toBe(false);
  });
});
