const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function actorFacts(actor = {}) {
  const system = actor.system || actor;
  const items = Array.from(actor.items?.values?.() || actor.items || []);
  return {
    system,
    items,
    names: new Set(items.map((item) => normalize(item.name))),
    classes: new Map(
      items
        .filter((item) => item.type === "class")
        .map((item) => [normalize(item.system?.customTag || item.name), item.system || {}])
    ),
  };
}

function highestCastableSpellLevel(book = {}) {
  let highest = Math.max(0, number(book?.maxSpellLevel));
  for (let level = 0; level <= 9; level += 1) {
    const slot = book?.spells?.[`spell${level}`] || {};
    if (number(slot.max ?? slot.base) > 0) highest = Math.max(highest, level);
  }
  return highest;
}

function pass(requirement, facts) {
  const type = normalize(requirement?.type);
  const key = normalize(requirement?.key || requirement?.name || requirement?.value);
  const minimum = number(requirement?.minimum ?? requirement?.level ?? 1);
  switch (type) {
    case "ability":
      return number(facts.system?.abilities?.[key]?.total ?? facts.system?.abilities?.[key]?.value) >= minimum;
    case "base-attack-bonus":
    case "bab":
      return number(facts.system?.attributes?.bab?.total ?? facts.system?.attributes?.bab?.value) >= minimum;
    case "skill":
      return number(facts.system?.skills?.[key]?.rank) >= minimum;
    case "skill-count": {
      const skills = (requirement?.skills || []).map(normalize);
      const count = Math.max(1, number(requirement?.count));
      return skills.filter((skill) => number(facts.system?.skills?.[skill]?.rank) >= minimum).length >= count;
    }
    case "feat":
    case "item":
    case "race":
      return facts.names.has(key) || normalize(facts.system?.details?.race) === key;
    case "class":
      return number(facts.classes.get(key)?.levels) >= minimum;
    case "path": {
      const parent = normalize(requirement?.parentClass || requirement?.parent);
      const matching = parent ? [facts.classes.get(parent)].filter(Boolean) : Array.from(facts.classes.values());
      return matching.some((classSystem) => number(classSystem?.pathLevels?.[key]) >= minimum);
    }
    case "affiliation": {
      const affiliation = normalize(facts.system?.details?.affiliation);
      const allowed = (requirement?.anyOf || requirement?.values || [requirement?.value]).map(normalize);
      return allowed.includes(affiliation);
    }
    case "alignment": {
      const details = facts.system?.details || {};
      const axes = details.actualAlignmentAxes || details.alignmentAxes || {};
      const alignment = normalize(
        details.alignmentCode || details.alignment || [axes.lawChaos, axes.goodEvil].filter(Boolean).join(" ")
      );
      const allowed = (requirement?.anyOf || requirement?.values || [requirement?.value]).map(normalize);
      if (allowed.includes(alignment)) return true;
      const evil = alignment === "le" || alignment === "ne" || alignment === "ce" || alignment.includes("evil") || axes.goodEvil === "e";
      const lawful = alignment === "lg" || alignment === "ln" || alignment === "le" || alignment.includes("lawful") || axes.lawChaos === "l";
      if (allowed.includes("any-evil") && evil) return true;
      if (allowed.includes("non-lawful") && !lawful) return true;
      return allowed.some((candidate) => candidate.startsWith("any-") && alignment.includes(candidate.slice(4))) ||
        allowed.some((candidate) => candidate === "non-lawful" && !alignment.includes("lawful"));
    }
    case "spell-level": {
      const castingType = normalize(requirement?.spellcastingType);
      return Object.values(facts.system?.attributes?.spells?.spellbooks || {}).some((book) => {
        if (castingType && normalize(book?.spellcastingType) !== castingType) return false;
        if (highestCastableSpellLevel(book) < minimum) return false;
        return requirement?.casterLevel == null || number(book?.cl?.total) >= number(requirement.casterLevel);
      });
    }
    case "spell-schools": {
      const minimumLevel = Math.max(0, number(requirement?.minimumLevel));
      const count = Math.max(1, number(requirement?.count));
      const schools = new Set(
        facts.items
          .filter((item) => item.type === "spell" && number(item.system?.level) >= minimumLevel)
          .map((item) => normalize(item.system?.school))
          .filter(Boolean)
      );
      return schools.size >= count;
    }
    case "all":
      return (requirement?.requirements || []).every((child) => pass(child, facts));
    case "any":
      return (requirement?.requirements || []).some((child) => pass(child, facts));
    case "not":
      return !pass(requirement?.requirement || requirement?.requirements?.[0] || {}, facts);
    // Narrative gates cannot be proven from actor data. Keep them visible and
    // manual instead of pretending an unreliable automation is authoritative.
    case "manual":
      return requirement?.satisfied === true;
    default:
      return false;
  }
}

export function evaluateWarcraftPrerequisites(requirements = [], actor = {}) {
  const facts = actorFacts(actor);
  const results = (Array.isArray(requirements) ? requirements : []).map((requirement) => ({
    requirement,
    met: pass(requirement, facts),
    label: String(requirement?.label || requirement?.name || requirement?.type || "Requirement"),
  }));
  const hasManualGate = (requirement) => {
    if (normalize(requirement?.type) === "manual") return true;
    return (requirement?.requirements || []).some(hasManualGate);
  };
  const unmet = results.filter((result) => !result.met);
  const manual = unmet.filter((result) => hasManualGate(result.requirement));
  const automatedUnmet = unmet.filter((result) => !hasManualGate(result.requirement));
  return {
    met: results.every((result) => result.met),
    automatedMet: automatedUnmet.length === 0,
    results,
    unmet,
    automatedUnmet,
    manual,
  };
}

export function getWarcraftItemPrerequisites(itemSystem = {}) {
  return Array.isArray(itemSystem?.warcraftPrerequisites) ? itemSystem.warcraftPrerequisites : [];
}
