const normalizeName = (value) => String(value ?? "")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const racialBaseName = (className) => normalizeName(className)
  .replace(/ racial levels?$/, "")
  .replace(/ levels?$/, "");

export function racialClassRequirement(classItem) {
  return classItem?.flags?.warcraftrpg2e?.racialClass?.race
    ?? classItem?.system?.racialRequirement
    ?? racialBaseName(classItem?.name);
}

export function actorRaceName(actor) {
  return actor?.race?.name
    ?? actor?.items?.find?.((item) => item.type === "race")?.name
    ?? actor?.system?.details?.race
    ?? "";
}

export function isEligibleRacialClass(actor, classItem, { plannedLevels = 0 } = {}) {
  if (classItem?.type !== "class" || classItem?.system?.classType !== "racial") return true;
  const required = normalizeName(racialClassRequirement(classItem));
  const actual = normalizeName(actorRaceName(actor));
  const maximum = Math.max(0, Number(classItem.system.maxLevel ?? 3) || 3);
  const current = Math.max(0, Number(classItem.system.levels ?? 0) || 0);
  return Boolean(required && actual && required === actual && Math.max(current, plannedLevels) < maximum);
}

export function filterEligibleProgressionClasses(actor, classes, plannedRows = []) {
  const planned = new Map();
  for (const row of plannedRows ?? []) {
    if (!row?.classId) continue;
    planned.set(row.classId, (planned.get(row.classId) ?? 0) + 1);
  }
  return (classes ?? []).filter((item) => isEligibleRacialClass(actor, item, {
    plannedLevels: planned.get(item.id) ?? 0,
  }));
}

export function validateRacialProgressionRows(actor, classes, rows) {
  const byId = new Map((classes ?? []).map((item) => [item.id, item]));
  const counts = new Map();
  const errors = [];
  for (const row of rows ?? []) {
    const item = byId.get(row?.classId);
    if (!item || item.system?.classType !== "racial") continue;
    const count = (counts.get(item.id) ?? 0) + 1;
    counts.set(item.id, count);
    const required = racialClassRequirement(item);
    if (normalizeName(required) !== normalizeName(actorRaceName(actor))) {
      errors.push({ code: "race-mismatch", classId: item.id, required, actual: actorRaceName(actor) });
    }
    if (count > Math.max(0, Number(item.system.maxLevel ?? 3) || 3)) {
      errors.push({ code: "maximum-level", classId: item.id, maximum: Number(item.system.maxLevel ?? 3) || 3 });
    }
  }
  return { valid: errors.length === 0, errors, levelsByClass: counts };
}

/** Forsaken racial level 3 improves Hit Dice gained afterward. */
export function effectiveWarcraftHitDie(baseDie, { forsakenRacialLevels = 0 } = {}) {
  const die = Math.max(0, Math.trunc(Number(baseDie) || 0));
  if (Number(forsakenRacialLevels) < 3) return { die, flat: 0 };
  const nextDie = new Map([[4, 6], [6, 8], [8, 10], [10, 12]]).get(die);
  return nextDie ? { die: nextDie, flat: 0 } : die === 12 ? { die: 12, flat: 2 } : { die, flat: 0 };
}
