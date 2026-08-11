/**
 * E2E level-up skill assignment test.
 *
 * Flow:
 *   1. Create a Fighter lv1 character
 *   2. Set XP to the level-2 threshold so canLevelUp === true
 *   3. Open the sheet and click the Level Up button → complete LevelUpBox dialog
 *   4. Navigate to Features → Classes subtab, enable level progression
 *   5. Click the level-1 box → open LevelUpData dialog
 *   6. Select Fighter class, assign 2 skill points to Climb
 *   7. Submit and verify Climb rank on the actor
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissSystemDialogs, dismissOverlays } = require('./helpers');

const CLASS_PACK = 'warcraftrpg2e.classes';
const FIGHTER_ID = 'sgwZt7dg1ZHXQlrW';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
});

test('level-up: assign Climb skill points via LevelUpData dialog', async ({ page }) => {
  await dismissSystemDialogs(page);

  // ── 1. Create Fighter lv1 actor ────────────────────────────────────────────
  const { actorId, xpThreshold } = await page.evaluate(
    async ({ packId, fighterId }) => {
      const actor = await Actor.create({
        name: 'Test Level-Up Fighter',
        type: 'character',
        system: {
          abilities: {
            str: { value: 10 }, dex: { value: 10 }, con: { value: 10 },
            int: { value: 10 }, wis: { value: 10 }, cha: { value: 10 },
          },
        },
      });

      const pack = game.packs.get(packId);
      if (!pack) throw new Error(`Pack not found: ${packId}`);
      const classItem = await pack.getDocument(fighterId);
      if (!classItem) throw new Error(`Fighter not found in pack: ${fighterId}`);

      const classData = classItem.toObject();
      classData.system.levels = 1;
      await actor.createEmbeddedDocuments('Item', [classData]);

      // XP threshold for level 2 (uses world experience rate setting)
      const expRate = game.settings.get('warcraftrpg2e', 'experienceRate') || 'medium';
      const xpThreshold = CONFIG.D35E.CHARACTER_EXP_LEVELS[expRate][2];

      return { actorId: actor.id, xpThreshold };
    },
    { packId: CLASS_PACK, fighterId: FIGHTER_ID }
  );

  // ── 2. Set XP to level-2 threshold ────────────────────────────────────────
  await page.evaluate(
    async ({ id, xp }) => {
      await game.actors.get(id).update({ 'system.details.xp.value': xp });
    },
    { id: actorId, xp: xpThreshold }
  );

  const canLevelUp = await page.evaluate(
    id => game.actors.get(id).system.canLevelUp,
    actorId
  );
  expect(canLevelUp, 'actor should be able to level up after XP set').toBe(true);

  // ── 3. Open character sheet ────────────────────────────────────────────────
  await page.evaluate(async id => {
    await game.actors.get(id).sheet.render(true);
  }, actorId);

  const sheetLocator = page
    .locator(`.app.sheet.item[id*="${actorId}"], .app.sheet.actor[id*="${actorId}"]`)
    .first();
  await sheetLocator.waitFor({ state: 'visible', timeout: 10_000 });

  // Capture current level.available before clicking Level Up
  const levelBefore = await page.evaluate(
    id => game.actors.get(id).system.details.level.available,
    actorId
  );

  // ── 4. Click Level Up button ───────────────────────────────────────────────
  // Dismiss any notification toasts that may overlay the button
  await dismissOverlays(page);
  await sheetLocator.locator('a.level-up').click({ force: true });

  // ── 5. Complete LevelUpBox dialog ─────────────────────────────────────────
  // At this level there is no ability increase and no feat, so just submit.
  const levelUpBox = page.locator('.app[id="level-up-box"]');
  await levelUpBox.waitFor({ state: 'visible', timeout: 8_000 });
  await levelUpBox.locator('button[type="submit"]').click();
  await levelUpBox.waitFor({ state: 'hidden', timeout: 8_000 });

  // Verify level.available incremented by 1
  const levelAfter = await page.evaluate(
    id => game.actors.get(id).system.details.level.available,
    actorId
  );
  expect(levelAfter, 'level.available should increment by 1 after LevelUpBox submit').toBe(levelBefore + 1);

  // ── 6. Navigate to Features tab ────────────────────────────────────────────
  // The feats subtabs use numeric data-tab values (0=Classes, 1=Feats, ...).
  // "Classes" (data-tab=0) is the first subtab and is already active by default.
  await sheetLocator.locator('nav [data-tab="feats"]').click();
  await page.waitForTimeout(500);

  // ── 7. Enable level progression toggle via data update ───────────────────
  // The toggle checkbox can be off-screen; update the actor data directly.
  await page.evaluate(async id => {
    await game.actors.get(id).update({ 'system.details.levelUpProgression': true });
  }, actorId);
  await page.waitForTimeout(800); // wait for sheet re-render with level boxes

  // ── 8. Open LevelUpData dialog for the last level ─────────────────────────
  // Wait for the level box to render, then invoke _onLevelDataUp directly on
  // the sheet (more reliable than clicking a re-rendered element).
  const levelBox = sheetLocator.locator('a.configure-level-up-data.active').last();
  await levelBox.waitFor({ state: 'visible', timeout: 5_000 });

  await page.evaluate(async id => {
    const actor = game.actors.get(id);
    const sheet = actor.sheet;
    const levelUpDataList = actor.system.details.levelUpData;
    const lastLud = levelUpDataList[levelUpDataList.length - 1];
    const fakeAnchor = document.createElement('a');
    fakeAnchor.setAttribute('for', lastLud.id);
    sheet._onLevelDataUp({ preventDefault: () => {}, currentTarget: fakeAnchor });
  }, actorId);

  // ── 9. Interact with LevelUpData dialog ───────────────────────────────────
  // LevelUpDataDialog renders with id=<levelUpData UUID> (not "level-up-data"),
  // because _onLevelDataUp passes the entry UUID as options.id to override the
  // defaultOptions.id. Match by CSS class instead.
  const levelUpDataDialog = page.locator('.app.level-up-data');
  await levelUpDataDialog.waitFor({ state: 'visible', timeout: 8_000 });

  // Select Fighter (first non-empty option in class dropdown)
  await levelUpDataDialog.locator('select[name="class"]').selectOption({ index: 1 });
  await page.waitForTimeout(500); // wait for selectedClassData() to initialise skill display

  // Add 2 skill points to Climb (Fighter class skill → clm)
  const climbAddBtn = levelUpDataDialog.locator(
    'li[data-skill="clm"] a.item-control[title="Add Skill Point"]'
  );
  await climbAddBtn.click();
  await climbAddBtn.click();

  // ── 10. Submit LevelUpData dialog ─────────────────────────────────────────
  await levelUpDataDialog.locator('button[type="submit"]').click();
  await levelUpDataDialog.waitFor({ state: 'detached', timeout: 8_000 });

  // ── 11. Verify skill data on actor ────────────────────────────────────────
  const skills = await page.evaluate(
    id => {
      const a = game.actors.get(id);
      return {
        points: a.system.skills.clm.points,
        rank:   a.system.skills.clm.rank,
      };
    },
    actorId
  );

  expect(skills.points, 'Climb should have 2 stored skill points').toBe(2);
  expect(skills.rank,   'Climb rank should be 2').toBe(2);
});
