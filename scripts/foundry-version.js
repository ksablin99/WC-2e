/**
 * foundry-version — shared Foundry path resolution utility.
 *
 * Resolves which Foundry installation to use based on the requested version,
 * and returns the path to its main.js.
 *
 * Version priority:
 *   1. Explicit argument (passed by caller from env var)
 *   2. FOUNDRY_VERSION env var  (e.g. FOUNDRY_VERSION=14)
 *   3. .foundry-version file in the repo root  (contents: "14")
 *   4. No version — auto-discovers the first available cache dir
 *
 * Path search order for a given major version N:
 *   1. <repoRoot>/.foundrycache/foundry-vN/main.js
 *   2. Walk up from repoRoot — finds .foundrycache in parent dirs
 *      (handles worktrees that share a parent's cache)
 *   3. .foundrycache/foundry/main.js  (legacy — no version suffix)
 *   4. Platform default Foundry install
 *   5. Throw with a helpful message
 *
 * Usage:
 *   const { resolveFoundry, readFoundryVersion } = require('./foundry-version');
 *   const { version, mainJsPath } = resolveFoundry(REPO_ROOT);
 */

'use strict';

const { existsSync, readFileSync } = require('fs');
const { join, dirname } = require('path');
const { platform } = require('os');

/**
 * Read the persisted version from a .dev-env / .e2e-env style file.
 * Returns the value for the given key, or null if not found.
 */
function readEnvFileKey(filePath, key) {
  if (!existsSync(filePath)) return null;
  try {
    for (const line of readFileSync(filePath, 'utf8').split('\n')) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      if (line.slice(0, eq).trim() === key) return line.slice(eq + 1).trim();
    }
  } catch { /* malformed */ }
  return null;
}

/**
 * Resolve the Foundry version to use.
 *
 * @param {string} repoRoot   - absolute path to the repo root
 * @param {string|null} [hint] - explicit version string (takes precedence over all others)
 * @returns {{ version: string|null, mainJsPath: string }}
 */
function resolveFoundry(repoRoot, hint = null) {
  // Determine requested version (may be null → auto-discover)
  const version =
    hint ??
    process.env.FOUNDRY_VERSION ??
    readFoundryVersionFile(repoRoot) ??
    null;

  const mainJsPath = findFoundryMain(repoRoot, version);
  return { version, mainJsPath };
}

/**
 * Read the .foundry-version file from the repo root.
 * Returns the trimmed contents (e.g. "14") or null if absent.
 */
function readFoundryVersionFile(repoRoot) {
  const versionFile = join(repoRoot, '.foundry-version');
  if (!existsSync(versionFile)) return null;
  try {
    return readFileSync(versionFile, 'utf8').trim() || null;
  } catch { return null; }
}

/**
 * Walk up from repoRoot searching for a .foundrycache directory that
 * contains foundry-vN/main.js (or foundry/main.js for the legacy layout).
 *
 * Also checks FOUNDRY_CACHE_DIR env var and the well-known system path
 * /opt/foundry (Linux CI agents).
 *
 * @param {string} repoRoot
 * @param {string|null} version - major version number as a string, or null
 * @returns {string} absolute path to main.js
 * @throws {Error} if not found
 */
function findFoundryMain(repoRoot, version) {
  const { readdirSync } = require('fs');

  // Build candidate sub-paths: versioned first, legacy fallback
  const subPaths = version
    ? [`foundry-v${version}/main.js`, 'foundry/main.js']
    : ['foundry/main.js'];

  // Directories to search for foundry-vN/ subdirs.
  // Priority: .foundrycache walk (dev machines) → system dir (CI agents).
  const searchRoots = [];

  // 1. Walk up from repoRoot collecting .foundrycache dirs
  let dir = repoRoot;
  for (let i = 0; i < 6; i++) {
    searchRoots.push(join(dir, '.foundrycache'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. FOUNDRY_CACHE_DIR env var (explicit override for CI)
  if (process.env.FOUNDRY_CACHE_DIR) {
    searchRoots.push(process.env.FOUNDRY_CACHE_DIR);
  }

  // 3. Well-known system path for pre-provisioned Linux CI agents
  if (platform() !== 'win32') {
    searchRoots.push('/opt/foundry');
  }

  for (const root of searchRoots) {
    if (!existsSync(root)) continue;
    // Check explicit sub-paths first
    for (const sub of subPaths) {
      const candidate = join(root, sub);
      if (existsSync(candidate)) return candidate;
    }
    // When no version is specified, auto-scan for any foundry-vN/main.js
    if (!version) {
      let entries = [];
      try { entries = readdirSync(root); } catch { /* ignore */ }
      const versioned = entries
        .filter(e => /^foundry-v\d+$/.test(e))
        .sort((a, b) => {
          const na = parseInt(a.match(/\d+/)[0], 10);
          const nb = parseInt(b.match(/\d+/)[0], 10);
          return nb - na; // numeric descending — prefer highest version
        });
      for (const entry of versioned) {
        const candidate = join(root, entry, 'main.js');
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  // Platform default install
  const platformDefault =
    platform() === 'win32'
      ? join(process.env.LOCALAPPDATA ?? '', 'FoundryVTT/resources/app/main.js')
      : join(process.env.HOME ?? '/root', '.local/share/FoundryVTT/resources/app/main.js');  if (existsSync(platformDefault)) return platformDefault;

  const versionHint = version ? ` (version ${version})` : '';
  throw new Error(
    `[foundry-version] Could not find Foundry main.js${versionHint}.\n` +
    'Options:\n' +
    `  • Set FOUNDRY_VERSION=N (e.g. 13 or 14)\n` +
    `  • Create .foundry-version in the repo root containing the major version\n` +
    `  • Place .foundrycache/foundry-vN/main.js or /opt/foundry/foundry-vN/main.js\n` +
    '  • Set FOUNDRY_CACHE_DIR=/path/to/dir containing foundry-vN/ subdirs\n' +
    '  • Set E2E_FOUNDRY_PATH or DEV_FOUNDRY_PATH to the explicit path'
  );
}

/**
 * Return the world.json template path for the given Foundry major version.
 * Falls back to the default world.json if no versioned template exists.
 *
 * @param {string} e2eDataDir - absolute path to test/foundry-e2e-data/
 * @param {string|null} version
 * @returns {string} absolute path to world.json
 */
function resolveWorldTemplate(e2eDataDir, version) {
  if (version) {
    const versioned = join(e2eDataDir, `world-v${version}.json`);
    if (existsSync(versioned)) return versioned;
  }
  return join(e2eDataDir, 'world.json');
}

module.exports = { resolveFoundry, readFoundryVersionFile, resolveWorldTemplate, readEnvFileKey };
