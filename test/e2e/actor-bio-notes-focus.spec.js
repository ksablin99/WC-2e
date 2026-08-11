'use strict';

/**
 * E2E regression tests for issue #1701.
 *
 * Reproduces the risky path where the focused element is inside a ProseMirror
 * editor (no own `name`) and a sheet re-render happens while saving bio/notes.
 * The sheet must not throw `focus.name ... match` errors or become non-interactive.
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

async function openActorSheet(page, actorType, name) {
  const actorId = await page.evaluate(async ({ actorType, name }) => {
    const actor = await Actor.create({ name, type: actorType });
    return actor.id;
  }, { actorType, name });

  const sheetId = await openSheet(page, actorId);
  return { actorId, sheetId };
}

async function saveRichTextFieldWithFocusedEditor(page, { actorId, sheetId, tab, fieldPath, value }) {
  // ── 1. Focus rich-text editor with an element that has no name ─────────────
  await page.locator(`#${sheetId} nav.sheet-navigation.tabs a[data-tab="${tab}"]`).click({ force: true });
  await page.locator(`#${sheetId} .tab[data-tab="${tab}"]`).waitFor({ state: 'visible', timeout: 8_000 });

  const focusState = await page.evaluate(({ sheetId, fieldPath }) => {
    const root = document.getElementById(sheetId);
    const editorContent = root?.querySelector(`.editor-content[data-edit="${fieldPath}"]`);
    if (!editorContent) throw new Error(`Editor content not found for ${fieldPath}`);
    if (!editorContent.hasAttribute('tabindex')) editorContent.setAttribute('tabindex', '-1');
    editorContent.focus();
    const active = document.activeElement;
    return {
      focused: editorContent === active || editorContent.contains(active),
      activeElementName: active?.name ?? null,
    };
  }, { sheetId, fieldPath });
  expect(focusState.focused).toBeTruthy();
  expect(focusState.activeElementName).toBeNull();

  // ── 2. Trigger actor update (sheet re-render path) while editor is focused ─
  await page.evaluate(async ({ actorId, fieldPath, value }) => {
    const actor = game.actors.get(actorId);
    await actor.update({ [fieldPath]: value });
  }, { actorId, fieldPath, value });

  await page.waitForFunction(
    ({ actorId, fieldPath, value }) => {
      const actor = game.actors.get(actorId);
      return foundry.utils.getProperty(actor, fieldPath) === value;
    },
    { actorId, fieldPath, value },
    { timeout: 8_000 }
  );
}

test('character biography save keeps sheet interactive and error-free', async ({ page }) => {
  // ── 1. Collect browser/runtime errors for regression signal ────────────────
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  const { actorId, sheetId } = await openActorSheet(page, 'character', 'Issue 1701 Character');
  const newText = `Character biography ${Date.now()}`;

  // ── 2. Reproduce save while no-name editor element is focused ──────────────
  await saveRichTextFieldWithFocusedEditor(page, {
    actorId,
    sheetId,
    tab: 'biography',
    fieldPath: 'system.details.biography.value',
    value: newText,
  });

  const stored = await page.evaluate((actorId) => game.actors.get(actorId).system.details.biography.value, actorId);
  expect(stored).toContain(newText);
  await expect(
    page.locator(`#${sheetId} .editor-content[data-edit="system.details.biography.value"]`)
  ).toContainText(newText);

  // ── 3. Sheet should remain interactive after save/re-render ────────────────
  await page.locator(`#${sheetId} nav.sheet-navigation.tabs a[data-tab="notes"]`).click({ force: true });
  await page.locator(`#${sheetId} .tab[data-tab="notes"]`).waitFor({ state: 'visible', timeout: 8_000 });

  const allErrors = [...consoleErrors, ...pageErrors].join('\n');
  expect(allErrors).not.toMatch(/focus\.name|match.*undefined|ActorSheetPFCharacter/i);
});

test('npc notes save keeps sheet interactive and error-free', async ({ page }) => {
  // ── 1. Collect browser/runtime errors for regression signal ────────────────
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  const { actorId, sheetId } = await openActorSheet(page, 'npc', 'Issue 1701 NPC');
  const newText = `NPC notes ${Date.now()}`;

  // ── 2. Reproduce save while no-name editor element is focused ──────────────
  await saveRichTextFieldWithFocusedEditor(page, {
    actorId,
    sheetId,
    tab: 'notes',
    fieldPath: 'system.details.notes.value',
    value: newText,
  });

  const stored = await page.evaluate((actorId) => game.actors.get(actorId).system.details.notes.value, actorId);
  expect(stored).toContain(newText);
  await expect(
    page.locator(`#${sheetId} .editor-content[data-edit="system.details.notes.value"]`)
  ).toContainText(newText);

  // ── 3. Sheet should remain interactive after save/re-render ────────────────
  await page.locator(`#${sheetId} nav.sheet-navigation.tabs a[data-tab="biography"]`).click({ force: true });
  await page.locator(`#${sheetId} .tab[data-tab="biography"]`).waitFor({ state: 'visible', timeout: 8_000 });

  const allErrors = [...consoleErrors, ...pageErrors].join('\n');
  expect(allErrors).not.toMatch(/focus\.name|match.*undefined|ActorSheetPFCharacter/i);
});
