'use strict';
/**
 * E2E tests for issue #1633 — welcome screen and onboarding persistence.
 *
 * Tests verify:
 *  1. Welcome screen is suppressed when stored version matches current (version gate)
 *  2. Checking the "show-again" checkbox in the welcome screen saves the current version
 *  3. Onboarding is suppressed when the __onboarding flag is true
 *  4. Clicking the onboarding dismiss link saves the __onboarding flag and closes the app
 *
 * The fix: both screens' `activateListeners` were attaching event listeners to
 * `html[0]` (the `<style>` element, since both templates start with `<style>`).
 * The fix uses `html[0].parentElement` to reach the actual window content.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);

  // Extra cleanup: dismissSystemDialogs uses '#onboarding' (legacy id) which may not
  // match in Foundry v12+ where the Application id is 'app-NNN'.  Close any lingering
  // .app.onboarding or .app.welcome-screen windows via their header close buttons.
  for (const sel of ['.app.welcome-screen', '.app.onboarding']) {
    const btn = page.locator(`${sel} .header-button.close, ${sel} a.close`).first();
    if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
      await btn.click({ force: true });
      await page.waitForTimeout(200);
    }
  }
  await page.waitForTimeout(200);
});

// ── 1. Welcome screen: version gate ───────────────────────────────────────────

test('welcome screen does not render when stored version matches current', async ({ page }) => {
  // Set the stored version to the current version so the gate blocks rendering on next load.
  await page.evaluate(async () => {
    const moduleId = game.system.id;
    const cleanVersion = game.system.version.replace(/-beta\.\d+$/, '');

    if (!game.settings.settings.has(`${moduleId}.version`)) {
      game.settings.register(moduleId, 'version', {
        name: 'Version', default: '0.0.0', type: String, scope: 'world',
      });
    }
    await game.settings.set(moduleId, 'version', cleanVersion);
  });

  // Reload so the D35E.js ready hook fires with the current stored version.
  // The gate (isNewerVersion check) should prevent the welcome screen from opening.
  await page.reload();
  await page.waitForFunction(() => typeof game !== 'undefined' && game.ready === true, { timeout: 30_000 });

  // Allow a settle time for any potential async render.
  await page.waitForTimeout(1000);

  // The welcome-screen Application must NOT have been opened by the ready hook.
  await expect(page.locator('.app.welcome-screen')).toHaveCount(0);
});

// ── 2. Welcome screen: "show-again" checkbox saves the version setting ─────────

test('welcome screen renders and hides after checking show-again', async ({ page }) => {
  // Set the stored version to "0.0.0" so the version gate passes and the screen shows.
  await page.evaluate(async () => {
    const moduleId = game.system.id;
    if (!game.settings.settings.has(`${moduleId}.version`)) {
      game.settings.register(moduleId, 'version', {
        name: 'Version', default: '0.0.0', type: String, scope: 'world',
      });
    }
    await game.settings.set(moduleId, 'version', '0.0.0');

    const { default: renderWelcomeScreen } = await import('/systems/warcraftrpg2e/module/welcome-screen.js');
    renderWelcomeScreen();
  });

  // Wait for the welcome-screen Application window to appear in the DOM.
  await page.waitForSelector('.app.welcome-screen', { timeout: 10_000 });
  await expect(page.locator('.app.welcome-screen')).toBeVisible();

  // Click the "Don't show this screen again until next update" checkbox.
  // force: true is needed because the checkbox may be partly covered by the
  // Foundry application chrome or other elements.
  await page.locator('.app.welcome-screen .show-again').click({ force: true });

  // Wait until the setting is updated away from the sentinel "0.0.0".
  await page.waitForFunction(
    () => {
      try {
        return game.settings.get('warcraftrpg2e', 'version') !== '0.0.0';
      } catch (_) {
        return false;
      }
    },
    { timeout: 10_000 }
  );

  // Confirm the saved version matches the stripped (non-beta) system version —
  // exactly what welcome-screen.js stores when the checkbox is checked.
  const savedVersion = await page.evaluate(() => game.settings.get('warcraftrpg2e', 'version'));
  const cleanVersion = await page.evaluate(
    () => game.system.version.replace(/-beta\.\d+$/, '')
  );
  expect(savedVersion).toBe(cleanVersion);
});

// ── 3. Onboarding: flag gate ───────────────────────────────────────────────────

test('onboarding does not render when onboarding flag is set', async ({ page }) => {
  // Set __onboarding to true so renderOnboardingScreen returns early.
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', '__onboarding', true);

    const { default: renderOnboardingScreen } = await import('/systems/warcraftrpg2e/module/onboarding.js');
    renderOnboardingScreen();
  });

  // Allow a short settle time.
  await page.waitForTimeout(600);

  // The onboarding Application must NOT have been opened.
  await expect(page.locator('.app.onboarding')).toHaveCount(0);
});

// ── 4. Onboarding: dismiss link sets flag and closes app ──────────────────────

test('onboarding dismiss link closes app and sets flag', async ({ page }) => {
  // Reset both flags so the onboarding screen will render.
  await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', '__onboarding', false);
    await game.settings.set('warcraftrpg2e', '__onboardingHidden', false);

    const { default: renderOnboardingScreen } = await import('/systems/warcraftrpg2e/module/onboarding.js');
    renderOnboardingScreen();
  });

  // Wait for the onboarding Application window to appear.
  await page.waitForSelector('.app.onboarding', { timeout: 10_000 });
  await expect(page.locator('.app.onboarding')).toBeVisible();

  // Click the first ".show-again" link ("I know my way around here, old man!").
  await page.locator('.app.onboarding .show-again').first().click({ force: true });

  // Wait for the __onboarding flag to be persisted as true.
  await page.waitForFunction(
    () => {
      try {
        return game.settings.get('warcraftrpg2e', '__onboarding') === true;
      } catch (_) {
        return false;
      }
    },
    { timeout: 10_000 }
  );

  // After close(), the onboarding window should be removed from the DOM.
  await page.waitForTimeout(600);
  await expect(page.locator('.app.onboarding')).toHaveCount(0);
});
