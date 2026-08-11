'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs, ensureCanvasReady } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test('creating a measured template tracks its id for first refresh handling', async ({ page }) => {
  await ensureCanvasReady(page);

  const tracked = await page.evaluate(async () => {
    game.D35E.createdMeasureTemplates.clear();
    const scene = canvas.scene;
    if (!scene) throw new Error('canvas scene missing');

    const [template] = await scene.createEmbeddedDocuments('MeasuredTemplate', [{
      t: 'circle',
      author: game.user.id,
      distance: 20,
      x: 200,
      y: 200,
      fillColor: '#ff0000',
    }]);

    return {
      templateId: template.id,
      tracked: game.D35E.createdMeasureTemplates.has(template.id),
    };
  });

  expect(tracked.templateId).toBeTruthy();
  expect(tracked.tracked).toBe(true);
});

test('ability template preview places a circle without deprecated grid API errors', async ({ page }) => {
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push(msg.text()));

  await ensureCanvasReady(page);

  await page.evaluate(async () => {
    await canvas.scene.deleteEmbeddedDocuments('MeasuredTemplate', canvas.scene.templates.map(t => t.id));
    const { default: AbilityTemplate } = await import('/systems/warcraftrpg2e/module/pixi/ability-template.js');
    const actor = await Actor.create({ name: 'Template Preview Actor', type: 'character' });
    const [item] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Template Preview Spell',
      type: 'spell',
      system: {
        measureTemplate: {
          type: 'circle',
          size: '20',
        },
      },
    }]);

    const template = AbilityTemplate.fromItem({ item });
    if (!template) throw new Error('AbilityTemplate.fromItem returned null');
    window.__d35eTemplatePreview = template.drawPreview();
  });

  const canvasBox = await page.evaluate(() => {
    const rect = canvas.app.view.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });

  await page.mouse.move(canvasBox.x + 260, canvasBox.y + 260);
  await page.waitForTimeout(80);
  await page.mouse.click(canvasBox.x + 260, canvasBox.y + 260);

  const placed = await page.evaluate(async () => {
    const result = await window.__d35eTemplatePreview;
    if (!result.result) return { result: false };
    const doc = await result.place();
    return {
      result: true,
      id: doc.id,
      x: doc.x,
      y: doc.y,
      t: doc.t,
      distance: doc.distance,
      templateCount: canvas.scene.templates.size,
    };
  });

  expect(placed.result).toBe(true);
  expect(placed.id).toBeTruthy();
  expect(Number.isFinite(placed.x)).toBe(true);
  expect(Number.isFinite(placed.y)).toBe(true);
  expect(placed.t).toBe('circle');
  expect(placed.distance).toBe(20);
  expect(placed.templateCount).toBe(1);
  expect(consoleMessages.join('\n')).not.toContain('getSnappedPosition');
  expect(consoleMessages.join('\n')).not.toContain('getHighlightLayer');
});

test('PF measure style finds tokens within highlighted template squares', async ({ page }) => {
  await ensureCanvasReady(page);

  const result = await page.evaluate(async () => {
    await game.settings.set('warcraftrpg2e', 'measureStyle', true);
    const actor = await Actor.create({ name: 'Template Target', type: 'character' });
    await canvas.scene.createEmbeddedDocuments('Token', [{
      name: 'Template Target Token',
      actorId: actor.id,
      x: 200,
      y: 200,
      width: 1,
      height: 1,
    }]);
    const [templateDoc] = await canvas.scene.createEmbeddedDocuments('MeasuredTemplate', [{
      t: 'circle',
      author: game.user.id,
      distance: 20,
      x: 200,
      y: 200,
      fillColor: '#ff0000',
    }]);

    const template = new CONFIG.MeasuredTemplate.objectClass(templateDoc);
    await template.draw();
    template._refreshShape();
    template.refresh();
    const tokens = template.getTokensWithin();
    return {
      tokenNames: tokens.map(t => t.name),
      highlightedSquares: template.getHighlightedSquares().length,
    };
  });

  expect(result.highlightedSquares).toBeGreaterThan(0);
  expect(result.tokenNames).toContain('Template Target Token');
});
