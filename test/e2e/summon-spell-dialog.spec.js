'use strict';

/**
 * E2E checks for Summon Monster dialog data (v13 TableResult → template), attack-roll summon markup,
 * and the summon-duration buff (compendium retrieval, application, and expiry behaviour).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissSystemDialogs } = require('./helpers');

const SUMMON_MONSTER_I_TABLE_ID = 'qLwD4yuvOMTUSxsH';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
});

test('Summon Monster I table: document results resolve to compendium ids', async ({ page }) => {
  const sample = await page.evaluate(async (tableId) => {
    const pack = game.packs.get('warcraftrpg2e.summoning-roll-tables');
    const table = await pack.getDocument(tableId);
    const docType = CONST.TABLE_RESULT_TYPES.DOCUMENT;
    const first = [...table.results].find((r) => r.type === docType);
    if (!first) return null;
    let documentCollection = first.documentCollection;
    let documentId = first.documentId;
    if (!documentCollection || !documentId) {
      const parsed = foundry.utils.parseUuid(first.documentUuid);
      if (!parsed?.collection) return { error: 'parse' };
      const col = parsed.collection;
      documentCollection = col.metadata?.id ?? col.metadata?.name ?? col.id;
      documentId = parsed.documentId;
    }
    return { name: first.name, documentCollection, documentId };
  }, SUMMON_MONSTER_I_TABLE_ID);
  expect(sample).toBeTruthy();
  expect(sample.error).toBeUndefined();
  expect(sample.name).toBeTruthy();
  expect(sample.documentCollection).toBeTruthy();
  expect(sample.documentId).toBeTruthy();
});

test('attack-roll dialog template lists summon options without undefined labels', async ({ page }) => {
  const { html, firstOptionText } = await page.evaluate(async (tableId) => {
    const pack = game.packs.get('warcraftrpg2e.summoning-roll-tables');
    const table = await pack.getDocument(tableId);
    const summonableMonsters = [];
    const docType = CONST.TABLE_RESULT_TYPES.DOCUMENT;
    for (const result of table.results) {
      if (result.type !== docType) continue;
      let documentCollection = result.documentCollection;
      let documentId = result.documentId;
      if (!documentCollection || !documentId) {
        if (!result.documentUuid) continue;
        const parsed = foundry.utils.parseUuid(result.documentUuid);
        if (!parsed?.collection) continue;
        const col = parsed.collection;
        documentCollection = col.metadata?.id ?? col.metadata?.name ?? col.id;
        documentId = parsed.documentId;
      }
      if (!documentCollection || !documentId) continue;
      summonableMonsters.push({
        documentCollection,
        documentId,
        text: result.name,
        formula: '1',
      });
    }
    const rollModesForSelect = Object.keys(CONFIG.Dice.rollModes).map((k) => ({
      value: k,
      label: k,
    }));
    const html = await foundry.applications.handlebars.renderTemplate(
      'systems/warcraftrpg2e/templates/apps/attack-roll-dialog.html',
      {
        data: {},
        id: 'e2e-summon-dialog',
        item: { id: 'e2e-item' },
        targets: [],
        hasTargets: false,
        rollMode: Object.keys(CONFIG.Dice.rollModes)[0],
        rollModes: CONFIG.Dice.rollModes,
        rollModesForSelect,
        twoWeaponAttackTypes: {},
        attackType: 'primary',
        attackTypeSet: false,
        hasAttack: false,
        hasDamage: false,
        allowNoAmmo: false,
        noAmmoRequired: false,
        nonLethal: false,
        bonusPowerPointsMax: 0,
        isSpell: true,
        isPower: false,
        hasDamageAbility: false,
        isNaturalAttack: false,
        isPrimaryAttack: false,
        isWeaponAttack: false,
        isFlanking: false,
        flankingName: '',
        flankingImg: '',
        isThreatening: true,
        isRangedWeapon: false,
        ammunition: [],
        extraAttacksCount: 1,
        hasTemplate: false,
        isAlreadyProne: false,
        canPowerAttack: false,
        maxPowerAttackValue: 0,
        canManyshot: false,
        maxManyshotValue: 0,
        canGreaterManyshot: false,
        canRapidShot: false,
        canFlurryOfBlows: false,
        maxGreaterManyshotValue: 0,
        weaponFeats: [],
        weaponFeatsOptional: [],
        conditionals: [],
        summonableMonsters,
        hasFeats: false,
        hasFeatsOrSummons: true,
        allowMultipleUses: false,
        multipleUsesMax: 0,
      }
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const opt = doc.querySelector('select[name="selected-monster"] option');
    return { html, firstOptionText: opt?.textContent?.trim() ?? '' };
  }, SUMMON_MONSTER_I_TABLE_ID);

  expect(html).toContain('selected-monster');
  expect(firstOptionText).toBeTruthy();
  expect(firstOptionText).not.toMatch(/undefined/i);
  expect(html).not.toContain('undefined (undefined)');
});

test('actor chat delegated listeners work on popout-like container', async ({ page }) => {
  const triggered = await page.evaluate(async () => {
    const { ActorChatListener } = await import('/systems/warcraftrpg2e/module/actor/chat/chatListener.js');
    const { ActorChatActions } = await import('/systems/warcraftrpg2e/module/actor/chat/chatActions.js');

    const popoutRoot = document.createElement('section');
    popoutRoot.className = 'chat-popout';
    popoutRoot.innerHTML = `
      <article class="message">
        <div class="chat-card">
          <button data-action="summon"><span id="popout-summon">Summon</span></button>
        </div>
      </article>
    `;
    document.body.appendChild(popoutRoot);

    let summonCount = 0;
    const original = ActorChatActions._onChatCardButtonAction;
    ActorChatActions._onChatCardButtonAction = () => { summonCount += 1; };

    try {
      ActorChatListener.chatListeners(popoutRoot);
      const span = popoutRoot.querySelector('#popout-summon');
      span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return summonCount;
    } finally {
      ActorChatActions._onChatCardButtonAction = original;
      popoutRoot.remove();
    }
  });

  expect(triggered).toBe(1);
});

// ── 1. Summon duration buff — compendium template ─────────────────────────────

test('summon duration buff template is retrievable from the commonbuffs compendium', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const pack = game.packs.get('warcraftrpg2e.commonbuffs');
    if (!pack) return { error: 'pack not found' };
    const tpl = await pack.getDocument('z9x8y7w6v5u4t3s2');
    if (!tpl) return { error: 'document not found' };
    return {
      name: tpl.name,
      type: tpl.type,
      deleteOnExpiry: tpl.system?.timeline?.deleteOnExpiry,
      timelineEnabled: tpl.system?.timeline?.enabled,
      deactivateActions: (tpl.system?.deactivateActions ?? []).map((a) => a.action),
    };
  });

  expect(result.error).toBeUndefined();
  expect(result.name).toBe('Summon duration');
  expect(result.type).toBe('buff');
  expect(result.deleteOnExpiry).toBe(false);
  expect(result.timelineEnabled).toBe(true);
  expect(result.deactivateActions.length).toBeGreaterThanOrEqual(1);
  expect(result.deactivateActions.some((a) => a.toLowerCase().includes('banished'))).toBe(true);
});

// ── 2. Summon duration buff — application to actor ───────────────────────────

test('applySummonDurationBuffFromTemplate adds buff to actor with correct timeline', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Summon Test NPC', type: 'npc' });
    return actor.id;
  });

  try {
    await page.evaluate(async (aId) => {
      const { applySummonDurationBuffFromTemplate } = await import('/systems/warcraftrpg2e/module/actor/chat/summonDurationBuff.js');
      const actor = game.actors.get(aId);
      await applySummonDurationBuffFromTemplate(actor, 3);
    }, actorId);

    // Wait for the buff item to appear on the actor
    await page.waitForFunction((aId) => {
      const actor = game.actors.get(aId);
      return actor?.items.some((i) => i.name === 'Summon duration');
    }, actorId, { timeout: 5_000 });

    const buff = await page.evaluate((aId) => {
      const actor = game.actors.get(aId);
      const item = actor.items.find((i) => i.name === 'Summon duration');
      if (!item) return null;
      return {
        name: item.name,
        type: item.type,
        total: item.system?.timeline?.total,
        elapsed: item.system?.timeline?.elapsed,
        active: item.system?.active,
      };
    }, actorId);

    expect(buff).not.toBeNull();
    expect(buff.name).toBe('Summon duration');
    expect(buff.type).toBe('buff');
    expect(buff.total).toBe(3);
    expect(buff.elapsed).toBe(0);
    expect(buff.active).toBe(true);
  } finally {
    await page.evaluate(async (aId) => {
      const actor = game.actors.get(aId);
      if (actor) await actor.delete();
    }, actorId);
  }
});

// ── 3. Summon duration buff — expiry sets banished condition ─────────────────

test('deactivating the summon duration buff sets the banished condition on the actor', async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Summon Expiry NPC', type: 'npc' });
    return actor.id;
  });

  try {
    // Apply the buff
    await page.evaluate(async (aId) => {
      const { applySummonDurationBuffFromTemplate } = await import('/systems/warcraftrpg2e/module/actor/chat/summonDurationBuff.js');
      const actor = game.actors.get(aId);
      await applySummonDurationBuffFromTemplate(actor, 1);
    }, actorId);

    // Wait for the buff to be present and active
    await page.waitForFunction((aId) => {
      const actor = game.actors.get(aId);
      const item = actor?.items.find((i) => i.name === 'Summon duration');
      return item?.system?.active === true;
    }, actorId, { timeout: 5_000 });

    // Simulate expiry: set system.active = false on the buff item
    await page.evaluate(async (aId) => {
      const actor = game.actors.get(aId);
      const item = actor.items.find((i) => i.name === 'Summon duration');
      await item.update({ 'system.active': false });
    }, actorId);

    // Wait for the deactivate action to propagate the banished condition
    await page.waitForFunction((aId) => {
      const actor = game.actors.get(aId);
      return actor?.system?.attributes?.conditions?.banished === true;
    }, actorId, { timeout: 5_000 });

    const banished = await page.evaluate((aId) => {
      return game.actors.get(aId)?.system?.attributes?.conditions?.banished ?? false;
    }, actorId);

    expect(banished).toBe(true);
  } finally {
    await page.evaluate(async (aId) => {
      const actor = game.actors.get(aId);
      if (actor) await actor.delete();
    }, actorId);
  }
});
