'use strict';

/**
 * E2E tests for ActorDamageHelper.calculateDamageToActor (Foundry client).
 *
 * Covers:
 *   - Energy: resistance, vulnerability (+50%, SRD round down), immunity, combined ER+vuln (#1537)
 *   - Damage reduction (DR): typeless vs DR/magic, magic enhancement bypass,
 *     alignment bypass (good/evil/lawful/chaotic)
 *   - DR material bypass: adamantine, alchemical silver, cold iron (weapon material flags)
 *   - applyHalf (save for half, etc.) on physical and energy
 *   - Mixed physical + energy in one damage array
 *   - Regeneration: non-lethal energy damage pool
 *
 * Stub actors use the same system.* shapes getERForActor / getDRForActor read.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

const defaultSystem = () => ({
  traits: { regen: null, incorporeal: false },
  attributes: { creatureType: 'humanoid' },
  combinedResistances: [],
  combinedDR: { any: 0, types: [] },
});

/** Default stub: humanoid, no regen, not incorporeal */
function baseActor(partial = {}) {
  const d = defaultSystem();
  return {
    system: {
      ...d,
      ...partial,
      traits: { ...d.traits, ...(partial.traits || {}) },
    },
  };
}

/**
 * @param {object} opts
 * @param {object} opts.actor
 * @param {Array} opts.damage
 * @param {object|null} [opts.material=null]
 * @param {object|null} [opts.alignment=null]  flags: good, evil, lawful, chaotic
 * @param {number} [opts.enh=0]
 * @param {boolean} [opts.applyHalf=false]
 * @param {boolean} [opts.incorporeal=false]
 */
async function calculateDamage(page, {
  actor,
  damage,
  material = null,
  alignment = null,
  enh = 0,
  applyHalf = false,
  incorporeal = false,
}) {
  return page.evaluate(
    ({ actor, damage, material, alignment, enh, applyHalf, incorporeal }) =>
      game.D35E.ActorDamageHelper.calculateDamageToActor(
        actor,
        damage,
        material,
        alignment,
        enh,
        false,
        false,
        incorporeal,
        applyHalf,
      ),
    { actor, damage, material, alignment, enh, applyHalf, incorporeal },
  );
}

// ── Energy: resistance, vulnerability, immunity ─────────────────────────────

test('energy: fire ER 5 only — 10 becomes 5', async ({ page }) => {
  const actor = baseActor({
    combinedResistances: [
      {
        uid: 'energy-fire',
        name: 'Fire',
        value: 5,
        vulnerable: false,
        immunity: false,
        lethal: false,
        half: false,
      },
    ],
  });
  const fd = await calculateDamage(page, {
    actor,
    damage: [{ damageTypeUid: 'energy-fire', roll: { total: 10 } }],
  });
  expect(fd.energyDamage[0]?.after).toBe(5);
});

test('energy: fire vulnerability only — 10 becomes 15', async ({ page }) => {
  const actor = baseActor({
    combinedResistances: [
      {
        uid: 'energy-fire',
        name: 'Fire',
        value: 0,
        vulnerable: true,
        immunity: false,
        lethal: false,
        half: false,
      },
    ],
  });
  const fd = await calculateDamage(page, {
    actor,
    damage: [{ damageTypeUid: 'energy-fire', roll: { total: 10 } }],
  });
  expect(fd.energyDamage[0]?.after).toBe(15);
});

test('energy: ER 5 + vulnerability — 10 becomes 7 (#1537)', async ({ page }) => {
  const actor = baseActor({
    combinedResistances: [
      {
        uid: 'energy-fire',
        name: 'Fire',
        value: 5,
        vulnerable: true,
        immunity: false,
        lethal: false,
        half: false,
      },
    ],
  });
  const fd = await calculateDamage(page, {
    actor,
    damage: [{ damageTypeUid: 'energy-fire', roll: { total: 10 } }],
  });
  // SRD: round down. (10 - 5) * 1.5 = 7.5 → 7
  expect(fd.energyDamage[0]?.after).toBe(7);
});

test('energy: immunity overrides ER and vulnerability — after is 0', async ({ page }) => {
  const actor = baseActor({
    combinedResistances: [
      {
        uid: 'energy-fire',
        name: 'Fire',
        value: 5,
        vulnerable: true,
        immunity: true,
        lethal: false,
        half: false,
      },
    ],
  });
  const fd = await calculateDamage(page, {
    actor,
    damage: [{ damageTypeUid: 'energy-fire', roll: { total: 10 } }],
  });
  expect(fd.energyDamage[0]?.after).toBe(0);
});

// ── Damage reduction (physical / typeless) ─────────────────────────────────

test('DR: typeless 10 vs DR 5/magic (non-magic) — HP damage 5', async ({ page }) => {
  const actor = baseActor({
    combinedDR: {
      any: 0,
      types: [
        {
          uid: 'magic',
          value: 5,
          or: false,
          lethal: false,
          immunity: false,
        },
      ],
    },
  });
  const fd = await calculateDamage(page, {
    actor,
    damage: [{ roll: { total: 10 } }],
    enh: 0,
  });
  expect(fd.baseBeforeDR).toBe(10);
  expect(fd.baseAfterDR).toBe(5);
  expect(fd.damage).toBe(5);
});

test('DR: typeless 10 vs DR 5/magic — +1 enhancement bypasses DR — HP damage 10', async ({ page }) => {
  const actor = baseActor({
    combinedDR: {
      any: 0,
      types: [
        {
          uid: 'magic',
          value: 5,
          or: false,
          lethal: false,
          immunity: false,
        },
      ],
    },
  });
  const fd = await calculateDamage(page, {
    actor,
    damage: [{ roll: { total: 10 } }],
    enh: 1,
  });
  expect(fd.baseAfterDR).toBe(10);
  expect(fd.damage).toBe(10);
});

test('DR: piercing 10 vs DR 5/piercing — piercing damage bypasses that DR — HP damage 10', async ({ page }) => {
  const actor = baseActor({
    combinedDR: {
      any: 0,
      types: [
        {
          uid: 'piercing',
          value: 5,
          or: false,
          lethal: false,
          immunity: false,
        },
      ],
    },
  });
  const fd = await calculateDamage(page, {
    actor,
    damage: [{ damageTypeUid: 'damage-piercing', roll: { total: 10 } }],
  });
  expect(fd.baseAfterDR).toBe(10);
  expect(fd.damage).toBe(10);
});

// ── DR: single-type stubs (alignment, material, etc.) ───────────────────────

function actorWithTypedDr(uid, value = 5) {
  return baseActor({
    combinedDR: {
      any: 0,
      types: [
        {
          uid,
          value,
          or: false,
          lethal: false,
          immunity: false,
        },
      ],
    },
  });
}

function materialStub(flags) {
  return { system: { ...flags } };
}

// ── DR: alignment bypass (good / evil / lawful / chaotic) ─────────────────────

test('DR: typeless 10 vs DR 5/good — non-good attack takes 5 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('good'),
    damage: [{ roll: { total: 10 } }],
    alignment: null,
  });
  expect(fd.damage).toBe(5);
});

test('DR: typeless 10 vs DR 5/good — good-aligned attack bypasses — 10 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('good'),
    damage: [{ roll: { total: 10 } }],
    alignment: { good: true, evil: false, lawful: false, chaotic: false },
  });
  expect(fd.damage).toBe(10);
});

test('DR: typeless 10 vs DR 5/evil — evil-aligned attack bypasses — 10 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('evil'),
    damage: [{ roll: { total: 10 } }],
    alignment: { good: false, evil: true, lawful: false, chaotic: false },
  });
  expect(fd.damage).toBe(10);
});

test('DR: typeless 10 vs DR 5/lawful — lawful-aligned attack bypasses — 10 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('lawful'),
    damage: [{ roll: { total: 10 } }],
    alignment: { good: false, evil: false, lawful: true, chaotic: false },
  });
  expect(fd.damage).toBe(10);
});

test('DR: typeless 10 vs DR 5/chaotic — chaotic-aligned attack bypasses — 10 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('chaotic'),
    damage: [{ roll: { total: 10 } }],
    alignment: { good: false, evil: false, lawful: false, chaotic: true },
  });
  expect(fd.damage).toBe(10);
});

test('DR: typeless 10 vs DR 5/evil — good-aligned attack does not bypass — 5 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('evil'),
    damage: [{ roll: { total: 10 } }],
    alignment: { good: true, evil: false, lawful: false, chaotic: false },
  });
  expect(fd.damage).toBe(5);
});

// ── DR: material bypass (adamantine / silver / cold iron) ─────────────────────

test('DR: typeless 10 vs DR 5/adamantine — mundane material takes 5 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('adamantine'),
    damage: [{ roll: { total: 10 } }],
    material: materialStub({
      isAdamantineEquivalent: false,
      isAlchemicalSilverEquivalent: false,
      isColdIronEquivalent: false,
    }),
  });
  expect(fd.damage).toBe(5);
});

test('DR: typeless 10 vs DR 5/adamantine — adamantine-equivalent weapon bypasses — 10 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('adamantine'),
    damage: [{ roll: { total: 10 } }],
    material: materialStub({ isAdamantineEquivalent: true }),
  });
  expect(fd.damage).toBe(10);
});

test('DR: typeless 10 vs DR 5/silver — non-silver weapon takes 5 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('silver'),
    damage: [{ roll: { total: 10 } }],
    material: materialStub({
      isAdamantineEquivalent: false,
      isAlchemicalSilverEquivalent: false,
      isColdIronEquivalent: false,
    }),
  });
  expect(fd.damage).toBe(5);
});

test('DR: typeless 10 vs DR 5/silver — alchemical silver equivalent bypasses — 10 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('silver'),
    damage: [{ roll: { total: 10 } }],
    material: materialStub({ isAlchemicalSilverEquivalent: true }),
  });
  expect(fd.damage).toBe(10);
});

test('DR: typeless 10 vs DR 5/coldiron — non-cold-iron weapon takes 5 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('coldiron'),
    damage: [{ roll: { total: 10 } }],
    material: materialStub({
      isAdamantineEquivalent: false,
      isAlchemicalSilverEquivalent: false,
      isColdIronEquivalent: false,
    }),
  });
  expect(fd.damage).toBe(5);
});

test('DR: typeless 10 vs DR 5/coldiron — cold iron equivalent bypasses — 10 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('coldiron'),
    damage: [{ roll: { total: 10 } }],
    material: materialStub({ isColdIronEquivalent: true }),
  });
  expect(fd.damage).toBe(10);
});

test('DR: typeless 10 vs DR 5/silver — cold iron only does not bypass silver DR — 5 HP', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: actorWithTypedDr('silver'),
    damage: [{ roll: { total: 10 } }],
    material: materialStub({
      isAdamantineEquivalent: false,
      isAlchemicalSilverEquivalent: false,
      isColdIronEquivalent: true,
    }),
  });
  expect(fd.damage).toBe(5);
});

// ── applyHalf ────────────────────────────────────────────────────────────────

test('applyHalf: typeless 10 no DR — HP damage 5', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: baseActor(),
    damage: [{ roll: { total: 10 } }],
    applyHalf: true,
  });
  expect(fd.baseBeforeDR).toBe(10);
  expect(fd.baseAfterDR).toBe(5);
  expect(fd.damage).toBe(5);
});

test('applyHalf: fire 10 no ER — energy line after 5, total HP damage 5', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: baseActor(),
    damage: [{ damageTypeUid: 'energy-fire', roll: { total: 10 } }],
    applyHalf: true,
  });
  expect(fd.energyDamage[0]?.after).toBe(5);
  expect(fd.damage).toBe(5);
});

// ── Mixed physical + energy ───────────────────────────────────────────────────

test('mixed: slashing 6 + fire 4, no DR/ER — total HP damage 10', async ({ page }) => {
  const fd = await calculateDamage(page, {
    actor: baseActor(),
    damage: [
      { damageTypeUid: 'damage-slashing', roll: { total: 6 } },
      { damageTypeUid: 'energy-fire', roll: { total: 4 } },
    ],
  });
  expect(fd.beforeDamage).toBe(10);
  expect(fd.damage).toBe(10);
});

test('mixed: typeless 6 + fire 4 with fire ER 2 — fire after 2, total 8', async ({ page }) => {
  const actor = baseActor({
    combinedResistances: [
      {
        uid: 'energy-fire',
        name: 'Fire',
        value: 2,
        vulnerable: false,
        immunity: false,
        lethal: false,
        half: false,
      },
    ],
  });
  const fd = await calculateDamage(page, {
    actor,
    damage: [
      { roll: { total: 6 } },
      { damageTypeUid: 'energy-fire', roll: { total: 4 } },
    ],
  });
  expect(fd.energyDamage[0]?.after).toBe(2);
  expect(fd.damage).toBe(8);
});

// ── Regeneration (energy → nonlethal) ───────────────────────────────────────

test('regeneration: fire 10 with regen — HP damage 0, nonlethal absorbs 10', async ({ page }) => {
  const actor = baseActor({
    traits: { regen: '1', incorporeal: false },
  });
  const fd = await calculateDamage(page, {
    actor,
    damage: [{ damageTypeUid: 'energy-fire', roll: { total: 10 } }],
  });
  expect(fd.damage).toBe(0);
  expect(fd.nonLethalDamage).toBe(10);
  expect(fd.energyDamage[0]?.after).toBe(0);
});
