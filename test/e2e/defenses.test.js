'use strict';

/**
 * E2E tests for actor AC (Armor Class) computation and the defenses tab.
 *
 * D35E AC formula:
 *   normal AC  = 10 + armor bonus + shield bonus + dex mod + natural armor + misc
 *   touch AC   = 10 + dex mod + misc (no armor, no natural armor)
 *   flat-footed = 10 + armor bonus + shield bonus + natural armor (no dex)
 *
 * AC is exposed at:
 *   actor.system.attributes.ac.normal.total
 *   actor.system.attributes.ac.touch.total
 *   actor.system.attributes.ac.flatFooted.total
 *
 * Armor items contribute via system.changes with changeTarget 'aac' (armor AC,
 * excludes touch AC) and modifier 'base'. Shield items use changeTarget 'sac'.
 *
 * Covers:
 *   1. Default AC = 10 with no equipment.
 *   2. Adding an armor item with a +6 bonus increases normal AC by 6.
 *   3. Touch AC does not include the armor bonus.
 *   4. DEX modifier contributes to normal and touch AC, not flat-footed.
 *   5. Equipping and unequipping armor changes AC accordingly.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── 1. Default AC = 10 ───────────────────────────────────────────────────────

test('actor with no equipment has AC = 10', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Naked Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } }, // DEX 10 → mod 0
    });
    const a = game.actors.get(actor.id);
    return {
      normal:      a.system.attributes.ac.normal.total,
      touch:       a.system.attributes.ac.touch.total,
      flatFooted:  a.system.attributes.ac.flatFooted.total,
    };
  });

  expect(result.normal).toBe(10);
  expect(result.touch).toBe(10);
  expect(result.flatFooted).toBe(10);
});

// ── 2. Equipped armor adds to normal AC ──────────────────────────────────────

test('equipped armor item with +6 bonus increases normal AC to 16', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Armored Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } },
    });

    const [armor] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Breastplate',
      type: 'equipment',
      system: {
        equipped: false,
        changes: [['6', 'ac', 'aac', 'base', 0]],
      },
    }]);
    await game.actors.get(actor.id).items.get(armor.id).update({ 'system.equipped': true });

    const a = game.actors.get(actor.id);
    return {
      normal:     a.system.attributes.ac.normal.total,
      touch:      a.system.attributes.ac.touch.total,
      flatFooted: a.system.attributes.ac.flatFooted.total,
    };
  });

  expect(result.normal).toBe(16);     // 10 + 6 armor
  expect(result.touch).toBe(10);      // touch ignores armor
  expect(result.flatFooted).toBe(16); // flat-footed includes armor
});

// ── 3. DEX contributes to normal and touch but not flat-footed ───────────────

test('DEX mod applies to normal and touch AC but not flat-footed', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Dextrous Actor',
      type: 'character',
    });
    // Update DEX after creation so _updateChanges() is properly awaited
    await actor.update({ 'system.abilities.dex.value': 16 }); // DEX 16 → mod +3
    const a = game.actors.get(actor.id);
    return {
      normal:     a.system.attributes.ac.normal.total,
      touch:      a.system.attributes.ac.touch.total,
      flatFooted: a.system.attributes.ac.flatFooted.total,
    };
  });

  expect(result.normal).toBe(13);     // 10 + 3
  expect(result.touch).toBe(13);      // 10 + 3
  expect(result.flatFooted).toBe(10); // 10 + 0 (DEX denied)
});

// ── 4. Unequipped armor does NOT add to AC ───────────────────────────────────

test('unequipped armor item does not contribute to AC', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Carrying Armor Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } },
    });

    await actor.createEmbeddedDocuments('Item', [{
      name: 'Chain Mail',
      type: 'equipment',
      system: {
        equipped: false, // NOT equipped
        changes: [['5', 'ac', 'aac', 'base', 0]],
      },
    }]);

    const a = game.actors.get(actor.id);
    return a.system.attributes.ac.normal.total;
  });

  expect(result).toBe(10); // No armor bonus
});

// ── 5. Equipping / unequipping armor toggles AC ───────────────────────────────

test('equipping and then unequipping armor toggles the AC bonus', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Toggle Armor Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } },
    });

    const [armor] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Chain Mail',
      type: 'equipment',
      system: {
        equipped: false,
        changes: [['5', 'ac', 'aac', 'base', 0]],
      },
    }]);

    const acBefore = game.actors.get(actor.id).system.attributes.ac.normal.total;

    await game.actors.get(actor.id).items.get(armor.id).update({ 'system.equipped': true });
    const acEquipped = game.actors.get(actor.id).system.attributes.ac.normal.total;

    await game.actors.get(actor.id).items.get(armor.id).update({ 'system.equipped': false });
    const acUnequipped = game.actors.get(actor.id).system.attributes.ac.normal.total;

    return { acBefore, acEquipped, acUnequipped };
  });

  expect(result.acBefore).toBe(10);
  expect(result.acEquipped).toBe(15);
  expect(result.acUnequipped).toBe(10);
});
