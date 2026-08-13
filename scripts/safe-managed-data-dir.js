'use strict';

const {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require('fs');
const { homedir } = require('os');
const { basename, dirname, join, parse, resolve } = require('path');

const MARKER_FILE = '.warcraftrpg2e-managed-data.json';
const MARKER_OWNER = 'warcraftrpg2e';
const MARKER_SCHEMA = 1;
const VALID_KINDS = new Set(['dev', 'e2e', 'release-extract']);

function canonicalPath(candidate) {
  const resolved = resolve(String(candidate));
  if (existsSync(resolved)) return realpathSync.native?.(resolved) ?? realpathSync(resolved);

  // realpathSync cannot resolve a path that does not exist yet. Resolve its
  // nearest existing ancestor instead so a junction/symlinked parent cannot
  // make a protected location appear to be an unrelated safe path.
  const missingSegments = [];
  let ancestor = resolved;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) return resolved;
    missingSegments.unshift(basename(ancestor));
    ancestor = parent;
  }
  const canonicalAncestor = realpathSync.native?.(ancestor) ?? realpathSync(ancestor);
  return resolve(canonicalAncestor, ...missingSegments);
}

function comparisonPath(candidate) {
  const canonical = canonicalPath(candidate).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function isWithinOrEqual(candidate, root) {
  const child = comparisonPath(candidate);
  const parent = comparisonPath(root);
  return child === parent || child.startsWith(`${parent}${require('path').sep}`);
}

function pathsOverlap(left, right) {
  return isWithinOrEqual(left, right) || isWithinOrEqual(right, left);
}

function assertKind(kind) {
  if (!VALID_KINDS.has(kind)) {
    throw new Error(`Unknown managed Foundry data kind: ${kind}`);
  }
}

function markerPath(dataDir) {
  return join(canonicalPath(dataDir), MARKER_FILE);
}

function validateManagedDataMarker(marker, { repoRoot, kind }) {
  assertKind(kind);
  const expectedRepo = comparisonPath(repoRoot);
  const actualRepo = marker?.repoRoot ? comparisonPath(marker.repoRoot) : '';
  if (
    marker?.schema !== MARKER_SCHEMA
    || marker?.owner !== MARKER_OWNER
    || marker?.purpose !== 'isolated-foundry-data'
    || marker?.kind !== kind
    || actualRepo !== expectedRepo
  ) {
    throw new Error(`Invalid or foreign ${kind} data marker`);
  }
  return true;
}

function assertSafeManagedDataDir(dataDir, {
  repoRoot,
  kind,
  requireMarker = false,
  homeDir = homedir(),
  localAppData = process.env.LOCALAPPDATA,
  appData = process.env.APPDATA,
  extraProtectedRoots = [],
} = {}) {
  assertKind(kind);
  if (typeof dataDir !== 'string' || !dataDir.trim()) throw new Error('Managed Foundry data path is empty');
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) throw new Error('Repository root is required');

  const requestedTarget = resolve(String(dataDir));
  if (existsSync(requestedTarget) && lstatSync(requestedTarget).isSymbolicLink()) {
    throw new Error(`Refusing symlinked managed Foundry data path: ${requestedTarget}`);
  }
  const target = canonicalPath(requestedTarget);
  if (comparisonPath(target) === comparisonPath(parse(target).root)) {
    throw new Error(`Refusing filesystem root as managed Foundry data path: ${target}`);
  }

  // A target equal to, or above, the user home would erase far more than the
  // isolated fixture. Descendants of home remain valid because that is where
  // the Windows test installation is intentionally kept.
  if (isWithinOrEqual(homeDir, target)) {
    throw new Error(`Refusing user-home or ancestor as managed Foundry data path: ${target}`);
  }

  const workspaceRoots = [repoRoot, process.cwd(), ...extraProtectedRoots].filter(Boolean);
  if (workspaceRoots.some((root) => pathsOverlap(target, root))) {
    throw new Error(`Refusing repository/workspace overlap as managed Foundry data path: ${target}`);
  }

  const normalFoundryRoots = [
    localAppData && join(localAppData, 'FoundryVTT'),
    appData && join(appData, 'FoundryVTT'),
    join(homeDir, '.local', 'share', 'FoundryVTT'),
  ].filter(Boolean);
  if (normalFoundryRoots.some((root) => pathsOverlap(target, root))) {
    throw new Error(`Refusing normal Foundry data overlap: ${target}`);
  }

  if (requireMarker) {
    const file = markerPath(target);
    if (!existsSync(file)) {
      throw new Error(`Refusing to remove unmarked ${kind} data directory: ${target}`);
    }
    if (lstatSync(file).isSymbolicLink()) {
      throw new Error(`Refusing symlinked managed-data marker: ${file}`);
    }
    let marker;
    try {
      marker = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new Error(`Refusing to remove data with unreadable marker: ${file}`);
    }
    validateManagedDataMarker(marker, { repoRoot, kind });
  }

  return target;
}

/**
 * Adopt a data directory created by this repository before ownership markers
 * existed. Non-empty directories must prove their identity through the
 * generated options/world files (dev/e2e) or a packaged system manifest
 * (release extraction); an arbitrary safe-looking path is never claimed.
 */
function ensureManagedDataMarker(dataDir, { repoRoot, kind, expectedWorldId = null }) {
  const target = assertSafeManagedDataDir(dataDir, { repoRoot, kind });
  const file = markerPath(target);
  if (existsSync(file)) {
    validateManagedDataMarker(JSON.parse(readFileSync(file, 'utf8')), { repoRoot, kind });
    return file;
  }
  if (!existsSync(target)) {
    return writeManagedDataMarker(target, { repoRoot, kind });
  }

  const entries = readdirSync(target);
  if (entries.length === 0) return writeManagedDataMarker(target, { repoRoot, kind });

  if (expectedWorldId) {
    const optionsPath = join(target, 'Config', 'options.json');
    const worldPath = join(target, 'Data', 'worlds', expectedWorldId, 'world.json');
    let options;
    let world;
    try {
      options = JSON.parse(readFileSync(optionsPath, 'utf8'));
      world = JSON.parse(readFileSync(worldPath, 'utf8'));
    } catch {
      throw new Error(`Refusing to claim unrecognized ${kind} data directory: ${target}`);
    }
    if (
      comparisonPath(options.dataPath) !== comparisonPath(target)
      || options.world !== expectedWorldId
      || options.hostname !== 'localhost'
      || options.upnp !== false
      || world.id !== expectedWorldId
      || world.title !== (expectedWorldId === 'dev-world' ? 'Dev World' : 'E2E Test World')
      || world.system !== 'warcraftrpg2e'
      || world.description !== 'Minimal world for automated e2e testing.'
    ) {
      throw new Error(`Refusing to claim foreign ${kind} data directory: ${target}`);
    }
    return writeManagedDataMarker(target, { repoRoot, kind });
  }

  if (kind === 'release-extract') {
    try {
      const manifest = JSON.parse(readFileSync(join(target, 'warcraftrpg2e', 'system.json'), 'utf8'));
      if (manifest.id === 'warcraftrpg2e') return writeManagedDataMarker(target, { repoRoot, kind });
    } catch { /* rejected below */ }
  }
  throw new Error(`Refusing to claim unrecognized ${kind} data directory: ${target}`);
}

function writeManagedDataMarker(dataDir, { repoRoot, kind }) {
  const target = assertSafeManagedDataDir(dataDir, { repoRoot, kind });
  mkdirSync(target, { recursive: true });
  const file = join(target, MARKER_FILE);
  if (existsSync(file)) {
    if (lstatSync(file).isSymbolicLink()) throw new Error(`Refusing symlinked managed-data marker: ${file}`);
    validateManagedDataMarker(JSON.parse(readFileSync(file, 'utf8')), { repoRoot, kind });
  }
  writeFileSync(file, `${JSON.stringify({
    schema: MARKER_SCHEMA,
    owner: MARKER_OWNER,
    purpose: 'isolated-foundry-data',
    kind,
    repoRoot: canonicalPath(repoRoot),
  }, null, 2)}\n`);
  return file;
}

function removeManagedDataDir(dataDir, { repoRoot, kind }) {
  const target = assertSafeManagedDataDir(dataDir, { repoRoot, kind, requireMarker: true });
  rmSync(target, { recursive: true, force: true });
  return target;
}

module.exports = {
  MARKER_FILE,
  assertSafeManagedDataDir,
  ensureManagedDataMarker,
  removeManagedDataDir,
  validateManagedDataMarker,
  writeManagedDataMarker,
};
