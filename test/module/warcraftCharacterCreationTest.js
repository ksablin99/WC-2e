import {
  firstLevelSkillPoints,
  pointBuySpent,
  skillPointCost,
  validateCharacterCreationPlan,
  validateSkillAllocation,
} from "../../module/actor/helpers/warcraftCharacterCreation.js";

describe("guided Warcraft character creation", () => {
  test("uses the 3.5 point-buy progression", () => {
    expect(pointBuySpent({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 })).toBe(8 + 6 + 5 + 4 + 2);
  });

  test("calculates first-level and human bonus skill points", () => {
    expect(firstLevelSkillPoints({ skillsPerLevel: 2, intellect: 14 })).toBe(16);
    expect(firstLevelSkillPoints({ skillsPerLevel: 2, intellect: 14, human: true })).toBe(20);
  });

  test("charges double for cross-class ranks and enforces starting caps", () => {
    const skills = { clm: 4, spl: 2 };
    expect(skillPointCost(skills, { clm: true, spl: false })).toBe(8);
    expect(validateSkillAllocation({ clm: 5 }, { clm: true }, 20).valid).toBe(false);
  });

  test("returns actionable plan errors", () => {
    const result = validateCharacterCreationPlan({
      raceId: "human", classId: "warrior", pointBuyBudget: 25,
      abilities: { str: 18, dex: 18, con: 18, int: 8, wis: 8, cha: 8 },
      skills: {}, featIds: ["a", "b"], equipmentCost: 50, startingGold: 10,
    }, { classSkills: {}, skillPoints: 4, featSlots: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/Point buy|starting feat|Equipment/);
  });
});
