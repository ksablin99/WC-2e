'use strict';

/**
 * E2E tests for the specialActions DSL execution.
 *
 * D35E specialActions is a semicolon-delimited string of action verbs:
 *   "Verb arguments on self|target; Verb arguments on self|target; ..."
 *
 * Execution entry point: actor.autoApplyActionsOnSelf(rawActionString)
 * which only processes "on self" actions. Target actions require a token.
 *
 * Variables substituted before execution: @cl, @dc, @spellDuration, etc.
 *
 * NOTE: `special-actions.spec.js` tests condition *filtering* (whether an
 * action appears in the chat card list). THIS file tests verb *execution* —
 * the actual state changes that result from calling autoApplyActionsOnSelf().
 *
 * Covers:
 *   1. `Condition set blind to true on self` sets the blind condition flag.
 *   2. `Condition set blind to false on self` clears the blind condition.
 *   3. Multiple semicolon-separated actions execute in sequence.
 *   4. `if` guard: action fires when condition is true.
 *   5. `if` guard: action is skipped when condition is false.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const CLASSES_PACK = 'warcraftrpg2e.classes';
const FIGHTER_ID   = 'sgwZt7dg1ZHXQlrW';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helper ─────────────────────────────────────────────────────────────────────

async function createActor(page) {
  return page.evaluate(async () => {
    const actor = await Actor.create({ name: 'SpecialActions DSL Actor', type: 'character' });
    return actor.id;
  });
}

async function createFighter(page, level = 5) {
  return page.evaluate(async ({ packId, classId, level }) => {
    const actor = await Actor.create({ name: 'SpecialActions Fighter', type: 'character' });
    const pack  = game.packs.get(packId);
    const cls   = await pack.getDocument(classId);
    const cd    = cls.toObject();
    cd.system.levels = level;
    await actor.createEmbeddedDocuments('Item', [cd]);
    return game.actors.get(actor.id).id;
  }, { packId: CLASSES_PACK, classId: FIGHTER_ID, level });
}

// ── 1. Condition set verb sets the flag ───────────────────────────────────────

test('Condition set blind to true on self sets blind condition flag', async ({ page }) => {
  const actorId = await createActor(page);

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).autoApplyActionsOnSelf(
      'Condition set blind to true on self',
    );
  }, { actorId });

  await page.waitForFunction(({ id }) => {
    return game.actors.get(id)?.system?.attributes?.conditions?.blind === true;
  }, { id: actorId }, { timeout: 4_000 });

  const blind = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.conditions.blind;
  }, { actorId });

  expect(blind).toBe(true);
});

// ── 2. Condition set false clears the flag ────────────────────────────────────

test('Condition set blind to false on self clears blind condition flag', async ({ page }) => {
  const actorId = await createActor(page);

  // First set it true
  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).update({ 'system.attributes.conditions.blind': true });
  }, { actorId });

  // Now clear it via DSL
  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).autoApplyActionsOnSelf(
      'Condition set blind to false on self',
    );
  }, { actorId });

  await page.waitForFunction(({ id }) => {
    return game.actors.get(id)?.system?.attributes?.conditions?.blind !== true;
  }, { id: actorId }, { timeout: 4_000 });

  const blind = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.conditions.blind;
  }, { actorId });

  expect(blind).toBe(false);
});

// ── 3. Multiple actions in one string all execute ─────────────────────────────

test('multiple semicolon-separated Condition actions all execute', async ({ page }) => {
  const actorId = await createActor(page);

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).autoApplyActionsOnSelf(
      'Condition set shaken to true on self; Condition set frightened to true on self',
    );
  }, { actorId });

  await page.waitForFunction(({ id }) => {
    const c = game.actors.get(id)?.system?.attributes?.conditions ?? {};
    return c.shaken === true && c.frightened === true;
  }, { id: actorId }, { timeout: 4_000 });

  const result = await page.evaluate(({ actorId }) => {
    const c = game.actors.get(actorId).system.attributes.conditions;
    return { shaken: c.shaken, frightened: c.frightened };
  }, { actorId });

  expect(result.shaken).toBe(true);
  expect(result.frightened).toBe(true);
});

// ── 4. `if` guard fires when condition is true ────────────────────────────────

test('if guard: action executes when condition evaluates true', async ({ page }) => {
  // Fighter 5 → @classes.fighter.level = 5 → condition "5 > 3" is true
  const actorId = await createFighter(page, 5);

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).autoApplyActionsOnSelf(
      'Condition set blind to true on self if @classes.fighter.level > 3',
    );
  }, { actorId });

  await page.waitForFunction(({ id }) => {
    return game.actors.get(id)?.system?.attributes?.conditions?.blind === true;
  }, { id: actorId }, { timeout: 4_000 });

  const blind = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.conditions.blind;
  }, { actorId });

  expect(blind).toBe(true);
});

// ── 5. `if` guard skips when condition is false ───────────────────────────────

test('if guard: action is skipped when condition evaluates false', async ({ page }) => {
  // Fighter 2 → @classes.fighter.level = 2 → condition "2 > 3" is false
  const actorId = await createFighter(page, 2);

  // Ensure blind starts as false/undefined
  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).autoApplyActionsOnSelf(
      'Condition set blind to true on self if @classes.fighter.level > 3',
    );
  }, { actorId });

  // Brief wait to confirm no change occurred
  await page.waitForTimeout(400);

  const blind = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).system.attributes.conditions.blind ?? false;
  }, { actorId });

  expect(blind).toBe(false);
});

// ── 6. Set field to parenthesised literal evaluates numerically ───────────────

test('Set feat field to (1) evaluates to number 1, not string "(1)"', async ({ page }) => {
  // Regression for issue #1666: (@useAmount) substituted to (1) must be
  // evaluated via Roll35e, not stored as the literal string "(1)".
  const actorId = await createActor(page);

  await page.evaluate(async ({ actorId }) => {
    const [item] = await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Test Feat',
      type: 'feat',
    }]);
    await game.actors.get(actorId).items.get(item.id).update({
      'system.uses.value': 0,
      'system.uses.max': 10,
      'system.uses.per': '',
    });
  }, { actorId });

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).autoApplyActionsOnSelf(
      'Set feat "Test Feat" field system.uses.value to (1) on self',
    );
  }, { actorId });

  await page.waitForFunction(({ id }) => {
    const v = game.actors.get(id)?.items.find(i => i.name === 'Test Feat')?.system?.uses?.value;
    return v !== undefined && v !== null && v !== 0;
  }, { id: actorId }, { timeout: 4_000 });

  const result = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).items.find(i => i.name === 'Test Feat')?.system?.uses?.value;
  }, { actorId });

  expect(typeof result).toBe('number');
  expect(result).toBe(1);
});

// ── 7. Set field to multiplication expression evaluates correctly ──────────────

test('Set feat field to (1*2) evaluates to number 2, not string "(1*2)"', async ({ page }) => {
  // Regression for issue #1666: (@useAmount*2) substituted to (1*2) must be
  // evaluated, not stored as the literal string "(1*2)".
  const actorId = await createActor(page);

  await page.evaluate(async ({ actorId }) => {
    const [item] = await game.actors.get(actorId).createEmbeddedDocuments('Item', [{
      name: 'Test Feat Mul',
      type: 'feat',
    }]);
    await game.actors.get(actorId).items.get(item.id).update({
      'system.uses.value': 0,
      'system.uses.max': 10,
      'system.uses.per': '',
    });
  }, { actorId });

  await page.evaluate(async ({ actorId }) => {
    await game.actors.get(actorId).autoApplyActionsOnSelf(
      'Set feat "Test Feat Mul" field system.uses.value to (1*2) on self',
    );
  }, { actorId });

  await page.waitForFunction(({ id }) => {
    const v = game.actors.get(id)?.items.find(i => i.name === 'Test Feat Mul')?.system?.uses?.value;
    return v !== undefined && v !== null && v !== 0;
  }, { id: actorId }, { timeout: 4_000 });

  const result = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).items.find(i => i.name === 'Test Feat Mul')?.system?.uses?.value;
  }, { actorId });

  expect(typeof result).toBe('number');
  expect(result).toBe(2);
});

// ── 8. (@useAmount) via item.use() substitutes and evaluates ──────────────────

test('(@useAmount) in Set field action substituted via item.use() sets numeric value', async ({ page }) => {
  // Full item.use() path: chatAttack.js replaces (@useAmount) → (1) for a
  // non-spell item with useAmount=1. The Set verb must then evaluate (1) as a
  // number, not store the string "(1)" on a numeric field.
  const actorId = await createActor(page);

  const itemId = await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    const [feat] = await actor.createEmbeddedDocuments('Item', [{
      name: 'UseAmount Feat',
      type: 'feat',
    }]);
    await actor.items.get(feat.id).update({
      'system.uses.value': 0,
      'system.uses.max': 10,
      'system.uses.per': '',
    });
    const [attack] = await actor.createEmbeddedDocuments('Item', [{
      name: 'UseAmount Attack',
      type: 'attack',
      system: {
        actionType: 'special',
        specialActions: [{
          name: 'Set Uses',
          action: 'Set feat "UseAmount Feat" field system.uses.value to (@useAmount) on self',
          condition: '',
          img: '',
        }],
      },
    }]);
    return attack.id;
  }, { actorId });

  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    await actor.items.get(itemId).use({ skipDialog: true });
  }, { actorId, itemId });

  await page.waitForFunction(({ id }) => {
    const v = game.actors.get(id)?.items.find(i => i.name === 'UseAmount Feat')?.system?.uses?.value;
    return v !== undefined && v !== null && v !== 0;
  }, { id: actorId }, { timeout: 8_000 });

  const result = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).items.find(i => i.name === 'UseAmount Feat')?.system?.uses?.value;
  }, { actorId });

  expect(typeof result).toBe('number');
  expect(result).toBe(1); // useAmount=1 for non-spell item.use()
});

// ── 9. (@useAmount*2) via item.use() substitutes and evaluates ────────────────

test('(@useAmount*2) in Set field action substituted via item.use() sets numeric value', async ({ page }) => {
  // Full item.use() path: chatAttack.js replaces (@useAmount*2) → (1*2).
  // The Set verb must evaluate (1*2) = 2, not store the string "(1*2)".
  const actorId = await createActor(page);

  const itemId = await page.evaluate(async ({ actorId }) => {
    const actor = game.actors.get(actorId);
    const [feat] = await actor.createEmbeddedDocuments('Item', [{
      name: 'UseAmount Mul Feat',
      type: 'feat',
    }]);
    await actor.items.get(feat.id).update({
      'system.uses.value': 0,
      'system.uses.max': 10,
      'system.uses.per': '',
    });
    const [attack] = await actor.createEmbeddedDocuments('Item', [{
      name: 'UseAmount Mul Attack',
      type: 'attack',
      system: {
        actionType: 'special',
        specialActions: [{
          name: 'Set Uses x2',
          action: 'Set feat "UseAmount Mul Feat" field system.uses.value to (@useAmount*2) on self',
          condition: '',
          img: '',
        }],
      },
    }]);
    return attack.id;
  }, { actorId });

  await page.evaluate(async ({ actorId, itemId }) => {
    const actor = game.actors.get(actorId);
    await actor.items.get(itemId).use({ skipDialog: true });
  }, { actorId, itemId });

  await page.waitForFunction(({ id }) => {
    const v = game.actors.get(id)?.items.find(i => i.name === 'UseAmount Mul Feat')?.system?.uses?.value;
    return v !== undefined && v !== null && v !== 0;
  }, { id: actorId }, { timeout: 8_000 });

  const result = await page.evaluate(({ actorId }) => {
    return game.actors.get(actorId).items.find(i => i.name === 'UseAmount Mul Feat')?.system?.uses?.value;
  }, { actorId });

  expect(typeof result).toBe('number');
  expect(result).toBe(2); // useAmount=1 → (1*2) = 2
});
