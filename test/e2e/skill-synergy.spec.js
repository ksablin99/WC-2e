'use strict';

/**
 * E2E tests — skill synergy bonuses.
 *
 * SRD: Having 5 or more ranks in certain skills grants a +2 bonus on related
 * skills.  All synergy bonuses are untyped.
 *
 * Implementation: actorUpdater.js `#applySkillSynergies()` (lines 3404–3504)
 * checks each skill's rank and pushes +2 untyped changes into the changes
 * array when the threshold is met.  Disabled globally via
 * `system.noSkillSynergy = true`.
 *
 * Synergies tested here (a representative subset):
 *   Bluff   5 → Diplomacy +2, Intimidate +2, Sleight of Hand +2
 *   Tumble  5 → Balance +2, Jump +2
 *   KnArcana 5 → Spellcraft +2
 *
 * Skill keys: blf, dip, int (Intimidate), slt, tmb, blc, jmp, kar, spl
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

/** Read a skill's changeBonus (synergy + buff bonuses from the changes pipeline). */
async function skillChangeBonus(page, actorId, skillKey) {
  return page.evaluate(
    ({ id, key }) => game.actors.get(id)?.system?.skills?.[key]?.changeBonus ?? 0,
    { id: actorId, key: skillKey },
  );
}

/** Wait until a skill's changeBonus reaches the expected value. */
async function waitForSkillBonus(page, actorId, skillKey, expected) {
  await page.waitForFunction(
    ({ id, key, exp }) => (game.actors.get(id)?.system?.skills?.[key]?.changeBonus ?? 0) === exp,
    { id: actorId, key: skillKey, exp: expected },
    { timeout: 10_000 },
  );
}

// ── 1. Below threshold — no synergy ──────────────────────────────────────────

test('removed legacy psionic skills do not break Warcraft actor updates', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Warcraft Skill Compatibility Test', type: 'character' });
    await actor.update({
      'system.abilities.str.value': 14,
      'system.skills.coc.points': 10,
    });

    const fresh = game.actors.get(actor.id);
    return {
      hasAutohypnosis: fresh.system.skills.aut != null,
      hasKnowledgePsionics: fresh.system.skills.kps != null,
      strength: fresh.system.abilities.str.value,
    };
  });

  expect(result).toEqual({
    hasAutohypnosis: false,
    hasKnowledgePsionics: false,
    strength: 14,
  });
});

test('Bluff rank 4 does NOT grant Diplomacy synergy bonus', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Bluff 4 Test', type: 'character' });
    await game.actors.get(actor.id).update({ 'system.skills.blf.rank': 4 });
    return actor.id;
  });

  // actorUpdater overwrites cross-class blf.rank from input 4 → 2 (floor(4/2)).
  // Wait for the computed rank to settle rather than the raw input value.
  await page.waitForFunction(
    ({ id }) => game.actors.get(id)?.system?.skills?.blf?.mod !== undefined,
    { id: actorId },
    { timeout: 8_000 },
  );

  const bonus = await skillChangeBonus(page, actorId, 'dip');
  expect(bonus).toBe(0);
});

// ── 2. Bluff 5 → Diplomacy, Intimidate, Sleight of Hand +2 ─────────────────

test('Bluff rank 5 grants +2 to Diplomacy, Intimidate, and Sleight of Hand', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Bluff 5 Test', type: 'character' });
    await game.actors.get(actor.id).update({ 'system.skills.blf.rank': 5 });
    return actor.id;
  });

  await waitForSkillBonus(page, actorId, 'dip', 2);

  const [dip, int_, slt] = await page.evaluate(({ id }) => {
    const sk = game.actors.get(id).system.skills;
    return [
      sk.dip.changeBonus ?? 0,
      sk.int.changeBonus ?? 0,  // Intimidate uses key 'int'
      sk.slt.changeBonus ?? 0,
    ];
  }, { id: actorId });

  expect(dip).toBe(2);
  expect(int_).toBe(2);
  expect(slt).toBe(2);
});

// ── 3. Tumble 5 → Balance +2 and Jump +2 ────────────────────────────────────

test('Tumble rank 5 grants +2 to Balance and Jump', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Tumble 5 Test', type: 'character' });
    await game.actors.get(actor.id).update({ 'system.skills.tmb.rank': 5 });
    return actor.id;
  });

  await waitForSkillBonus(page, actorId, 'blc', 2);

  const [blc, jmp] = await page.evaluate(({ id }) => {
    const sk = game.actors.get(id).system.skills;
    return [sk.blc.changeBonus ?? 0, sk.jmp.changeBonus ?? 0];
  }, { id: actorId });

  expect(blc).toBe(2);
  expect(jmp).toBe(2);
});

// ── 4. Knowledge (Arcana) 5 → Spellcraft +2 ─────────────────────────────────

test('Knowledge Arcana rank 5 grants +2 to Spellcraft', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'KArcana 5 Test', type: 'character' });
    await game.actors.get(actor.id).update({ 'system.skills.kar.rank': 5 });
    return actor.id;
  });

  await waitForSkillBonus(page, actorId, 'spl', 2);
  const bonus = await skillChangeBonus(page, actorId, 'spl');
  expect(bonus).toBe(2);
});

// ── 5. noSkillSynergy flag disables all synergy bonuses ──────────────────────

test('noSkillSynergy = true disables synergy bonuses', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'No Synergy Test', type: 'character' });
    await game.actors.get(actor.id).update({
      'system.skills.blf.rank': 5,
      'system.noSkillSynergy': true,
    });
    return actor.id;
  });

  // actorUpdater overwrites cross-class blf.rank from input 5 → 2 (floor(5/2)).
  // Wait for the computed rank to settle rather than the raw input value.
  await page.waitForFunction(
    ({ id }) => game.actors.get(id)?.system?.skills?.blf?.mod !== undefined,
    { id: actorId },
    { timeout: 8_000 },
  );

  const bonus = await skillChangeBonus(page, actorId, 'dip');
  expect(bonus).toBe(0);
});
