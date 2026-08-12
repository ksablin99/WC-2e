export const HERO_POINT_FLAG_SCOPE = "warcraftrpg2e";
export const HERO_POINT_PENDING_KEY = "heroPoint.pending";

export const HERO_POINT_OPTIONS = Object.freeze({
  d20: { label: "Next d20 roll: +20 luck bonus", rollKind: "d20" },
  attack: { label: "Next attack: +20 luck bonus", rollKind: "attack" },
  powerfulBlow: { label: "Powerful Blow: double damage if the unmodified attack hits", rollKind: "attack" },
  calledShotHead: { label: "Called Shot — Head: stun 1d3 rounds", rollKind: "attack" },
  calledShotEyes: { label: "Called Shot — Eyes: blind 1d10+4 rounds", rollKind: "attack" },
  calledShotNerve: { label: "Called Shot — Nerve: limb useless 1d6 rounds", rollKind: "attack" },
  spellDc: { label: "Next spell: +20 saving throw DC", rollKind: "spell" },
  defenseAc: { label: "Next defense: +20 luck bonus to AC", rollKind: "defense" },
  savingThrow: { label: "Next saving throw: +20 luck bonus", rollKind: "save" },
  avoidDeath: { label: "Avoid death: set hit points to -1 and become stable", immediate: true },
  outOfTurn: { label: "Declare one round of actions outside initiative", immediate: true, manual: true },
  narrative: { label: "Declare a narrative alteration", immediate: true, manual: true },
  extraShout: { label: "Shout one additional time; double its range and duration", rollKind: "shout" },
  intimidatingShout: { label: "Intimidating Shout: failed saves panic for 1d6 rounds", rollKind: "shout" },
});

export const WARCRAFT_SHOUTS = Object.freeze({
  "Battle Shout": Object.freeze({ targets: "allies", radius: 30, change: Object.freeze(["2", "damage", "wdamage", "morale"]) }),
  "Challenging Shout": Object.freeze({ targets: "opponents", adjacent: true, save: "will", restriction: "meleeAllies" }),
  "Demoralizing Shout": Object.freeze({ targets: "opponents", radius: 30, change: Object.freeze(["-2", "damage", "wdamage", "morale"]) }),
  "Intimidating Shout": Object.freeze({ targets: "opponents", radius: 30, save: "will", condition: "shaken", heroCondition: "panicked" }),
});

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function heroPointState(actor) {
  const resource = actor?.system?.attributes?.heroPoints ?? {};
  return {
    value: finiteNonNegative(resource.value),
    max: finiteNonNegative(resource.max),
    pending: actor?.flags?.warcraftrpg2e?.heroPoint?.pending ?? null,
  };
}

export function canSpendHeroPoint(actor, option) {
  const state = heroPointState(actor);
  if (!HERO_POINT_OPTIONS[option]) return { valid: false, reason: "Unknown Hero Point option" };
  if (state.value < 1) return { valid: false, reason: "No Hero Points remain" };
  if (state.pending) return { valid: false, reason: "Resolve or cancel the pending Hero Point first" };
  return { valid: true, reason: "" };
}

export function buildHeroPointSpendUpdate(actor, option, metadata = {}) {
  const check = canSpendHeroPoint(actor, option);
  if (!check.valid) return { valid: false, reason: check.reason, update: null };
  const value = heroPointState(actor).value - 1;
  const optionData = HERO_POINT_OPTIONS[option];
  const pending = optionData.immediate ? null : {
    option,
    createdAt: Date.now(),
    source: "World of Warcraft RPG 2e, printed p. 359",
    ...metadata,
  };
  return {
    valid: true,
    reason: "",
    update: {
      "system.attributes.heroPoints.value": value,
      "flags.warcraftrpg2e.heroPoint.pending": pending,
    },
  };
}

export function heroPendingMatches(actor, kinds) {
  const pending = heroPointState(actor).pending;
  if (!pending) return false;
  const allowed = Array.isArray(kinds) ? kinds : [kinds];
  return allowed.includes(pending.option) || allowed.includes(HERO_POINT_OPTIONS[pending.option]?.rollKind);
}

export function heroPointRollBonus(actor, kinds) {
  return heroPendingMatches(actor, kinds) ? 20 : 0;
}

export function calledShotEffect(option) {
  if (option === "calledShotHead") return { condition: "stunned", duration: "1d3 rounds" };
  if (option === "calledShotEyes") return { condition: "blinded", duration: "1d10+4 rounds" };
  if (option === "calledShotNerve") return { condition: "limb useless", duration: "1d6 rounds" };
  return null;
}

export function warcraftCharacterLevel(actor) {
  const recorded = Number(actor?.system?.details?.level?.value ?? actor?.system?.details?.level) || 0;
  const classLevels = Array.from(actor?.items ?? [])
    .filter((item) => item?.type === "class")
    .reduce((sum, item) => sum + (Number(item?.system?.levels) || 0), 0);
  return Math.max(1, recorded, classLevels);
}

export function shoutDurationRounds(actor, { halfDuration = false } = {}) {
  const rounds = Math.max(1, Math.floor(warcraftCharacterLevel(actor) / 2));
  return halfDuration ? Math.max(1, Math.floor(rounds / 2)) : rounds;
}

export function shoutSaveDc(actor, shoutName) {
  const halfLevel = Math.floor(warcraftCharacterLevel(actor) / 2);
  const charisma = Number(actor?.system?.abilities?.cha?.mod) || 0;
  const intimidateRanks = Number(actor?.system?.skills?.int?.rank ?? actor?.system?.skills?.int?.points) || 0;
  const synergy = shoutName === "Intimidating Shout" && intimidateRanks >= 5 ? 2 : 0;
  return 10 + halfLevel + charisma + synergy;
}

export function shoutResolution(actor, shoutName, { heroPoint = false, halfDuration = false } = {}) {
  const rules = WARCRAFT_SHOUTS[shoutName];
  if (!rules) return null;
  return {
    ...rules,
    durationRounds: shoutName === "Intimidating Shout" && heroPoint ? "1d6" : shoutDurationRounds(actor, { halfDuration }),
    saveDc: rules.save ? shoutSaveDc(actor, shoutName) : null,
    condition: heroPoint && rules.heroCondition ? rules.heroCondition : rules.condition ?? null,
  };
}

export function resolveHeroAttackOption({ option, modifiedTotal, targetArmorClasses = [], natural = null }) {
  const usesAttackOption = ["attack", "d20", "powerfulBlow", "calledShotHead", "calledShotEyes", "calledShotNerve"].includes(option);
  if (!usesAttackOption) return { applies: false, baseTotal: modifiedTotal, specialEligible: false, manual: false };
  const baseTotal = Number(modifiedTotal) - 20;
  const targets = targetArmorClasses.map(Number).filter(Number.isFinite);
  const naturalMiss = Number(natural) === 1;
  const naturalHit = Number(natural) === 20;
  const hitsWithoutPoint = targets.map((ac) => !naturalMiss && (naturalHit || baseTotal >= ac));
  return {
    applies: true,
    baseTotal,
    specialEligible: targets.length > 0 && hitsWithoutPoint.every(Boolean),
    mixedTargets: hitsWithoutPoint.some(Boolean) && hitsWithoutPoint.some((hit) => !hit),
    manual: targets.length === 0,
  };
}

export async function clearPendingHeroPoint(actor) {
  if (!actor) return;
  return actor.update({ "flags.warcraftrpg2e.heroPoint.pending": null });
}

export async function cancelPendingHeroPoint(actor) {
  const state = heroPointState(actor);
  if (!state.pending) return false;
  await actor.update({
    "system.attributes.heroPoints.value": Math.min(state.max || state.value + 1, state.value + 1),
    "flags.warcraftrpg2e.heroPoint.pending": null,
  });
  return true;
}
