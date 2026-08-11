'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { openSheet } = require('./helpers/actor-sheet');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await page.waitForFunction(() => typeof game !== 'undefined' && game.ready === true, { timeout: 15_000 });
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function createActorWithBuffs(page, name, systemOverrides, buffDefs) {
  return page.evaluate(async ({ name, systemOverrides, buffDefs }) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      ...(systemOverrides ? { system: systemOverrides } : {}),
    });
    for (const def of buffDefs) {
      await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
        name: def.name, type: 'buff',
        system: { active: true, buffType: 'temp', changes: def.changes },
      }]);
    }
    await new Promise(r => setTimeout(r, 800));
    return actor.id;
  }, { name, systemOverrides, buffDefs });
}

async function getSpeeds(page, actorId) {
  return page.evaluate((actorId) => {
    const a = game.actors.get(actorId);
    const s = a.system.attributes.speed;
    const out = {};
    for (const k of ['land', 'fly', 'climb', 'swim', 'burrow']) {
      out[k] = { total: s[k]?.total ?? null, cap: s[k]?.cap ?? null, isOvercap: s[k]?.isOvercap ?? false, run: s[k]?.run ?? null, effectiveBase: s[k]?.effectiveBase ?? null };
    }
    return out;
  }, actorId);
}

async function sampleEncumbranceMatrix(page, baseSpeed) {
  return page.evaluate(async (base) => {
    const actor = await Actor.create({ name: `Encumbrance Base ${base}`, type: 'character' });
    await game.actors.get(actor.id).update({
      'system.abilities.str.value': 10,
      'system.attributes.speed.land.base': base,
    });
    const levels = game.actors.get(actor.id).system.attributes.encumbrance.levels;
    const checkpoints = {
      light: Math.max(0, Number(levels.light) - 0.1),
      medium: Number(levels.light) + 0.1,
      heavy: Number(levels.medium) + 0.1,
      overloaded: Number(levels.heavy) + 0.1,
    };
    async function setCarriedWeight(targetWeight, label) {
      const current = game.actors.get(actor.id).system.attributes.encumbrance.carriedWeight ?? 0;
      const delta = Math.max(0, Number((targetWeight - current).toFixed(2)));
      if (delta > 0) {
        const [item] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [
          { name: `Weight ${label}`, type: 'loot' },
        ]);
        await game.actors.get(actor.id).items.get(item.id).update({
          'system.carried': true, 'system.quantity': 1, 'system.weight': delta,
        });
      }
      const fresh = game.actors.get(actor.id);
      return {
        level: fresh.system.attributes.encumbrance.level,
        speed: fresh.system.attributes.speed.land.total,
        run: fresh.system.attributes.speed.land.run,
      };
    }
    return {
      light: await setCarriedWeight(checkpoints.light, 'light'),
      medium: await setCarriedWeight(checkpoints.medium, 'medium'),
      heavy: await setCarriedWeight(checkpoints.heavy, 'heavy'),
      overloaded: await setCarriedWeight(checkpoints.overloaded, 'overloaded'),
    };
  }, baseSpeed);
}

// ── Buff definitions ──────────────────────────────────────────────────────────

const FLY_SPELL   = { name: 'Fly',         changes: [['60', 'speed', 'flySpeed', 'base-replace']] };
const OVERLAND    = { name: 'Overland Fly', changes: [['40', 'speed', 'flySpeed', 'base-replace']] };
const HASTE_SPEED = { name: 'Haste',        changes: [
  ['@attributes.speed.land.total > 0 ? 30 : 0',   'speed', 'landSpeed', 'enh'],
  ['@attributes.speed.climb.total > 0 ? 30 : 0',  'speed', 'climbSpeed', 'enh'],
  ['@attributes.speed.swim.total > 0 ? 30 : 0',   'speed', 'swimSpeed', 'enh'],
  ['@attributes.speed.burrow.total > 0 ? 30 : 0', 'speed', 'burrowSpeed', 'enh'],
  ['@attributes.speed.fly.total > 0 ? 30 : 0',    'speed', 'flySpeed', 'enh'],
] };
const GASEOUS_FORM = { name: 'Gaseous Form', changes: [
  ['10', 'speed', 'flySpeed', 'base-replace'],
  ['-@attributes.speed.land.total', 'speed', 'landSpeed', 'penalty'],
] };
const SOLID_FOG = { name: 'Solid Fog', changes: [
  ['5', 'speed', 'landSpeed', 'replace'],
] };


// ═══ Group 1 — Encumbrance Speed ═══════════════════════════════════════════════

test('SRD encumbrance speed matrix for base 30 ft', async ({ page }) => {
  const r = await sampleEncumbranceMatrix(page, 30);
  expect(r.light.speed).toBe(30);
  expect(r.medium.speed).toBe(20);
  expect(r.heavy.speed).toBe(20);
  expect(r.overloaded.speed).toBe(5);
});

test('SRD encumbrance speed matrix for base 20 ft', async ({ page }) => {
  const r = await sampleEncumbranceMatrix(page, 20);
  expect(r.light.speed).toBe(20);
  expect(r.medium.speed).toBe(15);
  expect(r.heavy.speed).toBe(15);
});


// ═══ Group 2 — Speed Cap ═══════════════════════════════════════════════════════

test('Dwarf land=20 + Haste -> 40 (capped at 2x20)', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'Dwarf+Haste',
    { attributes: { speed: { land: { base: 20 } } } }, [HASTE_SPEED]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(40);
  expect(s.land.isOvercap).toBe(true);
  expect(s.land.cap).toBe(40);
});

test('Human land=30 + Haste -> 60 (not over cap)', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'Human+Haste', null, [HASTE_SPEED]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(60);
  expect(s.land.isOvercap).toBe(false);
  expect(s.land.cap).toBe(60);
});

test('Fly replace 60 + Haste -> 90 (cap 120, not exceeded)', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'Fly+Haste', null, [FLY_SPELL, HASTE_SPEED]);
  const s = await getSpeeds(page, actorId);
  expect(s.fly.total).toBe(90);
  expect(s.fly.isOvercap).toBe(false);
  expect(s.fly.cap).toBe(120);
});


// ═══ Group 3 — Override ════════════════════════════════════════════════════════

test('Solid Fog override land=5 + Haste -> still 5', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'Fog+Haste', null, [SOLID_FOG, HASTE_SPEED]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(5);
});


// ═══ Group 4 — Replace + Enhance Stacking ══════════════════════════════════════

test('Fly spell alone sets fly speed to 60', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'Fly Alone', null, [FLY_SPELL]);
  expect((await getSpeeds(page, actorId)).fly.total).toBe(60);
});

test('Fly 60 + Haste = 90', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'Fly+Haste', null, [FLY_SPELL, HASTE_SPEED]);
  const s = await getSpeeds(page, actorId);
  expect(s.fly.total).toBe(90);
  expect(s.land.total).toBe(60);
});

test('Overland Flight 40 + Haste = 70', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'Overland+Haste', null, [OVERLAND, HASTE_SPEED]);
  const s = await getSpeeds(page, actorId);
  expect(s.fly.total).toBe(70);
  expect(s.land.total).toBe(60);
});

test('Gaseous Form 10 + Haste = 20', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'Gas+Haste', null, [GASEOUS_FORM, HASTE_SPEED]);
  expect((await getSpeeds(page, actorId)).fly.total).toBe(20);
});

test('manual fly.base=30 + Haste = 60', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'Manual+Haste',
    { attributes: { speed: { fly: { base: 30 } } } }, [HASTE_SPEED]);
  expect((await getSpeeds(page, actorId)).fly.total).toBe(60);
});

test('Haste does NOT grant fly speed when creature has none', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'NoFly+Haste', null, [HASTE_SPEED]);
  const s = await getSpeeds(page, actorId);
  expect(s.fly.total).toBe(0);
  expect(s.land.total).toBe(60);
});

// ═══ Group 5 — Chain Mail Armor Speed Reduction ════════════════════════════════

async function createActorWithArmorAndBuffs(page, name, baseLand, buffDefs) {
  return page.evaluate(async ({ name, baseLand, buffDefs }) => {
    const actor = await Actor.create({
      name, type: 'character',
      system: { attributes: { speed: { land: { base: baseLand } } } },
    });
    const [armor] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Chain Mail', type: 'equipment',
    }]);
    await game.actors.get(actor.id).items.get(armor.id).update({
      'system.equipped': true,
      'system.equipmentType': 'armor',
      'system.equipmentSubtype': 'mediumArmor',
      'system.armor.acp': 5,
    });
    for (const def of buffDefs) {
      await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
        name: def.name, type: 'buff',
        system: { active: true, buffType: 'temp', changes: def.changes },
      }]);
    }
    await new Promise(r => setTimeout(r, 800));
    return actor.id;
  }, { name, baseLand, buffDefs });
}

test('Chain Mail reduces land speed from 30 to 20 (Human)', async ({ page }) => {
  const actorId = await createActorWithArmorAndBuffs(page, 'Chain Human', 30, []);
  expect((await getSpeeds(page, actorId)).land.total).toBe(20);
});

test('Chain Mail + Haste: armor reduces 60->40 (cap 60, not over)', async ({ page }) => {
  const actorId = await createActorWithArmorAndBuffs(page, 'Chain+Haste', 30, [HASTE_SPEED]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(40);      // Haste adds to 60, armor reduces to 40
  expect(s.land.cap).toBe(60);        // 2x normal (unarmored) speed
  expect(s.land.isOvercap).toBe(false);
});


// ═══ Group 6 — Fly Maneuverability Dropdown (issue #1677) ══════════════════════

test('PC sheet fly maneuverability dropdown has all 5 options', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Fly Menu PC', type: 'character' });
    return actor.id;
  });
  const sheetId = await openSheet(page, actorId);
  const sheet   = page.locator(`#${sheetId}`);
  await sheet.locator('nav.sheet-navigation.tabs a[data-tab="attributes"]').click({ force: true });
  await sheet.locator('.tab[data-tab="attributes"]').waitFor({ state: 'visible', timeout: 8_000 });
  const select = sheet.locator('select[name="system.attributes.speed.fly.maneuverability"]');
  await select.waitFor({ state: 'visible', timeout: 5_000 });
  const labels = await Promise.all((await select.locator('option').all()).map(o => o.textContent()));
  expect(labels).toEqual(expect.arrayContaining(['Clumsy', 'Poor', 'Average', 'Good', 'Perfect']));
});

test('PC sheet fly maneuverability defaults to "average"', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    return (await Actor.create({ name: 'Fly Default PC', type: 'character' })).id;
  });
  const sheetId = await openSheet(page, actorId);
  const sheet   = page.locator(`#${sheetId}`);
  await sheet.locator('nav.sheet-navigation.tabs a[data-tab="attributes"]').click({ force: true });
  await sheet.locator('.tab[data-tab="attributes"]').waitFor({ state: 'visible', timeout: 8_000 });
  await expect(sheet.locator('select[name="system.attributes.speed.fly.maneuverability"]')).toHaveValue('average');
});

test('changing fly maneuverability via PC sheet dropdown persists', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    return (await Actor.create({ name: 'Fly Change PC', type: 'character' })).id;
  });
  const sheetId = await openSheet(page, actorId);
  const sheet   = page.locator(`#${sheetId}`);
  await sheet.locator('nav.sheet-navigation.tabs a[data-tab="attributes"]').click({ force: true });
  await sheet.locator('.tab[data-tab="attributes"]').waitFor({ state: 'visible', timeout: 8_000 });
  await sheet.locator('select[name="system.attributes.speed.fly.maneuverability"]').selectOption('good');
  await page.evaluate((sid) => {
    const sel = document.querySelector(`#${sid} select[name="system.attributes.speed.fly.maneuverability"]`);
    if (sel) sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, sheetId);
  await page.waitForFunction(
    (id) => game.actors.get(id)?.system.attributes.speed.fly.maneuverability === 'good', actorId, { timeout: 5_000 });
  expect(await page.evaluate((id) => game.actors.get(id).system.attributes.speed.fly.maneuverability, actorId)).toBe('good');
});

test('NPC sheet fly maneuverability dropdown has all 5 options', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    return (await Actor.create({ name: 'Fly Menu NPC', type: 'npc' })).id;
  });
  const sheet = page.locator(`#${await openSheet(page, actorId)}`);
  const select = sheet.locator('select[name="system.attributes.speed.fly.maneuverability"]');
  await select.waitFor({ state: 'visible', timeout: 5_000 });
  expect((await select.locator('option').all()).length).toBe(5);
});

test('changing fly maneuverability via NPC sheet dropdown persists', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    return (await Actor.create({ name: 'Fly Change NPC', type: 'npc' })).id;
  });
  const sheetId = await openSheet(page, actorId);
  await page.locator(`#${sheetId} select[name="system.attributes.speed.fly.maneuverability"]`).selectOption('perfect');
  await page.evaluate((sid) => {
    const sel = document.querySelector(`#${sid} select[name="system.attributes.speed.fly.maneuverability"]`);
    if (sel) sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, sheetId);
  await page.waitForFunction(
    (id) => game.actors.get(id)?.system.attributes.speed.fly.maneuverability === 'perfect', actorId, { timeout: 5_000 });
  expect(await page.evaluate((id) => game.actors.get(id).system.attributes.speed.fly.maneuverability, actorId)).toBe('perfect');
});


// ═══ Group 7 — Haste Formula Regression ════════════════════════════════════════

test('Haste formula works same as before (land 30 -> 60)', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'HasteRegress', null, [HASTE_SPEED]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(60);
  expect(s.land.isOvercap).toBe(false);
});


// ═══ Group 8 — allSpeeds ═══════════════════════════════════════════════════════

test('allSpeeds buff applies to fly speed when fly.base=10 on sheet', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'AllSpeedsFly',
    { attributes: { speed: { fly: { base: 10 } } } },
    [
      { name: 'Burst', changes: [['5', 'speed', 'allSpeeds', 'competence']] },
    ]);
  const s = await getSpeeds(page, actorId);
  expect(s.fly.total).toBe(15);  // 10 base + 5 Burst allSpeeds
  expect(s.land.total).toBe(35); // 30 base + 5
});


// ═══ Group 9 — Run Speed Recalculation ═════════════════════════════════════════

test('run speed recalculated after base-replace (Fly 60 -> run 240)', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'FlyRun', null, [FLY_SPELL]);
  const s = await getSpeeds(page, actorId);
  expect(s.fly.run).toBe(240); // 60 * 4
  expect(s.land.run).toBe(120);
});

test('run speed recalculated after Haste (land 60 -> run 240)', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'HasteRun', null, [HASTE_SPEED]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.run).toBe(240); // 60 * 4
});

test('run speed recalculated after manual base edit (fly.base=30 -> run 120)', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'ManualRun',
    { attributes: { speed: { fly: { base: 30 } } } },
    []);
  const s = await getSpeeds(page, actorId);
  expect(s.fly.run).toBe(120); // 30 * 4
});


// ═══ Group 10 — Speed Multiplier ═══════════════════════════════════════════════

test('speedMult halves all speeds', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'HalfSpeed', null, [
    { name: 'Slow', changes: [['0.5', 'speed', 'speedMult', 'untyped']] },
    HASTE_SPEED,
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(30); // (30 + 30) * 0.5 = 30
});


// ═══ Group 11 — basereplace + allSpeeds Stacking (sort order) ══════════════════

test('landSpeed basereplace 20 + allSpeeds untyped 20 = land 40', async ({ page }) => {
  // Deep Dwarf scenario — basereplace sets base, allSpeeds stacks on top
  const actorId = await createActorWithBuffs(page, 'DwarfAllSpeeds', null, [
    { name: 'DwarfRace', changes: [['20', 'speed', 'landSpeed', 'base-replace']] },
    { name: 'SpeedBuff', changes: [['20', 'speed', 'allSpeeds', 'untyped']] },
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(40);       // 20 base-replace + 20 allSpeeds
  expect(s.land.cap).toBe(40);         // 2 × 20
  expect(s.land.isOvercap).toBe(false);
  expect(s.land.run).toBe(160);        // 40 × 4
  expect(s.land.effectiveBase).toBe(20); // base-replace value
});

test('flySpeed basereplace 60 + allSpeeds untyped 20 → fly stays 60, land gets +20', async ({ page }) => {
  // allSpeeds checks .base field — fly.base=null means allSpeeds skips fly
  const actorId = await createActorWithBuffs(page, 'FlyAllSpeeds', null, [
    { name: 'Fly',     changes: [['60', 'speed', 'flySpeed', 'base-replace']] },
    { name: 'Burst',   changes: [['20', 'speed', 'allSpeeds', 'untyped']] },
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.fly.total).toBe(60);          // allSpeeds skips — fly.base is null
  expect(s.fly.cap).toBe(120);           // 2 × 60
  expect(s.fly.effectiveBase).toBe(60);  // base-replace value
  expect(s.land.total).toBe(50);         // 30 base + 20 allSpeeds
  expect(s.land.effectiveBase).toBe(30); // no base-replace on land → equals .base
});


// ═══ Group 12 — replace + allSpeeds Guard ═══════════════════════════════════════

test('landSpeed replace 5 + allSpeeds untyped 20 → land stays 5', async ({ page }) => {
  // allSpeeds adds to .total, but the replace was already applied;
  // the general loop skips .total additions for replaced speeds
  const actorId = await createActorWithBuffs(page, 'ReplaceAllSpeeds', null, [
    { name: 'Fog',     changes: [['5', 'speed', 'landSpeed', 'replace']] },
    { name: 'Burst',   changes: [['20', 'speed', 'allSpeeds', 'untyped']] },
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(5);    // replace is final
});

test('landSpeed replace 5 + Haste → land stays 5', async ({ page }) => {
  // Same guard: Haste enhancement on landSpeed should be skipped after replace
  const actorId = await createActorWithBuffs(page, 'ReplaceHaste', null, [
    SOLID_FOG,
    HASTE_SPEED,
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(5);    // replace is final, Haste skipped
});

test('flySpeed replace 30 + allSpeeds untyped 20 → fly stays 30, land gets +20', async ({ page }) => {
  // Fly replaced, land not replaced — land still gets allSpeeds bonus
  const actorId = await createActorWithBuffs(page, 'FlyReplaceAllSpeeds', null, [
    { name: 'FlyReplace', changes: [['30', 'speed', 'flySpeed', 'replace']] },
    { name: 'Burst',      changes: [['20', 'speed', 'allSpeeds', 'untyped']] },
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.fly.total).toBe(30);    // replace on fly, allSpeeds skipped
  expect(s.land.total).toBe(50);   // 30 base + 20 allSpeeds (land not replaced)
});


// ═══ Group 13 — effectiveBase field ════════════════════════════════════════════

test('effectiveBase equals .base when no base-replace active', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'EffBaseNone', null, []);
  const s = await getSpeeds(page, actorId);
  expect(s.land.effectiveBase).toBe(30);
  expect(s.fly.effectiveBase).toBe(0);
});

test('effectiveBase equals base-replace value when active', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'EffBaseReplace', null, [
    { name: 'RaceSpeed', changes: [['20', 'speed', 'landSpeed', 'base-replace']] },
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.effectiveBase).toBe(20);
  expect(s.land.total).toBe(20);
});

test('effectiveBase still equals .base when only additive change active', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'EffBaseAdditive', null, [
    { name: 'Boost', changes: [['10', 'speed', 'landSpeed', 'untyped']] },
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.effectiveBase).toBe(30); // .base unchanged
  expect(s.land.total).toBe(40);         // 30 + 10
});

test('effectiveBase resets to .base when base-replace buff removed', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'EffBaseReset', type: 'character' });
    const [buff] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'TempFly', type: 'buff',
      system: { active: true, buffType: 'temp', changes: [['60', 'speed', 'flySpeed', 'base-replace']] },
    }]);
    await new Promise(r => setTimeout(r, 800));
    await game.actors.get(actor.id).deleteEmbeddedDocuments('Item', [buff.id]);
    return actor.id;
  });
  await page.waitForFunction(
    (id) => game.actors.get(id)?.system.attributes.speed.fly.effectiveBase === 0,
    actorId,
    { timeout: 5000 }
  );
  const s = await getSpeeds(page, actorId);
  expect(s.fly.effectiveBase).toBe(0);
  expect(s.fly.total).toBe(0);
});


// ═══ Group 14 — Race base-replace (Dwarf / Gnome / Halfling / Merfolk / etc.) ═

test('Dwarf race base-replace 20: total=20, cap=40, effectiveBase=20', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'DwarfRace', null, [
    { name: 'Dwarf', changes: [['20', 'speed', 'landSpeed', 'base-replace']] },
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(20);
  expect(s.land.cap).toBe(40);
  expect(s.land.effectiveBase).toBe(20);
  expect(s.land.isOvercap).toBe(false);
});

test('Dwarf race base-replace 20 + Haste → 40 (capped at 2×20, isOvercap)', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'DwarfHaste2', null, [
    { name: 'Dwarf', changes: [['20', 'speed', 'landSpeed', 'base-replace']] },
    HASTE_SPEED,
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(40);
  expect(s.land.cap).toBe(40);
  expect(s.land.isOvercap).toBe(true);
  expect(s.land.effectiveBase).toBe(20);
});

test('Halfling race base-replace 20: total=20, cap=40', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'HalflingRace', null, [
    { name: 'Halfling', changes: [['20', 'speed', 'landSpeed', 'base-replace']] },
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(20);
  expect(s.land.cap).toBe(40);
  expect(s.land.effectiveBase).toBe(20);
});

test('Merfolk: land base-replace 5, swim base-replace 50', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'MerfolkRace', null, [
    { name: 'Merfolk', changes: [
      ['5',  'speed', 'landSpeed', 'base-replace'],
      ['50', 'speed', 'swimSpeed', 'base-replace'],
    ]},
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(5);
  expect(s.land.cap).toBe(10);
  expect(s.land.effectiveBase).toBe(5);
  expect(s.swim.total).toBe(50);
  expect(s.swim.cap).toBe(100);
  expect(s.swim.effectiveBase).toBe(50);
});

test('Aquatic elf: swim base-replace 40 → total=40, cap=80', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'AquaticElf', null, [
    { name: 'AquaticElf', changes: [['40', 'speed', 'swimSpeed', 'base-replace']] },
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.swim.total).toBe(40);
  expect(s.swim.cap).toBe(80);
  expect(s.swim.effectiveBase).toBe(40);
  expect(s.land.total).toBe(30); // unaffected
});

test('Sprite/pixie: land base-replace 20, fly base-replace 60', async ({ page }) => {
  const actorId = await createActorWithBuffs(page, 'Pixie', null, [
    { name: 'Pixie', changes: [
      ['20', 'speed', 'landSpeed', 'base-replace'],
      ['60', 'speed', 'flySpeed',  'base-replace'],
    ]},
  ]);
  const s = await getSpeeds(page, actorId);
  expect(s.land.total).toBe(20);
  expect(s.land.cap).toBe(40);
  expect(s.land.effectiveBase).toBe(20);
  expect(s.fly.total).toBe(60);
  expect(s.fly.cap).toBe(120);
  expect(s.fly.effectiveBase).toBe(60);
});
