/**
 * dev:setup — creates a Foundry data directory for interactive development.
 *
 * Uses a directory junction (Windows) or symlink (Linux/Mac) instead of
 * copying files: Foundry sees live source changes without any sync step.
 *
 * Run via:  npm run dev:setup
 *
 * Environment variables:
 *   FOUNDRY_VERSION   Major Foundry version to use: 13 or 14
 *                     (overrides .foundry-version file)
 *   DEV_DATA_DIR      Override the data directory
 *                     (default: os.tmpdir()/foundry-dev)
 *   DEV_PORT          Port for Foundry (default: 30000)
 *   DEV_FOUNDRY_PATH  Path to Foundry main.js (skips version-based discovery)
 *   E2E_LICENSE_PATH  Path to a Foundry license.json file (shared with e2e)
 *   E2E_LICENSE_JSON  Raw license JSON string (shared with e2e)
 *
 * Auto-clean:
 *   If a prior dev setup used a different Foundry version, the data directory
 *   is automatically removed before re-setup to avoid migration dialogs.
 *
 * After running dev:setup, start Foundry with:
 *   npm run dev:start
 */

'use strict';

const { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } = require('fs');
const { resolve, join } = require('path');
const { tmpdir, platform } = require('os');

const REPO_ROOT = resolve(__dirname, '..');
const { resolveFoundry, resolveWorldTemplate, readEnvFileKey } = require('./foundry-version');
const {
  assertSafeManagedDataDir,
  ensureManagedDataMarker,
  removeManagedDataDir,
  writeManagedDataMarker,
} = require('./safe-managed-data-dir');

// Read existing .dev-env so that re-running dev:setup in a worktree (without
// env vars set) preserves the worktree-specific data dir and port that were
// written by the original wt:create → dev:setup call.
function readDevEnv() {
  const envFile = resolve(REPO_ROOT, '.dev-env');
  if (!existsSync(envFile)) return {};
  const result = {};
  try {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim();
      if (key) result[key] = val;
    }
  } catch { /* malformed — ignore */ }
  return result;
}

// Read .wt-meta (written by wt:create) as a stable fallback for the
// worktree-specific data dir and port.  This is the recovery source when
// .dev-env has been deleted or corrupted.
function readWtMeta() {
  const metaFile = resolve(REPO_ROOT, '.wt-meta');
  if (!existsSync(metaFile)) return {};
  try {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    return {
      DEV_DATA_DIR: meta.devDataDir ?? null,
      DEV_PORT:     meta.devPort    != null ? String(meta.devPort) : null,
    };
  } catch { return {}; }
}

const savedEnv = readDevEnv();
const wtMeta   = readWtMeta();

// Priority: explicit env var → .dev-env → .wt-meta → hardcoded default
const DATA_DIR = process.env.DEV_DATA_DIR ?? savedEnv.DEV_DATA_DIR ?? wtMeta.DEV_DATA_DIR ?? join(tmpdir(), 'foundry-dev');
const PORT     = process.env.DEV_PORT     ?? savedEnv.DEV_PORT     ?? wtMeta.DEV_PORT     ?? '30000';
assertSafeManagedDataDir(DATA_DIR, { repoRoot: REPO_ROOT, kind: 'dev' });
ensureManagedDataMarker(DATA_DIR, {
  repoRoot: REPO_ROOT,
  kind: 'dev',
  expectedWorldId: 'dev-world',
});

if (wtMeta.DEV_DATA_DIR && !savedEnv.DEV_DATA_DIR && !process.env.DEV_DATA_DIR) {
  console.log('[dev:setup] .dev-env missing or corrupt — recovered settings from .wt-meta.');
}

// ── Resolve Foundry version and path ─────────────────────────────────────────
//
// DEV_FOUNDRY_PATH takes precedence (explicit override, no version detection).
// Otherwise use the version-aware resolver (FOUNDRY_VERSION env → .foundry-version file).
// Also check the saved .dev-env path as a last-resort fallback (worktree recovery).

let FOUNDRY_PATH, resolvedVersion;
if (process.env.DEV_FOUNDRY_PATH) {
  FOUNDRY_PATH = process.env.DEV_FOUNDRY_PATH;
  resolvedVersion = null;
} else {
  ({ version: resolvedVersion, mainJsPath: FOUNDRY_PATH } = resolveFoundry(REPO_ROOT));
  // Fall back to the path saved in .dev-env if the resolved path doesn't exist
  if (!existsSync(FOUNDRY_PATH) && savedEnv.DEV_FOUNDRY_PATH && existsSync(savedEnv.DEV_FOUNDRY_PATH)) {
    FOUNDRY_PATH = savedEnv.DEV_FOUNDRY_PATH;
  }
}

// ── Auto-clean on version change ──────────────────────────────────────────────
//
// If a previous run used a different Foundry version the data directory must be
// wiped before setup to avoid Foundry showing an upgrade/migration dialog.
// Packs are also regenerated from source/ because Foundry migrates LevelDB data
// in-place when it first starts with a new version.

const devEnvFile    = resolve(REPO_ROOT, '.dev-env');
const storedVersion = savedEnv.DEV_FOUNDRY_VERSION ?? null;

if (resolvedVersion && storedVersion && storedVersion !== resolvedVersion) {
  console.log(`[dev:setup] Foundry version changed (${storedVersion} → ${resolvedVersion}) — auto-cleaning...`);
  if (existsSync(DATA_DIR)) {
    removeManagedDataDir(DATA_DIR, { repoRoot: REPO_ROOT, kind: 'dev' });
    console.log(`[dev:setup] Removed stale data dir: ${DATA_DIR}`);
  }
  console.log('[dev:setup] Repacking from source/ (Foundry migrates packs on version change)...');
  const { spawnSync } = require('child_process');
  const repack = spawnSync(process.execPath, [resolve(REPO_ROOT, 'utils/repack.js')], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (repack.status !== 0) {
    console.error('[dev:setup] WARNING: sources:repack exited with code', repack.status);
  }
}

console.log(`[dev:setup] Data directory: ${DATA_DIR}`);
console.log(`[dev:setup] Port: ${PORT}`);
console.log(`[dev:setup] Foundry path: ${FOUNDRY_PATH}`);

// ── 1. Create directory structure ─────────────────────────────────────────────

for (const sub of [
  'Config',
  'Data/systems',
  'Data/worlds/dev-world/data',
  'Logs',
]) {
  mkdirSync(join(DATA_DIR, sub), { recursive: true });
}
writeManagedDataMarker(DATA_DIR, { repoRoot: REPO_ROOT, kind: 'dev' });

// ── 2. Create junction / symlink: Data/systems/warcraftrpg2e → REPO_ROOT ──────────────
//
// A junction (Windows) requires no admin rights and is transparent to Foundry.
// On Linux/Mac a regular symlink works identically.

const junctionTarget = join(DATA_DIR, 'Data/systems/warcraftrpg2e');
if (existsSync(junctionTarget)) {
  rmSync(junctionTarget, { recursive: true, force: true });
}

const junctionType = platform() === 'win32' ? 'junction' : 'dir';
symlinkSync(REPO_ROOT, junctionTarget, junctionType);
console.log(`[dev:setup] Linked ${junctionTarget} → ${REPO_ROOT}`);

// ── 3. Write options.json ─────────────────────────────────────────────────────

const options = JSON.stringify({
  dataPath:      DATA_DIR,
  hostname:      'localhost',
  language:      'en.core',
  port:          Number(PORT),
  proxyPort:     null,
  proxySSL:      false,
  routePrefix:   null,
  updateChannel: 'stable',
  upnp:          false,
  fullscreen:    false,
  world:         'dev-world',
}, null, 2);
writeFileSync(join(DATA_DIR, 'Config/options.json'), options);

// ── 4. Inject license ─────────────────────────────────────────────────────────

const licenseTarget = join(DATA_DIR, 'Config/license.json');

if (process.env.E2E_LICENSE_JSON) {
  writeFileSync(licenseTarget, process.env.E2E_LICENSE_JSON);
  console.log('[dev:setup] License written from E2E_LICENSE_JSON env var.');
} else {
  const repoLicense = join(REPO_ROOT, 'license.json');
  const defaultLicense = process.env.E2E_LICENSE_PATH
    ?? (existsSync(repoLicense)
        ? repoLicense
        : platform() === 'win32'
          ? [
              join(process.env.LOCALAPPDATA ?? '', 'FoundryVTT/Config/license.json'),
              join(process.env.APPDATA ?? '', 'FoundryVTT/Config/license.json'),
            ].find(existsSync) ?? join(process.env.LOCALAPPDATA ?? '', 'FoundryVTT/Config/license.json')
          : join(process.env.HOME ?? '/root', '.local/share/FoundryVTT/Config/license.json'));

  if (existsSync(defaultLicense)) {
    const { cpSync } = require('fs');
    cpSync(defaultLicense, licenseTarget);
    console.log(`[dev:setup] License copied from ${defaultLicense}`);
  } else {
    console.warn('[dev:setup] WARNING: No license.json found. Foundry may not start.');
    console.warn('[dev:setup] Copy your Foundry license.json to the repo root, or set E2E_LICENSE_PATH.');
  }
}

// ── 5. Copy world.json (versioned) ────────────────────────────────────────────

const { cpSync } = require('fs');
const e2eDataDir   = resolve(__dirname, '../test/foundry-e2e-data');
const worldSrcPath = resolveWorldTemplate(e2eDataDir, resolvedVersion);
cpSync(worldSrcPath, join(DATA_DIR, 'Data/worlds/dev-world/world.json'));
// Patch the world id/name to "dev-world" so it doesn't clash with test-world
const worldJson = JSON.parse(readFileSync(join(DATA_DIR, 'Data/worlds/dev-world/world.json'), 'utf8'));
worldJson.id = 'dev-world';
worldJson.title = 'Dev World';
writeFileSync(
  join(DATA_DIR, 'Data/worlds/dev-world/world.json'),
  JSON.stringify(worldJson, null, 2)
);
console.log('[dev:setup] world.json written.');

// ── 6. Remove stale lock file if present ──────────────────────────────────────

const lockPath = join(DATA_DIR, 'Config/options.json.lock');
if (existsSync(lockPath)) {
  rmSync(lockPath, { recursive: true, force: true });
  console.log('[dev:setup] Removed stale lock file.');
}

// ── 7. Write .dev-env ─────────────────────────────────────────────────────────

const startCmd = `node "${FOUNDRY_PATH}" --dataPath="${DATA_DIR}" --world=dev-world --port=${PORT} --noupdate`;
const versionLine = resolvedVersion ? `DEV_FOUNDRY_VERSION=${resolvedVersion}\n` : '';
writeFileSync(
  devEnvFile,
  `DEV_DATA_DIR=${DATA_DIR}\nDEV_PORT=${PORT}\nDEV_FOUNDRY_PATH=${FOUNDRY_PATH}\nDEV_START_CMD=${startCmd}\n${versionLine}`
);

console.log('[dev:setup] Done.');
console.log(`\nTo start Foundry:\n  ${startCmd}\n\nOr: npm run dev:start`);

// ── 8. Write .vscode/launch.json ──────────────────────────────────────────────
//
// Generated on every dev:setup so paths stay accurate after worktree moves or
// Foundry upgrades.  The file is gitignored (.vscode/ is in .gitignore).
// Existing configurations with different names are preserved.

(function writeLaunchJson() {
  // VS Code expects forward slashes even on Windows
  const fwd = p => p.replace(/\\/g, '/');

  const vscodeDir  = join(REPO_ROOT, '.vscode');
  const launchFile = join(vscodeDir, 'launch.json');

  mkdirSync(vscodeDir, { recursive: true });

  // Platform-specific node runtime (VS Code uses "node" on all platforms, but
  // on Windows we surface the full exe path so it also works in non-PATH shells)
  const runtimeExecutable =
    platform() === 'win32'
      ? fwd(join(process.execPath))   // e.g. C:/Program Files/nodejs/node.exe
      : 'node';

  const launchConfig = {
    type:              'node',
    request:           'launch',
    name:              'Launch Foundry VTT (dev)',
    runtimeExecutable,
    program:           fwd(FOUNDRY_PATH),
    args: [
      `--dataPath=${fwd(DATA_DIR)}`,
      '--world=dev-world',
      `--port=${PORT}`,
      '--noupdate',
    ],
    cwd:           '${workspaceFolder}',
    console:       'integratedTerminal',
    skipFiles:     ['<node_internals>/**'],
    outputCapture: 'std',
    env: {
      // Explicitly pass along NODE_ENV so sourcemaps work correctly
      NODE_ENV: 'development',
    },
  };

  const attachConfig = {
    type:       'node',
    request:    'attach',
    name:       'Attach to Foundry VTT (dev)',
    port:       9229,
    restart:    true,
    skipFiles:  ['<node_internals>/**'],
  };

  // Read and merge with any existing launch.json (preserve user configs)
  let existing = { version: '0.2.0', configurations: [] };
  if (existsSync(launchFile)) {
    try { existing = JSON.parse(readFileSync(launchFile, 'utf8')); } catch { /* malformed — overwrite */ }
  }
  if (!Array.isArray(existing.configurations)) existing.configurations = [];

  for (const cfg of [launchConfig, attachConfig]) {
    const idx = existing.configurations.findIndex(c => c.name === cfg.name);
    if (idx !== -1) {
      existing.configurations[idx] = cfg;
    } else {
      existing.configurations.push(cfg);
    }
  }

  writeFileSync(launchFile, JSON.stringify(existing, null, 2) + '\n');
  console.log(`[dev:setup] .vscode/launch.json written (platform: ${platform()}).`);
})();
