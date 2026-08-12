export const DEATH_RULE_D35E = "d35e";
export const DEATH_RULE_WARCRAFT = "warcraft";
export const DEATH_RULE_FORSAKEN = "forsaken";
export const DEATH_RULE_WARCRAFT_CONSTRUCT = "warcraft-construct";
export const DEATH_RULE_WARCRAFT_UNDEAD = "warcraft-undead";

const WARCRAFT_DEATH_RULES = new Set([
  DEATH_RULE_WARCRAFT,
  DEATH_RULE_FORSAKEN,
  DEATH_RULE_WARCRAFT_CONSTRUCT,
  DEATH_RULE_WARCRAFT_UNDEAD,
]);

/**
 * Resolve the health rule selected directly by an actor or supplied by its race.
 * Unknown values deliberately fall back to D35E so existing actors keep the
 * original fixed -10 HP death threshold.
 */
export function resolveDeathRule(actorRule, raceRule, creatureType) {
  const normalizedCreatureType = String(creatureType ?? "").trim().toLowerCase();
  // Old construct actors may not carry the explicit Warcraft marker. Their
  // creature type is nevertheless authoritative for destruction and healing.
  if (normalizedCreatureType === "construct") {
    return DEATH_RULE_WARCRAFT_CONSTRUCT;
  }
  // Explicit actor/race rules win. This keeps Forsaken on their special -10
  // track even though their creature type is undead.
  if (WARCRAFT_DEATH_RULES.has(actorRule) && actorRule !== DEATH_RULE_WARCRAFT) return actorRule;
  if (actorRule === DEATH_RULE_WARCRAFT && normalizedCreatureType !== "undead") return actorRule;
  if (WARCRAFT_DEATH_RULES.has(raceRule)) return raceRule;
  // A generic actor's Warcraft-living default does not override an undead
  // creature type. Explicit `warcraft-undead` is also accepted above.
  if (normalizedCreatureType === "undead") return DEATH_RULE_WARCRAFT_UNDEAD;
  if (actorRule === DEATH_RULE_WARCRAFT) return actorRule;
  return DEATH_RULE_D35E;
}

/** Forsaken, constructs, and generic undead do not regain hit points from ordinary rest. */
export function usesNaturalHitPointRecovery(actorRule, raceRule, creatureType) {
  const deathRule = resolveDeathRule(actorRule, raceRule, creatureType);
  return deathRule !== DEATH_RULE_FORSAKEN
    && deathRule !== DEATH_RULE_WARCRAFT_CONSTRUCT
    && deathRule !== DEATH_RULE_WARCRAFT_UNDEAD;
}

/** The Heal check DC to stabilize a living Warcraft creature. */
export function warcraftStabilizationDc(hitPoints) {
  const hp = Number(hitPoints);
  if (!Number.isFinite(hp)) throw new TypeError("hitPoints must be a finite number");
  return 10 + Math.abs(Math.min(0, Math.trunc(hp)));
}

/** Warcraft stabilization and recovery checks are d% rolls against Stamina. */
export function succeedsWarcraftStaminaPercentile(roll, staminaScore) {
  const result = Number(roll);
  const stamina = Number(staminaScore);
  if (!Number.isFinite(result) || result < 1 || result > 100) {
    throw new RangeError("roll must be between 1 and 100");
  }
  if (!Number.isFinite(stamina)) throw new TypeError("staminaScore must be a finite number");
  return result <= Math.max(0, Math.min(100, Math.trunc(stamina)));
}

/**
 * Resolve a living Warcraft creature's per-round stabilization check.
 * A failed check costs 1 hit point; success makes the creature stable.
 */
export function resolveWarcraftStabilization({ hitPoints, staminaScore, roll }) {
  const current = classifyWarcraftHealth({ hitPoints, staminaScore, deathRule: DEATH_RULE_WARCRAFT });
  if (!current.dying) {
    return { attempted: false, success: false, hitPoints: Number(hitPoints), stable: false, ...current };
  }

  const success = succeedsWarcraftStaminaPercentile(roll, staminaScore);
  const nextHitPoints = success ? Number(hitPoints) : Number(hitPoints) - 1;
  const next = classifyWarcraftHealth({
    hitPoints: nextHitPoints,
    staminaScore,
    deathRule: DEATH_RULE_WARCRAFT,
  });
  return {
    attempted: true,
    success,
    hitPoints: nextHitPoints,
    ...next,
    stable: success && !next.dead,
    dying: success ? false : next.dying,
  };
}

/**
 * Resolve the hourly recovery check made by a stable Warcraft creature.
 * Tended creatures remain stable on failure. Untended creatures lose 1 HP.
 */
export function resolveWarcraftStableRecovery({ hitPoints, staminaScore, roll, tended = false }) {
  const success = succeedsWarcraftStaminaPercentile(roll, staminaScore);
  const score = Math.max(0, Math.trunc(Number(staminaScore)));
  const disabledMinimum = -Math.max(0, Math.floor((score - 10) / 2));
  // The book says a successful hourly check makes the stable creature conscious
  // and disabled. Move its tracked HP to the disabled boundary so later actor
  // preparation cannot infer "dying" again from the unchanged negative value.
  const nextHitPoints = success
    ? Math.max(Number(hitPoints), disabledMinimum)
    : tended
      ? Number(hitPoints)
      : Number(hitPoints) - 1;
  const next = classifyWarcraftHealth({
    hitPoints: nextHitPoints,
    staminaScore,
    deathRule: DEATH_RULE_WARCRAFT,
  });
  return {
    attempted: true,
    success,
    tended: Boolean(tended),
    conscious: success,
    hitPoints: nextHitPoints,
    stable: !success && !next.dead,
    ...next,
    disabled: success || next.disabled,
    dying: false,
    unconscious: !success && next.unconscious,
  };
}

/**
 * Classify a Warcraft actor's HP state.
 *
 * Living creatures are disabled from 0 HP through the negative of their
 * Stamina modifier, dying through the negative of their Stamina score, and
 * dead only below the negative of their Stamina score. Forsaken do not use a
 * Stamina score: they are disabled at 0, down from -1 through -9, and
 * destroyed at -10 or lower. Constructs are destroyed at 0 HP and never use
 * disabled or dying states.
 *
 * @returns {{dead: boolean, dying: boolean, disabled: boolean, usesStamina: boolean}}
 */
export function classifyWarcraftHealth({ hitPoints, staminaScore, deathRule, stable = false }) {
  const hp = Number(hitPoints);
  if (!Number.isFinite(hp)) throw new TypeError("hitPoints must be a finite number");

  if (deathRule === DEATH_RULE_WARCRAFT_CONSTRUCT || deathRule === DEATH_RULE_WARCRAFT_UNDEAD) {
    return {
      dead: hp <= 0,
      dying: false,
      disabled: false,
      down: false,
      unconscious: hp <= 0,
      usesStamina: false,
    };
  }

  if (deathRule === DEATH_RULE_FORSAKEN) {
    return {
      dead: hp <= -10,
      dying: false,
      disabled: hp === 0,
      down: hp < 0 && hp > -10,
      unconscious: hp < 0,
      usesStamina: false,
    };
  }

  if (deathRule !== DEATH_RULE_WARCRAFT) {
    throw new TypeError(`Unsupported Warcraft death rule: ${deathRule}`);
  }

  const score = Math.max(0, Math.trunc(Number(staminaScore)));
  if (!Number.isFinite(score)) throw new TypeError("staminaScore must be a finite number");

  const modifier = Math.floor((score - 10) / 2);
  const disabledMinimum = -Math.max(0, modifier);

  const dead = hp < -score;
  const inDyingRange = hp < disabledMinimum && hp >= -score;
  return {
    dead,
    dying: inDyingRange && !stable,
    disabled: hp <= 0 && hp >= disabledMinimum,
    down: false,
    unconscious: inDyingRange || dead,
    usesStamina: true,
  };
}
