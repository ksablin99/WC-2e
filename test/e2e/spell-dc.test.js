'use strict';

/**
 * E2E tests for spell save DC display in chat (issue 1515).
 *
 * Bug: when save.type is set to a real save type (e.g. "reflexhalf") but
 * save.description still holds "None" (a leftover from Custom mode), the DC
 * was not shown in the chat card because the guard checked description !== "None"
 * without first considering whether save.type overrides it.
 *
 * Covers:
 *   1. Regression: spell with save.type set + description="None" → DC appears in chat props.
 *   2. SRD regression: Soften Earth and Stone already ships in this exact broken state
 *      (save.type="reflexpartial", save.description="None") — DC must appear.
 *   3. Formula DC offset: Blasphemy has save.dc="+4" — computed DC must exceed base by 4.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const WIZARD_ID    = 'VwVlbNYqDgMBIWhQ';
const SPELLS_PACK  = 'warcraftrpg2e.spells';

// SRD spell IDs
const FIREBALL_ID               = 'D1KgQc1fRyoNPNwY';
const SOFTEN_EARTH_AND_STONE_ID = 'cMCSfalW7JslC1T2';
const BLASPHEMY_ID              = 'dJP4aTjLuNrPX0sW';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: wizard actor with INT 18 and a linked primary spellbook ──────────

async function createWizard(page, { name = 'DC Test Wizard', intScore = 18 } = {}) {
  return page.evaluate(async ({ classesPack, wizardId, name, intScore }) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      system: { abilities: { int: { value: intScore } } },
    });
    const cls = await game.packs.get(classesPack).getDocument(wizardId);
    const clsData = cls.toObject();
    clsData.system.levels = 5;
    await game.actors.get(actor.id).createEmbeddedDocuments('Item', [clsData]);
    await game.actors.get(actor.id).update({
      'system.attributes.spells.spellbooks.primary.class': 'wizard',
    });
    return actor.id;
  }, { classesPack: CLASSES_PACK, wizardId: WIZARD_ID, name, intScore });
}

// ── Helper: add a spell from the pack to the actor's primary spellbook ───────

async function addSpell(page, actorId, spellId) {
  return page.evaluate(async ({ spellsPack, spellId, actorId }) => {
    const spell = await game.packs.get(spellsPack).getDocument(spellId);
    const data  = spell.toObject();
    data.system.spellbook = 'primary';
    const [created] = await game.actors.get(actorId).createEmbeddedDocuments('Item', [data]);
    return created.id;
  }, { spellsPack: SPELLS_PACK, spellId, actorId });
}

// ── Helper: extract the flat properties array from the last chat message ─────

async function getLastMessageProps(page) {
  return page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    const tplData = msg?.flags?.warcraftrpg2e?.chatTemplateData;
    if (!tplData) return [];
    // properties is an array of { header, value: string[] } groups
    return (tplData.properties ?? []).flatMap(g => g.value ?? []);
  });
}

// ── Helper: call getChatData() on an actor's spell and return properties ──────

async function getSpellChatProps(page, actorId, spellItemId) {
  return page.evaluate(async ({ actorId, spellItemId }) => {
    const actor = game.actors.get(actorId);
    const spell = actor.items.get(spellItemId);
    const data  = await spell.getChatData();
    return data.properties ?? [];
  }, { actorId, spellItemId });
}

// ── 1. Issue 1515 regression — save.type set + description="None" → DC shown ─

test('GL#1515 DC shown when save.type is set and save.description is "None"', async ({ page }) => {
  const actorId  = await createWizard(page);
  const spellItemId = await addSpell(page, actorId, FIREBALL_ID);

  // Reproduce the bug state: custom field was "None", user switched dropdown to reflexhalf
  await page.evaluate(({ actorId, spellItemId }) => {
    const spell = game.actors.get(actorId).items.get(spellItemId);
    return spell.update({
      'system.save.type':        'reflexhalf',
      'system.save.description': 'None',
    });
  }, { actorId, spellItemId });

  const props = await getSpellChatProps(page, actorId, spellItemId);

  const dcProp   = props.find(p => /^DC \d+/.test(p));
  const typeProp = props.find(p => p && p.length > 0 && p !== 'None');

  expect(dcProp,   'DC should appear in chat properties').toBeTruthy();
  expect(typeProp, 'save type label should appear in chat properties').toBeTruthy();
});

// ── 2. SRD spell in exact broken state: Soften Earth and Stone ───────────────

test('GL#1515 Soften Earth and Stone (save.type=reflexpartial, desc=None) shows DC', async ({ page }) => {
  const actorId     = await createWizard(page);
  const spellItemId = await addSpell(page, actorId, SOFTEN_EARTH_AND_STONE_ID);

  // Verify the SRD item is still in the broken state (save.type set, description="None")
  const saveData = await page.evaluate(({ actorId, spellItemId }) => {
    const spell = game.actors.get(actorId).items.get(spellItemId);
    return { type: spell.system.save.type, description: spell.system.save.description };
  }, { actorId, spellItemId });

  expect(saveData.type,        'spell should have a real save type').toBeTruthy();
  expect(saveData.description, 'spell description should be None').toBe('None');

  const props   = await getSpellChatProps(page, actorId, spellItemId);
  const dcProp  = props.find(p => /^DC \d+/.test(p));

  expect(dcProp, `DC should appear in props for Soften Earth and Stone (props: ${JSON.stringify(props)})`).toBeTruthy();
});

// ── 3. Formula DC offset: Blasphemy has save.dc="+4" ────────────────────────

test('GL#1515 Blasphemy with dc="+4" shows DC that exceeds base by 4', async ({ page }) => {
  const actorId     = await createWizard(page, { intScore: 18 });
  const spellItemId = await addSpell(page, actorId, BLASPHEMY_ID);

  // Confirm dc offset is still "+4" in the SRD data
  const dcOffset = await page.evaluate(({ actorId, spellItemId }) => {
    return game.actors.get(actorId).items.get(spellItemId).system.save.dc;
  }, { actorId, spellItemId });

  expect(String(dcOffset)).toBe('+4');

  // Get props for Blasphemy (save.type="willnegates", save.dc="+4")
  const props  = await getSpellChatProps(page, actorId, spellItemId);
  const dcProp = props.find(p => /^DC \d+/.test(p));

  expect(dcProp, `DC should appear in props for Blasphemy (props: ${JSON.stringify(props)})`).toBeTruthy();

  // baseDCFormula = "10 + @sl + @ablMod" = 10 + 7 + 4 = 21, plus +4 offset = 25
  // Verify DC is at least 25 (the +4 is counted)
  const dcValue = parseInt(dcProp.replace('DC ', ''), 10);
  expect(dcValue).toBeGreaterThanOrEqual(25);
});
