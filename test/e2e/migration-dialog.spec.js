'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await expect(page.locator('.migration-dialog')).toHaveCount(0, { timeout: 60_000 });
  await dismissOverlays(page);
});

test('migration dialog shows pending migration and records completion', async ({ page }) => {
  await page.evaluate(async () => {
    const migrationModule = await import('/systems/warcraftrpg2e/module/migration.js');
    const { MIGRATIONS } = migrationModule;
    const migrationId = 'e2e-required-current-version';
    const completed = Object.fromEntries(MIGRATIONS.map((migration) => [migration.id, {
      version: migration.version,
      completedAt: '2026-01-01T00:00:00.000Z',
      affected: { total: 0, byType: {} },
    }]));

    await game.settings.set('warcraftrpg2e', 'systemMigrationState', {
      schemaVersion: 1,
      baselineVersion: game.system.version,
      currentSystemVersion: game.system.version,
      lastSuccessVersion: game.system.version,
      lastAttempt: null,
      completed,
      skipped: {},
    });

    window.__d35eMigrationE2E = false;
    window.__d35eResolveMigration = null;
    const syntheticMigration = {
      id: migrationId,
      version: game.system.version,
      title: 'D35E.MigrationTitle',
      description: 'D35E.MigrationText',
      run: async () => {
        await new Promise((resolve) => { window.__d35eResolveMigration = resolve; });
        window.__d35eMigrationE2E = true;
        return { affected: { byType: { Actor: 2, Item: 1 } } };
      },
    };
    if (!MIGRATIONS.some((migration) => migration.id === migrationId)) MIGRATIONS.push(syntheticMigration);

    const { MigrationDialog } = await import('/systems/warcraftrpg2e/module/apps/migration-dialog.js');
    window.__d35eMigrationApp = new MigrationDialog({
      state: game.settings.get('warcraftrpg2e', 'systemMigrationState'),
      pending: [syntheticMigration],
    });
    window.__d35eMigrationApp.render(true);
  });

  const dialog = page.locator('.migration-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Pending Migrations');
  const requiredToggle = dialog.locator('[data-action="toggle-migration"][data-migration-id="e2e-required-current-version"]');
  await expect(requiredToggle).toBeChecked();
  await expect(requiredToggle).toBeDisabled();

  await page.evaluate(() => { window.__d35eMigrationApp._runMigrations(); });
  await page.waitForFunction(() => window.__d35eResolveMigration !== null, { timeout: 10_000 });
  await expect(dialog.locator('button', { hasText: 'Working...' })).toBeDisabled();

  await page.evaluate(() => window.__d35eResolveMigration());
  await page.waitForFunction(() => window.__d35eMigrationE2E === true, { timeout: 10_000 });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button', { hasText: 'OK' })).toBeVisible();
  await expect(dialog).toContainText('Affected entities: 3');
  await expect(dialog).toContainText('Actor: 2');

  const result = await page.evaluate(() => ({
    ran: window.__d35eMigrationE2E,
    state: game.settings.get('warcraftrpg2e', 'systemMigrationState'),
    systemVersion: game.system.version,
  }));

  expect(result.ran).toBe(true);
  expect(result.state.completed['e2e-required-current-version'].version).toBe(result.systemVersion);
  expect(result.state.completed['e2e-required-current-version'].affected.total).toBe(3);
  expect(result.state.lastSuccessVersion).toBe(result.systemVersion);

  await expect(dialog.locator('button', { hasText: 'OK' })).toBeEnabled();
});

test('optional migration can be skipped and is recorded', async ({ page }) => {
  await page.evaluate(async () => {
    const migrationModule = await import('/systems/warcraftrpg2e/module/migration.js');
    const { MIGRATIONS } = migrationModule;
    const migrationId = 'e2e-optional-current-version';
    const syntheticMigration = {
      id: migrationId,
      version: game.system.version,
      title: 'D35E.MigrationTitle',
      description: 'D35E.MigrationText',
      optional: true,
      run: async () => ({ affected: { total: 0, byType: {} } }),
    };
    if (!MIGRATIONS.some((migration) => migration.id === migrationId)) MIGRATIONS.push(syntheticMigration);
    const completed = Object.fromEntries(MIGRATIONS
      .filter((migration) => migration.id !== migrationId)
      .map((migration) => [migration.id, {
        version: migration.version,
        completedAt: '2026-01-01T00:00:00.000Z',
        affected: { total: 0, byType: {} },
      }]));

    await game.settings.set('warcraftrpg2e', 'systemMigrationState', {
      schemaVersion: 1,
      baselineVersion: game.system.version,
      currentSystemVersion: game.system.version,
      lastSuccessVersion: game.system.version,
      lastAttempt: null,
      completed,
      skipped: {},
    });

    const { MigrationDialog } = await import('/systems/warcraftrpg2e/module/apps/migration-dialog.js');
    window.__d35eMigrationApp = new MigrationDialog({
      state: game.settings.get('warcraftrpg2e', 'systemMigrationState'),
      pending: [syntheticMigration],
    });
    window.__d35eMigrationApp.render(true);
  });

  const dialog = page.locator('.migration-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Optional');

  const optionalToggle = dialog.locator('[data-action="toggle-migration"][data-migration-id="e2e-optional-current-version"]');
  await expect(optionalToggle).toBeChecked();
  await optionalToggle.evaluate((element) => {
    element.checked = false;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(optionalToggle).not.toBeChecked();
  await page.evaluate(async () => { await window.__d35eMigrationApp._runMigrations(); });
  await expect(dialog).toContainText('Skipped Migrations');
  await expect(dialog.locator('button', { hasText: 'OK' })).toBeEnabled();

  const state = await page.evaluate(() => game.settings.get('warcraftrpg2e', 'systemMigrationState'));
  expect(state.skipped['e2e-optional-current-version'].version).toBe(state.currentSystemVersion);
});
