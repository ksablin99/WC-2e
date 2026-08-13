import { DicePF } from '../dice.js';
import { Item35E } from '../item/entity.js';
import {
  createTag,
  getOriginalNameIfExists,
  getRollModesForSelect,
  getSystemTemplate,
  isMinimumCoreVersion,
  linkData,
  shuffle,
  sizeDie,
  uuidv4,
  CHAT_MESSAGE_STYLE_KEY,
  CHAT_MESSAGE_STYLE_OTHER,
  CHAT_MESSAGE_STYLE_CHAT,
} from '../lib.js';
import { createCustomChatMessage } from '../chat.js';
import { ActorDamageHelper } from './helpers/actorDamageHelper.js';
import { D35E } from '../config.js';
import { Roll35e } from '../roll.js';
import { ActorRestDialog } from '../apps/actor-rest.js';
import { VisionPermissionSheet } from '../apps/vision-permission.js';
import { ItemConsumableConverter } from '../item/converters/consumable.js';
import {
  ItemCombatChangesHelper,
} from '../item/helpers/itemCombatChangesHelper.js';
import { ItemPrepareDataHelper } from './helpers/itemPrepareDataHelper.js';
import { ActorBuffs } from './actions/buffs.js';
import { ActorConditions } from './actions/conditions.js';
import { ActorUpdater } from './update/actorUpdater.js';
import { LogHelper } from '../helpers/LogHelper.js';
import { ActorMinionsHelper } from './helpers/actorMinionsHelper.js';
import { ItemEnhancementHelper } from '../item/helpers/itemEnhancementHelper.js';
import { ActorCRHelper } from './helpers/actorCRHelper.js';
import { CombatChange } from '../item/extensions/combatChange.js';
import { ItemActiveHelper } from '../item/helpers/itemActiveHelper.js';
import { CACHE } from '../cache.js';
import { ActorPrepareSourceHelper } from './helpers/actorPrepareSourceHelper.js';
import { spellbookUsesSharedSlots } from '../item/helpers/spellbookPreparationHelper.js';
import {
  deriveDirectClassPathState,
  resolveClassPath,
  summarizeClassLevelRows,
} from './helpers/classPathProgressionHelper.js';
import {
  DEATH_RULE_WARCRAFT,
  resolveDeathRule,
  resolveWarcraftStabilization,
  resolveWarcraftStableRecovery,
  usesNaturalHitPointRecovery,
  warcraftStabilizationDc,
} from './helpers/warcraftDeathRules.js';
import {
  canApplyWarcraftAbilityDamage,
  canApplyWarcraftAbilityDrain,
  resolveWarcraftCreatureProfile,
} from './helpers/warcraftCreatureRules.js';
import { warcraftRestHitPointRecovery } from './helpers/warcraftNaturalRecovery.js';
import {
  clearPendingHeroPoint,
  heroPointRollBonus,
} from './helpers/warcraftHeroPoints.js';
import {
  allocateWarcraftPrestigeCasterLevels,
  evaluateWarcraftSpellEligibility,
  getWarcraftSlotPool,
} from './helpers/warcraftSpellcastingHelper.js';

/**
 * Extend the base Actor class to implement additional logic specialized for D&D5e.
 */
export class ActorPF extends Actor {
  /* -------------------------------------------- */
  static LOG_V10_COMPATIBILITY_WARNINGS = false;
  API_URI = "https://companion.legaciesofthedragon.com/";
  //API_URI = 'http://localhost:5000';
  static SPELL_AUTO_HIT = -1337;
  socketRoomConnected = false;
  socket = null;

  constructor(...args) {
    super(...args);

    /**
     * @property {object.<string>} _runningFunctions
     * Keeps track of currently running async functions that shouldn't run multiple times simultaneously.
     */
    if (this._runningFunctions === undefined) this._runningFunctions = {};
    if (this._cachedRollData ===
      undefined) this._cachedRollData = this.getRollData();
    if (this._cachedAuras === undefined)
      this._cachedAuras = this.items.filter(
        (o) => o.type === 'aura' && o.system.active);
    this.conditions = new ActorConditions(this);
    this.buffs = new ActorBuffs(this);
    this.crHelper = new ActorCRHelper(this);
    this.combatChangeItems = this.items.filter(
      (o) => ItemCombatChangesHelper.isCombatChangeItemType(o));
  }

  /* -------------------------------------------- */

  get isCharacterType() {
    return this.type !== 'trap' && this.type !== 'object';
  }

  isInvisible() {
    return foundry.utils.getProperty(this.system, `attributes.conditions.invisible`) || false;
  }

  isBanished() {
    return foundry.utils.getProperty(this.system, `attributes.conditions.banished`) || false;
  }

  get spellFailure() {
    if (this.items == null) return foundry.utils.getProperty(this.system,
      'attributes.arcaneSpellFailure') || 0;
    return this.items.filter((o) => {
      return o.type === 'equipment' && o.system.equipped === true &&
        !o.system.melded && !o.broken;
    }).reduce((cur, o) => {
      if (typeof o.system.spellFailure === 'number') return cur +
        o.system.spellFailure;
      return cur;
    }, foundry.utils.getProperty(this.system, 'attributes.arcaneSpellFailure') || 0);
  }

  get auras() {
    if (!this._cachedAuras) this._cachedAuras = this.items.filter(
      (o) => o.type === 'aura' && o.system.active);
    return this._cachedAuras;
  }

  getAura(auraId) {
    return this.auras.find(
      (o) => o.id === auraId || o.system.sourceAuraId === auraId);
  }

  get trackedBuffs() {
    if (this.items == null) return null;
    return this.items.filter(
      (o) =>
        (o.type === 'buff' && foundry.utils.getProperty(o.system, 'active') &&
          foundry.utils.getProperty(o.system, 'timeline.enabled')) ||
        (o.type === 'aura' && foundry.utils.getProperty(o.system, 'active') &&
          !foundry.utils.getProperty(o.system, 'sourceTokenId')),
    );
  }

  get race() {
    if (this.items == null) return null;
    return this.items.filter((o) => o.type === 'race')[0];
  }

  get material() {
    if (this.items == null) return null;
    return this.items.filter((o) => o.type === 'material')[0];
  }

  get racialHD() {
    if (this.items == null) return null;
    return this.items.find(
      (o) => o.type === 'class' &&
        (foundry.utils.getProperty(o.system, 'classType') === 'racial' ||
          o.name.endsWith('*')),
    );
  }

  get displayName() {
    return this.name;
  }

  async updateTokenLight(
    dimLight, o, brightLight, color, animationIntensity, type, animationSpeed,
    lightAngle, alpha) {
    const tokenLight = o.document?.light ?? o.light;
    if (
      dimLight !== tokenLight.dim ||
      brightLight !== tokenLight.bright ||
      color !== tokenLight.color ||
      animationIntensity !== tokenLight.animation.intensity ||
      type !== tokenLight.animation.type ||
      animationSpeed !== tokenLight.animation.speed ||
      lightAngle !== tokenLight.angle
    )
      if (o.document) {
        await o.document.update(
          {
            light: {
              dim: dimLight,
              bright: brightLight,
              color: color || '#000',
              alpha: alpha,
              angle: lightAngle,
              animation: {
                type: type,
                intensity: animationIntensity,
                speed: animationSpeed,
              },
            },
          },
          { stopUpdates: true, tokenOnly: true },
        );
      } else {
        await o.update(
          {
            light: {
              dim: dimLight,
              bright: brightLight,
              color: color || '#000',
              alpha: alpha,
              angle: lightAngle,
              animation: {
                type: type,
                intensity: animationIntensity,
                speed: animationSpeed,
              },
            },
          },
          { stopUpdates: true, tokenOnly: true },
        );
      }
  }

  async _updateChanges({ updated = null } = {}, options = {}) {
    // Must persist updateChanges output like Actor.update() does; updateChanges alone only computes diff.
    return this.update(updated ?? {}, options);
  }

  get originalName() {
    this.getFlag('babele', 'translated') ? this.getFlag('babele',
      'originalName') : this.name;
  }

  /**
   * Augment the basic actor data with additional dynamic data.
   */
  prepareData() {
    super.prepareData();

    const actorData = this;
    const preparedData = actorData.system;

    // Prepare Character data
    if (actorData.type === 'character') this._prepareCharacterData(actorData);
    else if (actorData.type === 'npc') this._prepareNPCData(preparedData);

    // Client _onCreate is not awaited; mirror positive hp.base into hp.max when max is still unset so
    // prepare matches data before async _updateChanges persists (GL#1523).
    {
      const hp = preparedData.attributes?.hp;
      if (hp) {
        const baseN = Number(hp.base);
        const maxN = Number(hp.max);
        if (Number.isFinite(baseN) && baseN > 0 && (!Number.isFinite(maxN) || maxN === 0)) {
          hp.max = baseN;
        }
      }
    }

    // Create arbitrary skill slots
    for (let skillId of CONFIG.D35E.arbitrarySkills) {
      if (preparedData.skills[skillId] == null) continue;
      let skill = preparedData.skills[skillId];
      skill.subSkills = skill.subSkills || {};
      skill.namedSubSkills = {};
      for (let subSkillId of Object.keys(skill.subSkills)) {
        if (skill.subSkills[subSkillId] == null ||
          skill.subSkills[subSkillId].name === undefined) {
          delete skill.subSkills[subSkillId];
        } else {
          skill.namedSubSkills[createTag(
            skill.subSkills[subSkillId].name)] = skill.subSkills[subSkillId];
        }
      }
    }

    // Delete removed skills
    for (let skillId of Object.keys(preparedData.skills)) {
      let skl = preparedData.skills[skillId];
      if (skl == null) {
        delete preparedData.skills[skillId];
      }
    }

    //
    preparedData.counters = {};

    // Set class tags
    let totalNonRacialLevels = 0;
    preparedData.classes = {};
    preparedData.totalNonEclLevels = 0;
    preparedData.damage = {
      nonlethal: {
        value: preparedData.attributes.hp.nonlethal || 0,
        max: preparedData.attributes.hp.max || 0,
      },
    };
    actorData.items.filter((obj) => {
      return obj.type === 'class';
    }).forEach((cls) => {
      let tag = createTag(cls.system.customTag || cls.name);
      let nameTag = createTag(cls.name);
      let originalNameTag = createTag(cls.originalName);

      cls.system.baseTag = tag;
      cls.system.nameTag = nameTag;

      let count = 1;
      while (
        actorData.items.filter((obj) => {
          return obj.type === 'class' && obj.system.tag === tag && obj !==
            cls;
        }).length > 0
      ) {
        count++;
        tag = createTag(cls.system.customTag || cls.name) + count.toString();
        nameTag = createTag(cls.name);
      }
      cls.system.tag = tag;
      preparedData.totalNonEclLevels += cls.system.classType !== 'template'
        ? cls.system.levels
        : 0;
      let healthConfig = game.settings.get('warcraftrpg2e', 'healthConfig');
      healthConfig =
        cls.system.classType === 'racial'
          ? healthConfig.hitdice.Racial
          : this.hasPlayerOwner
            ? healthConfig.hitdice.PC
            : healthConfig.hitdice.NPC;
      const classType = cls.system.classType || 'base';
      const classPathState = deriveDirectClassPathState(cls.system);
      preparedData.classes[tag] = {
        level: cls.system.levels,
        id: cls.id,
        name: cls.name,
        hd: cls.system.hd,
        bab: cls.system.bab,
        hp: healthConfig.auto,
        maxLevel: cls.system.maxLevel,
        skillsPerLevel: cls.system.skillsPerLevel,
        isSpellcaster: cls.system.spellcastingType !== null &&
          cls.system.spellcastingType !== 'none',
        isPsionSpellcaster: cls.system.spellcastingType !== null &&
          cls.system.spellcastingType === 'psionic',
        hasSpecialSlot: cls.system.hasSpecialSlot,
        isSpellcastingSpontaneus: cls.system.spellcastingSpontaneus === true,
        spellcastingPreparationMode: cls.system.spellcastingPreparationMode || "",
        repertoireSkill: cls.system.repertoireSkill || "spl",
        usesWarcraftSlotPool: cls.system.usesWarcraftSlotPool === true,
        warcraftPoolKey: cls.system.warcraftPoolKey || cls.system.spellslotAbility || cls.system.spellcastingAbility || "",
        warcraftParentClass: cls.system.warcraftParentClass || cls.name,
        warcraftPathBonusSlot: cls.system.warcraftPathBonusSlot === true,
        specialSlotLevel0: cls.system.specialSlotLevel0 === true,
        isArcane: cls.system.spellcastingType !== null &&
          cls.system.spellcastingType === 'arcane',
        spellcastingType: cls.system.spellcastingType,
        spellcastingAbility: cls.system.spellcastingAbility,
        spellslotAbility: cls.system.spellslotAbility,
        allSpellsKnown: cls.system.allSpellsKnown,
        halfCasterLevel: cls.system.halfCasterLevel,
        deckHandSizeFormula: cls.system.deckHandSizeFormula,
        knownCardsSizeFormula: cls.system.knownCardsSizeFormula,
        deckPrestigeClass: cls.system.deckPrestigeClass,
        hasSpellbook: cls.system.hasSpellbook,
        classPaths: classPathState.classPaths,
        pathLevels: classPathState.pathLevels,
        currentPath: classPathState.currentPath,

        savingThrows: {
          fort: 0,
          ref: 0,
          will: 0,
        },
        fc: {
          hp: classType === 'base' ? cls.system.fc.hp.value : 0,
          skill: classType === 'base' ? cls.system.fc.skill.value : 0,
          alt: classType === 'base' ? cls.system.fc.alt.value : 0,
        },
      };
      preparedData.classes[tag].spellsKnownPerLevel = [];
      preparedData.classes[tag].powersKnown = [];
      preparedData.classes[tag].powersMaxLevel = [];
      for (let _level = 1; _level < cls.system.maxLevel + 1; _level++) {
        preparedData.classes[tag][`spellPerLevel${_level}`] =
          cls.system.spellcastingType !== null &&
            cls.system.spellcastingType !== 'none'
            ? cls.system.spellsPerLevel[_level - 1]
            : undefined;
        if (cls.system.spellcastingType !== null &&
          cls.system.spellcastingType !== 'none')
          preparedData.classes[tag].spellsKnownPerLevel.push(
            cls.system.spellsKnownPerLevel[_level - 1]);
        if (cls.system.spellcastingType !== null &&
          cls.system.spellcastingType !== 'none')
          preparedData.classes[tag].powersKnown.push(
            cls.system.powersKnown[_level - 1]);
        if (cls.system.spellcastingType !== null &&
          cls.system.spellcastingType !== 'none')
          preparedData.classes[tag].powersMaxLevel.push(
            cls.system.powersMaxLevel[_level - 1]);
      }
      for (let k of Object.keys(preparedData.classes[tag].savingThrows)) {
        let formula = CONFIG.D35E.classSavingThrowFormulas[classType][cls.system.savingThrows[k].value];
        if (formula == null) formula = '0';
        preparedData.classes[tag].savingThrows[k] = new Roll35e(formula,
          { level: cls.system.levels }).evaluateSync().total;
      }
      if (cls.system.classType !== 'racial')
        totalNonRacialLevels = Math.min(
          totalNonRacialLevels + cls.system.levels, 20);

      if (nameTag !==
        tag) preparedData.classes[nameTag] = preparedData.classes[tag];
      if (originalNameTag !==
        tag) preparedData.classes[originalNameTag] = preparedData.classes[tag];

      preparedData.classes[tag].spelllist = new Map();
      for (let a = 0; a < 10; a++) {
        (cls.system?.spellbook[a]?.spells || []).forEach((spell) => {
          spell.level = a;
          preparedData.classes[tag].spelllist.set(`${spell.pack}.${spell.id}`,
            spell);
        });
      }
    });

    const warcraftCasterAdvancement = allocateWarcraftPrestigeCasterLevels(
      actorData.items.filter((obj) => obj.type === 'class'),
    );
    for (const [classTag, casterLevels] of Object.entries(
      warcraftCasterAdvancement.byClass)) {
      if (preparedData.classes[classTag]) {
        preparedData.classes[classTag].warcraftCasterLevelBonus = casterLevels;
      }
    }
    preparedData.warcraftUnresolvedCasterAdvancement = warcraftCasterAdvancement.unresolved;

    let naturalAttackCount = (actorData.items || []).filter(
      (o) => o.type === 'attack' && o.system.attackType === 'natural',
    )?.length;
    preparedData.naturalAttackCount = naturalAttackCount;

    preparedData.classLevels = totalNonRacialLevels;
    {
      let group = 'feat';
      let name = 'base';
      if (preparedData.counters[group] === undefined) {
        preparedData.counters[group] = {};
      }
      if (preparedData.counters[group][name] === undefined) {
        preparedData.counters[group][name] = { value: 0, counted: 0 };
      }
      preparedData.counters[group][name].value = Math.floor(
        preparedData.totalNonEclLevels / 3.0) + 1;
    }

    preparedData.combinedResistances = preparedData.energyResistance
      ? foundry.utils.duplicate(preparedData.energyResistance)
      : [];
    preparedData.combinedDR = preparedData.damageReduction ? foundry.utils.duplicate(
      preparedData.damageReduction) : [];
    const creatureProfile = resolveWarcraftCreatureProfile({
      creatureType: preparedData.attributes.creatureType,
      deathRule: resolveDeathRule(
        preparedData.attributes.deathRule,
        this.race?.system?.deathRule,
        preparedData.attributes.creatureType,
      ),
    });
    if (creatureProfile.immunities.length) {
      const existing = String(preparedData.traits.ci.custom || '')
        .split(';').map((entry) => entry.trim()).filter(Boolean);
      preparedData.traits.ci.custom = [...new Set([...existing, ...creatureProfile.immunities])].join('; ');
    }
    let erDrRollData = this.getRollData();

    for (let [a, abl] of Object.entries(preparedData.abilities)) {
      preparedData.abilities[a].isZero = abl.total === 0 && abl.mod === 0;
    }

    preparedData.shieldType = 'none';
    this.items.filter((obj) => {
      return ItemActiveHelper.isActive(obj);
    }).forEach((_obj) => {
      ItemPrepareDataHelper.prepareResistancesForItem(_obj, erDrRollData,
        preparedData);
      ItemPrepareDataHelper.prepareCountersForItem(_obj, preparedData);
    });
    actorData.items.filter((obj) => {
      return (
        obj.type === 'feat' &&
        obj.system.featType === 'feat' &&
        (obj.system.source === undefined || obj.system.source === '')
      );
    }).forEach((obj) => {
      let group = 'feat';
      let name =
        obj.system.classSource !== undefined && obj.system.classSource !== ''
          ? obj.system.classSource
          : 'base';
      if (preparedData.counters[group][name] === undefined) {
        preparedData.counters[group][name] = { value: 0, counted: 0 };
      }
      preparedData.counters[group][name].counted++;
    });

    // Prepare modifier containers
    preparedData.attributes.mods = preparedData.attributes.mods || {};
    preparedData.attributes.mods.skills = preparedData.attributes.mods.skills ||
      {};

    let spellcastingBonusTotalUsed = {
      psionic: 0,
      arcane: 0,
      divine: 0,
      cards: 0,
    };

    for (let spellbook of Object.values(
      preparedData.attributes.spells.spellbooks)) {
      if (spellbook.class !== '' && preparedData.classes[spellbook.class] !=
        null) {
        let spellcastingType = preparedData.classes[spellbook.class].spellcastingType;
        spellcastingBonusTotalUsed[spellcastingType] += spellbook.bonusPrestigeCl;
      }
    }

    for (let deck of Object.values(
      preparedData.attributes?.cards?.decks || {})) {
      if (deck.class !== '' && preparedData.classes[deck.class] != null) {
        spellcastingBonusTotalUsed['cards'] += deck.bonusPrestigeCl;
      }
    }

    preparedData.senses = foundry.utils.duplicate(
      foundry.utils.getProperty(this.system, 'attributes.senses')) || {};
    if (!preparedData.senses.modified) preparedData.senses.modified = {};
    for (let i of this.items.values()) {
      if (!i.system.hasOwnProperty('senses')) continue;
      if (
        (i.system.equipped && !i.system.melded && !i.broken) ||
        i.type === 'race' ||
        i.type === 'class' ||
        i.type === 'feat' ||
        (i.type === 'buff' && i.system.active) ||
        (i.type === 'aura' && i.system.active)
      ) {
        for (let [k, label] of Object.entries(CONFIG.D35E.senses)) {
          if (preparedData.senses[k] !==
            Math.max(preparedData.senses[k], i.system.senses[k] || 0)) {
            preparedData.senses[k] = Math.max(preparedData.senses[k],
              i.system.senses[k] || 0);
            preparedData.senses.modified[k] = true;
          }
        }
        preparedData.senses.darkvision = Math.max(
          preparedData.senses.darkvision, i.system.senses?.darkvision || 0);
        if (preparedData.senses.lowLight !== i.system.senses?.lowLight) {
          preparedData.senses.lowLight = preparedData.senses.lowLight ||
            i.system.senses?.lowLight || false;
          preparedData.senses.modified['lowLight'] = true;
        }
        if (preparedData.senses.lowLightMultiplier !==
          i.system.senses?.lowLightMultiplier) {
          preparedData.senses.lowLightMultiplier =
            preparedData.senses.lowLightMultiplier <
              (i.system.senses?.lowLightMultiplier || 2)
              ? i.system.senses?.lowLightMultiplier || 2
              : preparedData.senses.lowLightMultiplier;
          preparedData.senses.modified['lowLight'] = true;
        }
      }
    }

    for (let spellbook of Object.values(
      preparedData.attributes.spells.spellbooks)) {
      if (!spellbook.cl) continue;
      // Set CL
      spellbook.maxPrestigeCl = 0;
      spellbook.allSpellsKnown = false;
      try {
        let roll = new Roll35e(spellbook.cl.formula, preparedData).evaluateSync();
        spellbook.cl.total = roll.total || 0;
      } catch (e) {
        spellbook.cl.total = 0;
      }
      if (actorData.type === 'npc') spellbook.cl.total += spellbook.cl.base;
      if (spellbook.class === '_hd') {
        spellbook.cl.total += preparedData.attributes.hd.total;
      } else if (spellbook.class !== '' &&
        preparedData.classes[spellbook.class] != null) {
        if (preparedData.classes[spellbook.class]?.halfCasterLevel)
          spellbook.cl.total += Math.floor(
            preparedData.classes[spellbook.class].level / 2);
        else spellbook.cl.total += preparedData.classes[spellbook.class].level;
        spellbook.cl.total += preparedData.classes[spellbook.class].warcraftCasterLevelBonus || 0;
        let spellcastingType = spellbook.spellcastingType;
        if (
          spellcastingType !== undefined &&
          spellcastingType !== null &&
          spellcastingType !== 'none' &&
          spellcastingType !== 'other'
        ) {
          if (preparedData.attributes.prestigeCl[spellcastingType]?.max !==
            undefined) {
            spellbook.maxPrestigeCl = preparedData.attributes.prestigeCl[spellcastingType].max;
            spellbook.availablePrestigeCl =
              preparedData.attributes.prestigeCl[spellcastingType].max -
              spellcastingBonusTotalUsed[spellcastingType];
          }
        }

        spellbook.allSpellsKnown = preparedData.classes[spellbook.class]?.allSpellsKnown;
      }
      spellbook.hasPrestigeCl = spellbook.maxPrestigeCl > 0;
      spellbook.canAddPrestigeCl = spellbook.availablePrestigeCl > 0;
      spellbook.canRemovePrestigeCl = spellbook.bonusPrestigeCl > 0;
      spellbook.powersKnown = preparedData.classes[spellbook.class]?.powersKnown
        ? preparedData.classes[spellbook.class]?.powersKnown[`${preparedData.classes[spellbook.class].level}`] ||
        0
        : 0;
      spellbook.powersMaxLevel = preparedData.classes[spellbook.class]?.powersMaxLevel
        ? preparedData.classes[spellbook.class]?.powersMaxLevel[`${preparedData.classes[spellbook.class].level}`] ||
        0
        : 0;
      spellbook.cl.total += spellbook.bonusPrestigeCl === undefined
        ? 0
        : spellbook.bonusPrestigeCl;
      spellbook.powerPointsValue = {
        max: spellbook.powerPointsTotal || 0,
        value: spellbook.powerPoints || 0,
      };
      // Add spell slots
      spellbook.spells = spellbook.spells || {};
      for (let a = 0; a < 10; a++) {
        spellbook.spells[`spell${a}`] = spellbook.spells[`spell${a}`] || {
          value: 0,
          max: 0,
          base: null,
          known: 0,
        };
        let spellbookClassLevel = (preparedData.classes[spellbook.class]?.level ||
          0) + spellbook.bonusPrestigeCl;
        spellbook.spells[`spell${a}`].maxKnown = preparedData.classes[spellbook.class]?.spellsKnownPerLevel
          ? Math.max(
            0,
            preparedData.classes[spellbook.class]?.spellsKnownPerLevel[spellbookClassLevel -
              1]
              ? preparedData.classes[spellbook.class]?.spellsKnownPerLevel[spellbookClassLevel -
              1][a + 1] || 0
              : 0,
          )
          : 0;
      }
    }
    for (let deck of Object.values(
      preparedData.attributes?.cards?.decks || {})) {
      // Set CL
      deck.maxPrestigeCl = 0;

      if (deck.class !== '' && preparedData.classes[deck.class] != null) {
        let spellcastingType = 'cards';
        if (
          spellcastingType !== undefined &&
          spellcastingType !== null &&
          spellcastingType !== 'none' &&
          spellcastingType !== 'other'
        ) {
          if (preparedData.attributes.prestigeCl[spellcastingType]?.max !==
            undefined) {
            deck.maxPrestigeCl = preparedData.attributes.prestigeCl[spellcastingType].max;
            deck.availablePrestigeCl =
              preparedData.attributes.prestigeCl[spellcastingType].max -
              spellcastingBonusTotalUsed[spellcastingType];
          }
        }
      }
      deck.hasPrestigeCl = deck.maxPrestigeCl > 0;
      deck.canAddPrestigeCl = deck.availablePrestigeCl > 0;
      deck.canRemovePrestigeCl = deck.bonusPrestigeCl > 0;
    }

    preparedData.canLevelUp = preparedData.details.xp.value >=
      preparedData.details.xp.max;
    this.combatChangeItems = this.items.filter(
      (o) => ItemCombatChangesHelper.isCombatChangeItemType(o));
    if (this.isCompanionSetUp) {
      this.connectToCompanionSocket();
      if (this.canAskForRequest) {
        this.connectToCompanionCharacterRoom();
      } else {
        this.disconnectFromCompanionCharacterRoom();
      }
    }

    this._computeAlignment(preparedData);
  }

  /**
   * Derive alignment code and label from the actor's alignment settings.
   * Populates `details.alignmentCode` and `details.alignmentLabel` on the
   * prepared data object so templates and other systems can use them.
   *
   * @param {object} preparedData  – actor's system data object (mutable)
   */
  _computeAlignment(preparedData) {
    const details = preparedData.details;
    const mode = details.alignmentMode ?? "text";

    /** Map axis values to their 1-char codes used in the alignment table. */
    const LC_MAP = { l: "l", n: "n", c: "c", any: "any" };
    const GE_MAP = { g: "g", n: "n", e: "e", any: "any" };

    /** Build a human-readable label from axis values. */
    const axisLabel = (lc, ge) => {
      // Special case: both neutral → "True Neutral"
      if (lc === "n" && ge === "n") return game.i18n.localize("D35E.AlignmentTN");
      const parts = [];
      if (lc === "l") parts.push(game.i18n.localize("D35E.AlignmentLawful"));
      else if (lc === "c") parts.push(game.i18n.localize("D35E.AlignmentChaotic"));
      else if (lc === "n") parts.push(game.i18n.localize("D35E.AlignmentNeutral"));
      else if (lc === "any") parts.push(game.i18n.localize("D35E.AlignmentAny"));
      if (ge === "g") parts.push(game.i18n.localize("D35E.AlignmentGood"));
      else if (ge === "e") parts.push(game.i18n.localize("D35E.AlignmentEvil"));
      else if (ge === "n") parts.push(game.i18n.localize("D35E.AlignmentNeutral"));
      else if (ge === "any") parts.push(game.i18n.localize("D35E.AlignmentAny"));
      return parts.join(" ");
    };

    /** Build a 2-char code from axis values (used by intelligent items). */
    const axisCode = (lc, ge) => `${lc}${ge}`;

    if (mode === "unaligned") {
      details.alignmentCode = "un";
      details.alignmentLabel = game.i18n.localize("D35E.AlignmentUnaligned");
      details.alignmentUnaligned = 1;
      details.alignmentAxes = { lawChaos: "", goodEvil: "" };
      details.actualAlignmentAxes = { lawChaos: "", goodEvil: "" };
    } else if (mode === "axes") {
      const lc = LC_MAP[details.actualAlignmentAxes?.lawChaos ?? details.alignmentAxes?.lawChaos] ?? "n";
      const ge = GE_MAP[details.actualAlignmentAxes?.goodEvil ?? details.alignmentAxes?.goodEvil] ?? "n";
      details.alignmentCode = axisCode(lc, ge);
      details.alignmentLabel = axisLabel(lc, ge);
      details.alignmentUnaligned = 0;
      details.actualAlignmentAxes = { lawChaos: lc, goodEvil: ge };
      // Normalize base axes too (keep user's stored values, just ensure valid)
      const baseLc = LC_MAP[details.alignmentAxes?.lawChaos] ?? "n";
      const baseGe = GE_MAP[details.alignmentAxes?.goodEvil] ?? "n";
      details.alignmentAxes = { lawChaos: baseLc, goodEvil: baseGe };
    } else {
      // "text" mode — use the raw text field; no structured code
      details.alignmentCode = "";
      details.alignmentLabel = details.alignment ?? "";
      details.alignmentUnaligned = 0;
      details.alignmentAxes = details.alignmentAxes ?? { lawChaos: "", goodEvil: "" };
      details.actualAlignmentAxes = { lawChaos: "", goodEvil: "" };
    }
  }

  async refresh(options = {}) {
    if (this.testUserPermission(game.user, 'OWNER') && options.stopUpdates !==
      true) {
      if (options.reloadAuras) {
        this._cachedAuras = null;
      }
      return this.update({});
    }
  }

  async refreshWithData(data, options = {}) {
    if (this.testUserPermission(game.user, 'OWNER') && options.stopUpdates !==
      true) {
      return this.update(data);
    }
  }

  /**
   * Prepare Character type specific
   * data
   */
  _prepareCharacterData(actorData) {
    if (!foundry.utils.hasProperty(actorData.system, 'details.level.value')) return;

    const data = actorData.system;

    let priorLevel = data.details.level.available - 1;
    if (this.items != null) {
      let raceObject = this.items.filter((o) => o.type === "race")[0];
      if (raceObject?.system?.la) {
        priorLevel += raceObject.system.la;
      }
      this.items
        .filter((o) => o.type === "class")
        .forEach((c) => {
          priorLevel += c.system?.la || 0;
        });
    }

    // Experience bar
    let prior = this.getLevelExp(Math.max(0, priorLevel)),
      req = (data.details.xp.max - prior) || 1,
      current = data.details.xp.value - prior;
    data.details.xp.pct = Math.min(Math.round(current * 100 / req), 99.5);
  }

  /* -------------------------------------------- */

  /**
   * Prepare NPC type specific data
   */
  _prepareNPCData(npcData) {
    if (!foundry.utils.hasProperty(npcData.system, 'details.cr')) return;

    // Kill Experience
    npcData.system.details.xp.value = this.getCRExp(
      npcData.system.details.totalCr);
  }

  /**
   * Return the amount of experience required to gain a certain character level.
   * @param level {Number}  The desired level
   * @return {Number}       The XP required
   */
  getLevelExp(level) {
    const expRate = game.settings.get('warcraftrpg2e', 'experienceRate');
    const levels = CONFIG.D35E.CHARACTER_EXP_LEVELS[expRate];
    return levels[Math.min(level, levels.length - 1)];
  }

  /* -------------------------------------------- */

  /**
   * Return the amount of experience granted by killing a creature of a certain CR.
   * @param cr {Number}     The creature's challenge rating
   * @return {Number}       The amount of experience granted per kill
   */
  getCRExp(cr) {
    if (cr < 1.0) return Math.max(400 * cr, 10);
    return CONFIG.D35E.CR_EXP_LEVELS[cr];
  }

  /* -------------------------------------------- */

  /*  Socket Listeners and Handlers
  /* -------------------------------------------- */

  /**
   * Extend the default update method to enhance data before submission.
   * See the parent Entity.update method for full details.
   *
   * @param {Object} updated     The data with which to update the Actor
   * @param {Object} options  Additional options which customize the update workflow
   * @return {Promise}        A Promise which resolves to the updated Entity
   */
  async update(updated, options = {}) {
    // If its actor in locked compendium, return
    if (this.compendium && this.compendium.locked) {
      return;
    }


    if (options['recursive'] === false) {
      return super.update(updated, options);
    }
    LogHelper.log('ACTOR UPDATE | Running update');
    let diff = await new ActorUpdater(this).update(updated, options);

    let returnActor = null;
    if (Object.keys(diff).length) {
      let updateOptions = foundry.utils.mergeObject(options, { diff: true });
      returnActor = await super.update(diff, updateOptions);
    }

    await this.conditions.toggleConditionStatusIcons();

    ActorMinionsHelper.updateMinions(this, options);

    this._cachedRollData = null;
    this._cachedAuras = null;
    LogHelper.log('ACTOR UPDATE | Finished update');
    return Promise.resolve(returnActor ? returnActor : this);
  }

  _onUpdate(updated, options, userId, context) {
    if (
      foundry.utils.hasProperty(updated, 'system.attributes.senses.lowLight') ||
      foundry.utils.hasProperty(updated, 'system.attributes.senses.darkvision')
    ) {
      try {
        canvas.perception.update({ initializeVision: true });
      } catch (e) { }
    }

    let actorRollData = foundry.utils.mergeObject(this.getRollData(), updated,
      { inplace: false });
    for (let i of this.items.values()) {
      let itemUpdateData = {};

      i._updateMaxUses(itemUpdateData, { actorRollData: actorRollData });
      if (Object.keys(itemUpdateData).length > 0) {
        const itemDiff = foundry.utils.diffObject(foundry.utils.flattenObject(i.toObject()),
          itemUpdateData);
        if (Object.keys(itemDiff).length > 0) i.update(itemDiff);
      }
    }
    return super._onUpdate(updated, options, userId, context);
  }




  async updateClassProgressionLevel(
    data, globalUpdateData, data1, levelUpData) {
    //LogHelper.log('ActorPF | updateClassProgressionLevel | Starting update')
    const classes = this.items.filter(
      (o) => o.type === 'class' && foundry.utils.getProperty(o.system, 'classType') !==
        'template').sort((a, b) => {
          return a.sort - b.sort;
        });
    let updateData = {};
    // Iterate over all levl ups
    if (data1.details.levelUpData && data1.details.levelUpProgression) {
      levelUpData.forEach((lud) => {
        if (lud.classId === null || lud.classId === '') return;
        let _class = this.items.get(lud.classId);
        if (_class == null) {
          lud.classId = null;
          lud.classImage = null;
          lud.skills = {};
          lud.class = null;
          lud.path = null;
          return;
        }
        lud.path = resolveClassPath(_class.system, lud.path) || null;
        Object.keys(lud.skills).forEach((s) => {
          updateData[`system.skills.${s}.points`] =
            (lud.skills[s].points || 0) * (lud.skills[s].cls ? 1 : 0.5) +
            (updateData[`system.skills.${s}.points`] || 0);
          if (lud.skills[s].subskills) {
            Object.keys(lud.skills[s].subskills).forEach((sb) => {
              updateData[`system.skills.${s}.subSkills.${sb}.points`] =
                lud.skills[s].subskills[sb].points *
                (lud.skills[s].subskills[sb].cls ? 1 : 0.5) +
                (updateData[`system.skills.${s}.subSkills.${sb}.points`] ||
                  0);
            });
          }
        });
      });
      const classProgression = summarizeClassLevelRows(levelUpData, classes);
      Object.keys(levelUpData[0]?.skills || {}).forEach((s) => {
        updateData[`system.skills.${s}.points`] = Math.floor(
          updateData[`system.skills.${s}.points`] || 0);
        if (levelUpData[0].skills[s].subskills) {
          Object.keys(levelUpData[0].skills[s].subskills).forEach((sb) => {
            updateData[`system.skills.${s}.subSkills.${sb}.points`] = Math.floor(
              updateData[`system.skills.${s}.subSkills.${sb}.points`] || 0,
            );
          });
        }
      });

      for (var _class of classes) {
        const progression = classProgression.get(_class.id);
        let itemUpdateData = {};
        itemUpdateData['id'] = _class.id;
        itemUpdateData['system.levels'] = progression?.levels || 0;
        itemUpdateData['system.hp'] = progression?.hp || 0;
        if (progression?.classPaths.enabled) {
          itemUpdateData['system.pathLevels'] = progression.pathLevels;
          itemUpdateData['system.currentPath'] = progression.currentPath;
        }
        await this.updateEmbeddedDocuments('Item', [itemUpdateData], { stopUpdates: true, massUpdate: true });

        //LogHelper.log(`ActorPF | updateClassProgressionLevel | Updated class item ${_class.name}`)
      }

      for (let [k, s] of Object.entries(foundry.utils.getProperty(data, 'system.skills'))) {
        linkData(data, globalUpdateData, `system.skills.${k}.points`,
          updateData[`system.skills.${k}.points`] || 0);
        for (let k2 of Object.keys(foundry.utils.getProperty(s, 'subSkills') || {})) {
          linkData(
            data,
            globalUpdateData,
            `system.skills.${k}.subSkills.${k2}.points`,
            updateData[`system.skills.${k}.subSkills.${k2}.points`] || 0,
          );
        }
      }

      //LogHelper.log('ActorPF | updateClassProgressionLevel | Update done')
    } else {
      //LogHelper.log('ActorPF | updateClassProgressionLevel | Update skipped, no levelUpData')
    }
  }

  async _onCreate(data, options, userId, context) {
    await super._onCreate(data, options, userId, context);
    if (userId === game.user.id) {
      await this._updateChanges({}, { preserveCurrentHitPoints: true });
    }
  }

  updateItemResources(item) {
    if (!(item instanceof Item)) return;
    if (!this.testUserPermission(game.user, 'OWNER')) return;

    if (item.system.uses != null && item.system.activation != null &&
      item.system.activation.type !== '') {
      const itemTag = createTag(item.name);
      const itemCustomTag = createTag(item.system.customTag);
      let curUses = item.system.uses;

      if (foundry.utils.getProperty(this.system, 'resources') == null) foundry.utils.setProperty(
        this.system, 'resources', {});
      if (this.system.resources[itemTag] == null)
        this.system.resources[itemTag] = {
          value: 0,
          max: 1,
          _id: '',
        };

      const updateData = {};
      if (this.system.resources[itemTag].value !== curUses.value) {
        updateData[`system.resources.${itemTag}.value`] = curUses.value;
      }
      if (this.system.resources[itemTag].max !== curUses.max) {
        updateData[`system.resources.${itemTag}.max`] = curUses.max;
      }
      if (this.system.resources[itemTag]._id !== item.id) {
        updateData[`system.resources.${itemTag}._id`] = item.id;
      }
      if (itemCustomTag) {
        if (this.system.resources[itemCustomTag] == null)
          this.system.resources[itemCustomTag] = {
            value: 0,
            max: 1,
            _id: '',
          };
        const updateData = {};
        if (this.system.resources[itemCustomTag].value !== curUses.value) {
          updateData[`system.resources.${itemCustomTag}.value`] = curUses.value;
        }
        if (this.system.resources[itemCustomTag].max !== curUses.max) {
          updateData[`system.resources.${itemCustomTag}.max`] = curUses.max;
        }
        if (this.system.resources[itemCustomTag]._id !== item.id) {
          updateData[`system.resources.${itemCustomTag}._id`] = item.id;
        }
      }

      if (Object.keys(updateData).length > 0) this.update(updateData);
    }
  }

  getItemResourcesUpdate(item, updateData) {
    if (!(item instanceof Item)) return;
    if (!this.testUserPermission(game.user, 'OWNER')) return;

    if (
      item.system.uses != null &&
      item.system.uses.isResource &&
      item.system.activation != null &&
      item.system.activation.type !== ''
    ) {
      const itemTag = createTag(item.name);
      let curUses = item.system.uses;

      if (foundry.utils.getProperty(this.system, 'resources') == null) foundry.utils.setProperty(
        this.system, 'resources', {});
      if (this.system.resources[itemTag] == null)
        this.system.resources[itemTag] = {
          value: 0,
          max: 1,
          _id: '',
        };
      if (this.system.resources[itemTag].value !== curUses.value) {
        updateData[`system.resources.${itemTag}.value`] = curUses.value;
      }
      if (this.system.resources[itemTag].max !== curUses.max) {
        updateData[`system.resources.${itemTag}.max`] = curUses.max;
      }
      if (this.system.resources[itemTag]._id !== item.id) {
        updateData[`system.resources.${itemTag}._id`] = item.id;
      }
    }
  }

  /* -------------------------------------------- */

  /**
   * See the base Actor class for API documentation of this method
   */
  async createItemWithDefaults(itemData, options) {
    let t = itemData.type;
    let initial = {};
    // Assume NPCs are always proficient with weapons and always have spells prepared
    if (!this.hasPlayerOwner) {
      if (t === 'weapon') initial['system.proficient'] = true;
      if (['weapon', 'equipment'].includes(
        t)) initial['system.equipped'] = true;
    }
    if (t === 'spell') {
      if (this.sheet != null && this.sheet._spellbookTab != null) {
        initial['system.spellbook'] = this.sheet._spellbookTab;
      }
    }
    foundry.utils.mergeObject(itemData, initial);

    return this.createEmbeddedDocuments('Item', itemData instanceof Array ? itemData : [itemData], options);
  }

  /* -------------------------------------------- */
  /*  Rolls                                       */

  /* -------------------------------------------- */

  async addSpellFromSpellListToSpellbook(level, itemId, itemPack) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));
    let spellsToAdd = [];
    let itemData = null;
    const pack = game.packs.find((p) => p.metadata.id === itemPack);
    const packItem = await pack.getDocument(itemId);
    if (packItem != null) itemData = packItem.toObject();
    if (itemData) {
      delete itemData._id;
      itemData.system.level = parseInt(level);
      if (itemData.system.spellbook) delete itemData.system.spellbook;
      spellsToAdd.push(itemData);
    }
    await this.createEmbeddedDocuments('Item', spellsToAdd, { nameUnique: true });
  }

  async modifyTokenAttribute(attribute, value, isDelta) {
    if (attribute === 'attributes.hp') {
      let strValue = String(value);
      if (isDelta && value > 0) strValue = '+' + strValue;
      return this.update({ 'system.attributes.hp.value': strValue });
    } else {
      return super.modifyTokenAttribute(attribute, value);
    }
  }

  async addSpellsToSpellbook(item) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));

    if (item.type !== 'feat') throw new Error('Wrong Item type');
    let spellsToAdd = [];
    for (let spell of Object.values(item.system.spellSpecialization.spells)) {
      let itemData = null;
      if (!spell.id) continue;
      const pack = game.packs.find((p) => p.metadata.id === spell.pack);
      const packItem = await pack.getDocument(spell.id);
      if (packItem != null) itemData = packItem.toObject(false);
      if (itemData) {
        //if (itemData._id) delete itemData._id;
        itemData.system.level = spell.level;
        spellsToAdd.push(itemData);
      }
    }
    await this.createEmbeddedDocuments('Item', spellsToAdd,
      { nameUnique: true, domainSpells: true });
  }

  async addSpellsToSpellbookForClass(_spellbookKey, level) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));

    let spellsToAdd = [];
    let spellbook = this.system.attributes.spells.spellbooks[_spellbookKey];
    let spellbookClass = this.system.classes[spellbook.class];
    if (spellbookClass?.hasSpellbook && spellbookClass.spelllist?.size > 0) {
      LogHelper.log(spellbookClass.spelllist);
      for (let spellData of spellbookClass.spelllist.values()) {
        if (spellData.level !== parseInt(level)) continue;
        const pack = game.packs.find((p) => p.metadata.id === spellData.pack);
        const packItem = await pack.getDocument(spellData.id);
        if (packItem) {
          let itemData = packItem.toObject(true);
          if (itemData._id) delete itemData._id;
          itemData.system.level = spellData.level;
          if (itemData.system.spellbook) delete itemData.system.spellbook;
          spellsToAdd.push(itemData);
        }
      }
    } else {
      for (let p of game.packs.values()) {
        if (p.private && !game.user.isGM) continue;
        if ((p.entity || p.documentName) !== 'Item') continue;

        const items = await p.getDocuments();
        for (let _obj of items) {
          let obj = _obj.toObject(true);
          if (obj.type !== 'spell') continue;
          let foundLevel = false;
          if (spellbookClass?.classPaths?.enabled === true) {
            const eligibility = evaluateWarcraftSpellEligibility(
              obj.system,
              spellbookClass,
              { parentClass: spellbookClass.name },
            );
            if (eligibility.eligible) {
              obj.system.level = eligibility.spellLevel;
              obj.system.warcraftLearnedPath = eligibility.path;
              foundLevel = true;
            }
          } else if (obj.system.learnedAt !== undefined) {
            obj.system.learnedAt.class.forEach((learnedAtObj) => {
              if (learnedAtObj[0].toLowerCase() === spellbookClass.name.toLowerCase()) {
                obj.system.level = learnedAtObj[1];
                foundLevel = true;
              }
            });
          }
          if (parseInt(level) !== obj.system.level) continue;
          if (!foundLevel) continue;

          if (obj._id) delete obj._id;
          obj.system.spellbook = _spellbookKey;
          spellsToAdd.push(obj);
        }
      }
    }

    await this.createEmbeddedDocuments('Item', spellsToAdd, {
      stopUpdates: true,
      nameUnique: true,
      ignoreSpellbookAndLevel: true,
    });
  }

  /**
   * Creates an attack item from a weapon item
   * @param {Object} item - The weapon item data
   * @param {Object} options - The options for the creation
   * @param {boolean} options.deleteExistingAttack - Whether to delete the existing attack item
   * @returns {Promise<Array<Object>>} The created attack item data
   */
  async createAttackFromWeapon(item, options = { deleteExistingAttack: true }) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));
    if (item.type !== 'weapon') throw new Error('Wrong Item type');
    //LogHelper.log('Creating attack for', item)

    // Delete old attack if it exists
    let oldAttack = this.items.find(
      (i) => i.type === 'attack' && i.system.originalWeaponId === item.id);
    if (oldAttack) {
      if (options.deleteExistingAttack) await oldAttack.delete();
      else return;
    }

    let isKeen = false;
    let isSpeed = false;
    let isDistance = false;
    let _enhancements = foundry.utils.duplicate(
      foundry.utils.getProperty(item.system, `enhancements.items`) || []);
    let identified = foundry.utils.getProperty(item.system, `identified`);
    // Get attack template (v12+: game.model.Item; v11: game.system.template.Item)
    const itemTemplate = getSystemTemplate("Item");
    let attackData = { system: {} };
    if (itemTemplate?.attack?.templates) {
      for (const template of itemTemplate.attack.templates) {
        foundry.utils.mergeObject(attackData.system, itemTemplate.templates?.[template] ?? {});
      }
    }
    if (itemTemplate?.attack) {
      foundry.utils.mergeObject(attackData.system, foundry.utils.duplicate(itemTemplate.attack));
    }
    attackData = foundry.utils.flattenObject(attackData);
    let isIncorporeal = false;

    // Add things from Enhancements
    if (identified) {
      _enhancements.forEach((i) => {
        let enhancementData = ItemEnhancementHelper.getEnhancementData(i);
        if (enhancementData.properties !== null &&
          enhancementData.properties.kee) {
          isKeen = true;
        }
        if (enhancementData.properties !== null &&
          enhancementData.properties.inc) {
          isIncorporeal = true;
        }
        if (enhancementData.properties !== null &&
          enhancementData.properties.spd) {
          isSpeed = true;
        }
        if (enhancementData.properties !== null &&
          enhancementData.properties.dis) {
          isDistance = true;
        }
      });

      if (item.system.properties !== null && item.system.properties.kee) {
        isKeen = true;
      }
      if (item.system.properties !== null && item.system.properties.inc) {
        isIncorporeal = true;
      }
      if (item.system.properties !== null && item.system.properties.spd) {
        isSpeed = true;
      }
      if (item.system.properties !== null && item.system.properties.dis) {
        isDistance = true;
      }
    }
    let baseCrit = item.system.weaponData.critRange || 20;
    if (isKeen) {
      baseCrit = 21 - 2 * (21 - baseCrit);
    }
    attackData['type'] = 'attack';
    attackData['name'] = identified
      ? item.name
      : item.system.unidentified.name;
    attackData['system.masterwork'] = item.system.masterwork;
    attackData['system.attackType'] = 'weapon';
    attackData['system.description.value'] = identified
      ? item.system.description.value
      : item.system.description.unidentified;
    attackData['system.enh'] = identified ? item.system.enh : 0;
    attackData['system.ability.critRange'] = baseCrit;
    attackData['system.ability.critMult'] = item.system.weaponData.critMult ||
      2;
    attackData['system.actionType'] =
      item.system.weaponSubtype === 'ranged' || item.system.properties.thr
        ? 'rwak'
        : 'mwak';
    attackData['system.activation.type'] = 'attack';
    attackData['system.duration.units'] = 'inst';
    attackData['system.finesseable'] = item.system.properties.fin || false;
    attackData['system.incorporeal'] = isIncorporeal || false;
    attackData['system.threatRangeExtended'] = isKeen;
    attackData['system.baseWeaponType'] =
      item.system.baseWeaponType || (item.system.unidentified?.name
        ? item.system.unidentified.name
        : item.name);
    attackData['system.originalWeaponCreated'] = true;
    attackData['system.originalWeaponId'] = item.id;
    attackData['system.originalWeaponName'] = identified
      ? item.name
      : item.system.unidentified.name;
    attackData['system.originalWeaponImg'] = item.img;
    attackData['system.originalWeaponProperties'] = item.system.properties;
    attackData['system.material'] = item.system.material;
    attackData['system.alignment.good'] = item.system.weaponData.alignment?.good ||
      false;
    attackData['system.alignment.evil'] = item.system.weaponData.alignment?.evil ||
      false;
    attackData['system.alignment.chaotic'] = item.system.weaponData.alignment?.chaotic ||
      false;
    attackData['system.alignment.lawful'] = item.system.weaponData.alignment?.lawful ||
      false;
    attackData['img'] = item.img;

    attackData['system.nonLethal'] = item.system.properties.nnl;
    attackData['system.thrown'] = item.system.properties.thr;
    attackData['system.returning'] = item.system.properties.ret;
    // Warcraft firearms consume their linked ammunition during the explicit
    // reload action, so the generic attack dialog must not deduct it again.
    attackData['system.noAmmoRequired'] = item.system.noAmmoRequired || Boolean(
      item.flags?.warcraftrpg2e?.rules?.ammunition && item.flags?.warcraftrpg2e?.rules?.capacity
    );

    // SRD 3.5e: extra manufactured attack at +6, +11, +16, … (non-epic BAB only).
    let extraAttacks = [];
    const nonepicBab = Math.max(0, foundry.utils.getProperty(this.system, "attributes.bab.nonepic") || 0);
    for (let k = 1; k <= Math.max(0, Math.floor((nonepicBab - 1) / 5)); k++) {
      const a = 5 * k;
      extraAttacks = extraAttacks.concat([[`-${a}`, `${game.i18n.localize('D35E.Attack')} ${k + 1}`]]);
    }
    if (isSpeed) {
      extraAttacks = extraAttacks.concat(
        [[`0`, `${game.i18n.localize('D35E.Attack')} - Speed Enhancement`]]);
    }
    if (extraAttacks.length >
      0) attackData['system.attackParts'] = extraAttacks;

    // Add ability modifiers
    const isMelee = foundry.utils.getProperty(item.system, 'weaponSubtype') !== 'ranged';
    if (isMelee) attackData['system.ability.attack'] = 'str';
    else attackData['system.ability.attack'] = 'dex';
    if (isMelee || item.system.properties['thr'] === true) {
      attackData['system.ability.damage'] = 'str';
      if (item.system.weaponSubtype === '2h' &&
        isMelee) attackData['system.ability.damageMult'] = 1.5;
    }
    if (item.system.properties['thr'] === true) {
      attackData['system.ability.attack'] = 'dex';
    }
    attackData['system.weaponSubtype'] = item.system.weaponSubtype;
    // Add damage formula
    if (item.system.weaponData.damageRoll) {
      const die = item.system.weaponData.damageRoll || '1d4';
      let part = die;
      let dieCount = 1,
        dieSides = 4;
      if (die.match(/^([0-9]+)d([0-9]+)$/)) {
        dieCount = parseInt(RegExp.$1);
        dieSides = parseInt(RegExp.$2);
        part = `sizeRoll(${dieCount}, ${dieSides}, @sizeDifference, @critMult)`;
      }
      const bonusFormula = foundry.utils.getProperty(item.system, 'weaponData.damageFormula');
      if (bonusFormula != null &&
        bonusFormula.length) part = `${part} + ${bonusFormula}`;
      attackData['system.damage.parts'] = [
        [
          part,
          item.system.weaponData.damageType || '',
          item.system.weaponData.damageTypeId || ''],
      ];
    }

    // Add attack bonus formula
    {
      const bonusFormula = foundry.utils.getProperty(item.system, 'weaponData.attackFormula');
      if (bonusFormula !== undefined && bonusFormula !== null &&
        bonusFormula.length)
        attackData['system.attackBonus'] = bonusFormula;
    }
    attackData['system.attackNotes'] = '';
    attackData['system.effectNotes'] = '';
    // Add things from Enhancements
    let conditionals = [];
    if (identified) {
      _enhancements.forEach((i) => {
        let enhancementData = ItemEnhancementHelper.getEnhancementData(i);
        if (enhancementData.enhancementType !== 'weapon') return;
        let conditional = Item35E.defaultConditional;
        conditional.name = i.name;
        conditional.default = false;
        if (enhancementData.weaponData.damageRoll !== '') {
          if (enhancementData.weaponData.optionalDamage) {
            let damageModifier = Item35E.defaultConditionalModifier;
            damageModifier.formula = enhancementData.weaponData.damageRoll;
            damageModifier.type = enhancementData.weaponData.damageTypeId;
            damageModifier.target = 'damage';
            damageModifier.subTarget = 'allDamage';
            conditional.modifiers.push(damageModifier);
          } else {
            if (enhancementData.weaponData.damageRoll !== undefined &&
              enhancementData.weaponData.damageRoll !== null)
              attackData['system.damage.parts'].push([
                enhancementData.weaponData.damageRoll,
                enhancementData.weaponData.damageType,
                enhancementData.weaponData.damageTypeId || '',
              ]);
          }
        }
        if (enhancementData.weaponData.attackRoll !== '') {
          if (enhancementData.weaponData.optionalDamage) {
            let attackModifier = Item35E.defaultConditionalModifier;
            attackModifier.formula = enhancementData.weaponData.attackRoll;
            attackModifier.target = 'attack';
            attackModifier.subTarget = 'allAttack';
            conditional.modifiers.push(attackModifier);
          } else {
            if (enhancementData.weaponData.attackRoll !== undefined &&
              enhancementData.weaponData.attackRoll !== null)
              attackData['system.attackBonus'] =
                attackData['system.attackBonus'] + ' + ' +
                enhancementData.weaponData.attackRoll;
          }
        }
        if (conditional.modifiers.length > 0) {
          conditionals.push(conditional);
        }
        if (enhancementData.effectNotes && enhancementData.attackNotes !== '') {
          attackData['system.attackNotes'] += '\n' +
            enhancementData.attackNotes;
          attackData['system.attackNotes'] = attackData['system.attackNotes'].trim();
        }
        if (enhancementData.effectNotes && enhancementData.effectNotes !== '') {
          attackData['system.effectNotes'] += '\n' +
            enhancementData.effectNotes;
          attackData['system.effectNotes'] = attackData['system.effectNotes'].trim();
        }
      });
      if (conditionals.length) {
        attackData['system.conditionals'] = conditionals;
      }
    }

    if (identified) {
      if (item.system.attackNotes && item.system.attackNotes !== '') {
        attackData['system.attackNotes'] += '\n' + item.system.attackNotes;
        attackData['system.attackNotes'] = attackData['system.attackNotes'].trim();
      }
      if (item.system.attackNotes && item.system.effectNotes !== '') {
        attackData['system.effectNotes'] += '\n' + item.system.effectNotes;
        attackData['system.effectNotes'] = attackData['system.effectNotes'].trim();
      }
    }

    // Add range
    if (!isMelee && foundry.utils.getProperty(item.system, 'weaponData.range') != null) {
      attackData['system.range.units'] = 'ft';
      let range = foundry.utils.getProperty(item.system, 'weaponData.range');
      if (isDistance) range = range * 2;
      attackData['system.range.value'] = range.toString();
    }

    if (foundry.utils.hasProperty(attackData,
      'system.templates')) delete attackData['system.templates'];

    let attacks = [];
    attacks.push(foundry.utils.expandObject(attackData));
    if (item.system.properties.thr) {
      let meleeAttack = foundry.utils.duplicate(attacks[0]);
      meleeAttack['system']['actionType'] = 'mwak';
      meleeAttack['system']['thrown'] = false;
      meleeAttack['system']['ability']['attack'] = 'str';
      attacks[0]['name'] = `${attacks[0]['name']} (Thrown)`;
      attacks.push(meleeAttack);
    }
    let createdAttack = await this.createEmbeddedDocuments('Item', attacks, {});

    //LogHelper.log('Created attack for', item)

    ui.notifications.info(game.i18n.localize('D35E.NotificationCreatedAttack').
      format(item.name));
    return createdAttack;
  }

  /* -------------------------------------------- */

  /* -------------------------------------------- */

  /**
   * Roll a generic ability test or saving throw.
   * Prompt the user for input on which variety of roll they want to do.
   * @param {String} abilityId     The ability id (e.g. "str")
   * @param {Object} options      Options which configure how ability tests or saving throws are rolled
   */
  rollAbility(abilityId, options = {}) {
    return this.rollAbilityTest(abilityId, options);
  }

  rollBAB(options = {}) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));
    // Get dynamic bonuses from BAB source details
    let dynamicBonuses = [];
    if (this.sourceDetails['system.attributes.bab.total']) {
      dynamicBonuses.push(...this.sourceDetails['system.attributes.bab.total']);
    }
    return DicePF.d20Roll({
      event: options.event,
      parts: [],
      dynamicBonuses: dynamicBonuses,
      data: {
        base: foundry.utils.getProperty(this.system, 'attributes.bab.base'),
      },
      title: game.i18n.localize('D35E.BAB'),
      speaker: ChatMessage.getSpeaker({ actor: this }),
      takeTwenty: false,
      chatTemplate: 'systems/warcraftrpg2e/templates/chat/roll-ext.html',
    });
  }

  async rollMelee(options = {}) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));

    // Make a fake melee attack item that doesn't get saved and deals the damage of the melee attack
    // Actor size index
    let sizeIndex = Object.keys(CONFIG.D35E.sizeChart).indexOf(this.system.traits.actualSize);
    // offset by the medium size which is treated as 0
    sizeIndex -= 4;
    let rollFormula = game.D35E.rollPreProcess.sizeRoll(1, 3, this.system.traits.actualSize, 1);
    // add str value
    // if str mod > 0, add it to the roll
    if (this.system.abilities.str.mod > 0)
      rollFormula += `+${this.system.abilities.str.mod}`;
    else
      rollFormula += `${this.system.abilities.str.mod}`;
    let meleeAttack = {
      name: game.i18n.localize('D35E.Melee'),
      img: `/icons/skills/melee/hand-grip-sword-red.webp`,
      type: 'attack',
      system: {
        actionType: 'mwak',
        ability: {
          attack: 'str',
        },
        // Non lethal
        nonLethal: true,
        effectNotes: `Usually non-lethal damage is @DamageRoll[bludgeoning,${rollFormula}]. See Equipment for more details.`,
      },
    };
    let meleeAttackItem = new Item35E(meleeAttack, { parent: this, temporary: true });
    meleeAttackItem.use({ temporaryItem: true }, this);
  }

  async rollRanged(options = {}) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));

    let meleeAttack = {
      name: game.i18n.localize('D35E.Ranged'),
      img: `icons/skills/ranged/arrow-flying-broadhead-metal.webp`,
      type: 'attack',
      system: {
        actionType: 'rsak',
        ability: {
          attack: 'dex',
        },
        damage: {
          parts: [
          ],
        },
        // Add attack note
        effectNotes: `The ranged attack for most creatures is an improvised rock throw (@DamageRoll[bludgeoning,1]). See Equipment for more details.`,
      },
    };
    let meleeAttackItem = new Item35E(meleeAttack, { parent: this, temporary: true });
    meleeAttackItem.use({ temporaryItem: true }, this);
  }

  rollCMB(options = {}) {
    this.rollGrapple(null, options);
  }

  async rollPsionicFocus(event) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));

    let rollData = this.getRollData();

    let roll = await new Roll35e('1d20 + @skills.coc.mod', rollData).roll();
    // Set chat data
    let chatData = {
      speaker: ChatMessage.getSpeaker({ actor: this }),
      rollMode: 'public',
      sound: CONFIG.sounds.dice,
      'flags.warcraftrpg2e.noRollRender': true,
    };
    let chatTemplateData = {
      name: this.name,
      [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
      rollMode: 'public',
    };
    const _tw0 = document.createElement('div');
    _tw0.innerHTML = await roll.getTooltip();
    const _te0 = _tw0.firstElementChild;
    if (_te0) _te0.insertAdjacentHTML('afterbegin', `<div class="dice-formula">${roll.formula}</div>`);
    const templateData = foundry.utils.mergeObject(
      chatTemplateData,
      {
        img: this.img,
        roll: roll,
        total: roll.total,
        result: roll.result,
        tooltip: _te0 ? _te0.outerHTML : '',
        success: roll.total >= 20,
      },
      { inplace: false },
    );

    if (roll.total >= 20) {
      const spellbookKey = event.currentTarget.closest('.spellbook-group').dataset.tab;
      const k = `system.attributes.psionicFocus`;
      let updateData = {};
      updateData[k] = true;
      this.update(updateData);
    }

    await createCustomChatMessage(
      'systems/warcraftrpg2e/templates/chat/psionic-focus.html', templateData,
      chatData, {
      rolls: [roll],
    });
  }

  getDefenseHeaders() {
    const data = this.system;
    const headers = [];

    const reSplit = CONFIG.D35E.re.traitSeparator;
    let misc = [];

    // Damage reduction
    if (data.traits.dr.length) {
      headers.push({
        header: game.i18n.localize('D35E.DamRed'),
        value: data.traits.dr.split(reSplit),
      });
    }
    // Energy resistance
    if (data.traits.eres.length) {
      headers.push({
        header: game.i18n.localize('D35E.EnRes'),
        value: data.traits.eres.split(reSplit),
      });
    }
    // Damage vulnerabilities
    if (data.traits.dv.value.length || data.traits.dv.custom.length) {
      const value = [].concat(
        data.traits.dv.value.map((obj) => {
          return game.i18n.localize(CONFIG.D35E.damageTraitTypes[obj]);
        }),
        data.traits.dv.custom.length > 0
          ? data.traits.dv.custom.split(';')
          : [],
      );
      headers.push({ header: game.i18n.localize('D35E.DamVuln'), value: value });
    }
    // Condition resistance
    if (data.traits.cres.length) {
      headers.push({
        header: game.i18n.localize('D35E.ConRes'),
        value: data.traits.cres.split(reSplit),
      });
    }
    // Immunities
    if (
      data.traits.di.value.length ||
      data.traits.di.custom.length ||
      data.traits.ci.value.length ||
      data.traits.ci.custom.length
    ) {
      const value = [].concat(
        data.traits.di.value.map((obj) => {
          return game.i18n.localize(CONFIG.D35E.damageTraitTypes[obj]);
        }),
        data.traits.di.custom.length > 0
          ? data.traits.di.custom.split(';')
          : [],
        data.traits.ci.value.map((obj) => {
          return game.i18n.localize(CONFIG.D35E.conditionTypes[obj]);
        }),
        data.traits.ci.custom.length > 0
          ? data.traits.ci.custom.split(';')
          : [],
      );
      headers.push(
        { header: game.i18n.localize('D35E.ImmunityPlural'), value: value });
    }
    // Spell Resistance
    if (data.attributes.sr.total > 0) {
      misc.push(game.i18n.localize('D35E.SpellResistanceNote').
        format(data.attributes.sr.total));
    }

    if (misc.length > 0) {
      headers.push({ header: game.i18n.localize('D35E.MiscShort'), value: misc });
    }

    return headers;
  }

  getInitiativeContextNotes() {
    const notes = this.getContextNotes('misc.init').reduce((arr, o) => {
      for (const n of o.notes) arr.push(...n.split(/[\n\r]+/));
      return arr;
    }, []);

    let notesHTML;
    if (notes.length > 0) {
      // Format notes if they're present
      const notesHTMLParts = [];
      notes.forEach(
        (note) => notesHTMLParts.push(`<span class="tag">${note}</span>`));
      notesHTML =
        '<div class="flexcol property-group gm-sensitive"><label>' +
        game.i18n.localize('PF1.Notes') +
        '</label> <div class="flexrow">' +
        notesHTMLParts.join('') +
        '</div></div>';
    }

    return [notes, notesHTML];
  }

  async rollInitiative({
    createCombatants = false,
    rerollInitiative = false,
    initiativeOptions = {},
  } = {}) {
    // Obtain (or create) a combat encounter
    let combat = game.combat;
    if (!combat) {
      if (game.user.isGM && canvas.scene) {
        combat = await game.combats.documentClass.create(
          { scene: canvas.scene.id, active: true });
      } else {
        ui.notifications.warn(game.i18n.localize('COMBAT.NoneActive'));
        return null;
      }
    }

    // Create new combatants
    if (createCombatants) {
      const tokens = this.isToken ? [this.token] : this.getActiveTokens();
      const createData = tokens.reduce((arr, t) => {
        if (t.inCombat) return arr;
        // When isToken, t is the TokenDocument itself; otherwise t is a canvas Token placeable
        const tokenDoc = this.isToken ? t : t.document;
        arr.push({ tokenId: tokenDoc.id, sceneId: tokenDoc.parent?.id, actorId: this.id, hidden: tokenDoc.hidden });
        return arr;
      }, []);
      // Fallback: no rendered tokens on canvas — add a tokenless combatant by actor ID
      if (!createData.length) createData.push({ actorId: this.id, hidden: false });
      await combat.createEmbeddedDocuments('Combatant', createData);
    }

    // Iterate over combatants to roll for
    const combatantIds = combat.combatants.reduce((arr, c) => {
      if (c.actor?.id !== this.id ||
        (this.isToken && c.tokenId !== this.token.id)) return arr;
      if (c.initiative !== null && !rerollInitiative) return arr;
      arr.push(c.id);
      return arr;
    }, []);

    return combatantIds.length ? combat.rollInitiative(combatantIds,
      initiativeOptions) : combat;
  }

  async rollPowerResistance(spellPenetration, options = {}) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));
    if (game.settings.get('warcraftrpg2e', 'psionicsAreDifferent'))
      await this.rollSpellPowerResistance(spellPenetration, 'pr', options);
    else await this.rollSpellPowerResistance(spellPenetration, 'sr', options);
  }

  async rollSpellResistance(spellPenetration, options = {}) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));
    await this.rollSpellPowerResistance(spellPenetration, 'sr', options);
  }

  async rollSpellPowerResistance(spellPenetration, type, options = {}) {
    const _roll = async function (type, form, props) {
      let spellPenetrationTotal = spellPenetration,
        optionalFeatIds = [],
        optionalFeatRanges = new Map(),
        rollMode = null;
      let resistanceManualBonus = 0;
      // Get data from roll form
      if (form) {
        const formEl = form?.nodeType === 1 ? form : form?.[0] ?? form;
        resistanceManualBonus = formEl.querySelector('[name="res-bonus"]')?.value || 0;

        rollMode = formEl.querySelector('[name="rollMode"]')?.value;

        formEl.querySelectorAll('[data-type="optional"]').forEach((el) => {
          if (el.checked) {
            let featId = el.getAttribute('data-feat-optional');
            optionalFeatIds.push(featId);
            if (formEl.querySelector(`[name="optional-range-${featId}"]`)?.value !==
              undefined)
              optionalFeatRanges.set(featId, {
                base: formEl.querySelector(`[name="optional-range-${featId}"]`)?.value || 0,
                slider1: formEl.querySelector(`[name="optional-range-1-${featId}"]`)?.value || 0,
                slider2: formEl.querySelector(`[name="optional-range-2-${featId}"]`)?.value || 0,
                slider3: formEl.querySelector(`[name="optional-range-3-${featId}"]`)?.value || 0,
              });
          }
        });
      }

      // Parse combat changes
      let allCombatChanges = [];
      let rollModifiers = [];
      let attackType = 'resistance';
      allCombatChanges = ItemCombatChangesHelper.getAllSelectedCombatChangesForRoll(
        this.items,
        attackType,
        rollData,
        allCombatChanges,
        rollModifiers,
        optionalFeatIds,
        optionalFeatRanges,
      );

      if (rollModifiers.length > 0)
        props.push({
          header: game.i18n.localize('D35E.RollModifiers'),
          value: rollModifiers,
        });

      this._addCombatChangesToRollData(allCombatChanges, rollData);
      rollData.featResistanceBonus = rollData.featResistanceBonus || 0;
      rollData.spellPenetrationTotal = spellPenetrationTotal;
      rollData.resistanceManualBonus = resistanceManualBonus || 0;
      rollData.resistanceTotal =
        this.system.attributes[`${type}`].total + resistanceManualBonus +
        rollData.featResistanceBonus;

      let roll = await new Roll35e('1d20 + @spellPenetrationTotal', rollData).roll();

      rollData.rollTotal = roll.total;
      rollData.success = rollData.resistanceTotal > rollData.rollTotal;
      let actions = await this.getAndApplyCombatChangesSpecialActions(
        allCombatChanges,
        this,
        rollData,
        optionalFeatIds,
        optionalFeatRanges,
      );

      const token = this ? this.token : null;

      // Set chat data
      let chatData = {
        speaker: ChatMessage.getSpeaker({ actor: this }),
        rollMode: rollMode || 'gmroll',
        sound: CONFIG.sounds.dice,
        'flags.warcraftrpg2e.noRollRender': true,
      };
      let chatTemplateData = {
        name: this.name,
        [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
        rollMode: rollMode || 'gmroll',
        tokenId: token ? `${token.parent.id}.${token.id}` : null,
        actorId: this.id,
      };
      const _tw1 = document.createElement('div');
      _tw1.innerHTML = await roll.getTooltip();
      const _te1 = _tw1.firstElementChild;
      if (_te1) _te1.insertAdjacentHTML('afterbegin', `<div class="dice-formula">${roll.formula}</div>`);
      const templateData = foundry.utils.mergeObject(
        chatTemplateData,
        {
          actor: this,
          img: this.img,
          label:
            type === 'sr'
              ? game.i18n.localize('D35E.SpellResistance')
              : game.i18n.localize('D35E.PowerResistance'),
          roll: roll,
          total: roll.total,
          result: roll.result,
          target: rollData.resistanceTotal,
          tooltip: _te1 ? _te1.outerHTML : '',
          success: rollData.resistanceTotal > roll.total,
          properties: props,
          hasProperties: props.length > 0,
          actions: actions,
        },
        { inplace: true },
      );
      // Create message

      await createCustomChatMessage(
        'systems/warcraftrpg2e/templates/chat/resistance.html', templateData, chatData,
        {
          rolls: [roll],
        });

      return roll;
    };

    // Add contextual notes
    let notes = [];
    const rollData = foundry.utils.duplicate(this.getRollData());
    const noteObjects = this.getContextNotes(`misc.${type}`);
    for (let noteObj of noteObjects) {
      rollData.item = {};
      if (noteObj.item != null) rollData.item = new Item35E(
        noteObj.item.toObject(), { owner: this.isOwner }).toObject();
      await this.enrichAndAddNotes(noteObj, rollData, notes);
    }
    let props = this.getDefenseHeaders();
    if (notes.length > 0) props.push(
      { header: game.i18n.localize('D35E.Notes'), value: notes });
    const label =
      type === 'sr'
        ? game.i18n.localize('D35E.SpellResistance')
        : game.i18n.localize('D35E.PowerResistance');
    rollData.resistanceType = type;

    let template = 'systems/warcraftrpg2e/templates/apps/resistance-roll-dialog.html';
    let dialogData = {
      data: rollData,
      rollMode: options.rollMode
        ? options.rollMode
        : game.settings.get('warcraftrpg2e',
          `rollConfig`).rollConfig[this.type].grapple ||
        game.settings.get('core', 'rollMode'),
      rollModes: CONFIG.Dice.rollModes,
      rollModesForSelect: getRollModesForSelect(),
      resFeats: this.combatChangeItems.filter((o) =>
        ItemCombatChangesHelper.canHaveCombatChanges(o, rollData,
          'spellPowerResistance'),
      ),
      resFeatsOptional: this.combatChangeItems.filter((o) =>
        ItemCombatChangesHelper.canHaveCombatChanges(o, rollData,
          `spellPowerResistanceOptional`),
      ),
      label: label,
    };
    const html = await foundry.applications.handlebars.renderTemplate(template, dialogData);
    let roll;
    const buttons = {};
    if (this.system.attributes[`${type}`].total) {
      let wasRolled = false;
      buttons.normal = {
        label: game.i18n.localize('D35E.Roll'),
        callback: (html) => {
          wasRolled = true;
          roll = _roll.call(this, type, html, props);
        },
      };
      return new Promise((resolve) => {
        new Dialog(
          {
            title: `${game.i18n.localize('D35E.ResRollResistance')}`,
            content: html,
            buttons: buttons,
            classes: ['custom-dialog', 'wide'],
            default: 'normal',
            close: (html) => {
              return resolve(roll);
            },
          },
          {
            width: 400,
          },
        ).render(true);
      });
    } else {
      return _roll.call(this, type, null, props);
    }
  }

  async enrichAndAddNotes(noteObj, rollData, notes) {
    for (let note of noteObj.notes) {
      if (!isMinimumCoreVersion('0.5.2')) {
        let noteStr = '';
        if (note.length > 0) {
          noteStr = DicePF.messageRoll({
            data: rollData,
            msgStr: note,
          });
        }
        if (noteStr.length > 0) notes.push(...noteStr.split(/[\n\r]+/));
      } else {
        for (let _note of note.split(/[\n\r]+/)) {
          let enrichedNote = await foundry.applications.ux.TextEditor.enrichHTML(
            Item35E._fillTemplate(_note, rollData), {
            rollData: rollData,
          }, { parent: this });
          notes.push(enrichedNote);
        }
      }
    }
  }

  /**
   * Make a saving throw, with optional versus check
   * @param _savingThrow Saving throw data
   * @param ability Saving throw ability
   * @param target target saving throw dc
   * @param options options
   * @returns {Promise<unknown>|void}
   */
  async rollSavingThrow(_savingThrow, ability, target, options = {}) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));
    // This refreshes the source details if actor has not been touched before
    if (!this.sourceDetails) { await this.refresh({ stopUpdates: false }); }

    if (_savingThrow === 'fort') _savingThrow = 'fortitudenegates';
    if (_savingThrow === 'ref') _savingThrow = 'reflexnegates';
    if (_savingThrow === 'will') _savingThrow = 'willnegates';

    const _roll = async function (
      saveType, ability, baseAbility, target, form, props, rollMode) {
      let savingThrowBonus = foundry.utils.getProperty(this.system,
        `attributes.savingThrows.${saveType}.total`) || 0,
        optionalFeatIds = [],
        optionalFeatRanges = new Map(),
        saveFieldName = `system.attributes.savingThrows.${saveType}.total`;
      savingThrowBonus -= foundry.utils.getProperty(this.system,
        `abilities.${baseAbility}.mod`) || 0;
      let savingThrowAbilityBonus = foundry.utils.getProperty(this.system,
        `abilities.${ability}.mod`) || 0;
      let savingThrowManualBonus = 0;
      // Get data from roll form
      if (form) {
        const formEl = form?.nodeType === 1 ? form : form?.[0] ?? form;
        rollData.savingThrowBonus = formEl.querySelector('[name="st-bonus"]')?.value;
        if (rollData.savingThrowBonus) savingThrowManualBonus += await new Roll35e(
          rollData.savingThrowBonus).evaluateSync().total;
        rollMode = formEl.querySelector('[name="rollMode"]')?.value;

        formEl.querySelectorAll('[data-type="optional"]').forEach((el) => {
          if (el.checked) {
            let featId = el.getAttribute('data-feat-optional');
            optionalFeatIds.push(featId);
            if (formEl.querySelector(`[name="optional-range-${featId}"]`)?.value !==
              undefined)
              optionalFeatRanges.set(featId, {
                base: formEl.querySelector(`[name="optional-range-${featId}"]`)?.value || 0,
                slider1: formEl.querySelector(`[name="optional-range-1-${featId}"]`)?.value || 0,
                slider2: formEl.querySelector(`[name="optional-range-2-${featId}"]`)?.value || 0,
                slider3: formEl.querySelector(`[name="optional-range-3-${featId}"]`)?.value || 0,
              });
          }
        });
      }

      // Parse combat changes
      let allCombatChanges = [];
      let rollModifiers = [];
      let attackType = 'savingThrow';
      allCombatChanges = ItemCombatChangesHelper.getAllSelectedCombatChangesForRoll(
        this.items,
        attackType,
        rollData,
        allCombatChanges,
        rollModifiers,
        optionalFeatIds,
        optionalFeatRanges,
      );

      if (rollModifiers.length > 0)
        props.push({
          header: game.i18n.localize('D35E.RollModifiers'),
          value: rollModifiers,
        });

      let savingThrowSourceDetails = this.sourceDetails[saveFieldName] || [];

      this._addCombatChangesToRollData(allCombatChanges, rollData);
      let saveRollFormula = '1d20';
      for (let detail of savingThrowSourceDetails) {
        saveRollFormula += `+ ${detail.value}`;
      }
      if (rollData.featSavingThrowList) {
        for (let [i, bonus] of rollData.featSavingThrowList.entries()) {
          if (typeof bonus['value'] === 'string' || bonus['value'] instanceof
            String)
            bonus['value'] = await new Roll35e(bonus['value'], rollData).evaluateSync().total;
          saveRollFormula += `+ ${bonus['value']}`;
          bonus['name'] = bonus['sourceName'];
        }
      }
      rollData.savingThrowBonus = savingThrowBonus;
      rollData.savingThrowManualBonus = savingThrowManualBonus;
      rollData.savingThrowAbilityBonus = savingThrowAbilityBonus;

      if (savingThrowManualBonus !== 0) {
        saveRollFormula +=
          savingThrowManualBonus > 0
            ? ` + ${savingThrowManualBonus}`
            : ` - ${Math.abs(savingThrowManualBonus)}`;
      }

      const heroPointBonus = heroPointRollBonus(this, ['save', 'd20']);
      if (heroPointBonus) {
        saveRollFormula += ` + ${heroPointBonus}`;
        props.push({
          header: game.i18n.localize('D35E.HeroPoints'),
          value: [game.i18n.localize('D35E.WarcraftHeroSaveBonus')],
        });
      }

      let roll = await new Roll35e(saveRollFormula, rollData).roll();
      if (heroPointBonus) {
        rollData.heroPointBaseTotal = roll.total - heroPointBonus;
        rollData.heroPointImprovedEvasion = Boolean(
          target && rollData.heroPointBaseTotal >= target && /(?:half|partial)$/.test(_savingThrow)
        );
        if (rollData.heroPointImprovedEvasion) {
          props.push({
            header: game.i18n.localize('D35E.HeroPoints'),
            value: [game.i18n.localize('D35E.WarcraftHeroIgnoreEffect')],
          });
        }
        await clearPendingHeroPoint(this);
      }

      let modifiersList = foundry.utils.duplicate(savingThrowSourceDetails);
      modifiersList.unshift(
        { value: roll.terms[0].results[0].result, name: 'Skill Roll' });
      if (savingThrowManualBonus) modifiersList.push(
        { value: savingThrowManualBonus, name: 'Situational Modifier' });
      modifiersList.push(...(rollData.featSavingThrowList || []));

      rollData.rollTotal = roll.total;
      rollData.success = target ? roll.total >= target : true;
      let actions = await this.getAndApplyCombatChangesSpecialActions(
        allCombatChanges,
        this,
        rollData,
        optionalFeatIds,
        optionalFeatRanges,
      );
      let tooltip = '';
      for (let descriptionPart of modifiersList) {
        tooltip += `<tr>
                <td><b>${descriptionPart.name}</b></td>
                <td><b>${descriptionPart.value}</b></td>
                </tr>
                `;
      }
      var tooltips = `<div class="dice-formula" style="margin-bottom: 8px">${roll.formula}</div><div class="table-container"><table>${tooltip}</table></div>`;
      const _tw2 = document.createElement('div');
      _tw2.innerHTML = await roll.getTooltip();
      const _te2 = _tw2.firstElementChild;
      if (_te2) _te2.insertAdjacentHTML('afterbegin', tooltips);
      let renderedTooltip = _te2 ? _te2.outerHTML : '';
      let chatData = {
        speaker: options.speaker ? options.speaker : ChatMessage.getSpeaker(
          { actor: this }),
        rollMode: rollMode || 'gmroll',
        sound: CONFIG.sounds.dice,
        'flags.warcraftrpg2e.noRollRender': true,
      };
      let chatTemplateData = {
        name: this.name,
        [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
        rollMode: rollMode || 'gmroll',
      };
      const templateData = foundry.utils.mergeObject(
        chatTemplateData,
        {
          actor: this,
          img: this.img,
          saveTypeName: game.i18n.localize(
            CONFIG.D35E.savingThrows[saveType]),
          roll: roll,
          total: roll.total,
          result: roll.result,
          target: target,
          tooltip: renderedTooltip,
          success: target && roll.total >= target,
          properties: props,
          hasProperties: props.length > 0,
          actions: actions,
        },
        { inplace: false },
      );
      // Create message

      await createCustomChatMessage(
        'systems/warcraftrpg2e/templates/chat/saving-throw.html', templateData,
        chatData, {
        rolls: [roll],
      });

      return roll;
    };

    let savingThrowId = '';
    let savingThrowAbility = ability;
    let savingThrowBaseAbility = savingThrowAbility;
    if (_savingThrow === 'willnegates' || _savingThrow === 'willhalf' ||
      _savingThrow === 'willpartial') {
      savingThrowId = 'will';
      savingThrowBaseAbility = 'wis';
      if (!savingThrowAbility ||
        savingThrowAbility?.event) savingThrowAbility = 'wis';
      if (savingThrowAbility === '') savingThrowAbility = 'wis';
    } else if (_savingThrow === 'reflexnegates' || _savingThrow ===
      'reflexhalf' || _savingThrow === 'reflexpartial') {
      savingThrowId = 'ref';
      savingThrowBaseAbility = 'dex';
      if (!savingThrowAbility ||
        savingThrowAbility?.event) savingThrowAbility = 'dex';
      if (savingThrowAbility === '') savingThrowAbility = 'dex';
    } else if (
      _savingThrow === 'fortitudenegates' ||
      _savingThrow === 'fortitudehalf' ||
      _savingThrow === 'fortitudepartial'
    ) {
      savingThrowId = 'fort';
      savingThrowBaseAbility = 'con';
      if (!savingThrowAbility ||
        savingThrowAbility?.event) savingThrowAbility = 'con';
      if (savingThrowAbility === '') savingThrowAbility = 'con';
    }
    // Add contextual notes
    let notes = [];
    const rollData = foundry.utils.duplicate(this.getRollData());
    const noteObjects = this.getContextNotes(`savingThrow.${savingThrowId}`);
    for (let noteObj of noteObjects) {
      rollData.item = {};
      if (noteObj.item != null) rollData.item = noteObj.item.toObject();

      await this.enrichAndAddNotes(noteObj, rollData, notes);
    }
    let props = this.getDefenseHeaders();
    if (notes.length > 0) props.push(
      { header: game.i18n.localize('D35E.Notes'), value: notes });
    const label = CONFIG.D35E.savingThrows[savingThrowId];
    const savingThrow = this.system.attributes.savingThrows[savingThrowId];
    rollData.savingThrow = savingThrowId;

    let template = 'systems/warcraftrpg2e/templates/apps/saving-throw-roll-dialog.html';
    let dialogData = {
      data: rollData,
      savingThrow: savingThrow,
      id: `${this.id}-${_savingThrow}`,
      rollMode: options.rollMode
        ? options.rollMode
        : game.settings.get('warcraftrpg2e',
          `rollConfig`).rollConfig[this.type].savingThrow ||
        game.settings.get('core', 'rollMode'),
      rollModes: CONFIG.Dice.rollModes,
      rollModesForSelect: getRollModesForSelect(),
      stFeats: this.combatChangeItems.filter((o) =>
        ItemCombatChangesHelper.canHaveCombatChanges(o, rollData,
          'savingThrow'),
      ),
      stFeatsOptional: this.combatChangeItems.filter((o) =>
        ItemCombatChangesHelper.canHaveCombatChanges(o, rollData,
          'savingThrowOptional'),
      ),
      label: label,
    };
    const html = await foundry.applications.handlebars.renderTemplate(template, dialogData);
    let roll;
    let wasRolled = false;
    // Dialog.submit() does not await async button callbacks; _roll is async (v13 dice).
    // Resolve only after _roll settles, or immediately when the dialog closes without rolling.
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const buttons = {
        normal: {
          label: game.i18n.localize('D35E.Roll'),
          callback: (formEl) => {
            wasRolled = true;
            Promise.resolve(
              _roll.call(
                this,
                savingThrowId,
                savingThrowAbility,
                savingThrowBaseAbility,
                target,
                formEl,
                props,
              ),
            ).then((r) => {
              roll = r;
              finish(roll);
            }).catch(reject);
          },
        },
      };
      new Dialog({
        title: `${game.i18n.localize('D35E.STRollSavingThrow')} - ${this.name}`,
        content: html,
        buttons: buttons,
        classes: ['custom-dialog', 'wide'],
        default: 'normal',
        close: () => {
          if (!wasRolled) finish(undefined);
        },
      }).render(true);
    });
  }

  isCombatChangeItemType(o) {
    return (
      o.type === 'feat' ||
      (o.type === 'aura' && o.system.active) ||
      (o.type === 'buff' && o.system.active) ||
      (o.type === 'equipment' && o.system.equipped === true &&
        !o.system.melded && !o.broken)
    );
  }

  /**
   *
   * @param {CombatChange[]} combatChanges
   * @param actor
   * @param rollData
   * @param optionalFeatIds
   * @param optionalFeatRanges
   * @returns {Promise<*[]>}
   */
  async getAndApplyCombatChangesSpecialActions(
    combatChanges, actor, rollData, optionalFeatIds, optionalFeatRanges) {
    let actions = [];
    for (const c of combatChanges) {
      if (c.specialAction && c.specialAction !== '') {
        if (c.specialActionCondition && c.specialActionCondition !== '') {
          if (!new Roll35e(c.specialActionCondition,
            rollData).evaluateSync().total) continue;
        }
        await this.addCommandAsSpecial(
          actions,
          c.itemName,
          c.itemImg,
          c.specialAction,
          rollData.rollTotal,
          optionalFeatRanges.get(c.itemId)?.base || 0,
        );
      }
    }
    return actions;
  }

  async addCommandAsSpecial(
    actions, name, img, actionData, roll = 0, range = 0) {
    let _actionData = actionData.replace(/\(@range\)/g, `${range}`).
      replace(/\(@roll\)/g, `${roll}`);

    // If this is self action, run it on the actor on the time of render
    await this.autoApplyActionsOnSelf(_actionData);
    actions.push({
      label: name,
      value: _actionData,
      isTargeted: _actionData.endsWith('target') ||
        _actionData.endsWith('target;'),
      action: 'customAction',
      img: img,
      hasImg: img !== undefined && img !== null && img !== '',
    });
  }

  /**
   * Roll a Skill Check
   * Prompt the user for input regarding Advantage/Disadvantage and any Situational Bonus
   * @param {string} skillId      The skill id (e.g. "ins")
   * @param {Object} options      Options which configure how the skill check is rolled
   */
  async rollSkill(skillId, options = {}) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));

    // This refreshes the source details if actor has not been touched before
    if (!this.sourceDetails) { await this.refresh({ stopUpdates: false }); }

    const _roll = async function (
      target, form, props, sklName, skillRollFormula, sourceSkillId,
      rollMode) {
      let optionalFeatIds = [],
        skillModTotal = skl.mod,
        optionalFeatRanges = new Map(),
        rollAbility = skl.ability;
      let skillManualBonus = 0;
      let take20 = false;
      let take10 = false;
      if (skillRollFormula == '20') take20 = true;
      if (skillRollFormula == '10') take10 = true;

      // Get data from roll form
      if (form) {
        const formEl = form?.nodeType === 1 ? form : form?.[0] ?? form;
        skillManualBonus = formEl.querySelector('[name="sk-bonus"]')?.value || 0;

        rollMode = formEl.querySelector('[name="rollMode"]')?.value;
        rollAbility = formEl.querySelector('[name="ability"]')?.value;

        props.push({
          header: game.i18n.localize('D35E.Ability'),
          value: [CONFIG.D35E.abilities[rollAbility]],
        });

        formEl.querySelectorAll('[data-type="optional"]').forEach((el) => {
          if (el.checked) {
            let featId = el.getAttribute('data-feat-optional');
            optionalFeatIds.push(featId);
            if (formEl.querySelector(`[name="optional-range-${featId}"]`)?.value !==
              undefined)
              optionalFeatRanges.set(featId, {
                base: formEl.querySelector(`[name="optional-range-${featId}"]`)?.value || 0,
                slider1: formEl.querySelector(`[name="optional-range-1-${featId}"]`)?.value || 0,
                slider2: formEl.querySelector(`[name="optional-range-2-${featId}"]`)?.value || 0,
                slider3: formEl.querySelector(`[name="optional-range-3-${featId}"]`)?.value || 0,
              });
          }
        });
      }

      // Parse combat changes
      let allCombatChanges = [];
      let rollModifiers = [];
      let attackType = 'skill';
      allCombatChanges = ItemCombatChangesHelper.getAllSelectedCombatChangesForRoll(
        this.items,
        attackType,
        rollData,
        allCombatChanges,
        rollModifiers,
        optionalFeatIds,
        optionalFeatRanges,
      );

      if (rollModifiers.length > 0)
        props.push({
          header: game.i18n.localize('D35E.RollModifiers'),
          value: rollModifiers,
        });
      this._addCombatChangesToRollData(allCombatChanges, rollData);

      rollData.skillModTotal = 0;
      // Duplicate so situational modifier / ability swap edits do not mutate
      // actor.sourceDetails (would stack every roll until sheet refresh).
      let skillSourceDetails = foundry.utils.duplicate(
        this.sourceDetails[sourceSkillId] || [],
      );
      if (rollAbility !== skl.ability) {
        // Replace "Abilitiy Modifier" with the correct ability modifier in skillSourceDetails
        // find the ability modifier in skillSourceDetails and replace and change name
        let abilityModIndex = skillSourceDetails.findIndex(
          (o) => o.name === 'Ability Modifier');
        if (abilityModIndex !== -1) {
          skillSourceDetails[abilityModIndex].name = `Ability Modifier (${CONFIG.D35E.abilities[rollAbility]})`;
          skillSourceDetails[abilityModIndex].value = this.system.abilities[rollAbility].mod;
        }
      }

      let hookData = { skillRollFormula, skillSourceDetails, skillManualBonus, target }
      /**
       * @hook D35E.preRollSkill
       * This hook is called before a skill roll is made. It can be used to modify the skill roll formula, skill source details (containing the list of bonuses), and skill manual bonus.
       *
       * Params:
       * @param{sklName} the name of the skill being rolled
       * @param{hookData} An object containing the skillRollFormula, skillSourceDetails, skillManualBonus and target
       * @param{rollData} - The roll data
       * @param{userId} - The user id
       */
      Hooks.call('D35E.preRollSkill', sklName, hookData, rollData, game.userId);
      let { skillRollFormula: newSkillRollFormula, skillSourceDetails: newSkillSourceDetails, skillManualBonus: newSkillManualBonus, target: newTarget } = hookData;


      if (skillManualBonus) {
        skillSourceDetails.push(
          { value: skillManualBonus, name: 'Situational Modifier' });
      }
      for (let skillDetail of skillSourceDetails) {
        skillRollFormula += `+ ${skillDetail.value}`;
      }
      if (rollData.featSkillBonusList) {
        for (let [i, bonus] of rollData.featSkillBonusList.entries()) {
          if (typeof bonus['value'] === 'string' || bonus['value'] instanceof
            String)
            bonus['value'] = (await new Roll35e(bonus['value'], rollData).roll()).total;
          skillRollFormula += `+ ${bonus['value']}`;
          bonus['name'] = bonus['sourceName'];
        }
      }
      rollData.skillManualBonus = skillManualBonus;
      let roll = await (new Roll35e(skillRollFormula, rollData).roll());

      /**
       * @hook D35E.postRollRollSkill
       * This hook is called just after skill roll is made. You can edit the roll there before success is evaluated
       *
       * Params:
       * <b>sklName</b> - The name of the skill being rolled
       * <b>roll</b> - The roll object
       * <b>rollData</b> - The roll data
       */
      Hooks.call('D35E.postRollRollSkill', sklName, roll, rollData, game.userId);
      rollData.rollTotal = roll.total;
      rollData.success = target ? roll.total >= target : true;
      let actions = await this.getAndApplyCombatChangesSpecialActions(
        allCombatChanges,
        this,
        rollData,
        optionalFeatIds,
        optionalFeatRanges,
      );

      let modifiersList = foundry.utils.duplicate(skillSourceDetails);
      if (!take20 && !take10) {
        modifiersList.unshift(
          { value: roll.terms[0].results[0].result, name: 'Skill Roll' });
      }
      modifiersList.push(...(rollData.featSkillBonusList || []));

      const token = this ? this.token : null;
      let tooltip = '';
      for (let descriptionPart of modifiersList) {
        tooltip += `<tr>
                <td><b>${descriptionPart.name}</b></td>
                <td><b>${descriptionPart.value}</b></td>
                </tr>
                `;
      }
      var tooltips = `<div class="dice-formula" style="margin-bottom: 8px">${roll.formula}</div><div class="table-container"><table>${tooltip}</table></div>`;
      let rollTooltip = await roll.getTooltip();
      let renderedTooltip;
      if (rollTooltip) {
        const _tw3 = document.createElement('div');
        _tw3.innerHTML = rollTooltip;
        const _te3 = _tw3.firstElementChild;
        if (_te3) _te3.insertAdjacentHTML('afterbegin', tooltips);
        renderedTooltip = _te3 ? _te3.outerHTML : tooltips;
      } else {
        renderedTooltip = tooltips;
      }
      // Set chat data
      let chatData = {
        speaker: options.speaker ? options.speaker : ChatMessage.getSpeaker(
          { actor: this }),
        rollMode: rollMode || 'gmroll',
        sound: CONFIG.sounds.dice,
        'flags.warcraftrpg2e.noRollRender': true,
      };
      let chatTemplateData = {
        name: this.name,
        [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
        rollMode: rollMode || 'gmroll',
        tokenId: token ? `${token.parent.id}.${token.id}` : null,
        actor: this,
      };
      const templateData = foundry.utils.mergeObject(
        chatTemplateData,
        {
          revealed: false,
          actions: actions,
          img: this.img,
          roll: roll,
          sklName: sklName,
          total: roll.total,
          result: roll.result,
          skl: skl,
          take20: take20,
          take10: take10,
          tooltip: renderedTooltip,
          success: target && roll.total >= target,
          target: target,
          properties: props,
          hasProperties: props.length > 0,
        },
        { inplace: false },
      );
      // Create message

      await createCustomChatMessage('systems/warcraftrpg2e/templates/chat/skill.html',
        templateData, chatData, {
        rolls: [roll],
      });

      Hooks.call('D35E.postRollSkill', sklName, roll, rollData.success, game.userId);
      return roll;
    };

    // Generating Skill Name
    let skl, sklName, skillTag, subSkillId;
    const skillParts = skillId.split('.'),
      isSubSkill = (skillParts[1] === 'subSkills' || skillParts[1] ===
        'namedSubSkills') && skillParts.length === 3;
    if (isSubSkill) {
      skillId = skillParts[0];
      if (skillParts[1] === 'namedSubSkills') {

      }
      skl = this.system.skills[skillId][skillParts[1]][skillParts[2]];
      sklName = `${CONFIG.D35E.skills[skillId]} (${skl.name})`;
      skillTag = createTag(skl.name);
      subSkillId = Object.entries(this.system.skills[skillId].subSkills).
        find(([id, skill]) => skill === skl)[0];
    } else {
      skl = this.system.skills[skillId];
      if (skl.name != null) sklName = skl.name;
      else sklName = CONFIG.D35E.skills[skillId];
      skillTag = createTag(sklName);
    }

    // Add contextual notes
    let props = [];
    let notes = [];
    const rollData = foundry.utils.duplicate(this.getRollData());
    rollData.skillId = skillId;
    rollData.skillTag = skillTag;
    rollData.subSkillId = subSkillId;
    let contextNoteSkillId = isSubSkill
      ? `skill.${skillId}.subSkills.${subSkillId}`
      : `skill.${skillId}`;
    let sourceChangesSkillId = isSubSkill
      ? `system.skills.${skillId}.subSkills.${subSkillId}.changeBonus`
      : `system.skills.${skillId}.changeBonus`;
    const noteObjects = this.getContextNotes(contextNoteSkillId);
    for (let noteObj of noteObjects) {
      rollData.item = {};
      if (noteObj.item != null) rollData.item = new Item35E(
        noteObj.item.toObject(), { owner: this.isOwner }).getRollData();

      for (let note of noteObj.notes) {
        for (let _note of note.split(/[\n\r]+/)) {
          let enrichedNote = await foundry.applications.ux.TextEditor.enrichHTML(
            Item35E._fillTemplate(_note, rollData), {
            rollData: rollData,
          });
          notes.push(enrichedNote);
        }
      }
    }
    if (skl.rt && (skl.points === null || skl.points === 0)) {
      notes.push(game.i18n.localize('D35E.Untrained'));
    }

    if (notes.length > 0) props.push({ header: 'Notes', value: notes });

    const label = sklName;
    let template = 'systems/warcraftrpg2e/templates/apps/skill-roll-dialog.html';
    let dialogData = {
      data: rollData,
      config: CONFIG.D35E,
      ability: skl.ability,
      rollMode: options.rollMode
        ? options.rollMode
        : game.settings.get('warcraftrpg2e',
          `rollConfig`).rollConfig[this.type].skill ||
        game.settings.get('core', 'rollMode'),
      rollModes: CONFIG.Dice.rollModes,
      rollModesForSelect: getRollModesForSelect(),
      skFeats: this.combatChangeItems.filter(
        (o) => ItemCombatChangesHelper.canHaveCombatChanges(o, rollData,
          'skill')),
      skFeatsOptional: this.combatChangeItems.filter((o) =>
        ItemCombatChangesHelper.canHaveCombatChanges(o, rollData,
          'skillOptional'),
      ),
      label: label,
    };
    const html = await foundry.applications.handlebars.renderTemplate(template, dialogData);
    let roll;
    const buttons = {};
    let wasRolled = false;

    if (options.skipDialog ||
      (options.event && (options.event.shiftKey || options.event.button === 2))
    ) {
      wasRolled = true;
      roll = _roll.call(this, options.target, null, props, sklName, '1d20',
        sourceChangesSkillId, options.rollMode);
      return Promise.resolve(roll);
    }

    buttons.takeTen = {
      label: game.i18n.localize('D35E.Take10'),
      callback: (html) => {
        wasRolled = true;
        roll = _roll.call(this, options.target, html, props, sklName, '10',
          sourceChangesSkillId, options.rollMode);
      },
    };
    buttons.takeTwenty = {
      label: game.i18n.localize('D35E.Take20'),
      callback: (html) => {
        wasRolled = true;
        roll = _roll.call(this, options.target, html, props, sklName, '20',
          sourceChangesSkillId, options.rollMode);
      },
    };
    buttons.normal = {
      label: game.i18n.localize('D35E.Roll'),
      callback: (html) => {
        wasRolled = true;
        roll = _roll.call(this, options.target, html, props, sklName, '1d20',
          sourceChangesSkillId, options.rollMode);
      },
    };
    return new Promise((resolve) => {
      new Dialog(
        {
          title: sklName + ' - ' + this.name,
          content: html,
          buttons: buttons,
          classes: ['custom-dialog', 'wide'],
          default: 'normal',
          close: (html) => {
            return resolve(roll);
          },
        },
        {
          width: 400,
        },
      ).render(true);
    });
  }

  /**
   * Make a grapple roll, with optional versus check
   * @param target target saving throw dc
   * @param options options
   * @returns {Promise<unknown>|void}
   */
  async rollGrapple(target, options = {}) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));

    const _roll = async function (target, form, props) {
      let grappleModTotal =
        foundry.utils.getProperty(this.system, 'attributes.cmb.total') -
        (foundry.utils.getProperty(this.system, 'attributes.energyDrain') || 0),
        optionalFeatIds = [],
        optionalFeatRanges = new Map(),
        rollMode = null;
      let grappleManualBonus = 0;
      // Get data from roll form
      if (form) {
        const formEl = form?.nodeType === 1 ? form : form?.[0] ?? form;
        grappleManualBonus = formEl.querySelector('[name="gr-bonus"]')?.value || 0;

        rollMode = formEl.querySelector('[name="rollMode"]')?.value;

        formEl.querySelectorAll('[data-type="optional"]').forEach((el) => {
          if (el.checked) {
            let featId = el.getAttribute('data-feat-optional');
            optionalFeatIds.push(featId);
            if (formEl.querySelector(`[name="optional-range-${featId}"]`)?.value !==
              undefined)
              optionalFeatRanges.set(featId, {
                base: formEl.querySelector(`[name="optional-range-${featId}"]`)?.value || 0,
                slider1: formEl.querySelector(`[name="optional-range-1-${featId}"]`)?.value || 0,
                slider2: formEl.querySelector(`[name="optional-range-2-${featId}"]`)?.value || 0,
                slider3: formEl.querySelector(`[name="optional-range-3-${featId}"]`)?.value || 0,
              });
          }
        });
      }

      // Parse combat changes
      let allCombatChanges = [];
      let rollModifiers = [];
      let attackType = 'grapple';
      allCombatChanges = ItemCombatChangesHelper.getAllSelectedCombatChangesForRoll(
        this.items,
        attackType,
        rollData,
        allCombatChanges,
        rollModifiers,
        optionalFeatIds,
        optionalFeatRanges,
      );

      if (rollModifiers.length > 0)
        props.push({
          header: game.i18n.localize('D35E.RollModifiers'),
          value: rollModifiers,
        });

      this._addCombatChangesToRollData(allCombatChanges, rollData);
      rollData.featGrappleBonus = rollData.featGrapple || 0;
      rollData.grappleModTotal = grappleModTotal;
      rollData.grappleManualBonus = grappleManualBonus;

      let roll = await new Roll35e(
        '1d20 + @grappleModTotal + @grappleManualBonus + @featGrappleBonus',
        rollData).roll();

      let actions = [];
      if (!target) {
        actions.push({
          label: `${game.i18n.localize('D35E.CMB')} ${game.i18n.localize(
            'D35E.Check')}`,
          value: `Grapple ${roll.total} on target;`,
          isTargeted: false,
          action: 'customAction',
          img: '',
          hasImg: false,
        });
      } else if (target && roll.total < target) {
        actions.push({
          label: `${game.i18n.localize('D35E.Begin')} ${game.i18n.localize(
            'D35E.CMB')}`,
          value: `Condition set grappled to true on target;`,
          isTargeted: false,
          action: 'customAction',
          img: '',
          hasImg: false,
        });
      }

      const token = this ? this.token : null;

      // Set chat data
      let chatData = {
        speaker: ChatMessage.getSpeaker({ actor: this }),
        rollMode: rollMode || 'gmroll',
        sound: CONFIG.sounds.dice,
        'flags.warcraftrpg2e.noRollRender': true,
      };
      let chatTemplateData = {
        name: this.name,
        [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
        rollMode: rollMode || 'gmroll',
        tokenId: token ? `${token.parent.id}.${token.id}` : null,
        actorId: this.id,
      };
      const _tw4 = document.createElement('div');
      _tw4.innerHTML = await roll.getTooltip();
      const _te4 = _tw4.firstElementChild;
      if (_te4) _te4.insertAdjacentHTML('afterbegin', `<div class="dice-formula">${roll.formula}</div>`);
      const templateData = foundry.utils.mergeObject(
        chatTemplateData,
        {
          actor: this,
          img: this.img,
          roll: roll,
          total: roll.total,
          result: roll.result,
          target: target,
          tooltip: _te4 ? _te4.outerHTML : '',
          success: target && roll.total >= target,
          properties: props,
          hasProperties: props.length > 0,
          actions: actions,
        },
        { inplace: true },
      );
      // Create message

      await createCustomChatMessage('systems/warcraftrpg2e/templates/chat/grapple.html',
        templateData, chatData, {
        rolls: [roll],
      });

      return roll;
    };

    // Add contextual notes
    let notes = [];
    const rollData = foundry.utils.duplicate(this.getRollData());
    const noteObjects = this.getContextNotes(`misc.cmb`);
    for (let noteObj of noteObjects) {
      rollData.item = {};
      if (noteObj.item != null) rollData.item = noteObj.item.toObject();
      await this.enrichAndAddNotes(noteObj, rollData, notes);
    }
    let props = this.getDefenseHeaders();
    if (notes.length > 0) props.push(
      { header: game.i18n.localize('D35E.Notes'), value: notes });
    const label = game.i18n.localize('D35E.CMB');

    let template = 'systems/warcraftrpg2e/templates/apps/grapple-roll-dialog.html';
    let dialogData = {
      data: rollData,
      rollMode: options.rollMode
        ? options.rollMode
        : game.settings.get('warcraftrpg2e',
          `rollConfig`).rollConfig[this.type].grapple ||
        game.settings.get('core', 'rollMode'),
      rollModes: CONFIG.Dice.rollModes,
      rollModesForSelect: getRollModesForSelect(),
      grFeats: this.combatChangeItems.filter((o) =>
        ItemCombatChangesHelper.canHaveCombatChanges(o, rollData, 'grapple'),
      ),
      grFeatsOptional: this.combatChangeItems.filter((o) =>
        ItemCombatChangesHelper.canHaveCombatChanges(o, rollData,
          'grappleOptional'),
      ),
      label: label,
    };
    const html = await foundry.applications.handlebars.renderTemplate(template, dialogData);
    let roll;
    const buttons = {};
    let wasRolled = false;
    buttons.normal = {
      label: game.i18n.localize('D35E.Roll'),
      callback: (html) => {
        wasRolled = true;
        roll = _roll.call(this, target, html, props);
      },
    };
    return new Promise((resolve) => {
      new Dialog(
        {
          title: `${game.i18n.localize('D35E.GRRollGrapple')}`,
          content: html,
          buttons: buttons,
          classes: ['custom-dialog', 'wide'],
          default: 'normal',
          close: (html) => {
            return resolve(roll);
          },
        },
        {
          width: 400,
        },
      ).render(true);
    });
  }

  /**
   *
   * @param {CombatChange[]} allCombatChanges
   * @param rollData
   * @private
   */
  _addCombatChangesToRollData(allCombatChanges, rollData) {
    let changeId = null;
    let changeVal = null;
    allCombatChanges.forEach((change) => {
      if (change.field.indexOf('$') !== -1) {
        changeId = change.field.substr(1);
        changeVal = Item35E._fillTemplate(change.formula, rollData);
        foundry.utils.setProperty(rollData, changeId, changeVal);
      } else if (change.field.indexOf('&') !== -1) {
        changeId = change.field.substr(1);
        changeVal = Item35E._fillTemplate(change.formula, rollData);
        foundry.utils.setProperty(
          rollData,
          change.field.substr(1),
          (foundry.utils.getProperty(rollData, change.field.substr(1)) || '0') + ' + ' +
          changeVal,
        );
      } else {
        changeId = change.field;
        changeVal = parseInt(change.formula || 0);
        foundry.utils.setProperty(rollData, change.field,
          (foundry.utils.getProperty(rollData, change.field) || 0) + changeVal);
      }
      var listId = changeId.indexOf('.') !== -1 ? `${changeId.replace('.',
        'List.')}` : `${changeId}List`;
      foundry.utils.setProperty(
        rollData,
        listId,
        (foundry.utils.getProperty(rollData, listId) || []).concat(
          [{ value: changeVal, sourceName: change['sourceName'] }]),
      );
    });
  }

  /* -------------------------------------------- */

  /**
   * Roll an Ability Test
   * Prompt the user for input regarding Advantage/Disadvantage and any Situational Bonus
   * @param {String} abilityId    The ability ID (e.g. "str")
   * @param {Object} options      Options which configure how ability tests are rolled
   */
  async rollAbilityTest(abilityId, options = {}) {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));

    // Add contextual notes
    let notes = [];
    const rollData = foundry.utils.duplicate(this.system);
    const noteObjects = this.getContextNotes(`abilityChecks.${abilityId}`);
    for (let noteObj of noteObjects) {
      rollData.item = {};
      if (noteObj.item != null) rollData.item = noteObj.item.toObject();
      await this.enrichAndAddNotes(noteObj, rollData, notes);
    }

    let props = this.getDefenseHeaders();
    if (notes.length > 0) props.push({ header: 'Notes', value: notes });
    const label = CONFIG.D35E.abilities[abilityId];
    const abl = this.system.abilities[abilityId];
    const heroPointBonus = heroPointRollBonus(this, ['d20']);
    const roll = await DicePF.d20Roll({
      event: options.event,
      parts: ['@mod + @checkMod - @drain + @heroPointBonus'],
      data: {
        mod: abl.mod,
        checkMod: abl.checkMod,
        drain: foundry.utils.getProperty(this.system, 'attributes.energyDrain') || 0,
        heroPointBonus,
      },
      title: game.i18n.localize('D35E.AbilityTest').format(label),
      speaker: ChatMessage.getSpeaker({ actor: this }),
      chatTemplate: 'systems/warcraftrpg2e/templates/chat/roll-ext.html',
      chatTemplateData: { hasProperties: props.length > 0, properties: props },
    });
    if (heroPointBonus) await clearPendingHeroPoint(this);
    return roll;
  }

  async rollTurnUndead(name = 'Undead') {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));
    const rollData = foundry.utils.duplicate(this.system);
    let turnUndeadHdTotal = this.system.attributes.turnUndeadHdTotal;
    let turnUndeadUses = this.system.attributes.turnUndeadUses;
    if (turnUndeadHdTotal < 1) {
      return ui.notifications.warn(
        game.i18n.localize('D35E.CannotTurnUndead').format(this.name));
    }
    // if (turnUndeadUses < 1) {
    //     return ui.notifications.warn(game.i18n.localize("D35E.CannotTurnUndead").format(this.name));
    // }
    let rolls = [];
    let knowledgeMod = foundry.utils.getProperty(this.system, 'skills.kre.rank') > 5 ? 2 : 0;
    let chaMod = this.system.abilities.cha.mod;
    let maxHdResult = await new Roll35e('1d20 + @chaMod + @kMod',
      { kMod: knowledgeMod, chaMod: chaMod }).roll();
    rolls.push(maxHdResult);
    let data = {};
    data.actor = this;
    data.name = this.name;
    data.kMod = knowledgeMod;
    data.chaMod = chaMod;
    data.maxHDResult = maxHdResult;
    if (maxHdResult.total > 21) {
      data.maxHD = turnUndeadHdTotal + 4;
      data.diffHD = '+ 4';
    } else if (maxHdResult.total > 18) {
      data.maxHD = turnUndeadHdTotal + 3;
      data.diffHD = '+ 3';
    } else if (maxHdResult.total > 15) {
      data.maxHD = turnUndeadHdTotal + 2;
      data.diffHD = '+ 2';
    } else if (maxHdResult.total > 12) {
      data.maxHD = turnUndeadHdTotal + 1;
      data.diffHD = '+ 1';
    } else if (maxHdResult.total > 9) {
      data.maxHD = turnUndeadHdTotal;
    } else if (maxHdResult.total > 6) {
      data.maxHD = turnUndeadHdTotal - 1;
      data.diffHD = '- 1';
    } else if (maxHdResult.total > 3) {
      data.maxHD = turnUndeadHdTotal - 2;
      data.diffHD = '- 2';
    } else if (maxHdResult.total > 0) {
      data.maxHD = turnUndeadHdTotal - 3;
      data.diffHD = '- 3';
    } else {
      data.maxHD = turnUndeadHdTotal - 4;
      data.diffHD = '- 4';
    }

    {
      const _tw5 = document.createElement('div');
      _tw5.innerHTML = await maxHdResult.getTooltip();
      const _te5 = _tw5.firstElementChild;
      if (_te5) _te5.insertAdjacentHTML('afterbegin', `<div class="dice-formula">${maxHdResult.formula}</div>`);
      const _tw5b = document.createElement('div');
      _tw5b.innerHTML = _te5 ? _te5.outerHTML : '';
      let totalText = maxHdResult.total.toString();
      const _pt5 = _tw5b.querySelector('.part-total');
      if (_pt5) _pt5.textContent = totalText;
      data.maxHDResult.tooltip = _tw5b.innerHTML;
    }

    let damageHD = await new Roll35e('2d6 + @chaMod + @level',
      { level: turnUndeadHdTotal, chaMod: chaMod }).roll();
    rolls.push(damageHD);
    data.damageHD = damageHD;
    data.undeadName = name;
    {
      const _tw6 = document.createElement('div');
      _tw6.innerHTML = await damageHD.getTooltip();
      const _te6 = _tw6.firstElementChild;
      if (_te6) _te6.insertAdjacentHTML('afterbegin', `<div class="dice-formula">${damageHD.formula}</div>`);
      const _tw6b = document.createElement('div');
      _tw6b.innerHTML = _te6 ? _te6.outerHTML : '';
      let totalText = damageHD.total.toString();
      const _pt6 = _tw6b.querySelector('.part-total');
      if (_pt6) _pt6.textContent = totalText;
      data.damageHD.tooltip = _tw6b.innerHTML;
    }

    let chatData = {
      speaker: ChatMessage.getSpeaker({ actor: this }),
      sound: CONFIG.sounds.dice,
      'flags.warcraftrpg2e.noRollRender': true,
    };

    data.level = turnUndeadHdTotal;

    await createCustomChatMessage('systems/warcraftrpg2e/templates/chat/turn-undead.html',
      data, chatData, { rolls: rolls });
    let updateData = {};
    updateData[`system.attributes.turnUndeadUses`] = foundry.utils.getProperty(this.system,
      'attributes.turnUndeadUses') - 1;
    this.update(updateData);
  }

  /**
   * Display defenses in chat.
   */
  async displayDefenses() {
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));
    const rollData = foundry.utils.duplicate(this.system);

    // Add contextual AC notes
    let acNotes = [];
    if (foundry.utils.getProperty(this.system, 'attributes.acNotes')?.length > 0)
      acNotes = this.system.attributes.acNotes.split(/[\n\r]+/);
    const acNoteObjects = this.getContextNotes('misc.ac');
    for (let noteObj of acNoteObjects) {
      rollData.item = {};
      if (noteObj.item != null) rollData.item = noteObj.item.toObject();

      await this.enrichAndAddNotes(noteObj, rollData, acNotes);
    }

    // Add contextual CMD notes
    let cmdNotes = [];
    if (foundry.utils.getProperty(this.system, 'attributes.cmdNotes')?.length > 0)
      cmdNotes = this.system.attributes.cmdNotes.split(/[\n\r]+/);
    const cmdNoteObjects = this.getContextNotes('misc.cmd');
    for (let noteObj of cmdNoteObjects) {
      rollData.item = {};
      if (noteObj.item != null) rollData.item = noteObj.item.toObject();

      await this.enrichAndAddNotes(noteObj, rollData, cmdNotes);
    }

    // Add contextual SR notes
    let srNotes = [];
    if (foundry.utils.getProperty(this.system, 'attributes.srNotes')?.length > 0)
      srNotes = this.system.attributes.srNotes.split(/[\n\r]+/);
    const srNoteObjects = this.getContextNotes('misc.sr');
    for (let noteObj of srNoteObjects) {
      rollData.item = {};
      if (noteObj.item != null) rollData.item = noteObj.item.toObject();
      await this.enrichAndAddNotes(noteObj, rollData, srNotes);
    }

    // Add misc data
    const reSplit = CONFIG.D35E.re.traitSeparator;
    // Damage Reduction
    let drNotes = [];
    if (foundry.utils.getProperty(this.system, 'traits.dr')?.length) {
      drNotes = this.system.traits.dr.split(reSplit);
    }
    // Energy Resistance
    let energyResistance = [];
    if (foundry.utils.getProperty(this.system, 'traits.eres')?.length) {
      energyResistance.push(...this.system.traits.eres.split(reSplit));
    }
    // Damage Immunity
    if (foundry.utils.getProperty(this.system, 'traits.di.value')?.length ||
      foundry.utils.getProperty(this.system, 'traits.di.custom')?.length) {
      const values = [
        ...this.system.traits.di.value.map((obj) => {
          return game.i18n.localize(CONFIG.D35E.damageTraitTypes[obj]);
        }),
        ...(foundry.utils.getProperty(this.system, 'traits.di.custom')?.length > 0
          ? this.system.traits.di.custom.split(reSplit)
          : []),
      ];
      energyResistance.push(
        ...values.map((o) => game.i18n.localize('D35E.ImmuneTo').format(o)));
    }
    // Damage Vulnerability
    if (foundry.utils.getProperty(this.system, 'traits.dv.value')?.length ||
      foundry.utils.getProperty(this.system, 'traits.dv.custom')?.length) {
      const values = [
        ...this.system.traits.dv.value.map((obj) => {
          return game.i18n.localize(CONFIG.D35E.damageTraitTypes[obj]);
        }),
        ...(foundry.utils.getProperty(this.system, 'traits.dv.custom')?.length > 0
          ? this.system.traits.dv.custom.split(reSplit)
          : []),
      ];
      energyResistance.push(...values.map(
        (o) => game.i18n.localize('D35E.VulnerableTo').format(o)));
    }

    // Create message
    const d = this.system;
    const data = {
      actor: this,
      name: this.name,
      tokenId: this.token ? `${this.token.scene?.id ?? this.token.document?.scene?.id}.${this.token.id}` : null,
      ac: {
        normal: d.attributes.ac.normal.total,
        touch: d.attributes.ac.touch.total,
        flatFooted: d.attributes.ac.flatFooted.total,
        notes: acNotes,
      },
      cmd: {
        normal: d.attributes.cmd.total,
        flatFooted: d.attributes.cmd.flatFootedTotal,
        notes: cmdNotes,
      },
      misc: {
        sr: d.attributes.sr.total,
        srNotes: srNotes,
        drNotes: drNotes,
        energyResistance: energyResistance,
      },
    };
    // Add regeneration and fast healing
    if (
      (foundry.utils.getProperty(d, 'traits.fastHealingTotal') || '')?.length ||
      (foundry.utils.getProperty(d, 'traits.regenTotal') || '')?.length
    ) {
      data.regen = {
        regen: d.traits.regenTotal,
        fastHealing: d.traits.fastHealingTotal,
      };
    }
    createCustomChatMessage('systems/warcraftrpg2e/templates/chat/defenses.html', data, {
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
    });
  }

  /* -------------------------------------------- */

  /**
   * Make AC test using Combat Changes bonuses
   * @param ev event
   * @param skipDialog option to ship dialog and use default roll
   * @returns {Promise<unknown>}
   */
  async rollDefenseDialog({
    ev = null,
    skipDialog = false,
    touch = false,
    flatfooted = false,
  } = {}) {
    const _roll = async function (acType, form) {
      let rollModifiers = [];
      let ac = foundry.utils.getProperty(this.system, `attributes.ac.${acType}.total`) || 0,
        optionalFeatIds = [],
        optionalFeatRanges = new Map(),
        applyHalf = false,
        noCritical = false,
        applyPrecision = false,
        conceal = false,
        fullConceal = false,
        rollMode = 'gmroll';
      let baseAc = ac;
      // Get form data
      if (form) {
        const formEl = form?.nodeType === 1 ? form : form?.[0] ?? form;
        rollData.acBonus = formEl.querySelector('[name="ac-bonus"]')?.value;
        if (rollData.acBonus) ac += (await new Roll35e(rollData.acBonus).roll()).total;

        rollMode = formEl.querySelector('[name="rollMode"]')?.value;

        formEl.querySelectorAll('[data-type="optional"]').forEach((el) => {
          if (el.checked) {
            let featId = el.getAttribute('data-feat-optional');
            optionalFeatIds.push(featId);
            if (formEl.querySelector(`[name="optional-range-${featId}"]`)?.value !==
              undefined)
              optionalFeatRanges.set(featId, {
                base: formEl.querySelector(`[name="optional-range-${featId}"]`)?.value || 0,
                slider1: formEl.querySelector(`[name="optional-range-1-${featId}"]`)?.value || 0,
                slider2: formEl.querySelector(`[name="optional-range-2-${featId}"]`)?.value || 0,
                slider3: formEl.querySelector(`[name="optional-range-3-${featId}"]`)?.value || 0,
              });
          }
        });

        if (formEl.querySelector('[name="applyHalf"]')?.checked) {
          applyHalf = true;
        }

        if (formEl.querySelector('[name="noCritical"]')?.checked) {
          noCritical = true;
        }
        if (formEl.querySelector('[name="applyPrecision"]')?.checked) {
          applyPrecision = true;
        }
        if (formEl.querySelector('[name="prone"]')?.checked) {
          ac += new Roll35e('-4').evaluateSync().total;
          rollModifiers.push(`${game.i18n.localize('D35E.Prone')}`);
        }
        if (formEl.querySelector('[name="squeezing"]')?.checked) {
          ac += new Roll35e('-4').evaluateSync().total;
          rollModifiers.push(`${game.i18n.localize('D35E.Squeezing')}`);
        }
        if (formEl.querySelector('[name="defense"]')?.checked) {
          if ((this.system.skills?.tmb?.rank || 0) >= 25) {
            ac += new Roll35e(`4+${Math.floor(
              (this.system.skills?.tmb?.rank - 25) / 10)}`).evaluateSync().total;
            rollModifiers.push(`${game.i18n.localize(
              'D35E.Defense')} (Epic ${game.i18n.localize(
                'D35E.SkillTmb')})`);
          } else if ((this.system.skills?.tmb?.rank || 0) >= 5) {
            ac += new Roll35e('+3').evaluateSync().total;
            rollModifiers.push(
              `${game.i18n.localize('D35E.Defense')} (${game.i18n.localize(
                'D35E.SkillTmb')})`);
          } else {
            ac += new Roll35e('+2').evaluateSync().total;
            rollModifiers.push(`${game.i18n.localize('D35E.Defense')}`);
          }
        }
        if (formEl.querySelector('[name="totaldefense"]')?.checked) {
          if ((this.system.skills?.tmb?.rank || 0) >= 25) {
            ac += new Roll35e(`8+${2 * Math.floor(
              (this.system.skills?.tmb?.rank - 25) / 10)}`).evaluateSync().total;
            rollModifiers.push(
              `${game.i18n.localize(
                'D35E.TotalDefense')} (Epic ${game.i18n.localize(
                  'D35E.SkillTmb')})`,
            );
          } else if ((this.system.skills?.tmb?.rank || 0) >= 5) {
            ac += new Roll35e('+6').evaluateSync().total;
            rollModifiers.push(`${game.i18n.localize(
              'D35E.TotalDefense')} (${game.i18n.localize(
                'D35E.SkillTmb')})`);
          } else {
            ac += new Roll35e('+4').evaluateSync().total;
            rollModifiers.push(`${game.i18n.localize('D35E.TotalDefense')}`);
          }
        }
        if (formEl.querySelector('[name="covered"]')?.checked) {
          ac += new Roll35e('+4').evaluateSync().total;
          rollModifiers.push(`${game.i18n.localize('D35E.Covered')}`);
        }
        if (formEl.querySelector('[name="improvcovered"]')?.checked) {
          ac += new Roll35e('+8').evaluateSync().total;
          rollModifiers.push(`${game.i18n.localize('D35E.ImprovedCover')}`);
        }
        if (formEl.querySelector('[name="charged"]')?.checked) {
          ac += new Roll35e('-2').evaluateSync().total;
          rollModifiers.push(`${game.i18n.localize('D35E.Charged')}`);
        }

        if (formEl.querySelector('[name="conceal"]')?.checked) {
          conceal = true;
        }

        if (formEl.querySelector('[name="fullconceal"]')?.checked) {
          fullConceal = true;
        }

        rollData.concealOverride = parseInt(
          formEl.querySelector('[name="conceal-bonus"]')?.value);
      }

      let allCombatChanges = [];
      let attackType = 'defense';

      allCombatChanges = ItemCombatChangesHelper.getAllSelectedCombatChangesForRoll(
        this.items,
        attackType,
        rollData,
        allCombatChanges,
        rollModifiers,
        optionalFeatIds,
        optionalFeatRanges,
      );

      this._addCombatChangesToRollData(allCombatChanges, rollData);

      ac += parseInt(rollData.featAC) || 0;
      const heroPointBonus = heroPointRollBonus(this, 'defense');
      if (heroPointBonus) {
        ac += heroPointBonus;
        rollModifiers.push(game.i18n.localize('D35E.WarcraftHeroAcBonus'));
        await clearPendingHeroPoint(this);
      }
      rollData.featACList = rollData.featACList || [];
      rollData.featACList.unshift(
        { value: baseAc, sourceName: game.i18n.localize('D35E.AC') });
      //LogHelper.log('Final roll AC', ac)
      return {
        ac: ac,
        applyHalf: applyHalf,
        noCritical: noCritical,
        noCheck: acType === 'noCheck',
        rollMode: rollMode,
        applyPrecision: applyPrecision,
        rollModifiers: rollModifiers,
        conceal: conceal,
        fullConceal: fullConceal,
        concealOverride: rollData.concealOverride,
        allCombatChanges: allCombatChanges,
        rollData: rollData,
        optionalFeatIds: optionalFeatIds,
        optionalFeatRanges: optionalFeatRanges,
        acModifiers: rollData.featACList || [],
      };
    };
    let rollData = this.getRollData(null, true);
    // Render modal dialog
    let template = 'systems/warcraftrpg2e/templates/apps/defense-roll-dialog.html';
    let totalBonus = '+4';
    let defenseBonus = '+2';
    if ((this.system.skills?.tmb?.rank || 0) >= 25) {
      totalBonus = `+${8 + 2 *
        Math.floor((this.system.skills?.tmb?.rank - 25) / 10)}`;
      defenseBonus = `+${4 +
        Math.floor((this.system.skills?.tmb?.rank - 25) / 10)}`;
    } else if ((this.system.skills?.tmb?.rank || 0) >= 5) {
      totalBonus = `+6`;
      defenseBonus = `+3`;
    }
    let dialogData = {
      data: rollData,
      item: this.system,
      id: `${this.id}-defensedialog`,
      rollMode:
        game.settings.get('warcraftrpg2e',
          `rollConfig`).rollConfig[this.type].applyDamage ||
        game.settings.get('core', 'rollMode'),
      totalBonus: totalBonus,
      defenseBonus: defenseBonus,
      rollModes: CONFIG.Dice.rollModes,
      rollModesForSelect: getRollModesForSelect(),
      applyHalf: ev.applyHalf,
      touch: touch,
      baseConcealment: foundry.utils.getProperty(this.system, 'attributes.concealment.total'),
      isAlreadyProne: foundry.utils.getProperty(this.system, 'attributes.conditions.prone'),
      baseConcealmentAtLeast20: foundry.utils.getProperty(this.system,
        'attributes.concealment.total') > 20,
      baseConcealmentAtLeast50: foundry.utils.getProperty(this.system,
        'attributes.concealment.total') > 50,
      defenseFeats: this.combatChangeItems.filter((o) =>
        ItemCombatChangesHelper.canHaveCombatChanges(o, rollData, 'defense'),
      ),
      defenseFeatsOptional: this.combatChangeItems.filter((o) =>
        ItemCombatChangesHelper.canHaveCombatChanges(o, rollData,
          'defenseOptional'),
      ),
      conditionals: foundry.utils.getProperty(this.system, 'conditionals'),
    };
    dialogData.hasFeats = dialogData.defenseFeats.length ||
      dialogData.defenseFeatsOptional.length;
    const html = await foundry.applications.handlebars.renderTemplate(template, dialogData);
    let roll;
    const buttons = {};
    let wasRolled = false;
    let defaultButton = 'vsNormal';
    if (touch) {
      buttons.vsTouch = {};
      defaultButton = 'vsTouch';
    }
    buttons.vsNormal = {
      label: game.i18n.localize('D35E.ACVsNormal'),
      callback: (html) => {
        wasRolled = true;
        roll = _roll.call(this, 'normal', html);
      },
    };
    buttons.vsTouch = {
      label: game.i18n.localize('D35E.ACvsTouch'),
      callback: (html) => {
        wasRolled = true;
        roll = _roll.call(this, 'touch', html);
      },
    };
    buttons.vsFlat = {
      label: game.i18n.localize('D35E.ACvsFlat'),
      callback: (html) => {
        wasRolled = true;
        roll = _roll.call(this, 'flatFooted', html);
      },
    };

    buttons.vsNo = {
      label: game.i18n.localize('D35E.ACvsNoCheck'),
      callback: (html) => {
        wasRolled = true;
        roll = _roll.call(this, 'noCheck', html);
      },
    };
    let finalAc = await new Promise((resolve) => {
      new Dialog(
        {
          title: `${game.i18n.localize('D35E.ACRollDefense')}`,
          content: html,
          buttons: buttons,
          classes: ['custom-dialog', 'wide'],
          default: defaultButton,
          close: (html) => {
            return resolve(roll);
          },
        },
        {
          classes: [
            'roll-defense',
            'dialog',
            dialogData.hasFeats ? 'twocolumn' : 'single'],
          width: dialogData.hasFeats ? 800 : 400,
        },
      ).render(true);
    });
    // flex: 400px;
    // margin: 0;
    // margin-bottom: 4px;
    //LogHelper.log('Final dialog AC', finalAc)
    return finalAc || { ac: -1, applyHalf: false, noCritical: false };
  }

  static async applyAbilityDamage(damage, ability, actor = null) {
    let tokensList = [];
    const promises = [];
    if (actor === null) {
      if (game.user.targets.size > 0) tokensList = Array.from(
        game.user.targets);
      else tokensList = canvas.tokens.controlled;
      if (!tokensList.length) {
        ui.notifications.warn(game.i18n.localize('D35E.NoTokensSelected'));
        return;
      }
    } else {
      tokensList.push({ actor: actor });
    }

    for (let t of tokensList) {
      let a = t.actor,
        abilityField = `system.abilities.${ability}.damage`,
        abilityDamage = a.system.abilities[ability].damage || 0,
        updateData = {};
      if (!canApplyWarcraftAbilityDamage({
        creatureType: a.system.attributes?.creatureType,
        deathRule: resolveDeathRule(
          a.system.attributes?.deathRule,
          a.race?.system?.deathRule,
          a.system.attributes?.creatureType,
        ),
        ability,
      })) continue;
      updateData[abilityField] = abilityDamage + damage;
      promises.push(t.actor.update(updateData));
    }
    return Promise.all(promises);
  }

  static async applyAbilityDrain(damage, ability, actor = null) {
    let tokensList = [];
    const promises = [];
    if (actor === null) {
      if (game.user.targets.size > 0) tokensList = Array.from(
        game.user.targets);
      else tokensList = canvas.tokens.controlled;
      if (!tokensList.length) {
        ui.notifications.warn(game.i18n.localize('D35E.NoTokensSelected'));
        return;
      }
    } else {
      tokensList.push({ actor: actor });
    }

    for (let t of tokensList) {
      let a = t.actor,
        abilityField = `system.abilities.${ability}.drain`,
        abilityDrain = a.system.abilities[ability].drain || 0,
        updateData = {};
      if (!canApplyWarcraftAbilityDrain({
        creatureType: a.system.attributes?.creatureType,
        deathRule: resolveDeathRule(
          a.system.attributes?.deathRule,
          a.race?.system?.deathRule,
          a.system.attributes?.creatureType,
        ),
      })) continue;
      updateData[abilityField] = abilityDrain + damage;
      promises.push(t.actor.update(updateData));
    }
    return Promise.all(promises);
  }

  async updateDamageReductionPoolItems(itemsToUpdate) {
    //await this.refresh();
    let itemUpdateData = [];
    let itemsEnding = [];
    let itemsOnRound = [];
    let itemsToDelete = [];
    let itemResourcesData = {};
    let deletedOrChanged = false;

    for (let possibleUpdate of itemsToUpdate) {
      let item = this.items.get(possibleUpdate.id);
      let current = item.system.damagePool.current - possibleUpdate.value;
      if (current <= 0 && item.system.damagePool.deleteOnDamagePoolEmpty) {
        itemUpdateData.push({
          item: item,
          data: { 'system.damagePool.current': 0, 'system.active': false },
        });
        itemsToDelete.push(possibleUpdate.id);
        deletedOrChanged = true;
      } else {
        if (current <= 0) {
          itemUpdateData.push({
            item: item,
            data: { 'system.damagePool.current': 0, 'system.active': false },
          });
          deletedOrChanged = true;
        } else {
          itemUpdateData.push(
            { item: item, data: { 'system.damagePool.current': current } });
          deletedOrChanged = true;
        }
      }
    }

    if (itemUpdateData.length > 0) {
      let updatePromises = [];
      for (let updateData of itemUpdateData) {
        updatePromises.push(
          updateData.item.update(updateData.data, { stopUpdates: true }));
      }
      await Promise.all(updatePromises);
    }
    if (itemsToDelete.length > 0) {
      await this.deleteEmbeddedDocuments('Item', itemsToDelete, {});
    }
  }

  static async applyDamage(...args) {
    LogHelper.warn('Deprecated: This method will be removed in D35E 2.5.0');
    return ActorDamageHelper.applyDamage(...args);
  }

  static async applyRegeneration(...args) {
    LogHelper.warn('Deprecated: This method will be removed in D35E 2.5.0');
    return ActorDamageHelper.applyRegeneration(...args);
  }

  async rollSave(type, ability, target, options = {}) {
    this.rollSavingThrow(type, ability, target, options);
  }

  static async _rollSave(type, ability, target, options = {}) {
    let tokensList;
    if (game.user.targets.size > 0) tokensList = Array.from(game.user.targets);
    else tokensList = canvas.tokens.controlled;
    const promises = [];
    if (!tokensList.length) {
      ui.notifications.warn(game.i18n.localize('D35E.NoTokensSelected'));
      return;
    }
    for (let t of tokensList) {
      if (t.actor == null) continue;
      let a = t.actor;
      if (!a.testUserPermission(game.user, 'OWNER')) {
        ui.notifications.warn(
          game.i18n.localize('D35E.ErrorNoActorPermission'));
        continue;
      }
      promises.push(t.actor.rollSavingThrow(type, ability, target, options));
    }
    return Promise.all(promises);
  }

  static async _rollSkill(type, options = {}) {
    let tokensList;
    if (game.user.targets.size > 0) tokensList = Array.from(game.user.targets);
    else tokensList = canvas.tokens.controlled;
    const promises = [];
    if (!tokensList.length) {
      ui.notifications.warn(game.i18n.localize('D35E.NoTokensSelected'));
      return;
    }
    for (let t of tokensList) {
      if (t.actor == null) continue;
      let a = t.actor;
      if (!a.testUserPermission(game.user, 'OWNER')) {
        ui.notifications.warn(
          game.i18n.localize('D35E.ErrorNoActorPermission'));
        continue;
      }
      promises.push(t.actor.rollSkill(type, options));
    }
    return Promise.all(promises);
  }

  static async _rollAbilityCheck(type, options = {}) {
    let tokensList;
    if (game.user.targets.size > 0) tokensList = Array.from(game.user.targets);
    else tokensList = canvas.tokens.controlled;
    const promises = [];
    if (!tokensList.length) {
      ui.notifications.warn(game.i18n.localize('D35E.NoTokensSelected'));
      return;
    }
    for (let t of tokensList) {
      if (t.actor == null) continue;
      let a = t.actor;
      if (!a.testUserPermission(game.user, 'OWNER')) {
        ui.notifications.warn(
          game.i18n.localize('D35E.ErrorNoActorPermission'));
        continue;
      }
      promises.push(t.actor.rollAbility(type, options));
    }
    return Promise.all(promises);
  }
  static async _rollPowerResistance(spellPenetration) {
    let tokensList;
    if (game.user.targets.size > 0) tokensList = Array.from(game.user.targets);
    else tokensList = canvas.tokens.controlled;
    const promises = [];
    if (!tokensList.length) {
      ui.notifications.warn(game.i18n.localize('D35E.NoTokensSelected'));
      return;
    }
    for (let t of tokensList) {
      if (t.actor == null) continue;
      let a = t.actor;
      if (!a.testUserPermission(game.user, 'OWNER')) {
        ui.notifications.warn(
          game.i18n.localize('D35E.ErrorNoActorPermission'));
        continue;
      }
      promises.push(t.actor.rollPowerResistance(spellPenetration, {}));
    }
    return Promise.all(promises);
  }

  static async _rollSpellResistance(spellPenetration) {
    let tokensList;
    if (game.user.targets.size > 0) tokensList = Array.from(game.user.targets);
    else tokensList = canvas.tokens.controlled;
    const promises = [];
    if (!tokensList.length) {
      ui.notifications.warn(game.i18n.localize('D35E.NoTokensSelected'));
      return;
    }
    for (let t of tokensList) {
      if (t.actor == null) continue;
      let a = t.actor;
      if (!a.testUserPermission(game.user, 'OWNER')) {
        ui.notifications.warn(
          game.i18n.localize('D35E.ErrorNoActorPermission'));
        continue;
      }
      promises.push(t.actor.rollSpellResistance(spellPenetration, {}));
    }
    return Promise.all(promises);
  }

  getSkill(key) {
    for (let [k, s] of Object.entries(foundry.utils.getProperty(this.system, 'skills'))) {
      if (k === key) return s;
      if (s.subSkills != null) {
        for (let [k2, s2] of Object.entries(s.subSkills)) {
          if (k2 === key) return s2;
        }
      }
    }
    return null;
  }

  get allNotes() {
    let result = [];

    const noteItems = this.items.filter((o) => {
      return o.system.contextNotes != null;
    });

    for (let o of noteItems) {
      if (o.type === 'buff' && !o.system.active) continue;
      if (o.type === 'aura' && !o.system.active) continue;
      if ((o.type === 'equipment' || o.type === 'weapon') &&
        !o.system.equipped) continue;
      if (!o.system.contextNotes || o.system.contextNotes.length ===
        0) continue;
      result.push({ notes: o.system.contextNotes, item: o });
    }

    return result;
  }

  /**
   * Generates an array with all the active context-sensitive notes for the given context on this actor.
   * @param {String} context - The context to draw from.
   */
  getContextNotes(context) {
    let result = this.allNotes;

    // Attacks
    if (context.match(/^attacks\.(.+)/)) {
      const key = RegExp.$1;
      for (let note of result) {
        note.notes = note.notes.filter((o) => {
          return o[1] === 'attacks' && o[2] === key;
        }).map((o) => {
          return o[0];
        });
      }

      return result;
    }

    // Skill
    if (context.match(/^skill\.(.+)/)) {
      let skillKey = RegExp.$1;
      if (skillKey.indexOf('.') !== -1) skillKey = skillKey.split('.')[2];
      const skill = this.getSkill(skillKey);
      const ability = skill.ability;
      for (let note of result) {
        note.notes = note.notes.filter((o) => {
          return (
            (o[1] === 'skill' && o[2] === context) ||
            (o[1] === 'skills' &&
              (o[2] === `${ability}Skills` || o[2] === 'skills'))
          );
        }).map((o) => {
          return o[0];
        });
      }

      if (skill.notes != null && skill.notes !== '') {
        result.push({ notes: [skill.notes], item: null });
      }

      return result;
    }

    // Saving throws
    if (context.match(/^savingThrow\.(.+)/)) {
      const saveKey = RegExp.$1;
      for (let note of result) {
        note.notes = note.notes.filter((o) => {
          return o[1] === 'savingThrows' &&
            (o[2] === saveKey || o[2] === 'allSavingThrows');
        }).map((o) => {
          return o[0];
        });
      }

      if (
        foundry.utils.getProperty(this.system, 'attributes.saveNotes') != null &&
        foundry.utils.getProperty(this.system, 'attributes.saveNotes') !== ''
      ) {
        result.push({ notes: [this.system.attributes.saveNotes], item: null });
      }

      return result;
    }

    // Ability checks
    if (context.match(/^abilityChecks\.(.+)/)) {
      const ablKey = RegExp.$1;
      for (let note of result) {
        note.notes = note.notes.filter((o) => {
          return o[1] === 'abilityChecks' &&
            (o[2] === `${ablKey}Checks` || o[2] === 'allChecks');
        }).map((o) => {
          return o[0];
        });
      }

      return result;
    }

    // Misc
    if (context.match(/^misc\.(.+)/)) {
      const miscKey = RegExp.$1;
      for (let note of result) {
        note.notes = note.notes.filter((o) => {
          return o[1] === 'misc' && o[2] === miscKey;
        }).map((o) => {
          return o[0];
        });
      }

      if (
        miscKey === 'cmb' &&
        foundry.utils.getProperty(this.system, 'attributes.cmbNotes') != null &&
        foundry.utils.getProperty(this.system, 'attributes.cmbNotes') !== ''
      ) {
        result.push({ notes: [this.system.attributes.cmbNotes], item: null });
      }

      return result;
    }

    return [];
  }

  async deleteEmbeddedEntity(documentName, data, options = {}) {
    game.D35E.logger.warn(
      'The Document#updateEmbeddedEntity method has been renamed to Document#updateEmbeddedDocuments. Support for the old method name was removed in 0.9.0',
    );
    data = data instanceof Array ? data : [data];
    options.massUpdate = true;
    return this.deleteEmbeddedDocuments(documentName, data, options);
  }

  /**
   * Prepare Item embedded-document create payloads (linked items, spell defaults,
   * compendium/world weight & weapon sizing). Mutates `createData` in place.
   */
  async _prepareItemEmbedCreateData(createData, options) {
    let linkedItems = [];
    for (let obj of createData) {
      if (obj?.system?.linkedItems && obj.system.linkedItems.length > 0) {
        const linkUUID = uuidv4();

        for (let data of obj.system.linkedItems) {
          let itemData = null;
          const pack = game.packs.find((p) => p.metadata.id === data.packId);
          const packItem = await pack.getDocument(data.itemId);
          if (packItem != null) {
            itemData = packItem.toObject(false);
            itemData.system.originPack = data.pack;
            itemData.system.originId = packItem.id;
          } else {
            return ui.notifications.warn(
              game.i18n.localize('D35E.LinkedItemMissing'));
          }
          if (itemData) {
            itemData.system.linkSourceId = linkUUID;
            itemData.system.linkSourceName = obj.name;
            itemData.system.linkImported = true;
            linkedItems.push(itemData);
          }
        }

        obj.system.linkId = linkUUID;
      }
    }

    createData.push(...linkedItems);

    for (let obj of createData) {
      try {
        delete obj.effects;
      } catch (e) {
        game.D35E.logger.warn(e);
      }
      // Minimal create payloads (e2e, API) may omit `system`; later logic assumes it exists.
      obj.system ??= {};
      // Don't auto-equip transferred items
      if (obj.id != null && ['weapon', 'equipment'].includes(obj.type)) {
        if (obj.document) obj.document.update({ 'system.equipped': false });
        else obj.system.equipped = false;
      }
      // Resize weight / weapon damage for compendium and world (Items directory) drops — SRD ×2 per size step.
      // Actor-to-actor drags use dataType "data" and preserve the source item's weight and weapon stats.
      // World setting autosizeWeapons disables weapon scaling only; equipment still scales.
      const autosizeWeapons = game.settings.get('warcraftrpg2e', 'autosizeWeapons');
      const applySizing =
        obj.type === 'equipment' ||
        (obj.type === 'weapon' && autosizeWeapons);
      if (
        applySizing &&
        ['weapon', 'equipment'].includes(obj.type) &&
        options.dataType !== 'data' &&
        !obj.system.constantWeight &&
        !options.keepWeight
      ) {
        let newSize = Object.keys(CONFIG.D35E.sizeChart).
          indexOf(foundry.utils.getProperty(this.system, 'traits.actualSize'));
        let newSizeKey = Object.keys(CONFIG.D35E.sizeChart)[newSize];
        let oldSize = Object.keys(CONFIG.D35E.sizeChart).indexOf('med');
        LogHelper.log('Resize Object', newSize, oldSize);
        let weightChange = Math.pow(2, newSize - oldSize);
        if (typeof obj.system.weight === 'number' && Number.isFinite(obj.system.weight)) {
          obj.system.weight = obj.system.weight * weightChange;
        }
        if (obj.type === 'weapon' && obj.system.weaponData) {
          obj.system.weaponData.size = newSizeKey;

          let weaponSize = Object.keys(CONFIG.D35E.sizeChart).
            indexOf(obj.system.weaponData.size) - 4;
          let dieCount = 0;
          let dieSides = 0;
          if (obj.system.weaponData.damageRoll) {
            // use regex to get the die count and die sides
            let regex = /(\d+)d(\d+)/;
            let match = obj.system.weaponData.damageRoll.match(regex);
            if (match) {
              dieCount = parseInt(match[1]);
              dieSides = parseInt(match[2]);
              let newDamageRoll = sizeDie(dieCount, dieSides, weaponSize, 1)
              obj.system.weaponData.damageRoll = newDamageRoll;
            }
          }
        }
      }
      if (['weapon', 'equipment', 'loot'].includes(obj.type)) {
        LogHelper.log('Create Object', obj);
        if (obj.system.identifiedName !== obj.name) {
          obj.system.identifiedName = obj.name;
        }
      }
      if (['spell'].includes(obj.type)) {
        if (options.ignoreSpellbookAndLevel) {
        } else if (options.domainSpells) {
          let spellbook = undefined;
          // We try to set spellbook to correct one
          for (let _spellbookKey of Object.keys(
            foundry.utils.getProperty(this.system, 'attributes.spells.spellbooks'))) {
            let _spellbook = this.system.attributes.spells.spellbooks[_spellbookKey];
            if (_spellbook.hasSpecialSlot && _spellbook.spellcastingType ===
              'divine') {
              spellbook = _spellbook;
              obj.system.spellbook = _spellbookKey;
            }
          }
          if (spellbook === undefined) {
            obj.system.spellbook = 'primary';
            spellbook = this.system.attributes.spells.spellbooks['primary'];
            ui.notifications.warn(
              `No Spellbook found for spell. Adding to Primary spellbook.`);
          }
          obj.system.isDomainSpell = true;
          obj.system.preparation ||= {};
          obj.system.preparation.prepared = false;
        } else {
          let spellbook = this.system.attributes.spells.spellbooks[obj.system.spellbook];
          let foundLevel = false;
          if (!obj.system.spellbook) {
            // We try to set spellbook to correct one
            for (let _spellbookKey of Object.keys(
              foundry.utils.getProperty(this.system, 'attributes.spells.spellbooks'))) {
              let _spellbook = this.system.attributes.spells.spellbooks[_spellbookKey];

              let _spellbookClass = this.system.classes[_spellbook.class] || {};
              let spellbookClass = this.system.classes[_spellbook.class]?.name ||
                'Missing';
              let foundByClass = false;
              if (_spellbookClass.hasSpellbook) {
                let spellId = obj.document
                  ? `${obj.document.pack}.${obj.document.id}`
                  : obj.name;
                if (_spellbookClass.spelllist.has(spellId)) {
                  spellbook = _spellbook;
                  foundByClass = true;
                  foundLevel = true;
                  obj.system.spellbook = _spellbookKey;
                  obj.system.level = _spellbookClass.spelllist.get(
                    spellId).level;
                }
              }
              if (!foundByClass && obj.system.learnedAt !== undefined) {
                for (const learnedAtObj of obj.system.learnedAt.class) {
                  if (learnedAtObj[0].toLowerCase() ===
                    spellbookClass.toLowerCase()) {
                    spellbook = _spellbook;
                    obj.system.spellbook = _spellbookKey;
                  }
                }
                const eligibility = evaluateWarcraftSpellEligibility(
                  obj.system,
                  _spellbookClass,
                  { parentClass: spellbookClass },
                );
                if (eligibility.eligible && eligibility.path) {
                  spellbook = _spellbook;
                  foundByClass = true;
                  obj.system.spellbook = _spellbookKey;
                  obj.system.level = eligibility.spellLevel;
                  obj.system.warcraftLearnedPath = eligibility.path;
                  foundLevel = true;
                }
              }
            }
            if (spellbook === undefined) {
              obj.system.spellbook = 'primary';
              spellbook = this.system.attributes.spells.spellbooks['primary'];
              ui.notifications.warn(
                `No Spellbook found for spell. Adding to Primary spellbook.`);
            } else {
            }
          }
          let spellbookClass = this.system.classes[spellbook.class]?.name ||
            'Missing';
          const warcraftEligibility = evaluateWarcraftSpellEligibility(
            obj.system,
            this.system.classes[spellbook.class] || {},
            {
              parentClass: spellbookClass,
              learnedPath: obj.system.warcraftLearnedPath,
            },
          );
          if (!warcraftEligibility.eligible) {
            ui.notifications.error(warcraftEligibility.reason);
            obj.system.warcraftEligibilityError = warcraftEligibility.reason;
          } else {
            obj.system.warcraftEligibilityError = "";
            if (warcraftEligibility.path) {
              obj.system.warcraftLearnedPath = warcraftEligibility.path;
              obj.system.level = warcraftEligibility.spellLevel;
              foundLevel = true;
            }
          }
          if (this.system.classes[spellbook.class]?.hasSpellbook) {
            let spellId = obj.system
              ? `${obj.system.originPack}.${obj.system.originId}`
              : obj.name;
            if (this.system.classes[spellbook.class].spelllist.has(spellId)) {
              foundLevel = true;
              obj.system.level = this.system.classes[spellbook.class].spelllist.get(
                spellId).level;
            }
          }
          LogHelper.log(
            'Spellpoints',
            game.settings.get('warcraftrpg2e', 'spellpointCostCustomFormula'),
            game.settings.get('warcraftrpg2e', 'spellpointCostCustomFormula') &&
            game.settings.get('warcraftrpg2e', 'spellpointCostCustomFormula') !== '',
          );
          if (obj.system.learnedAt !== undefined && !foundLevel) {
            obj.system.learnedAt.class.forEach((learnedAtObj) => {
              if (learnedAtObj[0].toLowerCase() ===
                spellbookClass.toLowerCase()) {
                {
                  obj.system.level = learnedAtObj[1];

                  if (!game.settings.get('warcraftrpg2e', 'noAutoSpellpointsCost')) {
                    if (
                      game.settings.get('warcraftrpg2e',
                        'spellpointCostCustomFormula') &&
                      game.settings.get('warcraftrpg2e',
                        'spellpointCostCustomFormula') !== ''
                    )
                      obj.system.powerPointsCost = new Roll35e(
                        game.settings.get('warcraftrpg2e',
                          'spellpointCostCustomFormula'),
                        {
                          level: parseInt(learnedAtObj[1]),
                        },
                      ).evaluateSync().total;
                    else obj.system.powerPointsCost = Math.max(
                      parseInt(learnedAtObj[1]) * 2 - 1, 0);
                  }
                }
                foundLevel = true;
              }
            });
          }
          if (!foundLevel) {
            if (!game.settings.get('warcraftrpg2e', 'noAutoSpellpointsCost')) {
              if (
                game.settings.get('warcraftrpg2e', 'spellpointCostCustomFormula') &&
                game.settings.get('warcraftrpg2e', 'spellpointCostCustomFormula') !==
                ''
              )
                obj.system.powerPointsCost = new Roll35e(
                  game.settings.get('warcraftrpg2e', 'spellpointCostCustomFormula'), {
                  level: parseInt(obj.system.level),
                }).evaluateSync().total;
              else obj.system.powerPointsCost = Math.max(
                parseInt(obj.system.level) * 2 - 1, 0);
            }
            ui.notifications.warn(
              `Spell added despite not being in a spell list for class.`);
          }
        }
      }
      if (['feat'].includes(obj.type)) {
        if (!obj.system.addedLevel || obj.system.addedLevel === 0) {
          obj.system.addedLevel = this.system.details.level.value;
        }
      }
      if (obj.system?.creationChanges && obj.system.creationChanges.length) {
        for (let creationChange of obj.system.creationChanges) {
          if (creationChange) {
            let creationChangeValue = null;
            // If the creation change value starts and ends with [], we assume its a set of delimeted string
            if (creationChange[1].startsWith('[') &&
              creationChange[1].endsWith(']')) {
              // split the string by the delimiter ("|")
              let possibleValues = creationChange[1].substring(1, creationChange[1].length - 1).split('|');
              // randomly select one of the values
              creationChangeValue = possibleValues[Math.floor(Math.random() * possibleValues.length)];
            } else if (creationChange[1].startsWith('@UUID[') && creationChange[1].endsWith(']')) {
              let table = fromUuidSync(creationChange[1].substring(6, creationChange[1].length - 1));
              // check if the table has only text results
              if (table.results.values().every((r) => r.type === 0)) {
                let roll = await table.roll()
                let result = roll.results[0].text;
                creationChangeValue = result;
              } else {
                ui.notifications.error(
                  game.i18n.localize('D35E.CreationChangeTableHasNonTextResults'));
              }
            }
            else {
              creationChangeValue = (await new Roll35e(creationChange[1], {}).roll()).total;
            }
            if (creationChangeValue !== null) {
              if (creationChange[0] === "name") {
                foundry.utils.setProperty(obj, "name", creationChangeValue)
                foundry.utils.setProperty(obj.system, "identifiedName", creationChangeValue)
              } else {
                foundry.utils.setProperty(obj.system, creationChange[0], creationChangeValue);
                if (creationChange[0] === "identifiedName") {
                  foundry.utils.setProperty(obj, "name", creationChangeValue)
                }
              }
            } else {
              ui.notifications.error(
                game.i18n.localize('D35E.CreationChangeFailed'));
            }
          }
        }
        foundry.utils.setProperty(obj.system, 'creationChanges', []);
      }
    }
  }

  /** @deprecated Prefer createEmbeddedDocuments — this delegates to it. */
  async createEmbeddedEntity(embeddedName, createData, options = {}) {
    if (!(createData instanceof Array)) {
      createData = [createData];
    }
    return this.createEmbeddedDocuments(embeddedName, createData, options);
  }

  /**
   * @returns {number} The total amount of currency this actor has, in gold pieces
   */
  mergeCurrency() {
    const carried = foundry.utils.getProperty(this.system, 'currency');
    const alt = foundry.utils.getProperty(this.system, 'altCurrency');
    const customCurrency = foundry.utils.getProperty(this.system, 'customCurrency');
    let baseTotal =
      (carried ? carried.pp * 10 + carried.gp + carried.sp / 10 + carried.cp /
        100 : 0) +
      (alt ? alt.pp * 10 + alt.gp + alt.sp / 10 + alt.cp / 100 : 0);
    let currencyConfig = game.settings.get('warcraftrpg2e', 'currencyConfig');
    for (let currency of currencyConfig.currency) {
      if (customCurrency) baseTotal += (customCurrency[currency[0]] || 0) *
        (currency[3] || 0);
    }
    return baseTotal;
  }

  /**
   * Import a new owned Item from a compendium collection
   * The imported Item is then added to the Actor as an owned item.
   *
   * @param collection {String}     The name of the pack from which to import
   * @param entryId {String}        The ID of the compendium entry to import
   */
  importItemFromCollection(collection, entryId) {
    const pack = game.packs.find((p) => p.metadata.id === collection);
    if (!pack || pack.documentName !== 'Item') return;

    return pack.getDocument(entryId).then((ent) => {
      //LogHelper.log(`${vtt} | Importing Item ${ent.name} from ${collection}`);

      let data = ent.toObject();
      if (this.sheet != null && this.sheet.rendered) {
        data = foundry.utils.mergeObject(data, this.sheet.getDropData(data));
      }
      delete data._id;
      return this.createItemWithDefaults(data);
    });
  }

  /**
   * Import a new owned Item from a compendium collection
   * The imported Item is then added to the Actor as an owned item.
   *
   * @param collection {String}     The name of the pack from which to import
   * @param name {String}        The name of the compendium entry to import
   */
  async importItemFromCollectionByName(collection, name, unique = false) {
    const pack = game.packs.find((p) => p.metadata.id === collection);
    if (!pack) {
      ui.notifications.error(
        game.i18n.localize('D35E.NoPackFound') + ' ' + collection);
      return;
    }
    if (pack.documentName !== 'Item') return;
    await pack.getIndex();
    const entry = pack.index.find((e) => getOriginalNameIfExists(e) === name);
    if (!entry) {
      ui.notifications.error(
        game.i18n.localize('D35E.NoItemFound') + ' ' + collection);
      return;
    }
    const entryId = entry.id ?? entry._id;
    if (!entryId) {
      ui.notifications.error(
        game.i18n.localize('D35E.NoItemFound') + ' ' + collection);
      return;
    }
    return pack.getDocument(entryId).then((ent) => {
      if (!ent) {
        ui.notifications.error(
          game.i18n.localize('D35E.NoItemFound') + ' ' + collection);
        return;
      }
      if (unique) {
        if (this.items.filter(
          (o) => getOriginalNameIfExists(o) === name && o.type ===
            ent.type).length > 0)
          return undefined;
      }
      //LogHelper.log(`${vtt} | Importing Item ${ent.name} from ${collection}`);

      let data = ent.toObject();
      delete data._id;
      return data;
    });
  }

  getRollData(data = null, force = false) {
    if (data != null) {
      const result = foundry.utils.mergeObject(
        data,
        {
          size: Object.keys(CONFIG.D35E.sizeChart).
            indexOf(foundry.utils.getProperty(data, 'traits.actualSize')) - 4,
          uuid: this.uuid,
        },
        { inplace: false },
      );
      return result;
    } else {
      if (!this._cachedRollData || force) {
        data = this.system;
        const result = foundry.utils.mergeObject(
          data,
          {
            size: Object.keys(CONFIG.D35E.sizeChart).
              indexOf(foundry.utils.getProperty(data, 'traits.actualSize')) - 4,
            uuid: this.uuid,
          },
          { inplace: false },
        );
        this._cachedRollData = result;
      }
      return this._cachedRollData;
    }
  }

  async autoApplyActionsOnSelf(actions, originatingAttackId = null) {
    LogHelper.log('AUTO APPLY ACTION ON SELF', this.name);
    await this.applyActionOnSelf(actions, this, null, 'self', originatingAttackId);
  }

  static applyAction(actions, actor) {
    LogHelper.log('APPLY ACTION ON ACTOR');
    const promises = [];
    let tokensList;
    if (game.user.targets.size > 0) tokensList = game.user.targets;
    else tokensList = canvas.tokens.controlled;
    for (let t of tokensList) {
      promises.push(t.actor.applyActionOnSelf(actions, actor, null, 'target'));
    }
    return Promise.all(promises);
  }

  async applySingleAction(
    action,
    itemUpdates,
    itemsToCreate,
    actorUpdates,
    actionRollData,
    sourceActor,
    itemsToDelete,
  ) {
    function cleanParam(parameter) {
      return parameter.replace(/"/gi, '');
    }

    function normalizeItemFieldPath(path) {
      return path.startsWith('data.') ? `system.${path.slice(5)}` : path;
    }

    function isActionRollable(_action) {
      if (_action.indexOf('://') !== -1) return false;
      if (_action.startsWith('"') && _action.endsWith('"')) return false;
      return (
        /^(.*?[0-9]d[0-9]+.*?)$/.test(_action) ||
        _action.indexOf('(') !== -1 ||
        _action.indexOf('+') !== -1 ||
        _action.indexOf('*') !== -1 ||
        _action.indexOf('/') !== -1 ||
        _action.indexOf(',') !== -1 ||
        _action.indexOf('@') !== -1
      );
    }

    LogHelper.log('ACTION', action);
    switch (action.action) {
      case 'TurnUndead':
        await this.rollTurnUndead(cleanParam(action.parameters[0]));
        break;
      case 'Create':
      case 'Give':
        if (action.parameters.length === 1) {
          // Create from default compendiums
        } else if (action.parameters.length === 3) {
          if (action.parameters[1] === 'from') {
            itemsToCreate.push(
              await this.importItemFromCollectionByName(
                cleanParam(action.parameters[2]),
                cleanParam(action.parameters[0]),
              ),
            );
          } else {
            ui.notifications.error(
              game.i18n.format('D35E.ErrorActionFormula', {
                action: action.originalAction,
                error: game.i18n.localize(
                  'D35E.ErrorActionNotTargetDoesNotExist'),
              }),
            );
          }
        } else if (action.parameters.length === 4) {
          if (action.parameters[2] === 'from' &&
            (action.parameters[0] === 'unique' || action.parameters[0] ===
              'u')) {
            let itemToCreate = await this.importItemFromCollectionByName(
              cleanParam(action.parameters[3]),
              cleanParam(action.parameters[1]),
              true,
            );
            if (itemToCreate) itemsToCreate.push(itemToCreate);
          } else {
            ui.notifications.error(
              game.i18n.format('D35E.ErrorActionFormula', {
                action: action.originalAction,
                error: game.i18n.localize('D35E.ErrorActionWrongSyntax'),
              }),
            );
          }
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'Activate':
        if (action.parameters.length === 1) {
          let name = cleanParam(action.parameters[0]);
          let items = this.items.filter(
            (o) => getOriginalNameIfExists(o) === name);
          if (items.length > 0) {
            const item = items[0];
            if (item.type === 'buff' || item.type === 'aura') {
              await item.update({ 'system.active': true });
            } else {
              await item.use({ skipDialog: true });
            }
          }
        } else if (action.parameters.length === 2) {
          let name = cleanParam(action.parameters[1]);
          let type = cleanParam(action.parameters[0]);
          let items = this.items.filter(
            (o) => o.name === name && o.type === type);
          if (items.length > 0) {
            const item = items[0];
            if (item.type === 'buff' || item.type === 'aura') {
              await item.update({ 'system.active': true });
            } else {
              await item.use({ skipDialog: true });
            }
          }
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'Deactivate':
        if (action.parameters.length === 1) {
          let name = cleanParam(action.parameters[0]);
          let items = this.items.filter(
            (o) => getOriginalNameIfExists(o) === name);
          if (items.length > 0) {
            const item = items[0];
            if (item.type === 'buff' || item.type === 'aura') {
              await item.update({ 'system.active': false });
            }
          }
        } else if (action.parameters.length === 2) {
          let name = cleanParam(action.parameters[1]);
          let type = cleanParam(action.parameters[0]);
          let items = this.items.filter(
            (o) => getOriginalNameIfExists(o) === name && o.type === type);
          if (items.length > 0) {
            const item = items[0];
            if (item.type === 'buff' || item.type === 'aura') {
              await item.update({ 'system.active': false });
            }
          }
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'Set':
        // Set "Sneak Attack" field data.level to (@class.rogue.level) on self
        if (action.parameters.length === 5 && action.parameters[1] ===
          'field' && action.parameters[3] === 'to') {
          let name = cleanParam(action.parameters[0]);

          let items = this.items.filter(
            (o) => getOriginalNameIfExists(o) === name);
          if (items.length > 0) {
            const item = items[0];
            let updateObject = {};

            updateObject['id'] = item.id;
            const updatePath = normalizeItemFieldPath(action.parameters[2]);
            if (action.parameters[4] === 'true' || action.parameters[4] ===
              'false') {
              updateObject[updatePath] = action.parameters[4] ===
                'true';
            } else {
              if (isActionRollable(action.parameters[4])) {
                updateObject[updatePath] = (await new Roll35e(
                  action.parameters[4], actionRollData).evaluate()).total;
              } else {
                // Remove starting and ending " from the param
                if (action.parameters[4].startsWith('"') &&
                  action.parameters[4].endsWith('"')) {
                  action.parameters[4] = action.parameters[4].substring(1,
                    action.parameters[4].length - 1);
                }
                updateObject[updatePath] = action.parameters[4];
              }
            }

            itemUpdates.push(updateObject);
          }
        }
        // Set attack * field data.melded to true on self
        else if (action.parameters.length === 6 && action.parameters[2] ===
          'field' &&
          (action.parameters[4] === 'to' || action.parameters[4] ===
            'exact')) {
          let type = cleanParam(action.parameters[0]);
          let subtype = null;
          if (type.indexOf(':') !== -1) {
            subtype = type.split(':')[1];
            type = type.split(':')[0];
          }
          let name = cleanParam(action.parameters[1]);

          let items = this.items.filter(
            (o) => (getOriginalNameIfExists(o) === name || name === '*') &&
              o.type === type,
          );
          if (items.length > 0) {
            if (name === '*') {
              for (let item of items) {
                if (type === 'attack' && subtype !== null) {
                  if (item.system.attackType !== subtype) continue;
                }
                let updateObject = {};
                updateObject['id'] = item.id;
                const updatePath = normalizeItemFieldPath(action.parameters[3]);
                if (action.parameters[5] === 'true' || action.parameters[5] ===
                  'false') {
                  updateObject[updatePath] = action.parameters[5] ===
                    'true';
                } else {
                  if (isActionRollable(action.parameters[5]) &&
                    action.parameters[4] !== 'exact') {
                    updateObject[updatePath] = (await new Roll35e(
                      action.parameters[5], actionRollData).evaluate()).total;
                  } else {
                    // Remove starting and ending " from the param
                    if (action.parameters[5].startsWith('"') &&
                      action.parameters[5].endsWith('"')) {
                      action.parameters[5] = action.parameters[5].substring(1,
                        action.parameters[5].length - 1);
                    }
                    updateObject[updatePath] = action.parameters[5];
                  }
                }
                itemUpdates.push(updateObject);
              }
            } else {
              const item = items[0];
              let updateObject = {};
              updateObject['id'] = item.id;
              const updatePath = normalizeItemFieldPath(action.parameters[3]);
              if (action.parameters[5] === 'true' || action.parameters[5] ===
                'false') {
                updateObject[updatePath] = action.parameters[5] ===
                  'true';
              } else {
                if (isActionRollable(action.parameters[5]) &&
                  action.parameters[4] !== 'exact') {
                  updateObject[updatePath] = (await new Roll35e(
                    action.parameters[5], actionRollData).evaluate()).total;
                } else {
                  // Remove starting and ending " from the param
                  if (action.parameters[5].startsWith('"') &&
                    action.parameters[5].endsWith('"')) {
                    action.parameters[5] = action.parameters[5].substring(1,
                      action.parameters[5].length - 1);
                  }
                  updateObject[updatePath] = action.parameters[5];
                }
              }
              itemUpdates.push(updateObject);
            }
          }
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'Condition':
        // Condition set *name* to *value*
        if (action.parameters.length === 4 && action.parameters[0] === 'set' &&
          action.parameters[2] === 'to') {
          let name = cleanParam(action.parameters[1]);
          let value = cleanParam(action.parameters[3]);
          actorUpdates[`system.attributes.conditions.${name}`] = value ===
            'true';
        }
        // Condition toggle *name*
        else if (action.parameters.length === 2 && action.parameters[0] ===
          'toggle') {
          let name = cleanParam(action.parameters[1]);
          actorUpdates[`system.attributes.conditions.${name}`] = !foundry.utils.getProperty(
            this.system,
            `attributes.conditions.${name}`,
          );
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'Trait':
        // Condition set *name* to *value*
        if (action.parameters.length === 5 && action.parameters[0] === 'set' &&
          action.parameters[3] === 'to') {
          let traitGroup = cleanParam(action.parameters[1]);
          let name = cleanParam(action.parameters[2]);
          let value = cleanParam(action.parameters[4]);
          let currentTraits = foundry.utils.duplicate(
            actionRollData.self.traits[traitGroup].value);
          if (value === 'true') {
            if (currentTraits.indexOf(name) === -1) {
              currentTraits.push(name);
            }
          } else {
            var index = currentTraits.indexOf(name);
            if (index !== -1) {
              currentTraits.splice(index, 1);
            }
          }
          actorUpdates[`system.traits.${traitGroup}.value`] = currentTraits;
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;

      case 'Update':
        // Update set *field* to *value*
        if (action.parameters.length === 4 && action.parameters[0] === 'set' &&
          action.parameters[2] === 'to') {
          let field = cleanParam(action.parameters[1]);
          let value = cleanParam(action.parameters[3]);

          if (isActionRollable(value)) {
            actorUpdates[`${field}`] = (await new Roll35e(cleanParam(value),
              actionRollData).evaluate()).total;
          } else {
            actorUpdates[`${field}`] = isNaN(value) ? value : Number(value);
          }
        } else if (action.parameters.length === 4 && action.parameters[0] ===
          'add' && action.parameters[2] === 'to') {
          let field = cleanParam(action.parameters[1]);
          let value = cleanParam(action.parameters[3]);
          const rollDataField = field.startsWith('data.') ? `self.${field.slice(5)}` : field.replace('system.', 'self.');

          if (isActionRollable(value)) {
            actorUpdates[`${field}`] =
              parseInt(foundry.utils.getProperty(actionRollData, rollDataField) || 0) +
              (await new Roll35e(cleanParam(value), actionRollData).evaluate()).total;
          } else {
            actorUpdates[`${field}`] =
              parseInt(foundry.utils.getProperty(actionRollData, rollDataField) || 0) + parseInt(value);
          }
        } else if (
          action.parameters.length === 4 &&
          action.parameters[0] === 'subtract' &&
          action.parameters[2] === 'to'
        ) {
          let field = cleanParam(action.parameters[1]);
          let value = cleanParam(action.parameters[3]);
          const rollDataField = field.startsWith('data.') ? `self.${field.slice(5)}` : field.replace('system.', 'self.');

          if (isActionRollable(value)) {
            actorUpdates[`${field}`] =
              (foundry.utils.getProperty(actionRollData, rollDataField) || 0) -
              (await new Roll35e(cleanParam(value), actionRollData).evaluate()).total;
          } else {
            actorUpdates[`${field}`] =
              (foundry.utils.getProperty(actionRollData, rollDataField) || 0) - value;
          }
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'Damage':
        // Rolls arbitrary attack
        //LogHelper.log(action)
        if (action.parameters.length === 2) {
          let damage = await new Roll35e(cleanParam(action.parameters[1]),
            actionRollData).roll();
          damage.damageTypeUid = ActorDamageHelper.mapDamageType(
            action.parameters[0]);
          let damageType = cleanParam(action.parameters[0]);
          let damageName = ActorDamageHelper.nameByType(
            cleanParam(action.parameters[0]));
          let damageIcon = ActorDamageHelper.getDamageIcon(
            cleanParam(action.parameters[0]));
          let name = action.name;
          let chatTemplateData = {
            name: sourceActor.name,
            [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
            rollMode: 'public',
          };
          const _tw7 = document.createElement('div');
          _tw7.innerHTML = await damage.getTooltip();
          const _te7 = _tw7.firstElementChild;
          let tooltip;
          if (_te7) {
            _te7.insertAdjacentHTML('afterbegin', `<div class="dice-formula">${damage.formula}</div>`);
            tooltip = _te7.outerHTML;
          } else {
            tooltip = '<div class="dice-tooltip dmg-tooltip"></div>';
          }
          const templateData = foundry.utils.mergeObject(
            chatTemplateData,
            {
              flavor: `<img src="systems/warcraftrpg2e/icons/damage-type/${damageIcon}.svg" title="${damageName
                }" class="dmg-type-icon" /> ${damageName}`,
              total: damage.total,
              action: `applyDamage`,
              actor: sourceActor,
              attacker: sourceActor.id,
              json: JSON.stringify(
                [{ roll: damage, damageTypeUid: damage.damageTypeUid }]),
              tooltip: tooltip,
            },
            { inplace: false },
          );
          // Create message
          await createCustomChatMessage(
            'systems/warcraftrpg2e/templates/chat/simple-attack-roll.html',
            templateData,
            {},
            damage,
          );
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      // These actions directly roll and apply damage to targets
      case 'ApplyDamage':
      case 'SelfDamage':
        if (action.parameters.length === 1) {
          // Check if there is [] in the damage formula
          if (action.parameters[0].indexOf('[') !== -1) {
            // We got the damage in format 1d6+2[fire]+2d8[acid], so we need to parse it and build damage array
            let damageArray = [];
            let damageString = action.parameters[0];
            let damageRegex = /(\d+d\d+)(\+\d+)?(\[(\w+)\])?/g;
            let match = damageRegex.exec(damageString);
            while (match != null) {
              let damage = {
                roll: match[1],
                damageTypeUid: ActorDamageHelper.mapDamageType(match[4]),
              };
              if (match[2]) {
                damage.roll += match[2];
              }
              damageArray.push(damage);
              match = damageRegex.exec(damageString);
            }
            ActorDamageHelper.applyDamage(
              null,
              ActorPF.SPELL_AUTO_HIT,
              null,
              null,
              null,
              null,
              null,
              damageArray,
              null,
              null,
              null,
              null,
              false,
              false,
              this,
              this.id,
            );
          } else {
            let damage = (await new Roll35e(cleanParam(action.parameters[0]),
              actionRollData).evaluate()).total;
            ActorDamageHelper.applyDamage(
              null,
              null,
              null,
              null,
              null,
              null,
              null,
              damage,
              null,
              null,
              null,
              null,
              false,
              true,
              this,
            );
          }
        } else if (action.parameters.length === 2) {
          let damageRoll = await new Roll35e(cleanParam(action.parameters[0]),
            actionRollData).roll();
          let damage = [
            {
              damageTypeUid: ActorDamageHelper.mapDamageType(
                action.parameters[1]), roll: damageRoll,
            }];

          ActorDamageHelper.applyDamage(
            null,
            ActorPF.SPELL_AUTO_HIT,
            null,
            null,
            null,
            null,
            null,
            damage,
            null,
            null,
            null,
            null,
            false,
            false,
            this,
            this.id,
          );
        } else ui.notifications.error(
          game.i18n.format('D35E.ErrorActionFormula'));
        break;

      case 'Grapple':
        // Rolls arbitrary attack
        if (action.parameters.length === 1) {
          this.rollGrapple(cleanParam(action.parameters[0]));
        } else this.rollGrapple();
        break;
      case 'AbilityDamage':
        // Rolls arbitrary attack
        //LogHelper.log(action)
        if (action.parameters.length === 2) {
          if (!canApplyWarcraftAbilityDamage({
            creatureType: this.system.attributes?.creatureType,
            deathRule: resolveDeathRule(
              this.system.attributes?.deathRule,
              this.race?.system?.deathRule,
              this.system.attributes?.creatureType,
            ),
            ability: action.parameters[0],
          })) break;
          let damage = await new Roll35e(cleanParam(action.parameters[1]),
            actionRollData).roll();
          let damageTotal = damage.total;
          let abilityField = `system.abilities.${action.parameters[0]}.damage`,
            abilityDamage = actionRollData.self.abilities[action.parameters[0]].damage ||
              0;
          actorUpdates[abilityField] = Math.max(0, abilityDamage + damageTotal);

          let name = `Ability Damage ${CONFIG.D35E.abilities[action.parameters[0]]}`;
          let chatTemplateData = {
            name: sourceActor.name,
            img: sourceActor.img,
            targetName: this.name,
            targetImg: this.img,
            [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
            rollMode: 'public',
          };
          const _twD = document.createElement('div');
          _twD.innerHTML = await damage.getTooltip();
          const _teD = _twD.firstElementChild;
          if (_teD) _teD.insertAdjacentHTML('afterbegin', `<div class="dice-formula">${damage.formula}</div>`);
          const templateData = foundry.utils.mergeObject(
            chatTemplateData,
            {
              flavor: name,
              total: damage.total,
              tooltip: _teD ? _teD.outerHTML : '',
            },
            { inplace: false },
          );

          await createCustomChatMessage(
            'systems/warcraftrpg2e/templates/chat/special-actions-applied.html',
            templateData,
            {},
            damage,
          );
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'AbilityDrain':
        // Rolls arbitrary attack
        //LogHelper.log(action)
        if (action.parameters.length === 2) {
          if (!canApplyWarcraftAbilityDrain({
            creatureType: this.system.attributes?.creatureType,
            deathRule: resolveDeathRule(
              this.system.attributes?.deathRule,
              this.race?.system?.deathRule,
              this.system.attributes?.creatureType,
            ),
          })) break;
          let damage = await new Roll35e(cleanParam(action.parameters[1]),
            actionRollData).roll();
          let damageTotal = damage.total;
          let abilityField = `system.abilities.${action.parameters[0]}.drain`,
            abilityDamage = actionRollData.self.abilities[action.parameters[0]].drain ||
              0;
          actorUpdates[abilityField] = Math.max(0, abilityDamage + damageTotal);

          let name = `Ability Drain ${CONFIG.D35E.abilities[action.parameters[0]]}`;
          let chatTemplateData = {
            name: sourceActor.name,
            img: sourceActor.img,
            targetName: this.name,
            targetImg: this.img,
            [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
            rollMode: 'public',
          };
          const _twD = document.createElement('div');
          _twD.innerHTML = await damage.getTooltip();
          const _teD = _twD.firstElementChild;
          if (_teD) _teD.insertAdjacentHTML('afterbegin', `<div class="dice-formula">${damage.formula}</div>`);
          const templateData = foundry.utils.mergeObject(
            chatTemplateData,
            {
              flavor: name,
              total: damage.total,
              tooltip: _teD ? _teD.outerHTML : '',
            },
            { inplace: false },
          );

          await createCustomChatMessage(
            'systems/warcraftrpg2e/templates/chat/special-actions-applied.html',
            templateData,
            {},
            damage,
          );
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'CureAbilityDamage':
        if (action.parameters.length === 2) {
          let heal = await new Roll35e(cleanParam(action.parameters[1]),
            actionRollData).roll();
          let abilityField = `system.abilities.${action.parameters[0]}.damage`,
            currentDamage = actionRollData.self.abilities[action.parameters[0]].damage || 0;
          actorUpdates[abilityField] = Math.max(0, currentDamage - heal.total);

          let name = `Cure Ability Damage ${CONFIG.D35E.abilities[action.parameters[0]]}`;
          let chatTemplateData = {
            name: sourceActor.name,
            img: sourceActor.img,
            targetName: this.name,
            targetImg: this.img,
            [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
            rollMode: 'public',
          };
          const _twCA = document.createElement('div');
          _twCA.innerHTML = await heal.getTooltip();
          const _teCA = _twCA.firstElementChild;
          if (_teCA) _teCA.insertAdjacentHTML('afterbegin', `<div class="dice-formula">${heal.formula}</div>`);
          const templateDataCA = foundry.utils.mergeObject(
            chatTemplateData,
            {
              flavor: name,
              total: heal.total,
              tooltip: _teCA ? _teCA.outerHTML : '',
            },
            { inplace: false },
          );

          await createCustomChatMessage(
            'systems/warcraftrpg2e/templates/chat/special-actions-applied.html',
            templateDataCA,
            {},
            heal,
          );
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'CureAbilityDrain':
        if (action.parameters.length === 2) {
          let heal = await new Roll35e(cleanParam(action.parameters[1]),
            actionRollData).roll();
          let abilityField = `system.abilities.${action.parameters[0]}.drain`,
            currentDrain = actionRollData.self.abilities[action.parameters[0]].drain || 0;
          actorUpdates[abilityField] = Math.max(0, currentDrain - heal.total);

          let name = `Cure Ability Drain ${CONFIG.D35E.abilities[action.parameters[0]]}`;
          let chatTemplateData = {
            name: sourceActor.name,
            img: sourceActor.img,
            targetName: this.name,
            targetImg: this.img,
            [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
            rollMode: 'public',
          };
          const _twCD = document.createElement('div');
          _twCD.innerHTML = await heal.getTooltip();
          const _teCD = _twCD.firstElementChild;
          if (_teCD) _teCD.insertAdjacentHTML('afterbegin', `<div class="dice-formula">${heal.formula}</div>`);
          const templateDataCD = foundry.utils.mergeObject(
            chatTemplateData,
            {
              flavor: name,
              total: heal.total,
              tooltip: _teCD ? _teCD.outerHTML : '',
            },
            { inplace: false },
          );

          await createCustomChatMessage(
            'systems/warcraftrpg2e/templates/chat/special-actions-applied.html',
            templateDataCD,
            {},
            heal,
          );
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'Regenerate':
        // Rolls arbitrary attack
        //LogHelper.log(action)
        if (action.parameters.length === 1) {
          let damage = (await new Roll35e(cleanParam(action.parameters[0]),
            actionRollData).evaluate()).total;
          ActorDamageHelper.applyRegeneration(damage, this);
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'Clear':
        if (action.parameters.length === 1) {
          // Clear all items of type
        }
        if (action.parameters.length === 2) {
          // Clear all items of type and subtype
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'Use':
        if (action.parameters.length === 1) {
          let item = this.getItemByTag(action.parameters[0]);
          if (item) item.use = { ev: {}, skipDialog: true };
        }
        if (action.parameters.length === 2) {
          // Use n items/action
        } else ui.notifications.error(
          game.i18n.format('D35E.ErrorActionFormula'));
        break;

      case 'Remove':
        if (action.parameters.length === 2) {
          if (action.parameters[1].indexOf('"') !== -1) {
            let name = cleanParam(action.parameters[1]);
            let type = cleanParam(action.parameters[0]);
            this.items.filter(
              (o) => (getOriginalNameIfExists(o) === name || name === '*') &&
                o.type === type).forEach((i) => itemsToDelete.push(i.id));
          } else {
            let item = null;
            item = this.getItemByTagAndType(action.parameters[1],
              action.parameters[0]);
            if (item !== null) itemsToDelete.push(item.id);
            else
              ui.notifications.error(
                game.i18n.format('D35E.ErrorActionFormula', {
                  action: action.originalAction,
                  error: game.i18n.localize('D35E.ErrorItemNotFound'),
                }),
              );
          }
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'Roll':
        if (action.parameters.length === 2) {
          return DicePF.d20Roll({
            parts: action.parameters[1],
            data: this.getRollData(),
            title: cleanParam(action.parameters[0]),
            speaker: ChatMessage.getSpeaker({ actor: this }),
            chatTemplate: 'systems/warcraftrpg2e/templates/chat/roll-ext.html',
            chatTemplateData: { hasProperties: false },
          });
        } else if (action.parameters.length === 1) {
          return DicePF.d20Roll({
            parts: action.parameters[0],
            data: this.getRollData(),
            title: 'Roll',
            speaker: ChatMessage.getSpeaker({ actor: this }),
            chatTemplate: 'systems/warcraftrpg2e/templates/chat/roll-ext.html',
            chatTemplateData: { hasProperties: false },
          });
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'RunMacro':
        // Executes a macro defined on MacroDirectory
        //LogHelper.log(action)
        if (action.parameters.length === 1) {
          let macroToRun = MacroDirectory.collection.find(
            (x) => x.name === cleanParam(action.parameters[0]));
          if (!macroToRun) {
            ui.notifications.error(
              game.i18n.format('D35E.ErrorActionFormula', {
                action: action.originalAction,
                error: game.i18n.localize(
                  'D35E.ErrorActionNotTargetDoesNotExist'),
              }),
            );
            return;
          }
          await macroToRun.execute({ actionRollData });
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'RollTable':
        // Executes a macro defined on MacroDirectory
        //LogHelper.log(action)
        if (action.parameters.length === 1) {
          let rollTable = RollTableDirectory.collection.find(
            (x) => x.name === cleanParam(action.parameters[0]));
          if (!rollTable) {
            ui.notifications.error(
              game.i18n.format('D35E.ErrorActionFormula', {
                action: action.originalAction,
                error: game.i18n.localize(
                  'D35E.ErrorActionNotTargetDoesNotExist'),
              }),
            );
            return;
          }
          await rollTable.draw();
        }
        if (action.parameters.length === 2) {
          let rollTableId = await game.packs.get(action.parameters[0]).
            index.
            find((x) => x.name === cleanParam(action.parameters[1]));
          if (!rollTableId) {
            ui.notifications.error(
              game.i18n.format('D35E.ErrorActionFormula', {
                action: action.originalAction,
                error: game.i18n.localize(
                  'D35E.ErrorActionNotTargetDoesNotExist'),
              }),
            );
            return;
          }
          let rollTable = await game.packs.get(action.parameters[0]).
            getDocument(rollTableId.id);
          if (!rollTable) {
            ui.notifications.error(
              game.i18n.format('D35E.ErrorActionFormula', {
                action: action.originalAction,
                error: game.i18n.localize(
                  'D35E.ErrorActionNotTargetDoesNotExist'),
              }),
            );
            return;
          }
          await rollTable.draw();
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      case 'Eval':
        await this.executeEvalOnSelf(action);
        break;
      case 'Message':
        // Rolls arbitrary attack
        //LogHelper.log(action)
        if (action.parameters.length > 1) {

          let messageType = action.parameters.shift();
          //try to check if the rest of the parameters are not a JSON object
          let message = action.parameters.join(' ');
          let messageData = null;
          try {
            messageData = JSON.parse(message);
          } catch (e) {
            messageData = {
              text: message,
            };
          }
          let chatTemplateData = {
            name: this.name,
            actor: this,
            [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
            rollMode: cleanParam(messageType),
            text: messageData.text,
            secretText: messageData.secretText || null,
          };
          let chatData = {
            rollMode: cleanParam(messageType),
          };
          // Create message
          await createCustomChatMessage(
            'systems/warcraftrpg2e/templates/chat/gm-message.html', chatTemplateData,
            chatData, {});
        } else
          ui.notifications.error(
            game.i18n.format('D35E.ErrorActionFormula', {
              action: action.originalAction,
              error: game.i18n.localize('D35E.ErrorActionNotEnoughParams'),
            }),
          );
        break;
      default:
        break;
    }
  }

  async applyActionOnSelf(actions, actor, buff = null, target = 'self', originatingAttackId = null) {
    if (!actions) return;
    if (!this.testUserPermission(game.user, 'OWNER'))
      return ui.notifications.warn(
        game.i18n.localize('D35E.ErrorNoActorPermission'));

    let itemCreationActions = [];
    let itemRemoveActions = [];
    let itemUpdateActions = [];
    let actorUpdateActions = [];
    let otherActions = [];

    let actionRollData = actor.getRollData(); //This is roll data of actor that *rolled* the roll
    if (buff) {
      actionRollData.buff = buff; //This is roll data of optional buff item
      actionRollData.self = foundry.utils.duplicate(actionRollData);
    } else {
      if (actor === this) {
        actionRollData.self = foundry.utils.duplicate(actionRollData);
      } else {
        actionRollData.self = this.getRollData(); //This is roll data of actor that *clicked* the roll
      }
    }

    if (originatingAttackId) {
      actionRollData.baseAttack = (await fromUuid(originatingAttackId))
        ?.getRollData();
    }

    let _actions = Item35E.parseAction(actions);

    LogHelper.log('ACTION | Actions', _actions);
    for (let action of _actions) {
      if (
        action.target !== target ||
        (action.condition !== undefined &&
          action.condition !== null &&
          action.condition !== '' &&
          !Roll35e.safeEvaluateCondition(action.condition, actionRollData))
      )
        continue; // We drop out since actions do not belong to us

      switch (action.action) {
        case 'TurnUndead':
          otherActions.push(action);
          break;
        case 'Create':
        case 'Give':
          itemCreationActions.push(action);
          break;
        case 'Remove':
          itemRemoveActions.push(action);
          break;
        case 'Activate':
        case 'Deactivate':
          otherActions.push(action);
          break;
        case 'Set':
          itemUpdateActions.push(action);
          break;
        case 'Condition':
        case 'Trait':
        case 'Update':
        case 'AbilityDamage':
        case 'AbilityDrain':
        case 'CureAbilityDamage':
        case 'CureAbilityDrain':
          actorUpdateActions.push(action);
          break;
        case 'Damage':
        case 'SelfDamage':
        case 'ApplyDamage':
        case 'Grapple':
        case 'Regenerate':
        case 'Clear':
        case 'Use':
        case 'Roll':
        case 'RollTable':
        case 'RunMacro':
        case 'Eval':
        case 'Message':
          otherActions.push(action);
          break;
        default:

          break;
      }
    }

    let itemUpdates = [];
    let itemsToDelete = [];
    let itemsToCreate = [];
    let actorUpdates = {};

    for (let action of itemCreationActions) {
      await this.applySingleAction(
        action,
        itemUpdates,
        itemsToCreate,
        actorUpdates,
        actionRollData,
        actor,
        itemsToDelete,
      );
    }
    if (itemCreationActions.length) {
      LogHelper.log('ACTION | itemCreationActions', itemCreationActions);
      await this.createEmbeddedDocuments('Item', itemsToCreate, {});
    }
    for (let action of itemRemoveActions) {
      await this.applySingleAction(
        action,
        itemUpdates,
        itemsToCreate,
        actorUpdates,
        actionRollData,
        actor,
        itemsToDelete,
      );
    }
    if (itemRemoveActions.length) {
      LogHelper.log('ACTION | itemRemoveActions', itemRemoveActions);
      await this.deleteEmbeddedDocuments('Item', itemsToDelete, {});
    }

    for (let action of itemUpdateActions) {
      await this.applySingleAction(
        action,
        itemUpdates,
        itemsToCreate,
        actorUpdates,
        actionRollData,
        actor,
        itemsToDelete,
      );
    }
    if (itemUpdateActions.length) {
      LogHelper.log('ACTION | itemUpdateActions', itemUpdateActions);
      await this.updateEmbeddedDocuments('Item', itemUpdates, {});
    }
    for (let action of actorUpdateActions) {
      await this.applySingleAction(
        action,
        itemUpdates,
        itemsToCreate,
        actorUpdates,
        actionRollData,
        actor,
        itemsToDelete,
      );
    }
    if (actorUpdateActions.length) {
      LogHelper.log('ACTION | actorUpdates', actorUpdateActions, this.name);
      // Change all self. to system. in actorUpdates keys
      actorUpdates = Object.fromEntries(
        Object.entries(actorUpdates).map(([k, v]) => [k.replace(/^self\./, 'system.'), v])
      );
      // Normalize data. to system. in actorUpdates keys
      actorUpdates = Object.fromEntries(
        Object.entries(actorUpdates).map(([k, v]) => [k.replace(/^data\./, 'system.'), v])
      );
      await this.update(actorUpdates);
    } else {
      await this.update({});
    }
    for (let action of otherActions) {
      await this.applySingleAction(
        action,
        itemUpdates,
        itemsToCreate,
        actorUpdates,
        actionRollData,
        actor,
        itemsToDelete,
      );
    }
  }

  async executeEvalOnSelf(action) {
    let actor = this;
    //LogHelper.log('Running async eval')
    await eval('(async () => {' + action.body + '})()');
    //LogHelper.log('Running async eval done')
  }

  async quickChangeItemQuantity(itemId, add = 1) {
    const item = this.items.get(itemId);

    const curQuantity = foundry.utils.getProperty(item.system, 'quantity') || 0;
    const newQuantity = Math.max(0, curQuantity + add);
    await item.update({ 'system.quantity': newQuantity });
  }

  //

  async _createConsumableSpellDialog(itemData) {
    let template = 'systems/warcraftrpg2e/templates/apps/spell-based-item-dialog.html';
    const html = await foundry.applications.handlebars.renderTemplate(template, {
      label: game.i18n.localize('D35E.CreateItemForSpellD').
        format(itemData.name),
      isSpell: true,
    });
    new Dialog({
      title: game.i18n.localize('D35E.CreateItemForSpell').
        format(itemData.name),
      content: html,
      buttons: {
        potion: {
          icon: '<i class="fas fa-prescription-bottle"></i>',
          label: 'Potion',
          callback: (html) => this.createConsumableSpell(itemData, 'potion',
            html),
        },
        scroll: {
          icon: '<i class="fas fa-scroll"></i>',
          label: 'Scroll',
          callback: (html) => this.createConsumableSpell(itemData, 'scroll',
            html),
        },
        wand: {
          icon: '<i class="fas fa-magic"></i>',
          label: 'Wand',
          callback: (html) => this.createConsumableSpell(itemData, 'wand',
            html),
        },
      },
      default: 'potion',
    }).render(true);
  }

  async _createConsumablePowerDialog(itemData) {
    let template = 'systems/warcraftrpg2e/templates/apps/spell-based-item-dialog.html';
    const html = await foundry.applications.handlebars.renderTemplate(template, {
      label: game.i18n.localize('D35E.CreateItemForPowerD').
        format(itemData.name),
    });
    new Dialog({
      title: game.i18n.localize('D35E.CreateItemForPower').
        format(itemData.name),
      content: html,
      buttons: {
        potion: {
          icon: '<i class="fas fa-prescription-bottle"></i>',
          label: 'Tattoo',
          callback: (html) => this.createConsumableSpell(itemData, 'tattoo',
            html),
        },
        scroll: {
          icon: '<i class="fas fa-scroll"></i>',
          label: 'Power Stone',
          callback: (html) => this.createConsumableSpell(itemData, 'powerstone',
            html),
        },
        wand: {
          icon: '<i class="fas fa-magic"></i>',
          label: 'Dorje',
          callback: (html) => this.createConsumableSpell(itemData, 'dorje',
            html),
        },
      },
      default: 'tattoo',
    }).render(true);
  }

  async _createRaceAddDialog(itemData, dataType) {
    // If actor does not have race already, we can just add it as is
    if (!this.race) {
      this.createEmbeddedDocuments("Item", [itemData], { dataType: dataType })
    } else {
      new Dialog({
        title: game.i18n.localize('D35E.AddDuplicateRaceForActor').format(itemData.name, this.race.name),
        content: game.i18n.localize('D35E.AddDuplicateRaceForActorD').format(itemData.name, this.race.name),
        buttons: {
          replace: {
            icon: '<i class="fas fa-exchange-alt"></i>',
            label: 'Replace',
            callback: async () => {
              await this.race.delete();
              await this.createEmbeddedDocuments("Item", [itemData], { dataType: dataType });
            }
          },
          cancel: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Cancel',
            callback: () => { }
          }
        },
        default: 'replace'
      }).render(true);
    }
  }

  _createPolymorphBuffDialog(itemData) {
    new Dialog({
      title: game.i18n.localize('D35E.CreateItemForActor').
        format(itemData.name),
      content: game.i18n.localize('D35E.CreateItemForActorD').
        format(itemData.name),
      buttons: {
        potion: {
          icon: '',
          label: 'Wild Shape',
          callback: () => this.createWildShapeBuff(itemData),
        },
        scroll: {
          icon: '',
          label: 'Polymorph',
          callback: () => this.createPolymorphBuff(itemData),
        },
        wand: {
          icon: '',
          label: 'Alter Self',
          callback: () => this.createAlterSelfBuff(itemData),
        },
        // lycantrophy: {
        //   icon: '',
        //   label: "Lycantrophy",
        //   callback: () => this.createLycantrophyBuff(itemData),
        // },
      },
      default: 'Polymorph',
    }).render(true);
  }

  _setMaster(itemData) {
    if (itemData == null) {
      let updateData = {};
      updateData['system.-=master'] = null;
      this.update(updateData);
    } else {
      let masterData = {
        system: {
          master: {
            id: itemData.id,
            img: itemData.img,
            name: itemData.name,
            data: game.actors.get(itemData.id)?.getRollData() ?? {},
          },
        },
      };
      this.update(masterData);
    }
  }

  async createAttackSpell(itemData, type) {
    let data = await Item35E.toAttack(itemData);

    if (data._id) delete data._id;
    await this.createEmbeddedDocuments('Item', [data]);
  }

  async createConsumableSpell(itemData, type, html) {
    const dlgRoot = html?.nodeType === 1 ? html : html?.[0] ?? html;
    let cl = parseInt(dlgRoot.querySelector('[name="caster-level"]').value);
    let scrollType = dlgRoot.querySelector('[name="scroll-type"]').value;
    let data = await ItemConsumableConverter.toConsumable(itemData, type, cl,
      scrollType);

    if (data._id) delete data._id;
    await this.createEmbeddedDocuments('Item', [data]);
  }

  async createTrait(itemData, type) {
    let data = await Item35E.toTrait(itemData, type);

    if (data._id) delete data._id;
    await this.createEmbeddedDocuments('Item', [data]);
  }

  async createWildShapeBuff(itemData) {
    let data = await Item35E.toPolymorphBuff(itemData, 'wildshape');

    if (data._id) delete data._id;
    await this.createEmbeddedDocuments('Item', [data]);
  }

  async createPolymorphBuff(itemData, type) {
    let data = await Item35E.toPolymorphBuff(itemData, 'polymorph');

    if (data._id) delete data._id;
    await this.createEmbeddedDocuments('Item', [data]);
  }

  async createAlterSelfBuff(itemData, type) {
    let data = await Item35E.toPolymorphBuff(itemData, 'alter-self');

    if (data._id) delete data._id;
    await this.createEmbeddedDocuments('Item', [data]);
  }

  async createLycantrophyBuff(itemData, type) {
    let data = await Item35E.toPolymorphBuff(itemData, 'lycantrophy');

    if (data._id) delete data._id;
    await this.createEmbeddedDocuments('Item', [data]);
  }

  async _updateMinions(options) {
    if (options.skipMinions) return;
    for (const actor of game.actors) {
      if (actor.system?.master?.id === this.id) {
        let masterData = {
          data: {
            master: {
              img: this.img,
              name: this.name,
              data: this.getRollData(),
            },
          },
        };

        // Updating minion "Familiar class"
        const classes = actor.items.filter((obj) => {
          return obj.type === 'class';
        });

        const minionClass = classes.find(
          (o) => foundry.utils.getProperty(o.system, 'classType') === 'minion');
        if (!!minionClass) {
          let updateObject = {};
          updateObject['id'] = minionClass.id;
          updateObject['system.levels'] =
            this.getRollData().attributes.minionClassLevels[minionClass.system.minionGroup] ||
            0;
          LogHelper.log('Minion class', minionClass, updateObject,
            this.getRollData());
          await actor.updateEmbeddedDocuments('Item', [updateObject],
            { stopUpdates: true, massUpdate: true });
        }
        actor.update(masterData, { stopUpdates: true });
      }
    }
  }

  async _calculateMinionDistance() {
    if (this == null) return;
    if (!this.testUserPermission(game.user, 'OWNER')) return;
    if (this.type === 'npc') {
      let myToken = this.getActiveTokens()[0];
      let masterId = this.system?.master?.id;
      let master = game.actors.get(masterId);
      if (!master || !master.getActiveTokens()) return;
      let masterToken = master.getActiveTokens()[0];
      if (!!myToken && !!masterToken) {
        let distance = Math.floor(
          canvas.grid.measureDistance(myToken, masterToken) / 5.0) * 5;
        let masterData = {
          data: {
            master: {
              distance: distance,
            },
          },
        };
        let minionData = {
          data: {
            attributes: { minionDistance: {} },
          },
        };
        minionData.data.attributes.minionDistance[this.name.toLowerCase().
          replace(/ /g, '').
          replace(/,/g, '')] =
          distance;
        master.update(minionData,
          { stopUpdates: true, skipToken: true, skipMinions: true });
        this.update(masterData, { stopUpdates: true, skipToken: true });
      }
    } else if (this.type === 'character') {
      let myToken = this.getActiveTokens()[0];
      let minionData = {
        data: {
          attributes: { minionDistance: {} },
        },
      };
      let hasAnyMinion = false;
      game.actors.forEach((minion) => {
        if (minion.system?.master?.id === this.id) {
          hasAnyMinion = true;
          let minionToken = minion.getActiveTokens()[0];
          if (!!myToken && !!minionToken) {
            let distance = Math.floor(
              canvas.grid.measureDistance(myToken, minionToken) / 5.0) * 5;
            let masterData = {
              data: {
                master: {
                  distance: distance,
                },
              },
            };
            minionData.data.attributes.minionDistance[
              minion.name.toLowerCase().
                replace(/ /g, '').
                replace(/,/g, '')
            ] = distance;
            minion.update(masterData, { stopUpdates: true, skipToken: true });
          }
        }
      });
      if (hasAnyMinion) this.update(minionData,
        { stopUpdates: true, skipToken: true, skipMinions: true });
    }
  }

  promptRest() {
    new ActorRestDialog(this).render(true);
  }

  /** Roll the Warcraft d% stabilization check for a dying living creature. */
  async rollWarcraftStabilization() {
    const deathRule = resolveDeathRule(
      this.system.attributes.deathRule,
      this.race?.system?.deathRule,
      this.system.attributes.creatureType,
    );
    if (deathRule !== DEATH_RULE_WARCRAFT) {
      return ui.notifications.warn(game.i18n.localize('D35E.WarcraftStabilizationLivingOnly'));
    }
    const roll = await new Roll35e('1d100', this.getRollData()).roll();
    const staminaScore = Number(this.system.abilities.con.total ?? this.system.abilities.con.value ?? 0);
    const healDc = warcraftStabilizationDc(this.system.attributes.hp.value);
    const result = resolveWarcraftStabilization({
      hitPoints: this.system.attributes.hp.value,
      staminaScore,
      roll: roll.total,
    });
    if (!result.attempted) return ui.notifications.warn(game.i18n.localize('D35E.WarcraftStabilizationDyingOnly'));
    await this.update({
      'system.attributes.hp.value': result.hitPoints,
      'system.attributes.conditions.stable': result.stable,
      'system.attributes.conditions.dying': result.dying,
      'system.attributes.conditions.dead': result.dead,
    });
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.format(result.success ? 'D35E.WarcraftStabilizationSuccess' : 'D35E.WarcraftStabilizationFailure', {
        stamina: staminaScore,
        dc: healDc,
      }),
    });
    return result;
  }

  /** Roll an hourly recovery check for a stable living Warcraft creature. */
  async rollWarcraftStableRecovery({ tended = false } = {}) {
    const deathRule = resolveDeathRule(
      this.system.attributes.deathRule,
      this.race?.system?.deathRule,
      this.system.attributes.creatureType,
    );
    if (deathRule !== DEATH_RULE_WARCRAFT || !this.system.attributes.conditions.stable) {
      return ui.notifications.warn(game.i18n.localize('D35E.WarcraftRecoveryStableOnly'));
    }
    const roll = await new Roll35e('1d100', this.getRollData()).roll();
    const staminaScore = Number(this.system.abilities.con.total ?? this.system.abilities.con.value ?? 0);
    const result = resolveWarcraftStableRecovery({
      hitPoints: this.system.attributes.hp.value,
      staminaScore,
      roll: roll.total,
      tended,
    });
    await this.update({
      'system.attributes.hp.value': result.hitPoints,
      'system.attributes.conditions.stable': result.stable,
      'system.attributes.conditions.disabled': result.disabled,
      'system.attributes.conditions.unconscious': result.unconscious,
      'system.attributes.conditions.helpless': result.unconscious,
      'system.attributes.conditions.dead': result.dead,
    });
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.localize(result.success ? 'D35E.WarcraftRecoverySuccess' : 'D35E.WarcraftRecoveryFailure'),
    });
    return result;
  }

  async rest(restoreHealth, restoreDailyUses, longTermCare) {
    const actorData = this.system;
    let rollData = this.getRollData();
    const updateData = {};
    let preserveCurrentHitPoints = false;

    if (this.items !== undefined && this.items.size > 0) {
      // Update items
      for (let i of this.items) {
        await i.addElapsedTime(8 * 60 * 10);
      }
    }

    // Restore health and ability damage
    if (restoreHealth) {
      const hd = actorData.attributes.hd.total;
      const raceName = this.race?.name ?? actorData.details?.race ?? '';
      const racialClassLevels = this.items
        .filter((item) => item.type === 'class' && item.system.classType === 'racial')
        .reduce((sum, item) => sum + Number(item.system.levels || 0), 0);
      const restoresHitPoints = usesNaturalHitPointRecovery(
        actorData.attributes.deathRule,
        this.race?.system?.deathRule,
        actorData.attributes.creatureType,
      );
      preserveCurrentHitPoints = !restoresHitPoints;
      let heal = {
        hp: restoresHitPoints
          ? warcraftRestHitPointRecovery({
            hitDice: hd,
            staminaModifier: actorData.abilities.con?.mod,
            raceName,
            racialClassLevels,
            longTermCare,
          })
          : 0,
        abl: 1,
      };
      if (longTermCare) {
        heal.abl *= 2;
      }

      updateData['system.attributes.hp.value'] = Math.min(
        actorData.attributes.hp.value + heal.hp,
        actorData.attributes.hp.max,
      );
      updateData['system.attributes.hp.nonlethal'] = Math.max(
        actorData.attributes.hp.nonlethal - heal.hp, 0);
      for (let [key, abl] of Object.entries(actorData.abilities)) {
        let dmg = Math.abs(abl.damage);
        updateData[`system.abilities.${key}.damage`] = Math.max(0,
          dmg - heal.abl);
      }
    }

    // Restore daily uses of spells, feats, etc.
    if (restoreDailyUses) {
      let items = [],
        hasItemUpdates = false;
      for (let item of this.items) {
        let itemUpdate = {};
        const itemData = item.system;
        rollData.item = foundry.utils.duplicate(itemData);

        if (itemData.uses && itemData.uses.per === 'day' &&
          itemData.uses.value !== itemData.uses.max) {
          hasItemUpdates = true;
          itemUpdate['id'] = item.id;
          if (itemData.uses.rechargeFormula) {
            itemUpdate['system.uses.value'] = Math.min(
              itemData.uses.value + new Roll35e(itemData.uses.rechargeFormula,
                itemData).evaluateSync().total,
              itemData.uses.max,
            );
            rollData.item.uses.value = itemUpdate['system.uses.value'];
          } else {
            itemUpdate['system.uses.value'] = itemData.uses.max;
            rollData.item.uses.value = itemUpdate['system.uses.value'];
          }
        }
        if (foundry.utils.hasProperty(item, 'system.combatChangesRange.maxFormula')) {
          if (foundry.utils.getProperty(item, 'system.combatChangesRange.maxFormula') !==
            '') {
            try {
              let roll = new Roll35e(
                foundry.utils.getProperty(item, 'system.combatChangesRange.maxFormula'),
                rollData).evaluateSync();
              hasItemUpdates = true;
              itemUpdate['system.combatChangesRange.max'] = roll.total;
              itemUpdate['id'] = item.id;
            } catch (e) {
              game.D35E.logger.error('D35E | Error evaluating combatChangesRange.maxFormula for', item.name, e);
            }
          }
        }
        for (let i = 1; i <= 3; i++)
          if (foundry.utils.hasProperty(item,
            `system.combatChangesAdditionalRanges.slider${i}.maxFormula`)) {
            if (foundry.utils.getProperty(item,
              `system.combatChangesAdditionalRanges.slider${i}.maxFormula`) !==
              '') {
              try {
                let roll = new Roll35e(
                  foundry.utils.getProperty(item,
                    `system.combatChangesAdditionalRanges.slider${i}.maxFormula`),
                  rollData,
                ).evaluateSync();
                hasItemUpdates = true;
                itemUpdate[`system.combatChangesAdditionalRanges.slider${i}.max`] = roll.total;
                itemUpdate['id'] = item.id;
              } catch (e) {
                game.D35E.logger.error('D35E | Error evaluating combatChangesAdditionalRanges.slider' + i + '.maxFormula for', item.name, e);
              }
            }
          }
        if (
          itemData.enhancements &&
          itemData.enhancements.uses &&
          itemData.enhancements.uses.per === 'day' &&
          itemData.enhancements.uses.value !== itemData.enhancements.uses.max
        ) {
          hasItemUpdates = true;
          itemUpdate['id'] = item.id;
          if (itemData.enhancements.uses.rechargeFormula) {
            itemUpdate['system.enhancements.uses.value'] = Math.min(
              itemData.enhancements.uses.value +
              new Roll35e(itemData.enhancements.uses.rechargeFormula,
                itemData).evaluateSync().total,
              itemData.enhancements.uses.max,
            );
          } else {
            itemUpdate['system.enhancements.uses.value'] = itemData.enhancements.uses.max;
          }
        } else if (item.type === 'spell') {
          const spellbook = foundry.utils.getProperty(actorData,
            `attributes.spells.spellbooks.${itemData.spellbook}`),
            usesSharedSlots = spellbookUsesSharedSlots(spellbook),
            usePowerPoints = spellbook?.usePowerPoints === true;
          if (
            // Warcraft restricted-slot copies track their own single use even
            // though the ordinary repertoire spends from a shared pool.
            (itemData.specialPrepared === true || !usesSharedSlots) &&
            !usePowerPoints &&
            itemData.preparation.preparedAmount !==
            itemData.preparation.maxAmount
          ) {
            hasItemUpdates = true;
            itemUpdate['id'] = item.id;
            itemUpdate['system.preparation.preparedAmount'] = itemData.preparation.maxAmount;
          }
        }

        if (itemData.enhancements && itemData.enhancements &&
          itemData.enhancements.items) {
          let enhItems = foundry.utils.duplicate(itemData.enhancements.items);
          for (let _item of enhItems) {
            let enhancementData = ItemEnhancementHelper.getEnhancementData(
              _item);
            hasItemUpdates = hasItemUpdates ||
              ItemEnhancementHelper.restoreEnhancementUses(enhancementData,
                true);
          }
          itemUpdate['id'] = item.id;
          itemUpdate[`system.enhancements.items`] = enhItems;
        }
        if (itemUpdate['id']) items.push(itemUpdate);
      }
      game.D35E.logger.log('Updating embedded items?', hasItemUpdates);
      if (hasItemUpdates) {
        game.D35E.logger.log('Updating embedded items', items);
        await this.updateEmbeddedDocuments('Item', items, { stopUpdates: true });
      }

      // Restore shared-slot spellbooks (spontaneous and repertoire)
      for (const [poolKey, pool] of Object.entries(
        actorData.attributes.spells.warcraftPools || {})) {
        for (let sl of Object.keys(CONFIG.D35E.spellLevels)) {
          updateData[`system.attributes.spells.warcraftPools.${poolKey}.spells.spell${sl}.value`] = foundry.utils.getProperty(
            pool,
            `spells.spell${sl}.max`,
          ) || 0;
        }
      }
      for (let [key, spellbook] of Object.entries(
        actorData.attributes.spells.spellbooks)) {
        if (spellbookUsesSharedSlots(spellbook) && !getWarcraftSlotPool(actorData, spellbook)) {
          for (let sl of Object.keys(CONFIG.D35E.spellLevels)) {
            updateData[`system.attributes.spells.spellbooks.${key}.spells.spell${sl}.value`] = foundry.utils.getProperty(
              actorData,
              `attributes.spells.spellbooks.${key}.spells.spell${sl}.max`,
            );
          }
        }
        if (spellbook?.usePowerPoints) {
          let rollData = {};
          if (actorData == null && this.actor !=
            null) rollData = this.getRollData();
          else rollData = actorData;
          try {
            updateData[`system.attributes.spells.spellbooks.${key}.powerPoints`] = new Roll35e(
              foundry.utils.getProperty(actorData,
                `attributes.spells.spellbooks.${key}.dailyPowerPointsFormula`),
              rollData,
            ).evaluateSync().total;
          } catch (e) {
            updateData[`system.attributes.spells.spellbooks.${key}.powerPoints`] = 0;
          }
        }
      }

      updateData[`system.attributes.turnUndeadUses`] = foundry.utils.getProperty(actorData,
        `attributes.turnUndeadUsesTotal`);
      updateData[`system.attributes.shoutUses.value`] = foundry.utils.getProperty(
        actorData,
        `attributes.shoutUses.max`,
      ) ?? 0;
    }

    return await this.update(updateData, { preserveCurrentHitPoints });
  }

  async _setAverageHitDie() {
    for (const item of this.items.filter((obj) => {
      return obj.type === 'class';
    })) {
      let hd = item['data']['data']['hd'];
      let hp = 0;
      let levels = item['data']['data']['levels'];
      hp = Math.floor(parseInt(levels) * (hd / 2 + 0.5));
      await this.updateEmbeddedDocuments('Item', [{ _id: item.id, 'system.hp': hp }]);
      await this.refresh();
    }
  }

  async renderFastHealingRegenerationChatCard(roundDelta = 1) {
    let d = this.system;

    const token = this ? this.token : null;
    let chatTemplateData = {
      name: this.name,
      img: this.img,
      [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
      rollMode: 'selfroll',
      tokenId: token ? `${token.parent.id}.${token.id}` : null,
      actor: this,
    };
    let chatData = {
      speaker: ChatMessage.getSpeaker({ actor: this }),
      rollMode: 'selfroll',
      sound: CONFIG.sounds.dice,
      'flags.warcraftrpg2e.noRollRender': true,
    };
    let actions = [];
    if (d.traits.regenTotal) {
      actions.push({
        label: game.i18n.localize('D35E.Regeneration'),
        value: `Regenerate ${d.traits.regenTotal * roundDelta} on self;`,
        isTargeted: false,
        action: 'customAction',
        img: '',
        hasImg: false,
      });
    }
    if (d.traits.fastHealingTotal) {
      actions.push({
        label: game.i18n.localize('D35E.FastHealing'),
        value: `SelfDamage -min(${d.traits.fastHealingTotal * roundDelta}, max(0, @attributes.hp.max - @attributes.hp.value)) on self;`,
        isTargeted: false,
        action: 'customAction',
        img: '',
        hasImg: false,
      });
    }
    if (actions.length) {
      const templateData = foundry.utils.mergeObject(
        chatTemplateData,
        {
          actions: actions,
        },
        { inplace: false },
      );
      // Create message
      await createCustomChatMessage(
        'systems/warcraftrpg2e/templates/chat/fastheal-roll.html', templateData,
        chatData, {});
    }
  }

  async syncToCompendium(manual = false) {
    if (!foundry.utils.getProperty(this.system, 'companionUuid')) return;
    let apiKey = game.settings.get('warcraftrpg2e', 'apiKeyWorld');
    if (foundry.utils.getProperty(this.system,
      'companionUsePersonalKey')) apiKey = game.settings.get('warcraftrpg2e',
        'apiKeyPersonal');
    if (!apiKey) return;
    let that = this;
    $.ajax({
      url: `${this.API_URI}/api/character/${this.system.companionUuid}`,
      type: 'PUT',
      headers: { 'API-KEY': apiKey },
      crossDomain: true,
      dataType: 'json',
      contentType: 'application/json; charset=utf-8',
      data: JSON.stringify(this),
      success: function (data) {
        if (manual) {
          ui.notifications.info(
            game.i18n.localize('D35E.NotificationSyncSuccessfull').
              format(that.name));
        }
      },
      error: function (jqXHR, textStatus, errorThrown) {
        //LogHelper.log(textStatus)
        if (manual) {
          ui.notifications.error(
            game.i18n.localize('D35E.NotificationSyncError').
              format(that.name));
        }
      },
    });
  }

  get canAskForRequest() {
    if (!foundry.utils.getProperty(this.system, 'companionUuid')) return false;

    let userWithCharacterIsActive = game.users.players.some(
      (u) => u.active && u.character?.id === this.id);
    let isMyCharacter = game.user.character?.id === this.id;
    // It is not ours character and user that has this character is active - so better direct commands to his/her account
    if (!isMyCharacter && userWithCharacterIsActive) return false;

    return true;
  }

  get isCompanionSetUp() {
    if (!foundry.utils.getProperty(this.system, 'companionUuid')) return false;
    let apiKey = game.settings.get('warcraftrpg2e', 'apiKeyWorld');
    if (!apiKey) return false;

    if (foundry.utils.getProperty(this.system,
      'companionUsePersonalKey')) apiKey = game.settings.get('warcraftrpg2e',
        'apiKeyPersonal');
    return apiKey || false;

  }

  connectToCompanionSocket() {
    if (!this.canAskForRequest) return;
    this.socket = io(`${this.API_URI}`);
    this.socket.on('foundry', (data) => {
      game.D35E.logger.log('Received foundry message', data);
      this.socket.emit('processed', {
        actionId: data['actionId'],
        room: foundry.utils.getProperty(this.system, 'companionUuid'),
      });
      this.executeRemoteAction(data);
    });
  }

  connectToCompanionCharacterRoom() {
    if (!this.socket) return;
    if (this.socketRoomConnected) return;
    this.socket.emit('join', {
      username: 'foundry' + game.user.name,
      room: foundry.utils.getProperty(this.system, 'companionUuid'),
    });
    this.socketRoomConnected = true;
  }

  disconnectFromCompanionCharacterRoom() {
    if (!this.socketRoomConnected) return;
    this.socket.emit('leave', {
      username: 'foundry' + game.user.name,
      room: foundry.utils.getProperty(this.system, 'companionUuid'),
    });
    this.socketRoomConnected = false;
  }

  async getQueuedActions() {
    if (!this.canAskForRequest) return;

    let that = this;
    let apiKey = game.settings.get('warcraftrpg2e', 'apiKeyWorld');
    if (!apiKey) return;

    if (foundry.utils.getProperty(this.system,
      'companionUsePersonalKey')) apiKey = game.settings.get('warcraftrpg2e',
        'apiKeyPersonal');
    $.ajax({
      url: `${this.API_URI}/api/character/actions/${this.system.companionUuid}`,
      type: 'GET',
      headers: { 'API-KEY': apiKey },
      crossDomain: true,
      dataType: 'json',
      contentType: 'application/json; charset=utf-8',
      success: function (data) {
        //LogHelper.log('LOTDCOMPANION | ', data)
        that.executeRemoteAction(data);
      },
    });
  }

  async executeRemoteAction(remoteAction) {
    switch (remoteAction.action) {
      case 'ability':
        this.rollAbility(remoteAction.params);
        break;
      case 'save':
        this.rollSave(remoteAction.params);
        break;
      case 'rollSkill':
        this.rollSkill(remoteAction.params);
        break;
      case 'useItem':
        this.items.find((i) => i.id === remoteAction.params).use({});
        break;
      case 'rest':
        this.promptRest();
    }
  }

  getChargesFromItemById(id) {
    let _item = this.items.find(
      (item) => item.id === id || item.system.uniqueId === id);
    if (_item != null) {
      return _item.system?.uses?.value || 0;
    } else {
      return 0;
    }
  }

  getMaxChargesFromItemById(id) {
    let _item = this.items.find(
      (item) => item.id === id || item.system.uniqueId === id);
    if (_item != null) {
      return _item.system?.uses?.max || 0;
    } else {
      return 0;
    }
  }

  getItemByUidOrId(id) {
    let _item = this.items.find(
      (item) => item.id === id || item.system.uniqueId === id);
    if (_item != null) {
      return _item;
    } else {
      return null;
    }
  }

  getItemByTag(tag) {
    let _item = this.items.find(
      (item) => createTag(item.name) === tag || item.system.customTag ===
        tag);
    if (_item != null) {
      return _item;
    } else {
      return null;
    }
  }

  getItemByTagAndType(tag, type) {
    let _item = this.items.find(
      (item) => item.type === type &&
        (createTag(item.name) === tag || item.system.customTag === tag),
    );
    if (_item != null) {
      return _item;
    } else {
      return null;
    }
  }

  getItemByNameAndType(name, type) {
    let _item = this.items.find(
      (item) => item.type === type && item.name === name);
    if (_item != null) {
      return _item;
    } else {
      return null;
    }
  }

  async deactivateBuffs(itemIds) {
    for (let itemId of itemIds) {
      await this.items.find((item) => item.id === itemId).
        update({ 'system.active': false }, { forceDeactivate: true });
    }
  }

  async renderBuffEndChatCard(items) {
    const chatTemplate = 'systems/warcraftrpg2e/templates/chat/roll-ext.html';

    // Create chat data
    let chatData = {
      user: game.user.id,
      [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_CHAT,
      sound: CONFIG.sounds.dice,
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      rollMode: game.settings.get('core', 'rollMode'),
    };
    // Handle different roll modes
    switch (chatData.rollMode) {
      case 'gmroll':
        chatData['whisper'] = game.users.contents.filter((u) => u.isGM).
          map((u) => u.id);
        break;
      case 'selfroll':
        chatData['whisper'] = [game.user.id];
        break;
      case 'blindroll':
        chatData['whisper'] = game.users.contents.filter((u) => u.isGM).
          map((u) => u.id);
        chatData['blind'] = true;
    }

    // Send message
    await createCustomChatMessage(
      'systems/warcraftrpg2e/templates/chat/deactivate-buff.html',
      { items: items, actor: this },
      chatData,
      { rolls: [] },
    );
  }

  async applyOnRoundBuffActions(items, roundDelta = 1) {
    const token = this ? this.token : null;
    let chatTemplateData = {
      name: this.name,
      img: this.img,
      [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
      rollMode: 'selfroll',
      tokenId: token ? `${token.parent.id}.${token.id}` : null,
      actor: this,
    };
    let chatData = {
      speaker: ChatMessage.getSpeaker({ actor: this }),
      rollMode: 'selfroll',
      sound: CONFIG.sounds.dice,
      'flags.warcraftrpg2e.noRollRender': true,
    };
    let actions = [];
    for (let i of items) {
      for (let _action of i.system.perRoundActions)
        actions.push({
          label: i.name,
          value: _action.action.replaceAll('@roundDelta', roundDelta),
          isTargeted: false,
          action: 'customAction',
          img: i.img,
          hasImg: true,
        });
    }
    if (actions.length) {
      const templateData = foundry.utils.mergeObject(
        chatTemplateData,
        {
          actions: actions,
        },
        { inplace: false },
      );
      // Create message
      await createCustomChatMessage('systems/warcraftrpg2e/templates/chat/dot-roll.html',
        templateData, chatData, {});
    }
  }

  async groupItems() {
    let itemsToDelete = new Set();
    let itemQuantities = new Map();
    for (let type of ['equipment', 'loot', 'weapon']) {
      let itemNames = new Set();
      let itemNamesToId = new Map();
      let equipment = this.items.filter((o) => {
        return o.type === type;
      });
      for (let _item of equipment) {
        let _name = `${_item.name}-${_item.system.carried}-${_item.system.equipped}-${_item.system.containerId}-${_item.system.subType}`;
        if (itemNames.has(_name)) {
          itemQuantities.set(
            itemNamesToId.get(_name),
            itemQuantities.get(itemNamesToId.get(_name)) +
            _item.system.quantity,
          );
          itemsToDelete.add(_item.id);
        } else {
          itemNames.add(_name);
          itemQuantities.set(_item.id, _item.system.quantity);
          itemNamesToId.set(_name, _item.id);
        }
      }
    }
    if (Array.from(itemsToDelete).length)
      await this.deleteEmbeddedDocuments('Item', Array.from(itemsToDelete),
        { stopUpdates: true });

    let itemsToUpdate = [];
    for (const [key, value] of itemQuantities.entries()) {
      itemsToUpdate.push({ id: key, 'system.quantity': value });
    }

    if (itemsToUpdate.length)
      await this.updateEmbeddedDocuments('Item', itemsToUpdate,
        { stopUpdates: true, ignoreSpellbookAndLevel: true });
  }



  async createEmbeddedDocuments(type, data, options = {}) {
    LogHelper.log('createEmbeddedDocuments');
    let payload = data;
    if (type === 'Item') {
      payload = data instanceof Array ? [...data] : [data];
      await this._prepareItemEmbedCreateData(payload, options);
      // Per-item preCreate hooks run before any member of a batch is embedded.
      // Preserve the small subset of sibling data needed by prerequisite checks
      // so a class can recognize a race (or another class) imported beside it.
      options._warcraftPendingItems = payload.map((item) => ({
        name: item?.name ?? '',
        type: item?.type ?? '',
        system: {
          customTag: item?.system?.customTag ?? '',
          levels: item?.system?.levels ?? 0,
        },
      }));
    }
    let createdItems = await super.createEmbeddedDocuments(type, payload, options);
    this._cachedAuras = null;
    if (!options.stopUpdates && !options.stopAuraUpdate) {
      await this.refresh(options);
    } else if (options.stopAuraUpdate && type === 'Item') {
      await this.conditions.toggleConditionStatusIcons();
    }
    return Promise.resolve(createdItems);
  }

  #correlateUpdateObjectsById(data) {
    const correlatedHashmap = data.reduce((result, item) => {
      const key = item._id ?? item.id;
      if (!key) return result;
      result[key] = result[key]
        ? {
          ...result[key],
          ...item,
        }
        : item;
      return result;
    }, {});
    // Foundry requires _id for each update object; normalize from id if present
    return Object.values(correlatedHashmap).map((o) => ({
      ...o,
      _id: o._id ?? o.id,
    }));
  }

  async updateEmbeddedDocuments(type, data, options = {}) {
    LogHelper.log('updateEmbeddedDocuments');
    const _data = this.#correlateUpdateObjectsById(data);
    let updatedItems = await super.updateEmbeddedDocuments(type, _data, options);
    if (options.massUpdate && !options.stopUpdates) await this.refresh({});
    return Promise.resolve(updatedItems);
  }

  async deleteEmbeddedDocuments(type, data, options = {}) {
    LogHelper.log('deleteEmbeddedDocuments');

    const normalizeIds = (value) => {
      const arr = value instanceof Array ? value : [value];
      return arr
        .map((v) => {
          if (typeof v === 'string') return v;
          if (v && typeof v === 'object') return v._id ?? v.id ?? null;
          return null;
        })
        .filter((v) => typeof v === 'string' && v.length > 0);
    };

    let ids = normalizeIds(data);
    if (type === 'Item') {
      const additionalItemsToDelete = [];
      for (let itemId of ids) {
        if (!this.items.has(itemId)) continue;
        let linkId = this.items.get(itemId).system.linkId;
        if (linkId) {
          this.items.filter((o) => {
            return o.system.linkSourceId === linkId;
          }).forEach((o) => additionalItemsToDelete.push(o.id));
        }
      }
      ids.push(...additionalItemsToDelete);
    }
    ids = Array.from(new Set(ids));

    let deletedDocuments = [];
    if (ids.length > 0) {
      deletedDocuments = await super.deleteEmbeddedDocuments(type, ids, options);
    }
    this._cachedAuras = null;
    if (!options.stopUpdates && !options.stopAuraUpdate) {
      await this.refresh(options);
    } else if (options.stopAuraUpdate && type === 'Item') {
      await this.conditions.toggleConditionStatusIcons();
    }
    return Promise.resolve(deletedDocuments);
  }

  async drawCardsForDeck(deckId) {
    let cards = this.items.filter((o) => {
      return o.type === 'card';
    });
    let allCards = cards.filter((obj) => {
      return obj.system.deck === deckId;
    });
    let discardedCards = shuffle(
      allCards.filter((obj) => {
        return obj.system.state === 'discarded';
      }).map((obj) => obj.id),
    );
    let deckCards = shuffle(
      allCards.filter((obj) => {
        return obj.system.state === 'deck';
      }).map((obj) => obj.id),
    );
    let deck = this.system.attributes?.cards?.decks[deckId] || {};
    let currentHandSize = allCards.filter((obj) => {
      return obj.system.state === 'hand';
    }).length;
    let cardsToDraw = Math.max(0, deck.handSize.total - currentHandSize);

    let cardUpdates = [];

    while (cardsToDraw > 0 && deckCards.length > 0) {
      let d = deckCards.pop();
      cardUpdates.push({ id: d, 'system.state': 'hand' });
      cardsToDraw--;
    }

    while (cardsToDraw > 0 && discardedCards.length > 0) {
      let d = discardedCards.pop();
      cardUpdates.push({ id: d, 'system.state': 'hand' });
      cardsToDraw--;
    }

    if (deckCards.length === 0 && discardedCards.length > 0) {
      discardedCards.forEach((d) => {
        cardUpdates.push({ id: d, 'system.state': 'deck' });
      });
    }

    return this.updateEmbeddedDocuments('Item', cardUpdates,
      { stopUpdates: true });
  }

  async advanceHd(_newHd) {
    let newHd = parseInt(_newHd);
    let updateData = {};
    let racialHd = this.racialHD;
    let currentLevel = racialHd.system.levels;
    let currentHP = racialHd.system.hp;
    let currentHidDice = racialHd.system.hd;
    if (!this.system?.advancement?.originalHD) {
      updateData['system.advancement.originalHD'] = currentLevel;
    }
    updateData['system.abilities.str.value'] = parseInt(foundry.utils.getProperty(this.system,
      'abilities.str.value'));
    updateData['system.abilities.dex.value'] = parseInt(foundry.utils.getProperty(this.system,
      'abilities.dex.value'));
    updateData['system.abilities.con.value'] = parseInt(foundry.utils.getProperty(this.system,
      'abilities.con.value'));
    updateData['system.attributes.naturalAC'] = parseInt(this.system.attributes.naturalAC);
    updateData['system.details.cr'] = parseInt(
      foundry.utils.getProperty(this.system, 'details.cr'));
    const size = foundry.utils.getProperty(this.system, 'traits.size');
    let newSize = foundry.utils.getProperty(this.system, 'traits.size');

    let advancement = foundry.utils.getProperty(this.system, 'details.advancement.hd');
    advancement.forEach((hd) => {
      if (newHd >= hd.lower) newSize = hd.size;
    });

    if (newSize === 'no-change' || newSize === '') newSize = size;

    const sizeIndex = Object.keys(CONFIG.D35E.actorSizes).
      indexOf(foundry.utils.getProperty(this.system, 'traits.size') || '');
    const newSizeIndex = Object.keys(CONFIG.D35E.actorSizes).
      indexOf(newSize || '');
    let currentSize = sizeIndex;
    while (currentSize < newSizeIndex) {
      currentSize++;
      let temporarySize = Object.keys(CONFIG.D35E.actorSizes)[currentSize];
      let temporaryChanges = CONFIG.D35E.sizeAdvancementChanges[temporarySize];
      updateData['system.abilities.str.value'] += temporaryChanges.str;
      updateData['system.abilities.dex.value'] += temporaryChanges.dex;
      updateData['system.abilities.con.value'] += temporaryChanges.con;
      updateData['system.attributes.naturalAC'] += temporaryChanges.nac;
      updateData['system.details.cr'] += 1;
    }
    updateData['system.traits.size'] = newSize;
    updateData['system.details.cr'] += Math.floor(
      (newHd - currentLevel) / racialHd.system.crPerHD);
    let newHP = Math.floor(
      (newHd - currentLevel) * (currentHidDice / 2 + 0.5)) + currentHP;
    await this.racialHD.update({ 'system.levels': newHd, 'system.hp': newHP });
    return this.update(updateData);
  }

  async progressBuff(buffUpdates, buffId, roundDelta = 1) {
    //await this.refresh();
    if (!buffUpdates.has(this.uuid)) {
      buffUpdates.set(this.uuid, {
        itemUpdateData: [],
        itemsEnding: [],
        itemsOnRound: [],
        itemsToDelete: [],
        itemsDeactivating: [],
        itemResourcesData: {},
        buffsToDelete: [],
        deletedOrChanged: false,
      });
    }
    const bu = buffUpdates.get(this.uuid);
    if (this.items !== undefined && this.items.size > 0) {
      // Update items
      /**
       * @type {Item35E}
       */
      let i = this.items.get(buffId);
      if (!i) {
        bu.itemsToDelete.push(buffId);
        bu.deletedOrChanged = true;
      } else {
        this.getItemResourcesUpdate(i, bu.itemResourcesData);
        let elapsedTimeUpdateData = i.getElapsedTimeUpdateData(roundDelta);
        if (elapsedTimeUpdateData && elapsedTimeUpdateData['system.active'] ===
          false) {
          bu.itemsEnding.push(i);
          bu.itemsDeactivating.push(elapsedTimeUpdateData.id);
        }
        if ((i.system.perRoundActions || []).length &&
          !elapsedTimeUpdateData.delete) bu.itemsOnRound.push(i);
        if (elapsedTimeUpdateData && !elapsedTimeUpdateData.delete &&
          !elapsedTimeUpdateData.ignore) {
          bu.itemUpdateData.push(elapsedTimeUpdateData);
          bu.deletedOrChanged = true;
        } else if (elapsedTimeUpdateData && elapsedTimeUpdateData.delete ===
          true) {
          bu.itemUpdateData.push(
            { id: elapsedTimeUpdateData.id, 'system.active': false });
          bu.itemsDeactivating.push(elapsedTimeUpdateData.id);
          bu.itemsToDelete.push(elapsedTimeUpdateData.id);
          bu.deletedOrChanged = true;
        }
      }
    }
  }

  async progressRound() {
    this.renderFastHealingRegenerationChatCard();
  }

  /**
   * GL#1422: when this actor becomes the active combatant, advance timed recharge on
   * embedded items by one step. Combat-only — no world clock.
   */
  async progressRechargeOnCombatTurnStart() {
    if (!this.items?.size) return;
    const updates = [];
    for (const item of this.items) {
      const r = item.system?.recharge;
      if (!r?.enabled) continue;
      const c = Number(r.current);
      if (!Number.isFinite(c) || c <= 0) continue;
      const maxUses = foundry.utils.getProperty(item.system, "uses.max");
      const t = 1;
      if (c - t < 1) {
        updates.push({
          _id: item.id,
          "system.recharge.current": 0,
          "system.uses.value": maxUses,
        });
      } else {
        updates.push({
          _id: item.id,
          "system.recharge.current": c - t,
        });
      }
    }
    if (updates.length) {
      await this.updateEmbeddedDocuments("Item", updates, {
        stopUpdates: true,
        massUpdate: true,
      });
    }
  }

  async progressTime(roundDelta = 1) {
    //await this.refresh();
    let itemUpdateData = [];
    let itemsEnding = [];
    let itemsOnRound = [];
    let itemsToDelete = [];
    let itemResourcesData = {};
    let deletedOrChanged = false;
    if (this.items !== undefined && this.items.size > 0) {
      // Update items
      for (let i of this.items) {
        this.getItemResourcesUpdate(i, itemResourcesData);
        let _data = i.getElapsedTimeUpdateData(roundDelta);
        if (_data && _data['system.active'] === false) itemsEnding.push(i);
        if ((i.system.perRoundActions || []).length &&
          !_data.delete) itemsOnRound.push(i);
        if (_data && !_data.delete && !_data.ignore) {
          itemUpdateData.push({ item: i, data: _data });
          deletedOrChanged = true;
        } else if (_data && _data.delete === true) {
          itemUpdateData.push(
            { item: i, data: { id: _data.id, 'system.active': false } });
          itemsToDelete.push(_data.id);
          deletedOrChanged = true;
        }
      }
    }

    if (itemUpdateData.length > 0) {
      let updatePromises = [];
      for (let updateData of itemUpdateData) {
        updatePromises.push(
          updateData.item.update(updateData.data, { stopUpdates: true }));
      }
      await Promise.all(updatePromises);
    }
    if (Object.keys(itemResourcesData).length > 0 ||
      deletedOrChanged) await this.update(itemResourcesData);
    if (itemsEnding.length) this.renderBuffEndChatCard(itemsEnding);
    if (itemsOnRound.length) this.applyOnRoundBuffActions(itemsOnRound,
      roundDelta);
    if (itemsToDelete.length > 0) {
      await this.deleteEmbeddedDocuments('Item', itemsToDelete, {});
    }
    this.renderFastHealingRegenerationChatCard(roundDelta);
  }

  static getActorFromTokenPlaceable(source) {
    if (source.document.actorLink) {
      return game.actors.get(source.document.actorId);
    } else {
      return source.actor;
    }
  }

  static async _updateToken(token, data) {
    if (token.document) {
      return token.document.update(data);
    } else {
      return token.update(data);
    }
  }

  /**
   * The VisionPermissionSheet instance for this actor
   *
   * @type {VisionPermissionSheet}
   */
  get visionPermissionSheet() {
    if (!this._visionPermissionSheet) this._visionPermissionSheet = new VisionPermissionSheet(
      this);
    return this._visionPermissionSheet;
  }

  async _preCreate(data, options, userId) {
    await super._preCreate(data, options, userId);
    let createData = {};
    let worldDefaultsSettings = game.settings.get('warcraftrpg2e', 'worldDefaults');
    for (let skill of worldDefaultsSettings.worldDefaults.customSkills) {
      this.__addNewCustomSkill(createData, skill[0], skill[1],
        (skill[2] || 'true') === 'true', (skill[3] || 'true') === 'true');
    }
    if (Object.keys(createData).length) this.updateSource(createData);
  }

  /**
   * Only run on PreCreateData
   */
  __addNewCustomSkill(createData, name, ability, rt, acp) {
    const skillData = {
      name: name,
      ability: ability || 'str',
      rank: 0,
      notes: '',
      mod: 0,
      rt: rt,
      cs: false,
      acp: acp,
      background: false,
      custom: true,
      worldCustom: true,
    };

    const baseTag = createTag(skillData.name || 'skill');
    let tag = baseTag;
    let count = 1;
    while (this.system.skills[tag] != null) {
      count++;
      tag = createTag(skillData.name || 'skill') + count.toString();
    }

    // see if the worldCustom skill of the same name is not already present (in case of actor duplicate)
    // in this.system.skills object
    for (let key of Object.keys(this.system.skills)) {
      if (this.system.skills[key].worldCustom && baseTag === key) {
        return;
      }
    }

    createData[`system.skills.${tag}`] = skillData;
  }
}
