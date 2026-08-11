/**
 * e2e:setup — prepares the temp-dir Foundry data directory.
 *
 * Run via:  npm run e2e:setup
 *
 * Environment variables:
 *   FOUNDRY_VERSION   Major Foundry version to use: 13 or 14
 *                     (overrides .foundry-version file)
 *   E2E_DATA_DIR      Override the data directory
 *                     (default: os.tmpdir()/foundry-e2e-<hash> — unique per worktree)
 *   E2E_PORT          Port for Foundry
 *                     (default: 30001–30999, derived from REPO_ROOT hash — unique per worktree)
 *   E2E_FOUNDRY_PATH  Path to Foundry main.js (skips version-based discovery)
 *   E2E_SYSTEM_DIR    Override the system source directory for step 4
 *                     (default: REPO_ROOT — set by e2e:release-setup to an extracted zip dir)
 *   E2E_LICENSE_PATH  Path to a Foundry license.json file
 *   E2E_LICENSE_JSON  Raw license JSON string (CI: injected as a secret)
 *
 * Auto-clean:
 *   If a prior e2e setup used a different Foundry version, the data directory
 *   and .e2e-env are automatically removed before re-setup to avoid migration
 *   dialogs and LevelDB upgrade issues.
 */

'use strict';

const { mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync } = require('fs');
const { resolve, join } = require('path');
const { tmpdir, platform } = require('os');
const crypto = require('crypto');

const REPO_ROOT = resolve(__dirname, '../..');
const { resolveFoundry, resolveWorldTemplate, readEnvFileKey } = require('../../scripts/foundry-version');

// Derive a short hash from the repo root path so each worktree gets its own
// isolated data dir and port without needing env vars.
const hash = crypto.createHash('sha1').update(REPO_ROOT).digest('hex').slice(0, 8);

const DATA_DIR = process.env.E2E_DATA_DIR ?? join(tmpdir(), `foundry-e2e-${hash}`);
const PORT     = process.env.E2E_PORT     ?? String(30001 + (parseInt(hash, 16) % 999));

// ── Resolve Foundry version and path ─────────────────────────────────────────
//
// E2E_FOUNDRY_PATH takes precedence (explicit override, no version detection).
// Otherwise use the version-aware resolver (FOUNDRY_VERSION env → .foundry-version file).

let FOUNDRY_PATH, resolvedVersion;
if (process.env.E2E_FOUNDRY_PATH) {
  FOUNDRY_PATH = process.env.E2E_FOUNDRY_PATH;
  resolvedVersion = null;
} else {
  ({ version: resolvedVersion, mainJsPath: FOUNDRY_PATH } = resolveFoundry(REPO_ROOT));
}

// ── Auto-clean on version change ──────────────────────────────────────────────
//
// If a previous run used a different Foundry version the data directory must be
// wiped before setup to avoid Foundry showing an upgrade/migration dialog.
// Packs are also regenerated from source/ because Foundry migrates LevelDB data
// in-place when it first starts with a new version.

const envFile        = resolve(REPO_ROOT, '.e2e-env');
const storedVersion  = readEnvFileKey(envFile, 'E2E_FOUNDRY_VERSION');

if (resolvedVersion && storedVersion && storedVersion !== resolvedVersion) {
  console.log(`[e2e:setup] Foundry version changed (${storedVersion} → ${resolvedVersion}) — auto-cleaning...`);
  if (existsSync(DATA_DIR)) {
    rmSync(DATA_DIR, { recursive: true, force: true });
    console.log(`[e2e:setup] Removed stale data dir: ${DATA_DIR}`);
  }
  if (existsSync(envFile)) {
    unlinkSync(envFile);
    console.log('[e2e:setup] Removed stale .e2e-env');
  }
  console.log('[e2e:setup] Repacking from source/ (Foundry migrates packs on version change)...');
  const { spawnSync } = require('child_process');
  const repack = spawnSync(process.execPath, [resolve(REPO_ROOT, 'utils/repack.js')], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (repack.status !== 0) {
    console.error('[e2e:setup] WARNING: sources:repack exited with code', repack.status);
  }
}

console.log(`[e2e:setup] Data directory: ${DATA_DIR}`);
console.log(`[e2e:setup] Port: ${PORT}`);
console.log(`[e2e:setup] Foundry path: ${FOUNDRY_PATH}`);

// ── 1. Create directory structure ─────────────────────────────────────────────

for (const sub of [
  'Config',
  'Data/systems',
  'Data/worlds/test-world/data',
  'Logs',
]) {
  mkdirSync(join(DATA_DIR, sub), { recursive: true });
}

// ── 2. Write options.json from template ───────────────────────────────────────

const template = readFileSync(
  resolve(__dirname, '../foundry-e2e-data/Config/options.json.template'),
  'utf8'
);
const options = template
  .replace('{{DATA_PATH}}', DATA_DIR.replace(/\\/g, '\\\\'))
  .replace('{{PORT}}', PORT);
writeFileSync(join(DATA_DIR, 'Config/options.json'), options);

// ── 3. Inject license ─────────────────────────────────────────────────────────

const licenseTarget = join(DATA_DIR, 'Config/license.json');

if (process.env.E2E_LICENSE_JSON) {
  writeFileSync(licenseTarget, process.env.E2E_LICENSE_JSON);
  console.log('[e2e:setup] License written from E2E_LICENSE_JSON env var.');
} else {
  const repoLicense = join(REPO_ROOT, 'license.json');
  const defaultLicense = process.env.E2E_LICENSE_PATH
    ?? (existsSync(repoLicense)
        ? repoLicense
        : platform() === 'win32'
          // Try LOCALAPPDATA first (Foundry default on Windows), then APPDATA
          ? [
              join(process.env.LOCALAPPDATA ?? '', 'FoundryVTT/Config/license.json'),
              join(process.env.APPDATA ?? '', 'FoundryVTT/Config/license.json'),
            ].find(existsSync) ?? join(process.env.LOCALAPPDATA ?? '', 'FoundryVTT/Config/license.json')
          : join(process.env.HOME ?? '/root', '.local/share/FoundryVTT/Config/license.json'));

  if (existsSync(defaultLicense)) {
    cpSync(defaultLicense, licenseTarget);
    console.log(`[e2e:setup] License copied from ${defaultLicense}`);
  } else {
    console.warn('[e2e:setup] WARNING: No license.json found. Foundry may not start.');
    console.warn('[e2e:setup] Copy your Foundry license.json to the repo root, or set E2E_LICENSE_PATH.');
  }
}

// ── 4. Copy D35E system files ─────────────────────────────────────────────────
//
// E2E_SYSTEM_DIR overrides REPO_ROOT as the copy source — used by e2e:release-setup
// to install from an extracted release zip rather than the live working tree.

const SYSTEM_SRC = process.env.E2E_SYSTEM_DIR ?? REPO_ROOT;

const systemDst = join(DATA_DIR, 'Data/systems/warcraftrpg2e');
mkdirSync(systemDst, { recursive: true });
cpSync(SYSTEM_SRC, systemDst, {
  recursive: true,
  filter: (src) => {
    // Skip LOCK files — LevelDB creates these at runtime; copying them while
    // Foundry is running causes EBUSY errors and they aren't needed in the dest.
    if (src.endsWith('LOCK')) return false;
    if (SYSTEM_SRC !== REPO_ROOT) return true; // extracted release zip — no further filtering
    const rel = src.replace(REPO_ROOT, '');
    // Skip `icons/` — worktrees often junction it to the main repo; copying it can
    // trigger ERR_FS_CP_EINVAL (destination under junction source). E2e API tests
    // do not need bundled art assets.
    return !/(node_modules|\.git|[/\\]test[/\\]|\.foundrycache|[/\\]icons(?:[/\\]|$)|[/\\]scratch(?:[/\\]|$))/.test(rel);
  },
});
console.log(`[e2e:setup] Warcraft RPG 2e system files copied from ${SYSTEM_SRC} to ${systemDst}`);

// ── 5. Copy world.json (versioned) ───────────────────────────────────────────

const e2eDataDir   = resolve(__dirname, '../foundry-e2e-data');
const worldSrcPath = resolveWorldTemplate(e2eDataDir, resolvedVersion);
cpSync(worldSrcPath, join(DATA_DIR, 'Data/worlds/test-world/world.json'));
console.log(`[e2e:setup] world.json copied (${worldSrcPath}).`);

// ── 6. Remove stale Foundry lock file if present ──────────────────────────────

const lockPath = join(DATA_DIR, 'Config/options.json.lock');
if (existsSync(lockPath)) {
  const { rmSync } = require('fs');
  rmSync(lockPath, { recursive: true, force: true });
  console.log('[e2e:setup] Removed stale lock file.');
}

// ── 7. Write .e2e-env so playwright.config.js can read the paths ───────────────

const versionLine = resolvedVersion ? `E2E_FOUNDRY_VERSION=${resolvedVersion}\n` : '';
writeFileSync(
  envFile,
  `E2E_DATA_DIR=${DATA_DIR}\nE2E_PORT=${PORT}\nE2E_FOUNDRY_PATH=${FOUNDRY_PATH}\n${versionLine}`
);

console.log('[e2e:setup] Done.');
