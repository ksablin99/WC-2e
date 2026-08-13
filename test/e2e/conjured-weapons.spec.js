'use strict';

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const SUMMON_PACK = 'warcraftrpg2e.summon';
const WATER_MEPHIT_ID = 'RhkwgVpJxUmKJIqF';
const WEAPONS_PACK = 'warcraftrpg2e.weapons-and-ammo';
const LONGSWORD_ID = 'zWRlna42PMJVX6un';
const SPELLS_PACK = 'warcraftrpg2e.spells';
const SPIRITUAL_WEAPON_ID = 'FL2IZ9dkpBpCd8MI';
const ENHANCEMENTS_PACK = 'warcraftrpg2e.enhancements';
const DANCING_ENHANCEMENT_ID = 'HBzfLgyJDyAiQ3As';
const CLASSES_PACK = 'warcraftrpg2e.classes';
const CLERIC_CLASS_ID = 'qaM4mLNombMrdL2M';
const FIGHTER_CLASS_ID = 'sgwZt7dg1ZHXQlrW';
const RACIALFEATURES_PACK = 'warcraftrpg2e.racialfeatures';
const ELF_HIGH_ID = 'z5p39RR9V7lNlTK0';

async function createReadyScene(page, sceneData) {
  const sceneId = await page.evaluate(async (data) => {
    const scene = await Scene.create(data);
    return scene.id;
  }, { ...sceneData, active: true });
  await page.waitForFunction(
    (id) => canvas.ready && canvas.scene?.id === id && PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
    sceneId,
    { timeout: 15_000 },
  );
  return sceneId;
}

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

test('ephemeral compendium summon sets banished state and may linger for GM cleanup', async ({ page }) => {
  const sceneId = await createReadyScene(page, {
      name: 'Conjured Summon Scene',
      width: 1000,
      height: 1000,
      grid: { size: 100 },
  });
  const result = await page.evaluate(async ({ summonPack, summonId, sceneId }) => {
    const scene = game.scenes.get(sceneId);
    const caster = await Actor.create({ name: 'Summoner', type: 'character' });
    await scene.createEmbeddedDocuments('Token', [{
      name: caster.name,
      actorId: caster.id,
      actorLink: true,
      x: 100,
      y: 100,
    }]);

    const monster = await game.D35E.conjured.spawnSummonFromChat({
      caster,
      monsterId: summonId,
      monsterPack: summonPack,
      userId: game.user.id,
      durationRounds: 1,
      x: 300,
      y: 100,
      totalMonster: 1,
    });

    const tokenId = monster.getFlag('warcraftrpg2e', 'conjured.tokenIds')[0];
    await monster.update({ 'system.attributes.conditions.banished': true });
    await new Promise((resolve) => setTimeout(resolve, 250));

    return {
      actorExists: game.actors.has(monster.id),
      tokenExists: !!scene.tokens.get(tokenId),
      banished: game.actors.get(monster.id)?.system?.attributes?.conditions?.banished === true,
    };
  }, { summonPack: SUMMON_PACK, summonId: WATER_MEPHIT_ID, sceneId });

  expect(result.actorExists).toBe(true);
  expect(result.tokenExists).toBe(true);
  expect(result.banished).toBe(true);
});

test('Spiritual Weapon summonWeapon creates conjured actor and attacks again on owner turn', async ({ page }) => {
  const sceneId = await createReadyScene(page, {
    name: 'Spiritual Weapon Scene',
    width: 1200,
    height: 1200,
    grid: { size: 100 },
  });
  const result = await page.evaluate(async ({
    spellsPack, spiritualWeaponId, classesPack, clericClassId, racialfeaturesPack, elfHighId, sceneId,
  }) => {
    const waitFor = async (predicate, timeout = 10_000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Timed out waiting for actor updates');
    };

    const pickAbilities = (actor) => ['str', 'dex', 'con', 'int', 'wis', 'cha'].reduce((acc, key) => {
      acc[key] = {
        total: actor.system.abilities[key].total,
        mod: actor.system.abilities[key].mod,
      };
      return acc;
    }, {});

    const scene = game.scenes.get(sceneId);

    const caster = await Actor.create({ name: 'Cleric Caster', type: 'character' });
    await game.actors.get(caster.id).update({
      'system.abilities.str.value': 11,
      'system.abilities.dex.value': 13,
      'system.abilities.con.value': 9,
      'system.abilities.int.value': 14,
      'system.abilities.wis.value': 17,
      'system.abilities.cha.value': 8,
    });

    const classPack = game.packs.get(classesPack);
    const clericClass = await classPack.getDocument(clericClassId);
    const clericData = clericClass.toObject();
    clericData.system.levels = 10;
    await caster.createEmbeddedDocuments('Item', [clericData]);

    const racePack = game.packs.get(racialfeaturesPack);
    const elfRace = await racePack.getDocument(elfHighId);
    await caster.createEmbeddedDocuments('Item', [elfRace.toObject()]);
    await waitFor(() => {
      const actor = game.actors.get(caster.id);
      return actor?.system?.abilities?.dex?.mod === 2 && actor?.system?.abilities?.con?.mod === -2;
    });
    const ownerAbilities = pickAbilities(game.actors.get(caster.id));

    const enemy = await Actor.create({
      name: 'Target Dummy',
      type: 'npc',
      system: { attributes: { hp: { value: 30, max: 30 } } },
    });

    const [casterToken] = await scene.createEmbeddedDocuments('Token', [{
      name: caster.name,
      actorId: caster.id,
      actorLink: true,
      x: 100,
      y: 100,
    }]);
    const [enemyToken] = await scene.createEmbeddedDocuments('Token', [{
      name: enemy.name,
      actorId: enemy.id,
      actorLink: true,
      x: 300,
      y: 100,
    }]);
    enemyToken.object?.setTarget(true, { user: game.user, releaseOthers: true });

    const combat = await Combat.create({ scene: scene.id });
    await combat.activate();
    const [casterCombatant, enemyCombatant] = await combat.createEmbeddedDocuments('Combatant', [
      { tokenId: casterToken.id, hidden: false },
      { tokenId: enemyToken.id, hidden: false },
    ]);
    await combat.rollInitiative([casterCombatant.id, enemyCombatant.id]);
    await combat.startCombat();

    const spellPack = game.packs.get(spellsPack);
    const spell = await spellPack.getDocument(spiritualWeaponId);
    const [ownedSpell] = await caster.createEmbeddedDocuments('Item', [spell.toObject()]);

    const beforeMessages = game.messages.size;
    await game.D35E.conjured.createSummonedWeapon(caster.items.get(ownedSpell.id), caster);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const conjuredActor = game.actors.find((actor) => actor.getFlag('warcraftrpg2e', 'conjured.behaviorId') === 'spiritual');
    const attackItem = conjuredActor?.items?.find((item) => item.type === 'attack');
    const tokenCreated = !!canvas.scene?.tokens?.get((conjuredActor?.getFlag('warcraftrpg2e', 'conjured.tokenIds') ?? [])[0]);
    const afterCreateMessages = game.messages.size;

    // Initiative order is random. Advance until the caster's first turn in a
    // later round instead of assuming that exactly two turns returns to the
    // caster (it only returns to whichever combatant happened to start).
    const initialRound = combat.round;
    for (let steps = 0; steps < 6; steps++) {
      await combat.nextTurn();
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (combat.round > initialRound && combat.combatant?.actor?.id === caster.id) break;
    }
    await waitFor(() => game.messages.size > afterCreateMessages, 5_000);

    const casterActor = game.actors.get(caster.id);
    return {
      actorCreated: !!conjuredActor,
      tokenCreated,
      immediateAttackPosted: afterCreateMessages > beforeMessages,
      repeatAttackPosted: game.messages.size > afterCreateMessages,
      ownerActorId: conjuredActor?.getFlag('warcraftrpg2e', 'conjured.ownerActorId') ?? null,
      copiedClassItems: conjuredActor?.items?.filter((item) => item.type === 'class').length ?? 0,
      copiedRaceItems: conjuredActor?.items?.filter((item) => item.type === 'race').length ?? 0,
      ownerAbilities,
      conjuredAbilities: conjuredActor ? pickAbilities(conjuredActor) : null,
      attackItemActionType: attackItem?.system?.actionType ?? null,
      attackItemAttackBonus: attackItem?.system?.attackBonus ?? null,
      attackItemAttackAbility: attackItem?.system?.ability?.attack ?? null,
      attackItemDamage: attackItem?.system?.damage?.parts?.[0]?.[0] ?? null,
      conjuredCasterLevel: conjuredActor?.getFlag('warcraftrpg2e', 'conjured.state.cl') ?? null,
      casterBab: casterActor?.system?.attributes?.bab?.total ?? null,
    };
  }, {
    spellsPack: SPELLS_PACK,
    spiritualWeaponId: SPIRITUAL_WEAPON_ID,
    classesPack: CLASSES_PACK,
    clericClassId: CLERIC_CLASS_ID,
    racialfeaturesPack: RACIALFEATURES_PACK,
    elfHighId: ELF_HIGH_ID,
    sceneId,
  });

  expect(result.actorCreated).toBe(true);
  expect(result.tokenCreated).toBe(true);
  expect(result.immediateAttackPosted).toBe(true);
  expect(result.repeatAttackPosted).toBe(true);
  expect(result.ownerActorId).toBeTruthy();
  expect(result.copiedClassItems).toBe(0);
  expect(result.copiedRaceItems).toBe(0);
  expect(result.conjuredAbilities).toEqual(result.ownerAbilities);
  expect(result.attackItemActionType).toBe('msak');
  expect(result.attackItemAttackAbility).toBe('wis');
  expect(result.attackItemAttackBonus).toBe(String(result.casterBab));
  expect(result.conjuredCasterLevel).toBe(10);
  expect(result.attackItemDamage).not.toContain('@cl');
  expect(result.attackItemDamage).toContain(String(result.conjuredCasterLevel));
});

test('Dancing summonWeapon enhancement resolves @parent weapon data and follows owner', async ({ page }) => {
  const sceneId = await createReadyScene(page, {
    name: 'Dancing Weapon Scene',
    width: 1200,
    height: 1200,
    grid: { size: 100 },
  });
  const result = await page.evaluate(async ({
    weaponsPack, longswordId, enhancementsPack, dancingEnhancementId, classesPack, fighterClassId, racialfeaturesPack, elfHighId, sceneId,
  }) => {
    const waitFor = async (predicate, timeout = 10_000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Timed out waiting for actor updates');
    };

    const pickAbilities = (actor) => ['str', 'dex', 'con', 'int', 'wis', 'cha'].reduce((acc, key) => {
      acc[key] = {
        total: actor.system.abilities[key].total,
        mod: actor.system.abilities[key].mod,
      };
      return acc;
    }, {});

    const scene = game.scenes.get(sceneId);

    const fighter = await Actor.create({ name: 'Dancing Fighter', type: 'character' });
    await game.actors.get(fighter.id).update({
      'system.abilities.str.value': 15,
      'system.abilities.dex.value': 11,
      'system.abilities.con.value': 13,
      'system.abilities.int.value': 9,
      'system.abilities.wis.value': 12,
      'system.abilities.cha.value': 10,
    });

    const classPack = game.packs.get(classesPack);
    const fighterClass = await classPack.getDocument(fighterClassId);
    const fighterData = fighterClass.toObject();
    fighterData.system.levels = 6;
    await fighter.createEmbeddedDocuments('Item', [fighterData]);

    const racePack = game.packs.get(racialfeaturesPack);
    const elfRace = await racePack.getDocument(elfHighId);
    await fighter.createEmbeddedDocuments('Item', [elfRace.toObject()]);
    await waitFor(() => {
      const actor = game.actors.get(fighter.id);
      return actor?.system?.abilities?.dex?.mod === 1 && actor?.system?.abilities?.con?.mod === 0;
    });
    const ownerAbilities = pickAbilities(game.actors.get(fighter.id));

    const weaponPack = game.packs.get(weaponsPack);
    const longsword = await weaponPack.getDocument(longswordId);
    const [weapon] = await fighter.createEmbeddedDocuments('Item', [longsword.toObject()]);
    await fighter.items.get(weapon.id).update({ 'system.equipped': true });
    const sourceWeapon = fighter.items.get(weapon.id);
    const enhancementPack = game.packs.get(enhancementsPack);
    const dancingEnhancement = await enhancementPack.getDocument(dancingEnhancementId);
    const [ownedEnhancement] = await fighter.createEmbeddedDocuments('Item', [dancingEnhancement.toObject()]);
    const enhancementItem = fighter.items.get(ownedEnhancement.id);
    enhancementItem.parentItem = sourceWeapon;
    enhancementItem.conjuredSourceWeaponId = sourceWeapon.id;

    const enemy = await Actor.create({ name: 'Dancing Target', type: 'npc' });
    const [fighterToken] = await scene.createEmbeddedDocuments('Token', [{
      name: fighter.name,
      actorId: fighter.id,
      actorLink: true,
      x: 100,
      y: 100,
    }]);
    const [enemyToken] = await scene.createEmbeddedDocuments('Token', [{
      name: enemy.name,
      actorId: enemy.id,
      actorLink: true,
      x: 300,
      y: 100,
    }]);
    enemyToken.object?.setTarget(true, { user: game.user, releaseOthers: true });

    const beforeMessages = game.messages.size;
    await game.D35E.conjured.createSummonedWeapon(enhancementItem, fighter);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const conjuredActor = game.actors.find((actor) => actor.getFlag('warcraftrpg2e', 'conjured.behaviorId') === 'dancing');
    const conjuredTokenId = conjuredActor?.getFlag('warcraftrpg2e', 'conjured.tokenIds')?.[0];
    const firstToken = canvas.scene?.tokens?.get(conjuredTokenId);
    const attackItem = conjuredActor?.items?.find((item) => item.type === 'attack');

    await fighterToken.update({ x: 500, y: 200 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const movedOwnerToken = canvas.scene?.tokens?.get(fighterToken.id);
    const movedToken = canvas.scene?.tokens?.get(conjuredTokenId);

    enhancementItem.parentItem = sourceWeapon;
    enhancementItem.conjuredSourceWeaponId = sourceWeapon.id;
    await game.D35E.conjured.createSummonedWeapon(enhancementItem, fighter);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const finalWeapon = fighter.items.get(sourceWeapon.id);
    const state = finalWeapon.getFlag('warcraftrpg2e', 'dancingWeapon') ?? {};

    return {
      actorCreated: !!conjuredActor,
      immediateAttackPosted: game.messages.size > beforeMessages,
      sourceUnequipped: fighter.items.get(sourceWeapon.id).system.equipped === false || !!state.cooldownRounds,
      copiedClassItems: conjuredActor?.items?.filter((item) => item.type === 'class').length ?? 0,
      copiedRaceItems: conjuredActor?.items?.filter((item) => item.type === 'race').length ?? 0,
      ownerAbilities,
      conjuredAbilities: conjuredActor ? pickAbilities(conjuredActor) : null,
      attackItemActionType: attackItem?.system?.actionType ?? null,
      attackItemCritRange: String(attackItem?.system?.ability?.critRange ?? ''),
      attackItemCritMult: Number(attackItem?.system?.ability?.critMult ?? 0),
      attackItemDamage: attackItem?.system?.damage?.parts?.[0]?.[0] ?? null,
      tokenStartedAtOwner:
        !!firstToken &&
        firstToken.x === fighterToken.x &&
        firstToken.y === fighterToken.y,
      tokenFollowedOwner:
        !!movedToken &&
        !!movedOwnerToken &&
        movedToken.x === movedOwnerToken.x &&
        movedToken.y === movedOwnerToken.y,
      retrievedActorDeleted: !game.actors.has(conjuredActor?.id),
      cooldownRounds: Number(state.cooldownRounds) || 0,
      weaponReequipped: finalWeapon.system.equipped === true,
    };
  }, {
    weaponsPack: WEAPONS_PACK,
    longswordId: LONGSWORD_ID,
    enhancementsPack: ENHANCEMENTS_PACK,
    dancingEnhancementId: DANCING_ENHANCEMENT_ID,
    classesPack: CLASSES_PACK,
    fighterClassId: FIGHTER_CLASS_ID,
    racialfeaturesPack: RACIALFEATURES_PACK,
    elfHighId: ELF_HIGH_ID,
    sceneId,
  });

  expect(result.actorCreated).toBe(true);
  expect(result.immediateAttackPosted).toBe(true);
  expect(result.sourceUnequipped).toBe(true);
  expect(result.copiedClassItems).toBe(0);
  expect(result.copiedRaceItems).toBe(0);
  expect(result.conjuredAbilities).toEqual(result.ownerAbilities);
  expect(result.attackItemActionType).toBe('mwak');
  expect(result.attackItemCritRange).toBe('19');
  expect(result.attackItemCritMult).toBe(2);
  expect(result.attackItemDamage).toBe('1d8');
  expect(result.tokenStartedAtOwner).toBe(true);
  expect(result.tokenFollowedOwner).toBe(true);
  expect(result.retrievedActorDeleted).toBe(true);
  expect(result.cooldownRounds).toBe(4);
  expect(result.weaponReequipped).toBe(true);
});
