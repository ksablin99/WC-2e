'use strict';

const { defineConfig } = require('@playwright/test');
const { readFileSync, existsSync } = require('fs');
const { resolve, join } = require('path');
const { tmpdir } = require('os');

// Load .e2e-env if present (written by e2e:setup)
const envFile = resolve('.e2e-env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] ??= rest.join('=').trim();
  }
}

const DATA_DIR = process.env.E2E_DATA_DIR ?? join(tmpdir(), 'foundry-e2e');
const PORT     = process.env.E2E_PORT ?? '30001';
const BROWSER_EXECUTABLE = process.env.E2E_BROWSER_PATH;
const TEST_SCREEN = { width: 1600, height: 1000 };
const SERVER_STDOUT = process.env.E2E_SERVER_STDOUT === 'ignore' ? 'ignore' : 'pipe';
// E2E_FOUNDRY_PATH is written by e2e:setup (auto-discovered). Falls back to
// auto-discovery via foundry-version.js (respects .foundry-version / FOUNDRY_VERSION).
const { resolveFoundry } = require('./scripts/foundry-version');
const { buildFoundryWebServerCommand } = require('./scripts/foundry-command');
const FOUNDRY  = process.env.E2E_FOUNDRY_PATH ?? resolveFoundry(__dirname).mainJsPath;

module.exports = defineConfig({
  // Playwright starts, health-checks, and kills Foundry automatically.
  // reuseExistingServer: true locally means you can keep Foundry running between
  // runs for speed; CI always gets a fresh instance.
  webServer: {
    command: buildFoundryWebServerCommand({
      nodePath: process.execPath,
      foundryPath: FOUNDRY,
      dataDir: DATA_DIR,
      port: PORT,
    }),
    url:                 `http://localhost:${PORT}/join`,
    // Set E2E_REUSE_SERVER=1 to skip starting Foundry and reuse a running instance
    // (e.g. when you already have pm2 running it for manual testing).
    reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
    timeout:             90_000,
    stdout:              SERVER_STDOUT,
    stderr:              'pipe',
  },

  // global-setup handles only the GM login → saves auth state.
  // Foundry is guaranteed to be up before global-setup runs.
  globalSetup: './test/e2e/global-setup.js',

  use: {
    baseURL:      `http://localhost:${PORT}`,
    storageState: join(DATA_DIR, '.auth.json'),
    viewport:     TEST_SCREEN,
    screen:       TEST_SCREEN,
    launchOptions: BROWSER_EXECUTABLE ? { executablePath: BROWSER_EXECUTABLE } : {},
    // Run with --headed or PWHEADED=1 to watch tests in a visible browser.
    headless: process.env.PWHEADED !== '1',
  },

  testDir:  './test/e2e',
  timeout:  60_000,
  retries:  1,
  // Foundry is a single shared process — serial execution prevents cross-test
  // interference when clearWorld() runs between tests.
  workers:  1,

  reporter: [['list'], ['junit', { outputFile: 'test-results/e2e-junit.xml' }]],
});
