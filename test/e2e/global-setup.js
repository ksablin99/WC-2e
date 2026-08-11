/**
 * Playwright global setup — authenticates as GM and saves session state.
 *
 * Foundry is already running when this runs (started by playwright webServer).
 * Auth state is saved to <dataDir>/.auth.json and reused by every test worker.
 */

'use strict';

const { chromium } = require('@playwright/test');
const { resolve, join } = require('path');
const { readFileSync, existsSync } = require('fs');

const REPO_ROOT = resolve(__dirname, '../..');

function loadEnv() {
  const envFile = resolve(REPO_ROOT, '.e2e-env');
  if (!existsSync(envFile)) {
    throw new Error('.e2e-env not found — run "npm run e2e:setup" first');
  }
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) process.env[k.trim()] ??= rest.join('=').trim();
  }
}

module.exports = async function globalSetup() {
  loadEnv();

  const dataDir = process.env.E2E_DATA_DIR;
  const port    = process.env.E2E_PORT ?? '30001';
  const baseUrl = `http://localhost:${port}`;

  console.log('[global-setup] Logging in as GM…');

  const browser = await chromium.launch({ headless: true });
  const page    = await browser.newPage();

  const browserErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') browserErrors.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => browserErrors.push(`[pageerror] ${err.message}`));

  await page.goto(`${baseUrl}/join`);

  // Select the Gamemaster user (no password needed in a fresh world)
  const gmOption = page.locator('select[name="userid"] option').filter({ hasText: /gamemaster/i });
  const gmValue  = await gmOption.getAttribute('value');
  await page.selectOption('select[name="userid"]', gmValue);

  await page.click('button[name="join"]');
  await page.waitForURL(`${baseUrl}/game`, { timeout: 30_000 });
  await page.waitForFunction(() => typeof game !== 'undefined' && game.ready === true, {
    timeout: 30_000,
  });

  if (browserErrors.length) console.error('[global-setup] Browser errors:\n', browserErrors.join('\n'));

  // Verify D35E initialized — isCIEnvironment is registered in the init hook.
  if (!await page.evaluate(() => game.settings?.settings?.has('D35E.isCIEnvironment'))) {
    throw new Error('D35E init hook did not complete — isCIEnvironment not registered. Check browser console for module load errors.');
  }

  // Persist isCIEnvironment=true so dialogs are suppressed in every test session.
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'isCIEnvironment', true);
  });

  const authPath = join(dataDir, '.auth.json');
  await page.context().storageState({ path: authPath });
  console.log(`[global-setup] Auth state saved to ${authPath}`);

  await browser.close();
};
