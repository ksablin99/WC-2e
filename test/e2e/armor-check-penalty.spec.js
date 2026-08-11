'use strict';

/**
 * E2E tests — Armor Check Penalty (ACP) applied to skills.
 *
 * Rules: When armor is equipped, its ACP is subtracted from STR/DEX-based
 * skills that have `acp: true` in the skill definition. Swim (swm) takes
 * double ACP. INT-based skills (e.g. Knowledge: Arcana) have `acp: false`
 * and are unaffected.
 *
 * Implementation: actorUpdater.js `#updateSkills` reads
 *   `system.attributes.acp.gear` (set from equipped armor `system.armor.acp`)
 *   and subtracts it from any skill with `skl.acp === true`.
 *
 * Chain Mail: system.armor.acp = 5 (stored positive, applied as penalty).
 *
 * Skill keys: clm = Climb (str, acp: true), kar = Knowledge:Arcana (int, acp: false)
 *
 * Note: Without a class, skills are treated as cross-class (cs = false) so
 *   mod = floor(points / 2 + ablMod - acpPenalty).
 *   With STR 10 (mod 0) and 6 points: floor(6/2 + 0 - 0) = 3.
 *   With ACP 5 equipped:              floor(6/2 + 0 - 5) = -2.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await page.waitForFunction(() => typeof game !== 'undefined' && game.ready === true, {
    timeout: 15_000,
  });
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

/** Wait until actor's skill mod settles at an expected value. */
async function waitForSkillMod(page, actorId, skillKey, expected) {
  await page.waitForFunction(
    ({ id, key, exp }) => (game.actors.get(id)?.system?.skills?.[key]?.mod ?? null) === exp,
    { id: actorId, key: skillKey, exp: expected },
    { timeout: 10_000 },
  );
}

// ── 1. Chain Mail equipped → ACP −5 applied to Climb ─────────────────────────

test('Chain Mail equipped applies ACP -5 to Climb (6 pts cross-class, STR 10 → mod = -2)', async ({ page }) => {
  // Create actor with 6 cross-class Climb points (floor(6/2) = 3 ranks) and STR 10
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'ACP Climb Test', type: 'character' });
    await game.actors.get(actor.id).update({
      'system.abilities.str.value': 10,
      'system.skills.clm.points': 6,
      'system.details.levelUpProgression': false,
    });
    return actor.id;
  });

  // Baseline: cross-class Climb mod = floor(6/2 + 0) = 3
  await waitForSkillMod(page, actorId, 'clm', 3);

  // Equip armor with ACP 5
  await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    const [armor] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Chain Mail',
      type: 'equipment',
    }]);
    await game.actors.get(id).items.get(armor.id).update({
      'system.equipped': true,
      'system.armor.acp': 5,
      'system.equipmentType': 'armor',
      'system.equipmentSubtype': 'mediumArmor',
    });
  }, actorId);

  // Climb mod should now be floor(3 − 5) = −2
  await waitForSkillMod(page, actorId, 'clm', -2);

  const mod = await page.evaluate(
    ({ id }) => game.actors.get(id)?.system?.skills?.clm?.mod,
    { id: actorId },
  );
  expect(mod).toBe(-2);
});

// ── 2. Unequip the armor → ACP removed, Climb returns to 3 ──────────────────

test('Unequipping Chain Mail removes ACP penalty from Climb', async ({ page }) => {
  const { actorId, armorId } = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'ACP Unequip Test', type: 'character' });
    await game.actors.get(actor.id).update({
      'system.abilities.str.value': 10,
      'system.skills.clm.points': 6,
      'system.details.levelUpProgression': false,
    });
    const [armor] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Chain Mail',
      type: 'equipment',
    }]);
    await game.actors.get(actor.id).items.get(armor.id).update({
      'system.equipped': true,
      'system.armor.acp': 5,
      'system.equipmentType': 'armor',
      'system.equipmentSubtype': 'mediumArmor',
    });
    return { actorId: actor.id, armorId: armor.id };
  });

  // Wait for armor penalty to be applied (mod = −2)
  await waitForSkillMod(page, actorId, 'clm', -2);

  // Now unequip the armor
  await page.evaluate(async ({ id, aid }) => {
    await game.actors.get(id).items.get(aid).update({ 'system.equipped': false });
  }, { id: actorId, aid: armorId });

  // Climb mod should return to 3
  await waitForSkillMod(page, actorId, 'clm', 3);

  const mod = await page.evaluate(
    ({ id }) => game.actors.get(id)?.system?.skills?.clm?.mod,
    { id: actorId },
  );
  expect(mod).toBe(3);
});

// ── 3. ACP does NOT apply to INT-based skills (Knowledge: Arcana) ─────────────

test('Chain Mail ACP does NOT reduce Knowledge:Arcana (INT-based, acp: false)', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'ACP INT Skill Test', type: 'character' });
    // INT 10 = +0 mod; 6 cross-class points → floor(6/2) = 3 ranks
    await game.actors.get(actor.id).update({
      'system.abilities.int.value': 10,
      'system.skills.kar.points': 6,
      'system.details.levelUpProgression': false,
    });
    const [armor] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Chain Mail',
      type: 'equipment',
    }]);
    await game.actors.get(actor.id).items.get(armor.id).update({
      'system.equipped': true,
      'system.armor.acp': 5,
      'system.equipmentType': 'armor',
      'system.equipmentSubtype': 'mediumArmor',
    });
    return actor.id;
  });

  // Knowledge:Arcana mod should remain 3 — ACP is not applied to INT skills
  await waitForSkillMod(page, actorId, 'kar', 3);

  const mod = await page.evaluate(
    ({ id }) => game.actors.get(id)?.system?.skills?.kar?.mod,
    { id: actorId },
  );
  expect(mod).toBe(3);

  // Also confirm the ACP was actually computed (armor is equipped)
  const acpGear = await page.evaluate(
    ({ id }) => game.actors.get(id)?.system?.attributes?.acp?.gear ?? 0,
    { id: actorId },
  );
  expect(acpGear).toBe(5);
});
