'use strict';

/**
 * Turn Undead — regression for issue #1623
 * (v13 async Roll.roll() must be awaited before getTooltip / chat).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test.describe('turn undead roll', () => {
  test('rollTurnUndead posts chat with evaluated rolls and tooltips', async ({ page }) => {
    const actorId = await page.evaluate(async () => {
      const actor = await Actor.create({
        name: 'Turn Undead E2E Actor',
        type: 'character',
        system: { abilities: { cha: { value: 14 } } },
      });
      await actor.createEmbeddedDocuments('Item', [
        {
          name: 'E2E Cleric',
          type: 'class',
          system: {
            levels: 1,
            hd: 8,
            bab: 'medium',
            turnUndeadLevelFormula: '5',
          },
        },
      ]);
      const a = game.actors.get(actor.id);
      return { id: actor.id, hdTotal: a.system.attributes.turnUndeadHdTotal };
    });

    expect(actorId.hdTotal).toBeGreaterThanOrEqual(1);

    const msgsBefore = await page.evaluate(() => game.messages.size);

    await page.evaluate(async (id) => {
      const a = game.actors.get(id);
      await a.rollTurnUndead();
    }, actorId.id);

    await page.waitForFunction((b) => game.messages.size > b, msgsBefore, { timeout: 15_000 });

    const payload = await page.evaluate(() => {
      const msg = game.messages.contents.at(-1);
      const template = msg?.flags?.warcraftrpg2e?.template ?? '';
      const td = msg?.flags?.warcraftrpg2e?.chatTemplateData ?? {};
      const maxR = td.maxHDResult;
      const dmg = td.damageHD;
      const content = String(msg?.content ?? '');
      return {
        template,
        maxTotal: typeof maxR?.total === 'number' ? maxR.total : null,
        damageTotal: typeof dmg?.total === 'number' ? dmg.total : null,
        contentHasDiceRoll: content.includes('dice-roll'),
        // Foundry tooltip.hbs omits the wrapper when there are no dice parts; card still shows flavor + totals.
        contentHasTurnCard: content.includes('Maximum HD') && content.includes('HD Turned'),
      };
    });

    expect(payload.template).toContain('turn-undead.html');
    expect(payload.maxTotal).not.toBeNull();
    expect(payload.damageTotal).not.toBeNull();
    expect(payload.contentHasDiceRoll).toBe(true);
    expect(payload.contentHasTurnCard).toBe(true);
  });
});
