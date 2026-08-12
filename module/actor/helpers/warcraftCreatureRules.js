import {
  DEATH_RULE_FORSAKEN,
  DEATH_RULE_WARCRAFT_CONSTRUCT,
  DEATH_RULE_WARCRAFT_UNDEAD,
} from "./warcraftDeathRules.js";

export const CONSTRUCT_SIZE_HIT_POINTS = Object.freeze({
  fine: 0,
  dim: 0,
  tiny: 0,
  sm: 10,
  med: 20,
  lg: 30,
  huge: 40,
  grg: 60,
  col: 80,
});

export const FORSAKEN_IMMUNITIES = Object.freeze([
  "mind-affecting effects",
  "poison",
  "sleep",
  "paralysis",
  "stunning",
  "disease",
  "death effects",
  "critical hits",
  "nonlethal damage",
  "Strength and Agility damage",
  "ability drain",
  "energy drain",
  "fatigue",
  "exhaustion",
  "effects requiring Fortitude saves unless they affect objects or are harmless",
]);

export const CONSTRUCT_IMMUNITIES = Object.freeze([
  ...FORSAKEN_IMMUNITIES,
  "ability damage",
  "necromancy effects",
]);

export const UNDEAD_IMMUNITIES = Object.freeze([
  ...FORSAKEN_IMMUNITIES.filter((entry) => entry !== "Strength and Agility damage"),
  "physical ability damage",
]);

export function constructSizeHitPoints(size) {
  return CONSTRUCT_SIZE_HIT_POINTS[String(size ?? "").toLowerCase()] ?? 0;
}

export function resolveWarcraftCreatureProfile({ creatureType, deathRule } = {}) {
  const normalized = String(creatureType ?? "").trim().toLowerCase();
  const construct = normalized === "construct" || deathRule === DEATH_RULE_WARCRAFT_CONSTRUCT;
  const forsaken = deathRule === DEATH_RULE_FORSAKEN;
  const undead = !forsaken && (normalized === "undead" || deathRule === DEATH_RULE_WARCRAFT_UNDEAD);
  if (construct) {
    return {
      construct: true,
      undead: false,
      forsaken: false,
      noConstitution: true,
      naturalHealing: false,
      positiveEnergyHeals: false,
      negativeEnergyHeals: false,
      repairHealingHeals: true,
      criticalAndPrecisionImmune: true,
      fortitudeEffectImmune: true,
      immunities: [...CONSTRUCT_IMMUNITIES],
    };
  }
  if (forsaken) {
    return {
      construct: false,
      undead: true,
      forsaken: true,
      noConstitution: true,
      concentrationAbility: "cha",
      naturalHealing: false,
      positiveEnergyHeals: false,
      negativeEnergyHeals: true,
      repairHealingHeals: false,
      criticalAndPrecisionImmune: true,
      fortitudeEffectImmune: true,
      immunities: [...FORSAKEN_IMMUNITIES],
    };
  }
  if (undead) {
    return {
      construct: false,
      undead: true,
      forsaken: false,
      noConstitution: true,
      concentrationAbility: "cha",
      naturalHealing: false,
      positiveEnergyHeals: false,
      negativeEnergyHeals: true,
      repairHealingHeals: false,
      criticalAndPrecisionImmune: true,
      fortitudeEffectImmune: true,
      immunities: [...UNDEAD_IMMUNITIES],
    };
  }
  return {
    construct: false,
    undead: false,
    forsaken: false,
    noConstitution: false,
    concentrationAbility: "con",
    naturalHealing: true,
    positiveEnergyHeals: true,
    negativeEnergyHeals: false,
    repairHealingHeals: false,
    criticalAndPrecisionImmune: false,
    fortitudeEffectImmune: false,
    immunities: [],
  };
}

/** Convert a typed energy amount into signed HP damage (negative heals). */
export function signedWarcraftEnergyDamage({ amount, damageType, creatureType, deathRule } = {}) {
  const value = Math.abs(Number(amount) || 0);
  const type = String(damageType ?? "").toLowerCase();
  const profile = resolveWarcraftCreatureProfile({ creatureType, deathRule });
  // Constructs are neither living nor undead. Cure/inflict energy does not
  // repair them and must not be converted into damage; only explicit repair
  // healing changes their hit points.
  if (profile.construct) return type === "damage-repair" ? -value : 0;
  // Generic healing represents positive-energy healing in the inherited data
  // set. Undead are harmed by it; negative energy heals them.
  if (type === "healing") return profile.positiveEnergyHeals ? -value : value;
  if (type === "positive" && profile.positiveEnergyHeals) return -value;
  if (type === "negative" && profile.negativeEnergyHeals) return -value;
  if (type === "damage-repair" && profile.repairHealingHeals) return -value;
  return value;
}

/** Whether ability damage may affect this creature and ability score. */
export function canApplyWarcraftAbilityDamage({ creatureType, deathRule, ability } = {}) {
  const profile = resolveWarcraftCreatureProfile({ creatureType, deathRule });
  if (profile.construct) return false;
  // Undead (including Forsaken) ignore physical ability damage, but can still
  // take damage to mental ability scores. Stamina is absent on both profiles.
  return !(profile.undead && ["str", "dex", "con"].includes(String(ability ?? "").toLowerCase()));
}

/** Constructs and Forsaken are both immune to ability drain. */
export function canApplyWarcraftAbilityDrain({ creatureType, deathRule } = {}) {
  const profile = resolveWarcraftCreatureProfile({ creatureType, deathRule });
  return !profile.construct && !profile.undead;
}
