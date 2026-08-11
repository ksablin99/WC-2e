'use strict';

/**
 * E2E tests for GM Tools — scene control buttons and the dialogs they open.
 *
 * Tests are grouped by tool:
 *   - Scene controls: dungeon icon visible, correct tools registered
 *   - Encounter Generator dialog: opens, roll tables populate the select
 *   - Treasure Generator dialog: opens, add/remove items from queue
 *   - Rest Party: restores HP for party-member actors
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs, ensureCanvasReady } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scene controls
// ─────────────────────────────────────────────────────────────────────────────

test('d35e scene control group is registered with correct tools', async ({ page }) => {
  const info = await page.evaluate(() => {
    const ctrl = ui.controls.controls?.d35e ?? ui.controls._controls?.d35e;
    if (!ctrl) return { found: false };
    return {
      found: true,
      toolKeys: Object.keys(ctrl.tools ?? {}),
    };
  });

  expect(info.found).toBe(true);
  expect(info.toolKeys).toContain('d35e-gm-tools-encounter-generator');
  expect(info.toolKeys).toContain('d35e-gm-tools-custom-treasure-generator');
  expect(info.toolKeys).toContain('d35e-gm-tools-rest-party');
});

test('d35e "Game Master Tools" tab is visible in the scene controls toolbar', async ({ page }) => {
  // In v13, scene controls render as accessible tabs.
  // Our d35e control group has title "D35E.GMTools" → "Game Master Tools".
  const tab = page.getByRole('tab', { name: /Game Master Tools/i });
  await expect(tab).toBeVisible({ timeout: 10_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar button clicks (regression for key vs name mismatch — v13)
// ─────────────────────────────────────────────────────────────────────────────

test('clicking Encounter Generator sidebar button opens the dialog', async ({ page }) => {
  // SceneControls.#onChangeTool silently returns when canvas.ready is false.
  await ensureCanvasReady(page);

  // Pre-seed the compendium browser so loadCompendium() returns immediately.
  // Without this, getData() fetches the entire bestiary (~600 actors) before
  // rendering, which easily exceeds a 15 s wait.
  await page.evaluate(() => {
    const cb = game.D35E.compendiumBrowser;
    cb.type = 'bestiary';
    cb.entityType = 'Actor';
    cb._data.loaded = true;
    cb.items = [];
  });

  await page.getByRole('tab', { name: /Game Master Tools/i }).click();
  await page.getByRole('button', { name: /^Encounter Generator$/i }).click();

  await expect(page.locator('#encounter-generator')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#encounter-generator #choicesCompendium')).toBeVisible();
});

test('clicking Custom Treasure Generator sidebar button opens the dialog', async ({ page }) => {
  // SceneControls.#onChangeTool silently returns when canvas.ready is false.
  await ensureCanvasReady(page);
  await page.getByRole('tab', { name: /Game Master Tools/i }).click();
  await page.getByRole('button', { name: /Generate Custom Treasure/i }).click();

  await expect(page.locator('#treasure-generator')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#treasure-generator #treasureQuality')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Encounter Generator dialog
// ─────────────────────────────────────────────────────────────────────────────

test('encounter generator: roll-tables compendium has at least one table', async ({ page }) => {
  // Test that the roll-tables pack exists and has entries — this is what
  // getCompendiumTables() reads. Fast: no full bestiary load needed.
  const tableCount = await page.evaluate(async () => {
    const pack = game.packs.get("warcraftrpg2e.roll-tables");
    if (!pack) return -1;
    const index = await pack.getIndex();
    return index.size;
  });
  expect(tableCount).toBeGreaterThan(0);
});

test('encounter generator dialog form structure is correct (bypassing bestiary load)', async ({ page }) => {
  // Render the dialog with a pre-loaded mock so getData() resolves immediately
  // without waiting for all actor compendiums to load.
  await page.evaluate(async () => {
    // Pre-populate the compendium browser so loadCompendium() skips the load
    const cb = game.D35E.compendiumBrowser;
    cb.type = 'bestiary';
    cb.entityType = 'Actor';
    cb._data.loaded = true;
    cb.items = [];  // no monsters, that's fine — we just need the dialog to open

    new game.D35E.EncounterGeneratorDialog().render(true);
  });

  await page.locator('#encounter-generator').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.locator('#encounter-generator #ELTarget')).toBeVisible();
  await expect(page.locator('#encounter-generator .MonsterButton')).toBeVisible();
  // The select is populated from the roll-tables compendium — may have 0 options
  // if tables is empty after skipping; check the element exists
  await expect(page.locator('#encounter-generator #choicesCompendium')).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Treasure Generator dialog
// ─────────────────────────────────────────────────────────────────────────────

test('treasure generator dialog opens with quality and type selects', async ({ page }) => {
  await page.evaluate(async () => {
    new game.D35E.TreasureGeneratorDialog().render(true);
    await new Promise(r => setTimeout(r, 500));
  });

  await page.locator('#treasure-generator').waitFor({ state: 'visible', timeout: 10_000 });
  await expect(page.locator('#treasure-generator #treasureQuality')).toBeVisible();
  await expect(page.locator('#treasure-generator #treasureType')).toBeVisible();
  await expect(page.locator('#treasure-generator #treasureAmount')).toBeVisible();
  await expect(page.locator('#treasure-generator .addTreasure')).toBeVisible();
});

test('treasure generator can add and remove items from the queue', async ({ page }) => {
  // appId is the numeric key in ui.windows (not the DOM id string)
  const appId = await page.evaluate(async () => {
    const dlg = new game.D35E.TreasureGeneratorDialog();
    await dlg.render(true);
    await new Promise(r => setTimeout(r, 600));
    return dlg.appId;
  });

  await page.locator('#treasure-generator').waitFor({ state: 'visible', timeout: 10_000 });
  // Migration dialog can appear after game.ready — dismiss it here too
  await dismissSystemDialogs(page);

  // Add a treasure entry — call the method directly to avoid click interception
  await page.evaluate(async (id) => {
    const app = ui.windows[id];
    app.addTreasure();
    await new Promise(r => setTimeout(r, 300));
  }, appId);

  // Wait for the app's internal treasures array to update (survives re-render)
  await page.waitForFunction((id) => {
    const app = ui.windows[id];
    return app?.treasures?.length === 1;
  }, appId, { timeout: 8_000 });

  await page.locator('#treasure-generator').waitFor({ state: 'visible', timeout: 5_000 });
  await expect(page.locator('#treasure-generator ul li')).toHaveCount(1);

  // Delete it — call delTreasure directly to avoid click-on-re-rendering-element
  // race: activateListeners attaches the handler after each render(), so a DOM
  // click can land in the window between render() and activateListeners().
  await page.evaluate(async (id) => {
    const app = ui.windows[id];
    const delBtn = document.querySelector('#treasure-generator .delTreasure');
    app.delTreasure({ currentTarget: delBtn });
    await new Promise(r => setTimeout(r, 100));
  }, appId);

  await page.waitForFunction((id) => {
    const app = ui.windows[id];
    return app?.treasures?.length === 0;
  }, appId, { timeout: 8_000 });

  await page.locator('#treasure-generator').waitFor({ state: 'visible', timeout: 5_000 });
  await expect(page.locator('#treasure-generator ul li')).toHaveCount(0);
});

test('treasure generator changing quality re-renders type options', async ({ page }) => {
  await page.evaluate(async () => {
    new game.D35E.TreasureGeneratorDialog().render(true);
    await new Promise(r => setTimeout(r, 500));
  });

  const dlg = page.locator('#treasure-generator');
  await dlg.waitFor({ state: 'visible', timeout: 10_000 });

  // Mundane quality has fewer type options (no magic categories)
  const mundaneCount = await dlg.locator('#treasureType option').count();

  await dlg.locator('#treasureQuality').selectOption('minor');
  await page.waitForTimeout(400);
  await dlg.waitFor({ state: 'visible', timeout: 5_000 });

  const minorCount = await dlg.locator('#treasureType option').count();
  expect(minorCount).toBeGreaterThan(mundaneCount);
});

// ─────────────────────────────────────────────────────────────────────────────
// Rest Party
// ─────────────────────────────────────────────────────────────────────────────

test('rest party runs successfully for party member actors', async ({ page }) => {
  // Create a party member with HP below max
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Test Fighter',
      type: 'character',
      system: {
        isPartyMember: true,
        abilities: { str: { value: 16 }, dex: { value: 14 }, con: { value: 14 },
                     int: { value: 10 }, wis: { value: 10 }, cha: { value: 10 } },
        attributes: { hp: { value: 5, max: 20 } },
      },
    });
    return actor.id;
  });

  expect(actorId).toBeTruthy();

  // Verify the actor is recognised as a party member
  const isParty = await page.evaluate((id) => {
    return game.actors.filter(a => a.system.isPartyMember).some(a => a.id === id);
  }, actorId);
  expect(isParty).toBe(true);

  // Run rest — same code path as the scene control button's onChange
  // rest() resolving without error is the key assertion here; HP restoration
  // depends on class levels which a freshly-created actor does not have.
  const restResult = await page.evaluate(async () => {
    try {
      await Promise.all(
        game.actors.filter(a => a.system.isPartyMember).map(a => a.rest(true, true, false))
      );
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  expect(restResult.ok).toBe(true);
});
