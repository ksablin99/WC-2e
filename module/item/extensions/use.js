import { ItemCharges } from "./charges.js";
import { getOriginalNameIfExists, getRollModesForSelect, CHAT_MESSAGE_STYLE_KEY, CHAT_MESSAGE_STYLE_OTHER } from "../../lib.js";
import { Roll35e } from "../../roll.js";
import { CACHE } from "../../cache.js";
import { ChatAttack } from "../chat/chatAttack.js";
import AbilityTemplate from "../../pixi/ability-template.js";
import { createCustomChatMessage } from "../../chat.js";
import { D35E } from "../../config.js";
import { ItemSpellHelper as ItemSpellHelper } from "../helpers/itemSpellHelper.js";
import { ItemCombatChangesHelper } from "../helpers/itemCombatChangesHelper.js";
import { ItemCombatCalculationsHelper } from "../helpers/itemCombatCalculationsHelper.js";
import { Item35E } from "../entity.js";
import { ItemActiveHelper } from "../helpers/itemActiveHelper.js";
import { DistanceHelper } from '../../canvas/distance-helper.js';
import { isSpellPreparedForSpellbook } from "../helpers/spellbookPreparationHelper.js";

async function getSpellFailureData(item, actor) {
  if (!item || item.type !== "spell" || !actor || actor.spellFailure <= 0) return null;

  const spellbook = foundry.utils.getProperty(actor.system, `attributes.spells.spellbooks.${item.system.spellbook}`);
  if (!spellbook || !spellbook.arcaneSpellFailure) return null;

  const spellFailure = (await new Roll35e("1d100").roll()).total;
  return {
    spellFailure,
    spellFailureTarget: actor.spellFailure,
    spellFailureSuccess: spellFailure > actor.spellFailure,
  };
}

/**
 * @param {TableResult} result
 * @param {string} formula
 * @returns {{ documentCollection: string, documentId: string, text: string, formula: string } | null}
 */
function mapTableResultToSummonableEntry(result, formula) {
  const docType = CONST.TABLE_RESULT_TYPES?.DOCUMENT ?? "document";
  if (result.type !== docType) return null;
  let documentCollection = result.documentCollection;
  let documentId = result.documentId;
  if (!documentCollection || !documentId) {
    if (!result.documentUuid) return null;
    const parsed = foundry.utils.parseUuid(result.documentUuid);
    if (!parsed?.collection) return null;
    const col = parsed.collection;
    documentCollection = col.metadata?.id ?? col.metadata?.name ?? col.id;
    documentId = parsed.documentId;
  }
  if (!documentCollection || !documentId) return null;
  return {
    documentCollection,
    documentId,
    text: result.name,
    formula,
  };
}

/**
 * Wire summon monster preview (native DOM; Dialog render callback).
 * @param {HTMLElement} htmlEl
 */
function bindAttackRollDialogSummonSelect(htmlEl) {
  const root = htmlEl?.querySelector?.(".window-content") ?? htmlEl;
  const form = root?.querySelector?.("form.attack-form");
  const sel = form?.querySelector?.('select[name="selected-monster"]');
  if (!form || !sel) return;

  const refreshMonsterPreview = async (select) => {
    if (!select || select.selectedIndex < 0) return;
    const opt = select.options[select.selectedIndex];
    const monsterPack = opt.getAttribute("data-pack");
    const monsterId = opt.getAttribute("data-id");
    const monsterFormula = opt.getAttribute("data-formula");
    const section = select.closest("section");
    if (!section || !monsterPack || !monsterId) return;
    const pack = game.packs.get(monsterPack);
    if (!pack) return;
    const monster = await pack.getDocument(monsterId);
    const mdd = monster.system;

    const setInput = (name, val) => {
      const el = section.querySelector(`input[name="${name}"]`);
      if (el) el.value = val == null ? "" : String(val);
    };
    setInput("monster-collection", monsterPack);
    setInput("monster-resultId", monsterId);
    setInput("monster-text", monster.name);
    setInput("monster-img", monster.img);
    setInput("monster-formula", monsterFormula);

    const setText = (selCss, text) => {
      const el = section.querySelector(selCss);
      if (el) el.textContent = text;
    };
    setText(".monster-summon-box .monster-name", monster.name);
    const imgEl = section.querySelector(".monster-summon-box .monster-img");
    if (imgEl) imgEl.setAttribute("src", monster.img);
    setText(".monster-summon-box .monster-cr", `CR${monster.system.details.totalCr}`);
    const hdLabel = monster.racialHD?.name ?? foundry.utils.getProperty(monster.system, "attributes.hd.object") ?? "";
    setText(
      ".monster-summon-box .monster-align",
      `${CONFIG.D35E.actorSizes[monster.system.traits.actualSize] ?? ""} ${hdLabel} ${monster.system.details?.alignment ?? ""}`.replace(/\s+/g, " ").trim()
    );
    setText(
      ".monster-summon-box .monster-hp",
      `${monster.system.attributes.hp.max} hp (${monster.system.attributes?.hd?.total || "Unknown"} HD)`
    );
    setText(
      ".monster-summon-box .monster-ac",
      `${mdd.attributes.ac?.normal?.total || "Unknown"} (${mdd.attributes.ac?.touch?.total || "Unknown"} touch, ${mdd.attributes?.ac?.flatFooted?.total || "Unknown"} flat-footed)`
    );
    setText(
      ".monster-summon-box .monster-bab",
      `${mdd.attributes?.bab?.total || "Unknown"}/${mdd.attributes?.cmd?.total || "Unknown"}`
    );
    setText(".monster-summon-box .monster-init", `${mdd.attributes?.initiative?.total || "Unknown"}`);
  };

  sel.addEventListener("change", () => {
    void refreshMonsterPreview(sel);
  });
  void refreshMonsterPreview(sel);
}

async function postSpellFailureCard(item, actor, spellFailureData, { rollMode = null } = {}) {
  if (!spellFailureData) return null;

  const token = actor ? actor.token : null;
  const templateData = {
    actor,
    item,
    name: item.displayName,
    tokenId: token ? `${token.parent.id}.${token.id}` : null,
    spellFailure: spellFailureData.spellFailure,
    spellFailureTarget: spellFailureData.spellFailureTarget,
    spellFailureSuccess: spellFailureData.spellFailureSuccess,
  };

  const chatData = {
    user: game.user.id,
    [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
    speaker: ChatMessage.getSpeaker({ actor }),
  };

  const finalRollMode = rollMode || game.settings.get("core", "rollMode");
  if (["gmroll", "blindroll"].includes(finalRollMode)) chatData.whisper = ChatMessage.getWhisperRecipients("GM");
  if (finalRollMode === "blindroll") chatData.blind = true;

  return createCustomChatMessage("systems/warcraftrpg2e/templates/chat/spell-failure-card.html", templateData, chatData);
}

export class ItemUse {
  /**
   * @param {Item35E} item Item
   */
  constructor(item) {
    this.item = item;
    this.itemUpdateData = {};
    this.itemData = {};
  }

  static applyWeaponModeDamageMultiplier(rollData, attackType, item) {
    ItemCombatCalculationsHelper.applyWeaponModeDamageMultiplier(rollData, attackType, item);
  }

  async use(tempActor, replacementId, ev, skipDialog, rollModeOverride, temporaryItem, skipChargeCheck) {
    let actor = this.item.actor;
    if (tempActor !== null) {
      actor = tempActor;
    }

    let hookValues = { replacementId, ev, skipDialog, rollModeOverride, temporaryItem, skipChargeCheck, customUse: false };
    /**
     * @hook D35E.ItemUse.preUseItem
     * The hook is called before an item is used. While it can change some values, its main purpose is to make a custom use of the item.
     * You can find examples of custom uses in the module's code - for Tome of Ability line of items, Deck of Illustions (which also uses D35E.ItemCreate.postCreateItem hook),
     *
     */
    Hooks.call("D35E.ItemUse.preUseItem", this.item, actor, hookValues);
    if (hookValues.customUse) return; // here we assume that the custom hook will handle everything
    replacementId = hookValues.replacementId;
    ev = hookValues.ev;
    skipDialog = hookValues.skipDialog;
    rollModeOverride = hookValues.rollModeOverride;
    temporaryItem = hookValues.temporaryItem;
    skipChargeCheck = hookValues.skipChargeCheck;


    if (foundry.utils.getProperty(this.item.system, "requiresPsionicFocus") && !this.item.actor?.system?.attributes?.psionicFocus)
      return ui.notifications.warn(game.i18n.localize("D35E.RequiresPsionicFocus"));
    if (this.item.type === "spell") {
      if (replacementId) {
        return this.useSpell(
          ev,
          {
            skipDialog: skipDialog,
            replacement: true,
            replacementItem: actor.items.get(replacementId),
            rollModeOverride: rollModeOverride,
          },
          actor
        );
      } else {
        return this.useSpell(ev, { skipDialog: skipDialog, rollModeOverride: rollModeOverride }, actor);
      }
    } else if (this.item.type === "full-attack") {
      if (game.settings.get("warcraftrpg2e", "showFullAttackChatCard")) await this.item.roll();
      for (let si = 1; si <= 5; si++) {
        const attack = foundry.utils.getProperty(this.item.system, `attacks.attack${si}`);
        if (!attack) continue;
        const slotId = foundry.utils.getProperty(attack, "id");
        if (!slotId) continue;
        const slotAttackMode = foundry.utils.getProperty(attack, "attackMode") ?? "primary";
        const slotCount = Number(foundry.utils.getProperty(attack, "count") ?? 1) || 1;
        let attackItem = actor.items.find((i) => i.id === slotId);
        if (!attackItem) continue;
        for (let i = 0; i < slotCount; i++) {
          let result = await new ItemUse(attackItem).useAttack(
            {
              ev: ev,
              skipDialog: skipDialog,
              attackType: slotAttackMode,
              isFullAttack: true,
              rollModeOverride: rollModeOverride,
              temporaryItem: temporaryItem,
            },
            actor,
            skipChargeCheck
          );
          if (result?.roll) await result.roll;
          if (!result.wasRolled && !ev.originalEvent?.shiftKey) return;
        }
      }
      return;
    } else if (this.item.type === "enhancement" || this.item.hasAction) {
      return this.useAttack(
        {
          ev: ev,
          skipDialog: skipDialog,
          rollModeOverride: rollModeOverride,
          temporaryItem: temporaryItem,
          attackType: foundry.utils.getProperty(this.item.system, "weaponSubtype") === "2h" ? "two-handed" : "primary",
        },
        actor,
        skipChargeCheck
      );
    }

    if (this.item.isCharged && !skipChargeCheck) {
      if (this.item.charges < this.item.chargeCost) {
        if (this.item.isSingleUse) return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoQuantity"));
        return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoCharges").format(this.item.name));
      }
      await this.item.addCharges(-1 * this.item.chargeCost);
    }
    return this.item.roll({ rollMode: rollModeOverride });
  }

  async rollAttack(fullAttack, form, temporaryItem, actor, rollData, skipChargeCheck) {
    let attackExtraParts = [],
      damageExtraParts = [],
      primaryAttack =
        foundry.utils.getProperty(this.item.system, "attackType") === "natural"
          ? foundry.utils.getProperty(this.item.system, "primaryAttack") !== false
          : true,
      useMeasureTemplate = false,
      useAmmoId = "none",
      useAmmoDamage = "",
      useAmmoAttack = "",
      useAmmoDamageType = "",
      useAmmoNote = "",
      useAmmoName = "",
      useAmmoEnhancement = "",
      ammoDamageParts = [],
      rapidShot = false,
      flurryOfBlows = false,
      manyshot = false,
      nonLethal = false,
      manyshotCount = 0,
      greaterManyshot = false,
      greaterManyshotCount = 0,
      twoWeaponFightingOffhand = false,
      hasTwoWeaponFightingFeat =
        actor.items.filter((o) => o.type === "feat" && getOriginalNameIfExists(o) === "Two-Weapon Fighting")?.length >
        0,
      multiweaponFighting =
        actor.items.filter(
          (o) =>
            o.type === "feat" &&
            (getOriginalNameIfExists(o) === "Multiweapon Fighting" || o.system.changeFlags.multiweaponAttack)
        ).length > 0,
      hasTwoImprovedWeaponFightingFeat =
        actor.items.filter((o) => o.type === "feat" && getOriginalNameIfExists(o) === "Improved Two-Weapon Fighting")
          ?.length > 0,
      hasTwoGreaterFightingFeat =
        actor.items.filter((o) => o.type === "feat" && getOriginalNameIfExists(o) === "Greater Two-Weapon Fighting")
          ?.length > 0,
      rollMode = null,
      optionalFeatIds = [],
      optionalFeatRanges = new Map(),
      enabledConditionals = [],
      props = [],
      rollModifiers = [],
      extraText = "",
      ammoMaterial = null,
      ammoEnh = 0,
      summonPack = "",
      summonId = "",
      summonName = "",
      summonFormula = "",
      summonImg = "";

    let selectedTargets = [];
    let selectedTargetIds = "";

    let damageModifiers = {
      maximize: false,
      multiplier: 1,
    };
    // Get form data
    if (form) {
      const formData = this.extractFormData(
        rollData,
        form,
        attackExtraParts,
        rollModifiers,
        damageExtraParts,
        rollMode,
        useAmmoId,
        useAmmoDamage,
        useAmmoDamageType,
        useAmmoAttack,
        useAmmoEnhancement,
        useAmmoNote,
        useAmmoName,
        actor,
        ammoMaterial,
        ammoEnh,
        manyshot,
        manyshotCount,
        nonLethal,
        greaterManyshotCount,
        greaterManyshot,
        rapidShot,
        flurryOfBlows,
        primaryAttack,
        useMeasureTemplate,
        hasTwoWeaponFightingFeat,
        multiweaponFighting,
        twoWeaponFightingOffhand,
        selectedTargetIds,
        selectedTargets,
        optionalFeatIds,
        optionalFeatRanges,
        enabledConditionals,
        summonPack,
        summonId,
        summonName,
        summonImg,
        summonFormula
      );
      rollMode = formData.rollMode;
      useAmmoId = formData.useAmmoId;
      useAmmoNote = formData.useAmmoNote;
      useAmmoName = formData.useAmmoName;
      ammoMaterial = formData.ammoMaterial;
      ammoEnh = formData.ammoEnh;
      ammoDamageParts = formData.ammoDamageParts;
      manyshot = formData.manyshot;
      manyshotCount = formData.manyshotCount;
      nonLethal = formData.nonLethal;
      greaterManyshotCount = formData.greaterManyshotCount;
      greaterManyshot = formData.greaterManyshot;
      rapidShot = formData.rapidShot;
      flurryOfBlows = formData.flurryOfBlows;
      primaryAttack = formData.primaryAttack;
      useMeasureTemplate = formData.useMeasureTemplate;
      twoWeaponFightingOffhand = formData.twoWeaponFightingOffhand;
      selectedTargetIds = formData.selectedTargetIds;
      selectedTargets = formData.selectedTargets;
      summonPack = formData.summonPack;
      summonId = formData.summonId;
      summonName = formData.summonName;
      summonImg = formData.summonImg;
      summonFormula = formData.summonFormula;
    }

    // Prepare the chat message data
    let chatTemplateData = {
      name: this.item.name,
      [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
      rollMode: rollMode,
    };

    let allAttacks = [];
    // Auto scaling attacks

    let autoScaleAttacks =
      (game.settings.get("warcraftrpg2e", "autoScaleAttacksBab") &&
        actor.type !== "npc" &&
        foundry.utils.getProperty(this.item.system, "attackType") === "weapon" &&
        foundry.utils.getProperty(this.item.system, "autoScaleOption") !== "never") ||
      foundry.utils.getProperty(this.item.system, "autoScaleOption") === "always";
    if (autoScaleAttacks && fullAttack) {
      allAttacks.push({ bonus: 0, label: `${game.i18n.localize("D35E.Attack")}` });
      // SRD 3.5e: second attack at BAB +6, third at +11, fourth at +16 (d20srd combatStatistics.htm).
      const nonepicBab = Math.max(0, foundry.utils.getProperty(actor.system, "attributes.bab.nonepic") || 0);
      const extraIteratives = Math.max(0, Math.floor((nonepicBab - 1) / 5));
      for (let k = 1; k <= extraIteratives; k++) {
        const a = 5 * k;
        allAttacks.push({
          bonus: `-${a}`,
          label: `${game.i18n.localize("D35E.Attack")} ${k + 1}`,
        });
      }
    } else {
      allAttacks = fullAttack
        ? this.item.system.attackParts.reduce(
          (cur, r) => {
            cur.push({ bonus: r[0], label: r[1] });
            return cur;
          },
          [{ bonus: 0, label: `${game.i18n.localize("D35E.Attack")}` }]
        )
        : [
          {
            bonus: 0,
            label: `${game.i18n.localize("D35E.Attack")}`,
          },
        ];
    }

    if ((fullAttack || actor.system.attributes.bab.total < 6) && rapidShot) {
      allAttacks.unshift({
        bonus: 0,
        label: `Rapid Shot`,
      });
      rollData.rapidShotPenalty = -2;
      attackExtraParts.push({
        part: "@rapidShotPenalty",
        value: rollData.rapidShotPenalty,
        source: game.i18n.localize("D35E.AttackRapidShot"),
      });
    }

    if (flurryOfBlows) {
      allAttacks.push({
        bonus: 0,
        label: game.i18n.localize("D35E.AttackFlurryOfBlows"),
      });
      let monkClass = (actor?.items || []).filter(
        (o) => o.type === "class" && (o.name === "Monk" || o.system.customTag === "monk")
      )[0];
      //1-4 = -2
      if (monkClass.system.levels < 5) {
        rollData.flurryOfBlowsPenalty = -2;
        attackExtraParts.push({
          part: "@flurryOfBlowsPenalty",
          value: rollData.rapidShotPenalty,
          source: game.i18n.localize("D35E.AttackFlurryOfBlows"),
        });
      }
      //5-8 = -1
      else if (monkClass.system.levels < 9) {
        rollData.flurryOfBlowsPenalty = -1;
        attackExtraParts.push({
          part: "@flurryOfBlowsPenalty",
          value: rollData.rapidShotPenalty,
          source: game.i18n.localize("D35E.AttackFlurryOfBlows"),
        });
        //9+ = 0
        //11+ = 2nd extra attack
      } else if (monkClass.system.levels > 10) {
        allAttacks.push({
          bonus: 0,
          label: game.i18n.localize("D35E.AttackFlurryOfBlows"),
        });
      }
    }

    let isHasted =
      (actor?.items || []).filter(
        (o) => ItemActiveHelper.isActive(o) && (o.name === "Haste" || o.system.changeFlags.hasted)
      ).length > 0;
    if (
      (fullAttack || actor.system.attributes.bab.total < 6) &&
      isHasted &&
      (foundry.utils.getProperty(this.item.system, "attackType") === "weapon" ||
        foundry.utils.getProperty(this.item.system, "attackType") === "natural")
    ) {
      allAttacks.unshift({
        bonus: 0,
        label: `Haste`,
      });
    }

    if (hasTwoImprovedWeaponFightingFeat && twoWeaponFightingOffhand) {
      allAttacks.push({
        bonus: "-5",
        label: `${game.i18n.localize("D35E.Attack")} 2`,
      });
    }
    if (hasTwoGreaterFightingFeat && twoWeaponFightingOffhand) {
      allAttacks.push({
        bonus: "-10",
        label: `${game.i18n.localize("D35E.Attack")} 3`,
      });
    }

    // //game.D35E.logger.log('Enabled conditionals', enabledConditionals)
    let attackEnhancementMap = new Map();
    let damageEnhancementMap = new Map();
    for (let enabledConditional of enabledConditionals) {
      let conditional = (rollData.item.conditionals || []).find((c) => c.name === enabledConditional);
      rollModifiers.push(`${conditional.name}`);
      for (let modifier of conditional.modifiers) {
        if (modifier.target === "attack") {
          if (modifier.subTarget !== "allAttack") {
            if (!attackEnhancementMap.has(modifier.subTarget)) attackEnhancementMap.set(modifier.subTarget, []);
            attackEnhancementMap
              .get(modifier.subTarget)
              .push({ part: modifier.formula, value: modifier.formula, source: `${conditional.name}` });
          } else {
            attackExtraParts.push({ part: modifier.formula, value: modifier.formula, source: `${conditional.name}` });
          }
        }
        if (modifier.target === "damage") {
          if (modifier.subTarget !== "allDamage") {
            if (!damageEnhancementMap.has(modifier.subTarget)) damageEnhancementMap.set(modifier.subTarget, []);
            damageEnhancementMap.get(modifier.subTarget).push({
              formula: modifier.formula,
              type: modifier.type,
              source: conditional.name,
            });
          } else
            damageExtraParts.push([
              modifier.formula,
              CACHE.DamageTypes.get(modifier.type)?.name || game.i18n.localize("D35E.UnknownDamageType"),
              modifier.type,
              `${conditional.name}`,
            ]);
        }
      }
    }

    // Getting all combat changes from items
    let allCombatChanges = [];
    let attackType = this.item.type;
    allCombatChanges = ItemCombatChangesHelper.getAllSelectedCombatChangesForRoll(
      actor.items,
      attackType,
      rollData,
      allCombatChanges,
      rollModifiers,
      optionalFeatIds,
      optionalFeatRanges
    );

    const persistentCombatChanges = allCombatChanges.filter((c) => !c.applyActionsOnlyOnce);
    const onceCombatChanges = allCombatChanges.filter((c) => c.applyActionsOnlyOnce);
    this.item._addCombatChangesToRollData(persistentCombatChanges, rollData);

    if (rollData.isKeen && !foundry.utils.getProperty(this.item.system, "threatRangeExtended")) {
      let baseCrit = foundry.utils.getProperty(this.item.system, "ability.critRange") || 20;
      baseCrit = 21 - 2 * (21 - baseCrit);
      rollData.item.ability.critRange = baseCrit;
      //foundry.utils.getProperty(this.item.system,"ability.critRange") = baseCrit;
    }

    if (rollData.featAdditionalAttacksBAB) {
      if (rollData.featAdditionalAttacksBAB > 0) {
        for (let i = 0; i < rollData.featAttackNumberBonus; i++) {
          allAttacks.push({
            bonus: "0",
            label: `${game.i18n.localize("D35E.Feat")} Bonus Attack`,
          });
        }
      }
    }

    let manyshotAttacks = [];
    if (greaterManyshot) {
      allAttacks.forEach((attack) => {
        let label = attack.label;
        for (let i = 0; i < greaterManyshotCount; i++) {
          let _attack = foundry.utils.duplicate(attack);
          _attack.label = label + ` (Greater Manyshot Arrow ${i + 1})`;
          manyshotAttacks.push(_attack);
        }
      });
      allAttacks = manyshotAttacks;
    }

    // Determine spell CL / SL / ablMod (does notthing for other items)
    this.#_determineSpellInfo(rollData)

    // Lock useAmount for powers to max value and add aliases
    if (this.item.type === "spell" && foundry.utils.getProperty(this.item.system, "isPower")) {
      rollData.useAmount = Math.max(
        0,
        Math.min(rollData.useAmount, rollData.cl - (foundry.utils.getProperty(this.item.system, "powerPointsCost") || 0))
      );
      rollData.powerPointsUsed = rollData.useAmount + parseInt(foundry.utils.getProperty(this.item.system, "powerPointsCost"));
      rollData.additionalPowerPointsUsed = rollData.useAmount;
      rollData.augmentation = rollData.useAmount;
    }

    let dc = this.#_getSpellDC(rollData);
    rollData.dc = dc;
    rollData.spellPenetration = rollData.cl + (new Roll35e(rollData.featSpellPenetrationBonus || "0", rollData).evaluateSync().total || 0);
    this.#_applyMetamagicModifiers(damageModifiers, rollModifiers, rollData);

    let attacks = [];

    if (this.item.hasAttack) {
      let attackId = 0;
      // Scaling number of attacks for spells (based on formula provided)
      if (rollData.item.attackCountFormula && rollData.item.attackParts.length === 0) {
        if (this.item.isSpellLike()) {
          ItemSpellHelper.adjustSpellCL(this.item, rollData.item, rollData);
        }
        let attackCount = (new Roll35e(rollData.item.attackCountFormula, rollData).evaluateSync().total || 1) - 1;
        for (let i = 0; i < attackCount; i++) {
          allAttacks.push({
            bonus: "0",
            label: "Attack",
          });
        }
      }
      rollData.ammoMaterial = ammoMaterial;
      rollData.ammoEnh = ammoEnh;
      Hooks.call("D35E.ItemUse.preRollAllAttacks", this.item, rollData, allAttacks, game.userId);
      for (let atk of allAttacks) {
        const attackRollData = foundry.utils.duplicate(rollData);
        if (attackId === 0 && onceCombatChanges.length) {
          this.item._addCombatChangesToRollData(onceCombatChanges, attackRollData);
        }
        // Create attack object
        let attack = new ChatAttack(this.item, atk.label, actor, attackRollData, rollData.ammoMaterial, rollData.ammoEnh);
        let localAttackExtraParts = foundry.utils.duplicate(attackExtraParts);
        for (let aepConditional of attackEnhancementMap.get(`attack.${attackId}`) || []) {
          localAttackExtraParts.push(aepConditional);
        }
        let localDamageExtraParts = foundry.utils.duplicate(damageExtraParts);
        this.#appendFeatDamagePartsFromRollData(attackRollData, localDamageExtraParts);
        for (let aepConditional of damageEnhancementMap.get(`attack.${attackId}`) || []) {
          localDamageExtraParts.push([
            aepConditional.formula,
            CACHE.DamageTypes.get(aepConditional.type)?.name || game.i18n.localize("D35E.UnknownDamageType"),
            aepConditional.type,
            aepConditional.source,
          ]);
        }
        await attack.addAttack({
          bonus: atk.bonus || 0,
          extraParts: localAttackExtraParts,
          primaryAttack: primaryAttack,
          actor: actor,
          critConfirmBonus:
            new Roll35e(`${foundry.utils.getProperty(this.item.system, "critConfirmBonus")}` || "0", attackRollData).evaluateSync().total +
            (attackRollData.featCritConfirmBonus || 0),
        });
        if (this.item.hasDamage) {
          await attack.addDamage({
            extraParts: localDamageExtraParts,
            primaryAttack: primaryAttack,
            critical: false,
            actor: actor,
            modifiers: damageModifiers,
            ammoDamageParts: ammoDamageParts,
          });
          if (attack.hasCritConfirm) {
            await attack.addDamage({
              extraParts: localDamageExtraParts,
              primaryAttack: primaryAttack,
              critical: true,
              actor: actor,
              modifiers: damageModifiers,
              ammoDamageParts: ammoDamageParts,
            });
          }
          if (manyshot) {
            for (let i = 1; i < manyshotCount; i++) {
              await attack.addDamage({
                extraParts: localDamageExtraParts,
                primaryAttack: primaryAttack,
                critical: false,
                actor: actor,
                multiattack: i,
                modifiers: damageModifiers,
                ammoDamageParts: ammoDamageParts,
              });
            }
          }
        }
        await attack.addEffect({
          primaryAttack: primaryAttack,
          actor: actor,
          useAmount: attackRollData.useAmount || 1,
          cl: attackRollData.cl || null,
          spellPenetration: attackRollData.spellPenetration || null,
        });
        await this.item._addCombatSpecialActionsToAttack(
          allCombatChanges,
          attack,
          actor,
          attackRollData,
          optionalFeatRanges,
          attackId
        );
        // Add to list
        attacks.push(attack);
        attackId++;
      }
    }
    // Add damage only
    else if (this.item.hasDamage) {
      let attackCount = 1;
      if (rollData.item.attackCountFormula) {
        if (this.item.isSpellLike()) {
          ItemSpellHelper.adjustSpellCL(this.item, rollData.item, rollData);
        }
        attackCount = new Roll35e(rollData.item.attackCountFormula, rollData).evaluateSync().total || 1;
      }
      for (let i = 0; i < attackCount; i++) {
        let attack = new ChatAttack(this.item, "", actor, rollData, ammoMaterial, ammoEnh);
        attack.rollData = rollData;
        await attack.addDamage({
          extraParts: damageExtraParts,
          primaryAttack: primaryAttack,
          critical: false,
          modifiers: damageModifiers,
        });
        await attack.addEffect({
          primaryAttack: primaryAttack,
          actor: actor,
          useAmount: rollData.useAmount || 1,
          cl: rollData.cl || null,
          spellPenetration: rollData.spellPenetration || null,
        });

        await this.item._addCombatSpecialActionsToAttack(
          allCombatChanges,
          attack,
          actor,
          rollData,
          optionalFeatRanges,
          0
        );

        attacks.push(attack);
      }
    }
    // Add effect notes only
    else if (this.item.hasEffect) {
      let attack = new ChatAttack(this.item, "", actor, rollData, ammoMaterial, ammoEnh);
      attack.rollData = rollData;
      if (this.item.isSpellLike()) {
        ItemSpellHelper.adjustSpellCL(this.item, rollData.item, rollData);
      }
      await attack.addEffect({
        primaryAttack: primaryAttack,
        actor: actor,
        useAmount: rollData.useAmount || 1,
        cl: rollData.cl || null,
        spellPenetration: rollData.spellPenetration || null,
      });
      await this.item._addCombatSpecialActionsToAttack(
        allCombatChanges,
        attack,
        actor,
        rollData,
        optionalFeatRanges,
        0
      );
      // Add to list
      attacks.push(attack);
    } else if (foundry.utils.getProperty(this.item.system, "actionType") === "special") {
      let attack = new ChatAttack(this.item, "", actor, rollData, ammoMaterial, ammoEnh);
      if (this.item.isSpellLike()) {
        ItemSpellHelper.adjustSpellCL(this.item, rollData.item, rollData);
      }
      attack.rollData = rollData;
      await attack.addSpecial(actor, rollData.useAmount || 1, rollData.cl, rollData.spellPenetration);
      await this.item._addCombatSpecialActionsToAttack(
        allCombatChanges,
        attack,
        actor,
        rollData,
        optionalFeatRanges,
        0
      );
      // Add to list
      attacks.push(attack);
    }
    let rolls = [];
    attacks.forEach((a) => {
      rolls.push(...a.rolls);
    });
    chatTemplateData.attacks = attacks;

    if (summonName) {
      let _actor = game.actors.find((a) => a.name === summonName);
      if (_actor) {
        summonId = _actor.id;
        summonPack = "";
      }
    }

    let hiddenTargets = [];

    // Prompt measure template
    let templateId = "";
    let templateX = 0;
    let templateY = 0;
    if (useMeasureTemplate) {
      let optionalData = {};
      const template = AbilityTemplate.fromItem(this, rollData.spellWidened ? 2 : 1, rollData, optionalData);
      if (!template) {
        ui.notifications.warn("Could not build the spell area template.");
        return { rolled: false, rollData: rollData };
      }
      const sheetRendered = this.item.parent?.sheet?._element != null;
      if (sheetRendered) this.item.parent.sheet.minimize();
      const result = await template.drawPreview(event);
      if (sheetRendered) this.item.parent.sheet.maximize();
      if (!result?.result) {
        return { rolled: false, rollData: rollData };
      }
      const _template = await result.place();
      if (!_template) {
        ui.notifications.warn("Could not place the area template.");
        return { rolled: false, rollData: rollData };
      }
      if (selectedTargets.length == 0) {
        selectedTargets = template.getTokensWithin().filter((t) => !t.document.hidden);
        hiddenTargets = template.getTokensWithin().filter((t) => t.document.hidden);
      }
      templateId = _template.id;
      templateX = _template.x;
      templateY = _template.y;
    }

    // //game.D35E.logger.log(`Updating item on attack.`)
    // Deduct charge
    if (this.item.autoDeductCharges && !skipChargeCheck) {
      // //game.D35E.logger.log(`Deducting ${this.item.chargeCost} charges.`)
      if (rollData.useAmount === undefined) await this.item.addCharges(-1 * this.item.chargeCost, this.itemUpdateData);
      else await this.item.addCharges(-1 * parseFloat(rollData.useAmount) * this.item.chargeCost, this.itemUpdateData);
    } else {
      if (!skipChargeCheck && foundry.utils.getProperty(this.item.system, "requiresPsionicFocus")) {
        if (this.item.actor) {
          await this.item.actor.update({ "system.attributes.psionicFocus": false });
        }
      }
    }
    if (useAmmoId !== "none" && actor !== null && !foundry.utils.getProperty(this.item.system, "returning")) {
      const ammoItem = actor.items.get(useAmmoId);
      if (ammoItem && !ammoItem.system.infiniteAmmo) {
        await actor.quickChangeItemQuantity(useAmmoId, -1 * attacks.length * (1 + Math.max(0, manyshotCount - 1)));
      }
    }
    // Update item, only if it has an id (is real item, not item from enhancement)
    if (this.itemUpdateData._id && !temporaryItem) await this.item.update(this.itemUpdateData);

    // Set chat data
    let chatData = {
      speaker: ChatMessage.getSpeaker({ actor: actor }),
      rollMode: rollMode,
      sound: CONFIG.sounds.dice,
      "flags.D35E.noRollRender": true,
    };

    // Post message
    const isSpellUse = this.item.type === "spell" || foundry.utils.getProperty(this.item.system, "isFromSpell");
    const shouldPostSpellDescription = !game.settings.get("warcraftrpg2e", "hideSpellDescriptionsIfHasAction");
    const shouldFizzleOnArcaneFailure = game.settings.get("warcraftrpg2e", "fizzleSpellOnArcaneFailure");
    const spellFailureData = isSpellUse ? await getSpellFailureData(this.item, actor) : null;
    if (isSpellUse) {
      if (shouldPostSpellDescription)
        await this.item.roll({ rollMode: rollMode }, actor);

      const shouldPostSpellFailureCard =
        !!spellFailureData &&
        (shouldPostSpellDescription ||
          (shouldFizzleOnArcaneFailure && !spellFailureData.spellFailureSuccess));
      if (spellFailureData && shouldPostSpellFailureCard) {
        await postSpellFailureCard(this.item, actor, spellFailureData, { rollMode });
      }

      if (spellFailureData && shouldFizzleOnArcaneFailure && !spellFailureData.spellFailureSuccess) {
        return { rolled: true, rollData };
      }
    }
    let rolled = false;
    if (
      this.item.hasAttack ||
      this.item.hasDamage ||
      this.item.hasEffect ||
      foundry.utils.getProperty(this.item.system, "actionType") === "special" ||
      foundry.utils.getProperty(this.item.system, "actionType") === "summon"
    ) {
      // //game.D35E.logger.log(`Generating chat message.`)
      // Get extra text and properties
      let hasBoxInfo = this.item.hasAttack || this.item.hasDamage || this.item.hasEffect;
      let attackNotes = [];
      const noteObjects = actor.getContextNotes("attacks.attack");
      if (typeof rollData.item.attackNotes === "string" && rollData.item.attackNotes.length) {
        noteObjects.push({ notes: [rollData.item.attackNotes] });
      }

      if (useAmmoNote !== "") {
        noteObjects.push({ notes: [useAmmoNote] });
      }
      for (let noteObj of noteObjects) {
        rollData.item = {};
        if (noteObj.item != null) rollData.item = foundry.utils.duplicate(noteObj.item.system);

        for (let note of noteObj.notes) {
          let source = noteObj?.item?.name || game.i18n.localize("D35E.Unknown");
          for (let _note of note.split(/[\n\r]+/)) {
            let attackNote = await foundry.applications.ux.TextEditor.enrichHTML(
              `<span class="tag tooltip"><span class="tooltipcontent">${source}</span> ${Item35E._fillTemplate(_note, rollData)}</span>`,
              {
                rollData: rollData,
              }
            );
            attackNotes.push(attackNote);
          }
        }
      }
      let attackStr = "";
      for (let an of attackNotes) {
        attackStr += `${an}`;
      }

      if (attackStr.length > 0) {
        const innerHTML = await foundry.applications.ux.TextEditor.enrichHTML(attackStr, { rollData: rollData });
        extraText += `<div class="flexcol property-group"><label>${game.i18n.localize(
          "D35E.AttackNotes"
        )}</label><div class="flexrow">${innerHTML}</div></div>`;
      }

      const properties = (await this.item.getChatData({}, rollData)).properties;
      if (properties.length > 0)
        props.push({
          header: game.i18n.localize("D35E.InfoShort"),
          value: properties,
        });
      if (rollModifiers.length > 0)
        props.push({
          header: game.i18n.localize("D35E.RollModifiers"),
          value: rollModifiers,
        });
      hiddenTargets = hiddenTargets.map((t) => {
        return {
          name: t.document.name,
          img: t.document.texture.src,
        };
      });
      selectedTargets = selectedTargets.map((t) => {
        return {
          id: t.id,
          name: t.document.name,
          img: t.document.texture.src,
        };
      });
      const token = actor ? actor.token : null;
      let summonDurationRounds = null;
      if (this.item.type === "spell" && foundry.utils.getProperty(this.item.system, "actionType") === "summon") {
        summonDurationRounds = ItemSpellHelper.getSpellDurationCombatRounds(this.item, rollData);
      }
      const templateData = foundry.utils.mergeObject(
        chatTemplateData,
        {
          extraText: extraText,
          hasExtraText: extraText.length > 0,
          properties: props,
          hasProperties: props.length > 0,
          item: this.item,
          actor: actor,
          tokenId: token ? `${token.parent.id}.${token.id}` : null,
          hasBoxInfo: hasBoxInfo,
          useAmmoName: useAmmoName,
          dc: dc,
          nonLethal: nonLethal,
          useAmmoId: useAmmoId,
          incorporeal: foundry.utils.getProperty(this.item.system, "incorporeal") || this.item.actor?.system?.traits?.incorporeal,
          targets: selectedTargets,
          hiddenTargets: hiddenTargets,
          targetIds: selectedTargetIds,
          hasTargets: selectedTargets.length || hiddenTargets.length,
          isSpell: this.item.type === "spell",
          hasPr: foundry.utils.getProperty(this.item.system, "pr"),
          hasSr: foundry.utils.getProperty(this.item.system, "sr"),
          cl: rollData.cl,
          summonPack: summonPack,
          summonId: summonId,
          summonName: summonName,
          summonImg: summonImg,
          summonFormula: summonFormula,
          summonDurationRounds: summonDurationRounds,
          userId: game.user.id,
          measureId: templateId,
          measureX: templateX,
          measureY: templateY,
          spellPenetration: rollData.spellPenetration,
          spellFailure: shouldPostSpellDescription ? null : spellFailureData?.spellFailure,
          spellFailureTarget: shouldPostSpellDescription ? null : spellFailureData?.spellFailureTarget,
          spellFailureSuccess: shouldPostSpellDescription ? null : spellFailureData?.spellFailureSuccess,
        },
        { inplace: false }
      );
      // Create message
      await createCustomChatMessage("systems/warcraftrpg2e/templates/chat/attack-roll.html", templateData, chatData, {
        rolls: rolls,
      });
      rolled = true;
    }
    if (this.item.hasRolltableDraw) {
      let rollTable = await game.packs
        .get(foundry.utils.getProperty(this.item.system, "rollTableDraw.pack"))
        .getDocument(foundry.utils.getProperty(this.item.system, "rollTableDraw.id"));
      if (foundry.utils.getProperty(this.item.system, "rollTableDraw.formula")) {
        var roll = new Roll35e(foundry.utils.getProperty(this.item.system, "rollTableDraw.formula"), rollData);
        await rollTable.draw({ roll: roll, rollMode: rollMode });
      } else {
        await rollTable.draw({ rollMode: rollMode });
      }
    }
    return { rolled: rolled, rollData: rollData };
  }

  #appendFeatDamagePartsFromRollData(rollData, damageExtraParts) {
    if (rollData.featDamageBonusList) {
      for (let [i, bonus] of rollData.featDamageBonusList.entries()) {
        damageExtraParts.push([
          "@critMult*(${this.featDamageBonusList[" + i + "].value})",
          bonus["sourceName"],
          "base",
        ]);
      }
    }
    if (rollData.featDamagePrecisionList) {
      for (let [i, bonus] of rollData.featDamagePrecisionList.entries()) {
        damageExtraParts.push(["(${this.featDamagePrecisionList[" + i + "].value})", bonus["sourceName"]]);
      }
    }
    if (rollData.featDamageList) {
      for (let dmg of Object.keys(rollData.featDamageList)) {
        for (let [i, bonus] of rollData.featDamageList[dmg].entries()) {
          damageExtraParts.push([
            "(${this.featDamageList['" + dmg + "'][" + i + "].value})",
            dmg,
            null,
            bonus["sourceName"],
          ]);
        }
      }
    }
  }

  #_applyMetamagicModifiers(damageModifiers, rollModifiers, rollData) {
    if (this.item.system?.metamagicFeats?.maximized) {
      damageModifiers.maximize = true;
      rollModifiers.push(`${game.i18n.localize("D35E.SpellMaximized")}`);
    }
    if (this.item.system?.metamagicFeats?.empowered) {
      damageModifiers.multiplier = 1.5;
      rollModifiers.push(`${game.i18n.localize("D35E.SpellEmpowered")}`);
    }
    if (this.item.system?.metamagicFeats?.intensified) {
      damageModifiers.maximize = true;
      damageModifiers.multiplier = 2;
      rollModifiers.push(`${game.i18n.localize("D35E.SpellIntensified")}`);
    }
    if (this.item.system?.metamagicFeats?.enlarged) {
      rollData.spellEnlarged = true;
      rollModifiers.push(`${game.i18n.localize("D35E.SpellEnlarged")}`);
    }
    if (this.item.system?.metamagicFeats?.widened) {
      rollData.spellWidened = true;
      rollModifiers.push(`${game.i18n.localize("D35E.SpellWidened")}`);
    }
    if (this.item.system?.metamagicFeats?.enhanced) {
      rollData.maxDamageDice += 10;
      rollModifiers.push(`${game.i18n.localize("D35E.SpellEnhanced")}`);
    }
  }

  async useAttack(
    {
      ev = null,
      skipDialog = false,
      attackType = "primary",
      isFullAttack = false,
      rollModeOverride = null,
      temporaryItem = false,
    } = {},
    tempActor = null,
    skipChargeCheck = false
  ) {
    if (ev && ev.originalEvent) ev = ev.originalEvent;
    let actor = this.item.actor;
    if (tempActor !== null) {
      actor = tempActor;
    }
    if (actor && !actor.isOwner) return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoActorPermission"));

    const itemQuantity = foundry.utils.getProperty(this.item.system, "quantity");
    if (itemQuantity != null && itemQuantity <= 0 && !skipChargeCheck) {
      return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoQuantity"));
    }

    if (
      foundry.utils.getProperty(this.item.system, "requiresPsionicFocus") &&
      !this.item.actor?.system?.attributes?.psionicFocus &&
      !skipChargeCheck
    )
      return ui.notifications.warn(game.i18n.localize("D35E.RequiresPsionicFocus"));

    if (this.item.isCharged && this.item.charges < this.item.chargeCost && !skipChargeCheck) {
      return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoCharges").format(this.item.name));
    }

    this.itemData = this.item.getRollData();
    const rollData = actor ? foundry.utils.duplicate(actor.getRollData(null, true)) : {};
    rollData.item = foundry.utils.duplicate(this.itemData);
    ItemUse.applyWeaponModeDamageMultiplier(rollData, attackType, this.item);
    this.itemUpdateData = {};
    this.itemUpdateData._id = this.item.id;
    game.D35E.logger.log("Attack item update", this.itemUpdateData);

    let rolled = false;

    const fastForwardRoll =
      skipDialog ||
      (ev instanceof MouseEvent && (ev.shiftKey || ev.button === 2)) ||
      foundry.utils.getProperty(this.item.system, "actionType") === "special";
    if (fastForwardRoll) {
      rollData.d35eWeaponDamageAttackTypePinned = attackType ?? "primary";
    }

    // Handle fast-forwarding
    if (fastForwardRoll)
      return {
        wasRolled: true,
        roll: this.rollAttack(true, null, temporaryItem, actor, rollData, skipChargeCheck),
      };

    // Render modal dialog
    let template = "systems/warcraftrpg2e/templates/apps/attack-roll-dialog.html";
    let weaponName = foundry.utils.getProperty(this.item.system, "baseWeaponType") || "";
    let featWeaponName = `(${weaponName})`;
    let bonusMaxPowerPoints = 0;
    if (this.item.type === "spell" && foundry.utils.getProperty(this.item.system, "isPower")) {
      let spellbookIndex = foundry.utils.getProperty(this.item.system, "spellbook");
      let spellbook = foundry.utils.getProperty(this.item.actor.system, `attributes.spells.spellbooks.${spellbookIndex}`) || {};
      let availablePowerPoints = (spellbook.powerPoints || 0) - (foundry.utils.getProperty(this.item.system, "powerPointsCost") || 0);
      bonusMaxPowerPoints = Math.max(
        spellbook.maximumPowerPointLimit
          ? Math.min(
            (spellbook?.cl?.total || 0) - (foundry.utils.getProperty(this.item.system, "powerPointsCost") || 0),
            availablePowerPoints
          )
          : availablePowerPoints,
        0
      );
    }
    let autoScaleAttacks =
      (game.settings.get("warcraftrpg2e", "autoScaleAttacksBab") &&
        actor.type !== "npc" &&
        foundry.utils.getProperty(this.item.system, "attackType") === "weapon" &&
        foundry.utils.getProperty(this.item.system, "autoScaleOption") !== "never") ||
      foundry.utils.getProperty(this.item.system, "autoScaleOption") === "always";
    let extraAttacksCount = autoScaleAttacks
      ? 1 +
        Math.max(
          0,
          Math.floor(
            (Math.max(0, foundry.utils.getProperty(actor.system, "attributes.bab.nonepic") || 0) - 1) / 5,
          ),
        )
      : (foundry.utils.getProperty(this.item.system, "attackParts") || []).length + 1;
    let rc = game.settings.get("warcraftrpg2e", `rollConfig`).rollConfig;
    let summonableMonsters = [];
    if (this.item.system.summon instanceof Array && this.item.system.summon) {
      for (let summon of this.item.system.summon) {
        const pack = game.packs.get(summon.pack || "warcraftrpg2e.summoning-roll-tables");
        const table = await pack.getDocument(summon.id);
        for (let result of table.results) {
          const entry = mapTableResultToSummonableEntry(result, summon.formula || "1");
          if (entry) summonableMonsters.push(entry);
        }
      }
    }
    var anyFlanking = false;
    var flankingName = "";
    var flankingImg = "";
    var isRanged = foundry.utils.getProperty(this.item.system, "attackType") === "weapon" &&
      foundry.utils.getProperty(this.item.system, "actionType") === "rwak";
    var isThreatening = isRanged;
    var autoFlank = game.settings.get("warcraftrpg2e", "automate-flanking-threat");
    if (game.user.targets && game.user.targets.size === 1) {
      var surroundingTokens = DistanceHelper.getSurroundingTokens(game.user.targets.first());

      let itemUserToken = null;
      if (actor.token) {
        itemUserToken = canvas.tokens.placeables.find((t) => t.document.id === actor.token.id);
      } else {
        itemUserToken = canvas.tokens.placeables.find((t) => t.actor.id === actor.id);
      }
      for (let token of surroundingTokens) {
        // Get the user's actor token
        // ignore the user's actor token
        if (token.id === itemUserToken.id) {
          continue;
        }
        // if token disposition is different than the user's actor token, then its not flanking
        var tokenDisposition = token.document ? token.document.disposition : token.disposition;
        var itemUserTokenDisposition = itemUserToken.document ? itemUserToken.document.disposition : itemUserToken.disposition;
        if (tokenDisposition !== itemUserTokenDisposition) {
          continue;
        }
        if (!autoFlank) {
          continue;
        }
        var isTokenFlanking = DistanceHelper.isFlanking(itemUserToken, game.user.targets.first(), token);
        if (isTokenFlanking) {
          flankingImg = token.document.texture.src;
          flankingName = token.document.name;
        }
        anyFlanking = anyFlanking || isTokenFlanking;
      }
      if (autoFlank) {
        isThreatening = isThreatening ||
          DistanceHelper.isAttackThreatening(itemUserToken, this.item,
            game.user.targets.first());
      } else {
        isThreatening = true;
      }
    } else {
      isThreatening = true;
    }
    let weaponFeatsOptional = actor.combatChangeItems.filter((o) =>
      ItemCombatChangesHelper.canHaveCombatChanges(o, rollData, `${this.item.type}Optional`)
    );
    let weaponFeats = actor.combatChangeItems.filter((o) =>
      ItemCombatChangesHelper.canHaveCombatChanges(o, rollData, `${this.item.type}`)
    );
    // for both weaponFeats and weaponFeatsOptional, we need to fill chatDescription field
    for (let feat of weaponFeats) {
      feat.chatDescription = await feat.getChatDescription(feat, rollData, `${this.item.type}`);
    }
    for (let feat of weaponFeatsOptional) {
      feat.chatDescription = await feat.getChatDescription(feat, rollData, `${this.item.type}Optional`);
    }
    let dialogData = {
      data: rollData,
      id: this.item.id,
      item: this.item,
      targets: Array.from(game.user.targets) || [],
      hasTargets: (game.user.targets || new Set()).size,
      rollMode: rollModeOverride
        ? rollModeOverride
        : game.settings.get("warcraftrpg2e", `rollConfig`).rollConfig[actor.type]?.attack ||
        game.settings.get("core", "rollMode"),
      rollModes: CONFIG.Dice.rollModes,
      rollModesForSelect: getRollModesForSelect(),
      twoWeaponAttackTypes: D35E.twoWeaponAttackType,
      attackType: attackType ? attackType : "primary",
      attackTypeSet: isFullAttack,
      hasAttack: this.item.hasAttack,
      hasDamage: this.item.hasDamage,
      allowNoAmmo: game.settings.get("warcraftrpg2e", "allowNoAmmo") || actor.type === "npc" || foundry.utils.getProperty(this.item.system, "noAmmoRequired") || false,
      noAmmoRequired: foundry.utils.getProperty(this.item.system, "noAmmoRequired") || false,
      nonLethal: foundry.utils.getProperty(this.item.system, "nonLethal") || false,
      allowMultipleUses: this.item.system?.uses?.allowMultipleUses,
      multipleUsesMax: this.item.system?.uses?.maxPerUse
        ? Math.min(
          Math.floor(this.item.charges / this.item.chargeCost),
          foundry.utils.getProperty(this.item.system, "uses.maxPerUse")
        )
        : Math.floor(this.item.charges / this.item.chargeCost),
      bonusPowerPointsMax: bonusMaxPowerPoints,
      isSpell: this.item.type === "spell" && !foundry.utils.getProperty(this.item.system, "isPower"),
      isPower: this.item.type === "spell" && foundry.utils.getProperty(this.item.system, "isPower"),
      hasDamageAbility: foundry.utils.getProperty(this.item.system, "ability.damage") !== "",
      isNaturalAttack: foundry.utils.getProperty(this.item.system, "attackType") === "natural",
      isPrimaryAttack: foundry.utils.getProperty(this.item.system, "primaryAttack") || false,
      isWeaponAttack: foundry.utils.getProperty(this.item.system, "attackType") === "weapon",
      isFlanking: anyFlanking,
      flankingName: flankingName,
      flankingImg: flankingImg,
      isThreatening: isThreatening,
      isRangedWeapon: isRanged,
      ammunition: foundry.utils.getProperty(this.item.system, "thrown")
        ? actor.items.filter((o) => o.id === foundry.utils.getProperty(this.item.system, "originalWeaponId"))
        : actor.items.filter((o) => o.type === "loot" && o.system.subType === "ammo" && o.system.quantity > 0),
      extraAttacksCount: extraAttacksCount,
      hasTemplate: this.item.hasTemplate,
      isAlreadyProne: this?.actor?.system?.attributes?.conditions?.prone || false,
      canPowerAttack: actor.items.filter((o) => o.type === "feat" && o.originalName === "Power Attack")?.length > 0,
      maxPowerAttackValue: foundry.utils.getProperty(actor.system, "attributes.bab.total"),
      canManyshot: actor.items.filter((o) => o.type === "feat" && o.originalName === "Manyshot")?.length > 0,
      maxManyshotValue: 2 + Math.floor((foundry.utils.getProperty(actor.system, "attributes.bab.total") - 6) / 5),
      canGreaterManyshot:
        actor.items.filter((o) => o.type === "feat" && o.originalName === "Greater Manyshot")?.length > 0,
      canRapidShot: actor.items.filter((o) => o.type === "feat" && o.originalName === "Rapid Shot")?.length > 0,
      canFlurryOfBlows:
        actor.items.filter(
          (o) => o.type === "feat" && (o.originalName === "Flurry of Blows" || o.system.customTag === "flurryOfBlows")
        ).length > 0,
      maxGreaterManyshotValue: foundry.utils.getProperty(actor.system, "abilities.wis.mod"),
      weaponFeats: weaponFeats,
      weaponFeatsOptional: weaponFeatsOptional,
      conditionals: foundry.utils.getProperty(this.item.system, "conditionals"),
      summonableMonsters: summonableMonsters,
    };

    dialogData.hasFeats = dialogData.weaponFeats.length || dialogData.weaponFeatsOptional.length;
    dialogData.hasFeatsOrSummons =
      dialogData.weaponFeats.length || dialogData.weaponFeatsOptional.length || dialogData.summonableMonsters.length;
    const html = await foundry.applications.handlebars.renderTemplate(template, dialogData);
    // //game.D35E.logger.log(dialogData)
    let roll;
    const buttons = {};
    let wasRolled = false;
    if (this.item.hasAttack) {
      if (this.item.type !== "spell") {
        buttons.normal = {
          label: game.i18n.localize("D35E.SingleAttack"),
          callback: (html) => {
            wasRolled = true;
            roll = this.rollAttack(false, html, temporaryItem, actor, rollData, skipChargeCheck);
            if (game.combats.active) {
              let combatActor = this.item.getCombatActor(actor);
              if (combatActor) {
                combatActor.useAction(this.item.system.activation);
              }
            }
          },
        };
      }
      if (extraAttacksCount > 1 || this.item.type === "spell") {
        buttons.multi = {
          label:
            this.item.type === "spell"
              ? game.i18n.localize("D35E.Cast")
              : game.i18n.localize("D35E.FullAttack") + " (" + extraAttacksCount + " attacks)",
          callback: (html) => {
            wasRolled = true;
            roll = this.rollAttack(true, html, temporaryItem, actor, rollData, skipChargeCheck);

            if (game.combats.active) {
              let combatActor = this.item.getCombatActor(actor);
              if (combatActor) {
                if (extraAttacksCount > 1) combatActor.useFullAttackAction();
                else combatActor.useAction(this.item.system.activation);
              }
            }
          },
        };
      }
    } else {
      buttons.normal = {
        label: this.item.type === "spell" ? game.i18n.localize("D35E.Cast") : game.i18n.localize("D35E.Use"),
        callback: (html) => {
          wasRolled = true;
          roll = this.rollAttack(false, html, temporaryItem, actor, rollData, skipChargeCheck);
          if (game.combats.active) {
            let combatActor = this.item.getCombatActor(actor);
            if (combatActor) {
              combatActor.useAction(this.item.system.activation);
            }
          }
        },
      };
    }
    await new Promise((resolve) => {
      new Dialog(
        {
          title: `${game.i18n.localize("D35E.Use")}: ${this.item.name} - ${actor.name}`,
          content: html,
          buttons: buttons,
          classes: ["custom-dialog"],
          default: buttons.multi != null ? "multi" : "normal",
          render: (htmlEl) => bindAttackRollDialogSummonSelect(htmlEl),
          close: () => {
            return resolve(wasRolled ? roll : false);
          },
        },
        {
          classes: ["roll-defense", "dialog", dialogData.hasFeatsOrSummons ? "twocolumn" : "single"],
          width: dialogData.hasFeatsOrSummons ? 800 : 400,
          jQuery: false,
        }
      ).render(true);
    });
    return { wasRolled: wasRolled, roll: roll };
  }

  extractFormData(
    rollData,
    form,
    attackExtraParts,
    rollModifiers,
    damageExtraParts,
    rollMode,
    useAmmoId,
    useAmmoDamage,
    useAmmoDamageType,
    useAmmoAttack,
    useAmmoEnhancement,
    useAmmoNote,
    useAmmoName,
    actor,
    ammoMaterial,
    ammoEnh,
    manyshot,
    manyshotCount,
    nonLethal,
    greaterManyshotCount,
    greaterManyshot,
    rapidShot,
    flurryOfBlows,
    primaryAttack,
    useMeasureTemplate,
    hasTwoWeaponFightingFeat,
    multiweaponFighting,
    twoWeaponFightingOffhand,
    selectedTargetIds,
    selectedTargets,
    optionalFeatIds,
    optionalFeatRanges,
    enabledConditionals,
    summonPack,
    summonId,
    summonName,
    summonImg,
    summonFormula
  ) {
    const formEl = form?.nodeType === 1 ? form : form?.[0] ?? form;
    let ammoDamageParts = [];
    rollData.attackBonus = formEl.querySelector('[name="attack-bonus"]')?.value;
    if (rollData.attackBonus) {
      attackExtraParts.push({
        part: "@attackBonus",
        value: rollData.attackBonus,
        source: game.i18n.localize("D35E.AttackRollBonus"),
      });
      rollModifiers.push(`${game.i18n.localize("D35E.AttackRollBonus")} ${rollData.attackBonus}`);
    }
    rollData.damageBonus = formEl.querySelector('[name="damage-bonus"]')?.value;
    if (rollData.damageBonus) {
      damageExtraParts.push(["@damageBonus", game.i18n.localize("D35E.DamageBonus"), "base"]);
      rollModifiers.push(`${game.i18n.localize("D35E.DamageBonus")} ${rollData.damageBonus}`);
    }
    rollMode = formEl.querySelector('[name="rollMode"]')?.value;

    rollData.useAmount = formEl.querySelector('[name="use"]')?.value;
    if (rollData.useAmount === undefined) {
      if (this.item.type !== "spell") rollData.useAmount = 1;
      else rollData.useAmount = 0;
    } else {
      rollData.useAmount = parseFloat(formEl.querySelector('[name="use"]').value);
    }

    if (formEl.querySelector('[name="ammunition-id"]')) {
      useAmmoId = formEl.querySelector('[name="ammunition-id"]').value;
      useAmmoDamage = formEl.querySelector('[name="ammo-dmg-formula"]').value;
      useAmmoDamageType = formEl.querySelector('[name="ammo-dmg-type"]').value;
      let useAmmoDamageUid = formEl.querySelector('[name="ammo-dmg-uid"]').value;
      useAmmoAttack = formEl.querySelector('[name="ammo-attack"]').value;
      useAmmoEnhancement = formEl.querySelector('[name="ammo-enh"]').value;
      useAmmoNote = formEl.querySelector('[name="ammo-note"]').value;
      useAmmoName = formEl.querySelector('[name="ammo-name"]').value;
      var ammo = actor.items.get(useAmmoId);
      if (ammo) {
        useAmmoDamageType = ammo.system.bonusAmmoDamageType || "";
        useAmmoDamageUid = ammo.system.bonusAmmoDamageUid || "";
        useAmmoAttack = ammo.system.bonusAmmoAttack || 0;
        useAmmoNote = ammo.system.bonusAmmoAttackNote || "";
        useAmmoName = ammo.name;
        useAmmoDamage = ammo.system.bonusAmmoDamage || 0;
        ammoMaterial = JSON.stringify(ammo.system.material);
        ammoDamageParts = ammo.system.ammoDamageParts || [];
      }
      if (useAmmoDamage !== "") {
        damageExtraParts.push([useAmmoDamage, useAmmoDamageType, useAmmoDamageUid]);
      }
      if (useAmmoAttack !== "") {
        rollData.useAmmoAttack = parseInt(useAmmoAttack);
        attackExtraParts.push({
          part: "@useAmmoAttack",
          value: rollData.useAmmoAttack,
          source: `${useAmmoName} ${game.i18n.localize("D35E.Bonus")}`,
        });
      }
      if (useAmmoEnhancement !== undefined && useAmmoEnhancement !== "") {
        ammoEnh = new Roll35e(useAmmoEnhancement, {}).evaluateSync().total;
      }
      rollModifiers.push(`${useAmmoName}`);
      // //game.D35E.logger.log('Selected ammo', useAmmoDamage, useAmmoAttack)
    }

    rollData.powerAttackBonus = formEl.querySelector('[name="power-attack"]')?.value;
    if (rollData.powerAttackBonus !== undefined) {
      rollData.powerAttackBonus = parseInt(formEl.querySelector('[name="power-attack"]').value);
      rollData.weaponHands = 1;
      damageExtraParts.push([
        "floor(@powerAttackBonus * @weaponHands) * @critMult",
        game.i18n.localize("D35E.PowerAttack"),
        "base",
      ]);
      rollData.powerAttackPenalty = -rollData.powerAttackBonus;
      attackExtraParts.push({
        part: "@powerAttackPenalty",
        value: rollData.powerAttackPenalty,
        source: game.i18n.localize("D35E.PowerAttack"),
      });
      if (rollData.powerAttackBonus > 0)
        rollModifiers.push(`${game.i18n.localize("D35E.PowerAttack")} ${rollData.powerAttackBonus}`);
    }
    if (formEl.querySelector('[name="manyshot"]')?.checked) {
      manyshot = true;
      manyshotCount = parseInt(formEl.querySelector('[name="manyshot-count"]').value);
      rollData.manyshotPenalty = -manyshotCount * 2;
      attackExtraParts.push({
        part: "@manyshotPenalty",
        value: rollData.manyshotPenalty,
        source: game.i18n.localize("D35E.FeatManyshot"),
      });
      rollModifiers.push(`${game.i18n.localize("D35E.FeatManyshot")}`);
    }

    if (formEl.querySelector('[name="nonLethal"]')?.checked) {
      nonLethal = true;
    }
    const itemNonLethal = foundry.utils.getProperty(this.item.system, "nonLethal") || foundry.utils.getProperty(this.item.system, "nonLethalNoPenalty") || false;
    if (nonLethal && nonLethal !== itemNonLethal) {
      rollData.nonLethalPenalty = -4;
      attackExtraParts.push({
        part: "@nonLethalPenalty",
        value: rollData.nonLethalPenalty,
        source: game.i18n.localize("D35E.WeaponPropNonLethal"),
      });
      rollModifiers.push(`${game.i18n.localize("D35E.WeaponPropNonLethal")}`);
    }

    if (formEl.querySelector('[name="prone"]')?.checked) {
      rollData.pronePenalty = -4;
      if (!rollData.attackToggles) rollData.attackToggles = {};
      rollData.attackToggles.prone = true;
      attackExtraParts.push({
        part: "@pronePenalty",
        value: rollData.pronePenalty,
        source: game.i18n.localize("D35E.Prone"),
      });
      rollModifiers.push(`${game.i18n.localize("D35E.Prone")}`);
    }
    if (formEl.querySelector('[name="squeezing"]')?.checked) {
      rollData.squeezingPenalty = -4;
      if (!rollData.attackToggles) rollData.attackToggles = {};
      rollData.attackToggles.squeezing = true;
      attackExtraParts.push({
        part: "@squeezingPenalty",
        value: rollData.squeezingPenalty,
        source: game.i18n.localize("D35E.Squeezing"),
      });
      rollModifiers.push(`${game.i18n.localize("D35E.Squeezing")}`);
    }
    if (formEl.querySelector('[name="highground"]')?.checked) {
      rollData.highground = 1;
      if (!rollData.attackToggles) rollData.attackToggles = {};
      rollData.attackToggles.highGround = true;
      attackExtraParts.push({
        part: "@highground",
        value: rollData.highground,
        source: game.i18n.localize("D35E.HighGround"),
      });
      rollModifiers.push(`${game.i18n.localize("D35E.HighGround")}`);
    }
    if (formEl.querySelector('[name="defensive"]')?.checked) {
      rollData.defensive = -4;
      if (!rollData.attackToggles) rollData.attackToggles = {};
      rollData.attackToggles.defensive = true;
      attackExtraParts.push({
        part: "@defensive",
        value: rollData.attackToggles.defensive,
        source: game.i18n.localize("D35E.DefensiveFighting"),
      });
      rollModifiers.push(`${game.i18n.localize("D35E.DefensiveFighting")}`);
    }
    if (formEl.querySelector('[name="charge"]')?.checked) {
      rollData.charge = 2;
      if (!rollData.attackToggles) rollData.attackToggles = {};
      rollData.attackToggles.charge = true;
      attackExtraParts.push({
        part: "@charge",
        value: rollData.charge,
        source: game.i18n.localize("D35E.Charge"),
      });
      rollModifiers.push(`${game.i18n.localize("D35E.Charge")}`);
    }
    if (formEl.querySelector('[name="ccshot"]')?.checked) {
      rollData.closeQuartersShot = -4;
      if (!rollData.attackToggles) rollData.attackToggles = {};
      rollData.attackToggles.closeQuartersShot = true;
      attackExtraParts.push({
        part: "@closeQuartersShot",
        value: rollData.closeQuartersShot,
        source: game.i18n.localize("D35E.CloseQuartersShot"),
      });
      rollModifiers.push(`${game.i18n.localize("D35E.CloseQuartersShot")}`);
    }
    if (formEl.querySelector('[name="flanking"]')?.checked) {
      rollData.flanking = 2;
      if (!rollData.attackToggles) rollData.attackToggles = {};
      rollData.attackToggles.flanking = true;
      attackExtraParts.push({
        part: "@flanking",
        value: rollData.flanking,
        source: game.i18n.localize("D35E.Flanking"),
      });
      rollModifiers.push(`${game.i18n.localize("D35E.Flanking")}`);
    }

    if (formEl.querySelector('[name="greater-manyshot"]')?.checked) {
      greaterManyshotCount = parseInt(formEl.querySelector('[name="greater-manyshot-count"]').value);
      greaterManyshot = true;
      rollData.greaterManyshotPenalty = -greaterManyshotCount * 2;
      attackExtraParts.push({
        part: "@greaterManyshotPenalty",
        value: rollData.greaterManyshotPenalty,
        source: game.i18n.localize("D35E.FeatGreaterManyshot"),
      });
      rollModifiers.push(`${game.i18n.localize("D35E.FeatGreaterManyshot")}`);
    }
    if (formEl.querySelector('[name="rapid-shot"]')?.checked) {
      rapidShot = true;
    }
    if (formEl.querySelector('[name="flurry-of-blows"]')?.checked) {
      flurryOfBlows = true;
    }
    let primaryAttackEl = formEl.querySelector('[name="primary-attack"]');
    if (typeof primaryAttackEl?.checked === "boolean") {
      primaryAttack = primaryAttackEl.checked;
      rollData.primaryAttack = true;
    }
    let measureTemplateEl = formEl.querySelector('[name="measure-template"]');
    if (typeof measureTemplateEl?.checked === "boolean") {
      useMeasureTemplate = measureTemplateEl.checked;
    }
    let damageAbilityEl = formEl.querySelector('[name="damage-ability-multiplier"]');
    if (damageAbilityEl) {
      rollData.damageAbilityMultiplier = parseFloat(damageAbilityEl.value);
    }

    let twoWeaponMode = "";
    let twfEl = formEl.querySelector('[name="twf-attack-mode"]');
    if (twfEl) {
      twoWeaponMode = twfEl.value;
      if (twoWeaponMode === "main-offhand-light") {
        rollData.twoWeaponPenalty = -4;
        if (hasTwoWeaponFightingFeat) rollData.twoWeaponPenalty = -2;
        if (multiweaponFighting) rollData.twoWeaponPenalty = -2;
        attackExtraParts.push({
          part: "@twoWeaponPenalty",
          value: rollData.twoWeaponPenalty,
          source: game.i18n.localize("D35E.TwoWeaponPenalty"),
        });
      } else if (twoWeaponMode === "main-offhand-normal") {
        rollData.twoWeaponPenalty = -6;
        if (hasTwoWeaponFightingFeat) rollData.twoWeaponPenalty = -4;
        if (multiweaponFighting) rollData.twoWeaponPenalty = -4;
        attackExtraParts.push({
          part: "@twoWeaponPenalty",
          value: rollData.twoWeaponPenalty,
          source: game.i18n.localize("D35E.TwoWeaponPenalty"),
        });
      } else if (twoWeaponMode === "offhand-light") {
        rollData.twoWeaponPenalty = -8;
        if (hasTwoWeaponFightingFeat) rollData.twoWeaponPenalty = -2;
        if (multiweaponFighting) rollData.twoWeaponPenalty = -2;
        attackExtraParts.push({
          part: "@twoWeaponPenalty",
          value: rollData.twoWeaponPenalty,
          source: game.i18n.localize("D35E.TwoWeaponPenalty"),
        });
        twoWeaponFightingOffhand = true;
      } else if (twoWeaponMode === "offhand-normal") {
        rollData.twoWeaponPenalty = -10;
        if (hasTwoWeaponFightingFeat) rollData.twoWeaponPenalty = -4;
        if (multiweaponFighting) rollData.twoWeaponPenalty = -4;
        attackExtraParts.push({
          part: "@twoWeaponPenalty",
          value: rollData.twoWeaponPenalty,
          source: game.i18n.localize("D35E.TwoWeaponPenalty"),
        });
        twoWeaponFightingOffhand = true;
      } else if (twoWeaponMode === "two-handed") {
        rollData.weaponHands = 2;
      }
    }

    let targetIdsEl = formEl.querySelector('[name="target-ids"]');
    if (targetIdsEl) {
      selectedTargetIds = targetIdsEl.value;
      let targetIdSet = new Set(selectedTargetIds.split(";"));
      selectedTargets = canvas.tokens.placeables.filter((t) => targetIdSet.has(t.id));

    }
    formEl.querySelectorAll('[data-type="optional"]').forEach((el) => {
      if (el.checked) {
        let featId = el.getAttribute("data-feat-optional");
        optionalFeatIds.push(featId);
        if (formEl.querySelector(`[name="optional-range-${featId}"]`))
          optionalFeatRanges.set(featId, {
            base: formEl.querySelector(`[name="optional-range-${featId}"]`)?.value || 0,
            slider1: formEl.querySelector(`[name="optional-range-1-${featId}"]`)?.value || 0,
            slider2: formEl.querySelector(`[name="optional-range-2-${featId}"]`)?.value || 0,
            slider3: formEl.querySelector(`[name="optional-range-3-${featId}"]`)?.value || 0,
          });
      }
    });
    formEl.querySelectorAll('[data-type="conditional"]').forEach((el) => {
      if (el.checked) enabledConditionals.push(el.getAttribute("data-conditional-optional"));
    });
    summonPack = formEl.querySelector('[name="monster-collection"]')?.value;
    summonId = formEl.querySelector('[name="monster-resultId"]')?.value;
    summonName = formEl.querySelector('[name="monster-text"]')?.value;
    summonImg = formEl.querySelector('[name="monster-img"]')?.value;
    summonFormula = formEl.querySelector('[name="monster-formula"]')?.value;
    return {
      rollMode,
      useAmmoId,
      useAmmoNote,
      useAmmoName,
      ammoMaterial,
      ammoEnh,
      ammoDamageParts,
      manyshot,
      manyshotCount,
      nonLethal,
      greaterManyshotCount,
      greaterManyshot,
      rapidShot,
      flurryOfBlows,
      primaryAttack,
      useMeasureTemplate,
      twoWeaponFightingOffhand,
      selectedTargetIds,
      selectedTargets,
      summonPack,
      summonId,
      summonName,
      summonImg,
      summonFormula,
    };
  }

  /**
   * Cast a Spell, consuming a spell slot of a certain level
   * @param {Item35E} item   The spell being cast by the actor
   * @param {MouseEvent} ev The click event
   */
  async useSpell(
    ev,
    { skipDialog = false, replacement = false, replacementItem = null, rollModeOverride = null } = {},
    actor = null
  ) {
    let usedItem = replacementItem ? replacementItem : this.item;
    if (!actor.testUserPermission(game.user, "OWNER"))
      return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoActorPermission"));
    if (this.item.type !== "spell") throw new Error("Wrong Item type");
    if (foundry.utils.getProperty(this.item.system, "requiresPsionicFocus") && !this.item.actor?.system?.attributes?.psionicFocus)
      return ui.notifications.warn(game.i18n.localize("D35E.RequiresPsionicFocus"));
    const spellbook = foundry.utils.getProperty(
      actor.system,
      `attributes.spells.spellbooks.${this.item.system.spellbook}`
    );
    if (!isSpellPreparedForSpellbook(this.item.system, spellbook)) {
      return ui.notifications.warn(game.i18n.localize("D35E.ErrorSpellNotPreparedInRepertoire"));
    }
    if (foundry.utils.getProperty(this.item.system, "preparation.mode") !== "atwill" && new ItemCharges(this.item).getCharges() <= 0)
      return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoSpellsLeft"));

    // Invoke the Item roll
    if (usedItem.hasAction) {
      let attackResult = await new ItemUse(usedItem).useAttack(
        { ev: ev, skipDialog: skipDialog, rollModeOverride: rollModeOverride },
        actor,
        true
      );
      if (!attackResult.wasRolled) return;
      let roll = await attackResult.roll;
      await new ItemCharges(this.item).addCharges(-1 + (-1 * roll?.rollData?.useAmount || 0));
      return;
    }

    const spellFailureData = await getSpellFailureData(usedItem, actor);
    const rollMode = rollModeOverride || game.settings.get("core", "rollMode");
    const shouldFizzleOnArcaneFailure = game.settings.get("warcraftrpg2e", "fizzleSpellOnArcaneFailure");

    await new ItemCharges(this.item).addCharges(-1);

    if (spellFailureData && shouldFizzleOnArcaneFailure && !spellFailureData.spellFailureSuccess) {
      await postSpellFailureCard(usedItem, actor, spellFailureData, { rollMode });
      return;
    }

    const message = await usedItem.roll({ rollMode: rollModeOverride });
    if (spellFailureData) await postSpellFailureCard(usedItem, actor, spellFailureData, { rollMode });
    return message;
  }

  #_determineSpellInfo(_rollData) {
    const data = foundry.utils.duplicate(this.item.system);
    const rollData = _rollData ? _rollData : this.item.actor ? this.item.actor.getRollData() : {};
    if (!_rollData) {
      rollData.item = data;
      if (this.item.actor) {
        let allCombatChanges = [];
        let attackType = this.item.type;
        this.item.actor.combatChangeItems
          .filter((o) => ItemCombatChangesHelper.canHaveCombatChanges(o, rollData, attackType))
          .forEach((i) => {
            allCombatChanges = allCombatChanges.concat(i.combatChanges.getPossibleCombatChanges(attackType, rollData));
          });

        this.item._addCombatChangesToRollData(allCombatChanges, rollData);
      }
    }

    // Determines CL, SL and ability modifier
    let spellSource;
    let cl = 0;
    let sl = 0;
    let ablMod = 0;
    if (this.item.type === "spell") {
      const spellbookIndex = data.spellbook;
      spellSource = foundry.utils.getProperty(this.item.actor?.system, `attributes.spells.spellbooks.${spellbookIndex}`) || {};
    } else if (this.item.type === "card") {
      const deckIndex = data.deck;
      spellSource = foundry.utils.getProperty(this.item.actor?.system, `attributes.cards.decks.${deckIndex}`) || {};
    } else {
      return; // The values are left undefined for other kinds of items.
    }

    const spellAbility = spellSource.ability;
    if (spellAbility !== "") ablMod = foundry.utils.getProperty(this.item.actor?.system, `abilities.${spellAbility}.mod`) ?? 0;

    cl += foundry.utils.getProperty(spellSource, "cl.total") || 0;
    cl += data.clOffset || 0;
    cl += rollData.featClBonus || 0;
    cl -= this.item.actor?.system?.attributes?.energyDrain || 0;

    sl += data.level;
    sl += data.slOffset || 0;

    rollData.cl = cl;
    rollData.sl = sl;
    rollData.ablMod = ablMod;
  }

  #_getSpellDC(_rollData) {
    const data = foundry.utils.duplicate(this.item.system);
    let spellDC = { dc: null, type: null, description: null };

    const rollData = _rollData ? _rollData : this.item.actor ? this.item.actor.getRollData() : {};
    if (!_rollData) {
      rollData.item = data;
      if (this.item.actor) {
        let allCombatChanges = [];
        let attackType = this.item.type;
        this.item.actor.combatChangeItems
          .filter((o) => ItemCombatChangesHelper.canHaveCombatChanges(o, rollData, attackType))
          .forEach((i) => {
            allCombatChanges = allCombatChanges.concat(i.combatChanges.getPossibleCombatChanges(attackType, rollData));
          });

        this.item._addCombatChangesToRollData(allCombatChanges, rollData);
      }
    }

    spellDC.cl = rollData.cl;

    if (
      data.hasOwnProperty("actionType") &&
      (foundry.utils.getProperty(data, "save.type") ||
        (foundry.utils.getProperty(data, "save.description") &&
          foundry.utils.getProperty(data, "save.description") !== "None"))
    ) {
      let saveDC = new Roll35e(data.save.dc.length > 0 ? data.save.dc : "0", rollData).evaluateSync().total;
      let saveDesc = data.save.description;
      if (this.item.type === "spell") {
        const spellbook = foundry.utils.getProperty(this.item.actor.system, `attributes.spells.spellbooks.${data.spellbook}`) || {};
        saveDC += new Roll35e(spellbook.baseDCFormula || "", rollData).evaluateSync().total;
      }

      if (saveDC > 0 && data?.save?.type) {
        spellDC.dc = saveDC + (new Roll35e(rollData.featSpellDCBonus ? rollData.featSpellDCBonus.toString() : "0", rollData).evaluateSync().total || 0);
        spellDC.type = data.save.type;
        spellDC.ability = data.save.ability;
        spellDC.isHalf = data.save.type.indexOf("half") !== -1;
        spellDC.isPartial = data.save.type.indexOf("partial") !== -1;
        spellDC.description = `${CONFIG.D35E.savingThrowTypes[data.save.type]}`;
        if (data.save.ability) spellDC.description += ` (${CONFIG.D35E.abilitiesShort[data.save.ability]})`;
      } else if (saveDC > 0 && saveDesc) {
        spellDC.dc = saveDC + (new Roll35e(rollData.featSpellDCBonus ? rollData.featSpellDCBonus.toString() : "0", rollData).evaluateSync().total || 0);
        if (saveDesc.toLowerCase().indexOf("will") !== -1) {
          spellDC.type = "will";
        } else if (saveDesc.toLowerCase().indexOf("reflex") !== -1) {
          spellDC.type = "reflex";
        } else if (saveDesc.toLowerCase().indexOf("fortitude") !== -1) {
          spellDC.type = "fortitude";
        } else if (saveDesc.toLowerCase().indexOf("will") !== -1) {
          spellDC.type = "will";
        } else if (saveDesc.toLowerCase().indexOf("ref") !== -1) {
          spellDC.type = "reflex";
        } else if (saveDesc.toLowerCase().indexOf("fort") !== -1) {
          spellDC.type = "fortitude";
        }
        if (saveDesc.toLowerCase().indexOf("negates") !== -1) {
          spellDC.type += "negates";
        }
        if (saveDesc.toLowerCase().indexOf("partial") !== -1) {
          spellDC.type += "partial";
          spellDC.isPartial = true;
        } else if (saveDesc.toLowerCase().indexOf("half") !== -1) {
          spellDC.type += "half";
          spellDC.isHalf = true;
        }

        if (saveDesc.toLowerCase().indexOf("cha") !== -1) {
          spellDC.ability += "cha";
        } else if (saveDesc.toLowerCase().indexOf("con") !== -1) {
          spellDC.ability += "con";
        } else if (saveDesc.toLowerCase().indexOf("dex") !== -1) {
          spellDC.ability += "dex";
        } else if (saveDesc.toLowerCase().indexOf("str") !== -1) {
          spellDC.ability += "str";
        } else if (saveDesc.toLowerCase().indexOf("int") !== -1) {
          spellDC.ability += "int";
        } else if (saveDesc.toLowerCase().indexOf("wis") !== -1) {
          spellDC.ability += "wis";
        }
        spellDC.description = saveDesc;
      }
    }
    // //game.D35E.logger.log('Calculated spell DC', spellDC)
    return spellDC;
  }
}
