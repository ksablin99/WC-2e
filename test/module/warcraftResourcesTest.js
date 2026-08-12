import { countDistinctShoutFeats, countMightyLungsBonusUses, deriveShoutUses } from "../../module/actor/helpers/warcraftResources.js";

const feat = (name, category = "Shout", uniqueId = `wc-${name}`) => ({
  type: "feat",
  name,
  flags: { warcraftrpg2e: { feat: { category } } },
  system: { uniqueId },
});

describe("Warcraft shared character resources", () => {
  test("counts distinct shout feats and ignores other items", () => {
    expect(countDistinctShoutFeats([
      feat("Battle Shout"), feat("Demoralizing Shout"), feat("Battle Shout", "Shout", "wc-Battle Shout"),
      feat("Power Attack", "General"), { type: "weapon", name: "Shouty Axe" },
    ])).toBe(2);
  });

  test("derives the shared daily maximum and clamps spent uses", () => {
    const items = [feat("Battle Shout"), feat("Demoralizing Shout"), feat("Intimidating Shout")];
    expect(deriveShoutUses(items, 2)).toEqual({ value: 2, max: 3 });
    expect(deriveShoutUses(items, 7)).toEqual({ value: 3, max: 3 });
    expect(deriveShoutUses([], -1)).toEqual({ value: 0, max: 0 });
  });

  test("adds two daily uses for each repeatable Mighty Lungs feat", () => {
    const items = [feat("Battle Shout"), feat("Mighty Lungs", "General", "mighty-1"), feat("Mighty Lungs", "General", "mighty-2")];
    expect(countMightyLungsBonusUses(items)).toBe(4);
    expect(deriveShoutUses(items, 99)).toEqual({ value: 5, max: 5 });
  });
});
