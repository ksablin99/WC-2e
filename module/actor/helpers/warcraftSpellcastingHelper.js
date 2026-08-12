/**
 * Pure Warcraft RPG 2e spellcasting rules shared by actor preparation, item
 * use, and tests. Nothing in this file depends on Foundry globals.
 */

export const WARCRAFT_SPELLCASTING_PATHS = Object.freeze({
  arcanist: Object.freeze(["mage", "necromancer", "warlock"]),
  healer: Object.freeze(["druid", "priest", "shaman"]),
});

export const WARCRAFT_PATH_PARENTS = Object.freeze(
  Object.fromEntries(
    Object.entries(WARCRAFT_SPELLCASTING_PATHS).flatMap(([parent, paths]) =>
      paths.map((path) => [path, parent])
    )
  )
);

const integer = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : 0;
};

export function normalizeWarcraftRuleName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getWarcraftPathParent(path) {
  return WARCRAFT_PATH_PARENTS[normalizeWarcraftRuleName(path)] || "";
}

export function getWarcraftClassPathLevel(classSystem = {}, path = "") {
  const normalized = normalizeWarcraftRuleName(path);
  return Math.max(0, integer(classSystem?.pathLevels?.[normalized]));
}

export function getWarcraftCurrentPath(classSystem = {}) {
  const parent = normalizeWarcraftRuleName(classSystem?.name || classSystem?.className || "");
  const candidate = normalizeWarcraftRuleName(classSystem?.currentPath);
  const choices = Array.isArray(classSystem?.classPaths?.choices)
    ? classSystem.classPaths.choices.map((choice) => normalizeWarcraftRuleName(choice?.id || choice))
    : WARCRAFT_SPELLCASTING_PATHS[parent] || [];
  if (candidate && choices.includes(candidate) && getWarcraftClassPathLevel(classSystem, candidate) > 0) return candidate;
  return choices.find((path) => getWarcraftClassPathLevel(classSystem, path) > 0) || "";
}

/**
 * Return the path progression level used by a class feature. Ordinary class
 * features use parent class level; a feature bearing Warcraft path metadata
 * uses only levels actually taken in that path.
 */
export function getWarcraftFeatureProgression(featureSystem = {}, classSystem = {}, parentName = "") {
  const rule = featureSystem?.warcraftPath || featureSystem?.warcraft?.path || {};
  const path = normalizeWarcraftRuleName(rule?.id || rule?.path || "");
  const requiredParent = normalizeWarcraftRuleName(rule?.parentClass || rule?.parent || "");
  const actualParent = normalizeWarcraftRuleName(parentName || classSystem?.name || classSystem?.className || "");
  if (!path) return { level: Math.max(0, integer(classSystem?.levels ?? classSystem?.level)), path: "" };
  if (requiredParent && requiredParent !== actualParent) return { level: 0, path, incompatible: true };
  return { level: getWarcraftClassPathLevel(classSystem, path), path, incompatible: false };
}

export function getWarcraftSpellAssignments(spellSystem = {}) {
  const assignments = Array.isArray(spellSystem?.learnedAt?.class) ? spellSystem.learnedAt.class : [];
  return assignments
    .map((entry) => ({
      name: normalizeWarcraftRuleName(Array.isArray(entry) ? entry[0] : entry?.name),
      level: Math.max(0, integer(Array.isArray(entry) ? entry[1] : entry?.level)),
    }))
    .filter((entry) => entry.name);
}

/**
 * Validate a spell against a parent class and the paths the actor actually
 * owns. A real parent-list assignment is general; path-only assignments need
 * a level in at least one listed path.
 */
export function evaluateWarcraftSpellEligibility(spellSystem = {}, classSystem = {}, options = {}) {
  const parent = normalizeWarcraftRuleName(
    options.parentClass || classSystem?.name || classSystem?.className || options.className
  );
  const parentPaths = WARCRAFT_SPELLCASTING_PATHS[parent] || [];
  const assignments = getWarcraftSpellAssignments(spellSystem);
  if (!parent || parentPaths.length === 0 || assignments.length === 0) {
    return { eligible: true, parent, path: "", spellLevel: Math.max(0, integer(spellSystem?.level)), penalties: null };
  }

  const assignedPaths = assignments.filter((entry) => parentPaths.includes(entry.name));
  const parentAssignment = assignments.find((entry) => entry.name === parent);
  const ownedPathAssignments = assignedPaths.filter((entry) => getWarcraftClassPathLevel(classSystem, entry.name) > 0);
  const chosenPath = normalizeWarcraftRuleName(options.learnedPath || spellSystem?.warcraftLearnedPath);
  const currentPath = normalizeWarcraftRuleName(options.currentPath || getWarcraftCurrentPath(classSystem));
  const selected = ownedPathAssignments.find((entry) => entry.name === chosenPath)
    || (!parentAssignment && ownedPathAssignments.find((entry) => entry.name === currentPath))
    || (!parentAssignment
      ? [...ownedPathAssignments].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))[0]
      : null);

  if (assignedPaths.length > 0 && !selected && !parentAssignment) {
    return {
      eligible: false,
      parent,
      path: "",
      spellLevel: parentAssignment?.level ?? Math.max(0, integer(spellSystem?.level)),
      reason: `Requires a level in ${assignedPaths.map((entry) => entry.name).join(" or ")}.`,
      penalties: null,
    };
  }

  if (!selected && !parentAssignment) {
    return {
      eligible: false,
      parent,
      path: "",
      spellLevel: Math.max(0, integer(spellSystem?.level)),
      reason: `Not on the ${parent} spell list.`,
      penalties: null,
    };
  }

  const spellLevel = selected?.level ?? parentAssignment?.level ?? Math.max(0, integer(spellSystem?.level));
  const offPath = Boolean(selected && currentPath && selected.name !== currentPath);
  return {
    eligible: true,
    parent,
    path: selected?.name || "",
    spellLevel,
    penalties: offPath
      ? {
          casterLevel: -2,
          saveDc: -2,
          failurePercent: Math.max(0, spellLevel * 2),
          reason: `The spell belongs to ${selected.name}, not the current ${currentPath} path.`,
        }
      : null,
  };
}

/** Current-path caster-level and save-DC adjustments for a known spell. */
export function getWarcraftSpellcastingAdjustments(spellSystem = {}, classSystem = {}, options = {}) {
  const eligibility = evaluateWarcraftSpellEligibility(spellSystem, classSystem, options);
  if (!eligibility.eligible) return { casterLevel: 0, saveDc: 0, failurePercent: 0, eligibility };
  const pathSpell = Boolean(eligibility.path);
  return {
    casterLevel: eligibility.penalties?.casterLevel || 0,
    // Every acquired Arcanist path list grants +1 DC. Forbidden Arts then
    // reduces an off-current path by 2, for a net -1 relative to a general spell.
    saveDc: (pathSpell && eligibility.parent === "arcanist" ? 1 : 0) + (eligibility.penalties?.saveDc || 0),
    failurePercent: eligibility.penalties?.failurePercent || 0,
    eligibility,
  };
}

/** Forbidden Arts can reduce an off-path spell, but never below caster level 1. */
export function enforceWarcraftCasterLevelMinimum(casterLevel, adjustment = {}) {
  const value = integer(casterLevel);
  return integer(adjustment?.casterLevel) < 0 ? Math.max(1, value) : value;
}

/** Warcraft spellcasters need a casting-ability score of 10 + spell level. */
export function meetsWarcraftCastingAbilityMinimum(abilityScore, spellLevel) {
  return integer(abilityScore) >= 10 + Math.max(0, integer(spellLevel));
}

export function getWarcraftSlotPoolKey(spellbook = {}) {
  if (spellbook?.usesWarcraftSlotPool !== true) return "";
  return normalizeWarcraftRuleName(spellbook?.warcraftPoolKey || spellbook?.spellslotAbility || spellbook?.ability);
}

export function getWarcraftSlotPool(actorSystem = {}, spellbook = {}) {
  const key = getWarcraftSlotPoolKey(spellbook);
  return key ? actorSystem?.attributes?.spells?.warcraftPools?.[key] || null : null;
}

/** Choose an exact-level slot first, then the lowest available higher slot. */
export function findWarcraftCastSlotLevel(pool = {}, spellLevel = 0, requestedLevel = null) {
  const minimum = Math.max(0, integer(spellLevel));
  const requested = requestedLevel == null ? null : Math.max(minimum, integer(requestedLevel));
  if (requested != null && integer(pool?.spells?.[`spell${requested}`]?.value) > 0) return requested;
  for (let level = minimum; level <= 9; level += 1) {
    if (integer(pool?.spells?.[`spell${level}`]?.value) > 0) return level;
  }
  return null;
}

/**
 * Aggregate compatible Warcraft spellbooks into ability-keyed generic slot
 * pools. Existing expenditure is preserved when a derived maximum changes.
 */
export function calculateWarcraftSlotPools(spellbooks = {}, existingPools = {}) {
  const totals = {};
  for (const [spellbookKey, spellbook] of Object.entries(spellbooks || {})) {
    const poolKey = getWarcraftSlotPoolKey(spellbook);
    if (!poolKey) continue;
    const pool = (totals[poolKey] ||= { key: poolKey, spellbooks: [], spells: {} });
    pool.spellbooks.push(spellbookKey);
    for (let level = 0; level <= 9; level += 1) {
      const max = Math.max(0, integer(spellbook?.spells?.[`spell${level}`]?.max));
      const target = (pool.spells[`spell${level}`] ||= { max: 0, value: 0 });
      target.max += max;
    }
  }

  for (const [poolKey, pool] of Object.entries(totals)) {
    pool.spellbooks.sort();
    for (let level = 0; level <= 9; level += 1) {
      const slot = pool.spells[`spell${level}`];
      const previous = existingPools?.[poolKey]?.spells?.[`spell${level}`] || {};
      const previousMax = Math.max(0, integer(previous.max));
      const previousValue = Math.max(0, integer(previous.value));
      const spent = Math.max(0, previousMax - previousValue);
      slot.value = Math.max(0, slot.max - spent);
    }
  }
  return totals;
}

/**
 * Allocate full prestige caster advancement deterministically. An explicit
 * target wins; otherwise a sole compatible base class is selected. Ambiguous
 * choices are reported for the sheet rather than guessed.
 */
export function allocateWarcraftPrestigeCasterLevels(classItems = []) {
  const result = { byClass: {}, slotByClass: {}, unresolved: [] };
  const baseClasses = (classItems || []).filter((item) => item?.system?.classType === "base");
  for (const prestige of (classItems || []).filter((item) => item?.system?.warcraftSpellcastingAdvancement)) {
    const advancement = prestige.system.warcraftSpellcastingAdvancement;
    if (!advancement || advancement.mode !== "full") continue;
    const sourceLevels = Math.max(0, integer(prestige.system?.levels));
    const thresholdBonus = (Array.isArray(advancement.bonusCasterLevels) ? advancement.bonusCasterLevels : [])
      .filter((entry) => sourceLevels >= Math.max(1, integer(entry?.atLevel)))
      .reduce((total, entry) => total + Math.max(0, integer(entry?.amount)), 0);
    const levels = sourceLevels + thresholdBonus;
    if (!levels) continue;

    const explicit = normalizeWarcraftRuleName(advancement.selectedClass);
    let candidates = baseClasses.filter((item) => {
      const tag = normalizeWarcraftRuleName(item.system?.customTag || item.name);
      if (explicit) return tag === explicit || normalizeWarcraftRuleName(item.name) === explicit;
      const wantedType = normalizeWarcraftRuleName(advancement.spellcastingType);
      return !wantedType || normalizeWarcraftRuleName(item.system?.spellcastingType) === wantedType;
    });
    if (!explicit && (advancement.target === "highest" || prestige.system?.classType === "racial") && candidates.length > 1) {
      const highest = Math.max(...candidates.map((item) => Math.max(0, integer(item.system?.levels))));
      candidates = candidates.filter((item) => Math.max(0, integer(item.system?.levels)) === highest);
    }
    if (candidates.length !== 1) {
      result.unresolved.push({ prestigeId: prestige.id, name: prestige.name, candidates: candidates.map((item) => item.id) });
      continue;
    }
    const target = normalizeWarcraftRuleName(candidates[0].system?.customTag || candidates[0].name);
    if (advancement.affectsCasterLevel !== false) {
      result.byClass[target] = (result.byClass[target] || 0) + levels;
    }
    const affectsSlots = advancement.affectsSlots ?? prestige.system?.classType !== "racial";
    if (affectsSlots) result.slotByClass[target] = (result.slotByClass[target] || 0) + levels;
  }
  return result;
}
