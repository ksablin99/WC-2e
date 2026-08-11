export const MIGRATION_STATE_SCHEMA_VERSION = 1;
export const FIRST_VERSION_WITH_MIGRATION_STATE = "3.0.2";
export const EMPTY_MIGRATION_VERSION = "0.0.0";

export const normalizeMigrationVersion = function (version) {
  if (version === null || version === undefined) return null;
  if (typeof version === "number") return `${version}.0`;
  if (typeof version !== "string") return null;

  const clean = version.trim();
  if (!clean) return null;
  if (/^([0-9]+)\.([0-9]+)$/.test(clean)) return `${clean}.0`;
  if (/^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$/.test(clean)) return clean;
  return null;
};

const parseVersion = function (version) {
  const normalized = normalizeMigrationVersion(version);
  if (!normalized) return null;
  const match = normalized.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
};

export const compareMigrationVersions = function (a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] > right[key]) return 1;
    if (left[key] < right[key]) return -1;
  }
  return 0;
};

export const isMigrationVersionNewer = function (a, b) {
  return compareMigrationVersions(a, b) === 1;
};

export const isMigrationVersionAtLeast = function (a, b) {
  const comparison = compareMigrationVersions(a, b);
  return comparison === 0 || comparison === 1;
};

export const createMigrationState = function ({
  legacyVersion = EMPTY_MIGRATION_VERSION,
  worldSystemVersion = null,
  currentSystemVersion = EMPTY_MIGRATION_VERSION,
} = {}) {
  const legacy = normalizeMigrationVersion(legacyVersion);
  const worldVersion = normalizeMigrationVersion(worldSystemVersion);
  const current = normalizeMigrationVersion(currentSystemVersion) ?? EMPTY_MIGRATION_VERSION;

  let baselineVersion = EMPTY_MIGRATION_VERSION;
  if (legacy && legacy !== EMPTY_MIGRATION_VERSION) baselineVersion = legacy;
  else if (worldVersion && isMigrationVersionAtLeast(worldVersion, FIRST_VERSION_WITH_MIGRATION_STATE)) {
    baselineVersion = worldVersion;
  } else if (worldVersion) baselineVersion = worldVersion;

  const lastSuccessVersion = isMigrationVersionAtLeast(baselineVersion, FIRST_VERSION_WITH_MIGRATION_STATE)
    ? baselineVersion
    : baselineVersion === EMPTY_MIGRATION_VERSION
      ? null
      : baselineVersion;

  return {
    schemaVersion: MIGRATION_STATE_SCHEMA_VERSION,
    baselineVersion,
    currentSystemVersion: current,
    lastSuccessVersion,
    lastAttempt: null,
    completed: {},
    skipped: {},
  };
};

export const normalizeMigrationState = function (state, fallback = {}) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return createMigrationState(fallback);

  const baselineVersion = normalizeMigrationVersion(state.baselineVersion)
    ?? normalizeMigrationVersion(state.lastSuccessVersion)
    ?? EMPTY_MIGRATION_VERSION;
  const currentSystemVersion = normalizeMigrationVersion(state.currentSystemVersion)
    ?? normalizeMigrationVersion(fallback.currentSystemVersion)
    ?? EMPTY_MIGRATION_VERSION;
  const lastSuccessVersion = normalizeMigrationVersion(state.lastSuccessVersion) ?? baselineVersion;

  return {
    schemaVersion: MIGRATION_STATE_SCHEMA_VERSION,
    baselineVersion,
    currentSystemVersion,
    lastSuccessVersion,
    lastAttempt: state.lastAttempt && typeof state.lastAttempt === "object" ? state.lastAttempt : null,
    completed: state.completed && typeof state.completed === "object" && !Array.isArray(state.completed)
      ? { ...state.completed }
      : {},
    skipped: state.skipped && typeof state.skipped === "object" && !Array.isArray(state.skipped)
      ? { ...state.skipped }
      : {},
  };
};

export const normalizeMigrationAffected = function (result = {}) {
  const affected = result?.affected ?? result ?? {};
  const sourceByType = affected.byType ?? affected;
  const byType = {};

  for (const [type, value] of Object.entries(sourceByType ?? {})) {
    if (type === "total") continue;
    const count = Number(value);
    if (Number.isFinite(count) && count > 0) byType[type] = count;
  }

  const total = Number.isFinite(Number(affected.total))
    ? Number(affected.total)
    : Object.values(byType).reduce((sum, count) => sum + count, 0);

  return { total, byType };
};

export const getMigrationBaselineVersion = function (state) {
  return normalizeMigrationVersion(state?.lastSuccessVersion)
    ?? normalizeMigrationVersion(state?.baselineVersion)
    ?? EMPTY_MIGRATION_VERSION;
};

export const getPendingMigrations = function (migrations, state) {
  const baselineVersion = getMigrationBaselineVersion(state);
  const currentSystemVersion = normalizeMigrationVersion(state?.currentSystemVersion) ?? baselineVersion;
  const completed = state?.completed ?? {};
  const skipped = state?.skipped ?? {};

  return migrations
    .filter((migration) => !completed[migration.id])
    .filter((migration) => !skipped[migration.id])
    .filter((migration) => !isMigrationVersionNewer(migration.version, currentSystemVersion))
    .filter((migration) => isMigrationVersionNewer(migration.version, baselineVersion))
    .sort((a, b) => compareMigrationVersions(a.version, b.version) || a.id.localeCompare(b.id));
};

export const markMigrationCompleted = function (state, migration, completedAt = new Date().toISOString(), result = {}) {
  const next = normalizeMigrationState(state);
  const affected = normalizeMigrationAffected(result);
  next.completed[migration.id] = {
    version: migration.version,
    completedAt,
    affected,
  };
  next.lastAttempt = {
    id: migration.id,
    version: migration.version,
    status: "success",
    completedAt,
    affected,
  };
  next.lastSuccessVersion = migration.version;
  return next;
};

export const markMigrationSkipped = function (state, migration, skippedAt = new Date().toISOString(), reason = "") {
  const next = normalizeMigrationState(state);
  next.skipped[migration.id] = {
    version: migration.version,
    skippedAt,
    reason,
  };
  next.lastAttempt = {
    id: migration.id,
    version: migration.version,
    status: "skipped",
    skippedAt,
    reason,
  };
  return next;
};

export const markMigrationFailed = function (state, migration, error, failedAt = new Date().toISOString()) {
  const next = normalizeMigrationState(state);
  next.lastAttempt = {
    id: migration.id,
    version: migration.version,
    status: "failed",
    failedAt,
    error: error?.message ?? String(error),
  };
  return next;
};
