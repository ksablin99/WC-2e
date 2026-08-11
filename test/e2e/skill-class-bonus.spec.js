'use strict';

/**
 * E2E tests — class skill bonus vs. cross-class skill penalty.
 *
 * D35E implementation (actorUpdater.js updateSkills):
 *   Class skill (cs=true):       mod = Math.floor(points + ablMod + bonuses - penalties)
 *   Cross-class skill (cs=false): mod = Math.floor(points/2 + ablMod + bonuses - penalties)
 *
 * This mirrors the SRD rule where investing skill points in a class skill gives
 * full benefit while cross-class skills only yield half a rank per point.
 *
 * Fighter class skills include: Climb (STR), Jump (STR), Swim (STR), Intimidate (CHA).
 * Fighter cross-class examples:  Spellcraft (INT), Bluff (CHA).
 *
 * Tests use:
 *  - STR 10 (mod +0) and INT 10 (mod +0) to isolate the rank-halving effect
 *  - No buffs or race items to avoid other sources of bonus
 *
 * Pack IDs:
 *   Fighter — warcraftrpg2e.classes, _id: sgwZt7dg1ZHXQlrW
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const FIGHTER_ID = 'sgwZt7dg1ZHXQlrW';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await page.waitForFunction(() => typeof game !== 'undefined' && game.ready === true, {
    timeout: 15_000,
  });
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

/** Create a Fighter 1 with neutral ability scores and given skill points. */
async function createFighterWithSkills(page, skillUpdates, name = 'Skill Test') {
  return page.evaluate(
    async ({ name, packId, fighterId, skillUpdates }) => {
      const actor = await Actor.create({ name, type: 'character' });
      // Neutral ability scores so mods = 0; disable levelUpProgression so ranks
      // are used directly (halving handled here, not pre-divided by level-up UI)
      await game.actors.get(actor.id).update({
        'system.abilities.str.value': 10,
        'system.abilities.int.value': 10,
        'system.abilities.cha.value': 10,
        'system.details.levelUpProgression': false,
      });
      // Add Fighter class (sets cs flags for class skills)
      const pack = game.packs.get(packId);
      const classDoc = await pack.getDocument(fighterId);
      const classData = classDoc.toObject();
      classData.system.levels = 1;
      await game.actors.get(actor.id).createEmbeddedDocuments('Item', [classData]);
      // Set skill points
      await game.actors.get(actor.id).update(skillUpdates);
      return actor.id;
    },
    { name, packId: CLASSES_PACK, fighterId: FIGHTER_ID, skillUpdates },
  );
}

// ── 1. Class skill (Climb) with 4 points gives mod = 4 ───────────────────────

test('Fighter class skill Climb: 4 points → mod = 4 (full rank value)', async ({ page }) => {
  const actorId = await createFighterWithSkills(
    page,
    { 'system.skills.clm.points': 4 },
    'Class Skill Test',
  );

  // Poll until the skill rank settles
  await page.waitForFunction(
    ({ id }) => game.actors.get(id)?.system?.skills?.clm?.rank === 4,
    { id: actorId },
    { timeout: 10_000 },
  );

  const mod = await page.evaluate(({ id }) =>
    game.actors.get(id).system.skills.clm.mod,
    { id: actorId },
  );

  // Class skill, STR 10 (mod 0), 4 points → floor(4 + 0) = 4
  expect(mod).toBe(4);
});

// ── 2. Cross-class skill (Spellcraft) with 4 points gives mod = 2 ────────────

test('Fighter cross-class Spellcraft: 4 points → mod = 2 (half rank)', async ({ page }) => {
  const actorId = await createFighterWithSkills(
    page,
    { 'system.skills.spl.points': 4 },
    'Cross-Class Test',
  );

  await page.waitForFunction(
    ({ id }) => game.actors.get(id)?.system?.skills?.spl?.mod === 2,
    { id: actorId },
    { timeout: 10_000 },
  );

  const mod = await page.evaluate(({ id }) =>
    game.actors.get(id).system.skills.spl.mod,
    { id: actorId },
  );

  // Cross-class, INT 10 (mod 0), 4 points → 2 ranks → floor(2 + 0) = 2
  expect(mod).toBe(2);
});

// ── 3. Cross-class with 1 point gives mod = 0 (floor of 0.5) ─────────────────

test('Fighter cross-class Spellcraft: 1 point → mod = 0 (floored)', async ({ page }) => {
  const actorId = await createFighterWithSkills(
    page,
    { 'system.skills.spl.points': 1 },
    'Cross-Class Floor Test',
  );

  // After createFighterWithSkills all awaits settle, actorUpdater has run.
  // The mod will be floor(1/2 + 0) = 0. We wait for the skills object to be present.
  await page.waitForFunction(
    ({ id }) => game.actors.get(id)?.system?.skills?.spl !== undefined,
    { id: actorId },
    { timeout: 10_000 },
  );

  const mod = await page.evaluate(({ id }) =>
    game.actors.get(id).system.skills.spl.mod,
    { id: actorId },
  );

  // Cross-class, 1 point → floor(0.5 + 0) = 0
  expect(mod).toBe(0);
});

// ── 4. Class skill with 0 points gives mod = 0 (no points = no bonus) ────────

test('Fighter class skill Climb with 0 points → mod = 0', async ({ page }) => {
  const actorId = await createFighterWithSkills(
    page,
    { 'system.skills.clm.points': 0 },
    'Zero Rank Test',
  );

  await page.waitForFunction(
    ({ id }) => game.actors.get(id)?.system?.skills?.clm !== undefined,
    { id: actorId },
    { timeout: 8_000 },
  );

  const mod = await page.evaluate(({ id }) =>
    game.actors.get(id).system.skills.clm.mod,
    { id: actorId },
  );

  // 0 points → 0 ranks; no bonus from points, STR 10 → mod = 0
  expect(mod).toBe(0);
});

// ── 5. Ability modifier applies to both class and cross-class skills ──────────

test('Ability modifier adds to skill mod for both class and cross-class skills', async ({ page }) => {
  const actorId = await page.evaluate(
    async ({ packId, fighterId }) => {
      const actor = await Actor.create({ name: 'Ability Mod Skill Test', type: 'character' });
      // STR 16 (+3), INT 14 (+2); disable levelUpProgression for direct-rank mode
      await game.actors.get(actor.id).update({
        'system.abilities.str.value': 16,
        'system.abilities.int.value': 14,
        'system.details.levelUpProgression': false,
      });
      const pack = game.packs.get(packId);
      const classDoc = await pack.getDocument(fighterId);
      const classData = classDoc.toObject();
      classData.system.levels = 1;
      await game.actors.get(actor.id).createEmbeddedDocuments('Item', [classData]);
      await game.actors.get(actor.id).update({
        'system.skills.clm.points': 2,  // Climb: class skill
        'system.skills.spl.points': 2,  // Spellcraft: cross-class
      });
      return actor.id;
    },
    { packId: CLASSES_PACK, fighterId: FIGHTER_ID },
  );

  // Wait for computed mods: Climb class skill floor(2+3)=5, Spellcraft cross-class floor(2/2+2)=3.
  await page.waitForFunction(
    ({ id }) =>
      game.actors.get(id)?.system?.skills?.clm?.mod === 5 &&
      game.actors.get(id)?.system?.skills?.spl?.mod === 3,
    { id: actorId },
    { timeout: 10_000 },
  );

  const result = await page.evaluate(({ id }) => {
    const sk = game.actors.get(id).system.skills;
    return { clm: sk.clm.mod, spl: sk.spl.mod };
  }, { id: actorId });

  // Climb class skill: floor(2 + 3) = 5
  expect(result.clm).toBe(5);
  // Spellcraft cross-class: floor(2/2 + 2) = floor(1 + 2) = 3
  expect(result.spl).toBe(3);
});
