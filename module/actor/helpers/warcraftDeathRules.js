export const DEATH_RULE_D35E = "d35e";
export const DEATH_RULE_WARCRAFT = "warcraft";
export const DEATH_RULE_FORSAKEN = "forsaken";
export const DEATH_RULE_WARCRAFT_CONSTRUCT = "warcraft-construct";

const WARCRAFT_DEATH_RULES = new Set([
  DEATH_RULE_WARCRAFT,
  DEATH_RULE_FORSAKEN,
  DEATH_RULE_WARCRAFT_CONSTRUCT,
]);

/**
 * Resolve the health rule selected directly by an actor or supplied by its race.
 * Unknown values deliberately fall back to D35E so existing actors keep the
 * original fixed -10 HP death threshold.
 */
export function resolveDeathRule(actorRule, raceRule) {
  if (WARCRAFT_DEATH_RULES.has(actorRule)) return actorRule;
  if (WARCRAFT_DEATH_RULES.has(raceRule)) return raceRule;
  return DEATH_RULE_D35E;
}

/** Forsaken and constructs do not regain hit points from ordinary rest. */
export function usesNaturalHitPointRecovery(actorRule, raceRule) {
  const deathRule = resolveDeathRule(actorRule, raceRule);
  return deathRule !== DEATH_RULE_FORSAKEN && deathRule !== DEATH_RULE_WARCRAFT_CONSTRUCT;
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
export function classifyWarcraftHealth({ hitPoints, staminaScore, deathRule }) {
  const hp = Number(hitPoints);
  if (!Number.isFinite(hp)) throw new TypeError("hitPoints must be a finite number");

  if (deathRule === DEATH_RULE_WARCRAFT_CONSTRUCT) {
    return {
      dead: hp <= 0,
      dying: false,
      disabled: false,
      usesStamina: false,
    };
  }

  if (deathRule === DEATH_RULE_FORSAKEN) {
    return {
      dead: hp <= -10,
      dying: hp < 0 && hp > -10,
      disabled: hp === 0,
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

  return {
    dead: hp < -score,
    dying: hp < disabledMinimum && hp >= -score,
    disabled: hp <= 0 && hp >= disabledMinimum,
    usesStamina: true,
  };
}
