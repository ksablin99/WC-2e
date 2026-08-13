import { getSystemTemplate } from "../lib.js";
import { Propagator } from "../misc/propagator.js";
import { Roll35e } from "../roll.js";
import { applySummonDurationBuffFromTemplate } from "../actor/chat/summonDurationBuff.js";
import { ItemSpellHelper } from "../item/helpers/itemSpellHelper.js";
import { ItemUse } from "../item/extensions/use.js";
import { getSystemFlag, systemFlagPath } from "../utils/system-flags.js";
import {
  enforceWarcraftCasterLevelMinimum,
  getWarcraftSpellcastingAdjustments,
  normalizeWarcraftRuleName,
} from "../actor/helpers/warcraftSpellcastingHelper.js";

const FLAG_SCOPE = "warcraftrpg2e";
const FLAG_PATH = `flags.${FLAG_SCOPE}.conjured`;
const KIND_SUMMON = "summon";
const KIND_WEAPON = "weapon";
const ACTION_TYPE_SUMMON_WEAPON = "summonWeapon";
const BEHAVIOR_SPIRITUAL = "spiritual";
const BEHAVIOR_DANCING = "dancing";
const DANCING_FLAG_PATH = systemFlagPath("dancingWeapon");

function getDancingState(item) {
  return getSystemFlag(item, "dancingWeapon") ?? {};
}

function getActorTokenDocuments(actor) {
  if (!actor?.id) return [];
  const docs = [];
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) {
      if (token.actorId === actor.id) docs.push(token);
    }
  }
  return docs;
}

function getActiveOwnerToken(ownerActor) {
  if (!ownerActor?.id) return null;
  if (ownerActor.token) {
    return canvas?.tokens?.placeables?.find((token) => token.document.id === ownerActor.token.id) ?? null;
  }
  return canvas?.tokens?.placeables?.find((token) => token.actor?.id === ownerActor.id) ?? null;
}

function clearDocumentIds(data) {
  const clone = foundry.utils.duplicate(data);
  delete clone._id;
  delete clone.id;
  if (clone.items instanceof Array) {
    clone.items = clone.items.map((item) => {
      const clonedItem = foundry.utils.duplicate(item);
      delete clonedItem._id;
      delete clonedItem.id;
      return clonedItem;
    });
  }
  return clone;
}

function getAttackPartsForBab(bab) {
  const parts = [];
  const totalBab = Number(bab) || 0;
  const extraIteratives = Math.max(0, Math.floor((Math.max(0, totalBab) - 1) / 5));
  for (let k = 1; k <= extraIteratives; k++) {
    parts.push([`-${5 * k}`, `${game.i18n.localize("D35E.Attack")} ${k + 1}`]);
  }
  return parts;
}

async function setOnlyTargetToken(targetToken) {
  const currentTargets = [...(game.user?.targets ?? [])];
  for (const token of currentTargets) {
    token.setTarget(false, { user: game.user });
  }
  if (targetToken) {
    targetToken.setTarget(true, { user: game.user, releaseOthers: true });
  }
}

function duplicatePartList(parts = []) {
  return foundry.utils.duplicate(parts ?? []).map((part) => [...part]);
}

function resolveFormulaValue(value, rollData, { empty = "" } = {}) {
  if (value === undefined || value === null) return empty;
  if (typeof value === "number") return String(value);
  const text = String(value).trim();
  if (!text.length) return empty;
  return Roll35e.replaceFormulaData(text, rollData, { missing: "0" });
}

function getUnassignedSpellCasterLevel(item, ownerActor, rollData) {
  const learnedClasses = new Set(
    (item.system?.learnedAt?.class ?? [])
      .map((entry) => normalizeWarcraftRuleName(Array.isArray(entry) ? entry[0] : entry?.name))
      .filter(Boolean)
  );
  if (!learnedClasses.size) return 0;

  const matches = [];
  const seenClassIds = new Set();
  for (const classSystem of Object.values(ownerActor.system?.classes ?? {})) {
    if (!classSystem?.id || seenClassIds.has(classSystem.id)) continue;
    if (!learnedClasses.has(normalizeWarcraftRuleName(classSystem.name))) continue;
    seenClassIds.add(classSystem.id);
    matches.push(classSystem);
  }
  // An unassigned spell is only unambiguous when exactly one owned casting
  // class appears on its class list. Otherwise the spellbook must choose CL.
  if (matches.length !== 1) return 0;

  const classSystem = matches[0];
  const baseLevel = classSystem.halfCasterLevel
    ? Math.floor((Number(classSystem.level) || 0) / 2)
    : Number(classSystem.level) || 0;
  const warcraftAdjustment = getWarcraftSpellcastingAdjustments(item.system, classSystem, {
    parentClass: classSystem.name,
    learnedPath: item.system?.warcraftLearnedPath,
  });
  const casterLevel =
    baseLevel +
    (Number(classSystem.warcraftCasterLevelBonus) || 0) +
    (Number(item.system?.clOffset) || 0) +
    (Number(rollData.featClBonus) || 0) +
    warcraftAdjustment.casterLevel -
    (Number(ownerActor.system?.attributes?.energyDrain) || 0);
  return enforceWarcraftCasterLevelMinimum(casterLevel, warcraftAdjustment);
}

function cloneAttackTemplate() {
  const itemTemplate = getSystemTemplate("Item");
  let system = foundry.utils.duplicate(itemTemplate?.attack ?? {});
  for (const templateName of system.templates ?? []) {
    foundry.utils.mergeObject(system, foundry.utils.duplicate(itemTemplate?.templates?.[templateName] ?? {}));
  }
  delete system.templates;
  return system;
}

export class ConjuredManager {
  static #registered = false;

  static registerHooks() {
    if (this.#registered) return;
    this.#registered = true;

    Hooks.on("D35E.ItemUse.preUseItem", (item, actor, hookValues) => this.#onPreUseItem(item, actor, hookValues));
    Hooks.on("updateActor", (actor, changed) => this.#onUpdateActor(actor, changed));
    Hooks.on("deleteToken", (tokenDoc) => this.#onDeleteToken(tokenDoc));
    Hooks.on("deleteActor", (actor) => this.#onDeleteActor(actor));
    Hooks.on("updateToken", (tokenDoc, changed) => this.#onUpdateToken(tokenDoc, changed));
    Hooks.on("combatTurnChange", (combat, previous, current) => this.#onCombatTurnChange(combat, previous, current));
  }

  static isConjuredActor(actor) {
    return !!actor?.getFlag(FLAG_SCOPE, "conjured.kind");
  }

  static async spawnSummonFromChat({
    caster,
    monsterId,
    monsterPack,
    userId,
    durationRounds = 0,
    x = 0,
    y = 0,
    totalMonster = 1,
  }) {
    let monster = null;
    let isEphemeral = false;
    if (monsterPack) {
      const pack = game.packs.get(monsterPack);
      if (!pack) throw new Error(`Summon failed: compendium "${monsterPack}" not found.`);
      const source = await pack.getDocument(monsterId);
      if (!source) throw new Error("Summon failed: creature not found.");
      const actorData = clearDocumentIds(source.toObject());
      actorData.name = `${source.name} (Summoned)`;
      actorData.ownership = foundry.utils.duplicate(caster?.ownership ?? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
      foundry.utils.setProperty(actorData, FLAG_PATH, {
        kind: KIND_SUMMON,
        ownerActorId: caster?.id ?? null,
        sourcePack: monsterPack,
        sourceActorId: monsterId,
        ephemeral: true,
      });
      foundry.utils.setProperty(actorData, "prototypeToken.actorLink", true);
      foundry.utils.setProperty(actorData, "prototypeToken.disposition", getActiveOwnerToken(caster)?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY);
      monster = await Actor.create(actorData);
      isEphemeral = true;
    } else {
      monster = game.actors.get(monsterId);
    }
    if (!monster) throw new Error("Summon failed: creature not found.");

    const createdTokenIds = [];
    for (let spawned = 0; spawned < totalMonster; spawned++) {
      let tokenData = await monster.getTokenDocument({
        actorData: {
          ownership: { [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
          flags: { warcraftrpg2e: { allowPlayerMovement: true } },
        },
      });
      let internalSpawnPoint = {
        x: x - canvas.scene.dimensions.size * (tokenData.width / 2),
        y: y - canvas.scene.dimensions.size * (tokenData.height / 2),
      };
      const openPosition = Propagator.getFreePosition(tokenData, internalSpawnPoint);
      if (openPosition) internalSpawnPoint = openPosition;

      tokenData.updateSource(internalSpawnPoint);
      tokenData.updateSource({
        actorLink: true,
        ownership: { [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
      });
      const created = await canvas.scene.createEmbeddedDocuments("Token", [tokenData]);
      const td = created[0];
      if (!td) continue;
      createdTokenIds.push(td.id);
      if (durationRounds > 0 && td.actor) {
        await applySummonDurationBuffFromTemplate(td.actor, durationRounds);
      }
    }

    if (isEphemeral && monster) {
      await monster.setFlag(FLAG_SCOPE, "conjured.tokenIds", createdTokenIds);
    }
    return monster;
  }

  static async createSpiritualWeapon(item, ownerActor) {
    return this.createSummonedWeapon(item, ownerActor);
  }

  static async toggleDancingWeapon(item, ownerActor) {
    return this.createSummonedWeapon(item, ownerActor);
  }

  static async createSummonedWeapon(item, ownerActor) {
    if (!canvas?.scene || !ownerActor) return false;
    const behaviorId = foundry.utils.getProperty(item, "system.summonWeapon.behavior");
    if (!behaviorId) return false;
    if (behaviorId === BEHAVIOR_SPIRITUAL) return this.#createSpiritualSummonedWeapon(item, ownerActor);
    if (behaviorId === BEHAVIOR_DANCING) return this.#toggleDancingSummonedWeapon(item, ownerActor);
    return false;
  }

  static async cleanupConjuredActor(actor, { deleteActor = true } = {}) {
    if (!actor) return;
    await actor.setFlag(FLAG_SCOPE, "conjured.cleanupInProgress", true);
    const tokenDocs = getActorTokenDocuments(actor);
    for (const [sceneId, docs] of Object.entries(tokenDocs.reduce((acc, doc) => {
      (acc[doc.parent.id] ??= []).push(doc.id);
      return acc;
    }, {}))) {
      const scene = game.scenes.get(sceneId);
      if (scene && docs.length) {
        await scene.deleteEmbeddedDocuments("Token", docs);
      }
    }
    if (deleteActor && game.actors.has(actor.id)) {
      await actor.delete();
    }
  }

  static #buildOwnerChassis(ownerActor, { name, img, keepItems = [], conjured }) {
    const actorData = clearDocumentIds(ownerActor.toObject());
    actorData.name = name;
    actorData.img = img || actorData.img;
    actorData.items = (actorData.items ?? []).filter((item) => keepItems.includes(item.type));
    for (const [abilityKey, abilityData] of Object.entries(actorData.system?.abilities ?? {})) {
      const effectiveTotal = ownerActor.system?.abilities?.[abilityKey]?.total;
      if (Number.isFinite(effectiveTotal)) abilityData.value = effectiveTotal;
    }
    actorData.ownership = foundry.utils.duplicate(ownerActor.ownership ?? { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });
    foundry.utils.setProperty(actorData, FLAG_PATH, foundry.utils.duplicate(conjured));
    foundry.utils.setProperty(actorData, "prototypeToken.actorLink", true);
    foundry.utils.setProperty(actorData, "prototypeToken.name", name);
    foundry.utils.setProperty(actorData, "prototypeToken.texture.src", img || actorData.img);
    foundry.utils.setProperty(actorData, "prototypeToken.bar1", { attribute: "attributes.hp" });
    foundry.utils.setProperty(actorData, "prototypeToken.disposition", getActiveOwnerToken(ownerActor)?.document?.disposition ?? CONST.TOKEN_DISPOSITIONS.FRIENDLY);
    foundry.utils.setProperty(actorData, "system.attributes.conditions.banished", false);
    return actorData;
  }

  static #getSummonWeaponRollData(item, ownerActor, parentItem = null) {
    const rollData = foundry.utils.duplicate(ownerActor.getRollData(null, true));
    const parent = parentItem ?? item.parentItem ?? (item.conjuredSourceWeaponId ? ownerActor.items.get(item.conjuredSourceWeaponId) : null) ?? null;
    rollData.item = foundry.utils.duplicate(item.getRollData());
    if (item.type === "spell") {
      ItemSpellHelper.adjustSpellCL(item, item.system, rollData);
      if (!(Number(rollData.cl) > 0)) {
        const inferredCasterLevel = getUnassignedSpellCasterLevel(item, ownerActor, rollData);
        if (inferredCasterLevel > 0) {
          rollData.cl = inferredCasterLevel;
          rollData.spellPenetration =
            inferredCasterLevel +
            (new Roll35e(rollData.featSpellPenetrationBonus || "0", rollData).evaluateSync().total || 0);
        }
      }
    }
    if (parent?.getRollData) {
      rollData.parent = foundry.utils.duplicate(parent.getRollData());
      rollData.item.parent = foundry.utils.duplicate(rollData.parent);
    }
    return { rollData, parentItem: parent };
  }

  static #buildSummonedWeaponAttackData(item, ownerActor, { name, img, parentItem = null } = {}) {
    const { rollData, parentItem: resolvedParent } = this.#getSummonWeaponRollData(item, ownerActor, parentItem);
    const actionType = foundry.utils.getProperty(item, "system.summonWeapon.attackActionType") || "mwak";
    const sourceSystem = item.system ?? {};
    const parentSystem = resolvedParent?.system ?? {};
    const bab = Number(ownerActor.system?.attributes?.bab?.total) || 0;

    const system = cloneAttackTemplate();
    system.activation = foundry.utils.duplicate(sourceSystem.activation ?? system.activation);
    system.actionType = actionType;
    system.attackType = "misc";
    system.autoScaleOption = "never";
    system.proficient = true;
    system.primaryAttack = true;
    system.masterwork = false;
    system.enh = Number(parentSystem.enh ?? 0) || 0;
    system.weaponSubtype = parentSystem.weaponSubtype ?? sourceSystem.weaponSubtype ?? system.weaponSubtype;

    system.ability = foundry.utils.mergeObject(system.ability ?? {}, foundry.utils.duplicate(sourceSystem.ability ?? {}), { inplace: false });
    if (!system.ability.attack && resolvedParent) system.ability.attack = actionType === "rwak" ? "dex" : "str";
    if (!system.ability.damage && resolvedParent) system.ability.damage = actionType === "rwak" ? "" : "str";
    system.ability.critRange = resolveFormulaValue(system.ability.critRange, rollData, { empty: "20" });
    system.ability.critMult = Number(new Roll35e(resolveFormulaValue(system.ability.critMult, rollData, { empty: "2" }), rollData).evaluateSync().total || 2);

    const resolvedSpellBonus = resolveFormulaValue(sourceSystem.attackBonus, rollData);
    const babStr = bab !== 0 ? String(bab) : "";
    system.attackBonus = [babStr, resolvedSpellBonus].filter(Boolean).join(" + ");
    system.critConfirmBonus = resolveFormulaValue(sourceSystem.critConfirmBonus, rollData);
    system.attackCountFormula = resolveFormulaValue(sourceSystem.attackCountFormula, rollData);
    system.attackParts = duplicatePartList(sourceSystem.attackParts);
    if (!system.attackParts.length) system.attackParts = getAttackPartsForBab(bab);
    system.attackParts = system.attackParts.map(([formula, label]) => [resolveFormulaValue(formula, rollData), label]);

    system.damage.parts = duplicatePartList(sourceSystem.damage?.parts);
    system.damage.alternativeParts = duplicatePartList(sourceSystem.damage?.alternativeParts);
    if (!system.damage.parts.length && resolvedParent) {
      system.damage.parts = [[
        resolveFormulaValue("@parent.weaponData.damageRoll", rollData),
        resolveFormulaValue("@parent.weaponData.damageType", rollData),
        resolveFormulaValue("@parent.weaponData.damageTypeId", rollData),
      ]];
    }
    system.damage.parts = system.damage.parts.map(([formula, type, uid]) => [
      resolveFormulaValue(formula, rollData),
      resolveFormulaValue(type, rollData),
      resolveFormulaValue(uid, rollData),
    ]);
    system.damage.alternativeParts = system.damage.alternativeParts.map(([formula, type, uid]) => [
      resolveFormulaValue(formula, rollData),
      resolveFormulaValue(type, rollData),
      resolveFormulaValue(uid, rollData),
    ]);

    system.attackNotes = sourceSystem.attackNotes ?? "";
    system.effectNotes = sourceSystem.effectNotes ?? "";
    system.specialActions = foundry.utils.duplicate(sourceSystem.specialActions ?? []);
    system.description.value = sourceSystem.shortDescription ?? sourceSystem.description?.value ?? "";

    return {
      name: name ?? item.name,
      type: "attack",
      img: img ?? item.img,
      system,
      flags: {
        warcraftrpg2e: {
          conjuredAttack: {
            sourceItemId: item.id ?? null,
            sourceItemName: item.name,
            sourceParentItemId: resolvedParent?.id ?? null,
          },
        },
      },
    };
  }

  static async #spawnConjuredToken(actor, ownerToken, { x, y, userId }) {
    let tokenData = await actor.getTokenDocument({
      actorData: {
        ownership: { [userId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
        flags: { warcraftrpg2e: { allowPlayerMovement: true } },
      },
    });
    const internalSpawnPoint = { x, y };
    tokenData.updateSource({
      x: internalSpawnPoint.x,
      y: internalSpawnPoint.y,
      actorLink: true,
      disposition: ownerToken.document.disposition,
    });
    const created = await canvas.scene.createEmbeddedDocuments("Token", [tokenData]);
    return created[0] ?? null;
  }

  static async #performWeaponAttack(conjuredActor, { forceSingleAttack = false } = {}) {
    if (!game.user?.isActiveGM) return false;
    const conjured = conjuredActor.getFlag(FLAG_SCOPE, "conjured");
    const targetTokenId = conjured?.state?.targetTokenId;
    if (!targetTokenId) return false;
    const attackItem = conjuredActor.items.find((item) => item.type === "attack");
    if (!attackItem) return false;
    const targetToken = canvas.tokens?.get(targetTokenId) ?? canvas.tokens?.placeables?.find((token) => token.id === targetTokenId);
    if (!targetToken) return false;
    await setOnlyTargetToken(targetToken);
    const rollData = foundry.utils.duplicate(conjuredActor.getRollData(null, true));
    rollData.item = foundry.utils.duplicate(attackItem.getRollData());
    ItemUse.applyWeaponModeDamageMultiplier(rollData, "primary", attackItem);
    await attackItem.uses.rollAttack(!forceSingleAttack, null, false, conjuredActor, rollData, true);

    const nextState = foundry.utils.duplicate(conjured.state ?? {});
    nextState.lastAttackRound = game.combat?.round ?? nextState.lastAttackRound ?? 0;
    nextState.singleAttackOnly = false;
    await conjuredActor.setFlag(FLAG_SCOPE, "conjured.state", nextState);
    return true;
  }

  static async #createConjuredWeaponActor(item, ownerActor, { name, img, behaviorId, state = {}, sourceItemId = null, sourceItemName = null, parentItem = null } = {}) {
    const ownerToken = getActiveOwnerToken(ownerActor);
    if (!ownerToken) {
      ui.notifications.warn("Summoned weapon needs an active scene and an owner token.");
      return null;
    }

    const conjuredActorData = this.#buildOwnerChassis(ownerActor, {
      name,
      img,
      keepItems: [],
      conjured: {
        kind: KIND_WEAPON,
        behaviorId,
        ownerActorId: ownerActor.id,
        ownerTokenId: ownerToken.id,
        sourceItemId,
        sourceItemName,
        state,
      },
    });

    const conjuredActor = await Actor.create(conjuredActorData);
    const attackItemData = this.#buildSummonedWeaponAttackData(item, ownerActor, { name, img, parentItem });
    await conjuredActor.createEmbeddedDocuments("Item", [attackItemData]);
    const tokenDoc = await this.#spawnConjuredToken(conjuredActor, ownerToken, {
      x: ownerToken.document.x,
      y: ownerToken.document.y,
      userId: game.user.id,
    });
    if (!tokenDoc) {
      await conjuredActor.delete();
      return null;
    }
    await conjuredActor.setFlag(FLAG_SCOPE, "conjured.tokenIds", [tokenDoc.id]);
    return { conjuredActor, tokenDoc, ownerToken };
  }

  static async #createSpiritualSummonedWeapon(item, ownerActor) {
    const { rollData } = this.#getSummonWeaponRollData(item, ownerActor);
    const durationRounds = ItemSpellHelper.getSpellDurationCombatRounds(item, rollData) ?? 1;
    const targetTokenId = [...(game.user?.targets ?? [])][0]?.id ?? null;
    const created = await this.#createConjuredWeaponActor(item, ownerActor, {
      name: `${item.name} (${ownerActor.name})`,
      img: item.img,
      behaviorId: BEHAVIOR_SPIRITUAL,
      sourceItemId: item.id ?? null,
      sourceItemName: item.name,
      state: {
        cl: rollData.cl ?? ownerActor.system?.attributes?.hd?.total ?? 1,
        targetTokenId,
        lastAttackRound: game.combat?.round ?? 0,
        singleAttackOnly: false,
      },
    });
    if (!created) return false;

    await applySummonDurationBuffFromTemplate(created.conjuredActor, durationRounds);
    await this.#performWeaponAttack(created.conjuredActor, { forceSingleAttack: true });
    await this.#deductItemCharge(item);
    return true;
  }

  static async #toggleDancingSummonedWeapon(item, ownerActor) {
    const sourceWeapon = item.parentItem ?? (item.conjuredSourceWeaponId ? ownerActor?.items?.get(item.conjuredSourceWeaponId) : null);
    if (!sourceWeapon) {
      ui.notifications.warn("Dancing weapon source not found.");
      return false;
    }

    const dancingState = getDancingState(sourceWeapon);
    if ((Number(dancingState.cooldownRounds) || 0) > 0) {
      ui.notifications.warn(`${sourceWeapon.name} cannot dance again for ${dancingState.cooldownRounds} more rounds.`);
      return false;
    }
    if (dancingState.activeActorId) {
      await this.#endDancingWeapon(sourceWeapon, { applyCooldown: true });
      return true;
    }

    const targetTokenId = [...(game.user?.targets ?? [])][0]?.id ?? null;
    const dancingRounds = Number(item.system.summonWeapon?.dancingRounds) || 4;
    const created = await this.#createConjuredWeaponActor(item, ownerActor, {
      name: `${sourceWeapon.name} (Dancing)`,
      img: sourceWeapon.img,
      behaviorId: BEHAVIOR_DANCING,
      sourceItemId: sourceWeapon.id,
      sourceItemName: sourceWeapon.name,
      parentItem: sourceWeapon,
      state: {
        roundsRemaining: dancingRounds,
        targetTokenId,
        lastAttackRound: game.combat?.round ?? 0,
      },
    });
    if (!created) return false;

    await applySummonDurationBuffFromTemplate(created.conjuredActor, dancingRounds, { visual: true });
    await sourceWeapon.update({
      "system.equipped": false,
      [DANCING_FLAG_PATH]: {
        roundsRemaining: dancingRounds,
        activeActorId: created.conjuredActor.id,
        activeTokenId: created.tokenDoc.id,
        cooldownRounds: 0,
        returnEquipped: sourceWeapon.system?.equipped === true,
      },
    });
    await this.#performWeaponAttack(created.conjuredActor, { forceSingleAttack: true });
    return true;
  }

  static async #endDancingWeapon(sourceWeapon, { applyCooldown = false, cooldownTicksThisTurn = false } = {}) {
    const state = getDancingState(sourceWeapon);
    const conjuredActor = state.activeActorId ? game.actors.get(state.activeActorId) : null;
    if (conjuredActor) {
      await this.cleanupConjuredActor(conjuredActor);
    }
    const enhancements = foundry.utils.getProperty(sourceWeapon, "system.enhancements.items") ?? [];
    const dancingEnh = enhancements.find((e) => (e.system ?? e.data ?? e)?.properties?.dnc);
    const cooldownRounds = Number((dancingEnh?.system ?? dancingEnh?.data ?? dancingEnh)?.summonWeapon?.cooldownRounds) || 4;
    await sourceWeapon.update({
      "system.equipped": !!state.returnEquipped,
      [DANCING_FLAG_PATH]: {
        activeActorId: null,
        activeTokenId: null,
        // Automatic expiry is immediately followed by this turn hook's
        // cooldown decrement, so only that path needs a one-tick offset.
        cooldownRounds: applyCooldown ? cooldownRounds + (cooldownTicksThisTurn ? 1 : 0) : 0,
        roundsRemaining: 0,
        returnEquipped: !!state.returnEquipped,
      },
    });
  }

  static async #deductItemCharge(item) {
    if (!item?.isCharged) return;
    if (item.charges < item.chargeCost) {
      ui.notifications.warn(game.i18n.localize("D35E.ErrorNoCharges").format(item.name));
      return;
    }
    await item.addCharges(-1 * item.chargeCost);
  }

  static async #onPreUseItem(item, actor, hookValues) {
    if (!game.user?.isActiveGM) return;
    if (foundry.utils.getProperty(item, "system.actionType") !== ACTION_TYPE_SUMMON_WEAPON) return;
    hookValues.customUse = true;
    await this.createSummonedWeapon(item, actor);
  }

  static async #onUpdateActor(actor, changed) {
    if (!game.user?.isActiveGM) return;
    if (!this.isConjuredActor(actor)) return;
    if (actor.getFlag(FLAG_SCOPE, "conjured.kind") === KIND_SUMMON) return;
    if (foundry.utils.getProperty(changed, "system.attributes.conditions.banished") === true) {
      await this.cleanupConjuredActor(actor);
    }
  }

  static async #onDeleteToken(tokenDoc) {
    if (!game.user?.isActiveGM) return;
    const actor = tokenDoc?.actor;
    if (!this.isConjuredActor(actor)) return;
    if (actor.getFlag(FLAG_SCOPE, "conjured.cleanupInProgress")) return;
    const remaining = getActorTokenDocuments(actor).filter((doc) => doc.id !== tokenDoc.id);
    if (!remaining.length && game.actors.has(actor.id)) {
      await actor.delete();
    }
  }

  static async #onDeleteActor(actor) {
    if (!game.user?.isActiveGM) return;
    if (!this.isConjuredActor(actor)) return;
    const conjured = actor.getFlag(FLAG_SCOPE, "conjured");
    if (conjured?.behaviorId !== BEHAVIOR_DANCING) return;
    const owner = conjured?.ownerActorId ? game.actors.get(conjured.ownerActorId) : null;
    const sourceWeapon = owner?.items?.get(conjured.sourceItemId);
    if (!sourceWeapon) return;
    const state = getDancingState(sourceWeapon);
    if (state.activeActorId === actor.id) {
      await sourceWeapon.update({
        "system.equipped": !!state.returnEquipped,
        [DANCING_FLAG_PATH]: {
          activeActorId: null,
          activeTokenId: null,
          cooldownRounds: Number(state.cooldownRounds) || 0,
          returnEquipped: !!state.returnEquipped,
        },
      });
    }
  }

  static async #onUpdateToken(tokenDoc, changed) {
    if (!game.user?.isActiveGM) return;
    if (changed.x === undefined && changed.y === undefined) return;
    const ownerActorId = tokenDoc?.actorId ?? tokenDoc?.baseActor?.id ?? tokenDoc?.actor?.id;
    if (!ownerActorId) return;
    const conjuredActors = game.actors.filter((actor) => {
      const conjured = actor.getFlag(FLAG_SCOPE, "conjured");
      return conjured?.ownerActorId === ownerActorId && (!conjured?.ownerTokenId || conjured.ownerTokenId === tokenDoc.id);
    });
    for (const actor of conjuredActors) {
      if (actor.getFlag(FLAG_SCOPE, "conjured.behaviorId") !== BEHAVIOR_DANCING) continue;
      const tokenIds = actor.getFlag(FLAG_SCOPE, "conjured.tokenIds") ?? [];
      const activeTokenId = tokenIds[0];
      const conjuredToken = canvas.scene?.tokens?.get(activeTokenId);
      if (!conjuredToken) continue;
      await conjuredToken.update({
        x: changed.x ?? tokenDoc.x,
        y: changed.y ?? tokenDoc.y,
      });
    }
  }

  static async #onCombatTurnChange(combat, previous, current) {
    if (!game.user?.isActiveGM) return;
    if (!combat?.started) return;
    if (!(previous.round > 0)) return;

    const rewound =
      current.round < previous.round ||
      (current.round === previous.round &&
        previous.turn != null &&
        current.turn != null &&
        current.turn < previous.turn);
    if (rewound) return;

    const combatant = combat.combatant;
    const ownerActor = combatant?.actor;
    if (!ownerActor || getSystemFlag(combatant, "isBuff")) return;

    for (const actor of game.actors.filter((candidate) => candidate.getFlag(FLAG_SCOPE, "conjured.ownerActorId") === ownerActor.id)) {
      const conjured = actor.getFlag(FLAG_SCOPE, "conjured");
      if (!conjured?.behaviorId) continue;
      if (conjured.behaviorId === BEHAVIOR_DANCING) {
        const roundsRemaining = (Number(conjured.state?.roundsRemaining) || 0) - 1;
        const sourceWeapon = ownerActor.items.get(conjured.sourceItemId);
        if (!sourceWeapon) continue;
        if (roundsRemaining <= 0) {
          if (sourceWeapon) {
            await this.#endDancingWeapon(sourceWeapon, {
              applyCooldown: true,
              cooldownTicksThisTurn: true,
            });
          }
          continue;
        }
        await actor.setFlag(FLAG_SCOPE, "conjured.state.roundsRemaining", roundsRemaining);
        await sourceWeapon.update({ [`${DANCING_FLAG_PATH}.roundsRemaining`]: roundsRemaining });
      } else if (conjured.behaviorId === BEHAVIOR_SPIRITUAL) {
        // Spiritual Weapon attacks once whenever its owner's turn begins. The
        // initial summon already attacks immediately, so retain the recorded
        // round guard in case the combat hook is emitted more than once for
        // the same turn transition.
        const currentRound = Number(combat.round) || 0;
        const lastAttackRound = Number(conjured.state?.lastAttackRound) || 0;
        if (currentRound > lastAttackRound) {
          await this.#performWeaponAttack(actor);
        }
      }
    }

    for (const item of ownerActor.items.filter((candidate) => (Number(getDancingState(candidate).cooldownRounds) || 0) > 0)) {
      const cooldownRounds = Number(getDancingState(item).cooldownRounds) || 0;
      await item.update({ [`${DANCING_FLAG_PATH}.cooldownRounds`]: Math.max(0, cooldownRounds - 1) });
    }
  }
}
