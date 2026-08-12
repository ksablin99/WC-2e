import {
  canApplyWarcraftAbilityDamage,
  canApplyWarcraftAbilityDrain,
  CONSTRUCT_IMMUNITIES,
  constructSizeHitPoints,
  FORSAKEN_IMMUNITIES,
  resolveWarcraftCreatureProfile,
  signedWarcraftEnergyDamage,
  UNDEAD_IMMUNITIES,
} from "../../module/actor/helpers/warcraftCreatureRules.js";
import {
  DEATH_RULE_FORSAKEN,
  DEATH_RULE_WARCRAFT,
  DEATH_RULE_WARCRAFT_CONSTRUCT,
  DEATH_RULE_WARCRAFT_UNDEAD,
} from "../../module/actor/helpers/warcraftDeathRules.js";

describe("Warcraft creature rules", () => {
  it.each([
    ["fine", 0], ["dim", 0], ["tiny", 0], ["sm", 10], ["med", 20],
    ["lg", 30], ["huge", 40], ["grg", 60], ["col", 80],
  ])("gives %s constructs %i bonus hit points", (size, expected) => {
    expect(constructSizeHitPoints(size)).toBe(expected);
  });

  it("generalizes the construct immunities and healing profile", () => {
    expect(resolveWarcraftCreatureProfile({ creatureType: "construct" })).toMatchObject({
      construct: true,
      noConstitution: true,
      naturalHealing: false,
      repairHealingHeals: true,
      criticalAndPrecisionImmune: true,
    });
    expect(CONSTRUCT_IMMUNITIES).toEqual(expect.arrayContaining([
      "Strength and Agility damage",
      "ability damage",
      "necromancy effects",
      "effects requiring Fortitude saves unless they affect objects or are harmless",
    ]));
  });

  it("encodes the Forsaken healing reversal and Charisma concentration", () => {
    expect(resolveWarcraftCreatureProfile({ deathRule: DEATH_RULE_FORSAKEN })).toMatchObject({
      forsaken: true,
      concentrationAbility: "cha",
      naturalHealing: false,
      positiveEnergyHeals: false,
      negativeEnergyHeals: true,
    });
    expect(FORSAKEN_IMMUNITIES).toContain("nonlethal damage");
    expect(FORSAKEN_IMMUNITIES).toContain(
      "effects requiring Fortitude saves unless they affect objects or are harmless",
    );
  });

  it("gives generic undead a distinct destroyed-at-zero creature profile", () => {
    expect(resolveWarcraftCreatureProfile({ deathRule: DEATH_RULE_WARCRAFT_UNDEAD })).toMatchObject({
      undead: true,
      forsaken: false,
      noConstitution: true,
      naturalHealing: false,
      negativeEnergyHeals: true,
      criticalAndPrecisionImmune: true,
    });
    expect(UNDEAD_IMMUNITIES).toContain("ability drain");
    expect(canApplyWarcraftAbilityDamage({ creatureType: "undead", ability: "str" })).toBe(false);
    expect(canApplyWarcraftAbilityDamage({ creatureType: "undead", ability: "wis" })).toBe(true);
    expect(canApplyWarcraftAbilityDrain({ creatureType: "undead" })).toBe(false);
  });

  it.each([
    [{ amount: 8, damageType: "positive", deathRule: DEATH_RULE_WARCRAFT }, -8],
    [{ amount: 8, damageType: "negative", deathRule: DEATH_RULE_FORSAKEN }, -8],
    [{ amount: 8, damageType: "positive", deathRule: DEATH_RULE_FORSAKEN }, 8],
    [{ amount: 8, damageType: "healing", deathRule: DEATH_RULE_FORSAKEN }, 8],
    [{ amount: 8, damageType: "healing", creatureType: "construct" }, 0],
    [{ amount: 8, damageType: "positive", creatureType: "construct" }, 0],
    [{ amount: 8, damageType: "damage-repair", deathRule: DEATH_RULE_WARCRAFT_CONSTRUCT }, -8],
    [{ amount: 8, damageType: "negative", deathRule: DEATH_RULE_WARCRAFT_CONSTRUCT }, 0],
    [{ amount: 8, damageType: "negative", deathRule: DEATH_RULE_WARCRAFT_UNDEAD }, -8],
  ])("applies signed energy damage", (input, expected) => {
    expect(signedWarcraftEnergyDamage(input)).toBe(expected);
  });

  it("applies the narrower printed Forsaken ability-loss immunities", () => {
    expect(canApplyWarcraftAbilityDamage({ deathRule: DEATH_RULE_FORSAKEN, ability: "str" })).toBe(false);
    expect(canApplyWarcraftAbilityDamage({ deathRule: DEATH_RULE_FORSAKEN, ability: "dex" })).toBe(false);
    expect(canApplyWarcraftAbilityDamage({ deathRule: DEATH_RULE_FORSAKEN, ability: "int" })).toBe(true);
    expect(canApplyWarcraftAbilityDrain({ deathRule: DEATH_RULE_FORSAKEN })).toBe(false);
    expect(canApplyWarcraftAbilityDamage({ creatureType: "construct", ability: "wis" })).toBe(false);
  });
});
