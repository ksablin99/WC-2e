import {
  classifyWarcraftHealth,
  DEATH_RULE_D35E,
  DEATH_RULE_FORSAKEN,
  DEATH_RULE_WARCRAFT,
  DEATH_RULE_WARCRAFT_CONSTRUCT,
  resolveDeathRule,
  usesNaturalHitPointRecovery,
} from "../../module/actor/helpers/warcraftDeathRules.js";

describe("Warcraft death rules", () => {
  describe("resolveDeathRule", () => {
    it("preserves D35E rules when no Warcraft rule is selected", () => {
      expect(resolveDeathRule(undefined, undefined)).toBe(DEATH_RULE_D35E);
      expect(resolveDeathRule("unknown", "unknown")).toBe(DEATH_RULE_D35E);
    });

    it("accepts an actor rule before a race rule", () => {
      expect(resolveDeathRule(DEATH_RULE_WARCRAFT, DEATH_RULE_FORSAKEN)).toBe(DEATH_RULE_WARCRAFT);
    });

    it("uses a Warcraft race marker when the actor has no Warcraft override", () => {
      expect(resolveDeathRule(DEATH_RULE_D35E, DEATH_RULE_FORSAKEN)).toBe(DEATH_RULE_FORSAKEN);
      expect(resolveDeathRule(null, DEATH_RULE_FORSAKEN)).toBe(DEATH_RULE_FORSAKEN);
      expect(resolveDeathRule(DEATH_RULE_WARCRAFT_CONSTRUCT, null)).toBe(DEATH_RULE_WARCRAFT_CONSTRUCT);
    });

    it("prevents Forsaken and constructs from recovering hit points naturally", () => {
      expect(usesNaturalHitPointRecovery(DEATH_RULE_D35E, "")).toBe(true);
      expect(usesNaturalHitPointRecovery(DEATH_RULE_WARCRAFT, "")).toBe(true);
      expect(usesNaturalHitPointRecovery(DEATH_RULE_D35E, DEATH_RULE_FORSAKEN)).toBe(false);
      expect(usesNaturalHitPointRecovery(DEATH_RULE_WARCRAFT_CONSTRUCT, "")).toBe(false);
    });
  });

  describe("living creatures", () => {
    const classify = (hitPoints, staminaScore = 14) =>
      classifyWarcraftHealth({ hitPoints, staminaScore, deathRule: DEATH_RULE_WARCRAFT });

    it.each([
      [1, { disabled: false, dying: false, dead: false }],
      [0, { disabled: true, dying: false, dead: false }],
      [-2, { disabled: true, dying: false, dead: false }],
      [-3, { disabled: false, dying: true, dead: false }],
      [-14, { disabled: false, dying: true, dead: false }],
      [-15, { disabled: false, dying: false, dead: true }],
    ])("classifies %i HP with Stamina 14", (hitPoints, expected) => {
      expect(classify(hitPoints)).toMatchObject(expected);
      expect(classify(hitPoints).usesStamina).toBe(true);
    });

    it("uses only 0 HP as disabled when the Stamina modifier is negative", () => {
      expect(classify(0, 8)).toMatchObject({ disabled: true, dying: false, dead: false });
      expect(classify(-1, 8)).toMatchObject({ disabled: false, dying: true, dead: false });
      expect(classify(-8, 8)).toMatchObject({ disabled: false, dying: true, dead: false });
      expect(classify(-9, 8)).toMatchObject({ disabled: false, dying: false, dead: true });
    });
  });

  describe("Forsaken", () => {
    const classify = (hitPoints) =>
      classifyWarcraftHealth({ hitPoints, staminaScore: 30, deathRule: DEATH_RULE_FORSAKEN });

    it.each([
      [1, { disabled: false, dying: false, dead: false }],
      [0, { disabled: true, dying: false, dead: false }],
      [-1, { disabled: false, dying: true, dead: false }],
      [-9, { disabled: false, dying: true, dead: false }],
      [-10, { disabled: false, dying: false, dead: true }],
    ])("classifies %i HP without using Stamina", (hitPoints, expected) => {
      expect(classify(hitPoints)).toMatchObject(expected);
      expect(classify(hitPoints).usesStamina).toBe(false);
    });
  });

  describe("constructs", () => {
    const classify = (hitPoints) =>
      classifyWarcraftHealth({ hitPoints, staminaScore: 30, deathRule: DEATH_RULE_WARCRAFT_CONSTRUCT });

    it.each([
      [1, { disabled: false, dying: false, dead: false }],
      [0, { disabled: false, dying: false, dead: true }],
      [-1, { disabled: false, dying: false, dead: true }],
    ])("classifies %i HP without disabled or dying states", (hitPoints, expected) => {
      expect(classify(hitPoints)).toMatchObject(expected);
      expect(classify(hitPoints).usesStamina).toBe(false);
    });
  });

  it("rejects accidental use for legacy rules", () => {
    expect(() => classifyWarcraftHealth({ hitPoints: 0, staminaScore: 10, deathRule: DEATH_RULE_D35E })).toThrow(
      "Unsupported Warcraft death rule"
    );
  });
});
