'use strict';

/**
 * E2E tests for incorporeal miss-chance fix (issue #1546).
 *
 * Bug: `chatAttack.js` built the chat card button with `enh` read from
 * `this.item?.system?.enh` (raw stored value — always 0 for a plain weapon).
 * The incorporeal miss check in `actorDamageHelper.js` is:
 *
 *   if (incorporealRoll < 0.5 || enh < 1) { incorporealMiss = true; }
 *
 * With enh=0, the `enh < 1` branch was always true → attacks against
 * incorporeal creatures always missed even when the roll was ≥ 0.5.
 *
 * Fix: `createChatCardData` / `createCriticalChatCardData` now read
 * `this.rollData.item?.enh`, which includes combat-change boosts applied
 * by buffs such as Magic Weapon (enh→1).
 *
 * Covers:
 *   1. enh=0 against an incorporeal actor: incorporealMiss is always true
 *      regardless of the random roll (correct SRD behaviour — non-magic
 *      weapons cannot harm incorporeal creatures at all).
 *   2. enh=1 against an incorporeal actor with a "winning" random roll
 *      (≥ 0.5): damage lands (incorporealMiss=false, HP reduced).
 *   3. enh=1 against an incorporeal actor with a "losing" random roll
 *      (< 0.5): damage misses (incorporealMiss=true, HP unchanged).
 *   4. ChatAttack.createChatCardData enh field reflects rollData.item.enh
 *      (combat-change value) rather than item.system.enh (raw stored value).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

// ── Lifecycle ─────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Build a minimal damage array compatible with calculateDamageToActor.
 * The damage entry has no damageTypeUid so it contributes directly to
 * damageBeforeDr as typeless physical damage.
 */
function damageArray(total) {
  return [{ roll: { total } }];
}

/**
 * Call applyDamage with SPELL_AUTO_HIT so it bypasses the AC dialog but
 * still runs the full incorporeal / DR calculation path.
 *
 * Math.random is mocked in the page context before calling so we control
 * the incorporeal roll outcome.
 */
async function callApplyDamage(page, { actorId, enh, randomReturn }) {
  return page.evaluate(async ({ actorId, enh, randomReturn }) => {
    const actor = game.actors.get(actorId);
    const SPELL_AUTO_HIT = game.D35E.ActorPF.SPELL_AUTO_HIT; // -1337

    // Build a minimal typeless damage array (no damageTypeUid).
    const damage = [{ roll: { total: 10 } }];

    // Patch Math.random for this call so the incorporealRoll is predictable.
    const origRandom = Math.random;
    Math.random = () => randomReturn;

    let errorMsg = null;
    try {
      await game.D35E.ActorPF.applyDamage(
        null,          // ev
        SPELL_AUTO_HIT, // roll — spell auto-hit bypasses rollDefenseDialog
        null,          // critroll
        false,         // natural20
        false,         // natural20Crit
        false,         // fumble
        false,         // fumble20Crit
        damage,        // damage array
        damage,        // normalDamage array (same — only used on nat20 path)
        null,          // material
        null,          // alignment
        enh,           // enh
        false,         // nonLethalDamage
        false,         // simpleDamage — MUST be false to exercise incorporeal path
        actor,         // explicit actor — skips token targeting
      );
    } catch (err) {
      errorMsg = err.message;
    } finally {
      Math.random = origRandom;
    }

    const hp = game.actors.get(actorId).system.attributes.hp.value;
    return { hp, errorMsg };
  }, { actorId, enh, randomReturn });
}

// ── 1. enh=0 against incorporeal: always misses ───────────────────────────────

test('enh=0 against incorporeal actor: damage always misses regardless of random roll', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    // Use character type — hp.max is computed from hp.base in the actorUpdater.
    // Setting hp.base ensures hp.max is correctly resolved after prepareData.
    const actor = await Actor.create({ name: 'Incorporeal Target', type: 'character' });
    await actor.update({
      'system.traits.incorporeal': true,
      'system.attributes.hp.value': 30,
      'system.attributes.hp.base': 30,
    });
    return actor.id;
  });

  // ── 1a. Winning roll (0.9 ≥ 0.5) but enh=0: should still always miss.
  const resultA = await callApplyDamage(page, { actorId, enh: 0, randomReturn: 0.9 });
  expect(resultA.errorMsg, 'applyDamage should not throw').toBeNull();
  expect(resultA.hp, 'enh=0 with high roll: incorporeal miss expected — HP must stay at 30').toBe(30);

  // ── 1b. Losing roll (0.1 < 0.5) and enh=0: also misses.
  const resultB = await callApplyDamage(page, { actorId, enh: 0, randomReturn: 0.1 });
  expect(resultB.errorMsg, 'applyDamage should not throw').toBeNull();
  expect(resultB.hp, 'enh=0 with low roll: incorporeal miss expected — HP must stay at 30').toBe(30);
});

// ── 2. enh=1 + winning roll: damage lands ─────────────────────────────────────

test('enh=1 against incorporeal actor with roll ≥ 0.5: damage lands and HP is reduced', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Incorporeal Target enh1', type: 'character' });
    await actor.update({
      'system.traits.incorporeal': true,
      'system.attributes.hp.value': 30,
      'system.attributes.hp.base': 30,
    });
    return actor.id;
  });

  // Roll = 0.75 (≥ 0.5) and enh=1: neither condition is true → no miss.
  const result = await callApplyDamage(page, { actorId, enh: 1, randomReturn: 0.75 });
  expect(result.errorMsg, 'applyDamage should not throw').toBeNull();
  expect(result.hp, 'enh=1 with winning roll: damage should land — HP must drop below 30').toBeLessThan(30);
});

// ── 3. enh=1 + losing roll: damage misses ─────────────────────────────────────

test('enh=1 against incorporeal actor with roll < 0.5: damage misses and HP is unchanged', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Incorporeal Target enh1-miss', type: 'character' });
    await actor.update({
      'system.traits.incorporeal': true,
      'system.attributes.hp.value': 30,
      'system.attributes.hp.base': 30,
    });
    return actor.id;
  });

  // Roll = 0.25 (< 0.5) and enh=1: incorporealRoll < 0.5 is true → miss.
  const result = await callApplyDamage(page, { actorId, enh: 1, randomReturn: 0.25 });
  expect(result.errorMsg, 'applyDamage should not throw').toBeNull();
  expect(result.hp, 'enh=1 with losing roll: incorporeal miss expected — HP must stay at 30').toBe(30);
});

// ── 4. Non-incorporeal actor is not affected by the incorporeal check ──────────

test('enh=0 against normal (non-incorporeal) actor: damage lands regardless', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Normal Target', type: 'character' });
    await actor.update({
      'system.attributes.hp.value': 30,
      'system.attributes.hp.base': 30,
      // traits.incorporeal defaults to false — not set here
    });
    return actor.id;
  });

  // enh=0, losing roll: the incorporeal block is not entered at all.
  const result = await callApplyDamage(page, { actorId, enh: 0, randomReturn: 0.1 });
  expect(result.errorMsg, 'applyDamage should not throw').toBeNull();
  expect(result.hp, 'normal actor: damage must land — HP must drop below 30').toBeLessThan(30);
});

// ── 5. Magic Weapon buff combat change correctly sets rollData.item.enh ────────

test('Magic Weapon buff combat change ($item.enh=1) is applied to rollData by _addCombatChangesToRollData', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { ItemCombatChangesHelper } = await import('/systems/warcraftrpg2e/module/item/helpers/itemCombatChangesHelper.js');

    // Create attacker with a plain weapon — use two-step pattern so system.* fields are not
    // silently reset by prepareData() during createEmbeddedDocuments.
    const actor = await Actor.create({ name: 'Magic Weapon Test Attacker', type: 'character' });
    const [weapon] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Plain Sword',
      type: 'attack',
    }]);
    // Update enh explicitly after creation so it is not overridden by template defaults.
    await game.actors.get(actor.id).items.get(weapon.id).update({
      'system.enh': 0,
      'system.actionType': 'mwak',
      'system.attackType': 'weapon',
    });

    // Create a Magic Weapon buff directly on the actor (active, with the real combat change).
    // combatChanges is a plain array and not a computed field, so inline creation is safe.
    // active must be set via update because buff items default to inactive on creation.
    const [buff] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Magic Weapon',
      type: 'buff',
      system: {
        combatChanges: [['attackOptional', '', '', '$item.enh', '1', '']],
      },
    }]);
    await game.actors.get(actor.id).items.get(buff.id).update({ 'system.active': true });

    // Re-fetch after updates so rollData reflects the current system state.
    const a = game.actors.get(actor.id);
    const item = a.items.get(weapon.id);
    const buffItem = a.items.get(buff.id);

    // Build rollData the same way use.js does it
    const rollData = a.getRollData();
    rollData.item = foundry.utils.duplicate(item.system);

    // Gather combat changes — buff is attackOptional, so pass its id in optionalFeatIds
    let allCombatChanges = [];
    const rollModifiers = [];
    const optionalFeatIds = [buffItem.id];
    const optionalFeatRanges = new Map([[buffItem.id, { base: 0, slider1: 0, slider2: 0, slider3: 0 }]]);

    allCombatChanges = ItemCombatChangesHelper.getAllSelectedCombatChangesForRoll(
      a.items,
      'attack',        // attackType — matches 'attackOptional' via hasCombatChange('attackOptional', ...)
      rollData,
      allCombatChanges,
      rollModifiers,
      optionalFeatIds,
      optionalFeatRanges
    );

    const enhBefore = rollData.item.enh; // should be 0
    item._addCombatChangesToRollData(allCombatChanges, rollData);
    const enhAfter = rollData.item.enh;  // should be '1' (string) or 1

    return {
      enhBefore,
      enhAfter: Number(enhAfter),
      combatChangesCount: allCombatChanges.length,
    };
  });

  expect(result.combatChangesCount, 'Magic Weapon buff should produce 1 combat change').toBe(1);
  // enh before the combat change is applied should be falsy (0 or null — plain weapon has no enhancement).
  expect(result.enhBefore == null || result.enhBefore === 0, 'rollData.item.enh should start at 0 or null for a plain weapon').toBe(true);
  expect(result.enhAfter, 'rollData.item.enh should be 1 after applying Magic Weapon combat change').toBe(1);
});

// ── 6. ChatAttack.createChatCardData enh reflects rollData, not item.system ───

test('ChatAttack.createChatCardData uses rollData.item.enh (reflects combat changes)', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Create an actor with a plain weapon (system.enh = null/0).
  // Manually set rollData.item.enh = 1 to simulate a Magic Weapon combat change.
  // Then call createChatCardData and verify the returned enh value is 1, not 0.
  const result = await page.evaluate(async () => {
    const { ChatAttack } = await import('/systems/warcraftrpg2e/module/item/chat/chatAttack.js');

    // Create actor + weapon
    const actor = await Actor.create({ name: 'ChatCard enh Test Actor', type: 'character' });
    await actor.update({
      'system.attributes.hp.value': 10,
      'system.attributes.hp.max': 10,
    });

    const [weapon] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Plain Sword',
      type: 'attack',
      system: {
        actionType: 'mwak',
        attackType: 'weapon',
        ability: { attack: 'str', damage: 'str', damageMult: 1, critRange: 20, critMult: 2 },
        damage: { parts: [['1d6', 'Slashing', '']] },
        enh: null,  // plain weapon — raw stored value is null/0
      },
    }]);

    // Re-fetch after creation
    const a = game.actors.get(actor.id);
    const item = a.items.get(weapon.id);

    // Build rollData and manually inject enh=1 to simulate Magic Weapon combat change.
    const rollData = a.getRollData();
    rollData.item = foundry.utils.duplicate(item.system);
    rollData.item.enh = 1; // Magic Weapon sets this

    const chatAttack = new ChatAttack(item, '', a, rollData);

    // Build a minimal fake rolls array for createChatCardData
    const fakeRoll = { total: 5 };

    const cardData = chatAttack.createChatCardData(
      'Apply',
      5,
      [{ roll: fakeRoll, damageTypeUid: '' }]
    );

    return {
      cardEnh: cardData.enh,
      itemSystemEnh: item.system.enh,  // raw stored value (null or 0)
    };
  });

  // The card enh should be 1 (from rollData), not 0/null (from item.system)
  expect(result.cardEnh, 'card enh must equal rollData.item.enh (1), not raw item.system.enh').toBe(1);

  // Sanity-check that item.system.enh is indeed 0/null (the bug value)
  const rawEnh = result.itemSystemEnh;
  expect(rawEnh == null || rawEnh === 0, 'item.system.enh should be null or 0 for plain weapon').toBe(true);

  const badErrors = consoleErrors.filter(e =>
    e.includes('TypeError') || e.includes('Cannot read properties')
  );
  expect(badErrors, 'no TypeError errors in console').toHaveLength(0);
});
