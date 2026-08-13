'use strict';

/**
 * E2E: full-attack item — slot order, weapon fighting modes, and Str damage multiplier
 * when the attack dialog is skipped (shift/right-click/full-attack chain).
 *
 * SRD / PHB 3.5 (paraphrase, for sanity-checking expectations):
 * - Melee weapons normally add your full Strength bonus to damage on a hit.
 * - Two-weapon fighting: damage from the **off-hand** weapon adds **one-half** your Strength
 *   bonus (same rule whether the off-hand weapon is light or not; light mainly affects
 *   attack penalties and which hand is “off”).
 * - Wielding a one-handed melee weapon **two-handed** adds **1½ ×** your Strength bonus
 *   to damage instead of 1×.
 *
 * Fixture: STR 18 → +4 modifier. Dice forced to minimum: longsword 1d8+4 = 5 (primary);
 * dagger 1d4 + half(+4) = 1+2 = 3 (off-hand); longsword two-handed 1d8 + 1.5×(+4) = 1+6 = 7.
 * Local rules text: `.srd/combat.html` (Strength Bonus, Off-Hand Weapon, Wielding Two-Handed).
 * D35E may create both melee and thrown attack items for daggers — the helper picks `actionType === 'mwak'`.
 *
 * Covers GL#1488-style regressions (off-hand ×0.5, two-handed ×1.5) plus ordering,
 * multi-swing slots (`count`), and main-hand TWF modes that keep ×1 Str on the main hand.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const WEAPONS_PACK = 'warcraftrpg2e.weapons-and-ammo';
const CLASSES_PACK = 'warcraftrpg2e.classes';
const FEATS_PACK = 'warcraftrpg2e.feats';
const BESTIARY_PACK = 'warcraftrpg2e.bestiary';
const FIGHTER_ID = 'sgwZt7dg1ZHXQlrW';
const LONGSWORD_ID = 'zWRlna42PMJVX6un';
const DAGGER_ID = 'fOSuWwRSZLTrROch';
const WOLF_ID = '24cE9cIp58lbB66c';
const TIGER_ID = 'Ix821dQXV6RhGbI8';
const GRIFFON_ID = '5Oey15lWdza3kfaA';

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ slots: Array<{ weapon: 'longsword'|'dagger'; attackMode: string; count?: number }> }} config
 */
async function runFullAttackWithMinDice(page, config) {
  const expectedSwings = config.slots.reduce((n, s) => n + (s.count ?? 1), 0);

  return page.evaluate(
    async ({
      WEAPONS_PACK,
      CLASSES_PACK,
      FIGHTER_ID,
      LONGSWORD_ID,
      DAGGER_ID,
      slots,
      expectedSwings: swingCount,
    }) => {
      const waitForWeaponAttack = async (actor, weaponId, timeout = 8000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
          const a = game.actors.get(actor.id);
          const candidates = (a?.items.filter(
            (i) => i.type === 'attack' && i.system.originalWeaponId === weaponId,
          ) ?? []);
          const melee = candidates.find((i) => foundry.utils.getProperty(i.system, 'actionType') === 'mwak');
          const atk = melee ?? candidates[0];
          if (atk) return atk;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error(`Attack for weapon ${weaponId} not created in time`);
      };

      const actor = await Actor.create({
        name: 'E2E Full Attack',
        type: 'character',
        system: { abilities: { str: { value: 18 }, dex: { value: 14 }, con: { value: 14 } } },
      });

      const classPack = game.packs.get(CLASSES_PACK);
      const fighter = await classPack.getDocument(FIGHTER_ID);
      const classData = fighter.toObject();
      classData.system.levels = 1;
      await actor.createEmbeddedDocuments('Item', [classData]);

      const weaponPack = game.packs.get(WEAPONS_PACK);
      const longswordDoc = await weaponPack.getDocument(LONGSWORD_ID);
      const daggerDoc = await weaponPack.getDocument(DAGGER_ID);

      const createdWeapons = [];
      for (const slot of slots) {
        if (slot.weapon === 'longsword') {
          const [w] = await actor.createEmbeddedDocuments('Item', [longswordDoc.toObject()]);
          await actor.items.get(w.id).update({ 'system.equipped': true });
          createdWeapons.push({ kind: 'longsword', weaponId: w.id, attack: await waitForWeaponAttack(actor, w.id) });
        } else {
          const [w] = await actor.createEmbeddedDocuments('Item', [daggerDoc.toObject()]);
          await actor.items.get(w.id).update({ 'system.equipped': true });
          createdWeapons.push({ kind: 'dagger', weaponId: w.id, attack: await waitForWeaponAttack(actor, w.id) });
        }
      }

      const defaultAttackSlot = {
        _id: 1,
        name: '',
        img: '',
        primary: false,
        isWeapon: false,
        attackMode: 'primary',
        id: null,
        count: 0,
      };

      const attacks = {};
      for (let i = 0; i < 5; i++) {
        const key = `attack${i + 1}`;
        attacks[key] = foundry.utils.mergeObject(foundry.utils.duplicate(defaultAttackSlot), { _id: i + 1 });
      }

      slots.forEach((slot, idx) => {
        const w = createdWeapons[idx];
        const key = `attack${idx + 1}`;
        attacks[key] = {
          _id: idx + 1,
          name: w.attack.name,
          img: w.attack.img,
          primary: false,
          isWeapon: true,
          attackMode: slot.attackMode,
          id: w.attack.id,
          count: slot.count ?? 1,
        };
      });

      const [fullAttackItem] = await actor.createEmbeddedDocuments('Item', [
        {
          name: 'E2E Full Attack',
          type: 'full-attack',
          img: 'systems/warcraftrpg2e/icons/attack/full-attack.png',
          system: {
            attackType: 'full',
            description: { value: '', chat: '', unidentified: '' },
            attacks,
          },
        },
      ]);

      const faDoc = game.actors.get(actor.id).items.get(fullAttackItem.id);
      const modePatch = {};
      slots.forEach((slot, idx) => {
        const slotKey = `attack${idx + 1}`;
        modePatch[`system.attacks.${slotKey}.attackMode`] = slot.attackMode;
        modePatch[`system.attacks.${slotKey}.isWeapon`] = true;
      });
      await faDoc.update(modePatch);

      const prevUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.999999;

      const msgsBefore = game.messages.size;
      const filterAttackMsgs = () => {
        const slice = game.messages.contents.slice(msgsBefore);
        return slice.filter((m) => String(m.flags?.warcraftrpg2e?.template || '').includes('attack-roll'));
      };
      /** Wait until each expected attack card has a finalized numeric damage total (async rolls). */
      const attackRollsComplete = (attackMsgs) => {
        if (attackMsgs.length < swingCount) return false;
        return attackMsgs.every((m) => {
          const t = m.flags?.warcraftrpg2e?.chatTemplateData?.attacks?.[0]?.damage?.total;
          return typeof t === 'number';
        });
      };

      try {
        const item = game.actors.get(actor.id).items.get(fullAttackItem.id);
        await item.use({ skipDialog: true });
        const tEnd = Date.now() + 15000;
        while (Date.now() < tEnd) {
          if (attackRollsComplete(filterAttackMsgs())) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        await new Promise((r) => setTimeout(r, 400));
      } finally {
        CONFIG.Dice.randomUniform = prevUniform;
      }

      const attackMsgs = filterAttackMsgs();
      // Preserve append order — Foundry message ids are not chronological; do not sort by id.

      const rows = attackMsgs.map((m) => ({
        itemName: m.flags?.warcraftrpg2e?.chatTemplateData?.item?.name ?? '',
        total: m.flags?.warcraftrpg2e?.chatTemplateData?.attacks?.[0]?.damage?.total ?? null,
      }));

      const totals = rows.map((r) => r.total);

      return {
        rows,
        totals,
        attackMsgCount: attackMsgs.length,
        actorId: actor.id,
        expectedSwings: swingCount,
      };
    },
    {
      WEAPONS_PACK,
      CLASSES_PACK,
      FIGHTER_ID,
      LONGSWORD_ID,
      DAGGER_ID,
      slots: config.slots,
      expectedSwings,
    },
  );
}

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test.describe.serial('Full-attack item (skip dialog)', () => {
  /*
   * SRD: Full attack with TWF — primary hand deals normal weapon damage + full Str;
   * each off-hand hit adds half Str to damage. Two light off-hand daggers → two separate
   * damage rolls, both off-hand. Expected: 1d8(min)+4, 1d4(min)+2, 1d4(min)+2.
   */
  test('primary longsword then two off-hand daggers → 5, 3, 3', async ({ page }) => {
    const { rows, attackMsgCount, expectedSwings } = await runFullAttackWithMinDice(page, {
      slots: [
        { weapon: 'longsword', attackMode: 'primary' },
        { weapon: 'dagger', attackMode: 'offhand-light' },
        { weapon: 'dagger', attackMode: 'offhand-light' },
      ],
    });
    expect(expectedSwings).toBe(3);
    expect(attackMsgCount).toBe(3);
    const longswords = rows.filter((r) => /longsword/i.test(r.itemName));
    const daggers = rows.filter((r) => /dagger/i.test(r.itemName) && !/\bthrown\b/i.test(r.itemName));
    expect(longswords).toHaveLength(1);
    expect(longswords[0].total).toBe(5);
    expect(daggers).toHaveLength(2);
    expect(daggers.map((r) => r.total)).toEqual([3, 3]);
  });

  /*
   * SRD: Same multipliers as above; order here is **not** from the rules but from the
   * full-attack item resolving slots top-to-bottom. Confirms implementation follows
   * configured slot order (off-hand first, then primary) when emitting chat cards.
   */
  test('off-hand dagger then primary longsword → 3, 5 (slot order)', async ({ page }) => {
    const { rows, attackMsgCount } = await runFullAttackWithMinDice(page, {
      slots: [
        { weapon: 'dagger', attackMode: 'offhand-light' },
        { weapon: 'longsword', attackMode: 'primary' },
      ],
    });
    expect(attackMsgCount).toBe(2);
    expect(rows[0].itemName).toMatch(/dagger/i);
    expect(rows[0].total).toBe(3);
    expect(rows[1].itemName).toMatch(/longsword/i);
    expect(rows[1].total).toBe(5);
  });

  /*
   * SRD: “Strength Bonus: When you hit with a melee or thrown weapon, including a
   * melee touch attack, you normally add your Strength modifier to the damage …
   * If you’re using a weapon two-handed, add one and a half times your Strength bonus.”
   * Longsword 1d8, min die + 6 (1.5 × +4) = 7.
   */
  test('two-handed longsword → 7 (×1.5 Str)', async ({ page }) => {
    const { totals, attackMsgCount } = await runFullAttackWithMinDice(page, {
      slots: [{ weapon: 'longsword', attackMode: 'two-handed' }],
    });
    expect(attackMsgCount).toBe(1);
    expect(totals).toEqual([7]);
  });

  /*
   * SRD-adjacent / engine check: two separate one-handed weapons each flagged as “primary”
   * for damage (full Str each). Not a standard default for one full-attack routine in the
   * book (you’d normally mark one as off-hand), but valid as “two primary-hand swings” if
   * the table uses the item that way — expects 1d8+4 twice.
   */
  test('two primary longswords → 5, 5', async ({ page }) => {
    const { totals, attackMsgCount } = await runFullAttackWithMinDice(page, {
      slots: [
        { weapon: 'longsword', attackMode: 'primary' },
        { weapon: 'longsword', attackMode: 'primary' },
      ],
    });
    expect(attackMsgCount).toBe(2);
    expect(totals).toEqual([5, 5]);
  });

  /*
   * SRD: Typical TWF pattern — main hand (often with a one-handed weapon) gets full Str
   * to damage; light off-hand gets half Str. D35E’s “main-offhand-light” mode encodes the
   * main-hand side of that pairing (attack penalties differ from pure “primary”); damage
   * should still be 1d8+4 then 1d4+2.
   */
  test('main-hand longsword (main-offhand-light) then off-hand dagger → 5, 3', async ({ page }) => {
    const { rows, attackMsgCount } = await runFullAttackWithMinDice(page, {
      slots: [
        { weapon: 'longsword', attackMode: 'main-offhand-light' },
        { weapon: 'dagger', attackMode: 'offhand-light' },
      ],
    });
    expect(attackMsgCount).toBe(2);
    expect(rows[0].itemName).toMatch(/longsword/i);
    expect(rows[0].total).toBe(5);
    expect(rows[1].itemName).toMatch(/dagger/i);
    expect(rows[1].total).toBe(3);
  });

  /*
   * SRD: Off-hand damage still uses half Strength bonus even when the off-hand weapon is
   * not treated as “light” for attack penalties (“offhand-normal” in D35E). Dagger remains
   * 1d4 + 2 at minimum dice.
   */
  test('off-hand heavy (offhand-normal) dagger → 3 (×0.5 Str)', async ({ page }) => {
    const { totals, attackMsgCount } = await runFullAttackWithMinDice(page, {
      slots: [{ weapon: 'dagger', attackMode: 'offhand-normal' }],
    });
    expect(attackMsgCount).toBe(1);
    expect(totals).toEqual([3]);
  });

  /*
   * SRD: Two hits with the same off-hand configuration (e.g. double weapon or item
   * “count” representing two swings from one slot) should each get half Str on damage.
   * Both min: 1d4+2.
   */
  test('same slot count 2 off-hand dagger → 3, 3', async ({ page }) => {
    const { totals, attackMsgCount, expectedSwings } = await runFullAttackWithMinDice(page, {
      slots: [{ weapon: 'dagger', attackMode: 'offhand-light', count: 2 }],
    });
    expect(expectedSwings).toBe(2);
    expect(attackMsgCount).toBe(2);
    expect(totals).toEqual([3, 3]);
  });

  /*
   * SRD: A single primary longsword attack in a full round — one damage roll, full Str.
   * Also checks that unused full-attack slots do not emit extra attack rolls/cards.
   */
  test('primary longsword only (other full-attack slots empty) → one chat card', async ({ page }) => {
    const { totals, attackMsgCount } = await runFullAttackWithMinDice(page, {
      slots: [{ weapon: 'longsword', attackMode: 'primary' }],
    });
    expect(attackMsgCount).toBe(1);
    expect(totals).toEqual([5]);
  });
});

/*
 * NPC summon checks (below) are intentionally loose: they assert swing count + numeric damage only.
 *
 * After GitLab #1430 (primary/secondary natural-attack cleanup) lands, revisit these tests and
 * lock in expected per-attack damage totals (min dice + correct Str/natural multipliers per slot),
 * similar to the PC full-attack scenarios above.
 */
const SUMMON_PACK = 'warcraftrpg2e.summon';

/** Compendium NPCs with different full-attack layouts (imported verbatim, then `use({ skipDialog: true })`). */
const NPC_FULL_ATTACK_FIXTURES = [
  {
    docId: 'Wwoc40RzQvWbBEII',
    label: 'Wolverine — natural 2× claw + bite',
  },
  {
    docId: 'Gi3eJKylMNRHrlmN',
    label: 'Xill — manufactured 2× longbow',
  },
  {
    docId: '7y0h3Rjy6FsYc4iE',
    label: 'Vrock — natural 2× claw + bite + 2× talon',
  },
];

/**
 * Import an NPC from `warcraftrpg2e.summon`, run its full-attack item with dialog skipped, pin dice min.
 * @param {import('@playwright/test').Page} page
 * @param {string} docId compendium actor id
 */
async function runSummonNpcFullAttack(page, docId) {
  return page.evaluate(
    async ({ packId, docId: id }) => {
      const pack = game.packs.get(packId);
      if (!pack) throw new Error(`Missing pack ${packId}`);
      const src = await pack.getDocument(id);
      if (!src) throw new Error(`Missing actor ${id}`);
      const actor = await Actor.create(src.toObject());
      const fa = actor.items.find((i) => i.type === 'full-attack');
      if (!fa) throw new Error(`No full-attack item on imported actor ${actor.name}`);

      let swings = 0;
      for (let si = 1; si <= 5; si++) {
        const slot = foundry.utils.getProperty(fa.system, `attacks.attack${si}`);
        if (!slot) continue;
        const sid = foundry.utils.getProperty(slot, 'id');
        if (!sid) continue;
        swings += Number(foundry.utils.getProperty(slot, 'count') ?? 1) || 1;
      }
      if (swings < 1) throw new Error('Full-attack item has no occupied weapon slots');

      const prevUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.999999;
      const msgsBefore = game.messages.size;
      const filterAttackMsgs = () => {
        const slice = game.messages.contents.slice(msgsBefore);
        return slice.filter((m) => String(m.flags?.warcraftrpg2e?.template || '').includes('attack-roll'));
      };
      const attackRollsComplete = (attackMsgs) => {
        if (attackMsgs.length < swings) return false;
        return attackMsgs.every((m) => {
          const t = m.flags?.warcraftrpg2e?.chatTemplateData?.attacks?.[0]?.damage?.total;
          return typeof t === 'number';
        });
      };

      try {
        const item = game.actors.get(actor.id).items.get(fa.id);
        await item.use({ skipDialog: true });
        const tEnd = Date.now() + 25000;
        while (Date.now() < tEnd) {
          if (attackRollsComplete(filterAttackMsgs())) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        await new Promise((r) => setTimeout(r, 500));
      } finally {
        CONFIG.Dice.randomUniform = prevUniform;
      }

      const attackMsgs = filterAttackMsgs();
      const damageTotals = attackMsgs.map(
        (m) => m.flags?.warcraftrpg2e?.chatTemplateData?.attacks?.[0]?.damage?.total ?? null,
      );

      return {
        actorName: actor.name,
        swings,
        attackMsgCount: attackMsgs.length,
        damageTotals,
      };
    },
    { packId: SUMMON_PACK, docId },
  );
}

test.describe.serial('NPC full-attack (warcraftrpg2e.summon compendium, skip dialog)', () => {
  for (const { docId, label } of NPC_FULL_ATTACK_FIXTURES) {
    test(label, async ({ page }) => {
      const r = await runSummonNpcFullAttack(page, docId);
      expect(r.attackMsgCount, `actor=${r.actorName} docId=${docId}`).toBe(r.swings);
      expect(
        r.damageTotals.every((t) => typeof t === 'number' && !Number.isNaN(t)),
        `damageTotals=${JSON.stringify(r.damageTotals)} actor=${r.actorName}`,
      ).toBe(true);
    });
  }
});

/**
 * Import a bestiary monster, optionally mutate feats, run its first full-attack item,
 * and return per-swing attack + damage totals with dice pinned to minimum.
 * @param {import('@playwright/test').Page} page
 * @param {{ docId: string, addFeatId?: string|null, removeFeatName?: string|null, debug?: boolean }} config
 */
async function runBestiaryMonsterFullAttack(page, { docId, addFeatId = null, removeFeatName = null, debug = false }) {
  return page.evaluate(
    async ({ bestiaryPackId, featsPackId, docId, addFeatId, removeFeatName, debug }) => {
      const bestiaryPack = game.packs.get(bestiaryPackId);
      if (!bestiaryPack) throw new Error(`Missing pack ${bestiaryPackId}`);
      const src = await bestiaryPack.getDocument(docId);
      if (!src) throw new Error(`Missing actor ${docId}`);
      const actor = await Actor.create(src.toObject());

      if (removeFeatName) {
        const feat = actor.items.find((i) => i.type === 'feat' && i.name === removeFeatName);
        if (feat) await feat.delete();
      }
      if (addFeatId) {
        const featsPack = game.packs.get(featsPackId);
        if (!featsPack) throw new Error(`Missing pack ${featsPackId}`);
        const featDoc = await featsPack.getDocument(addFeatId);
        if (!featDoc) throw new Error(`Missing feat ${addFeatId}`);
        await actor.createEmbeddedDocuments('Item', [featDoc.toObject()]);
      }

      const a = game.actors.get(actor.id);
      const fa = a.items.find((i) => i.type === 'full-attack');
      if (!fa) throw new Error(`No full-attack item on imported actor ${a.name}`);

      const slotEntries = [];
      let swings = 0;
      for (let si = 1; si <= 5; si++) {
        const slot = foundry.utils.getProperty(fa.system, `attacks.attack${si}`);
        if (!slot?.id) continue;
        const count = Number(foundry.utils.getProperty(slot, 'count') ?? 1) || 1;
        swings += count;
        slotEntries.push({
          slot: `attack${si}`,
          id: slot.id,
          name: slot.name,
          count,
          primary: !!slot.primary,
          attackMode: foundry.utils.getProperty(slot, 'attackMode') ?? 'primary',
        });
      }
      if (swings < 1) throw new Error('Full-attack item has no occupied weapon slots');

      const attackItems = a.items
        .filter((i) => i.type === 'attack')
        .map((i) => ({
          id: i.id,
          name: i.name,
          attackType: i.system.attackType,
          primaryAttack: !!i.system.primaryAttack,
          damageFormula: i.system.damage.parts?.[0]?.[0] ?? '',
        }));

      const prevUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.999999;
      const msgsBefore = game.messages.size;
      const filterAttackMsgs = () => {
        const slice = game.messages.contents.slice(msgsBefore);
        return slice.filter((m) => String(m.flags?.warcraftrpg2e?.template || '').includes('attack-roll'));
      };
      const attackRollsComplete = (attackMsgs) => {
        if (attackMsgs.length < swings) return false;
        return attackMsgs.every((m) => {
          const swing = m.flags?.warcraftrpg2e?.chatTemplateData?.attacks?.[0];
          return typeof swing?.damage?.total === 'number' && typeof (swing?.attack?.total ?? swing?.total) === 'number';
        });
      };

      try {
        await a.items.get(fa.id).use({ skipDialog: true });
        const tEnd = Date.now() + 25000;
        while (Date.now() < tEnd) {
          if (attackRollsComplete(filterAttackMsgs())) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        await new Promise((r) => setTimeout(r, 500));
      } finally {
        CONFIG.Dice.randomUniform = prevUniform;
      }

      const rows = filterAttackMsgs().map((m) => {
        const swing = m.flags?.warcraftrpg2e?.chatTemplateData?.attacks?.[0] ?? {};
        const li = document.querySelector(`#chat-log .message[data-message-id="${m.id}"]`);
        return {
          itemName: m.flags?.warcraftrpg2e?.chatTemplateData?.item?.name ?? '',
          attackTotal: swing?.attack?.total ?? swing?.total ?? null,
          damageTotal: swing?.damage?.total ?? null,
          ...(debug
            ? {
                attackTooltip: swing?.attack?.tooltip ?? '',
                damageTooltip: swing?.damage?.tooltip ?? '',
                chatHtml: li?.outerHTML ?? '',
                messageFlags: foundry.utils.duplicate(m.flags?.warcraftrpg2e ?? {}),
              }
            : {}),
        };
      });

      return {
        actorName: a.name,
        strMod: a.system.abilities?.str?.mod ?? null,
        naturalAttackCount: a.system.naturalAttackCount,
        featNames: a.items.filter((i) => i.type === 'feat').map((i) => i.name),
        swings,
        rows,
        slotEntries,
        attackItems,
      };
    },
    {
      bestiaryPackId: BESTIARY_PACK,
      featsPackId: FEATS_PACK,
      docId,
      addFeatId,
      removeFeatName,
      debug,
    },
  );
}

/**
 * Import a bestiary monster, open a named natural attack through the roll dialog,
 * inspect the primary-attack checkbox state, submit the dialog, and return the result.
 * @param {import('@playwright/test').Page} page
 * @param {{ docId: string, attackName: string, removeFeatName?: string|null, debug?: boolean }} config
 */
async function runBestiaryMonsterAttackViaDialog(page, { docId, attackName, removeFeatName = null, debug = false }) {
  const setup = await page.evaluate(
    async ({ bestiaryPackId, docId, attackName, removeFeatName, debug }) => {
      const bestiaryPack = game.packs.get(bestiaryPackId);
      if (!bestiaryPack) throw new Error(`Missing pack ${bestiaryPackId}`);
      const src = await bestiaryPack.getDocument(docId);
      if (!src) throw new Error(`Missing actor ${docId}`);
      const actor = await Actor.create(src.toObject());

      if (removeFeatName) {
        const feat = actor.items.find((i) => i.type === 'feat' && i.name === removeFeatName);
        if (feat) await feat.delete();
      }

      const a = game.actors.get(actor.id);
      const attack = a.items.find((i) => i.type === 'attack' && i.name === attackName);
      if (!attack) throw new Error(`No attack item named ${attackName} on imported actor ${a.name}`);

      const existingAppIds = Object.values(ui.windows)
        .filter((w) => w.data?.buttons?.normal)
        .map((w) => w.appId);
      const msgsBefore = game.messages.size;

      window.__e2ePrevRandomUniform = CONFIG.Dice.randomUniform;
      CONFIG.Dice.randomUniform = () => 0.999999;

      attack.use({ skipDialog: false }).catch(() => {});

      const activeDialog = Object.values(ui.windows)
        .filter((w) => w.data?.buttons?.normal)
        .find((w) => !existingAppIds.includes(w.appId));
      const dialogRoot = activeDialog?.element instanceof HTMLElement ? activeDialog.element : activeDialog?.element?.[0];

      return {
        actorName: a.name,
        existingAppIds,
        msgsBefore,
        ...(debug ? { dialogHtml: dialogRoot?.outerHTML ?? '' } : {}),
      };
    },
    {
      bestiaryPackId: BESTIARY_PACK,
      docId,
      attackName,
      removeFeatName,
      debug,
    },
  );

  await page.waitForFunction(
    (ids) => {
      const dlg = Object.values(ui.windows).find((w) => w.data?.buttons?.normal && !ids.includes(w.appId));
      if (!dlg) return false;
      const root = dlg.element;
      const el = root instanceof HTMLElement ? root : root?.[0];
      return !!el?.querySelector?.('form.attack-form');
    },
    setup.existingAppIds,
    { timeout: 5_000 },
  );

  const dialogState = await page.evaluate(({ ids, debug }) => {
    const candidates = Object.values(ui.windows).filter((w) => w.data?.buttons?.normal && !ids.includes(w.appId));
    const dialog = candidates.length
      ? candidates.reduce((a, b) => (Number(a.appId) > Number(b.appId) ? a : b))
      : null;
    if (!dialog) return null;
    const root = dialog.element instanceof HTMLElement ? dialog.element : dialog.element?.[0];
    const checkbox = root?.querySelector?.('input[name="primary-attack"]');
    return {
      hasPrimaryCheckbox: !!checkbox,
      primaryChecked: !!checkbox?.checked,
      ...(debug ? { dialogHtml: root?.outerHTML ?? '' } : {}),
    };
  }, { ids: setup.existingAppIds, debug });

  await page.evaluate((ids) => {
    const candidates = Object.values(ui.windows).filter((w) => w.data?.buttons?.normal && !ids.includes(w.appId));
    const dialog = candidates.length
      ? candidates.reduce((a, b) => (Number(a.appId) > Number(b.appId) ? a : b))
      : null;
    if (dialog) dialog.submit(dialog.data.buttons.normal);
  }, setup.existingAppIds);

  await page.waitForFunction((count) => game.messages.size > count, setup.msgsBefore, { timeout: 8_000 });

  const chat = await page.evaluate((debug) => {
    const msg = game.messages.contents.at(-1);
    const swing = msg?.flags?.warcraftrpg2e?.chatTemplateData?.attacks?.[0] ?? {};
    const li = document.querySelector(`#chat-log .message[data-message-id="${msg?.id}"]`);
    return {
      itemName: msg?.flags?.warcraftrpg2e?.chatTemplateData?.item?.name ?? '',
      attackTotal: swing?.attack?.total ?? swing?.total ?? null,
      attackTooltip: swing?.attack?.tooltip ?? '',
      damageTotal: swing?.damage?.total ?? null,
      ...(debug
        ? {
            damageTooltip: swing?.damage?.tooltip ?? '',
            chatHtml: li?.outerHTML ?? '',
            messageFlags: foundry.utils.duplicate(msg?.flags?.warcraftrpg2e ?? {}),
          }
        : {}),
    };
  }, debug);

  await page.evaluate(() => {
    if (window.__e2ePrevRandomUniform) {
      CONFIG.Dice.randomUniform = window.__e2ePrevRandomUniform;
      delete window.__e2ePrevRandomUniform;
    }
  });

  return {
    actorName: setup.actorName,
    ...(setup.dialogHtml ? { dialogHtml: setup.dialogHtml } : {}),
    ...dialogState,
    ...chat,
  };
}

function minDamageDie(formula) {
  const match = /^(\d+)d(\d+)$/.exec(String(formula || '').trim());
  if (!match) return null;
  return Number(match[1]);
}

test.describe.serial('Monster natural full-attack (warcraftrpg2e.bestiary, skip dialog)', () => {
  test('Wolf sole natural bite uses 1.5x Strength damage in full attack', async ({ page }) => {
    const result = await runBestiaryMonsterFullAttack(page, { docId: WOLF_ID });

    expect(result.actorName).toBe('Wolf');
    expect(result.naturalAttackCount).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].itemName).toBe('Bite');

    const bite = result.attackItems.find((i) => i.name === 'Bite');
    expect(bite?.primaryAttack).toBe(true);
    expect(bite?.attackType).toBe('natural');

    const minBase = minDamageDie(bite?.damageFormula);
    expect(minBase).toBe(1);
    expect(result.rows[0].damageTotal).toBe(minBase + Math.floor(result.strMod * 1.5));
  });

  test('Tiger full attack is bite + two claws, excludes rake, and claws stay 5 below bite as secondary attacks', async ({
    page,
  }) => {
    const base = await runBestiaryMonsterFullAttack(page, { docId: TIGER_ID });

    expect(base.actorName).toBe('Tiger');
    expect(base.featNames).not.toContain('Multiattack');
    expect(base.naturalAttackCount).toBe(2);
    expect(base.rows).toHaveLength(3);
    expect(base.rows.filter((r) => r.itemName === 'Claw')).toHaveLength(2);
    expect(base.rows.filter((r) => r.itemName === 'Bite')).toHaveLength(1);
    expect(base.rows.some((r) => r.itemName === 'Rake')).toBe(false);

    const biteAttack = base.attackItems.find((i) => i.name === 'Bite');
    const clawAttack = base.attackItems.find((i) => i.name === 'Claw');
    expect(biteAttack?.primaryAttack).toBe(true);
    expect(clawAttack?.primaryAttack).toBe(false);

    const baseBiteTotal = base.rows.find((r) => r.itemName === 'Bite')?.attackTotal;
    const baseClawTotals = base.rows.filter((r) => r.itemName === 'Claw').map((r) => r.attackTotal);
    expect(baseBiteTotal).toBe(10);
    expect(baseClawTotals).toEqual([5, 5]);
    expect(baseClawTotals).toEqual(baseClawTotals.map(() => baseBiteTotal - 5));
  });

  test('Griffon full attack excludes rake and keeps bite primary with two claw swings', async ({ page }) => {
    const withMultiattack = await runBestiaryMonsterFullAttack(page, { docId: GRIFFON_ID });

    expect(withMultiattack.actorName).toBe('Griffon');
    expect(withMultiattack.featNames).toContain('Multiattack');
    expect(withMultiattack.rows).toHaveLength(3);
    expect(withMultiattack.rows.filter((r) => r.itemName === 'Claw')).toHaveLength(2);
    expect(withMultiattack.rows.filter((r) => r.itemName === 'Bite')).toHaveLength(1);
    expect(withMultiattack.rows.some((r) => r.itemName === 'Rake')).toBe(false);

    const biteAttack = withMultiattack.attackItems.find((i) => i.name === 'Bite');
    const clawAttack = withMultiattack.attackItems.find((i) => i.name === 'Claw');
    expect(biteAttack?.primaryAttack).toBe(true);
    expect(clawAttack?.primaryAttack).toBe(false);

    const biteTotal = withMultiattack.rows.find((r) => r.itemName === 'Bite')?.attackTotal;
    const clawTotals = withMultiattack.rows.filter((r) => r.itemName === 'Claw').map((r) => r.attackTotal);
    expect(biteTotal).toBe(12);
    expect(clawTotals).toEqual([9, 9]);
  });
});

test.describe.serial('Monster natural attacks via dialog', () => {
  test('Tiger bite/claw dialog preserves primary checkbox state and claw rolls 5 below bite', async ({ page }) => {
    const bite = await runBestiaryMonsterAttackViaDialog(page, { docId: TIGER_ID, attackName: 'Bite' });
    const claw = await runBestiaryMonsterAttackViaDialog(page, { docId: TIGER_ID, attackName: 'Claw' });

    expect(bite.actorName).toBe('Tiger');
    expect(claw.actorName).toBe('Tiger');
    expect(bite.itemName).toBe('Bite');
    expect(claw.itemName).toBe('Claw');
    expect(bite.hasPrimaryCheckbox).toBe(true);
    expect(claw.hasPrimaryCheckbox).toBe(true);
    expect(bite.primaryChecked).toBe(true);
    expect(claw.primaryChecked).toBe(false);
    expect(bite.attackTotal).toBe(10);
    expect(claw.attackTotal).toBe(5);
    expect(claw.attackTooltip).toContain('Secondary Attack Penalty');
    expect(claw.attackTooltip).toContain('<td><b>-5</b></td>');
  });

  test('Griffon bite/claw dialog applies Multiattack to the secondary claw', async ({ page }) => {
    const bite = await runBestiaryMonsterAttackViaDialog(page, { docId: GRIFFON_ID, attackName: 'Bite' });
    const claw = await runBestiaryMonsterAttackViaDialog(page, { docId: GRIFFON_ID, attackName: 'Claw' });

    expect(bite.actorName).toBe('Griffon');
    expect(claw.actorName).toBe('Griffon');
    expect(bite.itemName).toBe('Bite');
    expect(claw.itemName).toBe('Claw');
    expect(bite.hasPrimaryCheckbox).toBe(true);
    expect(claw.hasPrimaryCheckbox).toBe(true);
    expect(bite.primaryChecked).toBe(true);
    expect(claw.primaryChecked).toBe(false);
    expect(bite.attackTotal).toBe(12);
    expect(claw.attackTotal).toBe(9);
    expect(claw.attackTooltip).toContain('Secondary Attack Penalty');
    expect(claw.attackTooltip).toContain('<td><b>-2</b></td>');
  });
});
