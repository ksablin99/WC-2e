'use strict';

/**
 * Grapple (CMB) roll from the character sheet — regression for issue #1622
 * (v13 async Roll.roll() must be awaited before getTooltip / chat).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { openSheet } = require('./helpers/actor-sheet');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test.describe('grapple roll (CMB)', () => {
  test('Combat tab CMB header opens dialog and posts grapple chat with a evaluated roll', async ({
    page,
  }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'Grapple E2E Actor',
        type: 'character',
        system: { abilities: { str: { value: 14 } } },
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);
    const sheet = page.locator(`#${sheetId}`);

    await page.evaluate((id) => {
      document
        .querySelector(`#${id} nav.sheet-navigation.tabs a[data-tab="attacks"]`)
        ?.click();
    }, sheetId);
    await sheet.locator('.tab.attacks').waitFor({ state: 'visible', timeout: 5_000 });

    const msgsBefore = await page.evaluate(() => game.messages.size);

    await page.evaluate((id) => {
      document
        .querySelector(`#${id} .tab.attacks .attribute.cmb .attribute-name`)
        ?.click();
    }, sheetId);

    const dialog = page.locator('.window-app.dialog').last();
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    const rollBtn = dialog.locator('button[data-button="normal"]');
    await rollBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await rollBtn.click({ force: true });

    await page.waitForFunction((b) => game.messages.size > b, msgsBefore, { timeout: 15_000 });

    const payload = await page.evaluate(() => {
      const msg = game.messages.contents.at(-1);
      const template = msg?.flags?.D35E?.template ?? '';
      const td = msg?.flags?.D35E?.chatTemplateData ?? {};
      // Custom grapple cards use createCustomChatMessage; rolls are not stored on
      // ChatMessage.rolls (only used for Dice So Nice). The evaluated roll lives
      // on flags.D35E.chatTemplateData.roll.
      const roll = td.roll ?? null;
      return {
        template,
        total: td.total ?? null,
        rollTotal: roll?.total ?? null,
        hasDiceTerms: (roll?.terms?.length ?? 0) > 0,
        contentHasDiceRoll: String(msg?.content ?? '').includes('dice-roll'),
        tooltipInContent: String(msg?.content ?? '').includes('dice-tooltip'),
      };
    });

    expect(payload.template).toContain('grapple.html');
    expect(payload.total).not.toBeNull();
    expect(payload.rollTotal).not.toBeNull();
    expect(payload.total).toBe(payload.rollTotal);
    expect(payload.hasDiceTerms).toBe(true);
    expect(payload.contentHasDiceRoll).toBe(true);
    expect(payload.tooltipInContent).toBe(true);
  });

  test('grapple manual bonus field is reflected in the rolled formula', async ({ page }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'Grapple Bonus Actor',
        type: 'character',
        system: { abilities: { str: { value: 10 } } },
      });
      return actor.id;
    });

    const sheetId = await openSheet(page, actorId);
    const sheet = page.locator(`#${sheetId}`);

    await page.evaluate((id) => {
      document
        .querySelector(`#${id} nav.sheet-navigation.tabs a[data-tab="attacks"]`)
        ?.click();
    }, sheetId);
    await sheet.locator('.tab.attacks').waitFor({ state: 'visible', timeout: 5_000 });

    const msgsBefore = await page.evaluate(() => game.messages.size);

    await page.evaluate((id) => {
      document
        .querySelector(`#${id} .tab.attacks .attribute.cmb .attribute-name`)
        ?.click();
    }, sheetId);

    const dialog = page.locator('.window-app.dialog').last();
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });
    await dialog.locator('input[name="gr-bonus"]').fill('5');
    await dialog.locator('button[data-button="normal"]').click({ force: true });

    await page.waitForFunction((b) => game.messages.size > b, msgsBefore, { timeout: 15_000 });

    const breakdown = await page.evaluate(() => {
      const msg = game.messages.contents.at(-1);
      const roll = msg?.flags?.D35E?.chatTemplateData?.roll ?? null;
      const formula = String(roll?.formula ?? '');
      return {
        formula,
        formulaHasManualBonus: /\+\s*5\b/.test(formula),
        total: roll?.total ?? null,
      };
    });

    expect(breakdown.total).not.toBeNull();
    expect(breakdown.formulaHasManualBonus).toBe(true);
  });
});
