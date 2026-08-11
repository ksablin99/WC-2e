'use strict';

/**
 * E2E tests for Jump skill (jmp) and SRD land-speed-based adjustments (GL#1506).
 *
 * Covered code paths:
 *   - module/actor/update/actorUpdater.js #updateSkills — skill mod uses
 *     `points ?? rank ?? 0` so template-only `rank` does not yield NaN mods.
 *   - #updateAbilityRelatedFields — when `jumpSkillAdjust` is true, applies
 *     −6 per 10 ft under 30 ft and +4 per 10 ft over 30 ft vs effective land total.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── GL#1506 — over 30 ft land speed (+4 per 10 ft above 30) ─────────────────

test('GL#1506 jump speed bonus follows SRD (+4 per 10 ft over 30 ft land speed)', async ({
  page,
}) => {
  const { delta, landTotal, jsa } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'E2E Jump Over 30',
      type: 'character',
      system: {
        abilities: { str: { value: 10 } },
        jumpSkillAdjust: true,
        attributes: {
          speed: { land: { base: 30 } },
        },
        skills: {
          jmp: { enabled: true },
        },
      },
    });
    const a = game.actors.get(actor.id);
    await a.update({
      'system.jumpSkillAdjust': true,
      'system.attributes.speed.land.base': 30,
    });
    const a0 = game.actors.get(actor.id);
    const modBefore = a0.system.skills.jmp.mod;
    await a0.createEmbeddedDocuments('Item', [
      {
        name: 'E2E land +20',
        type: 'buff',
        system: {
          active: true,
          changes: [['20', 'misc', 'landSpeed', 'untyped', 0]],
        },
      },
    ]);
    const a2 = game.actors.get(actor.id);
    return {
      delta: a2.system.skills.jmp.mod - modBefore,
      landTotal: a2.system.attributes.speed.land.total,
      jsa: a2.system.jumpSkillAdjust,
    };
  });
  expect(jsa).toBe(true);
  expect(landTotal).toBe(50);
  expect(delta).toBe(8);
});

// ── Under 30 ft: −6 per 10 ft below 30 ──────────────────────────────────────

test('jump skill applies SRD speed penalty at 20 ft land (−6 vs 30 ft baseline)', async ({
  page,
}) => {
  const { mod20, mod30, land20, land30 } = await page.evaluate(async () => {
    const base = {
      type: 'character',
      system: {
        abilities: { str: { value: 10 } },
        jumpSkillAdjust: true,
        skills: { jmp: { enabled: true } },
      },
    };

    const a20 = await Actor.create({
      name: 'E2E Jump Land 20',
      ...base,
      system: { ...base.system, attributes: { speed: { land: { base: 20 } } } },
    });
    await game.actors.get(a20.id).update({
      'system.jumpSkillAdjust': true,
      'system.attributes.speed.land.base': 20,
    });
    const low = game.actors.get(a20.id);

    const a30 = await Actor.create({
      name: 'E2E Jump Land 30',
      ...base,
      system: { ...base.system, attributes: { speed: { land: { base: 30 } } } },
    });
    await game.actors.get(a30.id).update({
      'system.jumpSkillAdjust': true,
      'system.attributes.speed.land.base': 30,
    });
    const mid = game.actors.get(a30.id);

    return {
      mod20: low.system.skills.jmp.mod,
      mod30: mid.system.skills.jmp.mod,
      land20: low.system.attributes.speed.land.total,
      land30: mid.system.attributes.speed.land.total,
    };
  });

  expect(land20).toBe(20);
  expect(land30).toBe(30);
  expect(mod20 - mod30).toBe(-6);
});

// ── Over 30 baseline: 40 ft land → +4 jump vs 30 ft ───────────────────────────

test('jump skill applies +4 SRD speed bonus at 40 ft land vs 30 ft', async ({ page }) => {
  const { delta, landHi, landLo } = await page.evaluate(async () => {
    const base = {
      type: 'character',
      system: {
        abilities: { str: { value: 10 } },
        jumpSkillAdjust: true,
        skills: { jmp: { enabled: true } },
      },
    };

    const a30 = await Actor.create({
      name: 'E2E Jump cmp30',
      ...base,
      system: { ...base.system, attributes: { speed: { land: { base: 30 } } } },
    });
    await game.actors.get(a30.id).update({
      'system.jumpSkillAdjust': true,
      'system.attributes.speed.land.base': 30,
    });
    const lo = game.actors.get(a30.id);

    const a40 = await Actor.create({
      name: 'E2E Jump cmp40',
      ...base,
      system: { ...base.system, attributes: { speed: { land: { base: 40 } } } },
    });
    await game.actors.get(a40.id).update({
      'system.jumpSkillAdjust': true,
      'system.attributes.speed.land.base': 40,
    });
    const hi = game.actors.get(a40.id);

    return {
      delta: hi.system.skills.jmp.mod - lo.system.skills.jmp.mod,
      landHi: hi.system.attributes.speed.land.total,
      landLo: lo.system.attributes.speed.land.total,
    };
  });

  expect(landLo).toBe(30);
  expect(landHi).toBe(40);
  expect(delta).toBe(4);
});

// ── jumpSkillAdjust off: land speed changes do not alter jmp.mod ─────────────

test('jump land-speed adjustment is skipped when jumpSkillAdjust is false', async ({
  page,
}) => {
  const { delta, landTotal, jsa } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'E2E Jump No Adjust',
      type: 'character',
      system: {
        abilities: { str: { value: 10 } },
        attributes: { speed: { land: { base: 30 } } },
        skills: { jmp: { enabled: true } },
      },
    });
    const a = game.actors.get(actor.id);
    await a.update({
      'system.jumpSkillAdjust': false,
      'system.attributes.speed.land.base': 30,
    });
    const a0 = game.actors.get(actor.id);
    const modBefore = a0.system.skills.jmp.mod;
    await a0.createEmbeddedDocuments('Item', [
      {
        name: 'E2E land +20 no jump',
        type: 'buff',
        system: {
          active: true,
          changes: [['20', 'misc', 'landSpeed', 'untyped', 0]],
        },
      },
    ]);
    const a2 = game.actors.get(actor.id);
    return {
      delta: a2.system.skills.jmp.mod - modBefore,
      landTotal: a2.system.attributes.speed.land.total,
      jsa: a2.system.jumpSkillAdjust,
    };
  });
  expect(jsa).toBe(false);
  expect(landTotal).toBe(50);
  expect(delta).toBe(0);
});

// ── Regression: jmp.mod stays a finite number on a fresh character ────────────

test('Jump skill modifier is a finite number after create (points/rank merge)', async ({
  page,
}) => {
  const jmp = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'E2E Jump Finite',
      type: 'character',
      system: {
        abilities: { str: { value: 12 } },
        jumpSkillAdjust: true,
        attributes: { speed: { land: { base: 30 } } },
        skills: { jmp: { enabled: true } },
      },
    });
    const a = game.actors.get(actor.id);
    await a.update({ 'system.jumpSkillAdjust': true });
    const sk = a.system.skills.jmp;
    return {
      mod: sk.mod,
      hasPoints: sk.points !== undefined && sk.points !== null,
      rank: sk.rank,
    };
  });
  expect(Number.isFinite(jmp.mod)).toBe(true);
  expect(Number.isNaN(jmp.mod)).toBe(false);
});
