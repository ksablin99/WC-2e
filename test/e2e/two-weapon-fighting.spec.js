'use strict';

/**
 * E2E: Two-weapon fighting attack-roll penalties.
 *
 * SRD rules (PHB 3.5 — see .srd/combat.html "Two-Weapon Fighting"):
 *   Without TWF feat:
 *     Primary hand (light off-hand)  : -4 penalty  (mode "main-offhand-light")
 *     Off-hand       (light weapon)   : -8 penalty  (mode "offhand-light")
 *     Primary hand (normal off-hand) : -6 penalty  (mode "main-offhand-normal")
 *     Off-hand       (normal weapon)  : -10 penalty (mode "offhand-normal")
 *   With TWF feat:
 *     main-offhand-light  : -2 penalty
 *     offhand-light       : -2 penalty
 *     main-offhand-normal : -4 penalty  (TWF reduces to -4 for non-light off-hand)
 *     offhand-normal      : -4 penalty  (TWF reduces to -4 for non-light off-hand)
 *
 * Implementation note:
 *   The penalties are applied only when the attack dialog is submitted
 *   (extractFormData reads the "twf-attack-mode" select).  The skipDialog /
 *   full-attack path sets only the damage-ability multiplier, not attack penalty.
 *
 *   We exercise the dialog path by:
 *   1. Building a minimal fake DOM element with the required select.
 *   2. Calling item.uses.rollAttack(false, fakeForm, false, actor, rollData, false) —
 *      the same call the dialog "Single Attack" button makes.
 *   3. Pinning d20 to minimum (randomUniform → 0.999999, which gives result=1 in v13
 *      because v13 uses Math.ceil((1 - randomUniform) * faces)).
 *
 * Fixture (level-1 Fighter, STR 18):
 *   BAB = +1, STR mod = +4 → base attack = +5, d20 min = 1
 *   Baseline "primary" roll total = 1 + 1 + 4 = 6
 *   Each TWF mode is verified by its delta from the baseline.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const WEAPONS_PACK = 'warcraftrpg2e.weapons-and-ammo';
const CLASSES_PACK = 'warcraftrpg2e.classes';
const FEATS_PACK   = 'warcraftrpg2e.feats';
const FIGHTER_ID   = 'sgwZt7dg1ZHXQlrW';
const LONGSWORD_ID = 'zWRlna42PMJVX6un';
const TWF_FEAT_ID  = 'BF90zMKubXCsRCWP';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Shared helpers ─────────────────────────────────────────────────────────────

/**
 * Creates a level-1 Fighter (STR 18) with a longsword equipped.
 * Waits until the system auto-creates the longsword melee attack item.
 * Returns { actorId, attackItemId }.
 */
async function createFighterWithLongsword(page, actorName = 'TWF Test Fighter') {
  return page.evaluate(
    async ({ WEAPONS_PACK, CLASSES_PACK, FIGHTER_ID, LONGSWORD_ID, actorName }) => {
      const actor = await Actor.create({ name: actorName, type: 'character' });
      await actor.update({ 'system.abilities.str.value': 18 });

      // Add level-1 Fighter class (BAB +1)
      const classPack = game.packs.get(CLASSES_PACK);
      const fighter = await classPack.getDocument(FIGHTER_ID);
      const classData = fighter.toObject();
      classData.system.levels = 1;
      await actor.createEmbeddedDocuments('Item', [classData]);

      // Equip longsword from compendium
      const weaponPack = game.packs.get(WEAPONS_PACK);
      const longswordDoc = await weaponPack.getDocument(LONGSWORD_ID);
      const [w] = await actor.createEmbeddedDocuments('Item', [longswordDoc.toObject()]);
      await actor.items.get(w.id).update({ 'system.equipped': true });

      // Wait for the auto-created melee attack item
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        const a = game.actors.get(actor.id);
        const atk = a?.items.find(
          (i) => i.type === 'attack' && i.system.originalWeaponId === w.id
            && foundry.utils.getProperty(i.system, 'actionType') === 'mwak',
        );
        if (atk) return { actorId: actor.id, attackItemId: atk.id };
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Longsword attack item not created in time');
    },
    { WEAPONS_PACK, CLASSES_PACK, FIGHTER_ID, LONGSWORD_ID, actorName },
  );
}

/**
 * Rolls the attack item using the dialog code path with a fake form element.
 * Pins d20 to minimum (randomUniform = 0.999999 → face 1 in v13).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} actorId
 * @param {string} attackItemId
 * @param {string} twfMode  e.g. "primary", "main-offhand-light", "offhand-light", …
 * @returns {Promise<number>} attack.total from the resulting chat card
 */
async function rollWithMode(page, actorId, attackItemId, twfMode) {
  return page.evaluate(
    async ({ actorId, attackItemId, twfMode }) => {
      const actor = game.actors.get(actorId);
      const item  = actor.items.get(attackItemId);
      if (!item) throw new Error(`Attack item ${attackItemId} not found`);

      // Build rollData the same way useAttack does
      const rollData = actor.getRollData(null, true);
      rollData.item  = foundry.utils.duplicate(item.getRollData());

      // Build a minimal fake form DOM element that extractFormData can query
      const fakeForm = document.createElement('div');
      const sel = document.createElement('select');
      sel.name  = 'twf-attack-mode';
      const opt = document.createElement('option');
      opt.value    = twfMode;
      opt.selected = true;
      sel.appendChild(opt);
      fakeForm.appendChild(sel);

      // Pin dice to minimum (in v13, randomUniform=0.999999 → face 1)
      const prevUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.999999;

      const msgsBefore = game.messages.size;
      try {
        // Same call the "Single Attack" dialog button makes
        await item.uses.rollAttack(false, fakeForm, false, actor, rollData, false);
      } finally {
        CONFIG.Dice.randomUniform = prevUniform;
      }

      // Wait for the attack-roll chat card
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        const msgs = game.messages.contents.slice(msgsBefore);
        const atk  = msgs.find(
          (m) => String(m.flags?.warcraftrpg2e?.template || '').includes('attack-roll'),
        );
        if (atk) {
          const total = atk.flags?.warcraftrpg2e?.chatTemplateData?.attacks?.[0]?.attack?.total;
          if (typeof total === 'number') return total;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Attack chat card not produced within timeout');
    },
    { actorId, attackItemId, twfMode },
  );
}

/**
 * Adds the Two-Weapon Fighting feat to the actor.
 */
async function addTwfFeat(page, actorId) {
  await page.evaluate(
    async ({ actorId, FEATS_PACK, TWF_FEAT_ID }) => {
      const actor    = game.actors.get(actorId);
      const featPack = game.packs.get(FEATS_PACK);
      const feat     = await featPack.getDocument(TWF_FEAT_ID);
      await actor.createEmbeddedDocuments('Item', [feat.toObject()]);
    },
    { actorId, FEATS_PACK, TWF_FEAT_ID },
  );
}

// ── 1. Penalties without TWF feat ─────────────────────────────────────────────
//
// Strategy: roll "primary" first to get the deterministic baseline, then verify
// each TWF mode produces the correct delta from that baseline.
//
// d20 is pinned to 1 (minimum) in v13 via randomUniform=0.999999.
// Baseline = 1(d20) + 1(BAB) + 4(STR) = 6.

test.describe.serial('Two-weapon fighting penalties — no TWF feat', () => {
  test('primary mode applies no penalty', async ({ page }) => {
    const { actorId, attackItemId } = await createFighterWithLongsword(page);
    const baseline = await rollWithMode(page, actorId, attackItemId, 'primary');
    // Verify baseline is sane (d20 min + BAB + STR = 1 + 1 + 4 = 6)
    expect(baseline).toBe(6);
  });

  test('main-offhand-light applies -4 penalty', async ({ page }) => {
    const { actorId, attackItemId } = await createFighterWithLongsword(page);
    const baseline = await rollWithMode(page, actorId, attackItemId, 'primary');
    const withMode = await rollWithMode(page, actorId, attackItemId, 'main-offhand-light');
    expect(withMode - baseline).toBe(-4);
  });

  test('offhand-light applies -8 penalty', async ({ page }) => {
    const { actorId, attackItemId } = await createFighterWithLongsword(page);
    const baseline = await rollWithMode(page, actorId, attackItemId, 'primary');
    const withMode = await rollWithMode(page, actorId, attackItemId, 'offhand-light');
    expect(withMode - baseline).toBe(-8);
  });

  test('main-offhand-normal applies -6 penalty', async ({ page }) => {
    const { actorId, attackItemId } = await createFighterWithLongsword(page);
    const baseline = await rollWithMode(page, actorId, attackItemId, 'primary');
    const withMode = await rollWithMode(page, actorId, attackItemId, 'main-offhand-normal');
    expect(withMode - baseline).toBe(-6);
  });

  test('offhand-normal applies -10 penalty', async ({ page }) => {
    const { actorId, attackItemId } = await createFighterWithLongsword(page);
    const baseline = await rollWithMode(page, actorId, attackItemId, 'primary');
    const withMode = await rollWithMode(page, actorId, attackItemId, 'offhand-normal');
    expect(withMode - baseline).toBe(-10);
  });
});

// ── 2. Penalties with Two-Weapon Fighting feat ────────────────────────────────

test.describe.serial('Two-weapon fighting penalties — with TWF feat', () => {
  test('main-offhand-light with TWF feat applies -2 penalty', async ({ page }) => {
    const { actorId, attackItemId } = await createFighterWithLongsword(page);
    const baseline = await rollWithMode(page, actorId, attackItemId, 'primary');
    await addTwfFeat(page, actorId);
    const withMode = await rollWithMode(page, actorId, attackItemId, 'main-offhand-light');
    expect(withMode - baseline).toBe(-2);
  });

  test('offhand-light with TWF feat applies -2 penalty', async ({ page }) => {
    const { actorId, attackItemId } = await createFighterWithLongsword(page);
    const baseline = await rollWithMode(page, actorId, attackItemId, 'primary');
    await addTwfFeat(page, actorId);
    const withMode = await rollWithMode(page, actorId, attackItemId, 'offhand-light');
    expect(withMode - baseline).toBe(-2);
  });

  test('main-offhand-normal with TWF feat applies -4 penalty', async ({ page }) => {
    const { actorId, attackItemId } = await createFighterWithLongsword(page);
    const baseline = await rollWithMode(page, actorId, attackItemId, 'primary');
    await addTwfFeat(page, actorId);
    const withMode = await rollWithMode(page, actorId, attackItemId, 'main-offhand-normal');
    expect(withMode - baseline).toBe(-4);
  });

  test('offhand-normal with TWF feat applies -4 penalty', async ({ page }) => {
    const { actorId, attackItemId } = await createFighterWithLongsword(page);
    const baseline = await rollWithMode(page, actorId, attackItemId, 'primary');
    await addTwfFeat(page, actorId);
    const withMode = await rollWithMode(page, actorId, attackItemId, 'offhand-normal');
    expect(withMode - baseline).toBe(-4);
  });
});
