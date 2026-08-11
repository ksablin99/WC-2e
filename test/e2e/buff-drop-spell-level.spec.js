'use strict';

/**
 * E2E tests for the buff-drop buff-level formula fix (issue #1531).
 *
 * When a compendium buff is dropped onto an item sheet, `_onDropBuff` appends
 * a special action whose "Set buff … field data.level to …" clause depends on
 * the *type* of the receiving item:
 *
 *   - spell  → `max(1,(@cl))`  (caster-level variable is available for spells)
 *   - any other type (feat, attack, weapon, …) → `1`  (@cl is not available)
 *
 * Covers:
 *   1. Dropping a buff onto a SPELL item yields `max(1,(@cl))` in the action string.
 *   2. Dropping a buff onto a FEAT item yields `1` (not `max(1,(@cl))`) in the
 *      action string.
 *   3. Dropping a buff onto an ATTACK item also yields `1`.
 *   4. Regression guard: spell item never gets a bare `to 1 on` in the set-level
 *      clause; feat/attack items never contain `max(1,(@cl))`.
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

// ── Shared helper: invoke _onDropBuff on an item via its sheet ────────────────
//
// Strategy: Foundry's ItemSheet exposes the wrapped document via `sheet.item`
// (which is `sheet.object`).  We do NOT need to render the sheet to the DOM —
// the sheet is instantiated on demand via `item.sheet` and its `_onDropBuff`
// method operates entirely on `this.item` (the document) plus `fromUuid`.
//
// We build a minimal synthetic event with a `dataTransfer.getData` stub that
// returns the JSON payload Foundry normally serialises during a real drag-drop.

/**
 * Drop the first buff found in warcraftrpg2e.commonbuffs onto the given item.
 * Returns the serialised specialActions array as a plain JS array.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} actorId
 * @param {string} itemId
 * @returns {Promise<Array<{name:string, action:string}>>}
 */
async function dropFirstBuffOntoItem(page, actorId, itemId) {
  return page.evaluate(async ({ actorId, itemId }) => {
    // 1. Fetch the first buff from the commonbuffs compendium.
    const buffPack = game.packs.get('warcraftrpg2e.commonbuffs');
    if (!buffPack) throw new Error('warcraftrpg2e.commonbuffs pack not found');
    await buffPack.getIndex();
    // Prefer an entry explicitly typed as 'buff'; fall back to the first entry.
    const buffEntry =
      buffPack.index.find(e => e.type === 'buff') ?? buffPack.index.contents[0];
    if (!buffEntry) throw new Error('warcraftrpg2e.commonbuffs has no indexed entries');

    // Resolve the full document so we can read its canonical .uuid (Foundry
    // computes the correct UUID string regardless of v12/v13 format differences).
    const buffDoc = await buffPack.getDocument(buffEntry._id);
    if (!buffDoc) throw new Error(`Could not load buff document ${buffEntry._id}`);
    const buffUuid = buffDoc.uuid; // e.g. "Compendium.warcraftrpg2e.commonbuffs.Item.XXXX"

    // 2. Resolve the item's sheet (no render needed — the sheet object holds a
    //    reference to the document even before rendering).
    const actor = game.actors.get(actorId);
    const item  = actor.items.get(itemId);
    const sheet = item.sheet;

    // 3. Synthetic drag-drop event.
    const mockEvent = {
      preventDefault: () => {},
      dataTransfer: {
        getData: (_type) => JSON.stringify({ type: 'Item', uuid: buffUuid }),
      },
    };

    // 4. Invoke the private method directly — this is the code path under test.
    await sheet._onDropBuff(mockEvent);

    // 5. Return plain data so Playwright can serialise it across the boundary.
    const fresh = game.actors.get(actorId).items.get(itemId);
    return (fresh.system.specialActions ?? []).map(a => ({ name: a.name, action: a.action }));
  }, { actorId, itemId });
}

// ── 1. Buff dropped on a SPELL item → max(1,(@cl)) ───────────────────────────

test('dropping a buff onto a spell item generates max(1,(@cl)) as the buff level', async ({ page }) => {
  const ids = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Buff Drop Spell Test', type: 'character' });
    const [spell] = await actor.createEmbeddedDocuments('Item', [{ name: 'Magic Missile', type: 'spell' }]);
    return { actorId: actor.id, itemId: spell.id };
  });

  const specialActions = await dropFirstBuffOntoItem(page, ids.actorId, ids.itemId);

  expect(specialActions).toHaveLength(1);

  const action = specialActions[0].action;
  // The set-level clause must use the caster-level formula.
  expect(action, 'spell: set-level clause should use max(1,(@cl))').toContain(
    'field data.level to max(1,(@cl)) on'
  );
  // Regression guard: must NOT contain a bare "to 1 on" in the level clause.
  expect(action, 'spell: set-level clause must NOT be the bare literal 1').not.toMatch(
    /field data\.level to 1 on/
  );
});

// ── 2. Buff dropped on a FEAT item → literal 1 ───────────────────────────────

test('dropping a buff onto a feat item generates literal 1 as the buff level', async ({ page }) => {
  const ids = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Buff Drop Feat Test', type: 'character' });
    const [feat] = await actor.createEmbeddedDocuments('Item', [{ name: 'Power Attack', type: 'feat' }]);
    return { actorId: actor.id, itemId: feat.id };
  });

  const specialActions = await dropFirstBuffOntoItem(page, ids.actorId, ids.itemId);

  expect(specialActions).toHaveLength(1);

  const action = specialActions[0].action;
  // The set-level clause must use the plain literal 1.
  expect(action, 'feat: set-level clause should be literal 1').toContain(
    'field data.level to 1 on'
  );
  // Regression guard: must NOT use the caster-level formula.
  expect(action, 'feat: set-level clause must NOT contain max(1,(@cl))').not.toContain(
    'max(1,(@cl))'
  );
});

// ── 3. Buff dropped on an ATTACK item → literal 1 ────────────────────────────

test('dropping a buff onto an attack item generates literal 1 as the buff level', async ({ page }) => {
  const ids = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Buff Drop Attack Test', type: 'character' });
    const [atk] = await actor.createEmbeddedDocuments('Item', [{ name: 'Longsword Strike', type: 'attack' }]);
    return { actorId: actor.id, itemId: atk.id };
  });

  const specialActions = await dropFirstBuffOntoItem(page, ids.actorId, ids.itemId);

  expect(specialActions).toHaveLength(1);

  const action = specialActions[0].action;
  // Attack items are non-spell — must use plain literal 1.
  expect(action, 'attack: set-level clause should be literal 1').toContain(
    'field data.level to 1 on'
  );
  expect(action, 'attack: set-level clause must NOT contain max(1,(@cl))').not.toContain(
    'max(1,(@cl))'
  );
});

// ── 4. Action string structure is complete (all three DSL verbs present) ──────

test('_onDropBuff action string contains all three expected DSL verbs', async ({ page }) => {
  // Test both item types in one pass to keep setup lean.
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Buff Drop Structure Test', type: 'character' });

    const [spell] = await actor.createEmbeddedDocuments('Item', [{ name: 'Fireball', type: 'spell' }]);
    const [feat]  = await actor.createEmbeddedDocuments('Item', [{ name: 'Dodge', type: 'feat' }]);

    const buffPack = game.packs.get('warcraftrpg2e.commonbuffs');
    await buffPack.getIndex();
    const entry = buffPack.index.find(e => e.type === 'buff') ?? buffPack.index.contents[0];
    const buffDoc = await buffPack.getDocument(entry._id);
    const buffUuid = buffDoc.uuid;

    async function doDropBuff(item) {
      const sheet = item.sheet;
      const mockEvent = {
        preventDefault: () => {},
        dataTransfer: { getData: () => JSON.stringify({ type: 'Item', uuid: buffUuid }) },
      };
      await sheet._onDropBuff(mockEvent);
      const fresh = game.actors.get(actor.id).items.get(item.id);
      return (fresh.system.specialActions ?? [])[0]?.action ?? '';
    }

    const spellAction = await doDropBuff(game.actors.get(actor.id).items.get(spell.id));
    const featAction  = await doDropBuff(game.actors.get(actor.id).items.get(feat.id));
    const buffName    = entry.name;

    return { spellAction, featAction, buffName };
  });

  // Both actions must include all three DSL verbs.
  for (const [label, action] of [['spell', result.spellAction], ['feat', result.featAction]]) {
    expect(action, `${label}: should contain 'Create unique'`).toContain('Create unique');
    expect(action, `${label}: should contain 'Set buff'`).toContain('Set buff');
    expect(action, `${label}: should contain 'field data.level to'`).toContain('field data.level to');
    expect(action, `${label}: should contain 'Activate buff'`).toContain('Activate buff');
  }

  // Spell gets the CL formula; feat gets the literal.
  expect(result.spellAction).toContain('max(1,(@cl))');
  expect(result.featAction).toContain('field data.level to 1 on');
  expect(result.featAction).not.toContain('max(1,(@cl))');
});
