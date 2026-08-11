'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { openSheet } = require('./helpers/actor-sheet');
const { openSkillsTab } = require('./helpers/skill-roll');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

async function enableBackgroundSkills(page) {
  return page.evaluate(async () => {
    const original = game.settings.get('warcraftrpg2e', 'allowBackgroundSkills');
    await game.settings.set('warcraftrpg2e', 'allowBackgroundSkills', true);
    return original;
  });
}

async function restoreBackgroundSkills(page, original) {
  await page.evaluate(async (value) => {
    await game.settings.set('warcraftrpg2e', 'allowBackgroundSkills', value);
  }, original);
}

async function createCharacter(page, levelUpProgression) {
  return page.evaluate(async (useLevelUpProgression) => {
    const actor = await Actor.create({
      name: useLevelUpProgression
        ? 'Issue 1705 Level Up BG Skills Actor'
        : 'Issue 1705 Background Skills Actor',
      type: 'character',
    });
    await actor.update({
      'system.details.levelUpProgression': useLevelUpProgression,
      'system.abilities.int.value': 14,
    });
    return actor.id;
  }, levelUpProgression);
}

async function getSkillsTabSnapshot(page, sheetId) {
  return page.evaluate((id) => {
    const sheet = document.querySelector(`#${id}`);
    const skillsTab = sheet?.querySelector('.tab.skills');
    const skillsetNav = skillsTab?.querySelector('nav[data-group="skillset"]');
    const adventureTab = skillsTab?.querySelector('.skillset-body .tab[data-tab="adventure"]');
    const backgroundTab = skillsTab?.querySelector('.skillset-body .tab[data-tab="background"]');
    const adventureSkills = adventureTab?.querySelectorAll('li.skill')?.length ?? 0;
    const backgroundSkills = backgroundTab?.querySelectorAll('li.skill')?.length ?? 0;
    const navLabels = skillsetNav
      ? [...skillsetNav.querySelectorAll('[data-tab]')].map((el) => el.dataset.tab)
      : [];

    return {
      skillsTabHtml: skillsTab?.innerHTML?.trim()?.length ?? 0,
      navLabels,
      adventureActive: adventureTab?.classList.contains('active') ?? false,
      adventureSkills,
      backgroundSkills,
      appraiseVisible: adventureTab?.querySelector('li.skill[data-skill="apr"]') != null,
    };
  }, sheetId);
}

test('issue #1705: background skills setting shows skills on character sheet', async ({ page }) => {
  const originalSetting = await enableBackgroundSkills(page);

  try {
    const actorId = await createCharacter(page, false);
    const sheetId = await openSheet(page, actorId);
    await openSkillsTab(page, sheetId);

    const snapshot = await getSkillsTabSnapshot(page, sheetId);

    expect(snapshot.skillsTabHtml).toBeGreaterThan(0);
    expect(snapshot.navLabels).toEqual(['adventure', 'background']);
    expect(snapshot.adventureActive).toBe(true);
    expect(snapshot.adventureSkills).toBeGreaterThan(0);
    expect(snapshot.appraiseVisible).toBe(true);
  } finally {
    await restoreBackgroundSkills(page, originalSetting);
  }
});

test('issue #1705: background skills tab is not blank when level-up progression is enabled', async ({
  page,
}) => {
  const originalSetting = await enableBackgroundSkills(page);

  try {
    const actorId = await createCharacter(page, true);
    const sheetId = await openSheet(page, actorId);
    await openSkillsTab(page, sheetId);

    const snapshot = await getSkillsTabSnapshot(page, sheetId);

    expect(snapshot.skillsTabHtml).toBeGreaterThan(0);
    expect(snapshot.navLabels).toEqual(['adventure', 'background']);
    expect(snapshot.adventureSkills).toBeGreaterThan(0);
    expect(snapshot.appraiseVisible).toBe(true);
  } finally {
    await restoreBackgroundSkills(page, originalSetting);
  }
});
