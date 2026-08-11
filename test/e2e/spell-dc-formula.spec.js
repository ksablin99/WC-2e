'use strict';

/**
 * E2E tests for spell save DC formula: DC = 10 + spell level + spellcasting ability modifier.
 *
 * Covers:
 *   1. Wizard INT 20 (+5), 3rd-level spell  → DC 18
 *   2. Wizard INT 12 (+1), 1st-level spell  → DC 12
 *   3. Wizard INT 16 (+3), 2nd-level spell  → DC 15
 *
 * The DC is computed in getChatData() via spellbook.baseDCFormula = "10 + @sl + @ablMod"
 * where @sl = spell level and @ablMod = spellcasting ability modifier.
 * The item's save.dc field (default "0") adds on top of that formula.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const WIZARD_ID    = 'VwVlbNYqDgMBIWhQ';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: create a Wizard actor with the given INT score ───────────────────

async function createWizardActor(page, { intScore, name = 'DC Formula Test Wizard' } = {}) {
  return page.evaluate(async ({ classesPack, wizardId, intScore, name }) => {
    // Step 1: create minimal actor
    const actor = await Actor.create({ name, type: 'character' });

    // Step 2: set INT score via update (bypasses init overrides)
    await game.actors.get(actor.id).update({
      'system.abilities.int.value': intScore,
    });

    // Step 3: add Wizard class at level 5 so the spellbook auto-initialises
    const pack = game.packs.get(classesPack);
    const cls  = await pack.getDocument(wizardId);
    const clsData = cls.toObject();
    clsData.system.levels = 5;
    await game.actors.get(actor.id).createEmbeddedDocuments('Item', [clsData]);

    // Step 4: link the primary spellbook to the wizard class (triggers autoSetup:
    // copies spellcastingAbility='int' and baseDCFormula="10 + @sl + @ablMod")
    await game.actors.get(actor.id).update({
      'system.attributes.spells.spellbooks.primary.class': 'wizard',
    });

    return actor.id;
  }, { classesPack: CLASSES_PACK, wizardId: WIZARD_ID, intScore, name });
}

// ── Helper: add a bare spell to the actor and return its item id ─────────────

async function addTestSpell(page, actorId, { spellLevel, spellName = 'Test Spell' } = {}) {
  return page.evaluate(async ({ actorId, spellLevel, spellName }) => {
    // Create with name+type only
    const [item] = await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: spellName,
      type: 'spell',
    }]);

    // Then update fields separately (avoids init overrides)
    await game.actors.get(actorId).items.get(item.id).update({
      'system.spellbook': 'primary',
      'system.level': spellLevel,
      // save.type must be set so getChatData() includes the DC in props
      'system.save.type': 'willnegates',
      // save.dc = "0" so DC = 0 + baseDCFormula = 10 + sl + ablMod
      'system.save.dc': '0',
      // actionType is required for getChatData() to evaluate the save block
      'system.actionType': 'msak',
    });

    return item.id;
  }, { actorId, spellLevel, spellName });
}

// ── Helper: call getChatData() on the spell and return the DC numeric value ───

async function getSpellDC(page, actorId, spellItemId) {
  return page.evaluate(async ({ actorId, spellItemId }) => {
    const actor = game.actors.get(actorId);
    const spell = actor.items.get(spellItemId);
    const data  = await spell.getChatData();
    const props = data.properties ?? [];
    // props contains strings like "DC 18", "Will negates", etc.
    const dcProp = props.find(p => typeof p === 'string' && /^DC \d+/.test(p));
    if (!dcProp) return null;
    return parseInt(dcProp.replace('DC ', ''), 10);
  }, { actorId, spellItemId });
}

// ── 1. INT 20 (+5), 3rd-level spell → DC 18 ──────────────────────────────────

test('spell DC: INT 20 (+5) + 3rd-level spell = DC 18', async ({ page }) => {
  const actorId   = await createWizardActor(page, { intScore: 20 });
  const spellId   = await addTestSpell(page, actorId, { spellLevel: 3 });

  const dc = await getSpellDC(page, actorId, spellId);

  expect(dc, `Expected DC 18 (10 + 3 + 5) but got ${dc}`).toBe(18);
});

// ── 2. INT 12 (+1), 1st-level spell → DC 12 ──────────────────────────────────

test('spell DC: INT 12 (+1) + 1st-level spell = DC 12', async ({ page }) => {
  const actorId   = await createWizardActor(page, { intScore: 12 });
  const spellId   = await addTestSpell(page, actorId, { spellLevel: 1 });

  const dc = await getSpellDC(page, actorId, spellId);

  expect(dc, `Expected DC 12 (10 + 1 + 1) but got ${dc}`).toBe(12);
});

// ── 3. INT 16 (+3), 2nd-level spell → DC 15 ──────────────────────────────────

test('spell DC: INT 16 (+3) + 2nd-level spell = DC 15', async ({ page }) => {
  const actorId   = await createWizardActor(page, { intScore: 16 });
  const spellId   = await addTestSpell(page, actorId, { spellLevel: 2 });

  const dc = await getSpellDC(page, actorId, spellId);

  expect(dc, `Expected DC 15 (10 + 2 + 3) but got ${dc}`).toBe(15);
});
