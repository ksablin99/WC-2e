'use strict';

/**
 * e2e:release-setup — builds the release zip, extracts it, then runs e2e:setup
 * against the extracted files so tests exercise the actual shipped artifact.
 *
 * Run via:  npm run e2e:release-setup
 *
 * What it does:
 *   1. Runs pack:system (utils/pack-system.js) to produce D35E-release-e2e.zip
 *   2. Extracts the zip to a temp dir
 *   3. Runs test/e2e/setup.js with E2E_SYSTEM_DIR pointing at the extracted D35E/
 *      and E2E_DATA_DIR set to a separate dir (foundry-e2e-release-<hash>) so it
 *      does not conflict with a regular e2e setup
 *   4. Appends E2E_RELEASE_EXTRACT_DIR and E2E_RELEASE_ZIP to .e2e-env so that
 *      e2e:clean can remove them
 *
 * Environment variables (forwarded to e2e:setup):
 *   FOUNDRY_VERSION   Major Foundry version to use: 13 or 14
 *   E2E_PORT          Override the Foundry port
 *   E2E_FOUNDRY_PATH  Path to Foundry main.js
 *   E2E_LICENSE_PATH  Path to a Foundry license.json file
 *   E2E_LICENSE_JSON  Raw license JSON string
 *
 * Prerequisites:
 *   - npm run sources:repack must have been run (packs/ must exist)
 *   - On Linux/Mac: unzip must be on PATH
 */

const { existsSync, mkdirSync, rmSync, appendFileSync } = require('fs');
const { resolve, join } = require('path');
const { tmpdir, platform } = require('os');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const REPO_ROOT = resolve(__dirname, '..');
const hash = crypto.createHash('sha1').update(REPO_ROOT).digest('hex').slice(0, 8);

// ── 1. Build release zip ───────────────────────────────────────────────────────

const zipName = 'D35E-release-e2e.zip';
const zipPath = join(REPO_ROOT, zipName);

console.log('[e2e:release-setup] Building release zip...');
const buildResult = spawnSync(process.execPath, [
  resolve(REPO_ROOT, 'utils/pack-system.js'),
  '--name', zipName,
], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
});
if (buildResult.status !== 0) {
  console.error('[e2e:release-setup] Build failed — check output above');
  process.exit(1);
}

// ── 2. Extract zip ─────────────────────────────────────────────────────────────

const extractDir = join(tmpdir(), `d35e-release-extract-${hash}`);

if (existsSync(extractDir)) {
  rmSync(extractDir, { recursive: true, force: true });
}
mkdirSync(extractDir, { recursive: true });

console.log(`[e2e:release-setup] Extracting ${zipPath} to ${extractDir}...`);

let extractResult;
if (platform() === 'win32') {
  extractResult = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    `Expand-Archive -Path '${zipPath}' -DestinationPath '${extractDir}' -Force`,
  ], { stdio: 'inherit' });
} else {
  extractResult = spawnSync('unzip', ['-q', zipPath, '-d', extractDir], { stdio: 'inherit' });
}

if (extractResult.status !== 0) {
  console.error('[e2e:release-setup] Extraction failed');
  process.exit(1);
}

const systemDir = join(extractDir, 'warcraftrpg2e');
if (!existsSync(systemDir)) {
  console.error(`[e2e:release-setup] Expected D35E/ inside extracted zip at ${systemDir}`);
  process.exit(1);
}
console.log(`[e2e:release-setup] Extracted system dir: ${systemDir}`);

// ── 3. Run e2e:setup with release overrides ────────────────────────────────────

// Separate data dir so this does not clobber a regular e2e setup.
const releaseDataDir = join(tmpdir(), `foundry-e2e-release-${hash}`);

console.log('[e2e:release-setup] Running e2e:setup...');
const setupResult = spawnSync(process.execPath, [
  resolve(REPO_ROOT, 'test/e2e/setup.js'),
], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    E2E_SYSTEM_DIR: systemDir,
    E2E_DATA_DIR:   releaseDataDir,
  },
});
if (setupResult.status !== 0) {
  console.error('[e2e:release-setup] e2e:setup failed');
  process.exit(1);
}

// ── 4. Append release artifact paths to .e2e-env for e2e:clean ────────────────

const envFile = resolve(REPO_ROOT, '.e2e-env');
appendFileSync(envFile, `E2E_RELEASE_EXTRACT_DIR=${extractDir}\nE2E_RELEASE_ZIP=${zipPath}\n`);

console.log('[e2e:release-setup] Done.');
