const normalized = (value) => String(value ?? "").trim().toLowerCase();

/**
 * Return natural HP recovered by an eight-hour rest.
 *
 * Jungle trolls without racial levels double normal recovery. Their first
 * racial level replaces that trait with Stamina modifier per hour. At levels
 * 2-3 fast healing is continuous, so the ordinary rest calculation is not an
 * additional source of healing.
 */
export function warcraftRestHitPointRecovery({
  hitDice,
  staminaModifier,
  raceName,
  racialClassLevels = 0,
  hours = 8,
  longTermCare = false,
} = {}) {
  const hd = Math.max(0, Number(hitDice) || 0);
  const racialLevels = Math.max(0, Math.trunc(Number(racialClassLevels) || 0));
  const careMultiplier = longTermCare ? 2 : 1;
  if (normalized(raceName) !== "jungle troll") return hd * careMultiplier;
  if (racialLevels >= 2) return 0;
  if (racialLevels === 1) {
    return Math.max(0, Number(staminaModifier) || 0) * Math.max(0, Number(hours) || 0) * careMultiplier;
  }
  return hd * 2 * careMultiplier;
}
