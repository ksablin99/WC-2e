/**
 * Normalize optional Warcraft parent/path class configuration.
 *
 * Legacy classes have paths disabled and therefore retain their existing
 * progression behavior. Path choices may be stored as `{ id, name }` objects
 * or as strings for simple world-created classes.
 */
export function normalizeClassPaths(classSystem = {}) {
  const raw = classSystem?.classPaths || {};
  const choices = [];
  const seen = new Set();

  for (const choice of Array.isArray(raw.choices) ? raw.choices : []) {
    const id = String(typeof choice === "string" ? choice : choice?.id || "").trim();
    if (!id || seen.has(id)) continue;

    const name = String(typeof choice === "string" ? choice : choice?.name || id).trim() || id;
    choices.push({ id, name });
    seen.add(id);
  }

  const enabled = raw.enabled === true && choices.length > 0;
  const requestedDefault = String(raw.default || "").trim();
  const defaultPath = enabled && seen.has(requestedDefault) ? requestedDefault : enabled ? choices[0].id : "";

  return {
    enabled,
    default: defaultPath,
    choices,
  };
}

/** Resolve a row's path, defaulting missing or stale values safely. */
export function resolveClassPath(classSystem = {}, requestedPath = "") {
  const config = normalizeClassPaths(classSystem);
  if (!config.enabled) return "";

  const requested = String(requestedPath || "").trim();
  return config.choices.some((choice) => choice.id === requested) ? requested : config.default;
}

function emptyPathLevels(config) {
  return Object.fromEntries(config.choices.map((choice) => [choice.id, 0]));
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

/** Serialize class selector data safely for the level-up template's inline script. */
export function serializeClassSelectorData(classes = []) {
  return JSON.stringify(Array.isArray(classes) ? classes : [])
    .replaceAll("<", "\\u003c")
    .replaceAll("'", "\\u0027")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/**
 * Build prepared path data for a directly-levelled class item.
 *
 * A valid stored distribution is preserved. Missing or inconsistent path data
 * falls back to assigning every class level to the configured default path.
 */
export function deriveDirectClassPathState(classSystem = {}) {
  const config = normalizeClassPaths(classSystem);
  if (!config.enabled) return { classPaths: config, pathLevels: {}, currentPath: "" };

  const levels = nonNegativeInteger(classSystem.levels);
  const pathLevels = emptyPathLevels(config);
  for (const choice of config.choices) {
    pathLevels[choice.id] = nonNegativeInteger(classSystem.pathLevels?.[choice.id]);
  }

  const storedTotal = Object.values(pathLevels).reduce((total, pathLevel) => total + pathLevel, 0);
  if (storedTotal !== levels) {
    for (const id of Object.keys(pathLevels)) pathLevels[id] = 0;
    pathLevels[config.default] = levels;
  }

  const storedCurrent = resolveClassPath(classSystem, classSystem.currentPath);
  const populatedPath = config.choices.find((choice) => pathLevels[choice.id] > 0)?.id;
  const currentPath = levels > 0 && pathLevels[storedCurrent] > 0 ? storedCurrent : populatedPath || config.default;
  return { classPaths: config, pathLevels, currentPath };
}

/**
 * Count class and path levels represented by LevelUpData rows.
 *
 * Total levels remain attached to the single parent class. Path levels are a
 * second count over those same rows, never additional character levels.
 */
export function summarizeClassLevelRows(levelUpData = [], classes = []) {
  const summaries = new Map();
  const classesById = new Map();

  for (const classItem of classes) {
    const id = classItem?.id;
    if (!id) continue;

    const classSystem = classItem.system || {};
    const classPaths = normalizeClassPaths(classSystem);
    classesById.set(id, classItem);
    summaries.set(id, {
      levels: 0,
      hp: 0,
      classPaths,
      pathLevels: classPaths.enabled ? emptyPathLevels(classPaths) : {},
      currentPath: classPaths.enabled ? classPaths.default : "",
    });
  }

  for (const row of Array.isArray(levelUpData) ? levelUpData : []) {
    const classItem = classesById.get(row?.classId);
    if (!classItem) continue;

    const summary = summaries.get(classItem.id);
    summary.levels += 1;
    summary.hp += nonNegativeInteger(row.hp);

    if (summary.classPaths.enabled) {
      const path = resolveClassPath(classItem.system, row.path);
      summary.pathLevels[path] += 1;
      summary.currentPath = path;
    }
  }

  return summaries;
}
