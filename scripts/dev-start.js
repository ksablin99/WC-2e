/**
 * dev:start — starts Foundry using the settings from .dev-env.
 *
 * Run via:  npm run dev:start
 *
 * Reads DEV_FOUNDRY_PATH, DEV_DATA_DIR, and DEV_PORT from .dev-env
 * (written by dev:setup). Runs Foundry in the foreground — Ctrl+C to stop.
 * Automatically opens the URL in your default browser and copies it to clipboard.
 */

'use strict';

const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');
const { spawnSync } = require('child_process');
const { applyTerminalColor } = require('./lib/wt-colors');
const { open } = require('open');

const REPO_ROOT = resolve(__dirname, '..');
const envFile   = resolve(REPO_ROOT, '.dev-env');

if (!existsSync(envFile)) {
  console.error('[dev:start] .dev-env not found. Run "npm run dev:setup" first.');
  process.exit(1);
}

const env = {};
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const [k, ...rest] = line.split('=');
  if (k && rest.length) env[k.trim()] = rest.join('=').trim();
}

const foundry  = env.DEV_FOUNDRY_PATH;
const dataPath = env.DEV_DATA_DIR;
const port     = env.DEV_PORT ?? '30000';

if (!foundry || !existsSync(foundry)) {
  console.error(`[dev:start] Foundry not found at: ${foundry}`);
  console.error('Run "npm run dev:setup" to reconfigure.');
  process.exit(1);
}

const url = `http://localhost:${port}/game`;

console.log(`[dev:start] Starting Foundry on port ${port}...`);
console.log(`[dev:start] Data dir: ${dataPath}`);
console.log(`[dev:start] URL: ${url}`);
console.log(`[dev:start] Press Ctrl+C to stop.\n`);
applyTerminalColor(REPO_ROOT);

// Copy URL to clipboard
try {
  const { platform } = require('os');
  if (platform() === 'win32') {
    spawnSync('clip', [], { input: url, shell: true });
  } else if (platform() === 'darwin') {
    spawnSync('pbcopy', [], { input: url });
  } else {
    const xclip = spawnSync('xclip', ['-selection', 'clipboard'], { input: url });
    if (xclip.status !== 0) {
      spawnSync('xsel', ['--clipboard', '--input'], { input: url });
    }
  }
  console.log('[dev:start] URL copied to clipboard.\n');
} catch {
  console.log('[dev:start] (clipboard copy failed, but Foundry will start normally)\n');
}

// Open in default browser (with a short delay to let Foundry start)
setTimeout(() => {
  open(url).catch(() => {
    console.log(`[dev:start] Could not open browser automatically. Visit: ${url}`);
  });
}, 2000);

spawnSync(
  process.execPath,
  [foundry, `--dataPath=${dataPath}`, '--world=dev-world', `--port=${port}`, '--noupdate'],
  { stdio: 'inherit' }
);
