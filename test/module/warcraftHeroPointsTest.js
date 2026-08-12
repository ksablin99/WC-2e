import {
  HERO_POINT_OPTIONS,
  buildHeroPointSpendUpdate,
  calledShotEffect,
  canSpendHeroPoint,
  heroPointRollBonus,
  resolveHeroAttackOption,
  shoutDurationRounds,
  shoutResolution,
  shoutSaveDc,
} from "../../module/actor/helpers/warcraftHeroPoints.js";

const actor = (value = 2, pending = null) => ({
  system: { attributes: { heroPoints: { value, max: 3 } } },
  flags: { warcraftrpg2e: { heroPoint: { pending } } },
});

describe("Warcraft Hero Points", () => {
  test("defines source-backed general and Intimidating Shout choices", () => {
    expect(HERO_POINT_OPTIONS.intimidatingShout).toBeDefined();
    expect(HERO_POINT_OPTIONS.extraShout).toBeDefined();
    expect(HERO_POINT_OPTIONS.powerfulBlow.rollKind).toBe("attack");
  });

  test("calculates printed shout duration, save DC, Intimidate synergy, and Hero Point variants", () => {
    const shouter = {
      system: {
        details: { level: { value: 9 } },
        abilities: { cha: { mod: 3 } },
        skills: { int: { rank: 5 } },
      },
      items: [],
    };
    expect(shoutDurationRounds(shouter)).toBe(4);
    expect(shoutSaveDc(shouter, "Challenging Shout")).toBe(17);
    expect(shoutSaveDc(shouter, "Intimidating Shout")).toBe(19);
    expect(shoutResolution(shouter, "Battle Shout")).toMatchObject({ radius: 30, durationRounds: 4 });
    expect(shoutResolution(shouter, "Intimidating Shout", { heroPoint: true })).toMatchObject({ condition: "panicked", durationRounds: "1d6" });
  });

  test("spends once and stores a pending before-roll choice", () => {
    const result = buildHeroPointSpendUpdate(actor(), "savingThrow");
    expect(result.valid).toBe(true);
    expect(result.update["system.attributes.heroPoints.value"]).toBe(1);
    expect(result.update["flags.warcraftrpg2e.heroPoint.pending"].option).toBe("savingThrow");
  });

  test("does not overwrite a pending choice or spend below zero", () => {
    expect(canSpendHeroPoint(actor(2, { option: "attack" }), "d20").valid).toBe(false);
    expect(canSpendHeroPoint(actor(0), "d20").valid).toBe(false);
  });

  test("matches roll categories and exposes called-shot durations", () => {
    expect(heroPointRollBonus(actor(1, { option: "d20" }), "d20")).toBe(20);
    expect(heroPointRollBonus(actor(1, { option: "savingThrow" }), "save")).toBe(20);
    expect(calledShotEffect("calledShotEyes")).toEqual({ condition: "blinded", duration: "1d10+4 rounds" });
  });

  test("unmodified hit controls powerful blows and called shots", () => {
    expect(resolveHeroAttackOption({ option: "powerfulBlow", modifiedTotal: 35, targetArmorClasses: [14], natural: 12 }))
      .toMatchObject({ baseTotal: 15, specialEligible: true });
    expect(resolveHeroAttackOption({ option: "calledShotHead", modifiedTotal: 32, targetArmorClasses: [18], natural: 12 }))
      .toMatchObject({ baseTotal: 12, specialEligible: false });
    expect(resolveHeroAttackOption({ option: "calledShotHead", modifiedTotal: 32, targetArmorClasses: [], natural: 12 }).manual).toBe(true);
  });
});
