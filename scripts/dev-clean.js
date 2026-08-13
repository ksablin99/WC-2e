/**
 * dev:clean — removes the dev data directory and .dev-env.
 *
 * Run via:  npm run dev:clean
 */

'use strict';

const { existsSync, unlinkSync, readFileSync } = require('fs');
const { resolve, join } = require('path');
const { tmpdir } = require('os');

const REPO_ROOT = resolve(__dirname, '..');
const { removeManagedDataDir } = require('./safe-managed-data-dir');
const envFile   = resolve(REPO_ROOT, '.dev-env');

let dataDir = process.env.DEV_DATA_DIR ?? join(tmpdir(), 'foundry-dev');

// Read the actual path from .dev-env if available
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k?.trim() === 'DEV_DATA_DIR' && rest.length) {
      dataDir = rest.join('=').trim();
      break;
    }
  }
}

if (existsSync(dataDir)) {
  removeManagedDataDir(dataDir, { repoRoot: REPO_ROOT, kind: 'dev' });
  console.log(`[dev:clean] Removed ${dataDir}`);
} else {
  console.log(`[dev:clean] Nothing to remove (${dataDir} does not exist)`);
}

if (existsSync(envFile)) {
  unlinkSync(envFile);
  console.log('[dev:clean] Removed .dev-env');
}

console.log('[dev:clean] Done.');
