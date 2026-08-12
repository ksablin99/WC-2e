export const WARCRAFT_POINT_BUY_COST = Object.freeze({ 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 6, 15: 8, 16: 10, 17: 13, 18: 16 });
export const WARCRAFT_CREATION_STEPS = Object.freeze(["identity", "abilities", "skills", "feats", "spellsEquipment", "review"]);

function integer(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
}

export function pointBuySpent(abilities = {}) {
  return Object.values(abilities).reduce((total, value) => total + (WARCRAFT_POINT_BUY_COST[integer(value)] ?? Infinity), 0);
}

export function firstLevelSkillPoints({ skillsPerLevel = 2, intellect = 10, human = false } = {}) {
  const modifier = Math.floor((integer(intellect, 10) - 10) / 2);
  return Math.max(4, (Math.max(1, integer(skillsPerLevel, 2)) + modifier) * 4) + (human ? 4 : 0);
}

export function skillPointCost(skills = {}, classSkills = {}) {
  return Object.entries(skills).reduce((total, [key, ranks]) => {
    const rank = Math.max(0, Number(ranks) || 0);
    return total + rank * (classSkills[key] ? 1 : 2);
  }, 0);
}

export function validateSkillAllocation(skills = {}, classSkills = {}, available = 0) {
  const errors = [];
  for (const [key, raw] of Object.entries(skills)) {
    const rank = Number(raw) || 0;
    const maximum = classSkills[key] ? 4 : 2;
    if (rank < 0 || rank > maximum) errors.push(`${key}: maximum starting rank is ${maximum}`);
    if (!classSkills[key] && rank * 2 !== Math.trunc(rank * 2)) errors.push(`${key}: cross-class ranks use half-rank steps`);
  }
  const spent = skillPointCost(skills, classSkills);
  if (spent > available) errors.push(`Skill points spent ${spent}/${available}`);
  return { valid: errors.length === 0, errors, spent, available };
}

export function validateCharacterCreationPlan(plan = {}, context = {}) {
  const errors = [];
  const warnings = [];
  if (!plan.raceId) errors.push("Choose a race");
  if (!plan.classId) errors.push("Choose a starting class");
  const abilities = plan.abilities ?? {};
  for (const key of ["str", "dex", "con", "int", "wis", "cha"]) {
    const value = integer(abilities[key], 0);
    if (value < 8 || value > 18) errors.push(`${key.toUpperCase()} must be between 8 and 18 before racial modifiers`);
  }
  const budget = integer(plan.pointBuyBudget, 25);
  const spent = pointBuySpent(abilities);
  if (!Number.isFinite(spent) || spent > budget) errors.push(`Point buy spent ${spent}/${budget}`);
  const skillValidation = validateSkillAllocation(plan.skills, context.classSkills, context.skillPoints);
  errors.push(...skillValidation.errors);
  const featSlots = context.featSlots ?? 1;
  if ((plan.featIds?.length ?? 0) > featSlots) errors.push(`Choose at most ${featSlots} starting feat${featSlots === 1 ? "" : "s"}`);
  if ((plan.equipmentCost ?? 0) > (plan.startingGold ?? 0)) errors.push(`Equipment costs ${plan.equipmentCost} gp but only ${plan.startingGold} gp is available`);
  if (context.classPaths?.enabled && !context.classPaths.choices?.some((choice) => choice.id === plan.classPath)) errors.push("Choose a valid class path");
  if (context.racialLevelMax && Number(plan.racialLevelsPlanned) > context.racialLevelMax) errors.push(`Racial levels cannot exceed ${context.racialLevelMax}`);
  if (!plan.affiliation) warnings.push("Affiliation is blank");
  return { valid: errors.length === 0, errors, warnings, pointBuySpent: spent, skillPoints: skillValidation };
}

export function summarizeCharacterCreation(plan = {}, names = {}) {
  return {
    race: names.race ?? "\u2014",
    className: names.className ?? "\u2014",
    classPath: names.classPath ?? "\u2014",
    abilities: Object.entries(plan.abilities ?? {}).map(([key, value]) => `${key.toUpperCase()} ${value}`).join(", "),
    featCount: plan.featIds?.length ?? 0,
    spellCount: plan.spellIds?.length ?? 0,
    equipmentCount: plan.equipmentIds?.length ?? 0,
    equipmentCost: plan.equipmentCost ?? 0,
    startingGold: plan.startingGold ?? 0,
  };
}
