import {
  evaluateWarcraftFeatRequirements,
  normalizeWarcraftPrerequisiteText,
  validateWarcraftFeatAcquisition,
} from "../../module/item/helpers/warcraftFeatRequirements.js";

const feat = (name, prerequisite = "", extra = {}) => ({
  type: "feat",
  name,
  system: { uniqueId: `wc-${name.toLowerCase().replaceAll(" ", "-")}` },
  flags: { warcraftrpg2e: { feat: { prerequisite, repeatable: false, ...extra } } },
});
const actor = (items = []) => ({
  items,
  system: {
    abilities: { str: { total: 15 }, dex: { total: 17 }, con: { total: 12 }, int: { total: 13 }, wis: { total: 13 }, cha: { total: 10 } },
    attributes: { bab: { total: 6 }, hd: { total: 8 } },
    traits: { size: "med" },
    skills: { rid: { name: "Ride", rank: 4 }, blf: { name: "Bluff", rank: 2 } },
  },
});

describe("Warcraft feat prerequisite validation", () => {
  test("normalizes catalogue OCR and drops a known leaked tracking paragraph", () => {
    expect(normalizeWarcraftPrerequisiteText("Exotic Weapon Profi ciency (fi rearms). Firm Ground: leaked text"))
      .toBe("Exotic Weapon Proficiency (firearms).");
  });

  test("checks abilities, base attack bonus, skills, and owned feats", () => {
    const a = actor([feat("Power Attack"), feat("Dodge")]);
    expect(evaluateWarcraftFeatRequirements(feat("Spring Attack", "Agy 13, Dodge, Mobility, base attack bonus +4."), a))
      .toMatchObject({ valid: false, unmet: ["Mobility"] });
    expect(evaluateWarcraftFeatRequirements(feat("Expert Rider", "Agy 13, Ride 4 ranks."), a).valid).toBe(true);
    expect(evaluateWarcraftFeatRequirements(feat("Battle Language", "Bluff 3 ranks."), a).unmet).toEqual(["Bluff 3 ranks"]);
  });

  test("supports race/level alternatives and shout prerequisites", () => {
    const a = actor([feat("Battle Shout", "", { category: "Shout" })]);
    expect(evaluateWarcraftFeatRequirements(feat("Follower", "orc or tauren or character level 8+."), a).valid).toBe(true);
    expect(evaluateWarcraftFeatRequirements(feat("Mighty Lungs", "One shout feat."), a).valid).toBe(true);
  });

  test("rejects non-repeatable duplicates, conflicts, and duplicate repeatable selections", () => {
    const existing = feat("Weapon Focus", "", { repeatable: true, selectionKey: "longsword" });
    const a = actor([feat("Power Attack"), existing]);
    expect(validateWarcraftFeatAcquisition(feat("Power Attack"), a).errors).toContain("Power Attack is not repeatable");
    expect(validateWarcraftFeatAcquisition(feat("Pacifist", "", { conflicts: ["Power Attack"] }), a).errors[0]).toMatch(/conflicts/i);
    expect(validateWarcraftFeatAcquisition(feat("Weapon Focus", "", { repeatable: true, selectionKey: "longsword" }), a).errors[0]).toMatch(/selection/i);
  });
});
