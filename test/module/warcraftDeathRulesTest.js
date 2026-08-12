import {
  classifyWarcraftHealth,
  DEATH_RULE_D35E,
  DEATH_RULE_FORSAKEN,
  DEATH_RULE_WARCRAFT,
  DEATH_RULE_WARCRAFT_CONSTRUCT,
  DEATH_RULE_WARCRAFT_UNDEAD,
  resolveDeathRule,
  resolveWarcraftStabilization,
  resolveWarcraftStableRecovery,
  succeedsWarcraftStaminaPercentile,
  usesNaturalHitPointRecovery,
  warcraftStabilizationDc,
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

    it("treats construct creature type as authoritative for legacy actors", () => {
      expect(resolveDeathRule(DEATH_RULE_D35E, null, "Construct")).toBe(DEATH_RULE_WARCRAFT_CONSTRUCT);
      expect(usesNaturalHitPointRecovery(DEATH_RULE_D35E, null, "construct")).toBe(false);
    });

    it("uses the generic Warcraft undead track without overriding Forsaken", () => {
      expect(resolveDeathRule(DEATH_RULE_WARCRAFT, null, "undead")).toBe(DEATH_RULE_WARCRAFT_UNDEAD);
      expect(resolveDeathRule(DEATH_RULE_FORSAKEN, null, "undead")).toBe(DEATH_RULE_FORSAKEN);
      expect(usesNaturalHitPointRecovery(DEATH_RULE_WARCRAFT, null, "undead")).toBe(false);
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

    it("keeps a stable creature unconscious without marking it dying", () => {
      expect(
        classifyWarcraftHealth({ hitPoints: -5, staminaScore: 14, deathRule: DEATH_RULE_WARCRAFT, stable: true })
      ).toMatchObject({ disabled: false, dying: false, dead: false, unconscious: true });
    });
  });

  describe("Forsaken", () => {
    const classify = (hitPoints) =>
      classifyWarcraftHealth({ hitPoints, staminaScore: 30, deathRule: DEATH_RULE_FORSAKEN });

    it.each([
      [1, { disabled: false, dying: false, dead: false }],
      [0, { disabled: true, dying: false, dead: false }],
      [-1, { disabled: false, dying: false, down: true, unconscious: true, dead: false }],
      [-9, { disabled: false, dying: false, down: true, unconscious: true, dead: false }],
      [-10, { disabled: false, dying: false, dead: true }],
    ])("classifies %i HP without using Stamina", (hitPoints, expected) => {
      expect(classify(hitPoints)).toMatchObject(expected);
      expect(classify(hitPoints).usesStamina).toBe(false);
    });
  });

  describe("stabilization and recovery", () => {
    it("uses 10 plus negative hit points as the Heal DC", () => {
      expect(warcraftStabilizationDc(2)).toBe(10);
      expect(warcraftStabilizationDc(-11)).toBe(21);
    });

    it("succeeds on a d% result equal to the Stamina score", () => {
      expect(succeedsWarcraftStaminaPercentile(16, 16)).toBe(true);
      expect(succeedsWarcraftStaminaPercentile(17, 16)).toBe(false);
    });

    it("stabilizes on success and loses 1 HP on failure", () => {
      expect(resolveWarcraftStabilization({ hitPoints: -3, staminaScore: 14, roll: 14 })).toMatchObject({
        attempted: true,
        success: true,
        hitPoints: -3,
        stable: true,
        dying: false,
      });
      expect(resolveWarcraftStabilization({ hitPoints: -14, staminaScore: 14, roll: 15 })).toMatchObject({
        attempted: true,
        success: false,
        hitPoints: -15,
        dead: true,
      });
    });

    it("does not damage a tended stable creature on a failed recovery roll", () => {
      expect(resolveWarcraftStableRecovery({ hitPoints: -5, staminaScore: 14, roll: 50, tended: true })).toMatchObject({
        success: false,
        hitPoints: -5,
        stable: true,
      });
      expect(resolveWarcraftStableRecovery({ hitPoints: -5, staminaScore: 14, roll: 50, tended: false })).toMatchObject({
        success: false,
        hitPoints: -6,
        stable: true,
      });
    });

    it("moves a successful hourly recovery to the disabled HP boundary", () => {
      expect(resolveWarcraftStableRecovery({ hitPoints: -5, staminaScore: 14, roll: 14 })).toMatchObject({
        success: true,
        conscious: true,
        hitPoints: -2,
        disabled: true,
        stable: false,
        dying: false,
        unconscious: false,
      });
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

  describe("generic undead", () => {
    const classify = (hitPoints) =>
      classifyWarcraftHealth({ hitPoints, staminaScore: 30, deathRule: DEATH_RULE_WARCRAFT_UNDEAD });

    it.each([
      [1, { disabled: false, dying: false, dead: false }],
      [0, { disabled: false, dying: false, dead: true }],
      [-1, { disabled: false, dying: false, dead: true }],
    ])("classifies %i HP as destroyed at zero", (hitPoints, expected) => {
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
