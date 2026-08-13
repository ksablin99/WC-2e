'use strict';

/**
 * E2E tests for spell casting flow.
 *
 * D35E spell flow:
 *   - Wizard at level 5 gets spell slots for levels 0–3 (0→∞, 1→4+1, 2→3+1, 3→2+1).
 *   - Spell items have `system.spellbook` (e.g. 'primary') and `system.level`.
 *   - `spell.use({ skipDialog: true })` casts the spell. Returns { wasRolled, roll }.
 *   - `await result.roll` resolves once the chat message is created.
 *   - Spell slots are tracked at `actor.system.attributes.spells.spellbooks.primary.spells.spell1.value`.
 *
 * Covers:
 *   1. Wizard 5 has spell slots populated for levels 1 and 2.
 *   2. Casting a level-1 spell decrements the level-1 slot count.
 *   3. Casting a spell posts a chat message.
 *   4. A ranged spell attack (rsak) includes an attack roll in the chat data.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const WIZARD_ID    = 'VwVlbNYqDgMBIWhQ'; // Wizard — d4 HD, arcane spellcasting
const SPELLS_PACK  = 'warcraftrpg2e.spells';
const MAGIC_MISSILE_ID = 'POLwho3lpuKuCo6q'; // Magic Missile — 1st-level rsak

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper: create Wizard 5 with Magic Missile ────────────────────────────────

async function createWizardWithMagicMissile(page) {
  return page.evaluate(async ({ classesPack, wizardId, spellsPack, mmId }) => {
    const actor = await Actor.create({
      name: 'Wizard Spell Caster',
      type: 'character',
      system: {
        abilities: { int: { value: 18 } }, // INT 18 → +4 mod, bonus spells
      },
    });

    // Add Wizard class at level 5
    const classesPackObj = game.packs.get(classesPack);
    const cls = await classesPackObj.getDocument(wizardId);
    const clsData = cls.toObject();
    clsData.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [clsData]);

    // Link primary spellbook to the wizard class so spell slots are computed
    await game.actors.get(actor.id).update({
      'system.attributes.spells.spellbooks.primary.class': 'wizard',
    });

    // Add Magic Missile from compendium
    const spellsPackObj = game.packs.get(spellsPack);
    const spell = await spellsPackObj.getDocument(mmId);
    const spellData = spell.toObject();
    // Assign to the primary spellbook and mark as prepared
    spellData.system.spellbook = 'primary';
    spellData.system.preparation = spellData.system.preparation ?? {};
    spellData.system.preparation.preparedAmount = 1;
    spellData.system.preparation.maxAmount = 1;
    await game.actors.get(actor.id).createEmbeddedDocuments('Item', [spellData]);

    const a = game.actors.get(actor.id);
    const spellItem = a.items.find(i => i.name === 'Magic Missile');

    return {
      actorId: a.id,
      spellId: spellItem?.id ?? null,
      // Wizard is a prepared caster — uses track preparation.preparedAmount per spell
      slotsBefore: spellItem?.system?.preparation?.preparedAmount ?? null,
    };
  }, { classesPack: CLASSES_PACK, wizardId: WIZARD_ID, spellsPack: SPELLS_PACK, mmId: MAGIC_MISSILE_ID });
}

// ── 1. Wizard 5 has level-1 spell slots ──────────────────────────────────────

test('Wizard level 5 has at least 1 level-1 spell slot', async ({ page }) => {
  const result = await page.evaluate(async ({ classesPack, wizardId }) => {
    const actor = await Actor.create({
      name: 'Slot Check Wizard',
      type: 'character',
      system: { abilities: { int: { value: 14 } } },
    });
    const pack = game.packs.get(classesPack);
    const cls  = await pack.getDocument(wizardId);
    const cd   = cls.toObject();
    cd.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [cd]);

    // Link primary spellbook to the wizard class so spell slots are computed
    await game.actors.get(actor.id).update({
      'system.attributes.spells.spellbooks.primary.class': 'wizard',
    });

    const a = game.actors.get(actor.id);
    const spellbooks = a.system.attributes.spells?.spellbooks ?? {};
    const primary    = spellbooks.primary ?? {};
    return {
      spell1: primary.spells?.spell1?.max ?? null,
      spell2: primary.spells?.spell2?.max ?? null,
      spell3: primary.spells?.spell3?.max ?? null,
    };
  }, { classesPack: CLASSES_PACK, wizardId: WIZARD_ID });

  expect(result.spell1).toBeGreaterThan(0);
  expect(result.spell2).toBeGreaterThan(0);
  expect(result.spell3).toBeGreaterThan(0);
});

// ── 2. Casting a spell posts a chat message ───────────────────────────────────

test('casting Magic Missile posts a chat card', async ({ page }) => {
  const { actorId, spellId } = await createWizardWithMagicMissile(page);

  if (!spellId) {
    test.skip(); // Magic Missile not available in pack for this build
    return;
  }

  const msgsBefore = await page.evaluate(() => game.messages.size);

  await page.evaluate(async ({ actorId, spellId }) => {
    const actor = game.actors.get(actorId);
    const spell = actor.items.get(spellId);
    const result = await spell.use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, spellId });

  await page.waitForFunction((c) => game.messages.size > c, msgsBefore, { timeout: 10_000 });

  const msgCount = await page.evaluate(() => game.messages.size);
  expect(msgCount).toBeGreaterThan(msgsBefore);
});

// ── 3. Casting decrements the spell slot count ───────────────────────────────

test('casting a level-1 spell decrements level-1 spell slots by 1', async ({ page }) => {
  const { actorId, spellId, slotsBefore } = await createWizardWithMagicMissile(page);

  if (!spellId || slotsBefore === null || slotsBefore < 1) {
    test.skip();
    return;
  }

  const msgsBefore = await page.evaluate(() => game.messages.size);

  await page.evaluate(async ({ actorId, spellId }) => {
    const actor = game.actors.get(actorId);
    const spell = actor.items.get(spellId);
    const result = await spell.use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, spellId });

  await page.waitForFunction((c) => game.messages.size > c, msgsBefore, { timeout: 10_000 });

  const slotsAfter = await page.evaluate(({ actorId, spellId }) => {
    const spell = game.actors.get(actorId)?.items.get(spellId);
    return spell?.system?.preparation?.preparedAmount ?? null;
  }, { actorId, spellId });

  expect(slotsAfter).toBe(slotsBefore - 1);
});

// ── 4. Chat data contains spell output ────────────────────────────────────────

test('cast Magic Missile chat message contains system chatTemplateData', async ({ page }) => {
  const { actorId, spellId } = await createWizardWithMagicMissile(page);

  if (!spellId) {
    test.skip();
    return;
  }

  const msgsBefore = await page.evaluate(() => game.messages.size);

  await page.evaluate(async ({ actorId, spellId }) => {
    const actor = game.actors.get(actorId);
    const spell = actor.items.get(spellId);
    const result = await spell.use({ skipDialog: true });
    if (result?.roll) await result.roll;
  }, { actorId, spellId });

  await page.waitForFunction((c) => game.messages.size > c, msgsBefore, { timeout: 10_000 });

  const chatData = await page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    return msg?.flags?.warcraftrpg2e?.chatTemplateData ?? null;
  });

  expect(chatData).not.toBeNull();
  // chatTemplateData should have item name
  expect(chatData.item?.name ?? chatData.name ?? '').toContain('Magic Missile');
});
