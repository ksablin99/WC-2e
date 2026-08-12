const ABILITY_ALIASES = {
  str: ["str", "strength"],
  dex: ["agy", "agility", "dex", "dexterity"],
  con: ["sta", "stamina", "con", "constitution"],
  int: ["int", "intellect", "intelligence"],
  wis: ["spt", "spirit", "wis", "wisdom"],
  cha: ["cha", "charisma"],
};

const CLASS_LEVEL_PATTERN = /\b([a-z][a-z '-]+?)\s+level\s+(\d+)(?:st|nd|rd|th)?\b/i;

export function normalizeWarcraftPrerequisiteText(value = "") {
  return String(value)
    .replace(/\bprofi\s*ciency\b/gi, "Proficiency")
    .replace(/\bdefl\s*ect\b/gi, "deflect")
    .replace(/\bfi\s*rearms\b/gi, "firearms")
    .replace(/\bfl\s*oor\b/gi, "floor")
    .replace(/ride-\s+by/gi, "Ride-By")
    // One catalogue cell is followed by accidentally extracted tracking prose.
    .replace(/\.\s*Firm Ground:[\s\S]*$/i, ".")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(value) {
  return normalizeWarcraftPrerequisiteText(value)
    .toLowerCase()
    .replace(/[“”'’]/g, "")
    .replace(/[^a-z0-9+()-]+/g, " ")
    .trim();
}

function getPath(object, path, fallback = undefined) {
  let value = object;
  for (const part of path.split(".")) value = value?.[part];
  return value ?? fallback;
}

function actorItems(actor) {
  return Array.from(actor?.items ?? actor?.itemTypes?.feat ?? []);
}

function itemIdentity(item) {
  return norm(
    getPath(item, "system.uniqueId") ||
      getPath(item, "flags.warcraftrpg2e.selectionKey") ||
      getPath(item, "flags.warcraftrpg2e.feat.selectionKey") ||
      item?.name ||
      ""
  );
}

function itemNames(actor) {
  return new Set(actorItems(actor).map((item) => norm(item?.name)).filter(Boolean));
}

function itemHasName(names, expected) {
  const wanted = norm(expected);
  if (!wanted) return false;
  if (names.has(wanted)) return true;
  // Selected-weapon feats are normally named "Weapon Focus (longsword)".
  return [...names].some((name) => name === wanted || name.startsWith(`${wanted} (`));
}

function abilityValue(actor, key) {
  const data = getPath(actor, `system.abilities.${key}`, {});
  return Number(data?.total ?? data?.value ?? 0);
}

function baseAttackBonus(actor) {
  return Number(getPath(actor, "system.attributes.bab.total", getPath(actor, "system.attributes.bab.value", 0)) || 0);
}

function characterLevel(actor) {
  const explicit = Number(getPath(actor, "system.details.level.value", getPath(actor, "system.attributes.hd.total", 0)) || 0);
  if (explicit) return explicit;
  return actorItems(actor)
    .filter((item) => item?.type === "class" || item?.type === "race")
    .reduce((sum, item) => sum + Number(getPath(item, "system.levels", getPath(item, "system.level", 0)) || 0), 0);
}

function classLevel(actor, className) {
  const wanted = norm(className).replace(/\bcharacter$/, "").trim();
  if (wanted === "character") return characterLevel(actor);
  if (wanted === "caster") {
    return Math.max(
      Number(getPath(actor, "system.attributes.prestigeCl.arcane.total", 0) || 0),
      Number(getPath(actor, "system.attributes.prestigeCl.divine.total", 0) || 0),
      ...actorItems(actor).filter((item) => item?.type === "class").map((item) => Number(getPath(item, "system.casterLevel", 0) || 0))
    );
  }
  const matching = actorItems(actor).filter((item) => item?.type === "class" && norm(item?.name).includes(wanted));
  return matching.reduce((sum, item) => sum + Number(getPath(item, "system.levels", getPath(item, "system.level", 0)) || 0), 0);
}

function skillRank(actor, requested) {
  const wanted = norm(requested).replace(/\s*\(any\)$/, "");
  const skills = getPath(actor, "system.skills", {});
  const config = globalThis.CONFIG?.D35E?.skills ?? {};
  let best = 0;
  for (const [key, data] of Object.entries(skills)) {
    const label = config[key] ? globalThis.game?.i18n?.localize?.(config[key]) ?? config[key] : key;
    const candidates = [key, label, data?.name, data?.custom].map(norm);
    if (candidates.some((candidate) => candidate === wanted || candidate.startsWith(`${wanted} (`))) {
      best = Math.max(best, Number(data?.rank ?? data?.points ?? 0));
    }
  }
  return best;
}

function hasSpellLevel(actor, level) {
  return actorItems(actor).some((item) => {
    if (item?.type !== "spell") return false;
    return Number(getPath(item, "system.level", 0)) >= level;
  }) || actorItems(actor).some((item) => {
    if (item?.type !== "class") return false;
    const spellbook = getPath(item, "system.spellbook", []);
    return Array.from(spellbook ?? []).some((entry, index) => index >= level && (entry?.spells?.length || entry?.max || entry?.value));
  });
}

function naturalAttackCount(actor) {
  return actorItems(actor).filter((item) => item?.type === "attack" && (getPath(item, "system.attackType") === "natural" || getPath(item, "system.attackType") === "naturalAttack")).length;
}

function actorRaceAndSize(actor) {
  const races = actorItems(actor).filter((item) => item?.type === "race").map((item) => norm(item?.name));
  const size = norm(getPath(actor, "system.traits.size", "med"));
  return { races, size };
}

function structuredRequirements(feat) {
  const data = getPath(feat, "flags.warcraftrpg2e.feat.requirements", []);
  return Array.isArray(data) ? data : [];
}

function evaluateStructured(requirement, actor, names) {
  const type = norm(requirement?.type);
  const value = Number(requirement?.value ?? 0);
  if (type === "ability") return abilityValue(actor, norm(requirement.key)) >= value;
  if (type === "bab") return baseAttackBonus(actor) >= value;
  if (type === "level") return characterLevel(actor) >= value;
  if (type === "class") return classLevel(actor, requirement.key) >= value;
  if (type === "caster") return classLevel(actor, "caster") >= value;
  if (type === "skill") return skillRank(actor, requirement.key) >= value;
  if (type === "feat") return itemHasName(names, requirement.key);
  if (type === "spell-level") return hasSpellLevel(actor, value);
  if (type === "natural-attacks") return naturalAttackCount(actor) >= value;
  if (type === "race") return actorRaceAndSize(actor).races.includes(norm(requirement.key));
  if (type === "size") return actorRaceAndSize(actor).size === norm(requirement.key);
  if (type === "feature") return itemHasName(names, requirement.key);
  return null;
}

function parseAlternativeClause(clause) {
  return clause.split(/\s+or\s+/i).map((part) => part.trim()).filter(Boolean);
}

function evaluateClause(clause, actor, names) {
  const clean = normalizeWarcraftPrerequisiteText(clause).replace(/[.;]+$/, "").trim();
  if (!clean) return { met: true, understood: true };

  // These mixed alternatives have different operand types. Handle the whole
  // printed clause before generic "or" recursion treats race names as feats.
  let match = clean.match(/^(\w+) or (\w+) or character level (\d+)\+?$/i);
  if (match) {
    const { races } = actorRaceAndSize(actor);
    return { met: races.includes(norm(match[1])) || races.includes(norm(match[2])) || characterLevel(actor) >= Number(match[3]), understood: true };
  }
  match = clean.match(/^(\w+) or size (\w+)$/i);
  if (match) {
    const { races, size } = actorRaceAndSize(actor);
    return { met: races.includes(norm(match[1])) || size === norm(match[2]), understood: true };
  }

  const alternatives = parseAlternativeClause(clean);
  if (alternatives.length > 1) {
    const results = alternatives.map((part) => evaluateClause(part, actor, names));
    return { met: results.some((result) => result.met), understood: results.every((result) => result.understood) };
  }

  for (const [key, aliases] of Object.entries(ABILITY_ALIASES)) {
    const match = clean.match(new RegExp(`^(?:${aliases.join("|")})\\s*(\\d+)$`, "i"));
    if (match) return { met: abilityValue(actor, key) >= Number(match[1]), understood: true };
  }

  match = clean.match(/^base attack bonus\s*\+?(\d+)$/i);
  if (match) return { met: baseAttackBonus(actor) >= Number(match[1]), understood: true };
  match = clean.match(/^character level\s+(\d+)(?:st|nd|rd|th)?\+?$/i);
  if (match) return { met: characterLevel(actor) >= Number(match[1]), understood: true };
  match = clean.match(CLASS_LEVEL_PATTERN);
  if (match) return { met: classLevel(actor, match[1]) >= Number(match[2]), understood: true };
  match = clean.match(/^(.+?)\s+(\d+)\s+ranks?$/i);
  if (match) return { met: skillRank(actor, match[1]) >= Number(match[2]), understood: true };
  match = clean.match(/^able to cast\s+(\d+)(?:st|nd|rd|th)-level spells?$/i);
  if (match) return { met: hasSpellLevel(actor, Number(match[1])), understood: true };
  match = clean.match(/^(?:one|1) shout feat$/i);
  if (match) {
    const shouts = actorItems(actor).filter((item) => norm(getPath(item, "flags.warcraftrpg2e.feat.category")) === "shout");
    return { met: shouts.length >= 1, understood: true };
  }
  if (/^ability to rage$/i.test(clean)) return { met: itemHasName(names, "Rage"), understood: true };
  if (/^wild shape ability$/i.test(clean)) return { met: itemHasName(names, "Wild Shape"), understood: true };
  match = clean.match(/^(\d+) or more natural attacks$/i);
  if (match) return { met: naturalAttackCount(actor) >= Number(match[1]), understood: true };

  // Proficiency clauses often require a choice. The validator accepts any owned
  // matching proficiency and leaves exact selected-weapon matching to the feat's
  // optional structured requirement.
  if (/^(?:proficient|proficiency) with /i.test(clean) || /^(?:armor|shield|tower shield|exotic weapon|weapon) proficiency/i.test(clean)) {
    const expected = clean.replace(/^proficient with /i, "Weapon Proficiency (").replace(/^proficiency with /i, "Weapon Proficiency (");
    const specific = expected.endsWith(")") ? expected : `${expected})`;
    return {
      met: itemHasName(names, clean) || itemHasName(names, specific) || [...names].some((name) => name.includes("proficiency")),
      understood: true,
    };
  }

  // Remaining compact catalogue clauses are feat names.
  if (/^[a-z][a-z0-9 '\-()]+$/i.test(clean)) return { met: itemHasName(names, clean), understood: true };
  return { met: false, understood: false };
}

export function evaluateWarcraftFeatRequirements(feat, actor) {
  if (!feat || feat.type !== "feat" || !actor) return { valid: true, unmet: [], manual: [] };
  const names = itemNames(actor);
  const unmet = [];
  const manual = [];
  const structured = structuredRequirements(feat);

  for (const requirement of structured) {
    const met = evaluateStructured(requirement, actor, names);
    const label = requirement?.label || `${requirement?.key ?? requirement?.type} ${requirement?.value ?? ""}`.trim();
    if (met === false) unmet.push(label);
    if (met === null) manual.push(label);
  }

  if (!structured.length) {
    const text = normalizeWarcraftPrerequisiteText(getPath(feat, "flags.warcraftrpg2e.feat.prerequisite", ""));
    for (const clause of text.split(/\s*,\s*/).filter(Boolean)) {
      const label = clause.replace(/[.;]+$/, "").trim();
      const result = evaluateClause(clause, actor, names);
      if (!result.understood) manual.push(label);
      else if (!result.met) unmet.push(label);
    }
  }
  return { valid: unmet.length === 0 && manual.length === 0, unmet, manual };
}

export function validateWarcraftFeatAcquisition(feat, actor) {
  const requirements = evaluateWarcraftFeatRequirements(feat, actor);
  const flags = getPath(feat, "flags.warcraftrpg2e.feat", {});
  const repeatable = flags?.repeatable === true;
  const identity = itemIdentity(feat);
  const owned = actorItems(actor).filter((item) => item?.type === "feat");
  const duplicate = owned.some((item) => itemIdentity(item) === identity || norm(item?.name) === norm(feat?.name));
  const conflicts = Array.isArray(flags?.conflicts) ? flags.conflicts : [];
  const conflict = conflicts.find((entry) => itemHasName(itemNames(actor), typeof entry === "string" ? entry : entry?.name));
  const selectionKey = norm(flags?.selectionKey || getPath(feat, "flags.warcraftrpg2e.selectionKey", ""));
  const sameSelection = repeatable && selectionKey && owned.some((item) => {
    const ownedKey = norm(getPath(item, "flags.warcraftrpg2e.feat.selectionKey", getPath(item, "flags.warcraftrpg2e.selectionKey", "")));
    return norm(item?.name) === norm(feat?.name) && ownedKey === selectionKey;
  });

  const errors = [...requirements.unmet.map((label) => `Requires ${label}`)];
  if (!repeatable && duplicate) errors.push(`${feat.name} is not repeatable`);
  if (sameSelection) errors.push(`${feat.name} already has that selection`);
  if (conflict) errors.push(`${feat.name} conflicts with ${typeof conflict === "string" ? conflict : conflict.name}`);
  return { valid: errors.length === 0 && requirements.manual.length === 0, errors, manual: requirements.manual };
}
