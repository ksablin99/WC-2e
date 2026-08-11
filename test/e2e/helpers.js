/**
 * Shared helpers for e2e tests.
 */

'use strict';

/**
 * Navigate to the game and wait until Foundry's `game.ready` is true.
 */
async function gotoGame(page) {
  const port = process.env.E2E_PORT ?? '30001';
  await page.goto(`http://localhost:${port}/game`);
  await page.waitForFunction(
    () => typeof game !== 'undefined' && game.ready === true,
    { timeout: 60_000 },
  );
}

/**
 * Wipe all actors, items (world-level), chat messages, and scenes.
 */
async function clearWorld(page) {
  await page.evaluate(async () => {
    await Promise.all([
      ...game.actors.map(a => a.delete()),
      ...game.items.map(i => i.delete()),
      ...game.messages.map(m => m.delete()),
      ...game.scenes.map(s => s.delete()),
    ]);
  });
}

/**
 * Ensure the Foundry canvas is ready by creating and activating a minimal test
 * scene if one isn't already active.  Required before clicking scene control
 * tool buttons, because SceneControls.#onChangeTool silently returns when
 * canvas.ready is false.
 */
async function ensureCanvasReady(page) {
  await page.evaluate(async () => {
    if (!canvas.ready) {
      await Scene.create({ name: 'E2E Canvas Scene', active: true, width: 100, height: 100 });
    }
  });
  await page.waitForFunction(() => canvas.ready === true, { timeout: 20_000 });
}

/**
 * Clear Foundry notification toasts that cover the UI and intercept pointer events.
 * Does NOT close any Application windows — that can cause unexpected page reloads.
 * Use { force: true } on Playwright clicks to bypass any remaining overlay elements.
 */
async function dismissOverlays(page) {
  await page.evaluate(() => {
    if (ui?.notifications) {
      ui.notifications.queue = [];
      ui.notifications.active = [];
      const el = document.querySelector('#notifications');
      if (el) el.innerHTML = '';
    }
  });
  await page.waitForTimeout(150);
}

/**
 * Close system-level popup windows (migration dialogs, welcome screens, onboarding)
 * that Foundry opens automatically and can block UI interactions.
 * Uses Playwright clicks only — never calls app.close() which can cause page reloads.
 */
async function dismissSystemDialogs(page) {
  // 1. Migration dialog — click "I Backed Up, Continue" if it appears
  //    The dialog fires asynchronously after the `ready` hook, so wait up to 3 s.
  const migrateBtn = page.locator('button:has-text("I Backed Up, Continue")');
  if (await migrateBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await migrateBtn.click({ force: true });
    await page.waitForTimeout(600);
  }

  // 2. Close known system popup windows by clicking their close buttons.
  //    These are Foundry-generated popups (welcome screens, tutorial, etc.) that
  //    appear on world load. We identify them by known IDs / title patterns.
  const systemPopupSelectors = [
    // D35E welcome/tutorial dialog
    '.app:has(.window-title:has-text("Welcome"))',
    '.app:has(.window-title:has-text("3.5e SRD"))',
    '.app:has(.window-title:has-text("traveller"))',
    // D35E OnboardingScreen ("Welcome, traveller!" — rendered as .app with id #onboarding)
    '#onboarding',
    '.app.welcome-screen',
  ];

  for (const sel of systemPopupSelectors) {
    const closeBtn = page.locator(`${sel} .header-button.close, ${sel} a.close`).first();
    if (await closeBtn.isVisible({ timeout: 300 }).catch(() => false)) {
      await closeBtn.click({ force: true });
      await page.waitForTimeout(200);
    }
  }

  // D35E OnboardingScreen dismiss — click "I know my way around here" if visible
  const onboardingDismiss = page.getByText('I know my way around here', { exact: false });
  if (await onboardingDismiss.isVisible({ timeout: 300 }).catch(() => false)) {
    await onboardingDismiss.click({ force: true });
    await page.waitForTimeout(200);
  }

  // Foundry v14+ core welcome tour (sidebar complementary panel) — blocks sheets and controls
  const foundryWelcomeTour = page.getByRole('complementary').filter({
    has: page.getByRole('heading', { name: /Welcome to Foundry Virtual Tabletop/i }),
  });
  if (await foundryWelcomeTour.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await foundryWelcomeTour.locator('button').first().click({ force: true });
    await page.waitForTimeout(300);
  }

  // Fallback for Foundry v14's core tour when the close control has no stable
  // accessible label and the role locator above misses the rendered panel.
  await page.evaluate(() => {
    const headings = [...document.querySelectorAll('h1,h2,h3')].filter((el) =>
      /Welcome to Foundry Virtual Tabletop/i.test(el.textContent ?? '')
    );
    for (const heading of headings) {
      const panel = heading.closest('[role="complementary"], aside, .tour, .app') ?? heading.parentElement;
      const close = panel?.querySelector('button[aria-label="Close"], button[data-action="close"], button');
      close?.click();
      panel?.remove();
    }
  });
  await page.waitForTimeout(200);

  await page.waitForTimeout(200);
}

module.exports = { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs, ensureCanvasReady };
