import { warcraftRestHitPointRecovery } from "../../module/actor/helpers/warcraftNaturalRecovery.js";

describe("Warcraft natural recovery", () => {
  it("uses normal Warcraft and long-term-care rates", () => {
    expect(warcraftRestHitPointRecovery({ hitDice: 6, raceName: "Human" })).toBe(6);
    expect(warcraftRestHitPointRecovery({ hitDice: 6, raceName: "Human", longTermCare: true })).toBe(12);
  });

  it("doubles recovery for a baseline jungle troll", () => {
    expect(warcraftRestHitPointRecovery({ hitDice: 6, raceName: "Jungle Troll" })).toBe(12);
  });

  it("uses Stamina modifier per hour at jungle troll racial level 1", () => {
    expect(warcraftRestHitPointRecovery({
      hitDice: 6,
      staminaModifier: 3,
      raceName: "Jungle Troll",
      racialClassLevels: 1,
      hours: 8,
    })).toBe(24);
  });

  it("does not stack rest healing with continuous fast healing", () => {
    expect(warcraftRestHitPointRecovery({
      hitDice: 6,
      staminaModifier: 3,
      raceName: "Jungle Troll",
      racialClassLevels: 2,
    })).toBe(0);
  });
});
