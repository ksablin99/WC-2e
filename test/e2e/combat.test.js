'use strict';

/**
 * E2E combat flow tests — cover initiative rolling, buff tracker entries, and
 * turn progression.  These serve as regression guards for:
 *   - Issue #1590: "You must provide an _id" error on initiative roll (fixed in
 *     b8b419f7 by switching updates payload key from `id` to `_id` and async roll)
 *   - Buff combatant entries being created in the tracker when initiative is rolled
 *   - Turn/round advancement with active buffs not producing console errors
 *
 * Setup pattern:
 *   1. Create actor(s) via Foundry JS API in page.evaluate()
 *   2. Create a minimal scene, place token(s), create a combat, add combatant(s)
 *   3. Interact via Foundry API; assert on combat state read back via page.evaluate()
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const SCENE_NAME = 'Combat E2E Test Scene';


// ── Lifecycle ─────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  // Delete any leftover combats and test scenes from a previous run
  await page.evaluate(async (sceneName) => {
    await Promise.all([...game.combats].map(c => c.delete()));
    await Promise.all([...game.scenes].filter(s => s.name === sceneName).map(s => s.delete()));
  }, SCENE_NAME);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test.afterEach(async ({ page }) => {
  await page.evaluate(async (sceneName) => {
    await Promise.all([...game.combats].map(c => c.delete()));
    await Promise.all([...game.scenes].filter(s => s.name === sceneName).map(s => s.delete()));
  }, SCENE_NAME);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Create a minimal scene, place one linked token for the given actor, create a
 * combat, add that token as the first combatant, and return the IDs.
 */
async function createSceneAndCombat(page, actorId) {
  const result = await page.evaluate(async ({ actorId, sceneName }) => {
    const actor = game.actors.get(actorId);

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

    return { sceneId: scene.id, combatId: combat.id, combatantId: combatant.id, tokenId: tokenDoc.id };
  }, { actorId, sceneName: SCENE_NAME });

  // Wait for the canvas to fully initialize the *new* scene (including PIXI ticker priorities).
  // Canvas#_activateTicker() injects PIXI.UPDATE_PRIORITY.OBJECTS only when a scene is viewed.
  // We must check canvas.scene?.id matches the new scene — canvas.ready alone can be true from
  // the previous scene, resolving the wait before the new scene has run _activateTicker().
  await page.waitForFunction(
    (id) => canvas.ready && canvas.scene?.id === id && PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    result.sceneId,
    { timeout: 15_000 }
  );
  return result;
}

/**
 * Create a basic Fighter-type character actor (no class needed for initiative).
 */
async function createBasicActor(page, name = 'Combat Test Actor') {
  return page.evaluate(async (name) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      system: {
        abilities: { str: { value: 10 }, dex: { value: 14 } },
      },
    });
    return actor.id;
  }, name);
}

/**
 * Add a second actor's token to the existing scene and combat.
 */
async function addActorToCombat(page, { actorId, sceneId, combatId }) {
  return page.evaluate(async ({ actorId, sceneId, combatId }) => {
    const actor  = game.actors.get(actorId);
    const scene  = game.scenes.get(sceneId);
    const combat = game.combats.get(combatId);

    const [tokenDoc] = await scene.createEmbeddedDocuments('Token', [{
      name: actor.name,
      actorId: actor.id,
      actorLink: true,
      x: 300,
      y: 100,
    }]);

    const [combatant] = await combat.createEmbeddedDocuments('Combatant', [{
      tokenId: tokenDoc.id,
      hidden: false,
    }]);

    return { combatantId: combatant.id };
  }, { actorId, sceneId, combatId });
}

// ── 1. Roll initiative for a single combatant ─────────────────────────────────
//
// Regression: before b8b419f7 the updateEmbeddedDocuments call used `{ id: … }`
// instead of `{ _id: … }`, which threw "You must provide an _id".  After the
// fix the roll succeeds and the combatant gains a numeric initiative value.

test('rolling initiative for a single combatant sets a numeric initiative value', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const actorId = await createBasicActor(page);
  const { combatId, combatantId } = await createSceneAndCombat(page, actorId);

  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.rollInitiative([combatantId]);
  }, { combatId, combatantId });

  const initiative = await page.evaluate(({ combatId, combatantId }) => {
    return game.combats.get(combatId)?.combatants.get(combatantId)?.initiative ?? null;
  }, { combatId, combatantId });

  expect(initiative).not.toBeNull();
  expect(typeof initiative).toBe('number');
  // DEX 14 → +2 mod, initiative = 1d20 + 2 + 2/100 → roughly [3.02, 22.02]
  expect(initiative).toBeGreaterThanOrEqual(1);
  expect(initiative).toBeLessThanOrEqual(25);

  // No "_id" / initiative errors in the console
  const idError = consoleErrors.find(e => e.includes('_id') || e.includes('initiative'));
  expect(idError).toBeUndefined();

});

// ── 2. Roll initiative for all combatants ─────────────────────────────────────
//
// Calls rollAll() which internally calls rollInitiative with the full id list.
// All combatants should receive a numeric initiative.

test('rolling initiative for all combatants assigns numeric values to each', async ({ page }) => {
  const actorId1 = await createBasicActor(page, 'Combat Actor 1');
  const actorId2 = await createBasicActor(page, 'Combat Actor 2');
  const { sceneId, combatId, combatantId: combatantId1 } = await createSceneAndCombat(page, actorId1);
  const { combatantId: combatantId2 } = await addActorToCombat(page, { actorId: actorId2, sceneId, combatId });

  await page.evaluate(async (combatId) => {
    const combat = game.combats.get(combatId);
    await combat.rollAll();
  }, combatId);

  const initiatives = await page.evaluate(({ combatId, id1, id2 }) => {
    const combat = game.combats.get(combatId);
    return {
      c1: combat.combatants.get(id1)?.initiative ?? null,
      c2: combat.combatants.get(id2)?.initiative ?? null,
    };
  }, { combatId, id1: combatantId1, id2: combatantId2 });

  expect(typeof initiatives.c1).toBe('number');
  expect(typeof initiatives.c2).toBe('number');
  expect(initiatives.c1).toBeGreaterThanOrEqual(1);
  expect(initiatives.c2).toBeGreaterThanOrEqual(1);

});

// ── 3. Active tracked buff is added to the combat tracker on initiative roll ──
//
// When an actor with a tracked buff (active + timeline.enabled) has initiative
// rolled, CombatD35E.addBuffsToCombat creates an extra combatant entry for that
// buff with flags.D35E.isBuff = true and flags.D35E.buffId = <item id>.

test('rolling initiative for actor with tracked buff creates buff combatant entry', async ({ page }) => {
  // Create actor, then add an active tracked buff item
  const { actorId, buffId } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Buffed Combatant',
      type: 'character',
      system: { abilities: { dex: { value: 12 } } },
    });

    const [buff] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Haste',
      type: 'buff',
      system: {
        active: true,
        timeline: { enabled: true, total: 3, elapsed: 0, deleteOnExpiry: false, tickOnEnd: false },
      },
    }]);

    return { actorId: actor.id, buffId: buff.id };
  });

  const { combatId, combatantId } = await createSceneAndCombat(page, actorId);

  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.rollInitiative([combatantId]);
  }, { combatId, combatantId });

  // Wait for the buff combatant to appear (addBuffsToCombat is async)
  await page.waitForFunction(
    ({ combatId, buffId }) => {
      const combat = game.combats.get(combatId);
      return combat?.combatants.some(c => c.flags?.D35E?.buffId === buffId) ?? false;
    },
    { combatId, buffId },
    { timeout: 5_000 }
  );

  const buffCombatantFlags = await page.evaluate(({ combatId, buffId }) => {
    const combat = game.combats.get(combatId);
    const bc = combat.combatants.find(c => c.flags?.D35E?.buffId === buffId);
    return bc?.flags?.D35E ?? null;
  }, { combatId, buffId });

  expect(buffCombatantFlags).not.toBeNull();
  expect(buffCombatantFlags.isBuff).toBe(true);
  expect(buffCombatantFlags.buffId).toBe(buffId);

});

// ── 4. Buff initiative is placed near the actor's initiative ──────────────────
//
// The buff combatant initiative should be within 0.1 of the main combatant's
// initiative (actor initiative ± 0.01 offset for tick-on-start vs tick-on-end).

test('buff combatant initiative is near the actor initiative after roll', async ({ page }) => {
  const { actorId, buffId } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Initiative Buff Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } },
    });
    const [buff] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Shield of Faith',
      type: 'buff',
      system: {
        active: true,
        timeline: { enabled: true, total: 5, elapsed: 0, deleteOnExpiry: false, tickOnEnd: false },
      },
    }]);
    return { actorId: actor.id, buffId: buff.id };
  });

  const { combatId, combatantId } = await createSceneAndCombat(page, actorId);

  await page.evaluate(async ({ combatId, combatantId }) => {
    await game.combats.get(combatId).rollInitiative([combatantId]);
  }, { combatId, combatantId });

  await page.waitForFunction(
    ({ combatId, buffId }) => game.combats.get(combatId)?.combatants.some(c => c.flags?.D35E?.buffId === buffId) ?? false,
    { combatId, buffId },
    { timeout: 5_000 }
  );

  const { actorInit, buffInit } = await page.evaluate(({ combatId, combatantId, buffId }) => {
    const combat = game.combats.get(combatId);
    const actorInit = combat.combatants.get(combatantId)?.initiative ?? null;
    const buffInit  = combat.combatants.find(c => c.flags?.D35E?.buffId === buffId)?.initiative ?? null;
    return { actorInit, buffInit };
  }, { combatId, combatantId, buffId });

  expect(actorInit).not.toBeNull();
  expect(buffInit).not.toBeNull();
  // Buff initiative is actor initiative ± a small offset (0.01)
  expect(Math.abs(buffInit - actorInit)).toBeLessThanOrEqual(0.02);

});

// ── 5. Advancing a turn with a buff combatant does not throw ──────────────────
//
// Starting combat and calling nextTurn() processes the current combatant via
// _processCurrentCombatant.  With an active buff in the tracker the buff's
// timeline should tick without an uncaught exception.

test('advancing turn with buff combatant processes without console errors', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const { actorId } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Turn Advance Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } },
    });
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Bless',
      type: 'buff',
      system: {
        active: true,
        timeline: { enabled: true, total: 5, elapsed: 0, deleteOnExpiry: false, tickOnEnd: false },
      },
    }]);
    return { actorId: actor.id };
  });

  const { combatId, combatantId } = await createSceneAndCombat(page, actorId);

  // Roll initiative then start the combat
  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.rollInitiative([combatantId]);
    await combat.startCombat();
  }, { combatId, combatantId });

  // Wait for buff combatant to appear
  await page.waitForFunction(
    (combatId) => {
      const c = game.combats.get(combatId);
      return c?.combatants.some(x => x.flags?.D35E?.isBuff === true) ?? false;
    },
    combatId,
    { timeout: 5_000 }
  );

  const combatantCountBefore = await page.evaluate((combatId) => {
    return game.combats.get(combatId)?.combatants.size ?? 0;
  }, combatId);

  const { turnBefore, roundBefore } = await page.evaluate((combatId) => {
    const c = game.combats.get(combatId);
    return { turnBefore: c?.turn ?? -1, roundBefore: c?.round ?? -1 };
  }, combatId);

  // Advance the turn — D35E's nextTurn() awaits _processCurrentCombatant() before resolving.
  // When the next combatant is a buff, _processCurrentCombatant auto-calls nextTurn() again
  // to skip it, so the net effect of one nextTurn() call can be a full round advance
  // (turn wraps back to 0 while round increments).  Check for either turn OR round change.
  await page.evaluate(async (combatId) => {
    await game.combats.get(combatId).nextTurn();
  }, combatId);

  await page.waitForFunction(
    ({ combatId, turnBefore, roundBefore }) => {
      const c = game.combats.get(combatId);
      return c !== undefined && (c.turn !== turnBefore || c.round !== roundBefore);
    },
    { combatId, turnBefore, roundBefore },
    { timeout: 5_000 }
  );

  // The combat should still exist and the combatant count should be sensible
  const combatStillActive = await page.evaluate((combatId) => {
    return game.combats.get(combatId) !== undefined;
  }, combatId);
  expect(combatStillActive).toBe(true);

  // No critical errors should have been thrown
  const criticalErrors = consoleErrors.filter(e =>
    e.toLowerCase().includes('error processing current combatant') ||
    e.includes('_id') && e.includes('provide')
  );
  expect(criticalErrors).toHaveLength(0);

});

// ── 6. Starting combat and rolling initiative (full flow) ─────────────────────
//
// Verifies the complete happy path: create encounter, roll all, start combat,
// check that initiative values are set and a chat message was created.

test('full combat flow: create encounter, roll all initiative, start combat', async ({ page }) => {
  const actorId1 = await createBasicActor(page, 'Fighter Alpha');
  const actorId2 = await createBasicActor(page, 'Fighter Beta');
  const { sceneId, combatId } = await createSceneAndCombat(page, actorId1);
  await addActorToCombat(page, { actorId: actorId2, sceneId, combatId });

  const msgsBefore = await page.evaluate(() => game.messages.size);

  await page.evaluate(async (combatId) => {
    const combat = game.combats.get(combatId);
    await combat.rollAll();
    await combat.startCombat();
  }, combatId);

  // Both combatants should now have numeric initiative values
  const combatants = await page.evaluate((combatId) => {
    return [...game.combats.get(combatId).combatants].map(c => ({
      id: c.id,
      initiative: c.initiative,
      isActor: !!c.actor,
    }));
  }, combatId);

  const actorCombatants = combatants.filter(c => c.isActor);
  expect(actorCombatants).toHaveLength(2);
  for (const c of actorCombatants) {
    expect(typeof c.initiative).toBe('number');
    expect(c.initiative).toBeGreaterThanOrEqual(1);
  }

  // Two initiative chat messages should have been created (one per combatant)
  const msgsAfter = await page.evaluate(() => game.messages.size);
  expect(msgsAfter - msgsBefore).toBeGreaterThanOrEqual(2);

  // Combat should be active (started)
  const combatStarted = await page.evaluate((combatId) => {
    return game.combats.get(combatId)?.started ?? false;
  }, combatId);
  expect(combatStarted).toBe(true);

});

// ── 7. Apply damage from chat card reduces HP and sets staggered condition ─────
//
// Imports the Astral Deva from the bestiary (it has a Heavy Mace attack item),
// fires the Deva's attack (skipDialog to avoid the attack-options popup),
// reads the rolled damage from the chat card button, sets the Fighter's HP to
// exactly that value, targets the Fighter token, then clicks the "Apply Damage"
// button.  The defence dialog opens — we click "vs Normal AC".  Because the
// Deva's attack bonus (+17 BAB) always beats the Fighter's unarmoured AC (≈11),
// the hit resolves and HP drops to exactly 0 → staggered condition fires.

const BESTIARY_PACK = 'warcraftrpg2e.bestiary';
const DEVA_ID       = 'ui3NVQRuhNwaNiKu'; // Angel, Astral Deva

test('applying damage from chat card reduces HP and sets staggered condition at 0 HP', async ({ page }) => {
  const { fighterId, devaId, sceneId, combatId, fighterTokenId } =
    await page.evaluate(async ({ BESTIARY_PACK, DEVA_ID }) => {
      // High starting HP — we'll set it to exactly the attack damage later
      const fighter = await Actor.create({
        name: 'Damage Test Fighter',
        type: 'character',
        system: {
          abilities: { str: { value: 16 }, dex: { value: 12 } },
          attributes: { hp: { value: 200, max: 200 } },
        },
      });

      const pack = game.packs.get(BESTIARY_PACK);
      const devaSource = await pack.getDocument(DEVA_ID);
      const deva = await Actor.create(devaSource.toObject());

      const scene = await Scene.create({
        name: 'Damage Test Scene',
        active: true,
        width: 1000,
        height: 1000,
        grid: { size: 100 },
      });

      const [fighterToken] = await scene.createEmbeddedDocuments('Token', [{
        name: fighter.name, actorId: fighter.id, actorLink: true, x: 100, y: 100,
      }]);
      const [devaToken] = await scene.createEmbeddedDocuments('Token', [{
        name: deva.name, actorId: deva.id, actorLink: true, x: 300, y: 100,
      }]);

      const combat = await Combat.create({ scene: scene.id });
      await combat.activate();
      await combat.createEmbeddedDocuments('Combatant', [
        { tokenId: fighterToken.id, hidden: false },
        { tokenId: devaToken.id,    hidden: false },
      ]);
      await combat.rollAll();
      await combat.startCombat();

      return {
        fighterId:      fighter.id,
        devaId:         deva.id,
        sceneId:        scene.id,
        combatId:       combat.id,
        fighterTokenId: fighterToken.id,
      };
    }, { BESTIARY_PACK, DEVA_ID });

  // Deva import may trigger a migration dialog — dismiss before proceeding
  await dismissSystemDialogs(page);
  await dismissOverlays(page);

  // Fire the Deva's Heavy Mace attack (skipDialog bypasses the attack-options popup,
  // not the defence dialog that appears when clicking Apply Damage later).
  // Re-fire if ALL buttons in the card are fumbles (rare but possible).
  let lastMsgId, attackRoll, damageValue;
  for (let attempt = 0; attempt < 5; attempt++) {
    const msgsBefore = await page.evaluate(() => game.messages.size);
    await page.evaluate(async (devaId) => {
      const deva   = game.actors.get(devaId);
      const attack = deva.items.find(i => i.type === 'attack' && i.name.toLowerCase().includes('heavy mace'));
      if (!attack) throw new Error('Heavy Mace attack item not found on Deva');
      await attack.use({ skipDialog: true });
    }, devaId);

    await page.waitForFunction((before) => game.messages.size > before, msgsBefore, { timeout: 8_000 });
    await dismissSystemDialogs(page);
    await page.waitForTimeout(500); // let the chat log render the new message

    // Find the first non-fumble Apply Damage button in the latest message
    const found = await page.evaluate(() => {
      const lastMsg = game.messages.contents.at(-1);
      const btns = [...document.querySelectorAll(
        `li[data-message-id="${lastMsg?.id}"] button[data-action="applyDamage"]`
      )];
      const btn = btns.find(b => b.dataset.fumble !== 'true');
      if (!btn) return null;
      return {
        lastMsgId:   lastMsg.id,
        attackRoll:  btn.dataset.roll,
        damageValue: parseInt(btn.dataset.value || '0'),
      };
    });

    if (found?.damageValue > 0) {
      ({ lastMsgId, attackRoll, damageValue } = found);
      break;
    }
  }
  expect(damageValue).toBeGreaterThan(0);

  // Set fighter HP to exactly the attack's damage value.
  // After clicking Apply → vs Normal, roll(≥19) > AC(11) → hit → HP drops to 0.
  await page.evaluate(async ({ fighterId, damageValue }) => {
    await game.actors.get(fighterId).update({ 'system.attributes.hp.value': damageValue });
  }, { fighterId, damageValue });

  // Target the Fighter token — applyDamage uses game.user.targets
  await page.evaluate(({ fighterTokenId }) => {
    const token = canvas.tokens.placeables.find(t => t.document.id === fighterTokenId);
    if (token) token.setTarget(true, { user: game.user, releaseOthers: true });
  }, { fighterTokenId });
  await page.waitForTimeout(300);

  // Click the Apply Damage button via JS dispatchEvent — Playwright's locator.click()
  // cannot reach elements outside the chat log's scrollable viewport in headless mode.
  // dispatchEvent with bubbles:true fires the section#chat listener the same way a real click does.
  // No shift modifier → rollDefenceDialog opens (full e2e path).
  await page.evaluate(({ lastMsgId, attackRoll }) => {
    // Scope to section#chat — the same button also appears in Foundry's notifications overlay
    // which is outside section#chat and has no chat click listener attached.
    const chatSection = document.querySelector('section#chat');
    const btn = chatSection?.querySelector(
      `li[data-message-id="${lastMsgId}"] button[data-action="applyDamage"][data-roll="${attackRoll}"]`
    );
    if (!btn) throw new Error(`Apply Damage button not found in section#chat for msgId=${lastMsgId} roll=${attackRoll}`);
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, { lastMsgId, attackRoll });

  // Defence dialog: click "vs Normal AC"
  // Deva BAB ≈ +19; Fighter unarmoured AC ≈ 11 → always hits
  await page.waitForSelector('.roll-defense button[data-button="vsNormal"]', { timeout: 5_000 });
  await page.evaluate(() => {
    document.querySelector('.roll-defense button[data-button="vsNormal"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });

  // Wait for HP to reach exactly 0 (staggered threshold)
  await page.waitForFunction(
    (fighterId) => (game.actors.get(fighterId)?.system.attributes.hp.value ?? 99) <= 0,
    fighterId,
    { timeout: 5_000 }
  );

  const result = await page.evaluate((fighterId) => {
    const a = game.actors.get(fighterId);
    return {
      hp:        a?.system.attributes.hp.value ?? null,
      staggered: a?.system.attributes.conditions?.staggered ?? null,
    };
  }, fighterId);

  expect(result.hp).toBe(0);
  expect(result.staggered).toBe(true);


  // Cleanup
  await page.evaluate(async ({ combatId, sceneId, fighterId, devaId }) => {
    await game.combats.get(combatId)?.delete();
    await game.scenes.get(sceneId)?.delete();
    await game.actors.get(fighterId)?.delete();
    await game.actors.get(devaId)?.delete();
  }, { combatId, sceneId, fighterId, devaId });
});

// ── 8. Expired timed buff is deleted from actor and tracker ───────────────────
//
// A buff with timeline.total = 1 and deleteOnExpiry = true should be deleted
// from actor.items and its combatant entry removed from the tracker after its
// turn is processed (buff combatant auto-advances, then actor's turn processes
// the accumulated roundBuffUpdates and deletes the expired item).

test('timed buff with deleteOnExpiry is removed from actor and tracker after its turn completes', async ({ page }) => {
  const { actorId, buffId } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Expiry Buff Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } },
    });
    const [buff] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Short Lived Buff',
      type: 'buff',
      system: {
        active: true,
        timeline: { enabled: true, total: 1, elapsed: 0, deleteOnExpiry: true, tickOnEnd: false },
      },
    }]);
    return { actorId: actor.id, buffId: buff.id };
  });

  const { combatId, combatantId } = await createSceneAndCombat(page, actorId);

  // Roll initiative (which creates the buff combatant), pin the actor first in
  // the turn order, then start combat so we control when nextTurn() is called.
  await page.evaluate(async ({ combatId, combatantId, buffId }) => {
    const combat = game.combats.get(combatId);
    await combat.rollInitiative([combatantId]);

    // Wait for addBuffsToCombat to create the buff combatant entry
    await new Promise(resolve => {
      const check = () => {
        if (combat.combatants.some(c => c.flags?.D35E?.buffId === buffId)) resolve();
        else setTimeout(check, 50);
      };
      check();
    });

    // Force actor first so the buff combatant is processed on the first nextTurn()
    const buffCombatant = combat.combatants.find(c => c.flags?.D35E?.buffId === buffId);
    await combat.updateEmbeddedDocuments('Combatant', [
      { _id: combatantId,        initiative: 20 },
      { _id: buffCombatant.id,   initiative: 19.99 },
    ]);

    await combat.startCombat();
  }, { combatId, combatantId, buffId });

  // Advance turn: buff combatant auto-advances (progressBuff, elapsed 0→1),
  // then actor's turn processes roundBuffUpdates: elapsed 1 >= total 1 → delete.
  await page.evaluate(async (combatId) => {
    await game.combats.get(combatId).nextTurn();
  }, combatId);

  // Buff item should now be deleted from the actor
  await page.waitForFunction(
    ({ actorId, buffId }) => !game.actors.get(actorId)?.items.has(buffId),
    { actorId, buffId },
    { timeout: 5_000 }
  );

  const buffGone = await page.evaluate(({ actorId, buffId }) => {
    return !game.actors.get(actorId)?.items.has(buffId);
  }, { actorId, buffId });
  expect(buffGone).toBe(true);

  // Buff combatant entry should also be removed from the tracker
  const buffCombatantGone = await page.evaluate(({ combatId, buffId }) => {
    return !game.combats.get(combatId)?.combatants.some(c => c.flags?.D35E?.buffId === buffId);
  }, { combatId, buffId });
  expect(buffCombatantGone).toBe(true);
});

// ── Issue 1583: Buffs without timeline.enabled must not enter combat tracker ───

// ── 1583-a. No-timeline buff is NOT added to tracker when initiative is rolled ─
//
// When an actor with a buff that has timeline.enabled = false (the default)
// rolls initiative, addBuffsToCombat must skip that buff.  No combatant entry
// with flags.D35E.buffId matching the buff should appear in the tracker.

test('rolling initiative does not add a no-timeline buff to the combat tracker', async ({ page }) => {
  const { actorId, buffId } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'No-Timeline Buff Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } },
    });
    const [buff] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Indefinite Aura of Confidence',
      type: 'buff',
      system: {
        active: true,
        timeline: { enabled: false, total: 0, elapsed: 0, deleteOnExpiry: false, tickOnEnd: false },
      },
    }]);
    return { actorId: actor.id, buffId: buff.id };
  });

  const { combatId, combatantId } = await createSceneAndCombat(page, actorId);

  await page.evaluate(async ({ combatId, combatantId }) => {
    await game.combats.get(combatId).rollInitiative([combatantId]);
  }, { combatId, combatantId });

  // Give addBuffsToCombat time to run (it is async and fires after initiative is set)
  await page.waitForTimeout(800);

  const buffInTracker = await page.evaluate(({ combatId, buffId }) => {
    return game.combats.get(combatId)?.combatants.some(c => c.flags?.D35E?.buffId === buffId) ?? false;
  }, { combatId, buffId });

  expect(buffInTracker).toBe(false);
});

// ── 1583-b. Activating a no-timeline buff mid-combat does not add it to tracker ─
//
// When a buff with timeline.enabled = false is activated while combat is active
// (system.active toggled true via item.update), addBuffsToCombat must not be
// called or must skip it — no combatant entry should appear.

test('activating a no-timeline buff during combat does not add it to the tracker', async ({ page }) => {
  const { actorId, buffId } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Mid-Combat No-Timeline Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } },
    });
    // Buff starts inactive, no timeline
    const [buff] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Uninspiring Stance',
      type: 'buff',
      system: {
        active: false,
        timeline: { enabled: false, total: 0, elapsed: 0, deleteOnExpiry: false, tickOnEnd: false },
      },
    }]);
    return { actorId: actor.id, buffId: buff.id };
  });

  const { combatId, combatantId } = await createSceneAndCombat(page, actorId);

  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.rollInitiative([combatantId]);
    await combat.startCombat();
  }, { combatId, combatantId });

  // Activate the buff while combat is active
  await page.evaluate(async ({ actorId, buffId }) => {
    const actor = game.actors.get(actorId);
    await actor.items.get(buffId).update({ 'system.active': true });
  }, { actorId, buffId });

  // Allow time for any async addBuffsToCombat to run
  await page.waitForTimeout(800);

  const buffInTracker = await page.evaluate(({ combatId, buffId }) => {
    return game.combats.get(combatId)?.combatants.some(c => c.flags?.D35E?.buffId === buffId) ?? false;
  }, { combatId, buffId });

  expect(buffInTracker).toBe(false);
});

// ── 1583-c. Activating a timeline-enabled buff mid-combat DOES add it to tracker ─
//
// Counterpart to 1583-b: a buff with timeline.enabled = true activated while
// combat is active should still be added to the tracker (existing behaviour,
// confirmed not broken by the fix).

test('activating a timeline-enabled buff during combat adds it to the tracker', async ({ page }) => {
  const { actorId, buffId } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Mid-Combat Timeline Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } },
    });
    const [buff] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Inspire Courage',
      type: 'buff',
      system: {
        active: false,
        timeline: { enabled: true, total: 5, elapsed: 0, deleteOnExpiry: false, tickOnEnd: false },
      },
    }]);
    return { actorId: actor.id, buffId: buff.id };
  });

  const { combatId, combatantId } = await createSceneAndCombat(page, actorId);

  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.rollInitiative([combatantId]);
    await combat.startCombat();
  }, { combatId, combatantId });

  // Activate the buff while combat is active
  await page.evaluate(async ({ actorId, buffId }) => {
    const actor = game.actors.get(actorId);
    await actor.items.get(buffId).update({ 'system.active': true });
  }, { actorId, buffId });

  // Wait for the buff combatant to appear
  await page.waitForFunction(
    ({ combatId, buffId }) => game.combats.get(combatId)?.combatants.some(c => c.flags?.D35E?.buffId === buffId) ?? false,
    { combatId, buffId },
    { timeout: 5_000 }
  );

  const buffInTracker = await page.evaluate(({ combatId, buffId }) => {
    return game.combats.get(combatId)?.combatants.some(c => c.flags?.D35E?.buffId === buffId) ?? false;
  }, { combatId, buffId });

  expect(buffInTracker).toBe(true);
});

// ── 9. Buff with perRoundActions creates a chat message each turn ─────────────
//
// A buff with a perRoundActions entry fires applyOnRoundBuffActions when the
// actor's turn is processed (after the buff combatant's turn auto-advances).
// The action creates a chat message using templates/chat/dot-roll.html.

test('buff with perRoundActions creates a chat message when its turn is processed', async ({ page }) => {
  const { actorId, buffId } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'PerRound Action Actor',
      type: 'character',
      system: { abilities: { dex: { value: 10 } } },
    });
    const [buff] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Poison',
      type: 'buff',
      system: {
        active: true,
        timeline: { enabled: true, total: 3, elapsed: 0, deleteOnExpiry: false, tickOnEnd: false },
        perRoundActions: [{ action: 'SelfDamage 1d1 on self;', condition: '', img: '', name: 'Poison' }],
      },
    }]);
    return { actorId: actor.id, buffId: buff.id };
  });

  const { combatId, combatantId } = await createSceneAndCombat(page, actorId);

  // Roll, pin turn order (actor first), start
  await page.evaluate(async ({ combatId, combatantId, buffId }) => {
    const combat = game.combats.get(combatId);
    await combat.rollInitiative([combatantId]);

    await new Promise(resolve => {
      const check = () => {
        if (combat.combatants.some(c => c.flags?.D35E?.buffId === buffId)) resolve();
        else setTimeout(check, 50);
      };
      check();
    });

    const buffCombatant = combat.combatants.find(c => c.flags?.D35E?.buffId === buffId);
    await combat.updateEmbeddedDocuments('Combatant', [
      { _id: combatantId,       initiative: 20 },
      { _id: buffCombatant.id,  initiative: 19.99 },
    ]);

    await combat.startCombat();
  }, { combatId, combatantId, buffId });

  const msgsBefore = await page.evaluate(() => game.messages.size);

  // Advance turn: buff combatant auto-advances (elapsed 0→1, not expired since total=3),
  // then actor's turn fires applyOnRoundBuffActions → new chat message
  await page.evaluate(async (combatId) => {
    await game.combats.get(combatId).nextTurn();
  }, combatId);

  // Wait for the perRoundActions chat message to appear
  await page.waitForFunction(
    (before) => game.messages.size > before,
    msgsBefore,
    { timeout: 5_000 }
  );

  const msgsAfter = await page.evaluate(() => game.messages.size);
  expect(msgsAfter).toBeGreaterThan(msgsBefore);

  // Buff should NOT have been deleted (only 1 of 3 rounds elapsed)
  const buffStillExists = await page.evaluate(({ actorId, buffId }) => {
    return game.actors.get(actorId)?.items.has(buffId) ?? false;
  }, { actorId, buffId });
  expect(buffStillExists).toBe(true);
});

// ── 1656. Rolling initiative for a tokenless combatant does not throw ──────────
//
// Regression: c.token was accessed without a null guard in CombatD35E.rollInitiative.
// When the combatant has no placed token (actorId only, no tokenId), c.token is null
// and reading c.token.hidden threw "Cannot read properties of null (reading 'hidden')".
// After the fix (c.token?.hidden) the roll must succeed and return a numeric value.

test('rolling initiative for a tokenless combatant (no placed token) succeeds', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // Create actor and a combat with no scene — combatant will have actorId but no tokenId
  const { combatId, combatantId } = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Tokenless Initiative Actor', type: 'character' });
    await actor.update({ 'system.abilities.dex.value': 14 });

    // A combat with no scene (scene: null) is valid; the combatant resolver falls back
    // to game.actors.get(actorId) when c.token is null.
    const combat = await Combat.create({});
    const [combatant] = await combat.createEmbeddedDocuments('Combatant', [{ actorId: actor.id }]);

    return { combatId: combat.id, combatantId: combatant.id };
  });

  await page.evaluate(async ({ combatId, combatantId }) => {
    const combat = game.combats.get(combatId);
    await combat.rollInitiative([combatantId]);
  }, { combatId, combatantId });

  const initiative = await page.evaluate(({ combatId, combatantId }) => {
    return game.combats.get(combatId)?.combatants.get(combatantId)?.initiative ?? null;
  }, { combatId, combatantId });

  expect(initiative).not.toBeNull();
  expect(typeof initiative).toBe('number');

  // Must not throw the "Cannot read properties of null (reading 'hidden')" error
  const tokenError = consoleErrors.find(e => e.includes("hidden") || e.includes("token"));
  expect(tokenError).toBeUndefined();
});

// ── 1656-b. Sceneless combat — rollAll succeeds for multiple combatants ────────
//
// A combat created with no scene means canvas.scene is unrelated to it (or may be
// null).  rollInitiative accessed canvas.scene.id without a null guard, which
// threw "Cannot read properties of null (reading 'id')".
// After the fix (canvas.scene?.id ?? null) rollAll must succeed for all combatants.

test('rollAll in a sceneless combat assigns initiative to every combatant', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const { combatId, ids } = await page.evaluate(async () => {
    const [a1, a2] = await Promise.all([
      Actor.create({ name: 'Sceneless Actor A', type: 'character' }),
      Actor.create({ name: 'Sceneless Actor B', type: 'character' }),
    ]);
    await Promise.all([
      a1.update({ 'system.abilities.dex.value': 12 }),
      a2.update({ 'system.abilities.dex.value': 16 }),
    ]);

    const combat = await Combat.create({});
    const [c1, c2] = await combat.createEmbeddedDocuments('Combatant', [
      { actorId: a1.id },
      { actorId: a2.id },
    ]);

    return { combatId: combat.id, ids: [c1.id, c2.id] };
  });

  await page.evaluate(async (combatId) => {
    await game.combats.get(combatId).rollAll();
  }, combatId);

  const initiatives = await page.evaluate(({ combatId, ids }) => {
    const combat = game.combats.get(combatId);
    return ids.map(id => combat.combatants.get(id)?.initiative ?? null);
  }, { combatId, ids });

  for (const initiative of initiatives) {
    expect(initiative).not.toBeNull();
    expect(typeof initiative).toBe('number');
  }

  const err = consoleErrors.find(e => e.includes('null') || e.includes('undefined'));
  expect(err).toBeUndefined();
});

// ── 1656-c. Sceneless combat — initiative chat message is created ──────────────
//
// Even without a placed token or active scene, rollInitiative must produce a chat
// message so the GM can see the result.  speaker.scene / speaker.token default to
// null when there is no canvas scene or token; ChatMessage creation must still
// succeed.

test('rollInitiative in a sceneless combat creates a chat message', async ({ page }) => {
  const msgsBefore = await page.evaluate(() => game.messages.size);

  const { combatId, combatantId } = await page.evaluate(async () => {
    const actor = await Actor.create({ name: 'Sceneless Chat Actor', type: 'character' });
    const combat = await Combat.create({});
    const [combatant] = await combat.createEmbeddedDocuments('Combatant', [{ actorId: actor.id }]);
    return { combatId: combat.id, combatantId: combatant.id };
  });

  await page.evaluate(async ({ combatId, combatantId }) => {
    await game.combats.get(combatId).rollInitiative([combatantId]);
  }, { combatId, combatantId });

  // Wait up to 3 s for the chat message to land
  await page.waitForFunction(
    (before) => game.messages.size > before,
    msgsBefore,
    { timeout: 3_000 }
  );

  const msgsAfter = await page.evaluate(() => game.messages.size);
  expect(msgsAfter).toBeGreaterThan(msgsBefore);
});
