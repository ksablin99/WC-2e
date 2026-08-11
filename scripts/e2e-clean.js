/**
 * e2e:clean — removes the e2e data directory and .e2e-env.
 *
 * Run via:  npm run e2e:clean
 */

'use strict';

const { existsSync, rmSync, unlinkSync, readFileSync } = require('fs');
const { resolve, join } = require('path');
const { tmpdir } = require('os');
const crypto = require('crypto');

const REPO_ROOT = resolve(__dirname, '..');
const envFile   = resolve(REPO_ROOT, '.e2e-env');

// Default data dir uses the same hash logic as e2e/setup.js
const hash       = crypto.createHash('sha1').update(REPO_ROOT).digest('hex').slice(0, 8);
let dataDir      = process.env.E2E_DATA_DIR ?? join(tmpdir(), `foundry-e2e-${hash}`);

// Read the actual path from .e2e-env if available
let releaseExtractDir = null;
let releaseZip = null;

if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    const key = k?.trim();
    const val = rest.join('=').trim();
    if (key === 'E2E_DATA_DIR' && val) dataDir = val;
    if (key === 'E2E_RELEASE_EXTRACT_DIR' && val) releaseExtractDir = val;
    if (key === 'E2E_RELEASE_ZIP' && val) releaseZip = val;
  }
}

if (existsSync(dataDir)) {
  rmSync(dataDir, { recursive: true, force: true });
  console.log(`[e2e:clean] Removed ${dataDir}`);
} else {
  console.log(`[e2e:clean] Nothing to remove (${dataDir} does not exist)`);
}

if (releaseExtractDir && existsSync(releaseExtractDir)) {
  rmSync(releaseExtractDir, { recursive: true, force: true });
  console.log(`[e2e:clean] Removed release extract dir ${releaseExtractDir}`);
}

if (releaseZip && existsSync(releaseZip)) {
  unlinkSync(releaseZip);
  console.log(`[e2e:clean] Removed release zip ${releaseZip}`);
}

if (existsSync(envFile)) {
  unlinkSync(envFile);
  console.log('[e2e:clean] Removed .e2e-env');
}

console.log('[e2e:clean] Done.');
