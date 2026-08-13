import { createTag, linkData } from "../../lib.js";
import { Item35E } from "../../item/entity.js";
import { Roll35e } from "../../roll.js";
import { CACHE } from "../../cache.js";
import { ActorPrepareSourceHelper } from "../helpers/actorPrepareSourceHelper.js";
import { ActorChangesHelper } from "../helpers/actorChangesHelper.js";
import { ActorWealthHelper } from "../helpers/actorWealthHelper.js";
import { LogHelper } from "../../helpers/LogHelper.js";
import { ItemEnhancementHelper } from "../../item/helpers/itemEnhancementHelper.js";
import { ActorPF } from "../entity.js";
import {
  classifyWarcraftHealth,
  DEATH_RULE_D35E,
  DEATH_RULE_WARCRAFT,
  resolveDeathRule,
} from "../helpers/warcraftDeathRules.js";
import { deriveShoutUses } from "../helpers/warcraftResources.js";
import { constructSizeHitPoints, resolveWarcraftCreatureProfile } from "../helpers/warcraftCreatureRules.js";
import { deriveDirectClassPathState } from "../helpers/classPathProgressionHelper.js";
import {
  allocateWarcraftPrestigeCasterLevels,
  calculateWarcraftSlotPools,
  getWarcraftFeatureProgression,
} from "../helpers/warcraftSpellcastingHelper.js";

export class ActorUpdater {
  /**
   *
   * @param actor
   */
  constructor(actor) {
    this.actor = actor;
  }

  async update(updated, options = {}, _super) {
    updated = await this.#prepareUpdateData(updated);

    // Update changes
    let diff = updated;
    if (options.updateChanges !== false) {
      const updateObj = await this.updateChanges({ updated: updated }, options);

      if (updateObj?.diff?.items) delete updateObj.diff.items;
      diff = foundry.utils.mergeObject(diff, updateObj?.diff || {});
    }

    delete diff.effects;
    return diff;
  }

  async #prepareUpdateData(updated) {
    let img = updated.img;
    let expandedData = foundry.utils.expandObject(updated);
    if (expandedData.system != null && expandedData.system.skills != null) {
      for (let [s, skl] of Object.entries(expandedData.system.skills)) {
        let curSkl = this.actor.system.skills[s];
        if (skl == null) continue;
        if (skl.points) if (typeof skl.points !== "number") skl.points = 0;
        if (skl.subSkills != null) {
          for (let skl2 of Object.values(skl.subSkills)) {
            if (skl2 == null) continue;
            if (skl2.points) if (typeof skl2.points !== "number") skl2.points = 0;
          }
        }

        // Rename custom skills
        if (curSkl != null && curSkl.custom && skl.name != null) {
          let tag = createTag(skl.name || "skill");
          let count = 1;
          const skillData = foundry.utils.getProperty(this.actor.system, `skills.${tag}`) || {};
          while (this.actor.system.skills[tag] != null && this.actor.system.skills[tag] != curSkl) {
            count++;
            tag = createTag(skillData.name || "skill") + count.toString();
          }

          if (s !== tag) {
            expandedData.system.skills[tag] = foundry.utils.mergeObject(curSkl, skl);
            expandedData.system.skills[s] = null;
          }
        }
      }
      updated = foundry.utils.flattenObject(expandedData);
    } else if (expandedData.system !== null) updated = foundry.utils.flattenObject(expandedData);
    if (img !== undefined) updated.img = img;
    for (let abl of Object.keys(foundry.utils.getProperty(this.actor.system, "abilities"))) {
      if (
        updated[`system.abilities.${abl}.tempvalue`] === undefined ||
        updated[`system.abilities.${abl}.tempvalue`] === null
      )
        continue;
      if (Array.isArray(updated[`system.abilities.${abl}.tempvalue`])) {
        for (let val of updated[`system.abilities.${abl}.tempvalue`]) {
          if (
            updated[`system.abilities.${abl}.value`] !== undefined &&
            parseInt(val) !== updated[`system.abilities.${abl}.value`]
          ) {
            updated[`system.abilities.${abl}.value`] = parseInt(val);
            break;
          } else if (parseInt(val) !== this.actor.system.abilities[`${abl}`].value) {
            updated[`system.abilities.${abl}.value`] = parseInt(val);
            break;
          }
        }
      } else {
        updated[`system.abilities.${abl}.value`] = parseInt(updated[`system.abilities.${abl}.tempvalue`]);
      }
    }

    // Make certain variables absolute
    const _absoluteKeys = Object.keys(foundry.utils.getProperty(this.actor.system, "abilities"))
      .reduce((arr, abl) => {
        arr.push(
          `system.abilities.${abl}.userPenalty`,
          `system.abilities.${abl}.damage`,
          `system.abilities.${abl}.drain`
        );
        return arr;
      }, [])
      .concat("system.attributes.energyDrain")
      .filter((k) => {
        return updated[k] != null;
      });
    for (const k of _absoluteKeys) {
      updated[k] = Math.abs(updated[k]);
    }
    if (updated[`data.attributes.hp.value`] && !updated[`system.attributes.hp.value`]) {
      updated[`system.attributes.hp.value`] = updated[`data.attributes.hp.value`];
    }
    if (updated[`system.attributes.hp.value`] !== undefined && updated[`system.attributes.hp.value`] !== null) {
      if (parseInt(updated[`system.attributes.hp.value`]) == 0) updated[`system.attributes.hp.value`] = 0;
      else {
        if (typeof updated[`system.attributes.hp.value`] === "string") {
          if (updated[`system.attributes.hp.value`].startsWith("+")) {
            updated[`system.attributes.hp.value`] =
              foundry.utils.getProperty(this.actor.system, "attributes.hp.value") + parseInt(updated[`system.attributes.hp.value`]);
          } else if (updated[`system.attributes.hp.value`].startsWith("-")) {
            if (foundry.utils.getProperty(this.actor.system, "attributes.hp.value") > 0)
              // When we are below 0, we cannot do that
              updated[`system.attributes.hp.value`] =
                foundry.utils.getProperty(this.actor.system, "attributes.hp.value") + parseInt(updated[`system.attributes.hp.value`]);
            else updated[`system.attributes.hp.value`] = parseInt(updated[`system.attributes.hp.value`]);
          } else {
            updated[`system.attributes.hp.value`] =
              parseInt(updated[`system.attributes.hp.value`]) || this.actor.system.attributes.hp.value;
          }
        } else {
          updated[`system.attributes.hp.value`] =
            parseInt(updated[`system.attributes.hp.value`]) || this.actor.system.attributes.hp.value;
        }
      }
    }
    const updatedHpValue = updated[`system.attributes.hp.value`];
    const hpWasUpdated = updatedHpValue !== undefined && updatedHpValue !== null;
    const deathRuleWasUpdated = Object.prototype.hasOwnProperty.call(updated, `system.attributes.deathRule`);
    const creatureTypeWasUpdated = Object.prototype.hasOwnProperty.call(updated, `system.attributes.creatureType`);
    const staminaWasUpdated = Object.prototype.hasOwnProperty.call(updated, `system.abilities.con.value`);
    const stableWasUpdated = Object.prototype.hasOwnProperty.call(updated, `system.attributes.conditions.stable`);
    const hpValue = hpWasUpdated ? updatedHpValue : this.actor.system.attributes.hp.value;
    const deathRule = resolveDeathRule(
      deathRuleWasUpdated ? updated[`system.attributes.deathRule`] : this.actor.system.attributes.deathRule,
      this.actor.race?.system?.deathRule,
      creatureTypeWasUpdated ? updated[`system.attributes.creatureType`] : this.actor.system.attributes.creatureType,
    );
    if ((hpWasUpdated || deathRuleWasUpdated || creatureTypeWasUpdated || staminaWasUpdated) && deathRule !== DEATH_RULE_D35E) {
      const stamina = this.actor.system.abilities?.con ?? {};
      const incomingStamina = updated[`system.abilities.con.value`];
      const hasNumericIncomingStamina = incomingStamina !== null && incomingStamina !== "" && Number.isFinite(Number(incomingStamina));
      const staminaScore = hasNumericIncomingStamina
        ? Number(stamina.total ?? stamina.value ?? 0) + Number(incomingStamina) - Number(stamina.value ?? 0)
        : Number(stamina.total ?? stamina.value ?? 0);
      const oldHpValue = Number(this.actor.system.attributes.hp.value ?? hpValue);
      let stable = stableWasUpdated
        ? Boolean(updated[`system.attributes.conditions.stable`])
        : Boolean(this.actor.system.attributes.conditions?.stable);
      if (deathRule === DEATH_RULE_WARCRAFT && hpWasUpdated) {
        if (Number(hpValue) > oldHpValue && Number(hpValue) < 0) stable = true;
        if (Number(hpValue) < oldHpValue) stable = false;
      }
      let healthState = classifyWarcraftHealth({ hitPoints: hpValue, staminaScore, deathRule, stable });
      if (healthState.disabled || healthState.dead || deathRule !== DEATH_RULE_WARCRAFT) stable = false;
      if (!stable && healthState.dying === false && deathRule === DEATH_RULE_WARCRAFT) {
        healthState = classifyWarcraftHealth({ hitPoints: hpValue, staminaScore, deathRule, stable: false });
      }
      updated[`system.attributes.conditions.disabled`] = healthState.disabled;
      updated[`system.attributes.conditions.dying`] = healthState.dying;
      updated[`system.attributes.conditions.down`] = healthState.down;
      updated[`system.attributes.conditions.dead`] = healthState.dead;
      updated[`system.attributes.conditions.stable`] = stable;
      updated[`system.attributes.conditions.unconscious`] = healthState.unconscious;
      updated[`system.attributes.conditions.helpless`] = healthState.unconscious;
      if (deathRule === DEATH_RULE_WARCRAFT && healthState.disabled && hpWasUpdated && Number(hpValue) < oldHpValue) {
        ui.notifications.warn(game.i18n.localize("D35E.WarcraftDisabledStrenuousReminder"));
      }
    } else if (hpWasUpdated && hpValue <= -10) {
      updated[`system.attributes.conditions.dying`] = false;
      updated[`system.attributes.conditions.dead`] = true;
    } else if (hpWasUpdated && hpValue < 0) {
      updated[`system.attributes.conditions.dead`] = false;
      updated[`system.attributes.conditions.dying`] = true;
    } else if (hpWasUpdated && hpValue > 0 && updated[`system.attributes.conditions.dying`]) {
      updated[`system.attributes.conditions.dying`] = false;
    } else if (
      (updated[`system.attributes.hp.max`] || this.actor.system.attributes.hp.max) ===
      updated[`system.attributes.hp.nonlethal`]
    ) {
      updated[`system.attributes.conditions.staggered`] = true;
    } else if (
      (updated[`system.attributes.hp.max`] || this.actor.system.attributes.hp.max) <
      updated[`system.attributes.hp.nonlethal`]
    ) {
      updated[`system.attributes.conditions.staggered`] = false;
      updated[`system.attributes.conditions.unconscious`] = true;
    }

    if (updated[`system.attributes.conditions.dead`] && !this.actor.system.attributes.conditions.dead) {
      const tokens = this.actor.getActiveTokens();
      for (const token of tokens) {
        await token.actor?.toggleStatusEffect("dead", { active: true, overlay: true });
      }
    } else if (!updated[`system.attributes.conditions.dead`] && this.actor.system.attributes.conditions.dead) {
      const tokens = this.actor.getActiveTokens();
      for (const token of tokens) {
        await token.actor?.toggleStatusEffect("dead", { active: false, overlay: true });
      }
    }

    if (updated[`system.attributes.conditions.stable`] && !this.actor.system.attributes.conditions?.stable) {
      updated[`system.attributes.conditions.dying`] = false;
    }

    if (updated[`system.attributes.conditions.dying`] && !this.actor.system.attributes.conditions?.dying) {
      updated[`system.attributes.conditions.unconscious`] = true;
    }
    if (updated[`system.attributes.conditions.unconscious`] && !this.actor.system.attributes.conditions?.unconscious) {
      updated[`system.attributes.conditions.helpless`] = true;
    }

    if (updated[`system.attributes.conditions.banished`] && !this.actor.system.attributes.conditions.banished) {
      const tokens = this.actor.getActiveTokens();
      for (const token of tokens) {
        await token.actor?.toggleStatusEffect("banished", { active: true, overlay: true });
      }
    } else if (!updated[`system.attributes.conditions.banished`] && this.actor.system.attributes.conditions.banished) {
      const tokens = this.actor.getActiveTokens();
      for (const token of tokens) {
        await token.actor?.toggleStatusEffect("banished", { active: false, overlay: true });
      }
    }

    // Update item containers data
    let itemUpdates = [];
    for (let i of this.actor.items.values()) {
      if (!i.system.hasOwnProperty("quantity")) continue;
      let itemUpdateData = {};

      itemUpdateData["id"] = i.id;
      let hasContainerChanged = false;
      if (i.system.containerId !== undefined && i.system.containerId !== "none") {
        const container = this.actor.items.get(i.system.containerId);
        if (container === undefined || container === null) {
          itemUpdateData["system.containerId"] = "none";
          itemUpdateData["system.container"] = "None";
          itemUpdateData["system.containerWeightless"] = false;
          hasContainerChanged = true;
        } else {
          if (i.system.equipped === true) {
            itemUpdateData["system.equipped"] = false;
            hasContainerChanged = true;
          }
          if (i.system.container !== container.name) {
            itemUpdateData["system.container"] = container.name;
            hasContainerChanged = true;
          }
          if (i.system.carried !== container.system.carried) {
            itemUpdateData["system.carried"] = container.system.carried;
            hasContainerChanged = true;
          }
          if (i.system.containerWeightless !== container.system.bagOfHoldingLike) {
            itemUpdateData["system.containerWeightless"] = container.system.bagOfHoldingLike;
            hasContainerChanged = true;
          }
        }
      } else {
        if (i.system.containerId === "none") continue; // Do nothing!

        if (i.system.containerId !== "none") {
          itemUpdateData["system.containerId"] = "none";
          hasContainerChanged = true;
        }
        if (i.system.container !== "None") {
          itemUpdateData["system.container"] = "None";
          hasContainerChanged = true;
        }
        if (i.system.containerWeightless !== false) {
          itemUpdateData["system.containerWeightless"] = false;
          hasContainerChanged = true;
        }
      }
      if (hasContainerChanged) itemUpdates.push(itemUpdateData);
    }
    // //LogHelper.log('Item updates', itemUpdates)
    if (itemUpdates.length > 0) await this.actor.updateEmbeddedDocuments('Item', itemUpdates, { stopUpdates: true, massUpdate: true });
    // Send resource updates to item
    let updatedResources = [];
    let updateClasses = false;

    for (let i of this.actor.items.values()) {
      this.actor.getItemResourcesUpdate(i, updated);
    }

    for (let key of Object.keys(updated)) {
      if (key.match(/^data\.resources\.([a-zA-Z0-9]+)/)) {
        const resourceTag = RegExp.$1;
        if (updatedResources.includes(resourceTag)) continue;
        updatedResources.push(resourceTag);

        const resource = this.actor.system.resources[resourceTag];
        if (resource != null) {
          const itemId = resource._id;
          const item = this.actor.items.get(itemId);
          if (item == null) continue;

          const itemUpdateData = {};
          let key = `data.resources.${resourceTag}.value`;
          if (updated[key] != null && updated[key] !== item.system.uses.value) {
            itemUpdateData["system.uses.value"] = updated[key];
          }
          key = `data.resources.${resourceTag}.max`;
          if (updated[key] != null && updated[key] !== item.system.uses.max) {
            itemUpdateData["system.uses.max"] = updated[key];
          }
          if (Object.keys(itemUpdateData).length > 0) item.update(itemUpdateData);
        }
      }
    }

    updateClasses = true;

    // Clean up old item resources
    for (let [tag, res] of Object.entries(foundry.utils.getProperty(this.actor.system, "resources") || {})) {
      if (!res) continue;
      if (!res._id) continue;
      const itemId = res._id;
      const item = this.actor.items.get(itemId);
      // Remove resource from token bars
      if (item == null) {
        const tokens = this.actor.getActiveTokens();
        tokens.forEach((token) => {
          ["bar1", "bar2"].forEach((b) => {
            const barAttr = token.getBarAttribute(b);
            if (barAttr == null) {
              return;
            }
            if (barAttr.attribute === `resources.${tag}`) {
              const tokenUpdateData = {};
              tokenUpdateData[`${b}.attribute`] = null;
              token.update(token.parent.id, tokenUpdateData, { stopUpdates: true });
            }
          });
        });
      }
      // Remove resource
      if (item == null || createTag(item.name) !== tag) {
        updated[`data.resources.-=${tag}`] = null;
      }
    }

    // Update portraits

    await this.#updateExp(updated);
    return updated;
  }

  /**
   * Makes sure experience values are correct in update data.
   * @param {Object} updated - The update data, as per ActorPF.update()
   * @returns {Boolean} Whether to force an update or not.
   */
  async #updateExp(updated) {
    const classes = this.actor.items.filter((o) => o.type === "class");

    let raceLA = 0;
    if (this.actor.items != null) {
      try {
        let raceObject = this.actor.items.filter((o) => o.type === "race")[0];
        if (raceObject != null) {
          raceLA += raceObject.system.la || 0;
        }
        this.actor.items
          .filter((o) => o.type === "class")
          .forEach((c) => {
            raceLA += c.system?.la || 0;
          });
      } catch (e) { }
    }

    let level = classes.reduce((cur, o) => {
      if (o.system.classType === "minion" || o.system.classType === "template") return cur;
      return cur + o.system.levels;
    }, 0);
    let racialHD = classes
      .filter((o) => o.type === "class" && foundry.utils.getProperty(o.system, "classType") === "racial")
      .reduce((cur, o) => {
        return cur + o.system.levels;
      }, 0);
    level += raceLA;

    let dataLevel = level;

    // The following is not for NPCs
    if (this.actor.type !== "character") return;
    if (updated["system.details.levelUpProgression"] || foundry.utils.getProperty(this.actor.system, "details.levelUpProgression")) {
      dataLevel =
        (updated["system.details.level.available"] || foundry.utils.getProperty(this.actor.system, "details.level.available")) +
        raceLA +
        racialHD;
      //LogHelper.log('ActorPF | _updateExp | Update exp data from class level count', dataLevel)
    }
    //LogHelper.log('ActorPF | _updateExp | Race LA, racial HD, level', raceLA, racialHD,dataLevel)
    // Translate update exp value to number
    let newExp = updated["system.details.xp.value"],
      resetExp = false;
    if (typeof newExp === "string") {
      if (newExp.match(/^\+([0-9]+)$/)) {
        newExp = foundry.utils.getProperty(this.actor.system, "details.xp.value") + parseInt(RegExp.$1);
      } else if (newExp.match(/^-([0-9]+)$/)) {
        newExp = foundry.utils.getProperty(this.actor.system, "details.xp.value") - parseInt(RegExp.$1);
      } else if (newExp === "") {
        resetExp = true;
      } else {
        newExp = parseInt(newExp);
        if (Number.isNaN(newExp)) newExp = foundry.utils.getProperty(this.actor.system, "details.xp.value");
      }

      if (typeof newExp === "number" && newExp !== foundry.utils.getProperty(this.actor.system, "details.xp.value")) {
        updated["system.details.xp.value"] = newExp;
      }
    }
    const maxExp = this.actor.getLevelExp(dataLevel);
    if (maxExp !== foundry.utils.getProperty(this.actor.system, "details.xp.max")) {
      updated["system.details.xp.max"] = maxExp;
    }

    const minExp = dataLevel > 0 ? this.actor.getLevelExp(dataLevel - 1) : 0;
    if (resetExp) updated["system.details.xp.value"] = minExp;
  }

  async updateChanges({ updated = null } = {}, options = {}) {
    let updateData = {};
    const expandedUpdate = foundry.utils.expandObject(updated || {});
    const flattenedUpdate = foundry.utils.flattenObject(expandedUpdate);
    const hitPointsWereExplicitlyUpdated = Object.prototype.hasOwnProperty.call(
      flattenedUpdate,
      "system.attributes.hp.value"
    );
    let source = foundry.utils.mergeObject(this.actor.toObject(false), expandedUpdate);
    source.items = this.actor.items;

    let sizeOverride = "";
    let sizeChange = {};
    let alignmentChange = { lawChaos: "", goodEvil: "" };
    // Add conditions
    let fullConditions = source.system.attributes.conditions || {};

    const changeObjects = source.items
      .filter((obj) => {
        return obj.system.changes != null;
      })
      .filter((obj) => {
        let z = obj.type;
        if (obj.type === "buff") return obj.system.active;
        if (obj.type === "aura") return obj.system.active;
        if (obj.type === "equipment" || obj.type === "weapon")
          return obj.system.equipped && !obj.system.melded && !obj.broken;
        return true;
      });

    // Track previous values
    const prevValues = {
      mhp: foundry.utils.getProperty(this.actor.system, "attributes.hp.max"),
      wounds: foundry.utils.getProperty(this.actor.system, "attributes.wounds.max") || 0,
      vigor: foundry.utils.getProperty(this.actor.system, "attributes.vigor.max") || 0,
    };

    // Gather change types
    const changeData = {};
    const changeDataTemplate = {
      positive: {
        value: 0,
        sources: [],
      },
      negative: {
        value: 0,
        sources: [],
      },
    };
    for (let [key, buffTarget] of Object.entries(CONFIG.D35E.buffTargets)) {
      if (typeof buffTarget === "object") {
        // Add specific skills as targets
        if (key === "skill") {
          for (let [s, skl] of Object.entries(foundry.utils.getProperty(this.actor.system, "skills"))) {
            if (skl == null) continue;
            if (!skl.subSkills) {
              changeData[`skill.${s}`] = {};
              Object.keys(CONFIG.D35E.bonusModifiers).forEach((b) => {
                changeData[`skill.${s}`][b] = foundry.utils.duplicate(changeDataTemplate);
              });
            } else {
              for (let s2 of Object.keys(skl.subSkills)) {
                changeData[`skill.${s}.subSkills.${s2}`] = {};
                Object.keys(CONFIG.D35E.bonusModifiers).forEach((b) => {
                  changeData[`skill.${s}.subSkills.${s2}`][b] = foundry.utils.duplicate(changeDataTemplate);
                });
              }
            }
          }
        } else if (key === "spells") {
          //  "spells.spellbooks.primary.spells.spell1.bonus": "Level 1",
          for (let spellbook of ["primary", "secondary", "tetriary", "spelllike"]) {
            for (let level = 0; level < 10; level++) {
              changeData[`spells.spellbooks.${spellbook}.spells.spell${level}.bonus`] = {};
              Object.keys(CONFIG.D35E.bonusModifiers).forEach((b) => {
                changeData[`spells.spellbooks.${spellbook}.spells.spell${level}.bonus`][b] =
                  foundry.utils.duplicate(changeDataTemplate);
              });
            }
          }
        } else if (key === "slot") {
          for (const slotKey of Object.keys(CONFIG.D35E.defaultSlotCapacities)) {
            if (slotKey === "slotless") continue;
            changeData[`slot.${slotKey}`] = {};
            Object.keys(CONFIG.D35E.bonusModifiers).forEach((b) => {
              changeData[`slot.${slotKey}`][b] = foundry.utils.duplicate(changeDataTemplate);
            });
          }
        }
        // Add static targets
        else {
          for (let subKey of Object.keys(buffTarget)) {
            if (subKey.startsWith("_")) continue;
            changeData[subKey] = {};
            Object.keys(CONFIG.D35E.bonusModifiers).forEach((b) => {
              changeData[subKey][b] = foundry.utils.duplicate(changeDataTemplate);
            });
          }
        }
      }
    }

    // Create an array of changes
    let allChanges = [];
    for (const item of changeObjects) {
      // Get changes from base item
      for (const change of item.system.changes) {
        if (!this.#isChangeAllowed(item, change, fullConditions)) continue;
        allChanges.push({
          raw: change,
          source: {
            value: 0,
            type: item.type,
            subtype: this.#getChangeItemSubtype(item),
            name: item.name,
            item: item.system,
            itemRollData: item.getRollData(),
          },
        });
      }

      // Get changes from all enhancement
      if (item.type === "weapon" || item.type === "equipment") {
        if (item.system.enhancements !== undefined) {
          for (const enhancementItem of item.system.enhancements.items) {
            let enhancementItemData = ItemEnhancementHelper.getEnhancementData(enhancementItem);
            for (const change of enhancementItemData.changes) {
              if (!this.#isChangeAllowed(item, change, fullConditions)) continue;
              change[0] = change[0].replace(/@enhancement/gi, enhancementItemData.enh);
              allChanges.push({
                raw: change,
                source: {
                  value: 0,
                  type: item.type,
                  subtype: this.#getChangeItemSubtype(item),
                  name: item.name,
                  item: item.system,
                  itemRollData: new Item35E(item.toObject(), { temporary: true }).getRollData(),
                },
              });
            }
          }
        }
      }
    }

    // Add more changes
    let flags = {},
      sourceInfo = {};

    // Check flags
    for (let obj of changeObjects) {
      if (obj.system.sizeOverride !== undefined && obj.system.sizeOverride !== null && obj.system.sizeOverride !== "") {
        sizeOverride = obj.system.sizeOverride;
      }
      if (obj.system.sizeChange !== undefined && obj.system.sizeChange !== null && obj.system.sizeChange !== "" && obj.system.sizeChange !== "0") {
        sizeChange = {
          change: parseInt(obj.system.sizeChange),
          upperBound: obj.system.sizeChangeUpperBound,
          lowerBound: obj.system.sizeChangeLowerBound,
        }
      }
      const ac = obj.system.alignmentChange;
      if (ac?.lawChaos) alignmentChange.lawChaos = ac.lawChaos;
      if (ac?.goodEvil) alignmentChange.goodEvil = ac.goodEvil;
      if (!obj.system.changeFlags) continue;
      for (let [flagKey, flagValue] of Object.entries(obj.system.changeFlags)) {
        flags[flagKey] = flags[flagKey] || false;
        if (flagValue === true) {
          flags[flagKey] = true;

          let targets = [];
          let value = "";

          switch (flagKey) {
            case "loseDexToAC":
              sourceInfo["system.attributes.ac.normal.total"] = sourceInfo["system.attributes.ac.normal.total"] || {
                positive: [],
                negative: [],
              };
              sourceInfo["system.attributes.ac.touch.total"] = sourceInfo["system.attributes.ac.touch.total"] || {
                positive: [],
                negative: [],
              };
              sourceInfo["system.attributes.cmd.total"] = sourceInfo["system.attributes.cmd.total"] || {
                positive: [],
                negative: [],
              };
              targets = [
                sourceInfo["system.attributes.ac.normal.total"].negative,
                sourceInfo["system.attributes.ac.touch.total"].negative,
                sourceInfo["system.attributes.cmd.total"].negative,
              ];
              value = "Lose Agility to AC";
              break;
            case "noInt":
              sourceInfo["system.abilities.int.total"] = sourceInfo["system.abilities.int.total"] || {
                positive: [],
                negative: [],
              };
              targets = [sourceInfo["system.abilities.int.total"].negative];
              value = "No Intelligence";
              break;
            case "noCon":
              sourceInfo["system.abilities.con.total"] = sourceInfo["system.abilities.con.total"] || {
                positive: [],
                negative: [],
              };
              targets = [sourceInfo["system.abilities.con.total"].negative];
              value = "No Stamina";
              break;
            case "noDex":
              sourceInfo["system.abilities.dex.total"] = sourceInfo["system.abilities.dex.total"] || {
                positive: [],
                negative: [],
              };
              targets = [sourceInfo["system.abilities.dex.total"].negative];
              value = "No Agility";
              break;
            case "noStr":
              sourceInfo["system.abilities.str.total"] = sourceInfo["system.abilities.str.total"] || {
                positive: [],
                negative: [],
              };
              targets = [sourceInfo["system.abilities.str.total"].negative];
              value = "No Strength";
              break;
            case "zeroDex":
              sourceInfo["system.abilities.dex.total"] = sourceInfo["system.abilities.dex.total"] || {
                positive: [],
                negative: [],
              };
              targets = [sourceInfo["system.abilities.dex.total"].negative];
              value = "0 Agy";
              break;
            case "zeroStr":
              sourceInfo["system.abilities.str.total"] = sourceInfo["system.abilities.str.total"] || {
                positive: [],
                negative: [],
              };
              targets = [sourceInfo["system.abilities.str.total"].negative];
              value = "0 Str";
              break;
            case "oneInt":
              sourceInfo["system.abilities.int.total"] = sourceInfo["system.abilities.int.total"] || {
                positive: [],
                negative: [],
              };
              targets = [sourceInfo["system.abilities.int.total"].negative];
              value = "1 Int";
              break;
            case "oneWis":
              sourceInfo["system.abilities.wis.total"] = sourceInfo["system.abilities.wis.total"] || {
                positive: [],
                negative: [],
              };
              targets = [sourceInfo["system.abilities.wis.total"].negative];
              value = "1 Spt";
              break;
            case "oneCha":
              sourceInfo["system.abilities.cha.total"] = sourceInfo["system.abilities.cha.total"] || {
                positive: [],
                negative: [],
              };
              targets = [sourceInfo["system.abilities.cha.total"].negative];
              value = "1 Cha";
              break;
          }

          for (let t of Object.values(targets)) {
            t.push({ type: obj.type, subtype: this.#getChangeItemSubtype(obj), value: value });
          }
        }
      }
    }

    const initialCreatureProfile = resolveWarcraftCreatureProfile({
      creatureType: source.system.attributes?.creatureType,
      deathRule: resolveDeathRule(
        source.system.attributes?.deathRule,
        this.actor.race?.system?.deathRule,
        source.system.attributes?.creatureType,
      ),
    });
    if (initialCreatureProfile.construct || initialCreatureProfile.undead) flags.noCon = true;

    // Initialize data
    await this.#resetData(updateData, source, flags, sourceInfo, allChanges, fullConditions);
    await this.#addDefaultChanges(
      source,
      allChanges,
      flags,
      sourceInfo,
      fullConditions,
      sizeOverride,
      sizeChange,
      options,
      updateData,
      alignmentChange
    );
    //LogHelper.log('Sorting Changes');
    // Sort changes
    allChanges.sort(this.#sortChanges.bind(this));
    // Parse changes
    let temp = [];
    //LogHelper.log('Master Changes');
    const origData = foundry.utils.mergeObject(this.actor.toObject(false), updated != null ? foundry.utils.expandObject(updated) : {});
    updateData = foundry.utils.flattenObject({
      system: foundry.utils.mergeObject(origData.system, foundry.utils.expandObject(updateData).system, { inplace: false }),
    });
    this.#addDynamicData(updateData, {}, flags, Object.keys(foundry.utils.getProperty(this.actor.system, "abilities")), source, true);

    if (!this.actor.system?.master?.id) {
      let _changesLength = allChanges.length;
      allChanges = allChanges.filter((c) => (c.raw[0] || "").indexOf("@master") === -1);
      if (_changesLength !== allChanges.length) {
        return ui.notifications.warn(game.i18n.localize("D35E.FamiliarNoMaster"));
        //LogHelper.log('Minion has some changes removed |', _changesLength,allChanges.length);
      }
    }

    //LogHelper.log('Rolling Changes');
    let currentChangeTarget = null;
    let changeRollData = null;
    let groupRollData = null;
    // All changes are sorted and lumped together

    // Speed change targets whose formulas may reference the same group's totals.
    const speedRollDataPaths = {
      landSpeed: 'attributes.speed.land.total',
      climbSpeed: 'attributes.speed.climb.total',
      swimSpeed: 'attributes.speed.swim.total',
      burrowSpeed: 'attributes.speed.burrow.total',
      flySpeed: 'attributes.speed.fly.total',
    };

    allChanges.forEach((change, a) => {
      const formula = change.raw[0] || "";
      if (formula === "") return;
      const changeTarget = change.raw[2];
      if (changeData[changeTarget] == null) return;
      if (currentChangeTarget !== changeTarget) {
        currentChangeTarget = changeTarget;

        // Cleaning up roll data from blacklisted stuff for this.actor.type of change
        changeRollData = this.#blacklistChangeData(this.actor.getRollData(source.system), changeTarget);
        groupRollData = foundry.utils.duplicate(changeRollData);
      }

      groupRollData.item = {};
      if (change.source.itemRollData != null) {
        groupRollData.item = change.source.itemRollData;
      }

      const roll = new Roll35e(formula, groupRollData);

      try {
        change.raw[4] = roll.evaluateSync().total;
      } catch (e) {
        ui.notifications.error(
          game.i18n
            .localize("D35E.ErrorItemFormula")
            .format(
              change.source?.item?.name || "Unknown (most likely Actor itself)",
              this.actor.name,
              `${formula} (${changeTarget})`
            )
        );
      }
      this.#parseChange(change, changeData[changeTarget], flags);

      // When a speed change in the same group has another change following it,
      // flush the accumulated total into groupRollData so the next formula's
      // evaluation sees the updated value.  Fixes #1678: Haste enhancement formula
      // reads fly.total but the replace/base-type spell in the same group has
      // not been applied to the actor yet.
      const isLastInGroup = allChanges.length <= a + 1 || allChanges[a + 1].raw[2] !== changeTarget;
      const rollDataPath = speedRollDataPaths[changeTarget];
      if (!isLastInGroup && rollDataPath) {
        let totalBonus = 0;
        for (const modType of Object.keys(changeData[changeTarget])) {
          totalBonus += (changeData[changeTarget][modType]?.positive?.value || 0)
                      + (changeData[changeTarget][modType]?.negative?.value || 0);
        }
        const baseTotal = foundry.utils.getProperty(changeRollData, rollDataPath) || 0;
        foundry.utils.setProperty(groupRollData, rollDataPath, baseTotal + totalBonus);
      }

      temp.push(changeData[changeTarget]);
      if (allChanges.length <= a + 1 || allChanges[a + 1].raw[2] !== changeTarget) {
        const newData = this.#applyChanges(
          changeTarget,
          temp,
          source,
          sourceInfo,
          change.source.name || change.source?.item?.name,
          change.source.type
        );
        this.#addDynamicData(
          updateData,
          newData,
          flags,
          Object.keys(foundry.utils.getProperty(this.actor.system, "abilities")),
          source,
          false,
          changeTarget
        );
        temp = [];
      }
    });

    for (let flagKey of Object.keys(flags)) {
      if (!flags[flagKey]) continue;

      switch (flagKey) {
        case "noDex":
          linkData(source, updateData, "system.abilities.dex.origTotal", 0);
          linkData(source, updateData, "system.abilities.dex.origMod", 0);
          linkData(source, updateData, "system.abilities.dex.total", 0);
          linkData(source, updateData, "system.abilities.dex.mod", 0);
          linkData(source, updateData, `system.abilities.dex.drain`, 0);
          break;
        case "noStr":
          linkData(source, updateData, "system.abilities.str.origTotal", 0);
          linkData(source, updateData, "system.abilities.str.origMod", 0);
          linkData(source, updateData, "system.abilities.str.total", 0);
          linkData(source, updateData, "system.abilities.str.mod", 0);
          linkData(source, updateData, `system.abilities.str.drain`, 0);
          break;
        case "zeroDex":
          linkData(source, updateData, "system.abilities.dex.origTotal", 0);
          linkData(source, updateData, "system.abilities.dex.origMod", -5);
          linkData(source, updateData, "system.abilities.dex.total", 0);
          linkData(source, updateData, "system.abilities.dex.mod", -5);
          linkData(source, updateData, `system.abilities.dex.drain`, 0);
          break;
        case "zeroStr":
          linkData(source, updateData, "system.abilities.str.origTotal", 0);
          linkData(source, updateData, "system.abilities.str.origMod", -5);
          linkData(source, updateData, "system.abilities.str.total", 0);
          linkData(source, updateData, "system.abilities.str.mod", -5);
          linkData(source, updateData, `system.abilities.str.drain`, 0);
          break;
        case "noCon":
          linkData(source, updateData, "system.abilities.con.origTotal", 0);
          linkData(source, updateData, "system.abilities.con.origMod", 0);
          linkData(source, updateData, "system.abilities.con.total", 0);
          linkData(source, updateData, "system.abilities.con.mod", 0);
          linkData(source, updateData, `system.abilities.con.drain`, 0);
          break;
        case "noInt":
          linkData(source, updateData, "system.abilities.int.origTotal", 0);
          linkData(source, updateData, "system.abilities.int.origMod", 0);
          linkData(source, updateData, "system.abilities.int.total", 0);
          linkData(source, updateData, "system.abilities.int.mod", 0);
          linkData(source, updateData, `system.abilities.int.drain`, 0);
          break;
        case "oneInt":
          linkData(source, updateData, "system.abilities.int.origTotal", 1);
          linkData(source, updateData, "system.abilities.int.origMod", -5);
          linkData(source, updateData, "system.abilities.int.total", 1);
          linkData(source, updateData, "system.abilities.int.mod", -5);
          linkData(source, updateData, `system.abilities.int.drain`, 0);
          break;
        case "oneWis":
          linkData(source, updateData, "system.abilities.wis.origTotal", 1);
          linkData(source, updateData, "system.abilities.wis.origMod", -5);
          linkData(source, updateData, "system.abilities.wis.total", 1);
          linkData(source, updateData, "system.abilities.wis.mod", -5);
          linkData(source, updateData, `system.abilities.wis.drain`, 0);
          break;
        case "oneCha":
          linkData(source, updateData, "system.abilities.cha.origTotal", 1);
          linkData(source, updateData, "system.abilities.cha.origMod", -5);
          linkData(source, updateData, "system.abilities.cha.total", 1);
          linkData(source, updateData, "system.abilities.cha.mod", -5);
          linkData(source, updateData, `system.abilities.cha.drain`, 0);
          break;
      }
    }

    //LogHelper.log('ACP and spell slots');
    // Ensure encumbrance values are current before speed reduction.
    this.#computeEncumbrance(updateData, source);

    // Reduce final speed under certain circumstances
    let armorItems = source.items.filter((o) => o.type === "equipment");
    for (let speedKey of Object.keys(source.system.attributes.speed)) {
      if (updateData[`system.attributes.speed.${speedKey}.replace`]) continue; // Speed was already force replaced, ignore
      let value = Math.floor(
        updateData[`system.attributes.speed.${speedKey}.total`] *
        (updateData[`system.attributes.speedMultiplier`] || 1.0)
      );
      this.getReducedMovementSpeed(source, value, updateData, armorItems, flags, speedKey);
    }

    // Reset spell slots
    const warcraftCasterAdvancement = allocateWarcraftPrestigeCasterLevels(
      source.items.filter((item) => item.type === "class")
    );
    for (let spellbookKey of Object.keys(foundry.utils.getProperty(source, "system.attributes.spells.spellbooks"))) {
      const spellbookAbilityKey = foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.ability`);
      const spellslotAbilityKey =
        foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.spellslotAbility`) ||
        spellbookAbilityKey;
      let spellbookAbilityMod = foundry.utils.getProperty(source, `system.abilities.${spellbookAbilityKey}.mod`);
      let spellslotAbilityMod = foundry.utils.getProperty(source, `system.abilities.${spellslotAbilityKey}.mod`);
      const spellbookClass = foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.class`);
      const autoSetup = foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.autoSetup`);
      const manualPrestigeCasterLevels =
        parseInt(foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.bonusPrestigeCl`)) || 0;
      const automaticCasterLevels = warcraftCasterAdvancement.slotByClass[spellbookClass] || 0;
      let classLevel =
        (foundry.utils.getProperty(source, `system.classes.${spellbookClass}.level`) || 0) +
        (automaticCasterLevels > 0 ? automaticCasterLevels : manualPrestigeCasterLevels);
      if (classLevel > foundry.utils.getProperty(source, `system.classes.${spellbookClass}.maxLevel`))
        classLevel = foundry.utils.getProperty(source, `system.classes.${spellbookClass}.maxLevel`);
      const classProgression = foundry.utils.getProperty(source, `system.classes.${spellbookClass}.spellPerLevel${classLevel}`);
      let autoSpellLevels = foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.autoSpellLevels`);
      if (autoSetup) {
        const autoSpellcastingAbilityKey = foundry.utils.getProperty(source, `system.classes.${spellbookClass}.spellcastingAbility`);
        const autoSpellslotAbilityKey =
          foundry.utils.getProperty(source, `system.classes.${spellbookClass}.spellslotAbility`) || autoSpellcastingAbilityKey;
        for (let property of [
          ["spellcastingType", "spellcastingType"],
          ["ability", "spellcastingAbility"],
          ["spellslotAbility", "spellslotAbility"],
          ["spontaneous", "isSpellcastingSpontaneus"],
          ["preparationMode", "spellcastingPreparationMode"],
          ["repertoireSkill", "repertoireSkill"],
          ["usesWarcraftSlotPool", "usesWarcraftSlotPool"],
          ["warcraftPoolKey", "warcraftPoolKey"],
          ["warcraftParentClass", "warcraftParentClass"],
          ["warcraftPathBonusSlot", "warcraftPathBonusSlot"],
          ["specialSlotLevel0", "specialSlotLevel0"],
        ])
          linkData(
            source,
            updateData,
            `system.attributes.spells.spellbooks.${spellbookKey}.${property[0]}`,
            foundry.utils.getProperty(source, `system.classes.${spellbookClass}.${property[1]}`)
          );
        linkData(source, updateData, `system.attributes.spells.spellbooks.${spellbookKey}.autoSpellLevels`, true);
        linkData(
          source,
          updateData,
          `system.attributes.spells.spellbooks.${spellbookKey}.usePowerPoints`,
          foundry.utils.getProperty(source, `system.classes.${spellbookClass}.isPsionSpellcaster`)
        );
        linkData(
          source,
          updateData,
          `system.attributes.spells.spellbooks.${spellbookKey}.arcaneSpellFailure`,
          foundry.utils.getProperty(source, `system.classes.${spellbookClass}.isArcane`)
        );
        linkData(
          source,
          updateData,
          `system.attributes.spells.spellbooks.${spellbookKey}.hasSpecialSlot`,
          foundry.utils.getProperty(source, `system.classes.${spellbookClass}.hasSpecialSlot`)
        );
        linkData(
          source,
          updateData,
          `system.attributes.spells.spellbooks.${spellbookKey}.warcraftCurrentPath`,
          foundry.utils.getProperty(source, `system.classes.${spellbookClass}.currentPath`) || ""
        );

        autoSpellLevels = true;
        spellbookAbilityMod =
          foundry.utils.getProperty(source, `system.abilities.${autoSpellcastingAbilityKey}.mod`) +
          foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.spellcastingAbilityBonus`);
        spellslotAbilityMod =
          foundry.utils.getProperty(source, `system.abilities.${autoSpellslotAbilityKey}.mod`) +
          foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.spellcastingAbilityBonus`);
      }

      let powerPointsFormula =
        updateData[`system.attributes.spells.spellbooks.${spellbookKey}.dailyPowerPointsFormula`] ||
        foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.dailyPowerPointsFormula`) ||
        "0";
      linkData(
        source,
        updateData,
        `system.attributes.spells.spellbooks.${spellbookKey}.powerPointsTotal`,
        new Roll35e(powerPointsFormula, this.actor.getRollData()).evaluateSync().total
      );

      for (let a = 0; a < 10; a++) {
        const classBase = classProgression !== undefined ? parseInt(classProgression[a + 1]) : -1;
        let base = parseInt(
          foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.base`)
        );
        let bonus = parseInt(
          foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.bonus`) || 0
        );
        if (!autoSpellLevels) {
          if (Number.isNaN(base)) {
            linkData(
              source,
              updateData,
              `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.base`,
              null
            );
            linkData(source, updateData, `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.max`, 0);
          } else {
            linkData(
              source,
              updateData,
              `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.max`,
              base
            );
          }
        } else {
          if (classBase >= 0) {
            const value =
              typeof spellslotAbilityMod === "number"
                ? classBase + this.getSpellSlotIncrease(spellslotAbilityMod, a)
                : classBase;
            linkData(
              source,
              updateData,
              `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.base`,
              value
            );
            linkData(
              source,
              updateData,
              `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.max`,
              value + bonus
            );
          } else {
            linkData(
              source,
              updateData,
              `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.base`,
              0
            );
            linkData(source, updateData, `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.max`, 0);
          }
        }
      }
    }

    const calculatedSpellbooks = foundry.utils.duplicate(
      foundry.utils.getProperty(source, "system.attributes.spells.spellbooks") || {}
    );
    for (const [spellbookKey, spellbook] of Object.entries(calculatedSpellbooks)) {
      for (let level = 0; level <= 9; level += 1) {
        const updatedMax = updateData[
          `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${level}.max`
        ];
        if (updatedMax !== undefined) {
          spellbook.spells ||= {};
          spellbook.spells[`spell${level}`] ||= {};
          spellbook.spells[`spell${level}`].max = updatedMax;
        }
      }
      for (const key of ["usesWarcraftSlotPool", "warcraftPoolKey"]) {
        const updatedValue = updateData[`system.attributes.spells.spellbooks.${spellbookKey}.${key}`];
        if (updatedValue !== undefined) spellbook[key] = updatedValue;
      }
    }
    const warcraftPools = calculateWarcraftSlotPools(
      calculatedSpellbooks,
      foundry.utils.getProperty(source, "system.attributes.spells.warcraftPools") || {}
    );
    for (const [poolKey, pool] of Object.entries(warcraftPools)) {
      linkData(source, updateData, `system.attributes.spells.warcraftPools.${poolKey}.key`, pool.key);
      linkData(source, updateData, `system.attributes.spells.warcraftPools.${poolKey}.spellbooks`, pool.spellbooks);
      for (let level = 0; level <= 9; level += 1) {
        linkData(
          source,
          updateData,
          `system.attributes.spells.warcraftPools.${poolKey}.spells.spell${level}`,
          pool.spells[`spell${level}`]
        );
      }
    }

    // Reset spell slots
    let classes = this.actor.items
      .filter((o) => o.type === "class" && foundry.utils.getProperty(o, "classType") !== "racial")
      .sort((a, b) => {
        return a.sort - b.sort;
      });

    for (let deckKey of Object.keys(foundry.utils.getProperty(source, "system.attributes.cards.decks"))) {
      const spellbookAbilityKey = foundry.utils.getProperty(source, `system.attributes.cards.decks.${deckKey}.ability`);
      const spellslotAbilityKey =
        foundry.utils.getProperty(source, `system.attributes.cards.decks.${deckKey}.spellslotAbility`) || spellbookAbilityKey;
      let spellbookAbilityMod = foundry.utils.getProperty(source, `system.abilities.${spellbookAbilityKey}.mod`);
      let spellslotAbilityMod = foundry.utils.getProperty(source, `system.abilities.${spellslotAbilityKey}.mod`);
      const spellbookClass = foundry.utils.getProperty(source, `system.attributes.cards.decks.${deckKey}.class`);
      const autoSetup = foundry.utils.getProperty(source, `system.attributes.cards.decks.${deckKey}.autoSetup`);
      const deckAddHalfOtherLevels = foundry.utils.getProperty(source, `system.attributes.cards.decks.${deckKey}.addHalfOtherLevels`);
      let baseClassLevel = foundry.utils.getProperty(source, `system.classes.${spellbookClass}.level`);
      let classLevel =
        foundry.utils.getProperty(source, `system.classes.${spellbookClass}.level`) +
        parseInt(foundry.utils.getProperty(source, `system.attributes.cards.decks.${deckKey}.bonusPrestigeCl`) || 0);
      if (classLevel > foundry.utils.getProperty(source, `system.classes.${spellbookClass}.maxLevel`))
        classLevel = foundry.utils.getProperty(source, `system.classes.${spellbookClass}.maxLevel`);

      linkData(source, updateData, `system.attributes.cards.decks.${deckKey}.cl.base`, classLevel);

      let deckHandSizeForumla = foundry.utils.getProperty(source, `system.classes.${spellbookClass}.deckHandSizeFormula`) || "0";
      let baseDeckHandSize = await new Roll35e(deckHandSizeForumla || "", { level: classLevel || 0 }).evaluateSync().total;
      let knownCardsSizeFormula = foundry.utils.getProperty(source, `system.classes.${spellbookClass}.knownCardsSizeFormula`) || "0";
      let baseKnownCardsSize = await new Roll35e(knownCardsSizeFormula || "", { level: classLevel || 0 }).evaluateSync().total;

      let otherClassesLevels = classes.reduce((cur, o) => {
        if (
          o.name === spellbookClass ||
          o.system.classType === "minion" ||
          o.system.classType === "template" ||
          o.system.deckPresigeClass
        )
          return cur;
        return cur + o.system.levels;
      }, 0);

      let prestigeClasseslLevels = classes.reduce((cur, o) => {
        if (!o.system.deckPresigeClass) return cur;
        return cur + o.system.levels;
      }, 0);

      let otherLevels = otherClassesLevels - baseClassLevel;
      let totalDeckCasterLevel =
        (baseClassLevel || 0) + (deckAddHalfOtherLevels ? Math.floor(otherLevels / 2) : 0) + prestigeClasseslLevels;

      let deckSizeFormula =
        updateData[`system.attributes.cards.decks.${deckKey}.handSize.formula`] ||
        foundry.utils.getProperty(source, `system.attributes.cards.decks.${deckKey}.handSize.formula`) ||
        "0";
      linkData(
        source,
        updateData,
        `system.attributes.cards.decks.${deckKey}.handSize.total`,
        new Roll35e(deckSizeFormula, this.actor.getRollData()).evaluateSync().total + baseDeckHandSize
      );

      let casterLevelBonusFormula =
        updateData[`system.attributes.cards.decks.${deckKey}.cl.formula`] ||
        foundry.utils.getProperty(source, `system.attributes.cards.decks.${deckKey}.cl.formula`) ||
        "0";
      linkData(
        source,
        updateData,
        `system.attributes.cards.decks.${deckKey}.cl.total`,
        new Roll35e(casterLevelBonusFormula, this.actor.getRollData()).evaluateSync().total + totalDeckCasterLevel
      );

      let knownCardsBonusFormula =
        updateData[`system.attributes.cards.decks.${deckKey}.deckSize.formula`] ||
        foundry.utils.getProperty(source, `system.attributes.cards.decks.${deckKey}.deckSize.formula`) ||
        "0";
      linkData(
        source,
        updateData,
        `system.attributes.cards.decks.${deckKey}.deckSize.total`,
        new Roll35e(knownCardsBonusFormula, this.actor.getRollData()).evaluateSync().total + baseKnownCardsSize
      );
    }

    // Add dex mod to AC
    if (updateData["system.abilities.dex.mod"] < 0 || !flags.loseDexToAC) {
      const maxDexBonus =
        updateData["system.attributes.maxDexBonus"] !== null &&
          updateData["system.attributes.maxDexBonus"] !== undefined
          ? updateData["system.attributes.maxDexBonus"]
          : foundry.utils.getProperty(this.actor.system, "attributes.maxDexBonus") || null;
      const dexBonus =
        maxDexBonus != null
          ? Math.min(maxDexBonus, updateData["system.abilities.dex.mod"])
          : updateData["system.abilities.dex.mod"];

      if (!updateData["system.attributes.ac.normal.replace"])
        //We did not replace AC, continue
        linkData(
          source,
          updateData,
          "system.attributes.ac.normal.total",
          updateData["system.attributes.ac.normal.total"] + dexBonus
        );

      if (!updateData["system.attributes.ac.touch.replace"])
        //We did not replace AC, continue
        linkData(
          source,
          updateData,
          "system.attributes.ac.touch.total",
          updateData["system.attributes.ac.touch.total"] + dexBonus
        );

      if (!updateData["system.attributes.ac.flatFooted.replace"]) {
        if (updateData["system.abilities.dex.mod"] < 0) {
          linkData(
            source,
            updateData,
            "system.attributes.ac.flatFooted.total",
            updateData["system.attributes.ac.flatFooted.total"] + dexBonus
          );
        }
        if (flags.uncannyDodge && !flags.loseDexToAC) {
          linkData(
            source,
            updateData,
            "system.attributes.ac.flatFooted.total",
            updateData["system.attributes.ac.flatFooted.total"] + dexBonus
          );
        }
      }
    }
    // Add current hit points

    if (fullConditions.wildshaped || fullConditions.polymorph) {
      linkData(
        source,
        updateData,
        "system.attributes.hp.value",
        Math.min(prevValues.mhp, source.system.attributes.hp.value)
      );
    } else {
      if (
        !hitPointsWereExplicitlyUpdated &&
        options.preserveCurrentHitPoints !== true &&
        updateData["system.attributes.hp.max"]
      ) {
        const hpDiff = updateData["system.attributes.hp.max"] - prevValues.mhp;
        LogHelper.log("HP Diff", prevValues.mhp, hpDiff, updateData["system.attributes.hp.max"]);
        if (hpDiff !== 0) {
          linkData(
            source,
            updateData,
            "system.attributes.hp.value",
            Math.min(updateData["system.attributes.hp.max"], source.system.attributes.hp.value + hpDiff)
          );
        }
      }
    }
    if (updateData["system.attributes.wounds.max"]) {
      const wDiff = updateData["system.attributes.wounds.max"] - prevValues.wounds;
      if (wDiff !== 0) {
        linkData(
          source,
          updateData,
          "system.attributes.wounds.value",
          Math.min(updateData["system.attributes.wounds.max"], source.system.attributes.wounds.value + wDiff)
        );
      }
    }
    if (updateData["system.attributes.vigor.max"]) {
      const vDiff = updateData["system.attributes.vigor.max"] - prevValues.vigor;
      if (vDiff !== 0) {
        linkData(
          source,
          updateData,
          "system.attributes.vigor.value",
          Math.min(updateData["system.attributes.vigor.max"], source.system.attributes.vigor.value + vDiff)
        );
      }
    }
    if (source !== null) {
      if (
        source.img !== foundry.utils.getProperty(this.actor.system, "tokenImg") &&
        foundry.utils.getProperty(this.actor.system, "tokenImg") === "icons/svg/mystery-man.svg"
      ) {
        source.tokenImg = source.img;
        linkData(source, updateData, "system.tokenImg", source.img);
      }
    }

    let shapechangeImg = updateData["system.shapechangeImg"];
    // Fall back to the actor's existing tokenImg if the current update didn't change it.
    let tokenImg = updateData["system.tokenImg"] ?? foundry.utils.getProperty(source, "system.tokenImg");

    if (updated !== null && updated.token !== undefined && updated.token.img !== undefined) {
      tokenImg = updated.token.img;
      linkData(source, updateData, "system.tokenImg", tokenImg);
    }
    if (!options.skipToken && !foundry.utils.getProperty(this.actor.system, "noTokenOverride")) {
      if (shapechangeImg !== "icons/svg/mystery-man.svg") {
        if (this.actor.isToken) {
          let tokens = [];
          tokens.push(this.actor.token);
          for (const o of tokens) {
            if (shapechangeImg !== o.img)
              ActorPF._updateToken(o, { texture: { src: shapechangeImg } }, { stopUpdates: true });
          }
        }
        if (!this.actor.isToken) {
          let tokens = this.actor.getActiveTokens().filter((o) => o?.document.actorLink);

          for (const o of tokens) {
            if (shapechangeImg !== o.img)
              ActorPF._updateToken(o, { texture: { src: shapechangeImg } }, { stopUpdates: true });
          }
          if (source !== null) foundry.utils.setProperty(source, "prototypeToken.texture.src", shapechangeImg);
        }
      } else {
        if (this.actor.isToken) {
          let tokens = [];
          tokens.push(this.actor.token);
          for (const o of tokens) {
            if (tokenImg && tokenImg !== o.img)
              ActorPF._updateToken(o, { texture: { src: tokenImg } }, { stopUpdates: true });
          }
        }
        if (!this.actor.isToken) {
          let tokens = this.actor.getActiveTokens().filter((o) => o?.document.actorLink);

          for (const o of tokens) {
            if (tokenImg && tokenImg !== o.img)
              ActorPF._updateToken(o, { texture: { src: tokenImg } }, { stopUpdates: true });
          }

          if (source !== null && tokenImg && tokenImg !== "icons/svg/mystery-man.svg") {
            foundry.utils.setProperty(source, "prototypeToken.texture.src", tokenImg);
          }
        }
      }
    }
    if (fullConditions.wildshaped || fullConditions.polymorph)
      //this.actor.retains max HP
      linkData(source, updateData, "system.attributes.hp.max", prevValues.mhp);

    this.#updateAbilityRelatedFields(source, updateData, sourceInfo);

    // Embedded race and class edits also run updateChanges. Reconcile the HP
    // state here so adding/removing Forsaken or construct rules cannot leave
    // conditions from the actor's previous health model behind.
    const preparedDeathRule = resolveDeathRule(
      source.system.attributes?.deathRule,
      this.actor.race?.system?.deathRule,
      source.system.attributes?.creatureType,
    );
    if (preparedDeathRule !== DEATH_RULE_D35E) {
      const hitPoints = Number(source.system.attributes.hp.value ?? 0);
      const staminaScore = Number(source.system.abilities.con?.total ?? source.system.abilities.con?.value ?? 0);
      let stable = preparedDeathRule === DEATH_RULE_WARCRAFT
        && Boolean(source.system.attributes.conditions?.stable);
      let healthState = classifyWarcraftHealth({ hitPoints, staminaScore, deathRule: preparedDeathRule, stable });
      if (healthState.disabled || healthState.dead || preparedDeathRule !== DEATH_RULE_WARCRAFT) stable = false;
      if (!stable && preparedDeathRule === DEATH_RULE_WARCRAFT) {
        healthState = classifyWarcraftHealth({ hitPoints, staminaScore, deathRule: preparedDeathRule });
      }
      linkData(source, updateData, "system.attributes.conditions.disabled", healthState.disabled);
      linkData(source, updateData, "system.attributes.conditions.dying", healthState.dying);
      linkData(source, updateData, "system.attributes.conditions.down", healthState.down);
      linkData(source, updateData, "system.attributes.conditions.dead", healthState.dead);
      linkData(source, updateData, "system.attributes.conditions.stable", stable);
      linkData(source, updateData, "system.attributes.conditions.unconscious", healthState.unconscious);
      linkData(source, updateData, "system.attributes.conditions.helpless", healthState.unconscious);
    }

    this.actor.sourceDetails = ActorPrepareSourceHelper.setSourceDetails(
      foundry.utils.mergeObject(this.actor.toObject(false), source),
      sourceInfo,
      flags
    );

    const diffData = source;

    if (this.actor.collection != null && Object.keys(diffData).length > 0) {
      let newData = {};
      if (updated != null) newData = foundry.utils.flattenObject(foundry.utils.mergeObject(updated, foundry.utils.flattenObject(diffData), { inplace: false }));
      return { data: newData, diff: diffData };
    }
    return { data: {}, diff: {} };
  }

  #updateAbilityRelatedFields(source, updateData, sourceInfo) {
    {
      const currentValue = foundry.utils.getProperty(source, "system.attributes.shoutUses.value") ?? 0;
      const shoutUses = deriveShoutUses(source.items, currentValue);
      linkData(source, updateData, "system.attributes.shoutUses.max", shoutUses.max);
      linkData(source, updateData, "system.attributes.shoutUses.value", shoutUses.value);
    }

    {
      const k = "system.attributes.turnUndeadUsesTotal";
      let chaMod = foundry.utils.getProperty(source, `system.abilities.cha.mod`);
      //LogHelper.log(updateData)
      if (foundry.utils.getProperty(source, `system.attributes.turnUndeadHdTotal`) > 0) {
        linkData(source, updateData, k, new Roll35e("3+@chaMod", { chaMod: chaMod }).evaluateSync().total + updateData[k]);

        sourceInfo[k] = sourceInfo[k] || { positive: [], negative: [] };
        sourceInfo[k].positive.push({ name: "Base", value: 3 });
        sourceInfo[k].positive.push({ name: "Charisma", value: chaMod });
      } else linkData(source, updateData, k, 0);
    }

    {
      const classes = source.items
        .filter((o) => o.type === "class" && foundry.utils.getProperty(o.system, "classType") !== "racial")
        .sort((a, b) => {
          return a.sort - b.sort;
        });
      const k = "system.attributes.powerPointsTotal";
      linkData(
        source,
        updateData,
        k,
        updateData[k] +
        classes.reduce((cur, obj) => {
          try {
            if (
              obj.system.powerPointTable === undefined ||
              obj.system.powerPointTable[obj.system.levels] === undefined
            )
              return cur;
            let ablMod = 0;
            if (
              obj.system.powerPointBonusBaseAbility !== undefined &&
              obj.system.powerPointBonusBaseAbility !== null &&
              obj.system.powerPointBonusBaseAbility !== ""
            )
              ablMod = foundry.utils.getProperty(source, `system.abilities.${obj.system.powerPointBonusBaseAbility}.mod`) || 0;
            const v =
              new Roll35e("floor(0.5*@level*@ablMod)", {
                level: obj.system.levels,
                ablMod: ablMod,
              }).evaluateSync().total + obj.system.powerPointTable[obj.system.levels];

            if (v !== 0) {
              sourceInfo[k] = sourceInfo[k] || { positive: [], negative: [] };
              sourceInfo[k].positive.push({ name: foundry.utils.getProperty(obj, "name"), value: v });
            }

            return cur + v;
          } catch (e) {
            return cur;
          }
        }, 0)
      );
    }

    if (source.system.jumpSkillAdjust) {
      const j = "system.skills.jmp.mod";
      sourceInfo[j] = sourceInfo[j] || { positive: [], negative: [] };
      const landSpeed =
        updateData["system.attributes.speed.land.total"] ??
        foundry.utils.getProperty(source, "system.attributes.speed.land.total");
      let value = 0;
      if (landSpeed < 30) {
        value = -6 * Math.floor((30 - landSpeed) / 10);
        if (value !== 0) {
          sourceInfo[j].negative.push({ name: "Speed penalty", value: value });
        }
      } else if (landSpeed > 30) {
        value = 4 * Math.floor((landSpeed - 30) / 10);
        if (value !== 0) {
          sourceInfo[j].positive.push({ name: "Speed bonus", value: value });
        }
      }
      linkData(source, updateData, j, value + (updateData[j] ?? 0));
    }
  }

  #applyChanges(buffTarget, changeData, rollData, sourceInfo, sourceName, sourceType) {
    let consolidatedChanges = {};
    let changes = {};
    for (let change of changeData) {
      for (let b of Object.keys(change)) {
        changes[b] = { positive: 0, negative: 0, sources: [] };
      }
      for (let [changeType, changeData] of Object.entries(change)) {
        // Add positive value
        if (changeData.positive.value !== 0) {
          changes[changeType].positive += changeData.positive.value;
          changes[changeType].sources.push(...changeData.positive.sources);
        }
        // Add negative value
        if (changeData.negative.value !== 0) {
          changes[changeType].negative += changeData.negative.value;
          changes[changeType].sources.push(...changeData.negative.sources);
        }
      }
    }

    for (let [changeType, value] of Object.entries(changes)) {
      if (value.positive !== 0 || value.negative !== 0) {
        let flatTargets = ActorChangesHelper.getChangeFlat(buffTarget, changeType, rollData.system);
        if (flatTargets == null) continue;

        if (!(flatTargets instanceof Array)) flatTargets = [flatTargets];
        for (let target of flatTargets) {
          consolidatedChanges[target] = (consolidatedChanges[target] || 0) + value.positive + value.negative;

          // Apply final rounding of health, if required.
          if (
            ["system.attributes.hp.max", "system.attributes.wounds.max", "system.attributes.vigor.max"].includes(target)
          ) {
            const healthConfig = game.settings.get("warcraftrpg2e", "healthConfig");
            const continuous = { discrete: false, continuous: true }[healthConfig.continuity];
            if (continuous) {
              const round = { up: Math.ceil, nearest: Math.round, down: Math.floor }[healthConfig.rounding];
              consolidatedChanges[target] = round(consolidatedChanges[target]);
            }
          }
          sourceInfo[target] = sourceInfo[target] || { positive: [], negative: [] };
          for (let changeSource of value.sources) {
            if (changeSource.value > 0)
              sourceInfo[target].positive.push({
                name: changeSource.name,
                type: changeSource.type,
                value: changeSource.value,
                bonusType: changeType,
              });
            if (changeSource.value < 0)
              sourceInfo[target].negative.push({
                name: changeSource.name,
                type: changeSource.type,
                value: changeSource.value,
                bonusType: changeType,
              });
          }
        }
      }
    }
    return consolidatedChanges;
  }

  async #resetData(updateData, source, flags, sourceInfo, changes, fullConditions) {
    const data1 = source.system;
    if (flags == null) flags = {};
    const items = source.items;
    const classes = items.filter((obj) => {
      return obj.type === "class";
    });
    const warcraftCasterAdvancement = allocateWarcraftPrestigeCasterLevels(classes);

    const racialHD = classes.filter((o) => foundry.utils.getProperty(o.system, "classType") === "racial");
    const templateHD = classes.filter((o) => foundry.utils.getProperty(o.system, "classType") === "template");
    const useFractionalBaseBonuses = game.settings.get("warcraftrpg2e", "useFractionalBaseBonuses") === true;

    // Reset HD, taking into account race LA
    let raceLA = 0;
    if (this.actor.items != null) {
      try {
        let raceObject = this.actor.items.filter((o) => o.type === "race")[0];
        if (raceObject != null) {
          raceLA = raceObject.system.la || 0;
          linkData(
            source,
            updateData,
            "system.attributes.creatureType",
            foundry.utils.getProperty(raceObject.system, "creatureType") || "humanoid"
          );
        }
        this.actor.items
          .filter((o) => o.type === "class")
          .forEach((c) => {
            raceLA += c.system?.la || 0;
          });
      } catch (e) { }
    }

    // Set creature type
    if (racialHD.length > 0) {
      linkData(
        source,
        updateData,
        "system.attributes.creatureType",
        foundry.utils.getProperty(racialHD[0].system, "creatureType") || source.system.attributes.creatureType
      );
    }
    // Set creature type
    if (templateHD.length > 0) {
      linkData(
        source,
        updateData,
        "system.attributes.creatureType",
        foundry.utils.getProperty(templateHD[0].system, "creatureType") || source.system.attributes.creatureType
      );
    }

    linkData(source, updateData, "system.attributes.hd.total", data1.details.level.value - raceLA);
    //linkData(data, updateData, "system.attributes.hd.racialClass", data1.details.level.value - raceLA);

    let cr = data1.details.cr || 0;
    let crVal = cr;
    if (typeof cr === "string") {
      if (cr.includes("/")) {
        crVal = parseInt(cr.split("/")[0]) / parseInt(cr.split("/")[1]);
      } else crVal = parseFloat(cr);
    }
    linkData(source, updateData, "system.details.cr", crVal < 1 ? crVal.toFixed(2) : Math.floor(crVal));
    linkData(source, updateData, "system.details.totalCr", crVal < 1 ? crVal.toFixed(2) : Math.floor(crVal));

    // Reset abilities
    for (let [a, abl] of Object.entries(data1.abilities)) {
      linkData(source, updateData, `system.abilities.${a}.penalty`, 0);
      if (a === "str" && flags.noStr === true) continue;
      if (a === "str" && flags.zeroStr === true) continue;
      if (a === "dex" && flags.noDex === true) continue;
      if (a === "dex" && flags.zeroDex === true) continue;
      if (a === "con" && flags.noCon === true) continue;
      if (a === "int" && flags.noInt === true) continue;
      if (a === "int" && flags.oneInt === true) continue;
      if (a === "wis" && flags.oneWis === true) continue;
      if (a === "cha" && flags.oneCha === true) continue;
      linkData(source, updateData, `system.abilities.${a}.checkMod`, 0);
      linkData(
        source,
        updateData,
        `system.abilities.${a}.total`,
        abl.value - Math.abs(abl.drain) - Math.abs(abl.damage)
      );
      linkData(
        source,
        updateData,
        `system.abilities.${a}.mod`,
        Math.floor((updateData[`system.abilities.${a}.total`] - 10) / 2)
      );
    }

    // Reset maximum hit points (prefer finite base; else keep finite existing max for create/partial data)
    const hpBaseRaw = foundry.utils.getProperty(source, "system.attributes.hp.base");
    const hpMaxExistingRaw = foundry.utils.getProperty(source, "system.attributes.hp.max");
    const hpBaseNum = Number(hpBaseRaw);
    const hpMaxExistingNum = Number(hpMaxExistingRaw);
    let hpMaxResolved = 0;
    if (Number.isFinite(hpBaseNum)) {
      hpMaxResolved = hpBaseNum;
    } else if (Number.isFinite(hpMaxExistingNum)) {
      hpMaxResolved = hpMaxExistingNum;
    }
    linkData(source, updateData, "system.attributes.hp.max", hpMaxResolved);
    linkData(
      source,
      updateData,
      "system.attributes.wounds.max",
      foundry.utils.getProperty(source, "system.attributes.wounds.base") || 0
    );
    linkData(
      source,
      updateData,
      "system.attributes.vigor.max",
      foundry.utils.getProperty(source, "system.attributes.vigor.base") || 0
    );

    // Reset slot capacities to defaults before changes are applied
    for (const [slotKey, defaultVal] of Object.entries(CONFIG.D35E.defaultSlotCapacities)) {
      linkData(source, updateData, `system.slotCapacities.${slotKey}`, defaultVal);
    }

    // Reset AC
    for (let type of Object.keys(data1.attributes.ac)) {
      linkData(source, updateData, `system.attributes.ac.${type}.total`, 10);
    }

    // Reset attack and damage bonuses
    linkData(source, updateData, "system.attributes.attack.general", 0);
    linkData(source, updateData, "system.attributes.attack.melee", 0);
    linkData(source, updateData, "system.attributes.attack.ranged", 0);
    linkData(source, updateData, "system.attributes.damage.general", 0);
    linkData(source, updateData, "system.attributes.damage.melee", 0);
    linkData(source, updateData, "system.attributes.damage.weapon", 0);
    linkData(source, updateData, "system.attributes.damage.spell", 0);

    linkData(source, updateData, "system.attributes.naturalACTotal", 0);
    linkData(source, updateData, "system.attributes.turnUndeadUsesTotal", 0);
    linkData(source, updateData, "system.attributes.shoutUses.max", 0);
    linkData(source, updateData, "system.attributes.powerPointsTotal", 0);
    linkData(source, updateData, "system.attributes.arcaneSpellFailure", 0);
    linkData(source, updateData, "system.traits.regenTotal", data1.traits.regen);
    linkData(source, updateData, "system.traits.fastHealingTotal", data1.traits.fastHealing);

    let levelUpData = foundry.utils.duplicate(data1.details.levelUpData) || [];
    if (levelUpData.length !== data1.details.level.available) {
      LogHelper.log("ActorPF | Will update actor level");
      while (levelUpData.length < data1.details.level.available) {
        levelUpData.push({
          level: levelUpData.length + 1,
          id: "_" + Math.random().toString(36).substr(2, 9),
          classId: null,
          class: null,
          classImage: null,
          path: null,
          skills: {},
          hp: 0,
          hasFeat: (levelUpData.length + 1) % 3 === 0,
          hasAbility: (levelUpData.length + 1) % 4 === 0,
        });
      }
      while (levelUpData.length > data1.details.level.available) {
        levelUpData.pop();
      }
      await this.actor.updateClassProgressionLevel(source, updateData, data1, levelUpData);
      //LogHelper.log('LevelUpData | ', levelUpData)
      linkData(source, updateData, "system.details.levelUpData", levelUpData);
    }

    let currencyConfig = game.settings.get("warcraftrpg2e", "currencyConfig");
    for (let currency of currencyConfig.currency) {
      if (currency[0])
        if (
          data1.customCurrency === undefined ||
          data1.customCurrency[currency[0]] === undefined
        ) {
          linkData(source, updateData, `system.customCurrency.${currency[0]}`, 0);
        }
    }

    if (data1.attributes.prestigeCl === undefined) {
      linkData(source, updateData, "system.attributes.prestigeCl", {
        psionic: {
          max: 0,
          value: 0,
        },
        arcane: {
          max: 0,
          value: 0,
        },
        divine: {
          max: 0,
          value: 0,
        },
        cards: {
          max: 0,
          value: 0,
        },
      });
    } else {
      for (let type of ["psionic", "arcane", "divine", "cards"]) {
        // parseInt(foundry.utils.getProperty(srcData1, `system.attributes.spells.spellbooks.${spellbookKey}.bonusPrestigeCl`))
        if (data1.attributes.prestigeCl[type] === undefined) {
          linkData(source, updateData, `system.attributes.prestigeCl.${type}`, {
            max: 0,
            value: 0,
          });
        } else {
          linkData(source, updateData, `system.attributes.prestigeCl.${type}.max`, 0);
        }
      }
    }

    for (let a of Object.keys(data1.attributes.savingThrows)) {
      {
        const k = `system.attributes.savingThrows.${a}.total`;
        const j = `system.attributes.savingThrows.${a}.base`;
        let totalLevel = 0;
        let epicLevels = 0;
        // Reset saving throws
        let highStart = false;
        if (useFractionalBaseBonuses) {
          linkData(
            source,
            updateData,
            k,
            Math.floor(
              classes.reduce((cur, obj, idx) => {
                const saveScale = foundry.utils.getProperty(obj, `system.savingThrows.${a}.value`) || "";
                if (saveScale === "high") {
                  const acc = highStart || idx ? 0 : 2;
                  highStart = true;
                  return cur + obj.system.levels / 2 + acc;
                }
                if (saveScale === "low") return cur + obj.system.levels / 3;
                return cur;
              }, 0)
            ) - data1.attributes.energyDrain
          );

          const v = updateData[k];
          if (v !== 0) {
            sourceInfo[k] = sourceInfo[k] || { positive: [], negative: [] };
            sourceInfo[k].positive.push({ name: game.i18n.localize("D35E.Base"), value: updateData[k] });
          }
        } else {
          let epicST = 0;
          let baseST =
            classes.reduce((cur, obj) => {
              const classType = foundry.utils.getProperty(obj.system, "classType") || "base";
              let formula = CONFIG.D35E.classSavingThrowFormulas[classType][obj.system.savingThrows[a].value];
              if (formula == null) formula = "0";
              let classLevel = obj.system.levels;

              // Epic level/total level should only be calculated when taking into account non-racial hd
              if (foundry.utils.getProperty(obj.system, "classType") === "base" || (obj.system, "classType") === "prestige") {
                if (totalLevel + classLevel > 20) {
                  classLevel = 20 - totalLevel;
                  totalLevel = 20;
                  epicLevels += obj.system.levels - classLevel;
                } else {
                  totalLevel = totalLevel + classLevel;
                }
              }
              const v = Math.floor(Roll35e.safeEvaluate(formula, { level: classLevel }).total);

              if (v !== 0) {
                sourceInfo[k] = sourceInfo[k] || { positive: [], negative: [] };
                sourceInfo[k].positive.push({ name: foundry.utils.getProperty(obj, "name"), value: v });
              }

              return cur + v;
            }, 0) - data1.attributes.energyDrain;

          if (epicLevels > 0) {
            epicST = Roll35e.safeEvaluate("floor(@level/2)", { level: epicLevels }).total;
            sourceInfo[k] = sourceInfo[k] || { positive: [], negative: [] };
            sourceInfo[k].positive.push({ name: "Epic Levels", value: epicST });
          }
          linkData(source, updateData, k, baseST + epicST);
          linkData(source, updateData, j, baseST + epicST);
        }
      }
    }

    // Reset ACP and Max Dex bonus
    linkData(source, updateData, "system.attributes.acp.gear", 0);
    linkData(source, updateData, "system.attributes.maxDexBonus", null);
    linkData(source, updateData, "system.attributes.maxDex.gear", null);
    linkData(source, updateData, "system.attributes.runSpeedMultiplierModifier", 0);
    linkData(source, updateData, "system.attributes.speedMultiplier", 0.0);

    linkData(source, updateData, "system.attributes.fortification.total", data1.attributes.fortification?.value || 0);
    linkData(source, updateData, "system.attributes.concealment.total", data1.attributes.concealment?.value || 0);
    items
      .filter((obj) => {
        return obj.type === "equipment" && obj.system.equipped && !obj.system.melded && !obj.broken;
      })
      .forEach((obj) => {
        let itemAcp = Math.abs(obj.system.armor.acp);
        if (obj.system.masterwork) itemAcp = Math.max(0, itemAcp - 1);
        linkData(source, updateData, "system.attributes.acp.gear", updateData["system.attributes.acp.gear"] + itemAcp);
        let test = foundry.utils.getProperty(obj.system, "armor.dex");
        if (foundry.utils.getProperty(obj.system, "armor.dex") !== null && foundry.utils.getProperty(obj.system, "armor.dex") !== "") {
          if (updateData["system.attributes.maxDexBonus"] == null) {
            linkData(source, updateData, "system.attributes.maxDexBonus", Math.abs(obj.system.armor.dex));
            linkData(source, updateData, "system.attributes.maxDex.gear", Math.abs(obj.system.armor.dex));
          } else {
            linkData(
              source,
              updateData,
              "system.attributes.maxDexBonus",
              Math.min(updateData["system.attributes.maxDexBonus"], Math.abs(obj.system.armor.dex))
            );
            linkData(
              source,
              updateData,
              "system.attributes.maxDex.gear",
              Math.min(updateData["system.attributes.maxDexBonus"], Math.abs(obj.system.armor.dex))
            );
          }
        }
      });

    let naturalAttackCount = (items || []).filter(
      (o) => o.type === "attack" && o.system.attackType === "natural"
    )?.length;
    flags.naturalAttackCount = naturalAttackCount;

    // Reset specific skill bonuses
    for (let sklKey of ActorChangesHelper.getChangeFlat("skills", "", this.actor.system)) {
      if (foundry.utils.hasProperty(source, sklKey)) linkData(source, updateData, sklKey, 0);
    }

    // Reset movement speed
    for (let speedKey of Object.keys(foundry.utils.getProperty(this.actor.system, "attributes.speed"))) {
      let base = foundry.utils.getProperty(source, `system.attributes.speed.${speedKey}.base`);
      linkData(source, updateData, `system.attributes.speed.${speedKey}.total`, base || 0);
      linkData(source, updateData, `system.attributes.speed.${speedKey}.cap`, (base || 0) * 2 || null);
      linkData(source, updateData, `system.attributes.speed.${speedKey}.isOvercap`, false);
      linkData(source, updateData, `system.attributes.speed.${speedKey}.effectiveBase`, base || 0);
    }

    // Reset BAB, CMB and CMD
    {
      const totalBab = "system.attributes.bab.total";
      const nonEpicBab = "system.attributes.bab.nonepic";
      const epicBab = "system.attributes.bab.epic";
      const baseBab = "system.attributes.bab.base";
      let totalLevel = 0;
      let epicLevels = 0;
      if (useFractionalBaseBonuses) {
        const bab = Math.floor(
          classes.reduce((cur, obj) => {
            const babScale = foundry.utils.getProperty(obj.system, "bab") || "";
            if (babScale === "high") return cur + Math.min(obj.system.levels, 20);
            if (babScale === "med") return cur + Math.min(obj.system.levels, 20) * 0.75;
            if (babScale === "low") return cur + Math.min(obj.system.levels, 20) * 0.5;
            return cur;
          }, 0)
        )
        const epicBab = Math.floor(
          classes.reduce((cur, obj) => {
            const babScale = foundry.utils.getProperty(obj.system, "bab") || "";
            if (babScale === "high") return cur + Math.max(obj.system.levels - 20, 0);
            if (babScale === "med") return cur + Math.max(obj.system.levels - 20, 0) * 0.75;
            if (babScale === "low") return cur + Math.max(obj.system.levels - 20, 0) * 0.5;
            return cur;
          }, 0)
        )
        linkData(
          source,
          updateData,
          totalBab,
          bab + epicBab
        );

        linkData(source, updateData, nonEpicBab, bab);
        linkData(source, updateData, baseBab, bab + epicBab);

        const v = updateData[totalBab];
        if (v !== 0) {
          sourceInfo[totalBab] = sourceInfo[totalBab] || { positive: [], negative: [] };
          sourceInfo[totalBab].positive.push({ name: game.i18n.localize("D35E.Base"), value: v });
        }
      } else {
        let epicBab = 0;
        let bab = classes.reduce((cur, obj) => {
          const formula =
            CONFIG.D35E.classBABFormulas[obj.system.bab] != null ? CONFIG.D35E.classBABFormulas[obj.system.bab] : "0";
          let classLevel = obj.system.levels;

          // Epic level/total level should only be calculated when taking into account non-racial hd
          if (foundry.utils.getProperty(obj.system, "classType") === "base" || (obj.system, "classType") === "prestige") {
            if (totalLevel + classLevel > 20) {
              classLevel = 20 - totalLevel;
              totalLevel = 20;
              epicLevels += obj.system.levels - classLevel;
            } else {
              totalLevel = totalLevel + classLevel;
            }
          }
          const v = new Roll35e(formula, { level: classLevel }).evaluateSync().total;

          if (v !== 0) {
            sourceInfo[totalBab] = sourceInfo[totalBab] || { positive: [], negative: [] };
            sourceInfo[totalBab].positive.push({ name: foundry.utils.getProperty(obj, "name"), value: v });
          }

          return cur + v;
        }, 0);
        if (epicLevels > 0) {
          epicBab = new Roll35e("ceil(@level/2)", { level: epicLevels }).evaluateSync().total;
          sourceInfo[totalBab] = sourceInfo[totalBab] || { positive: [], negative: [] };
          sourceInfo[totalBab].positive.push({ name: "Epic Levels", value: epicBab });
        }
        linkData(source, updateData, totalBab, bab + epicBab);
        linkData(source, updateData, nonEpicBab, bab);
        linkData(source, updateData, baseBab, bab + epicBab);
      }
    }

    // Turn undead total level
    {
      const k = "system.attributes.turnUndeadHdTotal";
      linkData(
        source,
        updateData,
        k,
        classes.reduce((cur, obj) => {
          try {
            if (!obj.system.turnUndeadLevelFormula) return cur;
            const v = new Roll35e(obj.system.turnUndeadLevelFormula, { level: obj.system.levels }).evaluateSync().total;

            if (v !== 0) {
              sourceInfo[k] = sourceInfo[k] || { positive: [], negative: [] };
              sourceInfo[k].positive.push({ name: foundry.utils.getProperty(obj, "name"), value: v });
            }

            return cur + v;
          } catch (e) {
            return cur;
          }
        }, 0)
      );
    }

    {
      const k = "system.attributes.sr.total";
      // Set spell resistance
      if (foundry.utils.getProperty(source, `system.attributes.sr.formula`).length > 0) {
        let roll = new Roll35e(foundry.utils.getProperty(source, `system.attributes.sr.formula`), source.system).evaluateSync();
        linkData(source, updateData, k, roll.total);
      } else {
        linkData(source, updateData, k, 0);
      }
    }
    {
      const k = "system.attributes.hardness.total";
      // Set spell resistance
      if (foundry.utils.getProperty(source, `system.attributes.hardness.formula`).length > 0) {
        let roll = new Roll35e(foundry.utils.getProperty(source, `system.attributes.hardness.formula`), source.system).evaluateSync();
        linkData(source, updateData, k, roll.total);
      } else {
        linkData(source, updateData, k, 0);
      }
    }
    {
      const k = "system.details.breakDC.total";
      linkData(source, updateData, k, parseInt(foundry.utils.getProperty(source, `system.details.breakDC.base`) || "0"));
    }

    {
      const k = "system.attributes.pr.total";
      // Set spell resistance
      if (game.settings.get("warcraftrpg2e", "psionicsAreDifferent")) {
        if (foundry.utils.getProperty(source, `system.attributes.pr.formula`)?.length > 0) {
          let roll = new Roll35e(foundry.utils.getProperty(source, `system.attributes.pr.formula`), source.system).evaluateSync();
          linkData(source, updateData, k, roll.total);
        } else {
          linkData(source, updateData, k, 0);
        }
      } else {
        linkData(source, updateData, k, 0);
      }
    }

    // Total sneak attak dice
    {
      const k = "system.attributes.sneakAttackDiceTotal";
      let totalSneakAttakDice = 0;
      let groupLevels = new Map();
      let groupFormulas = new Map();
      classes.forEach((obj) => {
        try {
          if (obj.system.sneakAttackGroup == null || obj.system.sneakAttackGroup === "") return;
          if (!groupLevels.has(obj.system.sneakAttackGroup)) {
            groupLevels.set(obj.system.sneakAttackGroup, 0);
          }
          if (!groupFormulas.has(obj.system.sneakAttackGroup)) {
            groupFormulas.set(obj.system.sneakAttackGroup, obj.system.sneakAttackFormula);
          }
          groupLevels.set(
            obj.system.sneakAttackGroup,
            groupLevels.get(obj.system.sneakAttackGroup) + obj.system.levels
          );
        } catch (e) { }
      });
      for (var key of groupLevels.keys()) {
        const v = new Roll35e(groupFormulas.get(key), { level: groupLevels.get(key) }).evaluateSync().total;

        if (v !== 0) {
          sourceInfo[k] = sourceInfo[k] || { positive: [], negative: [] };
          sourceInfo[k].positive.push({ name: key, value: v });
        }
        totalSneakAttakDice = totalSneakAttakDice + v;
      }
      linkData(source, updateData, k, totalSneakAttakDice);
    }

    // Base attacks of opportunity per round (always 1; Combat Reflexes adds Dex mod via changes)
    {
      const k = "system.attributes.maxAoO";
      sourceInfo[k] = { positive: [{ name: game.i18n.localize("D35E.Base"), value: 1 }], negative: [] };
      linkData(source, updateData, k, 1);
    }

    // Total sneak attak dice
    {
      const k = "system.attributes.minionClassLevels";
      let groupLevels = new Map();
      let groupFormulas = new Map();
      let minionLevels = {};

      for (var key of Object.keys(source.system.attributes.minionClassLevels || {})) {
        minionLevels[key.toLowerCase()] = 0;
      }
      classes.forEach((obj) => {
        try {
          if (obj.system.minionGroup == null || obj.system.minionGroup === "") return;
          let minionGroup = obj.system.minionGroup.toLowerCase();
          if (!groupLevels.has(minionGroup)) {
            groupLevels.set(minionGroup, 0);
          }
          if (!groupFormulas.has(minionGroup)) {
            groupFormulas.set(minionGroup, obj.system.minionLevelFormula);
          }
          groupLevels.set(minionGroup, groupLevels.get(minionGroup) + obj.system.levels);
        } catch (e) { }
      });
      for (var key of groupLevels.keys()) {
        const v = new Roll35e(groupFormulas.get(key), { level: groupLevels.get(key) }).evaluateSync().total;
        minionLevels[key.toLowerCase()] = v;
      }
      linkData(source, updateData, k, minionLevels);
    }

    // Reset spell slots
    for (let spellbookKey of Object.keys(foundry.utils.getProperty(source, "system.attributes.spells.spellbooks"))) {
      const spellbookClass = foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.class`);
      const automaticCasterLevels = warcraftCasterAdvancement.slotByClass[spellbookClass] || 0;
      const manualPrestigeCasterLevels =
        parseInt(foundry.utils.getProperty(source, `system.attributes.spells.spellbooks.${spellbookKey}.bonusPrestigeCl`)) || 0;
      let classLevel =
        (foundry.utils.getProperty(source, `system.classes.${spellbookClass}.level`) || 0) +
        (automaticCasterLevels > 0 ? automaticCasterLevels : manualPrestigeCasterLevels);
      if (classLevel > foundry.utils.getProperty(source, `system.classes.${spellbookClass}.maxLevel`))
        classLevel = foundry.utils.getProperty(source, `system.classes.${spellbookClass}.maxLevel`);
      const classProgression = foundry.utils.getProperty(source, `system.classes.${spellbookClass}.spellPerLevel${classLevel}`);
      linkData(source, updateData, `system.attributes.spells.spellbooks.${spellbookKey}.spellcastingAbilityBonus`, 0);
      for (let a = 0; a < 10; a++) {
        linkData(source, updateData, `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.bonus`, 0);
        const classBase = classProgression !== undefined ? parseInt(classProgression[a + 1]) : -1;
        if (classBase >= 0) {
          const value = classBase;
          linkData(
            source,
            updateData,
            `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.classBase`,
            value
          );
        } else {
          linkData(
            source,
            updateData,
            `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${a}.classBase`,
            0
          );
        }
      }
    }

    linkData(
      source,
      updateData,
      "system.attributes.cmb.total",
      updateData["system.attributes.bab.total"] - data1.attributes.energyDrain
    );
    linkData(
      source,
      updateData,
      "system.attributes.cmd.total",
      10 + updateData["system.attributes.bab.total"] - data1.attributes.energyDrain
    );
    linkData(
      source,
      updateData,
      "system.attributes.cmd.flatFootedTotal",
      10 + updateData["system.attributes.bab.total"] - data1.attributes.energyDrain
    );

    // Reset initiative
    linkData(source, updateData, "system.attributes.init.total", 0);

    //Set flags on actor so they are accessible

    for (let flagKey of Object.keys(flags)) {
      linkData(source, updateData, `flags.warcraftrpg2e.${flagKey}`, flags[flagKey]);
    }

    // Reset class skills
    for (let [k, s] of Object.entries(foundry.utils.getProperty(source, "system.skills"))) {
      if (!s) continue;
      const isClassSkill = classes.reduce((cur, o) => {
        if ((foundry.utils.getProperty(o.system, "classSkills") || {})[k] === true) return true;
        return cur;
      }, false);
      linkData(source, updateData, `system.skills.${k}.cs`, isClassSkill);
      for (let k2 of Object.keys(foundry.utils.getProperty(s, "subSkills") || {})) {
        if (k2.indexOf("-=") !== -1) continue;
        linkData(source, updateData, `system.skills.${k}.subSkills.${k2}.cs`, isClassSkill);
      }
    }
    if (this.actor.isCharacterType) {
      let level = classes.reduce((cur, o) => {
        if (o.system.classType === "minion" || o.system.classType === "template") return cur;
        return cur + o.system.levels;
      }, 0);

      //LogHelper.log(`Setting attributes hd total | ${level}`)
      linkData(source, updateData, "system.attributes.hd.total", level);

      const racialClassLevels = classes
        .filter((item) => item.system.classType === "racial")
        .reduce((sum, item) => sum + Number(item.system.levels || 0), 0);
      linkData(source, updateData, "system.attributes.hd.racialClass", racialClassLevels);

      let templateClassesToUpdate = [];
      for (const templateClass of classes.filter((o) => foundry.utils.getProperty(o.system, "classType") === "template")) {
        if (!!templateClass) {
          if (templateClass.system.levels === level) continue;
          let updateObject = {};
          updateObject["id"] = templateClass.id;
          updateObject["system.levels"] = level;
          templateClassesToUpdate.push(updateObject);
        }
      }
      if (templateClassesToUpdate.length && !this.actor.token) {
        await this.actor.updateEmbeddedDocuments('Item', templateClassesToUpdate, { stopUpdates: true, massUpdate: true });
      }

      level += raceLA;
      let existingAbilities = new Set();
      let classInfos = [];
      let addedAbilities = new Set();
      let itemsWithUid = new Map();
      let itemsToAdd = [];
      let itemsToRemove = [];
      for (let i of this.actor.items.values()) {
        // Only class/race-managed features participate in automatic pruning.
        // User-selected feats and other compendium items also have unique IDs,
        // but are intentionally removable and must survive actor refreshes.
        if (!i.system.userNonRemovable) continue;
        if (!i.system.hasOwnProperty("uniqueId")) continue;
        if (i.system.uniqueId === null) continue;
        if (i.system.uniqueId === "") continue;
        existingAbilities.add(i.system.uniqueId);
        itemsWithUid.set(i.system.uniqueId, i.id);
      }

      //LogHelper.log('Adding Features', level, data, foundry.utils.getProperty(this.actor.system,"classLevels"), updateData)

      if (true) {
        linkData(source, updateData, "system.details.level.value", level);
        let classes = this.actor.items
          .filter((o) => o.type === "class" && o.system.classType !== "template" && o.system.automaticFeatures)
          .sort((a, b) => {
            return a.sort - b.sort;
          });

        for (let i of classes) {
          // Class items created or edited outside the level-up dialog may not
          // have row history yet. Use the same deterministic default-path repair
          // as actor preparation so threshold features cannot lag behind the
          // prepared parent/path state.
          const classPathState = deriveDirectClassPathState(i.system);
          classInfos.push({
            name: i.name,
            levels: i.system.levels,
            addedAbilities: i.system.addedAbilities || [],
            disabledAbilities: i.system.disabledAbilities || [],
            customTag: i.system.customTag,
            system: {
              ...i.system,
              classPaths: classPathState.classPaths,
              pathLevels: classPathState.pathLevels,
              currentPath: classPathState.currentPath,
            },
          });
        }

        let itemPack = game.packs.get("warcraftrpg2e.class-abilities");
        let items = [];
        await itemPack.getIndex().then((index) => (items = index));

        for (const classInfo of classInfos) {
          //LogHelper.log('Adding Features', classInfo)
          let added = false;
          for (let feature of classInfo.addedAbilities) {
            LogHelper.log("Adding Features", feature);
            let e = CACHE.AllAbilities.get(feature.uid);
            const level = parseInt(feature.level);
            let uniqueId = e?.system?.uniqueId;
            if (!uniqueId) {
              ui.notifications.warn(game.i18n.localize("D35E.NotAddingAbilityWithNoUID").replace("{0}", feature.uid));
              continue;
            }
            if (uniqueId.endsWith("*")) {
              const progression = getWarcraftFeatureProgression(e.system, classInfo.system, classInfo.name);
              uniqueId = uniqueId.replace("*", `${classInfo.name}-${progression.path || "class"}-${level}`);
            }
            await this.#addClassFeatureToActorIfPossible(
              addedAbilities,
              uniqueId,
              level,
              classInfo,
              existingAbilities,
              e,
              fullConditions,
              changes,
              itemsToAdd,
              added
            );
          }
          for (let e of CACHE.ClassFeatures.get(classInfo.name) || []) {
            //LogHelper.log('Adding Features', e)
            if (e.system.associations === undefined || e.system.associations.classes === undefined) continue;
            let levels = e.system.associations.classes.filter((el) => el[0] === classInfo.name);
            for (let _level of levels) {
              const level = _level[1];
              let uniqueId = e.system.uniqueId;
              if (uniqueId.endsWith("*")) {
                const progression = getWarcraftFeatureProgression(e.system, classInfo.system, classInfo.name);
                uniqueId = uniqueId.replace("*", `${classInfo.name}-${progression.path || "class"}-${level}`);
              }
              if ((classInfo.disabledAbilities || []).some((a) => a.uid === uniqueId && parseInt(level) === parseInt(a.level)))
                continue;
              await this.#addClassFeatureToActorIfPossible(
                addedAbilities,
                uniqueId,
                level,
                classInfo,
                existingAbilities,
                e,
                fullConditions,
                changes,
                itemsToAdd,
                added
              );
            }
          }
        }
      }
      {
        // Racial items

        let raceObject = this.actor.items.filter((o) => o.type === "race")[0];
        if (raceObject) {
          for (let feature of raceObject.system.addedAbilities || []) {
            let e = CACHE.AllAbilities.get(feature.uid);
            let uniqueId = e?.system?.uniqueId;
            if (!uniqueId || uniqueId === "") {
              ui.notifications.warn(
                game.i18n.localize("D35E.NotAddingAbilityWithNoUID").format(e?.name || "[Ability not found]")
              );
              continue;
            }
            if (uniqueId.endsWith("*")) {
              ui.notifications.warn(game.i18n.localize("D35E.NotAddingAbilityWithStarUIDRace").format(e.name));
              continue;
            }
            let canAdd = !addedAbilities.has(uniqueId);
            if (canAdd) {
              if (!existingAbilities.has(uniqueId)) {
                let eItem = e.toObject();
                await Item35E.setMaxUses(eItem, this.actor.getRollData());
                delete eItem._id;
                eItem.system.uniqueId = uniqueId;
                eItem.system.source = `${raceObject.name}`;
                eItem.system.addedLevel = 1;
                eItem.system.userNonRemovable = true;
                if (e.type === "spell") {
                  eItem.system.spellbook = "spelllike";
                  eItem.system.level = 0;
                }
                (eItem.system.changes || []).forEach((change) => {
                  if (!this.#isChangeAllowed(eItem, change, fullConditions)) return;
                  changes.push({
                    raw: change,
                    source: {
                      value: 0,
                      type: eItem.type,
                      subtype: this.#getChangeItemSubtype(eItem),
                      name: eItem.name,
                      item: eItem,
                      itemRollData: new Item35E(eItem, { owner: this.actor.isOwner }).getRollData(),
                    },
                  });
                });
                itemsToAdd.push(eItem);
              }
              addedAbilities.add(uniqueId);
            }
          }

          for (let e of CACHE.RacialFeatures.get(raceObject.name) || []) {
            let uniqueId = e.system.uniqueId;
            if (uniqueId.endsWith("*")) {
              uniqueId = uniqueId.replace("*", `${raceObject.name}-race-1`);
            }

            if (!uniqueId || uniqueId === "") {
              ui.notifications.warn(game.i18n.localize("D35E.NotAddingAbilityWithNoUID").format(e.name));
              continue;
            }
            if ((raceObject.system.disabledAbilities || []).some((a) => a.uid === uniqueId)) continue;
            let canAdd = !addedAbilities.has(uniqueId);
            if (canAdd) {
              if (!existingAbilities.has(uniqueId)) {
                let eItem = e.toObject();
                await Item35E.setMaxUses(eItem, this.actor.getRollData());
                eItem.system.uniqueId = uniqueId;
                eItem.system.source = `${raceObject.name}`;
                eItem.system.addedLevel = 1;
                eItem.system.userNonRemovable = true;
                if (e.type === "spell") {
                  eItem.system.spellbook = "spelllike";
                  eItem.system.level = 0;
                }
                (eItem.system.changes || []).forEach((change) => {
                  if (!this.#isChangeAllowed(eItem, change, fullConditions)) return;
                  changes.push({
                    raw: change,
                    source: {
                      value: 0,
                      type: eItem.type,
                      subtype: this.#getChangeItemSubtype(eItem),
                      name: eItem.name,
                      item: eItem,
                      itemRollData: new Item35E(eItem, { owner: this.actor.isOwner }).getRollData(),
                    },
                  });
                });
                itemsToAdd.push(eItem);
              }
              addedAbilities.add(uniqueId);
            }
          }
        }
      }

      for (let abilityUid of existingAbilities) {
        if (!addedAbilities.has(abilityUid)) {
          //LogHelper.log(`Removing existing ability ${abilityUid}`, changes)
          const changeIndex = changes.findIndex((change) => change.source?.item?.uniqueId === abilityUid);
          if (changeIndex >= 0) changes.splice(changeIndex, 1);
          itemsToRemove.push(abilityUid);
        }
      }
      let idsToRemove = [];
      for (let entry of itemsToRemove) {
        idsToRemove.push(itemsWithUid.get(entry));
      }
      if (idsToRemove.length) await this.actor.deleteEmbeddedDocuments("Item", idsToRemove, { stopUpdates: true });
      //LogHelper.log('D35E Items To Add', JSON.stringify(itemsToAdd))
      if (itemsToAdd.length)
        await this.actor.createEmbeddedDocuments("Item", itemsToAdd, { stopUpdates: true, ignoreSpellbookAndLevel: true });
    }
  }

  async #addClassFeatureToActorIfPossible(
    addedAbilities,
    uniqueId,
    level,
    classInfo,
    existingAbilities,
    e,
    fullConditions,
    changes,
    itemsToAdd,
    added
  ) {
    //LogHelper.log('Adding Features', addedAbilities)
    let canAdd = !addedAbilities.has(uniqueId);
    if (canAdd) {
      const progression = getWarcraftFeatureProgression(e.system, classInfo.system, classInfo.name);
      if (!progression.incompatible && level <= progression.level) {
        if (!existingAbilities.has(uniqueId)) {
          let eItem = e.toObject();
          await Item35E.setMaxUses(eItem, this.actor.getRollData());
          eItem.system.uniqueId = uniqueId;
          delete eItem._id;
          eItem.system.source = `${classInfo.name}${progression.path ? ` (${progression.path})` : ""} ${level}`;
          eItem.system.addedLevel = level;
          eItem.system.userNonRemovable = true;
          if (e.type === "spell") {
            eItem.system.spellbook = "spelllike";
            eItem.system.level = 0;
          }
          (eItem.system.changes || []).forEach((change) => {
            if (!this.#isChangeAllowed(eItem, change, fullConditions)) return;
            changes.push({
              raw: change,
              source: {
                value: 0,
                type: eItem.type,
                subtype: this.#getChangeItemSubtype(eItem),
                name: eItem.name,
                item: eItem,
              },
            });
          });
          itemsToAdd.push(eItem);
        }
        addedAbilities.add(uniqueId);
        added = true;
      }
    }
  }

  #addDynamicData(updateData, changes, flags, abilities, source, forceModUpdate = false, changeTarget = null) {
    if (changes == null) changes = {};

    const prevMods = {};
    const modDiffs = {};
    // Reset ability modifiers
    for (let a of abilities) {
      prevMods[a] = forceModUpdate ? 0 : updateData[`system.abilities.${a}.mod`];
      if (
        (a === "str" && flags.noStr) ||
        (a === "str" && flags.zeroStr) ||
        (a === "dex" && flags.noDex) ||
        (a === "dex" && flags.zeroDex) ||
        (a === "con" && flags.noCon) ||
        (a === "int" && flags.noInt) ||
        (a === "int" && flags.oneInt) ||
        (a === "wis" && flags.oneWis) ||
        (a === "cha" && flags.oneCha)
      ) {
        modDiffs[a] = forceModUpdate ? 0 : 0;
        if (changes[`system.abilities.${a}.total`]) delete changes[`system.abilities.${a}.total`]; // Remove used mods to prevent doubling
        continue;
      }
      const ablPenalty =
        Math.abs(updateData[`system.abilities.${a}.penalty`] || 0) +
        (updateData[`system.abilities.${a}.userPenalty`] || 0);
      if (changes[`system.abilities.${a}.replace`]) {
        linkData(
          source,
          updateData,
          `system.abilities.${a}.total`,
          changes[`system.abilities.${a}.replace`] + (changes[`system.abilities.${a}.total`] || 0)
        );
        linkData(
          source,
          updateData,
          `system.abilities.${a}.origTotal`,
          updateData[`system.abilities.${a}.total`] + (changes[`system.abilities.${a}.total`] || 0)
        );
      } else {
        linkData(
          source,
          updateData,
          `system.abilities.${a}.total`,
          updateData[`system.abilities.${a}.total`] + (changes[`system.abilities.${a}.total`] || 0)
        );
        linkData(source, updateData, `system.abilities.${a}.origTotal`, updateData[`system.abilities.${a}.total`]);
      }
      if (changes[`system.abilities.${a}.total`]) delete changes[`system.abilities.${a}.total`]; // Remove used mods to prevent doubling
      if (changes[`system.abilities.${a}.replace`]) delete changes[`system.abilities.${a}.replace`]; // Remove used mods to prevent doubling
      linkData(
        source,
        updateData,
        `system.abilities.${a}.mod`,
        Math.floor((updateData[`system.abilities.${a}.total`] - ablPenalty - 10) / 2)
      );
      linkData(source, updateData, `system.abilities.${a}.mod`, Math.max(-5, updateData[`system.abilities.${a}.mod`]));
      linkData(
        source,
        updateData,
        `system.abilities.${a}.origMod`,
        Math.floor((updateData[`system.abilities.${a}.origTotal`] - ablPenalty - 10) / 2)
      );
      linkData(
        source,
        updateData,
        `system.abilities.${a}.origMod`,
        Math.max(-5, updateData[`system.abilities.${a}.origMod`])
      );
      linkData(
        source,
        updateData,
        `system.abilities.${a}.drain`,
        updateData[`system.abilities.${a}.drain`] + (changes[`system.abilities.${a}.drain`] || 0)
      );
      modDiffs[a] = updateData[`system.abilities.${a}.mod`] - prevMods[a];
    }

    // Update encumbrance
    if (this.#changeAffects("encumbrance", changeTarget) || forceModUpdate)
      this.#computeEncumbrance(updateData, source);

    const encLevel = updateData["system.attributes.encumbrance.level"] ?? source.system.attributes.encumbrance.level;
    switch (encLevel) {
      case 0:
        linkData(source, updateData, "system.attributes.acp.encumbrance", 0);
        linkData(source, updateData, "system.attributes.maxDex.encumbrance", Number.POSITIVE_INFINITY);
        break;
      case 1:
        linkData(source, updateData, "system.attributes.acp.encumbrance", 3);
        linkData(source, updateData, "system.attributes.maxDex.encumbrance", 3);
        break;
      case 2:
        linkData(source, updateData, "system.attributes.acp.encumbrance", 6);
        linkData(source, updateData, "system.attributes.maxDex.encumbrance", 1);
        break;
    }
    linkData(
      source,
      updateData,
      "system.attributes.acp.total",
      Math.max(updateData["system.attributes.acp.gear"], updateData["system.attributes.acp.encumbrance"])
    );
    linkData(
      source,
      updateData,
      "system.attributes.maxDex.total",
      Math.min(
        updateData["system.attributes.maxDex.gear"] == null ? 999 : updateData["system.attributes.maxDex.gear"],
        updateData["system.attributes.maxDex.encumbrance"] || 999
      )
    );
    linkData(
      source,
      updateData,
      "system.attributes.maxDexBonus",
      Math.min(
        updateData["system.attributes.maxDex.gear"] == null ? 999 : updateData["system.attributes.maxDex.gear"],
        updateData["system.attributes.maxDex.encumbrance"] || 999
      )
    );

    // Replace speed — sets base value and cap, enhancements stack on top
    for (let speedKey of Object.keys(foundry.utils.getProperty(this.actor.system, "attributes.speed"))) {
      if (changes[`system.attributes.speed.${speedKey}.basereplace`]) {
        const br = changes[`system.attributes.speed.${speedKey}.basereplace`];
        linkData(source, updateData, `system.attributes.speed.${speedKey}.total`, br);
        linkData(source, updateData, `system.attributes.speed.${speedKey}.cap`, br * 2);
        linkData(source, updateData, `system.attributes.speed.${speedKey}.effectiveBase`, br);
      }
    }
    if (changes[`system.attributes.bab.basereplace`]) {
      linkData(source, updateData, `system.attributes.bab.total`, changes[`system.attributes.bab.basereplace`]);
      linkData(source, updateData, `system.attributes.bab.nonepic`, changes[`system.attributes.bab.basereplace`]);
      linkData(source, updateData, `system.attributes.cmb.total`, changes[`system.attributes.bab.basereplace`]);
    }

    // Add ability mods to CMB and CMD
    const cmbMod =
      Object.keys(CONFIG.D35E.actorSizes).indexOf(foundry.utils.getProperty(source, "system.traits.size") || "") <=
        Object.keys(CONFIG.D35E.actorSizes).indexOf("tiny")
        ? modDiffs["str"]
        : modDiffs["str"];
    linkData(source, updateData, "system.attributes.cmb.total", updateData["system.attributes.cmb.total"] + cmbMod);
    linkData(
      source,
      updateData,
      "system.attributes.cmd.total",
      updateData["system.attributes.cmd.total"] + modDiffs["str"]
    );
    if (!flags.loseDexToAC || modDiffs["dex"] < 0) {
      linkData(
        source,
        updateData,
        "system.attributes.cmd.total",
        updateData["system.attributes.cmd.total"] + modDiffs["dex"]
      );
      linkData(
        source,
        updateData,
        "system.attributes.cmd.flatFootedTotal",
        updateData["system.attributes.cmd.flatFootedTotal"] + Math.min(0, modDiffs["dex"])
      );
    }
    linkData(
      source,
      updateData,
      "system.attributes.cmd.flatFootedTotal",
      updateData["system.attributes.cmd.flatFootedTotal"] + modDiffs["str"]
    );

    // Add dex mod to initiative
    linkData(
      source,
      updateData,
      "system.attributes.init.total",
      updateData["system.attributes.init.total"] + modDiffs["dex"]
    );

    // Add ability mods to saving throws
    for (let [s, a] of Object.entries(CONFIG.D35E.savingThrowMods)) {
      linkData(
        source,
        updateData,
        `system.attributes.savingThrows.${s}.total`,
        updateData[`system.attributes.savingThrows.${s}.total`] + modDiffs[a]
      );
    }
    // Apply changes
    for (let [changeTarget, value] of Object.entries(changes)) {
      // Skip .basereplace accumulation — enforced in dedicated block, not additive.
      // .replace is NOT filtered here — it serves as a transient flag in updateData
      // to guard subsequent allSpeeds additions (see replace block below).
      if (changeTarget.startsWith("system.attributes.speed.") && changeTarget.endsWith('.basereplace')) continue;
      // Skip .total additions for speeds already force-replaced
      if (changeTarget.startsWith("system.attributes.speed.") && changeTarget.endsWith('.total')) {
        const replacePath = changeTarget.replace('.total', '.replace');
        if (updateData[replacePath]) continue;
      }
      linkData(source, updateData, changeTarget, (updateData[changeTarget] || 0) + value);
    }

    // Force hard replace — absolute value, no stacking
    for (let speedKey of Object.keys(foundry.utils.getProperty(this.actor.system, "attributes.speed"))) {
      if (changes[`system.attributes.speed.${speedKey}.replace`]) {
        linkData(source, updateData, `system.attributes.speed.${speedKey}.total`, changes[`system.attributes.speed.${speedKey}.replace`]);
        updateData[`system.attributes.speed.${speedKey}.replace`] = true;
      }
    }

    // Enforce speed caps (SRD: twice normal speed)
    for (let speedKey of Object.keys(foundry.utils.getProperty(this.actor.system, "attributes.speed"))) {
      const capPath  = `system.attributes.speed.${speedKey}.cap`;
      const cap = updateData[capPath];
      if (cap) {
        const totalPath = `system.attributes.speed.${speedKey}.total`;
        const total = updateData[totalPath];
      if (total > cap) {
        linkData(source, updateData, totalPath, cap);
        linkData(source, updateData, `system.attributes.speed.${speedKey}.isOvercap`, true);
      }
      }
    }
    if (changes[`system.attributes.bab.replace`]) {
      linkData(source, updateData, `system.attributes.bab.total`, changes[`system.attributes.bab.replace`]);
      linkData(source, updateData, `system.attributes.bab.nonepic`, changes[`system.attributes.bab.replace`]);
      linkData(source, updateData, `system.attributes.cmb.total`, changes[`system.attributes.bab.replace`]);
    }
    if (changes[`system.attributes.savingThrows.fort.replace`]) {
      linkData(source, updateData, `system.attributes.savingThrows.fort.total`, changes[`system.attributes.savingThrows.fort.replace`]);
    }
    if (changes[`system.attributes.savingThrows.ref.replace`]) {
      linkData(source, updateData, `system.attributes.savingThrows.ref.total`, changes[`system.attributes.savingThrows.ref.replace`]);
    }
    if (changes[`system.attributes.savingThrows.will.replace`]) {
      linkData(source, updateData, `system.attributes.savingThrows.will.total`, changes[`system.attributes.savingThrows.will.replace`]);
    }
    if (changes["system.attributes.ac.flatFooted.replace"]) {
      linkData(source, updateData, "system.attributes.ac.flatFooted.total", changes["system.attributes.ac.flatFooted.replace"]);
    }
    if (changes["system.attributes.ac.touch.replace"]) {
      linkData(source, updateData, "system.attributes.ac.touch.total", changes["system.attributes.ac.touch.replace"]);
    }
    if (changes["system.attributes.ac.normal.replace"]) {
      linkData(source, updateData, "system.attributes.ac.normal.total", changes["system.attributes.ac.normal.replace"]);
    }
    if (changes[`system.attributes.hp.replace`])
      linkData(source, updateData, `system.attributes.hp.max`, changes[`system.attributes.hp.replace`]);

    this.#updateSkills(updateData, source);
  }

  #changeAffects(field, changeTarget) {
    switch (field) {
      case "encumbrance":
        if (changeTarget === "str") return true;
    }
    return false;
  }

  #updateSkills(updateData, data) {
    const systemData = data.system;
    let energyDrainPenalty = Math.abs(systemData.attributes.energyDrain);
    for (let [sklKey, skl] of Object.entries(systemData.skills)) {
      if (skl === null) {
        delete systemData.skills[sklKey];
        continue;
      }
      if (skl.ability === undefined) continue; // this.actor.exists only in broken skills

      let acpPenalty = skl.acp
        ? Math.max(updateData["system.attributes.acp.gear"], updateData["system.attributes.acp.encumbrance"])
        : 0;
      if (sklKey === "swm") acpPenalty = acpPenalty * 2;
      let ablMod = 0;
      if (skl.ability !== "") ablMod = systemData.abilities[skl.ability].mod;
      let specificSkillBonus = skl.changeBonus || 0;

      // Parse main skills (template / unmigrated actors may only have rank, not points)
      const sklPts = skl.points ?? skl.rank ?? 0;
      let cs = skl.cs;
      if (systemData.details.levelUpData && systemData.details.levelUpProgression) cs = true;
      let sklValue = Math.floor(
        (cs && sklPts > 0 ? sklPts : sklPts / 2) +
        ablMod +
        specificSkillBonus -
        acpPenalty -
        energyDrainPenalty
      );
      linkData(data, updateData, `system.skills.${sklKey}.mod`, sklValue);
      linkData(data, updateData, `system.skills.${sklKey}.acpPenalty`, acpPenalty);
      linkData(data, updateData, `system.skills.${sklKey}.energyDrainPenalty`, energyDrainPenalty);
      linkData(data, updateData, `system.skills.${sklKey}.abilityModifier`, ablMod);
      linkData(
        data,
        updateData,
        `system.skills.${sklKey}.rank`,
        Math.floor(cs && sklPts > 0 ? sklPts : sklPts / 2)
      );
      // Parse sub-skills
      for (let [subSklKey, subSkl] of Object.entries(skl.subSkills || {})) {
        if (subSkl == null) {
          delete systemData.skills[sklKey].subSkills[subSklKey];
          continue;
        }
        if (foundry.utils.getProperty(systemData, `skills.${sklKey}.subSkills.${subSklKey}`) == null) continue;

        let scs = subSkl.cs;
        if (systemData.details.levelUpData && systemData.details.levelUpProgression) scs = true;

        acpPenalty = subSkl.acp ? systemData.attributes.acp.total : 0;
        ablMod = 0;
        if (subSkl.ability !== "") ablMod = subSkl.ability ? systemData.abilities[subSkl.ability].mod : 0;
        specificSkillBonus = subSkl.changeBonus || 0;

        const subPts = subSkl.points ?? subSkl.rank ?? 0;
        sklValue =
          Math.floor(scs && subPts > 0 ? subPts : subPts / 2) +
          ablMod +
          specificSkillBonus -
          acpPenalty -
          energyDrainPenalty;
        linkData(data, updateData, `system.skills.${sklKey}.subSkills.${subSklKey}.mod`, sklValue);
        linkData(data, updateData, `system.skills.${sklKey}.subSkills.${subSklKey}.acpPenalty`, acpPenalty);
        linkData(
          data,
          updateData,
          `system.skills.${sklKey}.subSkills.${subSklKey}.energyDrainPenalty`,
          energyDrainPenalty
        );
        linkData(data, updateData, `system.skills.${sklKey}.subSkills.${subSklKey}.abilityModifier`, ablMod);
        linkData(
          data,
          updateData,
          `system.skills.${sklKey}.subSkills.${subSklKey}.rank`,
          Math.floor(scs && subPts > 0 ? subPts : subPts / 2)
        );
      }
    }
  }

  #sortChanges(a, b) {
    const targetA = a.raw[1];
    const targetB = b.raw[1];
    const typeA = a.raw[2];
    const typeB = b.raw[2];
    const modA = a.raw[3];
    const modB = b.raw[3];
    const priority = this.#sortChangePriority;
    let firstSort = priority.types.indexOf(typeA) - priority.types.indexOf(typeB);
    let secondSort = priority.modifiers.indexOf(modA) - priority.modifiers.indexOf(modB);
    let thirdSort = priority.targets.indexOf(targetA) - priority.targets.indexOf(targetB);
    secondSort += Math.sign(firstSort) * priority.types.length;
    thirdSort += Math.sign(secondSort) * priority.modifiers.length;
    return firstSort + secondSort + thirdSort;
  }

  #parseChange(change, changeData, flags) {
    if (flags == null) flags = {};
    const changeType = change.raw[3];
    const changeValue = change.raw[4];

    if (!changeData[changeType]) return;
    if (changeValue === 0) return;
    if (flags.loseDexToAC && changeType === "dodge") return;

    change.source.value = changeValue;

    const prevValue = {
      positive: changeData[changeType].positive.value,
      negative: changeData[changeType].negative.value,
    };
    // Add value
    if (changeValue > 0) {
      if (["untyped", "dodge", "penalty"].includes(changeType)) changeData[changeType].positive.value += changeValue;
      else {
        changeData[changeType].positive.value = Math.max(changeData[changeType].positive.value, changeValue);
      }
    } else {
      if (["untyped", "dodge", "penalty"].includes(changeType)) changeData[changeType].negative.value += changeValue;
      else changeData[changeType].negative.value = Math.min(changeData[changeType].negative.value, changeValue);
    }

    // Add source
    if (changeValue > 0) {
      if (["untyped", "dodge", "penalty"].includes(changeType)) {
        const compareData = changeData[changeType].positive.sources.filter((o) => {
          return o.type === change.source.type && o.subtype === change.source.subtype;
        });
        if (compareData.length > 0) compareData[0].value += changeValue;
        else {
          changeData[changeType].positive.sources.push(change.source);
        }
      } else if (prevValue.positive < changeValue) {
        changeData[changeType].positive.sources = [change.source];
      }
    } else {
      if (["untyped", "dodge", "penalty"].includes(changeType)) {
        const compareData = changeData[changeType].negative.sources.filter((o) => {
          return o.type === change.source.type && o.subtype === change.source.subtype;
        });
        if (compareData.length > 0) compareData[0].value += changeValue;
        else {
          changeData[changeType].negative.sources.push(change.source);
        }
      } else if (prevValue.negative > changeValue) {
        changeData[changeType].negative.sources = [change.source];
      }
    }
  }

  async #addDefaultChanges(source, changes, flags, sourceInfo, fullConditions, sizeOverride, sizeChange, options = {}, updateData, alignmentChange = {}) {
    // Class hit points
    const classes = source.items
      .filter((o) => o.type === "class" && foundry.utils.getProperty(o.system, "classType") !== "racial")
      .sort((a, b) => {
        return a.sort - b.sort;
      });
    const racialHD = source.items
      .filter((o) => o.type === "class" && foundry.utils.getProperty(o.system, "classType") === "racial")
      .sort((a, b) => {
        return a.sort - b.sort;
      });

    const healthConfig = game.settings.get("warcraftrpg2e", "healthConfig");
    const cls_options = this.actor.type === "character" ? healthConfig.hitdice.PC : healthConfig.hitdice.NPC;
    const race_options = healthConfig.hitdice.Racial;
    const round = { up: Math.ceil, nearest: Math.round, down: Math.floor }[healthConfig.rounding];
    const continuous = { discrete: false, continuous: true }[healthConfig.continuity];

    const push_health = (value, source) => {
      changes.push({
        raw: [value.toString(), "misc", "mhp", "untyped", 0],
        source: { name: source.name, subtype: source.name.toString() },
      });
      changes.push({
        raw: [value.toString(), "misc", "vigor", "untyped", 0],
        source: { name: source.name, subtype: source.name.toString() },
      });
    };
    const manual_health = (health_source) => {
      let health =
        health_source.system.hp + (health_source.system.classType === "base") * health_source.system.fc.hp.value;
      if (!continuous) health = round(health);
      push_health(health, health_source);
    };
    const auto_health = (health_source, options, maximized = 0) => {
      let die_health = 1 + (health_source.system.hd - 1) * options.rate;
      if (!continuous) die_health = round(die_health);

      const maxed_health = Math.min(health_source.system.levels, maximized) * health_source.system.hd;
      const level_health = Math.max(0, health_source.system.levels - maximized) * die_health;
      const favor_health = (health_source.system.classType === "base") * health_source.system.fc.hp.value;
      let health = maxed_health + level_health + favor_health;

      push_health(health, health_source);
    };
    const compute_health = (health_sources, options) => {
      // Compute and push health, tracking the remaining maximized levels.
      let typeHD = 0;
      for (const hd of health_sources) {
        typeHD += hd.system.levels;
      }
      if (options.auto) {
        let maximized = 0;
        try {
          maximized = new Roll35e(`${options.maximized || "0"}`, {
            totalHD: source.system.attributes.hd.total,
            sourceHD: typeHD,
          }).rollSync().total;
        } catch {
          maximized = 1;
        }
        for (const hd of health_sources) {
          auto_health(hd, options, maximized);
          maximized = Math.max(0, maximized - hd.system.levels);
        }
      } else health_sources.forEach((race) => manual_health(race));
    };

    // Complete bestiary statblocks store their printed Hit Dice pool in
    // attributes.hp.base. Their racial class remains useful for BAB, saves,
    // and other derived data, but adding its HP again double-counts that pool.
    const hasCompleteBestiaryStatblock = foundry.utils.getProperty(
      source,
      "flags.warcraftrpg2e.bestiary.completeStatblock"
    ) === true;
    if (!hasCompleteBestiaryStatblock) {
      compute_health(racialHD, race_options);
      compute_health(classes, cls_options);
    }

    // Add Constitution to HP
    changes.push({
      raw: ["@abilities.con.origMod * @attributes.hd.racialClass", "misc", "mhp", "untyped", 0],
      source: { name: "Stamina" },
    });
    changes.push({
      raw: ["2 * (@abilities.con.origTotal + @abilities.con.drain)", "misc", "wounds", "base", 0],
      source: { name: "Stamina" },
    });

    // Natural armor
    {
      const natAC = foundry.utils.getProperty(source, "system.attributes.naturalAC") || 0;
      if (natAC > 0) {
        changes.push({
          raw: [natAC.toString(), "ac", "nac", "base", 0],
          source: {
            name: "Natural Armor",
          },
        });
      }
    }

    // Add armor bonuses from equipment
    source.items
      .filter((obj) => {
        return obj.type === "equipment" && obj.system.equipped && !obj.system.melded && !obj.broken;
      })
      .forEach((item) => {
        let armorTarget = "aac";
        if (item.system.equipmentType === "shield") armorTarget = "sac";
        // Push base armor
        if (item.system.armor.value) {
          changes.push({
            raw: [`${item.system.armor.value + (item.system.armor.enh || 0)}`, "ac", armorTarget, "base", 0],
            source: {
              type: item.type,
              name: item.name,
            },
          });
        } else if (item.system.armor.enh && item.system.equipmentType !== "misc") {
          changes.push({
            raw: [item.system.armor.enh.toString(), "ac", armorTarget, "enh", 0],
            source: {
              type: item.type,
              name: item.name,
            },
          });
        }
      });

    // Add fly bonuses or penalties based on maneuverability
    const flyKey = foundry.utils.getProperty(source, "system.attributes.speed.fly.maneuverability");
    let flyValue = 0;
    if (flyKey != null) flyValue = CONFIG.D35E.flyManeuverabilityValues[flyKey];
    if (flyValue && flyValue !== 0) {
      changes.push({
        raw: [flyValue.toString(), "skill", "skill.fly", "untyped", 0],
        source: {
          name: game.i18n.localize("D35E.FlyManeuverability"),
        },
      });
    }
    // Add swim and climb skill bonuses based on having speeds for them
    {
      const climbSpeed = foundry.utils.getProperty(source, "system.attributes.speed.climb.total") || 0;
      const swimSpeed = foundry.utils.getProperty(source, "system.attributes.speed.swim.total") || 0;
      if (climbSpeed > 0) {
        changes.push({
          raw: ["8", "skill", "skill.clm", "racial", 0],
          source: {
            name: game.i18n.localize("D35E.SpeedClimb"),
          },
        });
      }
      if (swimSpeed > 0) {
        changes.push({
          raw: ["8", "skill", "skill.swm", "racial", 0],
          source: {
            name: game.i18n.localize("D35E.SpeedSwim"),
          },
        });
      }
    }

    // Add size bonuses to various attributes
    let sizeKey = source.system.traits.size;
    let tokenSizeKey = source.system.traits.tokenSize || source.system.traits.tokensize || "actor";
    let isTokenActorSize = source.system.traits.tokenSize || source.system.traits.tokensize;
    if (sizeOverride !== undefined && sizeOverride !== null && sizeOverride !== "") {
      sizeKey = sizeOverride;
      if (isTokenActorSize) {
        tokenSizeKey = sizeOverride;
      }
    }
    let sizeIndex = Object.keys(CONFIG.D35E.actorSizes).indexOf(sizeKey);
    if (sizeChange && sizeChange.change !== undefined && sizeChange.change !== 0) {
      sizeIndex = Math.min(
        Math.max(0, sizeIndex + sizeChange.change),
        Object.keys(CONFIG.D35E.actorSizes).length - 1
      );
      // check if the new size is between lower and upper bounds
      let lowerBoundIndex = Object.keys(CONFIG.D35E.actorSizes).indexOf(sizeChange.lowerBound || "fine");
      let upperBoundIndex = Object.keys(CONFIG.D35E.actorSizes).indexOf(sizeChange.upperBound || "col");
      if (sizeIndex < lowerBoundIndex) sizeIndex = lowerBoundIndex;
      if (sizeIndex > upperBoundIndex) sizeIndex = upperBoundIndex;
      sizeKey = Object.keys(CONFIG.D35E.actorSizes)[sizeIndex];
    }
    if (isTokenActorSize) {
      tokenSizeKey = sizeKey;
    }
    linkData(source, updateData, "system.traits.actualSize", sizeKey);

    const creatureProfile = resolveWarcraftCreatureProfile({
      creatureType: source.system.attributes?.creatureType,
      deathRule: resolveDeathRule(
        source.system.attributes?.deathRule,
        this.actor.race?.system?.deathRule,
        source.system.attributes?.creatureType,
      ),
    });
    if (creatureProfile.construct) {
      flags.noCon = true;
      const constructHp = constructSizeHitPoints(sizeKey);
      const alreadyProvided = changes.some((change) =>
        change.raw?.[2] === "mhp" && Number(change.raw?.[0]) === constructHp
      );
      if (constructHp && !alreadyProvided) {
        changes.push({
          raw: [String(constructHp), "misc", "mhp", "racial", 0],
          source: { name: game.i18n.localize("D35E.ConstructSizeHitPoints") },
        });
      }
    }

    // Compute actualAlignmentAxes = base axes overridden by active items (never mutates alignmentAxes)
    {
      const baseAxes = foundry.utils.getProperty(source, "system.details.alignmentAxes") ?? { lawChaos: "n", goodEvil: "n" };
      const actualLawChaos = alignmentChange.lawChaos || baseAxes.lawChaos || "n";
      const actualGoodEvil = alignmentChange.goodEvil || baseAxes.goodEvil || "n";
      linkData(source, updateData, "system.details.actualAlignmentAxes.lawChaos", actualLawChaos);
      linkData(source, updateData, "system.details.actualAlignmentAxes.goodEvil", actualGoodEvil);
    }
    if (sizeKey !== "med") {
      // AC
      changes.push({
        raw: [CONFIG.D35E.sizeMods[sizeKey].toString(), "ac", "ac", "size", 0],
        source: {
          type: "size",
        },
      });
      // Stealth skill
      changes.push({
        raw: [CONFIG.D35E.sizeStealthMods[sizeKey].toString(), "skill", "skill.hid", "size", 0],
        source: {
          type: "size",
        },
      });
      // Fly skill
      changes.push({
        raw: [CONFIG.D35E.sizeFlyMods[sizeKey].toString(), "skill", "skill.fly", "size", 0],
        source: {
          type: "size",
        },
      });
      // CMB
      changes.push({
        raw: [CONFIG.D35E.sizeSpecialMods[sizeKey].toString(), "misc", "cmb", "size", 0],
        source: {
          type: "size",
        },
      });
      // CMD
      changes.push({
        raw: [CONFIG.D35E.sizeSpecialMods[sizeKey].toString(), "misc", "cmd", "size", 0],
        source: {
          type: "size",
        },
      });
    }

    // Apply changes in Actor size to Token width/height
    if (
      !options.skipToken &&
      tokenSizeKey !== "none" &&
      this.actor.isCharacterType &&
      !foundry.utils.getProperty(this.actor.system, "noTokenOverride")
    ) {
      let size = CONFIG.D35E.tokenSizes[tokenSizeKey];
      //LogHelper.log(size)
      if (this.actor.isToken) {
        let tokens = [];
        tokens.push(this.actor.token);
        for (const o of tokens) {
          if (size.w !== o.width || size.h !== o.height || size.scale !== (o.document ?? o)?.texture?.scaleX)
            await ActorPF._updateToken(
              o,
              { width: size.w, height: size.h, texture: { scaleX: size.scale, scaleY: size.scale } },
              { stopUpdates: true, tokenOnly: true }
            );
        }
      }
      if (!this.actor.isToken) {
        let tokens = this.actor.getActiveTokens().filter((o) => o?.document.actorLink);
        for (const o of tokens) {
          if (size.w !== o.width || size.h !== o.height || size.scale !== (o.document ?? o)?.texture?.scaleX) {
            await ActorPF._updateToken(
              o,
              { width: size.w, height: size.h, texture: { scaleX: size.scale, scaleY: size.scale } },
              { stopUpdates: true, tokenOnly: true }
            );
          }
        }
        foundry.utils.setProperty(source, "prototypeToken.width", size.w);
        foundry.utils.setProperty(source, "prototypeToken.height", size.h);
        foundry.utils.setProperty(source, "prototypeToken.texture.scaleX", size.scale);
        foundry.utils.setProperty(source, "prototypeToken.texture.scaleY", size.scale);
      }
    }
    if (!options.skipToken && this.actor.isCharacterType) {
      let dimLight = 0;
      let brightLight = 0;
      let alpha = 0.0;
      let color = "#000000";
      let animationIntensity = 5;
      let lightAngle = 360;
      let animationSpeed = 5;
      let type = "";

      let lowLight =
        foundry.utils.getProperty(source, "system.attributes.senses.lowLight") !== undefined
          ? foundry.utils.getProperty(source, "system.attributes.senses.lowLight")
          : foundry.utils.getProperty(this.actor.system, "attributes.senses.lowLight") || false;
      let lowLightMultiplier =
        foundry.utils.getProperty(source, "system.attributes.senses.lowLightMultiplier") !== undefined
          ? foundry.utils.getProperty(source, "system.attributes.senses.lowLightMultiplier")
          : foundry.utils.getProperty(this.actor.system, "attributes.senses.lowLightMultiplier") || 2;
      let darkvision =
        foundry.utils.getProperty(source, "system.attributes.senses.darkvision") !== undefined
          ? foundry.utils.getProperty(source, "system.attributes.senses.darkvision")
          : foundry.utils.getProperty(this.actor.system, "attributes.senses.darkvision") || 0;
      let blindsight =
        foundry.utils.getProperty(source, "system.attributes.senses.blindsight") !== undefined
          ? foundry.utils.getProperty(source, "system.attributes.senses.blindsight")
          : foundry.utils.getProperty(this.actor.system, "attributes.senses.blindsight") || 0;
      let tremorsense =
        foundry.utils.getProperty(source, "system.attributes.senses.tremorsense") !== undefined
          ? foundry.utils.getProperty(source, "system.attributes.senses.tremorsense")
          : foundry.utils.getProperty(this.actor.system, "attributes.senses.tremorsense") || 0;
      let truesight =
        foundry.utils.getProperty(source, "system.attributes.senses.truesight") !== undefined
          ? foundry.utils.getProperty(source, "system.attributes.senses.truesight")
          : foundry.utils.getProperty(this.actor.system, "attributes.senses.truesight") || 0;

      for (let i of this.actor.items.values()) {
        if (!i.system.hasOwnProperty("light") && !i.system.hasOwnProperty("senses")) continue;
        if (i.system.equipped && !i.system.melded && !i.broken) {
          if (i.system.light?.emitLight) {
            dimLight = i.system.light.dimRadius ? i.system.light.dimRadius : Math.floor(2 * i.system.light.radius);
            brightLight = Math.floor(i.system.light.radius);
            color = i.system.light.color || "#000";
            type = i.system.light.type;
            alpha = i.system.light.alpha;
            animationIntensity = i.system.light.animationIntensity;
            lightAngle = i.system.light.lightAngle;
            animationSpeed = i.system.light.animationSpeed;
          }
        } else if (
          i.type === "race" ||
          i.type === "class" ||
          (i.type === "buff" && i.system.active) ||
          (i.type === "aura" && i.system.active)
        ) {
          if (i.system.light?.emitLight) {
            dimLight = i.system.light.dimRadius ? i.system.light.dimRadius : Math.floor(2 * i.system.light.radius);
            brightLight = Math.floor(i.system.light.radius);
            color = i.system.light.color || "#000";
            type = i.system.light.type;
            alpha = i.system.light.alpha;
            animationIntensity = i.system.light.animationIntensity;
            lightAngle = i.system.light.lightAngle;
            animationSpeed = i.system.light.animationSpeed;
          }
        }
      }
      if (!foundry.utils.getProperty(this.actor.system, "noLightOverride") && !game.settings.get("warcraftrpg2e", "globalDisableTokenLight")) {
        if (this.actor.isToken) {
          let tokens = [];
          tokens.push(this.actor.token);
          for (const o of tokens) {
            await this.actor.updateTokenLight(
              dimLight,
              o,
              brightLight,
              color,
              animationIntensity,
              type,
              animationSpeed,
              lightAngle,
              alpha
            );
          }
        }
        if (!this.actor.isToken) {
          let tokens = this.actor.getActiveTokens().filter((o) => o?.document.actorLink);
          for (const o of tokens) {
            await this.actor.updateTokenLight(
              dimLight,
              o,
              brightLight,
              color,
              animationIntensity,
              type,
              animationSpeed,
              lightAngle,
              alpha
            );
          }
        }
      }
      if (
        !foundry.utils.getProperty(this.actor.system, "noVisionOverride") &&
        !game.settings.get("warcraftrpg2e", "globalDisableTokenVision")
      ) {
        // Sync calculated darkvision → prototypeToken.sight so the prototype token
        // config and newly-placed tokens reflect the actor's computed senses.
        const sightRange = darkvision;
        const sightMode = sightRange > 0 ? "darkvision" : "basic";
        foundry.utils.setProperty(source, "prototypeToken.sight.range", sightRange);
        foundry.utils.setProperty(source, "prototypeToken.sight.visionMode", sightMode);
        foundry.utils.setProperty(source, "prototypeToken.sight.enabled", true);

        // Build detection modes: preserve custom modes, recompute D35E sense modes.
        const managedIds = new Set(["lightPerception", "basicSight", "blindSight", "feelTremor", "seeInvisibility"]);
        let filteredModes;
        if (game.release.generation >= 14) {
          const existingModes = foundry.utils.getProperty(source, "prototypeToken.detectionModes") ?? {};
          filteredModes = Object.fromEntries(Object.entries(existingModes).filter(([id]) => !managedIds.has(id)));
          filteredModes.lightPerception = { enabled: true, range: null };
          if (sightRange > 0) filteredModes.basicSight = { enabled: true, range: sightRange };
          if (blindsight > 0) filteredModes.blindSight = { enabled: true, range: blindsight };
          if (tremorsense > 0) filteredModes.feelTremor = { enabled: true, range: tremorsense };
          if (truesight > 0) filteredModes.seeInvisibility = { enabled: true, range: truesight };
        } else {
          const existingModes = foundry.utils.getProperty(source, "prototypeToken.detectionModes") ?? [];
          filteredModes = existingModes.filter((m) => !managedIds.has(m.id));
          filteredModes.push({ id: "lightPerception", enabled: true, range: null });
          if (sightRange > 0) filteredModes.push({ id: "basicSight", enabled: true, range: sightRange });
          if (blindsight > 0) filteredModes.push({ id: "blindSight", enabled: true, range: blindsight });
          if (tremorsense > 0) filteredModes.push({ id: "feelTremor", enabled: true, range: tremorsense });
          if (truesight > 0) filteredModes.push({ id: "seeInvisibility", enabled: true, range: truesight });
        }
        foundry.utils.setProperty(source, "prototypeToken.detectionModes", filteredModes);

        const sightUpdate = { sight: { range: sightRange, visionMode: sightMode, enabled: true }, detectionModes: filteredModes };

        // Update placed tokens on the canvas.
        if (this.actor.isToken) {
          // Unlinked token: update this token's sight directly.
          const tokenDoc = this.actor.token;
          if (tokenDoc) ActorPF._updateToken(tokenDoc, sightUpdate);
        } else {
          // Linked tokens: update all linked token instances.
          const linkedTokens = this.actor.getActiveTokens().filter((o) => o?.document.actorLink);
          for (const o of linkedTokens) {
            ActorPF._updateToken(o, sightUpdate, { stopUpdates: true, tokenOnly: true });
          }
        }
      }
    }

    for (let [con, v] of Object.entries(fullConditions)) {
      if (!v) continue;

      switch (con) {
        case "blind":
          changes.push({
            raw: ["-2", "ac", "ac", "penalty", 0],
            source: { name: "Blind" },
          });
          flags["loseDexToAC"] = true;
          sourceInfo["system.attributes.ac.normal.total"] = sourceInfo["system.attributes.ac.normal.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.attributes.ac.touch.total"] = sourceInfo["system.attributes.ac.touch.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.attributes.cmd.total"] = sourceInfo["system.attributes.cmd.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.attributes.cmd.flatFootedTotal"] = sourceInfo["system.attributes.cmd.flatFootedTotal"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.attributes.ac.normal.total"].negative.push({
            name: "Blind",
            value: "Lose Agility to AC",
          });
          sourceInfo["system.attributes.ac.touch.total"].negative.push({
            name: "Blind",
            value: "Lose Agility to AC",
          });
          sourceInfo["system.attributes.cmd.total"].negative.push({ name: "Blind", value: "Lose Agility to AC" });
          sourceInfo["system.attributes.cmd.flatFootedTotal"].negative.push({
            name: "Blind",
            value: "Lose Agility to AC",
          });
          break;
        case "dazzled":
          changes.push({
            raw: ["-1", "attack", "attack", "penalty", 0],
            source: { name: "Dazzled" },
          });
          break;
        case "deaf":
          changes.push({
            raw: ["-4", "misc", "init", "penalty", 0],
            source: { name: "Deaf" },
          });
          break;
        case "entangled":
          changes.push({
            raw: ["-4", "ability", "dex", "penalty", 0],
            source: { name: "Entangled" },
          });
          changes.push({
            raw: ["-2", "attack", "attack", "penalty", 0],
            source: { name: "Entangled" },
          });
          break;
        case "grappled":
          changes.push({
            raw: ["-4", "ability", "dex", "penalty", 0],
            source: { name: "Grappled" },
          });
          changes.push({
            raw: ["-2", "attack", "attack", "penalty", 0],
            source: { name: "Grappled" },
          });
          changes.push({
            raw: ["-2", "misc", "cmb", "penalty", 0],
            source: { name: "Grappled" },
          });
          break;
        case "helpless":
          flags["zeroDex"] = true;
          sourceInfo["system.abilities.dex.total"] = sourceInfo["system.abilities.dex.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.abilities.dex.total"].negative.push({ name: "Helpless", value: "0 Agy" });
          break;
        case "paralyzed":
          flags["zeroDex"] = true;
          flags["zeroStr"] = true;
          sourceInfo["system.abilities.dex.total"] = sourceInfo["system.abilities.dex.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.abilities.dex.total"].negative.push({ name: "Paralyzed", value: "0 Agy" });
          sourceInfo["system.abilities.str.total"] = sourceInfo["system.abilities.str.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.abilities.str.total"].negative.push({ name: "Paralyzed", value: "0 Str" });
          break;
        case "pinned":
          flags["loseDexToAC"] = true;
          sourceInfo["system.attributes.ac.normal.total"] = sourceInfo["system.attributes.ac.normal.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.attributes.ac.touch.total"] = sourceInfo["system.attributes.ac.touch.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.attributes.cmd.total"] = sourceInfo["system.attributes.cmd.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.attributes.ac.normal.total"].negative.push({
            name: "Pinned",
            value: "Lose Agility to AC",
          });
          sourceInfo["system.attributes.ac.touch.total"].negative.push({
            name: "Pinned",
            value: "Lose Agility to AC",
          });
          sourceInfo["system.attributes.cmd.total"].negative.push({ name: "Pinned", value: "Lose Agility to AC" });
          break;
        case "fear":
          changes.push({
            raw: ["-2", "attack", "attack", "penalty", 0],
            source: { name: "Fear" },
          });
          changes.push({
            raw: ["-2", "savingThrows", "allSavingThrows", "penalty", 0],
            source: { name: "Fear" },
          });
          changes.push({
            raw: ["-2", "skills", "skills", "penalty", 0],
            source: { name: "Fear" },
          });
          changes.push({
            raw: ["-2", "abilityChecks", "allChecks", "penalty", 0],
            source: { name: "Fear" },
          });
          break;
        case "sickened":
          changes.push({
            raw: ["-2", "attack", "attack", "penalty", 0],
            source: { name: "Sickened" },
          });
          changes.push({
            raw: ["-2", "damage", "wdamage", "penalty", 0],
            source: { name: "Sickened" },
          });
          changes.push({
            raw: ["-2", "savingThrows", "allSavingThrows", "penalty", 0],
            source: { name: "Sickened" },
          });
          changes.push({
            raw: ["-2", "skills", "skills", "penalty", 0],
            source: { name: "Sickened" },
          });
          changes.push({
            raw: ["-2", "abilityChecks", "allChecks", "penalty", 0],
            source: { name: "Sickened" },
          });
          break;
        case "stunned":
          changes.push({
            raw: ["-2", "ac", "ac", "penalty", 0],
            source: { name: "Stunned" },
          });
          flags["loseDexToAC"] = true;
          sourceInfo["system.attributes.ac.normal.total"] = sourceInfo["system.attributes.ac.normal.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.attributes.ac.touch.total"] = sourceInfo["system.attributes.ac.touch.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.attributes.cmd.total"] = sourceInfo["system.attributes.cmd.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.attributes.ac.normal.total"].negative.push({
            name: "Stunned",
            value: "Lose Agility to AC",
          });
          sourceInfo["system.attributes.ac.touch.total"].negative.push({
            name: "Stunned",
            value: "Lose Agility to AC",
          });
          sourceInfo["system.attributes.cmd.total"].negative.push({ name: "Stunned", value: "Lose Agility to AC" });
          break;
        case "wildshaped":
          sourceInfo["system.attributes.ac.normal.total"] = sourceInfo["system.attributes.ac.normal.total"] || {
            positive: [],
            negative: [],
          };
          sourceInfo["system.attributes.ac.normal.total"].positive.push({
            name: "Wild Shape",
            value: "Item bonuses disabled",
          });
          break;
      }
    }

    for (let flagKey of Object.keys(flags)) {
      if (!flags[flagKey]) continue;

      switch (flagKey) {
        case "noCon":
          // changes.push({
          //     raw: ["(-(@abilities.con.origMod)) * @attributes.hd.total", "misc", "mhp", "untyped", 0],
          //     source: { name: "0 Con" }
          // });
          // changes.push({
          //     raw: ["5", "savingThrows", "fort", "untyped", 0],
          //     source: { name: "0 Con" }
          // });
          break;
      }
    }

    // Handle fatigue and exhaustion so that they don't stack
    if (source.system.attributes.conditions.exhausted) {
      changes.push({
        raw: ["-6", "ability", "str", "penalty", 0],
        source: { name: "Exhausted" },
      });
      changes.push({
        raw: ["-6", "ability", "dex", "penalty", 0],
        source: { name: "Exhausted" },
      });
    } else if (source.system.attributes.conditions.fatigued) {
      changes.push({
        raw: ["-2", "ability", "str", "penalty", 0],
        source: { name: "Fatigued" },
      });
      changes.push({
        raw: ["-2", "ability", "dex", "penalty", 0],
        source: { name: "Fatigued" },
      });
    }

    if (source.system.attributes.conditions.shaken) {
      changes.push({
        raw: ["-2", "savingThrows", "allSavingThrows", "penalty", 0],
        source: { name: "Shaken" },
      });
      changes.push({
        raw: ["-2", "skills", "skills", "penalty", 0],
        source: { name: "Shaken" },
      });
      changes.push({
        raw: ["-2", "abilityChecks", "allChecks", "penalty", 0],
        source: { name: "Shaken" },
      });
      changes.push({
        raw: ["-2", "attack", "attack", "penalty", 0],
        source: { name: "Shaken" },
      });
    }
    if (!source.system.noSkillSynergy) {
      //Bluff
      this.#applySkillSynergies(source, changes);
    }

    // Apply level drain to hit points
    if (!Number.isNaN(source.system.attributes.energyDrain) && source.system.attributes.energyDrain > 0) {
      changes.push({
        raw: ["-(@attributes.energyDrain * 5)", "misc", "mhp", "untyped", 0],
        source: { name: "Negative Levels" },
      });
      changes.push({
        raw: ["-(@attributes.energyDrain * 5)", "misc", "vigor", "untyped", 0],
        source: { name: "Negative Levels" },
      });
    }

    if (this.actor.material) {
      changes.push({
        raw: [`${this.actor.material.system.hardness || 0}`, "misc", "hardness", "untyped", 0],
        source: { name: `Material Hardness (${this.actor.material.name})` },
      });
    }
    if (!Number.isNaN(source.system.staticBonus.hp) && source.system.staticBonus.hp > 0) {
      changes.push({
        raw: [`${source.system.staticBonus.hp || 0}`, "misc", "mhp", "untyped", 0],
        source: { name: `Manual HP Bonus` },
      });
    }
    if (!Number.isNaN(source.system.staticBonus.ac) && source.system.staticBonus.ac > 0) {
      changes.push({
        raw: [`${source.system.staticBonus.ac || 0}`, "ac", "ac", "untyped", 0],
        source: { name: `Manual AC Bonus` },
      });
    }

    if (source.system.attributes?.conditions?.disabled) {
      changes.push({
        raw: ["-2", "attack", "attack", "penalty", 0],
        source: { name: "Disabled" },
      });
      changes.push({
        raw: ["-2", "damage", "wdamage", "penalty", 0],
        source: { name: "Disabled" },
      });
      changes.push({
        raw: ["-2", "savingThrows", "allSavingThrows", "penalty", 0],
        source: { name: "Disabled" },
      });
      changes.push({
        raw: ["-2", "skills", "skills", "penalty", 0],
        source: { name: "Disabled" },
      });
      changes.push({
        raw: ["-2", "abilityChecks", "allChecks", "penalty", 0],
        source: { name: "Disabled" },
      });
    }

    if (source.system.attributes?.conditions?.chilled) {
      changes.push({
        raw: ["-2", "ac", "ac", "penalty", 0],
        source: { name: "Chilled" },
      });
      changes.push({
        raw: ["-2", "attack", "mattack", "penalty", 0],
        source: { name: "Chilled" },
      });
      changes.push({
        raw: ["-2", "damage", "mdamage", "penalty", 0],
        source: { name: "Chilled" },
      });
      changes.push({
        raw: ["-2", "savingThrows", "ref", "penalty", 0],
        source: { name: "Chilled" },
      });
      changes.push({
        // Prepared rank, ability modifier, and persistent change bonus are all
        // available here; negate half their combined pre-Chilled total.
        raw: ["-ceil((@skills.jmp.rank + @skills.jmp.abilityModifier + @skills.jmp.changeBonus) / 2)", "skill", "skill.jmp", "penalty", 0],
        source: { name: "Chilled" },
      });
    }
  }

  #applySkillSynergies(updateData, changes) {
    let system = updateData.system;
    if (system.skills.blf.rank >= 5) {
      changes.push({
        raw: ["2", "skill", "skill.dip", "untyped", 0],
        source: { name: "Skill synergy" },
      });
      changes.push({
        raw: ["2", "skill", "skill.int", "untyped", 0],
        source: { name: "Skill synergy" },
      });
      changes.push({
        raw: ["2", "skill", "skill.slt", "untyped", 0],
        source: { name: "Skill synergy" },
      });
    }

    //Knowledge arcana
    if (system.skills.kar.rank >= 5) {
      changes.push({
        raw: ["2", "skill", "skill.spl", "untyped", 0],
        source: { name: "Skill synergy" },
      });
    }

    // Kno Noblility
    if (system.skills.kno.rank >= 5) {
      changes.push({
        raw: ["2", "skill", "skill.dip", "untyped", 0],
        source: { name: "Skill synergy" },
      });
    }

    // Kno local
    if (system.skills.klo.rank >= 5) {
      changes.push({
        raw: ["2", "skill", "skill.gif", "untyped", 0],
        source: { name: "Skill synergy" },
      });
    }

    // Handle animals
    if (system.skills.han.rank >= 5) {
      changes.push({
        raw: ["2", "skill", "skill.rid", "untyped", 0],
        source: { name: "Skill synergy" },
      });
    }

    // Sense motive
    if (system.skills.sen.rank >= 5) {
      changes.push({
        raw: ["2", "skill", "skill.dip", "untyped", 0],
        source: { name: "Skill synergy" },
      });
    }

    // Jump
    if (system.skills.jmp.rank >= 5) {
      changes.push({
        raw: ["2", "skill", "skill.tmb", "untyped", 0],
        source: { name: "Skill synergy" },
      });
    }

    // Tumble
    if (system.skills.tmb.rank >= 5) {
      changes.push({
        raw: ["2", "skill", "skill.blc", "untyped", 0],
        source: { name: "Skill synergy" },
      });

      changes.push({
        raw: ["2", "skill", "skill.jmp", "untyped", 0],
        source: { name: "Skill synergy" },
      });
    }

    // Survival
    if (system.skills.sur.rank >= 5) {
      changes.push({
        raw: ["2", "skill", "skill.kna", "untyped", 0],
        source: { name: "Skill synergy" },
      });
    }

    // Concentration
    if (system.skills.coc.rank >= 5 && system.skills.aut != null) {
      changes.push({
        raw: ["2", "skill", "skill.aut", "untyped", 0],
        source: { name: "Skill synergy" },
      });
    }

    // Autohypnosis and Knowledge (Psionics) are optional legacy skills. New
    // Warcraft actors omit both, while migrated D35E actors may retain them.
    if (system.skills.aut?.rank >= 5 && system.skills.kps != null) {
      changes.push({
        raw: ["2", "skill", "skill.kps", "untyped", 0],
        source: { name: "Skill synergy" },
      });
    }
  }

  #isChangeAllowed(item, change, fullConditions) {
    if (
      (fullConditions.wildshaped || fullConditions.polymorph) &&
      item.type === "race" &&
      change[1] === "ac" &&
      change[2] === "natural"
    )
      return false;
    if (
      (fullConditions.wildshaped || fullConditions.polymorph) &&
      item.type === "race" &&
      change[1] === "ability" &&
      change[2] === "str"
    )
      return false;
    if (
      (fullConditions.wildshaped || fullConditions.polymorph) &&
      item.type === "race" &&
      change[1] === "ability" &&
      change[2] === "dex"
    )
      return false;
    if ((fullConditions.wildshaped || fullConditions.polymorph) && item.type === "race" && change[1] === "speed")
      return false;
    return true;
  }

  #getChangeItemSubtype(item) {
    if (item.type === "buff") return item.system?.buffType || item.data?.buffType;
    if (item.type === "feat") return item.system?.featType || item.data?.featType;
    return "";
  }

  #blacklistChangeData(result, changeTarget) {
    //let result = foundry.utils.duplicate(data);

    switch (changeTarget) {
      case "mhp":
        result.attributes.hp = null;
        result.skills = null;
        break;
      case "wounds":
        result.attributes.wounds = null;
        result.skills = null;
        break;
      case "vigor":
        result.attributes.vigor = null;
        result.skills = null;
        break;
      case "str":
        result.abilities.str = null;
        result.skills = null;
        result.attributes.savingThrows = null;
        break;
      case "con":
        result.abilities.con = null;
        result.attributes.hp = null;
        result.attributes.wounds = null;
        result.skills = null;
        result.attributes.savingThrows = null;
        break;
      case "dex":
        result.abilities.dex = null;
        result.attributes.ac = null;
        result.skills = null;
        result.attributes.savingThrows = null;
        break;
      case "int":
        result.abilities.int = null;
        result.skills = null;
        result.attributes.savingThrows = null;
        break;
      case "wis":
        result.abilities.wis = null;
        result.skills = null;
        result.attributes.savingThrows = null;
        break;
      case "cha":
        result.abilities.cha = null;
        result.skills = null;
        result.attributes.savingThrows = null;
        break;
      case "ac":
      case "aac":
      case "sac":
      case "nac":
        result.attributes.ac = null;
        break;
      case "attack":
      case "mattack":
      case "rattack":
        result.attributes.attack = null;
        break;
      case "babattack":
        result.attributes.bab = null;
        break;
      case "damage":
      case "mdamage":
      case "wdamage":
      case "sdamage":
        result.attributes.damage = null;
        break;
      case "allSavingThrows":
      case "fort":
      case "ref":
      case "will":
        result.attributes.savingThrows = null;
        break;
      case "skills":
      case "strSkills":
      case "dexSkills":
      case "conSkills":
      case "intSkills":
      case "wisSkills":
      case "chaSkills":
        result.skills = null;
        break;
      case "cmb":
        result.attributes.cmb = null;
        break;
      case "cmd":
        result.attributes.cmd = null;
        break;
      case "init":
        result.attributes.init = null;
        break;
    }

    if (changeTarget.match(/^data\.skills/)) {
      result.skills = null;
    }

    return result;
  }

  get #sortChangePriority() {
    const skillTargets = this.#skillTargets;
    const spellTargets = this.#spellTargets;
    return {
      targets: [
        "ability",
        "misc",
        "ac",
        "attack",
        "damage",
        "savingThrows",
        "skills",
        "skill",
        "prestigeCl",
        "resistance",
        "dr",
        "spells",
        "spellcastingAbility",
      ],
      types: [
        "str",
        "dex",
        "con",
        "int",
        "wis",
        "cha",
        "landSpeed",
        "climbSpeed",
        "swimSpeed",
        "burrowSpeed",
        "flySpeed",
        "allSpeeds",
        "speedMult",
        "skills",
        "strSkills",
        "dexSkills",
        "conSkills",
        "intSkills",
        "wisSkills",
        "chaSkills",
        "perfSkills",
        "craftSkills",
        "knowSkills",
        ...skillTargets,
        "allChecks",
        "strChecks",
        "dexChecks",
        "conChecks",
        "intChecks",
        "wisChecks",
        "chaChecks",
        "ac",
        "aac",
        "sac",
        "nac",
        "ddg",
        "pac",
        "ffac",
        "tch",
        "attack",
        "mattack",
        "rattack",
        "babattack",
        "damage",
        "mdamage",
        "wdamage",
        "sdamage",
        "allSavingThrows",
        "fort",
        "ref",
        "will",
        "turnUndead",
        "turnUndeadDiceTotal",
        "spellResistance",
        "powerPoints",
        "sneakAttack",
        "cmb",
        "cmd",
        "init",
        "mhp",
        "wounds",
        "vigor",
        "arcaneCl",
        "divineCl",
        "psionicCl",
        "cardCl",
        "cr",
        "runSpeedMultiplierModifier",
        "fortification",
        "regen",
        "fastHeal",
        "concealment",
        ...spellTargets,
        "scaPrimary",
        "scaSecondary",
        "scaTetriary",
        "scaSpelllike",
      ],
      modifiers: [
        "base-replace",
        "replace",
        "untyped",
        "base",
        "enh",
        "dodge",
        "inherent",
        "deflection",
        "morale",
        "luck",
        "sacred",
        "insight",
        "resist",
        "profane",
        "trait",
        "racial",
        "size",
        "competence",
        "circumstance",
        "alchemical",
        "penalty",
      ],
    };
  }

  get #skillTargets() {
    let skills = [];
    let subSkills = [];
    for (let [sklKey, skl] of Object.entries(foundry.utils.getProperty(this.actor.system, "skills"))) {
      if (skl == null) continue;
      if (skl.subSkills != null) {
        for (let subSklKey of Object.keys(skl.subSkills)) {
          subSkills.push(`skill.${sklKey}.subSkills.${subSklKey}`);
        }
      } else skills.push(`skill.${sklKey}`);
    }
    return [...skills, ...subSkills];
  }

  get #spellTargets() {
    let targets = [];
    for (let spellbook of ["primary", "secondary", "tetriary", "spelllike"]) {
      for (let level = 0; level < 10; level++)
        targets.push(`spells.spellbooks.${spellbook}.spells.spell${level}.bonus`);
    }
    return targets;
  }

  #computeEncumbrance(updateData, srcData) {
    const carry = this.#getCarryCapacity(srcData);
    linkData(srcData, updateData, "system.attributes.encumbrance.levels.light", carry.light);
    linkData(srcData, updateData, "system.attributes.encumbrance.levels.medium", carry.medium);
    linkData(srcData, updateData, "system.attributes.encumbrance.levels.heavy", carry.heavy);
    linkData(srcData, updateData, "system.attributes.encumbrance.levels.carry", carry.heavy * 2);
    linkData(srcData, updateData, "system.attributes.encumbrance.levels.drag", carry.heavy * 5);

    const carriedWeight = Math.max(0, this.#getCarriedWeight(srcData));
    linkData(srcData, updateData, "system.attributes.encumbrance.carriedWeight", Math.round(carriedWeight * 10) / 10);

    // Determine load level
    let encLevel = 0;
    if (carriedWeight > 0) {
      if (carriedWeight >= srcData.system.attributes.encumbrance.levels.light) encLevel++;
      if (carriedWeight >= srcData.system.attributes.encumbrance.levels.medium) encLevel++;
    }
    linkData(srcData, updateData, "system.attributes.encumbrance.level", encLevel);
  }

  #getCarryCapacity(srcData) {
    // Determine carrying capacity
    const carryStr =
      srcData.system.abilities.str.total -
      srcData.system.abilities.str.damage +
      srcData.system.abilities.str.carryBonus;
    let carryMultiplier = srcData.system.abilities.str.carryMultiplier;
    // actualSize is derived later in this update pipeline, so it is absent on
    // fresh and some migrated actors. Use stored size until derivation runs.
    const size = srcData.system.traits.actualSize || srcData.system.traits.size || "med";
    const sizeMultipliers = srcData.system.attributes.quadruped
      ? CONFIG.D35E.encumbranceMultipliers.quadruped
      : CONFIG.D35E.encumbranceMultipliers.normal;
    carryMultiplier *= sizeMultipliers[size] ?? sizeMultipliers.med ?? 1;
    // Compute carrying capacity using the formula from CONFIG.D35E.carryingCapacityFormula.
    // _preProcessDiceFormula (hooked into Roll35e.parse) handles pow(), floor(), max(), min().
    const str = carryStr > 0 ? carryStr : 0;
    const heavyRoll = Roll35e.safeEvaluate(CONFIG.D35E.carryingCapacityFormula, { str });
    let heavy = carryMultiplier * (heavyRoll.total || 0);

    // 1 kg = 0.5 lb
    // if (game.settings.get("warcraftrpg2e", "units") === "metric") {
    //     heavy = heavy / 2
    // }
    // Imperial to metric: All items have their weight stored in imperial for internal calculations

    return {
      light: Math.floor(heavy / 3),
      medium: Math.floor((heavy / 3) * 2),
      heavy: heavy,
    };
  }

  #getCarriedWeight(srcData) {
    // Determine carried weight
    const physicalItems = srcData.items.filter((o) => {
      return o.system.weight != null;
    });
    return physicalItems.reduce((cur, o) => {
      let weightMult = o.system.containerWeightless ? 0 : 1;
      if (!o.system.carried) return cur;
      if (o.system.equippedWeightless && o.system.equipped) return cur;
      return cur + o.system.weight * o.system.quantity * weightMult;
    }, ActorWealthHelper.calculateCoinWeight(srcData));
  }

  /**
   * Return reduced movement speed.
   * @param {Number} value - The non-reduced movement speed.
   * @returns {Number} The reduced movement speed.
   */
  getReducedMovementSpeed(srcData1, value, updateData, armorItems, flags, speedKey) {
    const incr = game.settings.get("warcraftrpg2e", "units") === "metric" ? 1.5 : 5;
    let load = updateData["system.attributes.encumbrance.carriedWeight"];
    let maxLoad = updateData["system.attributes.encumbrance.levels.heavy"];
    const lightLoad = updateData["system.attributes.encumbrance.levels.light"] ?? maxLoad / 3;
    const mediumLoad = updateData["system.attributes.encumbrance.levels.medium"] ?? (maxLoad * 2) / 3;
    let runSpeedMultiplierModifier = updateData["system.attributes.runSpeedMultiplierModifier"];
    let maxSpeed = value;
    let speed = value;
    let maxRun = value * 4;

    function reduceMaxSpeedFromEncumbrance(maxSpeed) {
      if (maxSpeed <= 30) {
        return Math.floor(maxSpeed / 2.0) + 5;
      } else if (maxSpeed <= 60) {
        return Math.floor(maxSpeed / 2.0) + 10;
      } else if (maxSpeed <= 90) {
        return Math.floor(maxSpeed / 2.0) + 15;
      } else if (maxSpeed <= 120) {
        return Math.floor(maxSpeed / 2.0) + 20;
      } else if (maxSpeed <= 150) {
        return Math.floor(maxSpeed / 2.0) + 25;
      } else if (maxSpeed <= 180) {
        return Math.floor(maxSpeed / 2.0) + 30;
      } else if (maxSpeed <= 210) {
        return Math.floor(maxSpeed / 2.0) + 35;
      } else if (maxSpeed <= 240) {
        return Math.floor(maxSpeed / 2.0) + 40;
      } else if (maxSpeed <= 270) {
        return Math.floor(maxSpeed / 2.0) + 45;
      }
      return Math.floor(maxSpeed / 2.0) + 50;
    }

    if (load / maxLoad > 2.0 && !flags.noEncumbrance) {
      speed = 0;
      maxRun = 0;
    } else if (load / maxLoad > 1.0 && !flags.noEncumbrance) {
      speed = 5;
      maxRun = 0;
    } else if (
      (armorItems.filter(
        (o) =>
          foundry.utils.getProperty(o.system, "equipmentSubtype") === "heavyArmor" &&
          o.system.equipped &&
          !o.system.melded &&
          !o.broken
      ).length &&
        !flags.heavyArmorFullSpeed) ||
      (load >= mediumLoad && !flags.noEncumbrance)
    ) {
      speed = reduceMaxSpeedFromEncumbrance(maxSpeed);
      maxRun = Math.max(1, 3 + runSpeedMultiplierModifier) * speed;
    } else if (
      (armorItems.filter(
        (o) =>
          foundry.utils.getProperty(o.system, "equipmentSubtype") === "mediumArmor" &&
          o.system.equipped &&
          !o.system.melded &&
          !o.broken
      ).length &&
        !flags.mediumArmorFullSpeed) ||
      (load >= lightLoad && !flags.noEncumbrance)
    ) {
      speed = reduceMaxSpeedFromEncumbrance(maxSpeed);
      maxRun = Math.max(1, 4 + runSpeedMultiplierModifier) * speed;
    } else {
      // "light" speed
      speed = maxSpeed;
      maxRun = Math.max(1, 4 + runSpeedMultiplierModifier) * maxSpeed;
    }
    if (value) {
      linkData(srcData1, updateData, `system.attributes.speed.${speedKey}.total`, speed);
      linkData(srcData1, updateData, `system.attributes.speed.${speedKey}.run`, maxRun);
    }
  }

  /**
   * Return increased amount of spell slots by ability score modifier.
   * @param {Number} mod - The associated ability modifier.
   * @param {Number} level - Spell level.
   * @returns {Number} Amount of spell levels to increase.
   */
  getSpellSlotIncrease(mod, level) {
    if (level === 0) return 0;
    if (mod <= 0) return 0;
    return Math.max(0, Math.ceil((mod + 1 - level) / 4));
  }
}
