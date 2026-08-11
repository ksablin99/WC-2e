'use strict';

/**
 * GL#1422 — timed recharge advances when an actor becomes the active combatant
 * (`Hooks.on("combatTurnChange")` → `ActorPF.progressRechargeOnCombatTurnStart`).
 * No world-clock involvement in these tests.
 *
 * Compendium creatures ship breath attacks with `recharge.enabled` false; the
 * “compendium” tests enable timed recharge and set `current` / `uses` the way
 * a GM would when tracking a breath cooldown in combat.
 *
 * Spend test: `uses.per` must be `charges` so `ItemPF.isCharged` is true and
 * attack rolls auto-deduct uses (`ItemUse.rollAttack` → `addCharges`).
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const SCENE_NAME = 'Combat Recharge Turn Scene';

const SUMMON_PACK = 'warcraftrpg2e.summon';
const BESTIARY_PACK = 'warcraftrpg2e.bestiary';
/** @see source/summon/water-mephit-rhkwgvpjxumkjiqf.json */
const WATER_MEPHIT_ID = 'RhkwgVpJxUmKJIqF';
/** @see source/bestiary/red-dragon-wyrmling-fr7hk6ae1evjuafl.json */
const RED_DRAGON_WYRMLING_ID = 'FR7hk6aE1EvJUafL';

/**
 * Import an actor from a compendium, enable timed recharge on its breath attack
 * (type `attack`, name matches /breath/i), and start a one-token combat.
 */
async function importCompendiumBreathCombat(page, { packId, actorDocId }) {
  return page.evaluate(
    async ({ packId: pid, actorDocId: aid, sceneName }) => {
      const pack = game.packs.get(pid);
      if (!pack) throw new Error(`Missing pack ${pid}`);
      const src = await pack.getDocument(aid);
      if (!src) throw new Error(`Missing actor document ${aid} in ${pid}`);
      const actor = await Actor.create(src.toObject());
      const breath = actor.items.find(
        (i) => i.type === 'attack' && /breath/i.test(i.name),
      );
      if (!breath) {
        throw new Error(`No breath attack item on compendium actor ${actor.name}`);
      }
      await breath.update({
        'system.recharge.enabled': true,
        'system.recharge.current': 2,
        'system.recharge.formula': '1d4',
        'system.uses.max': 1,
        'system.uses.maxFormula': '1',
        'system.uses.value': 0,
      });

      const scene = await Scene.create({
        name: sceneName,
        active: true,
        width: 1000,
        height: 1000,
        grid: { size: 100 },
      });
      const [tokenDoc] = await scene.createEmbeddedDocuments('Token', [{
        name: actor.name,
        actorId: actor.id,
        actorLink: true,
        x: 100,
        y: 100,
      }]);
      const combat = await Combat.create({ scene: scene.id });
      await combat.activate();
      const [combatant] = await combat.createEmbeddedDocuments('Combatant', [{
        tokenId: tokenDoc.id,
        hidden: false,
      }]);
      await combat.rollInitiative([combatant.id]);
      await combat.startCombat();

      return { combatId: combat.id, sceneId: scene.id, actorName: actor.name };
    },
    { packId, actorDocId, sceneName: SCENE_NAME },
  );
}

function breathItem(name, rechargeCurrent) {
  return {
    name,
    type: 'attack',
    system: {
      actionType: 'rwak',
      ability: { attack: 'dex', vsTouchAc: false },
      attackParts: [],
      damage: { parts: [['2d6', 'Fire']] },
      recharge: { enabled: true, current: rechargeCurrent, formula: '1d4' },
      uses: {
        allowMultipleUses: false,
        autoDeductCharges: true,
        canBeLinked: false,
        chargesPerUse: 1,
        isResource: false,
        max: 1,
        maxFormula: '1',
        maxPerUse: null,
        maxPerUseFormula: '',
        per: '',
        rechargeFormula: null,
        value: 0,
      },
    },
  };
}

/** Full charge, no rounds remaining yet — using the attack rolls `recharge.formula` into `recharge.current`. */
function breathItemReadyToSpend(name) {
  return {
    name,
    type: 'attack',
    system: {
      actionType: 'rwak',
      ability: { attack: 'dex', vsTouchAc: false },
      attackParts: [],
      damage: { parts: [['2d6', 'Fire']] },
      recharge: { enabled: true, current: 0, formula: '1d4' },
      uses: {
        allowMultipleUses: false,
        autoDeductCharges: true,
        canBeLinked: false,
        chargesPerUse: 1,
        isResource: false,
        max: 1,
        maxFormula: '1',
        maxPerUse: null,
        maxPerUseFormula: '',
        // `ItemPF.isCharged` requires `per` in charges/day/week or attack rolls never auto-deduct uses.
        per: 'charges',
        rechargeFormula: null,
        value: 1,
      },
    },
  };
}

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await page.evaluate(async (sceneName) => {
    await Promise.all([...game.combats].map((c) => c.delete()));
    await Promise.all([...game.scenes].filter((s) => s.name === sceneName).map((s) => s.delete()));
  }, SCENE_NAME);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async (sceneName) => {
    await Promise.all([...game.combats].map((c) => c.delete()));
    await Promise.all([...game.scenes].filter((s) => s.name === sceneName).map((s) => s.delete()));
  }, SCENE_NAME);
});

async function createSceneCombatOneActor(page, { itemPayloads }) {
  return page.evaluate(
    async ({ sceneName, itemPayloads: payloads }) => {
      const actor = await Actor.create({
        name: 'Recharge Combatant',
        type: 'npc',
        system: { attributes: { hp: { value: 20, max: 20 }, cr: 1 } },
      });
      await actor.createEmbeddedDocuments('Item', payloads);

      const scene = await Scene.create({
        name: sceneName,
        active: true,
        width: 1000,
        height: 1000,
        grid: { size: 100 },
      });
      const [tokenDoc] = await scene.createEmbeddedDocuments('Token', [{
        name: actor.name,
        actorId: actor.id,
        actorLink: true,
        x: 100,
        y: 100,
      }]);
      const combat = await Combat.create({ scene: scene.id });
      await combat.activate();
      const [combatant] = await combat.createEmbeddedDocuments('Combatant', [{
        tokenId: tokenDoc.id,
        hidden: false,
      }]);
      await combat.rollInitiative([combatant.id]);
      await combat.startCombat();

      return { combatId: combat.id, sceneId: scene.id, actorId: actor.id };
    },
    { sceneName: SCENE_NAME, itemPayloads }
  );
}

async function waitForCanvasScene(page, sceneId) {
  await page.waitForFunction(
    (id) => canvas.ready && canvas.scene?.id === id && PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    sceneId,
    { timeout: 15_000 }
  );
}

test('single recharging attack ticks once per wrapped turn (one combatant)', async ({ page }) => {
  const { combatId, sceneId } = await createSceneCombatOneActor(page, {
    itemPayloads: [breathItem('Breath', 2)],
  });
  await waitForCanvasScene(page, sceneId);

  await page.evaluate(async (id) => {
    await game.combats.get(id).nextTurn();
  }, combatId);

  await page.waitForFunction(
    () => {
      const actor = game.actors.getName('Recharge Combatant');
      const item = actor?.items.getName('Breath');
      return item?.system.recharge.current === 1 && item?.system.uses.value === 0;
    },
    { timeout: 8_000 }
  );

  await page.evaluate(async (id) => {
    await game.combats.get(id).nextTurn();
  }, combatId);

  await page.waitForFunction(
    () => {
      const actor = game.actors.getName('Recharge Combatant');
      const item = actor?.items.getName('Breath');
      return item?.system.recharge.current === 0 && item?.system.uses.value === 1;
    },
    { timeout: 8_000 }
  );
});

const BREATH_SPEND_ITEM_NAME = 'Breath of Fire';

test('using a timed-recharge attack rolls cooldown; combat turns restore the charge', async ({ page }) => {
  const { combatId, sceneId } = await createSceneCombatOneActor(page, {
    itemPayloads: [breathItemReadyToSpend(BREATH_SPEND_ITEM_NAME)],
  });
  await waitForCanvasScene(page, sceneId);

  const afterUse = await page.evaluate(async (itemName) => {
    const actor = game.actors.getName('Recharge Combatant');
    const item = actor.items.getName(itemName);
    const prevUniform = CONFIG.Dice.randomUniform;
    // Foundry v13: `DiceTerm#mapRandomFace` uses ceil((1 - u) * faces). u → 0 gives max face;
    // u → 1⁻ gives min (full-attack e2e uses 0.999999 for minimum damage dice).
    CONFIG.Dice.randomUniform = () => 0;
    try {
      const r = await item.use({ skipDialog: true });
      if (r?.roll) await r.roll;
    } finally {
      CONFIG.Dice.randomUniform = prevUniform;
    }
    const fresh = game.actors.getName('Recharge Combatant').items.getName(itemName);
    return {
      rounds: fresh.system.recharge.current,
      uses: fresh.system.uses.value,
    };
  }, BREATH_SPEND_ITEM_NAME);

  expect(afterUse.uses).toBe(0);
  expect(afterUse.rounds).toBe(4);

  const rounds = afterUse.rounds;

  for (let i = 0; i < rounds; i++) {
    await page.evaluate(async (id) => {
      await game.combats.get(id).nextTurn();
    }, combatId);

    await page.waitForFunction(
      ({ itemName, i, rounds: r0 }) => {
        const actor = game.actors.getName('Recharge Combatant');
        const item = actor?.items.getName(itemName);
        if (!item) return false;
        const c = item.system.recharge.current;
        const u = item.system.uses.value;
        const last = i === r0 - 1;
        if (last) return c === 0 && u === 1;
        return c === r0 - i - 1 && u === 0;
      },
      { itemName: BREATH_SPEND_ITEM_NAME, i, rounds },
      { timeout: 8_000 }
    );
  }
});

test('multiple recharging attacks on the same actor tick together', async ({ page }) => {
  const { combatId, sceneId } = await createSceneCombatOneActor(page, {
    itemPayloads: [breathItem('Breath A', 2), breathItem('Breath B', 3)],
  });
  await waitForCanvasScene(page, sceneId);

  await page.evaluate(async (id) => {
    await game.combats.get(id).nextTurn();
  }, combatId);

  await page.waitForFunction(
    () => {
      const actor = game.actors.getName('Recharge Combatant');
      const a = actor?.items.getName('Breath A');
      const b = actor?.items.getName('Breath B');
      return a?.system.recharge.current === 1 && b?.system.recharge.current === 2;
    },
    { timeout: 8_000 }
  );
});

test('only the newly active combatant’s items tick (Smaug vs Azog)', async ({ page }) => {
  const ids = await page.evaluate(async (sceneName) => {
    const mk = (name, cur) => ({
      name,
      type: 'attack',
      system: {
        actionType: 'rwak',
        ability: { attack: 'dex', vsTouchAc: false },
        attackParts: [],
        damage: { parts: [['1d4', 'B']] },
        recharge: { enabled: true, current: cur, formula: '1d4' },
        uses: {
          allowMultipleUses: false,
          autoDeductCharges: true,
          canBeLinked: false,
          chargesPerUse: 1,
          isResource: false,
          max: 1,
          maxFormula: '1',
          maxPerUse: null,
          maxPerUseFormula: '',
          per: '',
          rechargeFormula: null,
          value: 0,
        },
      },
    });

    const smaug = await Actor.create({
      name: 'Smaug',
      type: 'npc',
      system: { attributes: { hp: { value: 30, max: 30 }, cr: 2 } },
    });
    await smaug.createEmbeddedDocuments('Item', [mk('Smaug Breath', 2)]);

    const azog = await Actor.create({
      name: 'Azog',
      type: 'npc',
      system: { attributes: { hp: { value: 10, max: 10 }, cr: 1 } },
    });
    await azog.createEmbeddedDocuments('Item', [mk('Azog Breath', 2)]);

    const scene = await Scene.create({
      name: sceneName,
      active: true,
      width: 1000,
      height: 1000,
      grid: { size: 100 },
    });

    const [tokA] = await scene.createEmbeddedDocuments('Token', [{
      name: smaug.name,
      actorId: smaug.id,
      actorLink: true,
      x: 100,
      y: 100,
    }]);
    const [tokB] = await scene.createEmbeddedDocuments('Token', [{
      name: azog.name,
      actorId: azog.id,
      actorLink: true,
      x: 300,
      y: 100,
    }]);

    const combat = await Combat.create({ scene: scene.id });
    await combat.activate();

    const [cA] = await combat.createEmbeddedDocuments('Combatant', [{ tokenId: tokA.id, hidden: false }]);
    const [cB] = await combat.createEmbeddedDocuments('Combatant', [{ tokenId: tokB.id, hidden: false }]);
    await combat.rollInitiative([cA.id, cB.id]);
    await combat.startCombat();

    return { combatId: combat.id, sceneId: scene.id };
  }, SCENE_NAME);

  await waitForCanvasScene(page, ids.sceneId);

  await page.evaluate(async (combatId) => {
    await game.combats.get(combatId).nextTurn();
  }, ids.combatId);

  await page.waitForFunction(
    () => {
      const smaug = game.actors.getName('Smaug');
      const azog = game.actors.getName('Azog');
      const s = smaug?.items.getName('Smaug Breath')?.system.recharge.current;
      const z = azog?.items.getName('Azog Breath')?.system.recharge.current;
      if (s == null || z == null) return false;
      const sorted = [s, z].sort((x, y) => x - y);
      return sorted[0] === 1 && sorted[1] === 2;
    },
    { timeout: 8_000 }
  );
});

test('warcraftrpg2e.summon Water Mephit: breath attack recharge ticks per combat turn', async ({ page }) => {
  const { combatId, sceneId, actorName } = await importCompendiumBreathCombat(page, {
    packId: SUMMON_PACK,
    actorDocId: WATER_MEPHIT_ID,
  });
  await waitForCanvasScene(page, sceneId);

  await page.evaluate(async (id) => {
    await game.combats.get(id).nextTurn();
  }, combatId);

  await page.waitForFunction(
    (name) => {
      const actor = game.actors.getName(name);
      const item = actor?.items.find((i) => i.type === 'attack' && /breath/i.test(i.name));
      return item?.system.recharge.current === 1 && item?.system.uses.value === 0;
    },
    actorName,
    { timeout: 8_000 }
  );

  await page.evaluate(async (id) => {
    await game.combats.get(id).nextTurn();
  }, combatId);

  await page.waitForFunction(
    (name) => {
      const actor = game.actors.getName(name);
      const item = actor?.items.find((i) => i.type === 'attack' && /breath/i.test(i.name));
      return item?.system.recharge.current === 0 && item?.system.uses.value === 1;
    },
    actorName,
    { timeout: 8_000 }
  );
});

test('warcraftrpg2e.bestiary Red Dragon Wyrmling: breath weapon recharge ticks per combat turn', async ({
  page,
}) => {
  const { combatId, sceneId, actorName } = await importCompendiumBreathCombat(page, {
    packId: BESTIARY_PACK,
    actorDocId: RED_DRAGON_WYRMLING_ID,
  });
  await waitForCanvasScene(page, sceneId);

  await page.evaluate(async (id) => {
    await game.combats.get(id).nextTurn();
  }, combatId);

  await page.waitForFunction(
    (name) => {
      const actor = game.actors.getName(name);
      const item = actor?.items.find((i) => i.type === 'attack' && /breath/i.test(i.name));
      return item?.system.recharge.current === 1 && item?.system.uses.value === 0;
    },
    actorName,
    { timeout: 8_000 }
  );

  await page.evaluate(async (id) => {
    await game.combats.get(id).nextTurn();
  }, combatId);

  await page.waitForFunction(
    (name) => {
      const actor = game.actors.getName(name);
      const item = actor?.items.find((i) => i.type === 'attack' && /breath/i.test(i.name));
      return item?.system.recharge.current === 0 && item?.system.uses.value === 1;
    },
    actorName,
    { timeout: 8_000 }
  );
});

test('compendium Water Mephit vs Red Dragon Wyrmling: only active breath recharge ticks', async ({
  page,
}) => {
  const ids = await page.evaluate(
    async ({ sceneName, waterId, dragonId }) => {
      const armBreath = async (actor) => {
        const breath = actor.items.find(
          (i) => i.type === 'attack' && /breath/i.test(i.name),
        );
        if (!breath) throw new Error(`No breath attack on ${actor.name}`);
        await breath.update({
          'system.recharge.enabled': true,
          'system.recharge.current': 2,
          'system.recharge.formula': '1d4',
          'system.uses.max': 1,
          'system.uses.maxFormula': '1',
          'system.uses.value': 0,
        });
      };

      const wPack = game.packs.get('warcraftrpg2e.summon');
      const bPack = game.packs.get('warcraftrpg2e.bestiary');
      const wSrc = await wPack.getDocument(waterId);
      const dSrc = await bPack.getDocument(dragonId);
      const water = await Actor.create(wSrc.toObject());
      const dragon = await Actor.create(dSrc.toObject());
      await armBreath(water);
      await armBreath(dragon);

      const scene = await Scene.create({
        name: sceneName,
        active: true,
        width: 1000,
        height: 1000,
        grid: { size: 100 },
      });

      const [tokW] = await scene.createEmbeddedDocuments('Token', [{
        name: water.name,
        actorId: water.id,
        actorLink: true,
        x: 100,
        y: 100,
      }]);
      const [tokD] = await scene.createEmbeddedDocuments('Token', [{
        name: dragon.name,
        actorId: dragon.id,
        actorLink: true,
        x: 300,
        y: 100,
      }]);

      const combat = await Combat.create({ scene: scene.id });
      await combat.activate();
      const [cW] = await combat.createEmbeddedDocuments('Combatant', [{ tokenId: tokW.id, hidden: false }]);
      const [cD] = await combat.createEmbeddedDocuments('Combatant', [{ tokenId: tokD.id, hidden: false }]);
      await combat.rollInitiative([cW.id, cD.id]);
      await combat.startCombat();

      return {
        combatId: combat.id,
        sceneId: scene.id,
        waterName: water.name,
        dragonName: dragon.name,
      };
    },
    {
      sceneName: SCENE_NAME,
      waterId: WATER_MEPHIT_ID,
      dragonId: RED_DRAGON_WYRMLING_ID,
    },
  );

  await waitForCanvasScene(page, ids.sceneId);

  await page.evaluate(async (combatId) => {
    await game.combats.get(combatId).nextTurn();
  }, ids.combatId);

  await page.waitForFunction(
    ({ waterName, dragonName }) => {
      const wActor = game.actors.getName(waterName);
      const dActor = game.actors.getName(dragonName);
      const wCur = wActor?.items.find((i) => i.type === 'attack' && /breath/i.test(i.name))
        ?.system.recharge.current;
      const dCur = dActor?.items.find((i) => i.type === 'attack' && /breath/i.test(i.name))
        ?.system.recharge.current;
      if (wCur == null || dCur == null) return false;
      const sorted = [wCur, dCur].sort((x, y) => x - y);
      return sorted[0] === 1 && sorted[1] === 2;
    },
    { waterName: ids.waterName, dragonName: ids.dragonName },
    { timeout: 8_000 }
  );
});
