'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test('card-deck preparation localizes the deck spellcasting type', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Deck Sheet Safety Actor', type: 'character' });
    await actor.update({
      'system.attributes.cards.decks.primary.spellcastingType': 'arcane',
    });

    const sheetData = await actor.sheet.getData();
    return {
      actual: sheetData.deckData.primary.spellcastingTypeName,
      expected: game.i18n.localize(CONFIG.D35E.spellcastingType.arcane),
    };
  });

  expect(result.actual).toBe(result.expected);
});

test('restoring a prepared spell reads its actor spellbook', async ({ page }) => {
  const preparedAmount = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Spell Recharge Safety Actor', type: 'character' });
    const [spell] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Prepared Recharge Test',
      type: 'spell',
      system: {
        spellbook: 'primary',
        preparation: {
          mode: 'prepared',
          preparedAmount: 0,
          maxAmount: 1,
        },
        uses: { value: 0, max: 0 },
      },
    }]);

    const originalConfirm = Dialog.confirm;
    Dialog.confirm = ({ yes }) => yes();
    try {
      actor.sheet._onItemRestoreUses({
        preventDefault() {},
        currentTarget: {
          disabled: false,
          closest: () => ({ dataset: { itemId: spell.id } }),
        },
      });
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const amount = actor.items.get(spell.id)?.system.preparation.preparedAmount;
        if (amount === 1) return amount;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return actor.items.get(spell.id)?.system.preparation.preparedAmount;
    } finally {
      Dialog.confirm = originalConfirm;
    }
  });

  expect(preparedAmount).toBe(1);
});
