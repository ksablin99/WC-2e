export const TECHNOLOGY_SOURCE = Object.freeze({
  book: "World of Warcraft: The Roleplaying Game, Second Edition",
  printedPages: [203, 204, 205, 206, 207, 208, 209, 210, 211],
  pdfPages: [205, 206, 207, 208, 209, 210, 211, 212, 213],
});

export const FUNCTION_DIFFICULTY_BENCHMARKS = Object.freeze({
  simpleRepetitive: 10,
  complexRepetitive: 15,
  simpleResponsive: 20,
  complexResponsive: 30,
  simpleCreative: 50,
  complexCreative: 75,
  amazing: 100,
});

export const DEVICE_SIZE_STATS = Object.freeze({
  fine: { hp: 1, hardness: 0 },
  dim: { hp: 3, hardness: 1 },
  tiny: { hp: 5, hardness: 3 },
  sm: { hp: 10, hardness: 5 },
  med: { hp: 20, hardness: 5 },
  lg: { hp: 40, hardness: 5 },
  huge: { hp: 80, hardness: 5 },
  grg: { hp: 160, hardness: 5 },
  col: { hp: 320, hardness: 5 },
});

export const TIME_UNITS = Object.freeze(["move action", "standard action", "round", "minute", "hour", "day", "week", "month"]);

export const TECHNOLOGY_MATERIALS = Object.freeze({
  none: Object.freeze({ label: "Common materials" }),
  adamantine: Object.freeze({ label: "Adamantine", marketMultiplier: 1.5, hpMultiplier: 3, hardnessMultiplier: 2, masterwork: true }),
  arcanite: Object.freeze({ label: "Arcanite", rawCostPerTs: 1000, hardnessPerTs: 1, masterwork: true }),
  dragonhide: Object.freeze({ label: "Dragonhide", rawMarketSurcharge: 0.25, masterwork: true }),
  mithril: Object.freeze({ label: "Mithril", marketMultiplier: 2, maneuverabilityBonus: 4, masterwork: true }),
  thorium: Object.freeze({ label: "Thorium", marketMultiplier: 2, maneuverabilityBonus: -4, masterwork: true }),
});

export const TECHNOLOGY_FEATURES = Object.freeze({
  armorBonus: { label: "Armor bonus", value: (ts) => ts },
  abilityBonus: { label: "Ability bonus", value: (ts) => Math.floor(ts / 3) },
  strength: { label: "Strength score", value: (ts) => ts },
  agility: { label: "Agility score", value: (ts) => Math.floor(ts / 3) },
  intellect: { label: "Intellect score", value: (ts) => Math.floor(ts / 5) },
  spirit: { label: "Spirit score", value: (ts) => Math.floor(ts / 3) },
  charisma: { label: "Charisma score", value: (ts) => Math.floor(ts / 6) },
  hardness: { label: "Additional hardness", value: (ts) => Math.floor(ts / 2) },
  hitPoints: { label: "Additional hit points", value: (ts) => ts * 5 },
  blastRadius: { label: "Blast radius", value: (ts) => Math.floor(ts / 2) * 5, unit: "ft" },
  cargo: { label: "Cargo capacity", value: (ts) => ts * 200, unit: "lb" },
  climbSpeed: { label: "Climb speed", value: (ts) => ts * 5, unit: "mph" },
  damage: { label: "Damage", value: (ts) => `${Math.floor(ts / 3)}d6`, unit: "per round" },
  damageReduction: { label: "Damage reduction", value: (ts) => Math.floor(ts / 3) },
  flySpeed: { label: "Fly speed", value: (ts) => ts * 5, unit: "mph" },
  landSpeed: { label: "Land speed", value: (ts) => ts * 20, unit: "mph" },
  maneuverability: { label: "Maneuverability rating", value: (ts) => Math.floor(ts / 2) },
  projectileWeapon: { label: "Projectile weapon", fixedTs: 3, value: () => true },
  range: { label: "Range increment", value: (ts) => ts * 50, unit: "ft" },
  swimSpeed: { label: "Swim speed", value: (ts) => ts * 10, unit: "mph" },
  underwater: { label: "Underwater capability", fixedTs: 10, value: () => true },
});

export const MALFUNCTION_EFFECTS = Object.freeze([
  "Function lock", "Mangled", "Leaky", "Total failure", "Inhibited function", "Degradation", "Balky",
  "Pieces everywhere", "Awkward operation", "Backfire", "Frangible", "Kickback", "Bulky", "Critical component",
  "Self-destructive", "Noisemaker", "Fused function", "Fragile", "Pain machine", "Phlogiston explosion",
]);

/** Mechanical portions of Table 11-3 that can be represented without a map
 * target or GM choice. Narrative-only consequences remain visible in chat. */
export const MALFUNCTION_RULES = Object.freeze({
  "Function lock": Object.freeze({ lockedRounds: "2d6", consumesSupply: true }),
  "Mangled": Object.freeze({ marketMultiplier: 0.5, replacementOnRepeat: true }),
  "Leaky": Object.freeze({ persistent: true }),
  "Total failure": Object.freeze({ disablesAddOns: true }),
  "Inhibited function": Object.freeze({ timeFactorMultiplier: 2 }),
  "Degradation": Object.freeze({ featureTsAdjustment: -1 }),
  "Balky": Object.freeze({ maneuverabilityAdjustment: -1 }),
  "Pieces everywhere": Object.freeze({ repairDcAdjustment: 4 }),
  "Awkward operation": Object.freeze({ operationPenalty: -2 }),
  "Backfire": Object.freeze({ immediateDamage: "device" }),
  "Frangible": Object.freeze({ malfunctionRatingAdjustment: 1 }),
  "Kickback": Object.freeze({ immediateDamage: "3d6" }),
  "Bulky": Object.freeze({ repairCostMultiplier: 1.25, sizeAdjustment: 1, weightMultiplier: 2, speedAdjustmentMph: -20 }),
  "Critical component": Object.freeze({ replacementCostMultiplier: 0.1 }),
  "Self-destructive": Object.freeze({ deviceDamagePerUse: 1 }),
  "Noisemaker": Object.freeze({ noiseRadiusFeet: 60, persistent: true }),
  "Fused function": Object.freeze({ repairDcAdjustment: 3, preventsUpgrade: true }),
  "Fragile": Object.freeze({ maximumHpMultiplier: 0.5 }),
  "Pain machine": Object.freeze({ operatorDamagePerUse: "1d6" }),
  "Phlogiston explosion": Object.freeze({ repairDcAdjustment: 6, immediateDamage: "technologyScoreD6", radiusFeet: 15 }),
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, number(value, min)));
}

function actorItems(actor) {
  return Array.from(actor?.items ?? []);
}

function ownsFeat(actor, name) {
  const wanted = String(name).toLowerCase();
  return actorItems(actor).some((item) => item?.type === "feat" && String(item.name).toLowerCase() === wanted);
}

function deviceKind(data = {}) {
  const primary = String(data.primaryFunction ?? "").toLowerCase();
  const size = String(data.size ?? "med").toLowerCase();
  const vehicle = data.vehicle === true;
  return {
    firearm: /firearm|pistol|rifle|blunderbuss|dragon gun/.test(primary),
    siege: /siege|catapult|cannon|mortar|ballista/.test(primary),
    small: ["fine", "dim", "tiny"].includes(size),
    vehicle,
  };
}

/** Printed Technology-feat bonuses that directly affect the device workflow.
 * Crafty Leader and emergency/delay actions require external assistants or
 * combat timing, so those feats stay visible/manual rather than being guessed. */
export function technologyFeatBonuses(actor, data = {}) {
  const kind = deviceKind(data);
  let craft = 0;
  let use = 0;
  let technologicalLimit = 0;
  for (const [feat, applies] of [
    ["Firearm Knack", kind.firearm],
    ["Siege Weapon Knack", kind.siege],
    ["Small Device Knack", kind.small],
    ["Vehicle Knack", kind.vehicle],
  ]) {
    if (!applies || !ownsFeat(actor, feat)) continue;
    craft += 2;
    technologicalLimit += 2;
    if (feat === "Vehicle Knack") use += 2;
  }
  return {
    craft,
    use,
    technologicalLimit,
    rawMaterialMultiplier: ownsFeat(actor, "Scavenge Materials") ? 0.3 : 1,
  };
}

export function actorTinkerLevel(actor) {
  return actorItems(actor)
    .filter((item) => item?.type === "class" && String(item.name).toLowerCase() === "tinker")
    .reduce((total, item) => total + Math.max(0, number(item.system?.levels ?? item.system?.level)), 0);
}

export function parseCollaboratorLevels(value = "") {
  if (Array.isArray(value)) return value.map((entry) => Math.max(0, number(entry))).filter((entry) => entry > 0);
  return String(value).split(/[,;\s]+/).map((entry) => Math.max(0, number(entry))).filter((entry) => entry > 0);
}

export function technologicalLimitForDevice(actor, data = {}) {
  const collaborators = parseCollaboratorLevels(data.collaboratorLevels);
  if (collaborators.length) return calculateTechnologicalLimit({ collaborators });
  return calculateTechnologicalLimit({
    tinkerLevel: actorTinkerLevel(actor),
    featModifier: technologyFeatBonuses(actor, data).technologicalLimit,
  });
}

export function calculateTechnologicalLimit({ tinkerLevel = 0, featModifier = 0, collaborators = null } = {}) {
  if (collaborators?.length) {
    const average = collaborators.reduce((sum, level) => sum + number(level), 0) / collaborators.length;
    return Math.floor(collaborators.length + average);
  }
  return Math.max(1, 1 + Math.max(0, Math.trunc(number(tinkerLevel))) + Math.trunc(number(featModifier)));
}

export function normalizeTechnologyFeatures(features = []) {
  return Array.from(features ?? []).map((feature) => {
    const definition = TECHNOLOGY_FEATURES[feature?.type] ?? null;
    const ts = definition?.fixedTs ?? Math.max(0, Math.trunc(number(feature?.ts)));
    return {
      type: feature?.type ?? "custom",
      name: feature?.name || definition?.label || "Custom feature",
      ts,
      value: feature?.value === "" || feature?.value == null ? definition?.value?.(ts) ?? "" : feature.value,
      unit: feature?.unit ?? definition?.unit ?? "",
      notes: feature?.notes ?? "",
    };
  });
}

export function applyTechnologyMaterial(features = [], technologyScore = 0, material = "none") {
  const key = TECHNOLOGY_MATERIALS[material] ? material : "none";
  const ts = Math.max(0, number(technologyScore));
  const adjusted = features.map((feature) => {
    const result = { ...feature };
    if (key === "arcanite" && feature.type === "damage") result.value = `${Math.floor(ts / 3)}d6+2`;
    if (key === "dragonhide" && feature.type === "armorBonus") result.value = ts * 2;
    if (key === "dragonhide" && feature.type === "hardness") result.value = ts;
    if (key === "mithril" && feature.type === "hitPoints") result.value = ts * 9;
    if (key === "mithril" && feature.type === "armorBonus") result.value = ts + 4;
    if (key === "thorium" && feature.type === "damage") result.value = `${Math.floor(ts / 2)}d8`;
    if (key === "thorium" && feature.type === "range") result.value = ts * 75;
    if (key === "thorium" && feature.type === "armorBonus") result.value = ts + 3;
    if (key === "thorium" && feature.type === "hitPoints") result.value = ts * 7;
    if (key === "thorium" && feature.type === "cargo") result.value = ts * 150;
    return result;
  });
  const rules = TECHNOLOGY_MATERIALS[key];
  return {
    material: key,
    features: adjusted,
    marketMultiplier: rules.marketMultiplier ?? 1,
    hpMultiplier: rules.hpMultiplier ?? 1,
    hardnessMultiplier: rules.hardnessMultiplier ?? 1,
    extraHardness: key === "arcanite" ? ts : 0,
    rawCostPerTs: rules.rawCostPerTs ?? 0,
    rawMarketSurcharge: rules.rawMarketSurcharge ?? 0,
    maneuverabilityBonus: rules.maneuverabilityBonus ?? 0,
    requiresMasterwork: rules.masterwork === true,
  };
}

export function calculateTechnologyDesign(data = {}) {
  const fd = Math.max(0, number(data.functionDifficulty));
  const normalizedFeatures = normalizeTechnologyFeatures(data.features);
  const ts = normalizedFeatures.reduce((highest, feature) => Math.max(highest, number(feature.ts)), Math.max(0, number(data.technologyScore)));
  const material = applyTechnologyMaterial(normalizedFeatures, ts, data.material);
  const features = material.features;
  const complexity = fd / 2 + features.reduce((sum, feature) => sum + number(feature.ts), 0);
  const timeFactor = clamp(data.timeFactor ?? 1, 1, 10);
  const enteredMr = clamp(data.malfunctionRating ?? 1, 0, 5);
  const malfunctionRating = data.randomMalfunction ? Math.max(1, enteredMr - 1) : enteredMr;
  const unroundedMarket = timeFactor + malfunctionRating > 0 ? (fd * ts * complexity) / (timeFactor + malfunctionRating) : 0;
  const marketValue = Math.round((unroundedMarket * material.marketMultiplier) / 5) * 5;
  const size = DEVICE_SIZE_STATS[data.size] ?? DEVICE_SIZE_STATS.med;
  const extraHp = features.filter((feature) => feature.type === "hitPoints").reduce((sum, feature) => sum + number(feature.value), 0);
  const extraHardness = features.filter((feature) => feature.type === "hardness").reduce((sum, feature) => sum + number(feature.value), 0);
  const materialRawCost = material.rawCostPerTs * ts + unroundedMarket * material.rawMarketSurcharge;
  return {
    functionDifficulty: fd,
    features,
    technologyScore: ts,
    complexity,
    timeFactor,
    timeUnit: TIME_UNITS.includes(data.timeUnit) ? data.timeUnit : "standard action",
    malfunctionRating,
    material: material.material,
    requiresMasterwork: material.requiresMasterwork,
    materialManeuverabilityBonus: material.maneuverabilityBonus,
    marketValue,
    rawMaterialCost: marketValue / 3 + materialRawCost,
    materialRawCost,
    craftDc: fd + ts,
    operationDc: number(data.operationDc) || 10 + ts,
    repairCost: marketValue / 5,
    hp: (size.hp + extraHp) * material.hpMultiplier,
    hardness: (size.hardness + extraHardness) * material.hardnessMultiplier + material.extraHardness,
  };
}

export function favoredTechnologyCraftBonus(actor, { material = "none", primaryFunction = "" } = {}) {
  const races = Array.from(actor?.items ?? []).filter((item) => item?.type === "race").map((item) => String(item.name ?? "").toLowerCase());
  const key = String(material ?? "none").toLowerCase();
  const functionText = String(primaryFunction ?? "").toLowerCase();
  if (key === "dragonhide" && races.some((race) => race.includes("high elf"))) return 1;
  if (key === "adamantine" && races.some((race) => race.includes("goblin"))) return 1;
  if (key === "mithril" && races.some((race) => race.includes("human"))) return 1;
  if (["thorium", "arcanite"].includes(key) && races.some((race) => /(^|\s)orc($|\s)/.test(race))) return 1;
  if (/gunpowder|firearm|pistol|rifle|blunderbuss|cannon|mortar/.test(functionText)
    && races.some((race) => race.includes("ironforge dwarf"))) return 1;
  return 0;
}

export function favoredTechnologyMaterialBonus(actor, material = "none") {
  return favoredTechnologyCraftBonus(actor, { material });
}

export function calculateCraftProgress({ checkTotal, craftDc, currentSp = 0, rawMaterialCost = 0 } = {}) {
  const result = number(checkTotal);
  const dc = Math.max(0, number(craftDc));
  const failedBy = dc - result;
  const progressSp = result >= dc ? result * dc : 0;
  return {
    success: result >= dc,
    progressSp,
    totalProgressSp: Math.max(0, number(currentSp)) + progressSp,
    ruinedMaterialsGp: failedBy >= 5 ? Math.max(0, number(rawMaterialCost)) / 2 : 0,
  };
}

export function calculateUpgrade({ oldMarketValue = 0, upgradedDesign = {} } = {}) {
  const design = calculateTechnologyDesign(upgradedDesign);
  return {
    ...design,
    upgradeCost: Math.max(0, design.marketValue - Math.max(0, number(oldMarketValue))),
    upgradeDc: Math.max(0, design.functionDifficulty + design.technologyScore - 10),
  };
}

export function calculateAddOn({ independentMarketValue = 0, deviceTs = 0, addOnTs = 0, functionDifficulty = 10 } = {}) {
  const marketValue = Math.max(0, number(independentMarketValue)) * 0.75;
  return {
    marketValue,
    integrationDc: Math.max(0, number(deviceTs)) + Math.max(0, number(addOnTs)),
    integrationTime: "1 day",
    repairDc: Math.max(0, number(functionDifficulty)) + Math.max(0, number(addOnTs)),
    repairCost: marketValue / 5,
  };
}

export function calculateMasterwork({ marketValue = 0, technologyScore = 0 } = {}) {
  return {
    componentPrice: Math.max(0, number(marketValue)) * 0.25,
    componentRawMaterialCost: Math.max(0, number(marketValue)) / 12,
    craftDc: Math.max(20, Math.max(0, number(technologyScore)) + 5),
    operationSkillBonus: 3,
    attackBonus: 1,
  };
}

export function technologyUsePenalty({ trained = true, proficient = true } = {}) {
  return (trained ? 0 : -2) + (proficient ? 0 : -4);
}

export function technologyOperationModifiers({
  checkType = "utd",
  useDeviceBonus = 0,
  rangedAttackBonus = 0,
  deviceAttackBonus = 0,
  trained = true,
  proficient = true,
  masterwork = false,
  permanentPenalty = 0,
} = {}) {
  if (checkType === "none") return { bonus: 0, penalty: 0, masterworkBonus: 0, total: 0 };
  const attack = checkType === "attack";
  const bonus = attack ? number(rangedAttackBonus) + number(deviceAttackBonus) : number(useDeviceBonus);
  const penalty = (attack ? (proficient ? 0 : -4) : technologyUsePenalty({ trained, proficient })) + number(permanentPenalty);
  const masterworkBonus = masterwork ? (attack ? 1 : 3) : 0;
  return { bonus, penalty, masterworkBonus, total: bonus + penalty + masterworkBonus };
}

export function checkMalfunction({ naturalRoll, malfunctionRating, randomMalfunction = false, malfunctionRoll = null } = {}) {
  const natural = number(naturalRoll);
  const rating = clamp(malfunctionRating, 0, 5);
  const malfunctioned = natural >= 1 && natural <= rating;
  if (!malfunctioned) return { malfunctioned: false, effect: null, roll: null };
  if (!randomMalfunction) return { malfunctioned: true, effect: null, roll: null };
  const rolled = clamp(malfunctionRoll ?? natural, 1, 20);
  return { malfunctioned: true, effect: MALFUNCTION_EFFECTS[rolled - 1], roll: rolled };
}

export function getTechnologyMalfunctionRule(effect = "") {
  return MALFUNCTION_RULES[String(effect)] ?? Object.freeze({});
}

export function technologyPermanentModifiers(effects = []) {
  const rules = Array.from(effects ?? []).map(getTechnologyMalfunctionRule);
  return {
    operationPenalty: rules.reduce((sum, rule) => sum + number(rule.operationPenalty), 0),
    malfunctionRatingAdjustment: rules.reduce((sum, rule) => sum + number(rule.malfunctionRatingAdjustment), 0),
    marketMultiplier: rules.reduce((value, rule) => value * (rule.marketMultiplier ?? 1), 1),
    preventsUpgrade: rules.some((rule) => rule.preventsUpgrade),
    maximumHpMultiplier: rules.reduce((value, rule) => value * (rule.maximumHpMultiplier ?? 1), 1),
    deviceDamagePerUse: rules.reduce((sum, rule) => sum + number(rule.deviceDamagePerUse), 0),
    operatorDamagePerUse: rules.find((rule) => rule.operatorDamagePerUse)?.operatorDamagePerUse ?? "",
    noisy: rules.some((rule) => rule.noiseRadiusFeet),
    leaky: rules.some((rule) => rule === MALFUNCTION_RULES.Leaky),
  };
}

export function consumeTechnologySupply({ current = 0, cost = 1 } = {}) {
  const available = Math.max(0, number(current));
  const required = Math.max(0, number(cost));
  return available >= required
    ? { valid: true, remaining: available - required, missing: 0 }
    : { valid: false, remaining: available, missing: required - available };
}

export function maneuverabilityCheck({ combat = false, speedMph = 0, rating = 1, extraSpeedChanges = 0, turnIncrements = 0, driftWidths = 1 } = {}) {
  const increment = clamp(rating, 1, 5) * 5;
  const speedPenalty = -2 * Math.max(0, Math.floor(Math.max(0, number(speedMph)) / increment) - 1);
  const speedChangePenalty = -4 * Math.max(0, Math.trunc(number(extraSpeedChanges)));
  const turnPenalty = -4 * Math.max(0, Math.trunc(number(turnIncrements)));
  const driftPenalty = -4 * Math.max(0, Math.trunc(number(driftWidths)) - 1);
  return { dc: combat ? 20 : 10, modifier: speedPenalty + speedChangePenalty + turnPenalty + driftPenalty, speedIncrementMph: increment };
}

export function convertTechnologyUnit(value, unit, system = "imperial") {
  const amount = number(value);
  if (system === "imperial") return { value: amount, unit };
  if (unit === "ft") return { value: amount * 0.3048, unit: "m" };
  if (unit === "lb") return { value: amount * 0.45359237, unit: "kg" };
  if (unit === "mph") return { value: amount * 1.609344, unit: "km/h" };
  return { value: amount, unit };
}
