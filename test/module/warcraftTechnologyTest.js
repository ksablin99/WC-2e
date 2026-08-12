import {
  calculateAddOn,
  calculateCraftProgress,
  calculateMasterwork,
  calculateTechnologicalLimit,
  calculateTechnologyDesign,
  calculateUpgrade,
  checkMalfunction,
  favoredTechnologyCraftBonus,
  favoredTechnologyMaterialBonus,
  getTechnologyMalfunctionRule,
  maneuverabilityCheck,
  parseCollaboratorLevels,
  technologicalLimitForDevice,
  technologyFeatBonuses,
  technologyOperationModifiers,
  technologyPermanentModifiers,
  technologyUsePenalty,
} from "../../module/item/helpers/warcraftTechnology.js";

describe("Warcraft technological devices", () => {
  const steamArmor = {
    functionDifficulty: 20,
    features: [
      { type: "armorBonus", ts: 6 },
      { type: "cargo", ts: 6 },
      { type: "landSpeed", ts: 3 },
      { type: "maneuverability", ts: 6 },
    ],
    timeFactor: 3,
    timeUnit: "minute",
    malfunctionRating: 1,
    size: "lg",
  };

  test("reproduces the printed steam armor example", () => {
    expect(calculateTechnologyDesign(steamArmor)).toMatchObject({
      technologyScore: 6,
      complexity: 31,
      marketValue: 930,
      rawMaterialCost: 310,
      craftDc: 26,
      operationDc: 16,
      hp: 40,
      hardness: 5,
    });
  });

  test("calculates personal and collaborative technological limits", () => {
    expect(calculateTechnologicalLimit({ tinkerLevel: 6, featModifier: 2 })).toBe(9);
    expect(calculateTechnologicalLimit({ collaborators: [5, 7, 9] })).toBe(10);
    expect(parseCollaboratorLevels("5, 7; 9")).toEqual([5, 7, 9]);
    const tinker = {
      items: [
        { type: "class", name: "Tinker", system: { levels: 6 } },
        { type: "feat", name: "Vehicle Knack" },
      ],
    };
    expect(technologicalLimitForDevice(tinker, { vehicle: true })).toBe(9);
    expect(technologicalLimitForDevice(tinker, { vehicle: true, collaboratorLevels: "5,7,9" })).toBe(10);
  });

  test("implements construction, add-on, upgrade, and masterwork formulas", () => {
    expect(calculateCraftProgress({ checkTotal: 27, craftDc: 26 }).progressSp).toBe(702);
    expect(calculateCraftProgress({ checkTotal: 20, craftDc: 26, rawMaterialCost: 310 }).ruinedMaterialsGp).toBe(155);
    expect(calculateAddOn({ independentMarketValue: 100, deviceTs: 6, addOnTs: 3 })).toEqual({
      marketValue: 75,
      integrationDc: 9,
      integrationTime: "1 day",
      repairDc: 13,
      repairCost: 15,
    });
    expect(calculateUpgrade({ oldMarketValue: 500, upgradedDesign: steamArmor })).toMatchObject({ upgradeCost: 430, upgradeDc: 16 });
    expect(calculateMasterwork({ marketValue: 930, technologyScore: 6 })).toMatchObject({ componentPrice: 232.5, craftDc: 20, attackBonus: 1 });
  });

  test("uses the unmodified d20 for malfunctions", () => {
    expect(checkMalfunction({ naturalRoll: 2, malfunctionRating: 2 })).toMatchObject({ malfunctioned: true });
    expect(checkMalfunction({ naturalRoll: 3, malfunctionRating: 2 })).toMatchObject({ malfunctioned: false });
    expect(checkMalfunction({ naturalRoll: 1, malfunctionRating: 2, randomMalfunction: true, malfunctionRoll: 20 }).effect).toBe("Phlogiston explosion");
  });

  test("keeps printed malfunction repairs and persistent penalties machine-readable", () => {
    expect(getTechnologyMalfunctionRule("Pieces everywhere")).toMatchObject({ repairDcAdjustment: 4 });
    expect(getTechnologyMalfunctionRule("Inhibited function")).toMatchObject({ timeFactorMultiplier: 2 });
    expect(getTechnologyMalfunctionRule("Phlogiston explosion")).toMatchObject({ repairDcAdjustment: 6, radiusFeet: 15 });
    expect(technologyPermanentModifiers(["Awkward operation", "Frangible", "Fused function"])).toMatchObject({
      operationPenalty: -2,
      malfunctionRatingAdjustment: 1,
      preventsUpgrade: true,
    });
    expect(technologyPermanentModifiers(["Fragile", "Fragile"]).maximumHpMultiplier).toBe(0.25);
  });

  test("applies training/proficiency and vehicle maneuver penalties", () => {
    expect(technologyUsePenalty({ trained: false, proficient: false })).toBe(-6);
    expect(technologyOperationModifiers({ checkType: "utd", useDeviceBonus: 9, trained: false, proficient: false, masterwork: true })).toEqual({
      bonus: 9,
      penalty: -6,
      masterworkBonus: 3,
      total: 6,
    });
    expect(technologyOperationModifiers({ checkType: "attack", rangedAttackBonus: 7, deviceAttackBonus: 2, proficient: false, masterwork: true })).toEqual({
      bonus: 9,
      penalty: -4,
      masterworkBonus: 1,
      total: 6,
    });
    expect(technologyOperationModifiers({ checkType: "none", permanentPenalty: -2 })).toEqual({ bonus: 0, penalty: 0, masterworkBonus: 0, total: 0 });
    expect(maneuverabilityCheck({ combat: true, speedMph: 45, rating: 3 })).toEqual({ dc: 20, modifier: -4, speedIncrementMph: 15 });
  });

  test("applies printed special-material device changes", () => {
    const design = {
      functionDifficulty: 10,
      features: [
        { type: "damage", ts: 6 },
        { type: "armorBonus", ts: 6 },
        { type: "hitPoints", ts: 6 },
        { type: "hardness", ts: 6 },
        { type: "range", ts: 6 },
        { type: "cargo", ts: 6 },
      ],
      timeFactor: 1,
      malfunctionRating: 1,
      size: "med",
    };
    const byMaterial = (material) => calculateTechnologyDesign({ ...design, material });
    expect(byMaterial("adamantine")).toMatchObject({ marketValue: 1845, hp: 150, hardness: 16, requiresMasterwork: true });
    expect(byMaterial("arcanite")).toMatchObject({ hardness: 14, materialRawCost: 6000 });
    expect(byMaterial("arcanite").features.find((entry) => entry.type === "damage").value).toBe("2d6+2");
    expect(byMaterial("dragonhide").features.find((entry) => entry.type === "armorBonus").value).toBe(12);
    expect(byMaterial("mithril")).toMatchObject({ marketValue: 2460, hp: 74, materialManeuverabilityBonus: 4 });
    expect(byMaterial("thorium")).toMatchObject({ marketValue: 2460, hp: 62, materialManeuverabilityBonus: -4 });
    expect(byMaterial("thorium").features.find((entry) => entry.type === "damage").value).toBe("3d8");
    const mixedScores = calculateTechnologyDesign({ ...design, material: "thorium", features: [
      { type: "damage", ts: 3 },
      { type: "armorBonus", ts: 6 },
    ] });
    expect(mixedScores.features.find((entry) => entry.type === "damage").value).toBe("3d8");
  });

  test("recognizes printed racial material aptitudes", () => {
    const actor = (race) => ({ items: [{ type: "race", name: race }] });
    expect(favoredTechnologyMaterialBonus(actor("High Elf"), "dragonhide")).toBe(1);
    expect(favoredTechnologyMaterialBonus(actor("Goblin"), "adamantine")).toBe(1);
    expect(favoredTechnologyMaterialBonus(actor("Human"), "mithril")).toBe(1);
    expect(favoredTechnologyMaterialBonus(actor("Orc"), "thorium")).toBe(1);
    expect(favoredTechnologyMaterialBonus(actor("Ironforge Dwarf"), "adamantine")).toBe(0);
    expect(favoredTechnologyCraftBonus(actor("Ironforge Dwarf"), { primaryFunction: "Gunpowder mortar" })).toBe(1);
  });

  test("applies the technology knack and scavenging feat integrations", () => {
    const actor = {
      items: [
        { type: "feat", name: "Vehicle Knack" },
        { type: "feat", name: "Small Device Knack" },
        { type: "feat", name: "Scavenge Materials" },
      ],
    };
    expect(technologyFeatBonuses(actor, { vehicle: true, size: "tiny" })).toEqual({
      craft: 4,
      use: 2,
      technologicalLimit: 4,
      rawMaterialMultiplier: 0.3,
    });
  });
});
