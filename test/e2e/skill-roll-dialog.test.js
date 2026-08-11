'use strict';

/**
 * Skill roll dialog: chat post, situational bonus (#1555), ability dropdown, ranks.
 * Combat-change feats (`skill`, `skillOptional`, @skillId conditions) in the same file.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld } = require('./helpers');
const { openSheet } = require('./helpers/actor-sheet');
const {
  openSkillsTab,
  clickSkillRollOnSheet,
  waitForChatAfter,
  getLastChatSkillTotal,
  closeTopWindowDialog,
  setStylizedOptionalChecked,
  embedSyntheticCombatFeat,
} = require('./helpers/skill-roll');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
});

test.describe('skill roll: sheet opens dialog and posts chat', () => {
  test('clicking a skill roll in the skills tab produces a chat message', async ({ page }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'Skill Test Actor',
        type: 'character',
        system: { abilities: { int: { value: 14 } } },
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);
    const sheet = page.locator(`#${sheetId}`);

    await page.evaluate((id) => {
      document
        .querySelector(`#${id} nav.sheet-navigation.tabs a[data-tab="skills"]`)
        ?.click();
    }, sheetId);

    await sheet.locator('.tab.skills').waitFor({ state: 'visible', timeout: 5_000 });

    const msgsBefore = await page.evaluate(() => game.messages.size);

    await page.evaluate((id) => {
      document
        .querySelector(`#${id} .tab.skills .skill-mod-total.rollable.skill-roll`)
        ?.click();
    }, sheetId);

    const rollBtn = page.locator('.dialog button[data-button="normal"]');
    await rollBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await rollBtn.click({ force: true });

    await page.waitForFunction((b) => game.messages.size > b, msgsBefore, { timeout: 5_000 });

    const newMessages = await page.evaluate((b) => game.messages.size - b, msgsBefore);
    expect(newMessages).toBeGreaterThan(0);
  });
});

test.describe('skill roll: situational bonus field (sk-bonus)', () => {
  test('consecutive Take 10 rolls do not stack situational modifiers (issue #1555)', async ({
    page,
  }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'Skill Situational Actor',
        type: 'character',
        system: { abilities: { int: { value: 14 } } },
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);
    const sheet = page.locator(`#${sheetId}`);

    await page.evaluate((id) => {
      document
        .querySelector(`#${id} nav.sheet-navigation.tabs a[data-tab="skills"]`)
        ?.click();
    }, sheetId);
    await sheet.locator('.tab.skills').waitFor({ state: 'visible', timeout: 5_000 });

    async function rollAppraiseTake10WithSkBonus(situational) {
      await page.evaluate((id) => {
        document
          .querySelector(
            `#${id} li.skill[data-skill="apr"] .skill-mod-total.rollable.skill-roll`,
          )
          ?.click();
      }, sheetId);

      const dialog = page.locator('.dialog');
      await dialog.waitFor({ state: 'visible', timeout: 5_000 });
      await dialog.locator('input[name="sk-bonus"]').fill(String(situational));
      await dialog.locator('button[data-button="takeTen"]').click({ force: true });
      await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    }

    const count0 = await page.evaluate(() => game.messages.size);
    await rollAppraiseTake10WithSkBonus(10);
    await page.waitForFunction((c) => game.messages.size > c, count0, { timeout: 5_000 });

    const total1 = await page.evaluate(() => {
      const msg = game.messages.contents.at(-1);
      return msg?.flags?.D35E?.chatTemplateData?.total ?? null;
    });

    const count1 = await page.evaluate(() => game.messages.size);
    await rollAppraiseTake10WithSkBonus(5);
    await page.waitForFunction((c) => game.messages.size > c, count1, { timeout: 5_000 });

    const total2 = await page.evaluate(() => {
      const msg = game.messages.contents.at(-1);
      return msg?.flags?.D35E?.chatTemplateData?.total ?? null;
    });

    expect(total1).not.toBeNull();
    expect(total2).not.toBeNull();
    expect(total2 - total1).toBe(-5);

    const situationalRows = await page.evaluate((id) => {
      const actor = game.actors.get(id);
      const rows = actor.sourceDetails?.['system.skills.apr.changeBonus'] ?? [];
      return rows.filter((d) => d.name === 'Situational Modifier').length;
    }, actorId);
    expect(situationalRows).toBe(0);
  });

  test('situational bonus is applied on a normal d20 roll', async ({ page }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'Skill Normal Roll Bonus',
        type: 'character',
        system: { abilities: { int: { value: 14 } } },
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);
    const sheet = page.locator(`#${sheetId}`);

    await page.evaluate((id) => {
      document
        .querySelector(`#${id} nav.sheet-navigation.tabs a[data-tab="skills"]`)
        ?.click();
    }, sheetId);
    await sheet.locator('.tab.skills').waitFor({ state: 'visible', timeout: 5_000 });

    const msgsBefore = await page.evaluate(() => game.messages.size);

    await page.evaluate((id) => {
      document
        .querySelector(
          `#${id} li.skill[data-skill="apr"] .skill-mod-total.rollable.skill-roll`,
        )
        ?.click();
    }, sheetId);

    const dialog = page.locator('.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('input[name="sk-bonus"]').fill('7');
    await dialog.locator('button[data-button="normal"]').click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });

    await page.waitForFunction((b) => game.messages.size > b, msgsBefore, { timeout: 5_000 });

    const breakdown = await page.evaluate((id) => {
      const msg = game.messages.contents.at(-1);
      const total = msg?.flags?.D35E?.chatTemplateData?.total ?? null;
      const roll =
        msg?.rolls?.[0] || msg?.flags?.D35E?.chatTemplateData?.roll || null;
      let d20 = null;
      for (const term of roll?.terms || []) {
        if (term.faces !== 20 || !term.results?.length) continue;
        const res = term.results.find((r) => r.active !== false) || term.results[0];
        if (res?.result != null) d20 = res.result;
        break;
      }
      const rollTotal = roll?.total ?? null;
      const formula = String(roll?.formula ?? '');
      return {
        total,
        d20,
        rollTotal,
        formula,
        flagMatchesRoll: total != null && rollTotal != null && total === rollTotal,
        formulaIncludesSitBonus: /\+\s*7\b/.test(formula),
      };
    }, actorId);

    expect(breakdown.total).not.toBeNull();
    expect(breakdown.d20).not.toBeNull();
    expect(breakdown.flagMatchesRoll).toBe(true);
    expect(breakdown.formulaIncludesSitBonus).toBe(true);

    const situationalRows = await page.evaluate((id) => {
      const actor = game.actors.get(id);
      const rows = actor.sourceDetails?.['system.skills.apr.changeBonus'] ?? [];
      return rows.filter((d) => d.name === 'Situational Modifier').length;
    }, actorId);
    expect(situationalRows).toBe(0);
  });
});

test.describe('skill roll: ability dropdown', () => {
  test('selecting another ability changes the Take 10 total by the ability mod delta', async ({
    page,
  }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'Skill Ability Swap',
        type: 'character',
        system: {
          abilities: {
            str: { value: 10 },
            dex: { value: 10 },
            con: { value: 10 },
            int: { value: 10 },
            wis: { value: 10 },
            cha: { value: 18 },
          },
        },
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);
    await openSkillsTab(page, sheetId);

    let n = await page.evaluate(() => game.messages.size);
    await clickSkillRollOnSheet(page, sheetId, 'apr');
    let dialog = page.locator('.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('button[data-button="takeTen"]').click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    await waitForChatAfter(page, n);
    const totalInt = await getLastChatSkillTotal(page);

    n = await page.evaluate(() => game.messages.size);
    await clickSkillRollOnSheet(page, sheetId, 'apr');
    dialog = page.locator('.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('select[name="ability"]').selectOption('cha');
    await dialog.locator('button[data-button="takeTen"]').click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    await waitForChatAfter(page, n);
    const totalCha = await getLastChatSkillTotal(page);

    expect(totalInt).not.toBeNull();
    expect(totalCha).not.toBeNull();
    expect(totalCha - totalInt).toBe(4);
  });
});

test.describe('skill roll: ranks', () => {
  test('increasing climb ranks increases Take 10 by the rank delta', async ({ page }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'Skill Ranks Actor',
        type: 'character',
        system: { abilities: { str: { value: 10 } } },
      });
      await game.actors.get(actor.id).update({
        'system.skills.clm.points': 0,
        'system.skills.clm.cls': true,
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);
    await openSkillsTab(page, sheetId);

    let n = await page.evaluate(() => game.messages.size);
    await clickSkillRollOnSheet(page, sheetId, 'clm');
    let dialog = page.locator('.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('button[data-button="takeTen"]').click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    await waitForChatAfter(page, n);
    const total0 = await getLastChatSkillTotal(page);

    await page.evaluate(async (id) => {
      await game.actors.get(id).update({ 'system.skills.clm.points': 5 });
    }, actorId);

    n = await page.evaluate(() => game.messages.size);
    await clickSkillRollOnSheet(page, sheetId, 'clm');
    dialog = page.locator('.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('button[data-button="takeTen"]').click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    await waitForChatAfter(page, n);
    const total5 = await getLastChatSkillTotal(page);

    expect(total0).not.toBeNull();
    expect(total5).not.toBeNull();
    expect(total5 - total0).toBe(5);
  });
});

test.describe('combat change itemType skill + featSkillBonus', () => {
  test('adds to Take 10 when the change has no condition', async ({ page }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'E2E Skill CC no cond',
        type: 'character',
        system: { abilities: { int: { value: 10 } } },
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);
    await openSkillsTab(page, sheetId);

    let n = await page.evaluate(() => game.messages.size);
    await clickSkillRollOnSheet(page, sheetId, 'apr');
    let dialog = page.locator('.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('button[data-button="takeTen"]').click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    await waitForChatAfter(page, n);
    const base = await getLastChatSkillTotal(page);

    await embedSyntheticCombatFeat(page, {
      actorId,
      name: 'E2E +6 appraise (no condition)',
      combatChanges: [['skill', '', '', 'featSkillBonus', '6', '']],
    });

    n = await page.evaluate(() => game.messages.size);
    await clickSkillRollOnSheet(page, sheetId, 'apr');
    dialog = page.locator('.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('button[data-button="takeTen"]').click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    await waitForChatAfter(page, n);
    const withFeat = await getLastChatSkillTotal(page);

    expect(base).not.toBeNull();
    expect(withFeat).not.toBeNull();
    expect(withFeat - base).toBe(6);
  });

  test('does not add to Take 10 when @skillId condition does not match', async ({ page }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'E2E Skill CC mismatch',
        type: 'character',
        system: { abilities: { int: { value: 10 }, con: { value: 10 } } },
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);
    await openSkillsTab(page, sheetId);

    let n = await page.evaluate(() => game.messages.size);
    await clickSkillRollOnSheet(page, sheetId, 'coc');
    let dialog = page.locator('.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('button[data-button="takeTen"]').click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    await waitForChatAfter(page, n);
    const baseCoc = await getLastChatSkillTotal(page);

    await embedSyntheticCombatFeat(page, {
      actorId,
      name: 'E2E +99 appraise only (@skillId===apr)',
      combatChanges: [
        ['skill', '', "'@skillId'==='apr'", 'featSkillBonus', '99', ''],
      ],
    });

    n = await page.evaluate(() => game.messages.size);
    await clickSkillRollOnSheet(page, sheetId, 'coc');
    dialog = page.locator('.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('button[data-button="takeTen"]').click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    await waitForChatAfter(page, n);
    const cocWithAprFeat = await getLastChatSkillTotal(page);

    expect(baseCoc).not.toBeNull();
    expect(cocWithAprFeat).not.toBeNull();
    expect(cocWithAprFeat).toBe(baseCoc);
  });
});

test.describe('combat change itemType skillOptional + featSkillBonus', () => {
  test('adds to Take 10 only when the optional checkbox is toggled (no condition)', async ({
    page,
  }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'E2E Skill Opt empty',
        type: 'character',
        system: { abilities: { con: { value: 10 } } },
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);

    await embedSyntheticCombatFeat(page, {
      actorId,
      name: 'E2E Optional +4 (no condition)',
      combatChanges: [['skillOptional', '', '', 'featSkillBonus', '4', '']],
    });

    await openSkillsTab(page, sheetId);

    let n = await page.evaluate(() => game.messages.size);
    await clickSkillRollOnSheet(page, sheetId, 'coc');
    let dialog = page.locator('.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('button[data-button="takeTen"]').click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    await waitForChatAfter(page, n);
    const withoutOpt = await getLastChatSkillTotal(page);

    n = await page.evaluate(() => game.messages.size);
    await clickSkillRollOnSheet(page, sheetId, 'coc');
    dialog = page.locator('.dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('input[data-type="optional"]').first()
      .waitFor({ state: 'attached', timeout: 5_000 });
    await setStylizedOptionalChecked(page, true);
    await dialog.locator('button[data-button="takeTen"]').click({ force: true });
    await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    await waitForChatAfter(page, n);
    const withOpt = await getLastChatSkillTotal(page);

    expect(withoutOpt).not.toBeNull();
    expect(withOpt).not.toBeNull();
    expect(withOpt - withoutOpt).toBe(4);
  });

  test('no optional row on Appraise when skillOptional is gated to Concentration (@skillId)', async ({
    page,
  }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'E2E Opt vis apr',
        type: 'character',
        system: { abilities: { int: { value: 10 } } },
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);

    await embedSyntheticCombatFeat(page, {
      actorId,
      name: 'E2E Optional coc-only',
      combatChanges: [
        ['skillOptional', '', "'@skillId'==='coc'", 'featSkillBonus', '1', ''],
      ],
    });

    await openSkillsTab(page, sheetId);

    await clickSkillRollOnSheet(page, sheetId, 'apr');
    await page.locator('.window-app.dialog').last().waitFor({ state: 'visible', timeout: 5_000 });
    const count = await page
      .locator('.window-app.dialog')
      .last()
      .locator('input[data-type="optional"]')
      .count();
    await closeTopWindowDialog(page);

    expect(count).toBe(0);
  });

  test('optional row on Concentration when skillOptional matches @skillId', async ({ page }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'E2E Opt vis coc',
        type: 'character',
        system: { abilities: { con: { value: 10 } } },
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);

    await embedSyntheticCombatFeat(page, {
      actorId,
      name: 'E2E Optional coc-only',
      combatChanges: [
        ['skillOptional', '', "'@skillId'==='coc'", 'featSkillBonus', '1', ''],
      ],
    });

    await openSkillsTab(page, sheetId);

    await clickSkillRollOnSheet(page, sheetId, 'coc');
    await page.locator('.window-app.dialog').last().waitFor({ state: 'visible', timeout: 5_000 });
    const count = await page
      .locator('.window-app.dialog')
      .last()
      .locator('input[data-type="optional"]')
      .count();
    await closeTopWindowDialog(page);

    expect(count).toBe(1);
  });
});

/** Craft / Perform / Profession — GitLab #1644 (legacy PF1e `art`/`lor` stay in config but are not covered here). */
const ARBITRARY_SKILL_PARENTS = ['crf', 'prf', 'pro'];

test.describe('arbitrary sub-skill: character sheet (+)', () => {
  for (const skillKey of ARBITRARY_SKILL_PARENTS) {
    test(`clicking + adds a sub-skill under ${skillKey} (issue #1644)`, async ({ page }) => {
      const actorId = await page.evaluate(async (sk) => {
        const actor = await Actor.create({
          name: `Sub-skill ${sk}`,
          type: 'character',
          system: { abilities: { int: { value: 14 } } },
        });
        return actor.id;
      }, skillKey);

      const sheetId = await openSheet(page, actorId);
      const sheet = page.locator(`#${sheetId}`);

      await openSkillsTab(page, sheetId);

      const subRows = sheet.locator(`.tab.skills li.sub-skill[data-main-skill="${skillKey}"]`);
      const before = await subRows.count();

      await page.evaluate(
        ({ id, sk }) => {
          document
            .querySelector(`#${id} .tab.skills .skill.arbitrary[data-skill="${sk}"] .skill-create`)
            ?.click();
        },
        { id: sheetId, sk: skillKey },
      );

      await expect(subRows).toHaveCount(before + 1, { timeout: 5_000 });

      const tag = await page.evaluate(
        ({ id, sk }) => {
          const el = document.querySelector(
            `#${id} .tab.skills li.sub-skill[data-main-skill="${sk}"]`,
          );
          return el?.getAttribute('data-skill');
        },
        { id: sheetId, sk: skillKey },
      );
      expect(tag).toMatch(new RegExp(`^${skillKey}\\d+$`));

      const stored = await page.evaluate(
        ({ aid, sk }) => {
          const a = game.actors.get(aid);
          return a.system.skills[sk]?.subSkills;
        },
        { aid: actorId, sk: skillKey },
      );
      expect(stored).toBeTruthy();
      expect(Object.keys(stored).length).toBeGreaterThan(0);
    });
  }
});
