export const SPELLBOOK_PREPARATION_MODE_PREPARED = "prepared";
export const SPELLBOOK_PREPARATION_MODE_SPONTANEOUS = "spontaneous";
export const SPELLBOOK_PREPARATION_MODE_REPERTOIRE = "repertoire";

/**
 * Resolve the spellbook preparation mode while preserving legacy spellbooks
 * which only store the spontaneous boolean.
 *
 * @param {object} spellbook Spellbook system data.
 * @returns {"prepared"|"spontaneous"|"repertoire"}
 */
export function getSpellbookPreparationMode(spellbook = {}) {
  const mode = spellbook?.preparationMode;
  if (
    mode === SPELLBOOK_PREPARATION_MODE_PREPARED ||
    mode === SPELLBOOK_PREPARATION_MODE_SPONTANEOUS ||
    mode === SPELLBOOK_PREPARATION_MODE_REPERTOIRE
  ) {
    return mode;
  }

  return spellbook?.spontaneous ? SPELLBOOK_PREPARATION_MODE_SPONTANEOUS : SPELLBOOK_PREPARATION_MODE_PREPARED;
}

/**
 * Whether casts consume the spellbook's shared per-level slot pool.
 *
 * @param {object} spellbook Spellbook system data.
 * @returns {boolean}
 */
export function spellbookUsesSharedSlots(spellbook = {}) {
  const mode = getSpellbookPreparationMode(spellbook);
  return mode === SPELLBOOK_PREPARATION_MODE_SPONTANEOUS || mode === SPELLBOOK_PREPARATION_MODE_REPERTOIRE;
}

/**
 * Whether a spell passes its spellbook's repertoire-membership gate.
 * Non-repertoire spellbooks are intentionally unaffected.
 *
 * @param {object} spellSystem Spell system data.
 * @param {object} spellbook Spellbook system data.
 * @returns {boolean}
 */
export function isSpellPreparedForSpellbook(spellSystem = {}, spellbook = {}) {
  return (
    getSpellbookPreparationMode(spellbook) !== SPELLBOOK_PREPARATION_MODE_REPERTOIRE ||
    spellSystem?.preparation?.prepared === true
  );
}

/**
 * Warcraft RPG 2e maximum number of distinct prepared spells at each spell
 * level. Spellcraft grants one additional prepared spell per four ranks.
 *
 * @param {number|string} abilityScore Final spellcasting ability score.
 * @param {number|string} spellcraftRanks Spellcraft ranks, not total modifier.
 * @returns {number}
 */
export function getRepertoirePreparedLimit(abilityScore, spellcraftRanks = 0) {
  const numericScore = Number(abilityScore);
  const score = Number.isFinite(numericScore) ? Math.floor(numericScore) : 0;
  let base = 0;

  if (score >= 21) base = 13;
  else if (score >= 19) base = 11;
  else if (score >= 17) base = 9;
  else if (score >= 15) base = 7;
  else if (score >= 13) base = 5;
  else if (score >= 10) base = 3;

  const numericRanks = Number(spellcraftRanks);
  const ranks = Number.isFinite(numericRanks) ? Math.max(0, Math.floor(numericRanks)) : 0;
  return base + Math.floor(ranks / 4);
}

/**
 * Resolve the repertoire cap from actor and spellbook system data.
 *
 * @param {object} actorSystem Actor system data.
 * @param {object} spellbook Spellbook system data.
 * @returns {number}
 */
export function getSpellbookRepertoireLimit(actorSystem = {}, spellbook = {}) {
  const explicitLimit = Number(spellbook?.repertoireLimitOverride);
  if (Number.isFinite(explicitLimit) && explicitLimit > 0) return Math.floor(explicitLimit);
  const abilityKey = spellbook?.ability || "int";
  const skillKey = spellbook?.repertoireSkill || "spl";
  const ability = actorSystem?.abilities?.[abilityKey] || {};
  const skill = actorSystem?.skills?.[skillKey] || {};
  // Use the stored score before temporary modifiers. Effects such as Arcane
  // Intellect improve checks and spell DCs, but do not expand a repertoire.
  return getRepertoirePreparedLimit(ability.value ?? ability.total ?? 0, skill.rank ?? 0);
}
