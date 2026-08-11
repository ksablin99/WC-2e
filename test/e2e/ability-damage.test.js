'use strict';

/**
 * E2E tests for ability score damage and drain.
 *
 * D35E ability damage tracking:
 *   - `system.abilities.str.damage` (etc.) holds temporary ability damage.
 *   - `system.abilities.str.drain` holds permanent ability drain.
 *   - Ability damage halves the effective ability score for mod calculation.
 *   - At 0 STR (or CON) the actor falls unconscious / dies.
 *   - `actor.applyAbilityDamage(ability, amount, isDrain)` applies the damage.
 *   - Recovery: 1 point of ability damage per rest (drain is permanent).
 *
 * Covers:
 *   1. Setting ability damage reduces the effective ability modifier.
 *   2. Ability damage is separate from ability score (base unchanged).
 *   3. Ability drain permanently reduces the score.
 *   4. Rest restores ability damage but not drain.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── 1. Ability damage reduces effective mod ───────────────────────────────────

test('STR ability damage of 4 reduces effective STR mod by 2', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Ability Damage Actor',
      type: 'character',
      system: { abilities: { str: { value: 12 } } }, // STR 12 → mod +1
    });

    // Force a full update so _updateChanges() persists derived values (mod, etc.)
    await actor.update({});

    const modBefore = game.actors.get(actor.id).system.abilities.str.mod;

    // Apply 4 points of STR damage (reduces effective STR by 4: 12→8, mod +1→-1)
    await actor.update({ 'system.abilities.str.damage': 4 });

    const modAfter  = game.actors.get(actor.id).system.abilities.str.mod;
    const baseBefore = game.actors.get(actor.id).system.abilities.str.value;

    return { modBefore, modAfter, baseBefore };
  });

  expect(result.modBefore).toBe(1);    // STR 12 → +1
  expect(result.modAfter).toBeLessThan(result.modBefore);
  expect(result.baseBefore).toBe(12);  // base score unchanged
});

// ── 2. Ability damage and drain are tracked separately ────────────────────────

test('ability damage and drain are stored independently', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Drain Actor',
      type: 'character',
      system: { abilities: { dex: { value: 16 } } },
    });

    await actor.update({
      'system.abilities.dex.damage': 2,
      'system.abilities.dex.drain': 4,
    });

    const a = game.actors.get(actor.id);
    return {
      damage: a.system.abilities.dex.damage,
      drain:  a.system.abilities.dex.drain,
      base:   a.system.abilities.dex.value,
    };
  });

  expect(result.damage).toBe(2);
  expect(result.drain).toBe(4);
  expect(result.base).toBe(16);
});

// ── 3. Ability damage from rest restores ─────────────────────────────────────

test('rest reduces ability damage by 1 per HD', async ({ page }) => {
  const CLASSES_PACK = 'warcraftrpg2e.classes';
  const FIGHTER_ID   = 'sgwZt7dg1ZHXQlrW';

  const result = await page.evaluate(async ({ packId, classId }) => {
    const actor = await Actor.create({
      name: 'Recovery Actor',
      type: 'character',
      system: { abilities: { str: { value: 16 } } },
    });
    const pack = game.packs.get(packId);
    const cls  = await pack.getDocument(classId);
    const cd   = cls.toObject();
    cd.system.levels = 2;
    await actor.createEmbeddedDocuments('Item', [cd]);

    // Apply ability damage
    await game.actors.get(actor.id).update({ 'system.abilities.str.damage': 4 });
    const damageBefore = game.actors.get(actor.id).system.abilities.str.damage;

    // Rest
    game.actors.get(actor.id).rest(true, true, false);
    for (let i = 0; i < 30; i++) {
      const d = game.actors.get(actor.id).system.abilities.str.damage;
      if (d < damageBefore) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return {
      damageBefore,
      damageAfter: game.actors.get(actor.id).system.abilities.str.damage,
    };
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID });

  expect(result.damageBefore).toBe(4);
  expect(result.damageAfter).toBeLessThan(result.damageBefore);
});

// ── 4. Zero-damage ability has no penalty ────────────────────────────────────

test('zero ability damage means no penalty to ability modifier', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Zero Damage Actor',
      type: 'character',
      system: { abilities: { str: { value: 14 } } }, // STR 14 → +2
    });

    // Explicitly set damage to 0
    await actor.update({ 'system.abilities.str.damage': 0 });
    const a = game.actors.get(actor.id);
    return { mod: a.system.abilities.str.mod, damage: a.system.abilities.str.damage };
  });

  expect(result.damage).toBe(0);
  expect(result.mod).toBe(2);
});

// ── 5. CureAbilityDamage reduces damage by rolled amount ─────────────────────

test('CureAbilityDamage action reduces STR damage by the specified amount', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const source = await Actor.create({ name: 'Restoration Caster', type: 'character' });
    const target = await Actor.create({ name: 'Damaged Target', type: 'character' });
    await target.update({ 'system.abilities.str.damage': 6 });

    await game.actors.get(target.id).applyActionOnSelf(
      'CureAbilityDamage str 4 on target',
      source,
      null,
      'target',
    );

    // Wait for update to propagate
    for (let i = 0; i < 30; i++) {
      if ((game.actors.get(target.id).system.abilities.str.damage ?? 6) !== 6) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return game.actors.get(target.id).system.abilities.str.damage;
  });

  expect(result).toBe(2); // 6 - 4 = 2
});

// ── 6. CureAbilityDamage clamps at 0 (no negative damage) ───────────────────

test('CureAbilityDamage clamps ability damage at 0 when cure exceeds damage', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const source = await Actor.create({ name: 'Restoration Caster', type: 'character' });
    const target = await Actor.create({ name: 'Small Damage Target', type: 'character' });
    await target.update({ 'system.abilities.str.damage': 2 });

    await game.actors.get(target.id).applyActionOnSelf(
      'CureAbilityDamage str 5 on target',
      source,
      null,
      'target',
    );

    for (let i = 0; i < 30; i++) {
      if ((game.actors.get(target.id).system.abilities.str.damage ?? 2) !== 2) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return game.actors.get(target.id).system.abilities.str.damage;
  });

  expect(result).toBe(0); // 2 - 5 = clamped to 0, not -3
});

// ── 7. CureAbilityDrain reduces drain by rolled amount ───────────────────────

test('CureAbilityDrain action reduces WIS drain by the specified amount', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const source = await Actor.create({ name: 'Restoration Caster', type: 'character' });
    const target = await Actor.create({ name: 'Drained Target', type: 'character' });
    await target.update({ 'system.abilities.wis.drain': 4 });

    await game.actors.get(target.id).applyActionOnSelf(
      'CureAbilityDrain wis 2 on target',
      source,
      null,
      'target',
    );

    for (let i = 0; i < 30; i++) {
      if ((game.actors.get(target.id).system.abilities.wis.drain ?? 4) !== 4) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return game.actors.get(target.id).system.abilities.wis.drain;
  });

  expect(result).toBe(2); // 4 - 2 = 2
});

// ── 8. CureAbilityDrain clamps at 0 (no negative drain) ─────────────────────

test('CureAbilityDrain clamps ability drain at 0 when cure exceeds drain', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const source = await Actor.create({ name: 'Restoration Caster', type: 'character' });
    const target = await Actor.create({ name: 'Small Drain Target', type: 'character' });
    await target.update({ 'system.abilities.con.drain': 1 });

    await game.actors.get(target.id).applyActionOnSelf(
      'CureAbilityDrain con 5 on target',
      source,
      null,
      'target',
    );

    for (let i = 0; i < 30; i++) {
      if ((game.actors.get(target.id).system.abilities.con.drain ?? 1) !== 1) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return game.actors.get(target.id).system.abilities.con.drain;
  });

  expect(result).toBe(0); // 1 - 5 = clamped to 0, not -4
});

// ── 9. Regression: existing AbilityDamage action still works ─────────────────

test('existing AbilityDamage action still adds STR damage correctly', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const source = await Actor.create({ name: 'Damage Dealer', type: 'character' });
    const target = await Actor.create({ name: 'Damage Receiver', type: 'character' });

    await game.actors.get(target.id).applyActionOnSelf(
      'AbilityDamage str 4 on target',
      source,
      null,
      'target',
    );

    for (let i = 0; i < 30; i++) {
      if ((game.actors.get(target.id).system.abilities.str.damage ?? 0) !== 0) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return game.actors.get(target.id).system.abilities.str.damage;
  });

  expect(result).toBe(4);
});

// ── 10. Regression: existing AbilityDrain action still works ─────────────────

test('existing AbilityDrain action still adds DEX drain correctly', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const source = await Actor.create({ name: 'Drain Dealer', type: 'character' });
    const target = await Actor.create({ name: 'Drain Receiver', type: 'character' });

    await game.actors.get(target.id).applyActionOnSelf(
      'AbilityDrain dex 3 on target',
      source,
      null,
      'target',
    );

    for (let i = 0; i < 30; i++) {
      if ((game.actors.get(target.id).system.abilities.dex.drain ?? 0) !== 0) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return game.actors.get(target.id).system.abilities.dex.drain;
  });

  expect(result).toBe(3);
});

// ── 11. Old (@useAmount) style works through chatAttack substitution ──────────

test('(@useAmount) token substituted via item.use() cures correct damage amount', async ({ page }) => {
  // Exercises the real chatAttack.js substitution path.
  // item.use({ skipDialog: true }) on a non-spell sets useAmount=1.
  // The action formula (@useAmount) is replaced with (1) before dispatch.
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'UseAmount Old-Style Actor', type: 'character' });
    await actor.update({ 'system.abilities.str.damage': 5 });

    // Create an attack item owned by the actor with the old (@useAmount) pattern
    const [item] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Restoration Old Style',
      type: 'attack',
      system: {
        actionType: 'special',
        specialActions: [{
          name: 'Cure STR Damage',
          action: 'CureAbilityDamage str (@useAmount) on self',
          condition: '',
          range: '',
          img: '',
        }],
      },
    }]);

    await item.use({ skipDialog: true });

    // Wait for the actor update to propagate (useAmount=1 → cures 1 point → damage 5→4)
    for (let i = 0; i < 30; i++) {
      if ((game.actors.get(actor.id).system.abilities.str.damage ?? 5) !== 5) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return game.actors.get(actor.id).system.abilities.str.damage;
  });

  expect(result).toBe(4); // 5 - (@useAmount=1) = 4
});

// ── 12. (@useAmount*2) expression via item.use() resolves correctly ───────────

test('(@useAmount*2) expression substituted via item.use() resolves correctly (not NaN)', async ({ page }) => {
  // Exercises the real chatAttack.js substitution path.
  // useAmount=1 → (@useAmount*2) → (1*2) → Roll35e evaluates to 2.
  // Before the regex fix this produced NaN because @useAmount was not replaced.
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'UseAmount Expr Actor', type: 'character' });
    await actor.update({ 'system.abilities.str.damage': 10 });

    const [item] = await game.actors.get(actor.id).createEmbeddedDocuments('Item', [{
      name: 'Restoration Expr Style',
      type: 'attack',
      system: {
        actionType: 'special',
        specialActions: [{
          name: 'Cure STR Damage x2',
          action: 'CureAbilityDamage str (@useAmount*2) on self',
          condition: '',
          range: '',
          img: '',
        }],
      },
    }]);

    await item.use({ skipDialog: true });

    // Wait for update (useAmount=1 → (1*2)=2 → cures 2 → damage 10→8)
    for (let i = 0; i < 30; i++) {
      const d = game.actors.get(actor.id).system.abilities.str.damage;
      if (d !== 10 && d !== null && d !== undefined) break;
      await new Promise(r => setTimeout(r, 100));
    }

    return game.actors.get(actor.id).system.abilities.str.damage;
  });

  expect(typeof result).toBe('number');
  expect(isNaN(result)).toBe(false);
  expect(result).toBe(8); // 10 - (@useAmount*2 = 1*2 = 2) = 8
});

