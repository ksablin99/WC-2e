import {
  effectiveWarcraftHitDie,
  filterEligibleProgressionClasses,
  isEligibleRacialClass,
  validateRacialProgressionRows,
} from "../../module/actor/helpers/racialProgressionHelper.js";

const racialClass = (id = "tauren", levels = 0) => ({
  id,
  name: "Tauren Racial Levels",
  type: "class",
  flags: { warcraftrpg2e: { racialClass: { race: "Tauren" } } },
  system: { classType: "racial", levels, maxLevel: 3 },
});

describe("racial class progression", () => {
  const taurenActor = { race: { name: "Tauren" } };

  it("applies Forsaken's future Hit Die increase after racial level 3", () => {
    expect(effectiveWarcraftHitDie(8, { forsakenRacialLevels: 2 })).toEqual({ die: 8, flat: 0 });
    expect(effectiveWarcraftHitDie(4, { forsakenRacialLevels: 3 })).toEqual({ die: 6, flat: 0 });
    expect(effectiveWarcraftHitDie(10, { forsakenRacialLevels: 3 })).toEqual({ die: 12, flat: 0 });
    expect(effectiveWarcraftHitDie(12, { forsakenRacialLevels: 3 })).toEqual({ die: 12, flat: 2 });
  });

  it("allows only the matching race and enforces the maximum", () => {
    expect(isEligibleRacialClass(taurenActor, racialClass())).toBe(true);
    expect(isEligibleRacialClass({ race: { name: "Orc" } }, racialClass())).toBe(false);
    expect(isEligibleRacialClass(taurenActor, racialClass("tauren", 3))).toBe(false);
  });

  it("leaves ordinary classes eligible", () => {
    expect(isEligibleRacialClass(taurenActor, { id: "warrior", type: "class", system: { classType: "base" } })).toBe(true);
  });

  it("filters a level-up selector using already planned rows", () => {
    const tauren = racialClass();
    const orc = { ...racialClass("orc"), name: "Orc Racial Levels", flags: { warcraftrpg2e: { racialClass: { race: "Orc" } } } };
    const warrior = { id: "warrior", type: "class", system: { classType: "base" } };
    expect(filterEligibleProgressionClasses(taurenActor, [tauren, orc, warrior], [
      { classId: "tauren" }, { classId: "tauren" }, { classId: "tauren" },
    ])).toEqual([warrior]);
  });

  it("reports race mismatch and levels above the cap", () => {
    const tauren = racialClass();
    const result = validateRacialProgressionRows({ race: { name: "Orc" } }, [tauren], [
      { classId: "tauren" }, { classId: "tauren" }, { classId: "tauren" }, { classId: "tauren" },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(expect.arrayContaining(["race-mismatch", "maximum-level"]));
  });
});
