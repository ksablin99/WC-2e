import { createTabs, uuidv4 } from "../../lib.js";
import { EntrySelector } from "../../apps/entry-selector.js";
import { Item35E } from "../entity.js";
import { CACHE } from "../../cache.js";
import { isMinimumCoreVersion } from "../../lib.js";
import { ActorDamageHelper } from "../../actor/helpers/actorDamageHelper.js";
import { createTag } from "../../lib.js";

import { Roll35e } from "../../roll.js";
import { ItemEnhancementHelper } from "../helpers/itemEnhancementHelper.js";
import { IntelligentItemHelper } from "../helpers/intelligentItemHelper.js";
import { ItemSheetComponent } from "./components/itemSheetComponent.js";
import { ChangesSheetComponent } from "./components/changesSheetComponent.js";
import { EnhancementSheetComponent } from "./components/enhancementSheetComponent.js";
import { NotesSheetComponent } from "./components/notesSheetComponent.js";
import { ItemSpellHelper } from '../helpers/itemSpellHelper.js';
import {
  getSpellbookPreparationMode,
  SPELLBOOK_PREPARATION_MODE_PREPARED,
} from '../helpers/spellbookPreparationHelper.js';
import { injectFormulaCreatorButtons } from "../../apps/formula-creator.js";

/**
 * Override and extend the core ItemSheet implementation to handle D&D5E specific item types
 * @type {ItemSheet}
 */
export class ItemSheetPF extends foundry.appv1.sheets.ItemSheet {
  constructor(...args) {
    super(...args);

    this.options.submitOnClose = false;

    /**
     * Track the set of item filters which are applied
     * @type {Set}
     */
    this._filters = {};
    this._filters = {};

    this.items = [];
    this.childItemMap = new Map();
    this.containerMap = new Map();
    this._altTabs = null;

    this.sheetComponents = [];
    this.sheetComponents.push(new ChangesSheetComponent(this));
    this.sheetComponents.push(new NotesSheetComponent(this));
  }

  /* -------------------------------------------- */

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      width: 560,
      height: 650,
      classes: ["D35E", "sheet", "item"],
      resizable: false,
    });
  }

  get title() {
    return this.item.displayName;
  }

  /* -------------------------------------------- */

  /**
   * Return a dynamic reference to the HTML template path used to render this Item Sheet
   * @return {string}
   */
  get template() {
    const path = "systems/warcraftrpg2e/templates/items/";
    return `${path}/${this.item.type}.html`;
  }

  /* -------------------------------------------- */

  /**
   * Prepare item sheet data
   * Start with the base item data and extending with additional properties for rendering.
   */
  async getData() {
    const sheetData = await super.getData();
    sheetData.system = sheetData.system ?? this.item.system;
    sheetData.labels = this.item.labels;
    // Include sub-items
    this.item.datas = [];
    if (this.item.items != null) {
      this.item.datas = this.item.items.map((i) => {
        i.system.labels = i.labels;
        return i.system;
      });
    }

    // Include CONFIG values
    sheetData.config = CONFIG.D35E;
    // Include relevant settings
    sheetData.usesImperialSystem = game.settings.get("warcraftrpg2e", "units") === "imperial";

    sheetData.randomUuid = uuidv4();

    // Item Type, Status, and Details
    this.item.dataType = this.item.type.titleCase();
    this.item.dataStatus = this._getItemStatus(this.item);
    this.item.dataProperties = this._getItemProperties(this.item);
    this.item.dataName = this.item.name;
    sheetData.isPhysical = this.item.system.quantity !== undefined;
    game.D35E.logger.log("Base Item Data", this.item.system.quantity !== undefined);
    sheetData.isSpell = this.item.type === "spell";
    sheetData.isCard = this.item.type === "card";
    sheetData.isConsumable = this.item.type === "consumable";
    sheetData.isScroll = this.item.system.consumableType === "scroll";
    sheetData.isClass = this.item.type === "class";
    sheetData.isRace = this.item.type === "race";
    sheetData.isAttack = this.item.type === "attack";
    sheetData.isEnhancement = this.item.type === "enhancement";
    sheetData.isWeaponAttack = this.item.system?.actionType === "rwak" || this.item.system?.actionType === "mwak";
    sheetData.isSummonWeapon = this.item.system?.actionType === "summonWeapon";
    sheetData.isDancingSummonWeapon = sheetData.isSummonWeapon && this.item.system?.summonWeapon?.behavior === "dancing";
    sheetData.tags = this.item.system.tags
    sheetData.isSpellLike =
      this.item.type === "spell" ||
      this.item.system?.actionType === "rsak" ||
      this.item.system?.actionType === "msak" ||
      this.item.system?.actionType === "heal" ||
      this.item.system?.actionType === "spellsave" ||
      this.item.system?.isFromSpell;
    sheetData.isShapechangeBuff = this.item.type === "buff" && this.item.system?.buffType === "shapechange";
    sheetData.canMeld = this.item.type === "weapon" || this.item.type === "attack" || this.item.type === "equipment";
    sheetData.isAmmo = this.item.system.subType === "ammo";
    sheetData.isContainer = this.item.system.subType === "container";

    if (sheetData.isAmmo) {
      const parts = this.item.system.ammoDamageParts || [];
      const replaceParts = parts.filter((p) => p[3] === "replace");
      const addParts = parts.filter((p) => p[3] !== "replace");
      if (replaceParts.length === 1 && !replaceParts[0][0]) {
        sheetData.ammoDamageHint = game.i18n.localize("D35E.AmmoDamageHintTypeOverride");
      } else if (replaceParts.length === 1) {
        sheetData.ammoDamageHint = game.i18n.localize("D35E.AmmoDamageHintSingleReplace");
      } else if (replaceParts.length > 1 && addParts.length > 0) {
        sheetData.ammoDamageHint = game.i18n.localize("D35E.AmmoDamageHintMixedReplace");
      } else if (replaceParts.length > 1) {
        sheetData.ammoDamageHint = game.i18n.localize("D35E.AmmoDamageHintFullReplace");
      } else if (addParts.length > 0) {
        sheetData.ammoDamageHint = game.i18n.localize("D35E.AmmoDamageHintAddOnly");
      } else {
        sheetData.ammoDamageHint = "";
      }
    }
    sheetData.owner = this.item.actor != null;
    sheetData.isGM = game.user.isGM;
    sheetData.showIdentifyDescription = sheetData.isGM && sheetData.isPhysical;
    sheetData.showUnidentifiedData = this.item.showUnidentifiedData;
    sheetData.materials = Array.from(CACHE.Materials.values());
    sheetData.baseDamageTypes = ActorDamageHelper.getBaseDRDamageTypes();
    sheetData.energyDamageTypes = ActorDamageHelper.getERDamageTypes();
    var damageTypesUnsorded = Array.from(CACHE.DamageTypes.values());
    sheetData.damageTypes = damageTypesUnsorded.sort((a, b) => (a.name > b.name ? 1 : b.name > a.name ? -1 : 0));
    sheetData.damageTypes.forEach((d) => {
      if (d.system.damageType === "energy") d.damageTypeString = game.i18n.localize("D35E.Energy");
      else if (d.system.isPiercing || d.system.isBludgeoning || d.system.isSlashing)
        d.damageTypeString = game.i18n.localize("D35E.Physical");
      else d.damageTypeString = game.i18n.localize("D35E.Other");
    });

    // Unidentified data
    if (this.item.showUnidentifiedData) {
      sheetData.itemName =
        foundry.utils.getProperty(this.item.system, "unidentified.name") || game.i18n.localize("D35E.Unidentified");
    } else {
      sheetData.itemName = foundry.utils.getProperty(this.item.system, "identifiedName") || this.item.name;
    }

    // Action Details
    sheetData.hasAttackRoll = this.item.hasAttack || sheetData.isSummonWeapon;
    sheetData.isHealing = this.item.system.actionType === "heal";
    sheetData.showCreatureSummons = this.item.system?.actionType === "summon";

    sheetData.isCharged = false;
    if (this.item.system.uses != null) {
      sheetData.isCharged = ["day", "week", "charges", "encounter"].includes(this.item.system.uses.per);
    }
    if (this.item.system.range != null) {
      sheetData.canInputRange = ["ft", "mi", "spec"].includes(this.item.system.range.units);
    }
    if (this.item.system.duration != null) {
      sheetData.canInputDuration = !["", "inst", "perm", "seeText"].includes(this.item.system.duration.units);
    }
    if (this.item.system.spellDurationData != null) {
      sheetData.canInputSpellDuration = !["", "inst", "perm", "seeText"].includes(
        this.item.system.spellDurationData.units
      );
    }

    sheetData.charges = this.item.charges;
    sheetData.maxCharges = this.item.maxCharges;
    sheetData.unmetRequirements = this.item.hasUnmetRequirements();

    sheetData.is07Xup = isMinimumCoreVersion("0.7.2");

    sheetData.availableContainers = {};
    sheetData.availableContainers["none"] = "None";

    sheetData.enriched = {};
    sheetData.enriched.description = {};
    sheetData.enriched.description.value = await foundry.applications.ux.TextEditor.enrichHTML(await this.item.getDescription(), {
      async: true,
      rollData: this.item.getActorItemRollData()
    });
    sheetData.enriched.description.unidentified = await foundry.applications.ux.TextEditor.enrichHTML(
      await this.item.getUnidentifiedDescription(),
      { async: true }
    );
    if (sheetData.isSpell || sheetData.isCard) {
      const spellPropertyData = await ItemSpellHelper.generateSpellDescription(this.item);
      sheetData.enriched.spellProperties = await foundry.applications.ux.TextEditor.enrichHTML(
        await foundry.applications.handlebars.renderTemplate("systems/warcraftrpg2e/templates/internal/spell-description.html", spellPropertyData)
      )
    }

    sheetData.material = this.item.system.material?.system;
    sheetData.materialMetadata = {
      name: this.item.system.material?.name,
      img: this.item.system.material?.img,
    };

    if (this.actor != null) {
      this.actor.items.forEach((i) => {
        if (i.type === "loot" && i.system.subType === "container") {
          sheetData.availableContainers[i.id] = i.name;
          this.containerMap.set(i._id, i);
        }
      });
    }

    // Prepare enhancement specific stuff
    if (this.item.type === "enhancement") {
      sheetData.enhancementTypes = { types: {}, subTypes: {} };
      for (let [k, v] of Object.entries(CONFIG.D35E.enhancementType)) {
        sheetData.enhancementTypes.types[k] = v;
      }

      sheetData.isWeaponEnhancement = this.item.system.enhancementType === "weapon";
      sheetData.isArmorEnhancement = this.item.system.enhancementType === "armor";
      sheetData.isMiscEnhancement = this.item.system.enhancementType === "misc";
    }

    // Prepare attack specific stuff
    if (this.item.type === "attack") {
      sheetData.isWeaponAttack = this.item.system.attackType === "weapon";
      sheetData.isNaturalAttack = this.item.system.attackType === "natural" || this.item.system.isNaturalEquivalent;
      if (this.item.actor) {
        sheetData.autoScaleWithBab =
          (game.settings.get("warcraftrpg2e", "autoScaleAttacksBab") &&
            this.item.actor.type !== "npc" &&
            foundry.utils.getProperty(this.item.system, "attackType") === "weapon" &&
            foundry.utils.getProperty(this.item.system, "autoScaleOption") !== "never") ||
          foundry.utils.getProperty(this.item.system, "autoScaleOption") === "always";
        if (sheetData.autoScaleWithBab) {
          const nonepicBab = Math.max(
            0,
            foundry.utils.getProperty(this.item.actor.system, "attributes.bab.nonepic") || 0,
          );
          const attacks = [];
          for (let k = 1; k <= Math.max(0, Math.floor((nonepicBab - 1) / 5)); k++) {
            attacks.push(-5 * k);
          }
          if (attacks.length) {
            sheetData.extraAttacksAuto = attacks.join("/");
          } else {
            sheetData.extraAttacksAuto = game.i18n.localize("D35E.NoExtraAttacks");
          }
        }
      } else {
        sheetData.notOnActor = true;
      }
      sheetData.weaponCategories = { types: {}, subTypes: {} };
      for (let [k, v] of Object.entries(CONFIG.D35E.weaponTypes)) {
        if (typeof v === "object") sheetData.weaponCategories.types[k] = v._label;
      }
      if (foundry.utils.hasProperty(CONFIG.D35E.weaponTypes, "martial")) {
        for (let [k, v] of Object.entries(CONFIG.D35E.weaponTypes["martial"])) {
          // Add static targets
          if (!k.startsWith("_")) sheetData.weaponCategories.subTypes[k] = v;
        }
      }
    }

    if (this.item.system.weight) {
      const conversion = game.settings.get("warcraftrpg2e", "units") === "metric" ? 0.5 : 1;
      sheetData.convertedWeight = this.item.system.weight * conversion;
    }

    if (this.item.system.capacity) {
      const conversion = game.settings.get("warcraftrpg2e", "units") === "metric" ? 0.5 : 1;
      sheetData.convertedCapacity = this.item.system.capacity * conversion;
    }

    // Prepare spell specific stuff
    if (this.item.type === "spell") {
      let spellbook = null;
      if (this.actor != null) {
        spellbook = foundry.utils.getProperty(this.actor.system, `attributes.spells.spellbooks.${this.item.system.spellbook}`);
      }

      sheetData.isPreparedSpell =
        spellbook != null && getSpellbookPreparationMode(spellbook) === SPELLBOOK_PREPARATION_MODE_PREPARED;
      sheetData.isAtWill = this.item.system.atWill;
      sheetData.spellbooks = {};
      if (this.item.actor) {
        sheetData.spellbooks = foundry.utils.duplicate(this.item.actor.system.attributes.spells.spellbooks);
      }

      // Enrich description
    }
    if (this.item.type === "card") {
      let spellbook = null;
      if (this.actor != null) {
        spellbook = foundry.utils.getProperty(this.actor.system, `attributes.cards.decks.${this.item.system.deck}`);
      }

      sheetData.isPreparedSpell = spellbook != null ? !spellbook.spontaneous : false;
      sheetData.isAtWill = this.item.system.atWill;
      sheetData.spellbooks = {};
      if (this.item.actor) {
        sheetData.spellbooks = foundry.utils.duplicate(this.item.actor.system.attributes.cards.decks);
      }

      // Enrich description
    }

    // Formula creator context defaults for spell-like fields (@cl, @sl, @ablMod).
    // These are pre-serialised to JSON strings so templates can safely output them with
    // {{{triple-stache}}} without triggering the Handlebars }}} CLOSE_UNESCAPED parse error
    // that occurs when inline {{value}}} ends a JSON object literal.
    let _spellCl = 10;
    let _spellSl = (this.item.system.level ?? 1) + (this.item.system.slOffset ?? 0);
    let _spellAblMod = 3;
    if ((sheetData.isSpellLike || sheetData.isCard) && this.actor) {
      if (this.item.type === "spell") {
        const sb = foundry.utils.getProperty(
          this.actor.system, `attributes.spells.spellbooks.${this.item.system.spellbook}`
        );
        if (sb) {
          _spellCl = (sb.cl?.total ?? 0) + (this.item.system.clOffset ?? 0);
          const ability = sb.ability ?? "";
          if (ability) {
            _spellAblMod = foundry.utils.getProperty(this.actor.system, `abilities.${ability}.mod`) ?? 3;
          }
        }
      } else if (this.item.type === "card") {
        const deck = foundry.utils.getProperty(
          this.actor.system, `attributes.cards.decks.${this.item.system.deck}`
        );
        if (deck) {
          _spellCl = (deck.cl?.total ?? 0) + (this.item.system.clOffset ?? 0);
          const ability = deck.ability ?? "";
          if (ability) {
            _spellAblMod = foundry.utils.getProperty(this.actor.system, `abilities.${ability}.mod`) ?? 3;
          }
        }
      }
    }
    // spellFormulaExtras: used on attackBonus, critConfirmBonus, alternativeParts, save.dc
    sheetData.spellFormulaExtras = JSON.stringify({ cl: _spellCl, sl: _spellSl, ablMod: _spellAblMod });
    // damagePrimaryExtras: always includes critMult; adds spell vars when spelllike
    sheetData.damagePrimaryExtras = sheetData.isSpellLike
      ? JSON.stringify({ critMult: 2, cl: _spellCl, sl: _spellSl, ablMod: _spellAblMod })
      : JSON.stringify({ critMult: 2, sizeDifference: 0 });

    if (this.item.type === "race") {
      sheetData.children = {
        spelllikes: [],
        abilities: [],
        traits: [],
        addedAbilities: [],
      };

      let alreadyAddedAbilities = new Set();

      {
        let spellLikes = game.packs.get("warcraftrpg2e.spelllike");
        let spellikeItems = [];
        await spellLikes.getIndex().then((index) => (spellikeItems = index));
        for (let entry of spellikeItems) {
          await spellLikes.getDocument(entry._id).then((e) => {
            if (e.system.tags.some((el) => el[0] === this.item.name)) {
              sheetData.children.spelllikes.push(e);
              this.childItemMap.set(entry._id, e);
            }
          });
        }
      }

      {
        for (let e of new Set(CACHE.RacialFeatures.get(this.item.name) || [])) {
          if (e.system.tags.some((el) => el[0] === this.item.name)) {
            sheetData.children.abilities.push({
              item: e,
              pack: e.pack,
              disabled: (this.item.system.disabledAbilities || []).some((obj) => obj.uid === e.system.uniqueId),
            });
            this.childItemMap.set(e._id, e);
          }
        }
      }

      for (let ability of this.item.system.addedAbilities || []) {
        let e = CACHE.AllAbilities.get(ability.uid);
        sheetData.children.addedAbilities.push({
          item: e,
          pack: e.pack,
        });
        if (e.system.uniqueId.indexOf("*" === -1)) alreadyAddedAbilities.add(e.system.uniqueId);
      }

      sheetData.allAbilities = [];
      for (var e of CACHE.AllAbilities.values()) {
        if (!alreadyAddedAbilities.has(e.system.uniqueId)) sheetData.allAbilities.push(e);
      }
    }

    sheetData.fieldList = Object.keys(foundry.utils.flattenObject(this.item.system));
    sheetData.fieldList.push("name"); // we add name field, it is custom handled but we need it
    // sort the field list
    sheetData.fieldList.sort();

    if (this.item.type === "buff") {
      sheetData.hasCombatChanges = true;
    }
    if (this.item.type === "aura") {
      sheetData.hasCombatChanges = true;
    }

    sheetData.itemType = this.item.type;

    // Prepare class specific stuff
    if (this.item.type === "class") {
      for (let [a, s] of Object.entries((sheetData.system ?? sheetData.data?.system)?.savingThrows ?? {})) {
        s.label = CONFIG.D35E.savingThrows[a];
      }
      for (let [a, s] of Object.entries(this.item.system.fc)) {
        s.label = CONFIG.D35E.favouredClassBonuses[a];
      }
      sheetData.powerPointLevels = {};
      Object.keys(this.item.system.powerPointTable).forEach((key) => {
        sheetData.powerPointLevels[key] = {
          value: this.item.system.powerPointTable[key],
          known: this.item.system.powersKnown !== undefined ? this.item.system.powersKnown[key] || 0 : 0,
          maxLevel: this.item.system.powersMaxLevel !== undefined ? this.item.system.powersMaxLevel[key] || 0 : 0,
        };
      });

      sheetData.powerPointBonusBaseAbility = this.item.system.powerPointBonusBaseAbility;
      sheetData.abilities = {};
      for (let [a, s] of Object.entries(CONFIG.D35E.abilities)) {
        sheetData.abilities[a] = {};
        sheetData.abilities[a].label = s;
      }
      sheetData.hasRequirements = true;
      sheetData.hasMaxLevel =
        this.item.system.maxLevel !== undefined &&
        this.item.system.maxLevel !== null &&
        this.item.system.maxLevel !== "" &&
        this.item.system.maxLevel !== 0;
      sheetData.isBaseClass = this.item.system.classType === "base";
      sheetData.isRacialHD = this.item.system.classType === "racial";
      sheetData.isTemplate = this.item.system.classType === "template";
      sheetData.isPsionSpellcaster = this.item.system.spellcastingType === "psionic";
      sheetData.isSpellcaster =
        this.item.system.spellcastingType !== undefined &&
        this.item.system.spellcastingType !== null &&
        this.item.system.spellcastingType !== "none";
      sheetData.isNonPsionSpellcaster = sheetData.isSpellcaster && !sheetData.isPsionSpellcaster;
      sheetData.warcraftAdvancementCandidates = this.actor
        ? this.actor.items
          .filter((item) => item.type === "class" && item.system?.classType === "base")
          .filter((item) => {
            const wanted = this.item.system?.warcraftSpellcastingAdvancement?.spellcastingType;
            return !wanted || item.system?.spellcastingType === wanted;
          })
          .map((item) => ({
            id: item.system?.customTag || item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            name: item.name,
          }))
        : [];
      sheetData.progression = [];
      sheetData.spellProgression = [];
      sheetData.knownSpellProgression = [];
      sheetData.childItemLevels = new Map();
      sheetData.children = {
        spelllikes: [],
        abilities: [],
        traits: [],
        addedAbilities: [],
      };
      let alreadyAddedAbilities = new Set();
      let alreadyAddedDescriptions = new Set();
      sheetData.abilitiesDescription = [];
      {
        for (let e of new Set(CACHE.ClassFeatures.get(this.item.name) || [])) {
          this.childItemMap.set(e._id, e);

          let levels = e.system.associations.classes.filter((el) => el[0] === this.item.name);
          for (let _level of levels) {
            const level = _level[1];
            if (!sheetData.childItemLevels.has(level)) {
              sheetData.childItemLevels.set(level, []);
            }
            let _e = {
              item: e,
              level: level,
              pack: e.pack,
              disabled: (this.item.system.disabledAbilities || []).some(
                (obj) => parseInt(obj.level || "0") === level && obj.uid === e.system.uniqueId
              ),
            };
            sheetData.children.abilities.push(_e);
            sheetData.childItemLevels.get(level).push(_e);
            if (e.system.uniqueId.indexOf("*") === -1) alreadyAddedAbilities.add(e.system.uniqueId);
            if (!_e.disabled && e.system.description.value !== "" && !alreadyAddedDescriptions.has(e._id)) {
              sheetData.abilitiesDescription.push({
                level: level,
                name: e.name,
                description: await foundry.applications.ux.TextEditor.enrichHTML(e.system.description.value, { rollData: e.getActorItemRollData() }),
              });
              alreadyAddedDescriptions.add(e._id);
            }
          }
        }

        for (let ability of this.item.system.addedAbilities || []) {
          let e = CACHE.AllAbilities.get(ability.uid);
          let _e = {};
          if (e) {
            _e = {
              item: e,
              level: ability.level,
              pack: e.pack,
            };
            sheetData.children.addedAbilities.push(_e);
            if (!sheetData.childItemLevels.has(ability.level)) {
              sheetData.childItemLevels.set(ability.level, []);
            }
            sheetData.childItemLevels.get(ability.level).push(_e);
            if (e.system.uniqueId.indexOf("*") === -1) alreadyAddedAbilities.add(e.system.uniqueId);
            if (e.system.description.value !== "" && !alreadyAddedDescriptions.has(e._id)) {
              sheetData.abilitiesDescription.push({
                level: ability.level,
                name: e.name,
                description: await foundry.applications.ux.TextEditor.enrichHTML(e.system.description.value, { rollData: e.getActorItemRollData() }),
              });
              alreadyAddedDescriptions.add(e._id);
            }
          } else {
            game.D35E.logger.warn("Missing", ability);
          }
        }
      }

      sheetData.allAbilities = [];
      for (var e of CACHE.AllAbilities.values()) {
        if (!alreadyAddedAbilities.has(e.system.uniqueId) || e.system.uniqueId.indexOf("*") !== -1)
          sheetData.allAbilities.push(e);
      }

      sheetData.spellbook = [];
      if (this.item.system.spellbook) {
        sheetData.spellbook = this.item.system.spellbook;
      }

      for (let level = 1; level < this.item.system.maxLevel + 1; level++) {
        let progressionData = {};
        let spellProgressionData = {};
        let knownSpellProgressionData = {};

        progressionData.level = level;
        spellProgressionData.level = level;
        knownSpellProgressionData.level = level;
        for (let a of ["fort", "ref", "will"]) {
          const classType = foundry.utils.getProperty(this.item.system, "classType") || "base";

          let formula =
            CONFIG.D35E.classSavingThrowFormulas[classType][this.item.system.savingThrows[a].value] != null
              ? CONFIG.D35E.classSavingThrowFormulas[classType][this.item.system.savingThrows[a].value]
              : "0";
          progressionData[a] = Math.floor(new Roll35e(formula, { level: level }).evaluateSync().total);
        }
        {
          const formula =
            CONFIG.D35E.classBABFormulas[this.item.system.bab] != null
              ? CONFIG.D35E.classBABFormulas[this.item.system.bab]
              : "0";
          let bab = Math.floor(new Roll35e(formula, { level: level }).evaluateSync().total);
          let babModifiers = [];
          while (bab > 0) {
            babModifiers.push("+" + bab);
            bab -= 5;
          }
          progressionData.bab = babModifiers.join("/");
        }
        progressionData.abilities = sheetData.childItemLevels.get(level);
        progressionData.hasNonActive = false;
        sheetData.progression.push(progressionData);
        sheetData.hasKnownSpells = false;
        if (sheetData.isSpellcaster) {
          for (let spellLevel = 0; spellLevel <= 9; spellLevel++) {
            if (
              foundry.utils.getProperty(this.item.system, "spellsPerLevel") !== undefined &&
              foundry.utils.getProperty(this.item.system, "spellsPerLevel")[level - 1]
            ) {
              let spellPerLevel = foundry.utils.getProperty(this.item.system, "spellsPerLevel")[level - 1][spellLevel + 1];
              spellProgressionData[`spells${spellLevel}`] =
                spellPerLevel !== undefined && parseInt(spellPerLevel) !== -1 ? spellPerLevel : "-";
            }
            if (
              foundry.utils.getProperty(this.item.system, "spellsKnownPerLevel") !== undefined &&
              foundry.utils.getProperty(this.item.system, "spellsKnownPerLevel")[level - 1]
            ) {
              let spellPerLevel = foundry.utils.getProperty(this.item.system, "spellsKnownPerLevel")[level - 1][spellLevel + 1];
              knownSpellProgressionData[`spells${spellLevel}`] =
                spellPerLevel !== undefined && parseInt(spellPerLevel) !== -1 ? spellPerLevel : "-";
              sheetData.hasKnownSpells = true;
            }
          }
          sheetData.spellProgression.push(spellProgressionData);
          sheetData.knownSpellProgression.push(knownSpellProgressionData);
        }
      }

      if (this.item.system.nonActiveClassAbilities !== undefined && this.item.system.nonActiveClassAbilities !== null) {
        for (const a of this.item.system.nonActiveClassAbilities) {
          if (a[0] !== 0) {
            if (sheetData.progression[a[0] - 1]["nonActive"] === undefined) {
              sheetData.progression[a[0] - 1]["nonActive"] = [];
              sheetData.progression[a[0] - 1].hasNonActive = true;
            }
            sheetData.progression[a[0] - 1]["nonActive"].push({ name: a[1], desc: a[2] });
          }
          if (a[2] !== "") {
            sheetData.abilitiesDescription.push({ level: a[0], name: a[1], description: await foundry.applications.ux.TextEditor.enrichHTML(a[2]) });
          }
        }
      }

      sheetData.abilitiesDescription.sort((a, b) => (a.level > b.level ? 1 : b.level > a.level ? -1 : 0));

      if (this.actor != null) {
        let healthConfig = game.settings.get("warcraftrpg2e", "healthConfig");
        sheetData.healthConfig = sheetData.isRacialHD
          ? healthConfig.hitdice.Racial
          : this.actor.type === "character"
            ? healthConfig.hitdice.PC
            : healthConfig.hitdice.NPC;
      } else sheetData.healthConfig = { auto: false };

      // Add skill list
      if (!this.item.actor) {
        sheetData.skills = Object.entries(CONFIG.D35E.skills).reduce((cur, o) => {
          cur[o[0]] = {
            name: o[1],
            classSkill: foundry.utils.getProperty(this.item.system, `classSkills.${o[0]}`) === true,
          };
          return cur;
        }, {});
      } else {
        sheetData.skills = Object.entries(this.item.actor.system.skills).reduce((cur, o) => {
          const key = o[0];
          const name = CONFIG.D35E.skills[key] != null ? CONFIG.D35E.skills[key] : o[1].name;
          cur[o[0]] = {
            name: name,
            classSkill: foundry.utils.getProperty(this.item.system, `classSkills.${o[0]}`) === true,
          };
          return cur;
        }, {});
      }
    }

    // Prepare stuff for attacks with conditionals
    if (this.item.system.conditionals) {
      sheetData.conditionals = foundry.utils.duplicate(this.item.system.conditionals);
      for (const conditional of sheetData.conditionals) {
        for (const modifier of conditional.modifiers) {
          modifier.targets = this.item.getConditionalTargets();
          modifier.subTargets = this.item.getConditionalSubTargets(modifier.target);
          modifier.conditionalModifierTypes = this.item.getConditionalModifierTypes(modifier.target);
          modifier.conditionalCritical = this.item.getConditionalCritical(modifier.target);
          modifier.isAttack = modifier.target === "attack";
          modifier.isDamage = modifier.target === "damage";
          modifier.isSpell = modifier.target === "spell";
        }
      }
    }

    sheetData.registeredTabs = [];
    this.sheetComponents.forEach((component) => {
      component.prepareSheetData(sheetData);
      component.registerTab(sheetData);
    });

    if (["weapon", "equipment"].includes(this.item.type)) {
      // Embedded / unmigrated items may lack `system.intelligent`; the Intelligent tab template
      // dereferences it (e.g. #select, #each powers) and would throw if undefined.
      if (!sheetData.data) {
        sheetData.data = this.item.toObject(false);
      }
      if (!sheetData.data.system) {
        sheetData.data.system = {};
      }
      sheetData.data.system.intelligent = foundry.utils.mergeObject(
        IntelligentItemHelper.defaultIntelligentShape(),
        sheetData.data.system.intelligent ?? {},
        { inplace: false },
      );
      if (!Array.isArray(sheetData.data.system.intelligent.powers)) {
        sheetData.data.system.intelligent.powers = [];
      }
      sheetData.intelligentEgo = IntelligentItemHelper.computeEgo(this.item);
      const _intScore = this.item.system?.intelligent?.int ?? 10;
      const _wisScore = this.item.system?.intelligent?.wis ?? 10;
      const _chaScore = this.item.system?.intelligent?.cha ?? 10;
      sheetData.intelligentScores = {
        int: { value: _intScore, mod: Math.floor((_intScore - 10) / 2) },
        wis: { value: _wisScore, mod: Math.floor((_wisScore - 10) / 2) },
        cha: { value: _chaScore, mod: Math.floor((_chaScore - 10) / 2) },
      };
      sheetData.intelligentLanguageCount = IntelligentItemHelper.languageCountFromInt(_intScore);
      const lesserOpts = await IntelligentItemHelper.getTableOptions("lesser");
      const greaterOpts = await IntelligentItemHelper.getTableOptions("greater");
      sheetData.intelligentLesserOptions = lesserOpts;
      sheetData.intelligentGreaterOptions = greaterOpts;
      // Cache for dynamic tier-change repopulation (no extra async calls needed)
      this._intelligentOptions = { lesser: lesserOpts, greater: greaterOpts };
    }

    return sheetData;
  }

  /* -------------------------------------------- */

  /**
   * Get the text item status which is shown beneath the Item type in the top-right corner of the sheet
   * @return {string}
   * @private
   */
  _getItemStatus(item) {
    if (item.type === "spell") {
      if (item.system.preparation.mode === "prepared") {
        return item.system.preparation.preparedAmount > 0
          ? game.i18n.localize("D35E.AmountPrepared").format(item.system.preparation.preparedAmount)
          : game.i18n.localize("D35E.Unprepared");
      } else if (item.system.preparation.mode) {
        return item.system.preparation.mode.titleCase();
      } else return "";
    } else if (["weapon", "equipment"].includes(item.type))
      return item.system.equipped ? game.i18n.localize("D35E.Equipped") : game.i18n.localize("D35E.NotEquipped");
  }

  /* -------------------------------------------- */

  /**
   * Get the Array of item properties which are used in the small sidebar of the description tab
   * @return {Array}
   * @private
   */
  _getItemProperties(item) {
    const props = [];
    const labels = this.item.labels;

    if (item.type === "weapon") {
      props.push(
        ...Object.entries(item.system.properties)
          .filter((e) => e[1] === true)
          .map((e) => CONFIG.D35E.weaponProperties[e[0]])
      );
    } else if (item.type === "spell") {
      props.push(labels.components, labels.materials);
    }

    if (item.type === "enhancement") {
      props.push(...Object.entries(item.system.allowedTypes).map((e) => e[1]));
    } else if (item.type === "equipment") {
      props.push(CONFIG.D35E.equipmentTypes[item.system.armor.type]);
      props.push(labels.armor);
    } else if (item.type === "feat") {
      props.push(labels.featType);
    }

    // Action type
    if (item.actionType) {
      props.push(CONFIG.D35E.itemActionTypes[item.system.actionType]);
    }

    // Action usage
    if (item.type !== "weapon" && item.system?.activation && !foundry.utils.isEmpty(item.system.activation)) {
      props.push(labels.activation, labels.range, labels.target, labels.duration);
    }

    // Tags
    if (foundry.utils.getProperty(item.system, "tags") != null) {
      props.push(
        ...foundry.utils.getProperty(item.system, "tags").map((o) => {
          return o[0];
        })
      );
    }

    return props.filter((p) => !!p);
  }

  /* -------------------------------------------- */

  setPosition(position = {}) {
    // if ( this._sheetTab === "details" ) position.height = "auto";
    return super.setPosition(position);
  }

  /* -------------------------------------------- */
  /*  Form Submission                             */

  /* -------------------------------------------- */

  /**
   * Extend the parent class _updateObject method to ensure that damage ends up in an Array
   * @private
   */
  _updateObject(event, formData) {
    // Handle Damage Array
    let damage = Object.entries(formData).filter((e) => e[0].startsWith("system.damage.parts"));
    formData["system.damage.parts"] = damage.reduce((arr, entry) => {
      let [i, j] = entry[0].split(".").slice(3);
      if (!arr[i]) arr[i] = [];
      arr[i][j] = entry[1];
      return arr;
    }, []);

    let altDamage = Object.entries(formData).filter((e) => e[0].startsWith("system.damage.alternativeParts"));
    formData["system.damage.alternativeParts"] = altDamage.reduce((arr, entry) => {
      let [i, j] = entry[0].split(".").slice(3);
      if (!arr[i]) arr[i] = [];
      arr[i][j] = entry[1];
      return arr;
    }, []);

    // Handle Attack Array
    let attacks = Object.entries(formData).filter((e) => e[0].startsWith("system.attackParts"));
    formData["system.attackParts"] = attacks.reduce((arr, entry) => {
      let [i, j] = entry[0].split(".").slice(2);
      if (!arr[i]) arr[i] = [];
      arr[i][j] = entry[1];
      return arr;
    }, []);

    // Handle AmmoDamageParts array (4-tuples: [formula, type, uid, mode])
    let ammoDmgParts = Object.entries(formData).filter((e) => e[0].startsWith("system.ammoDamageParts"));
    formData["system.ammoDamageParts"] = ammoDmgParts.reduce((arr, entry) => {
      let [i, j] = entry[0].split(".").slice(2);
      if (!arr[i]) arr[i] = [];
      arr[i][j] = entry[1];
      return arr;
    }, []);

    // Handle conditionals array
    let conditionals = Object.entries(formData).filter((e) => e[0].startsWith("system.conditionals"));
    formData["system.conditionals"] = conditionals.reduce((arr, entry) => {
      let [i, j, k] = entry[0].split(".").slice(2);
      if (!arr[i]) arr[i] = Item35E.defaultConditional;
      if (k) {
        const target = formData[`system.conditionals.${i}.${j}.target`];
        if (!arr[i].modifiers[j]) arr[i].modifiers[j] = Item35E.defaultConditionalModifier;
        arr[i].modifiers[j][k] = entry[1];
        // Target dependent keys
        if (["subTarget", "critical", "type"].includes(k)) {
          const target = (conditionals.find((o) => o[0] === `system.conditionals.${i}.${j}.target`) || [])[1];
          const val = entry[1];
          if (typeof target === "string") {
            let keys;
            switch (k) {
              case "subTarget":
                keys = Object.keys(this.item.getConditionalSubTargets(target));
                break;
              case "type":
                keys = Object.keys(this.item.getConditionalModifierTypes(target));
                break;
              case "critical":
                keys = Object.keys(this.item.getConditionalCritical(target));
                break;
            }
            // Reset subTarget, non-damage type, and critical if necessary
            if (!keys.includes(val) && target !== "damage" && k !== "type") arr[i].modifiers[j][k] = keys[0];
          }
        }
      } else {
        arr[i][j] = entry[1];
      }
      return arr;
    }, []);

    // Handle notes array
    let note = Object.entries(formData).filter((e) => e[0].startsWith("system.contextNotes"));
    formData["system.contextNotes"] = note.reduce((arr, entry) => {
      let [i, j] = entry[0].split(".").slice(2);
      if (!arr[i]) arr[i] = [];
      arr[i][j] = entry[1];
      return arr;
    }, []);

    let actions = Object.entries(formData).filter((e) => e[0].startsWith("system.specialActions"));
    formData["system.specialActions"] = actions.reduce((arr, entry) => {
      let [i, j] = entry[0].split(".").slice(2);
      if (!arr[i]) arr[i] = { name: "", action: "" };

      arr[i][j] = entry[1];
      return arr;
    }, []);

    let summon = Object.entries(formData).filter((e) => e[0].startsWith("system.summon"));
    formData["system.summon"] = summon.reduce((arr, entry) => {
      let [i, j] = entry[0].split(".").slice(2);
      if (!arr[i]) arr[i] = { name: "", id: "", pack: "", formula: "" };

      arr[i][j] = entry[1];
      return arr;
    }, []);

    let activateActions = Object.entries(formData).filter((e) => e[0].startsWith("system.activateActions"));
    formData["system.activateActions"] = activateActions.reduce((arr, entry) => {
      let [i, j] = entry[0].split(".").slice(2);
      if (!arr[i]) arr[i] = { name: "", action: "" };

      arr[i][j] = entry[1];
      return arr;
    }, []);

    let deactivateActions = Object.entries(formData).filter((e) => e[0].startsWith("system.deactivateActions"));
    formData["system.deactivateActions"] = deactivateActions.reduce((arr, entry) => {
      let [i, j] = entry[0].split(".").slice(2);
      if (!arr[i]) arr[i] = { name: "", action: "" };

      arr[i][j] = entry[1];
      return arr;
    }, []);

    let perRoundActions = Object.entries(formData).filter((e) => e[0].startsWith("system.perRoundActions"));
    formData["system.perRoundActions"] = perRoundActions.reduce((arr, entry) => {
      let [i, j] = entry[0].split(".").slice(2);
      if (!arr[i]) arr[i] = { name: "", action: "" };

      arr[i][j] = entry[1];
      return arr;
    }, []);

    // Powers are managed by IntelligentItemPowersSheetComponent via direct item.update() calls.
    // Strip any stale flat keys so the form doesn't overwrite the array.
    for (const key of Object.keys(formData)) {
      if (key.startsWith("system.intelligent.powers.")) delete formData[key];
    }

    // Update the Item

    if (this.containerMap.has(formData["system.containerId"])) {
      formData["system.container"] = this.containerMap.get(formData["system.containerId"]).name;
      formData["system.containerWeightless"] = this.containerMap.get(
        formData["system.containerId"]
      ).system.bagOfHoldingLike;
    } else {
      formData["system.container"] = "None";
      formData["system.containerWeightless"] = false;
    }

    this.sheetComponents.forEach((component) => {
      component.updateForm(formData);
    });

    //game.D35E.logger.log("IM IN _UPDATE OBJECT FIXING THINGS", formData)
    return super._updateObject(event, formData);
  }

  /* -------------------------------------------- */

  /**
   * Activate listeners for interactive item sheet events
   */
  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;

    const primaryTabGroup = { description: {}, configuration: {} };
    if (["weapon", "equipment"].includes(this.item.type)) primaryTabGroup.intelligent = {};
    const tabGroups = { primary: primaryTabGroup };
    this._altTabs = createTabs.call(this, html, tabGroups, this._altTabs);

    root.addEventListener("mousemove", (ev) => this._moveTooltips(ev));

    if (!this.options.editable) return;

    root.querySelectorAll("textarea").forEach(el => el.addEventListener("change", this._onSubmit.bind(this)));

    root.querySelectorAll("textarea").forEach(el => el.addEventListener("drop", this._onTextAreaDrop.bind(this)));

    root.querySelectorAll("shapechange").forEach(el => el.addEventListener("drop", this._onShapechangeDrop.bind(this)));

    root.querySelectorAll(".attack-control").forEach(el => el.addEventListener("click", this._onAttackControl.bind(this)));

    root.querySelectorAll(".custom-field-control").forEach(el => el.addEventListener("click", this._onCustomFieldControl.bind(this)));

    root.querySelectorAll(".special-control").forEach(el => el.addEventListener("click", this._onSpecialControl.bind(this)));
    root.querySelectorAll(".a-special-control").forEach(el => el.addEventListener("click", this._onActivateSpecialControl.bind(this)));
    root.querySelectorAll(".d-special-control").forEach(el => el.addEventListener("click", this._onDeactivateSpecialControl.bind(this)));
    root.querySelectorAll(".r-special-control").forEach(el => el.addEventListener("click", this._onPerRoundSpecialControl.bind(this)));

    root.querySelectorAll(".damage-control").forEach(el => el.addEventListener("click", this._onDamageControl.bind(this)));
    root.querySelectorAll(".damage-alt-control").forEach(el => el.addEventListener("click", this._onAltDamageControl.bind(this)));
    root.querySelectorAll(".ammo-damage-control").forEach(el => el.addEventListener("click", this._onAmmoDamageControl.bind(this)));

    root.querySelectorAll(".summons-control").forEach(el => el.addEventListener("click", this._onSummonControl.bind(this)));

    root.querySelectorAll(".context-note-control").forEach(el => el.addEventListener("click", this._onNoteControl.bind(this)));

    if (["weapon"].includes(this.item.type) && this.item.actor != null && !this.item.showUnidentifiedData) {
      const toggleString =
        "<a style='color: white; text-decoration: none' class='header-button companion-view-button' title='" +
        game.i18n.localize("D35E.CreateAttack") +
        "'><i class='fa fa-feather-alt'></i>" +
        game.i18n.localize("D35E.CreateAttack") +
        "</a>";
      const appElRaw = root.closest(".app");
      const appEl = appElRaw?.nodeType === 1 ? appElRaw : appElRaw?.[0] ?? appElRaw;
      if (appEl) {
        appEl.querySelectorAll(".companion-view-button").forEach((el) => el.remove());
        const titleElement = appEl.querySelector(".window-title");
        if (titleElement) {
          titleElement.insertAdjacentHTML("afterend", toggleString);
          const toggleButton = titleElement.nextElementSibling;
          toggleButton?.addEventListener("click", this._createAttack.bind(this));
        }
      }
    }

    root.querySelectorAll(".conditional-control").forEach(el => el.addEventListener("click", this._onConditionalControl.bind(this)));

    root.querySelectorAll(".entry-selector").forEach(el => el.addEventListener("click", this._onEntrySelector.bind(this)));

    root.querySelectorAll(".item .child-item h4").forEach(el => el.addEventListener("click", (event) => this._onChildItemSummary(event)));
    root.querySelectorAll(".item a.disable-ability").forEach(el => el.addEventListener("click", (event) => this._onDisableAbility(event)));
    root.querySelectorAll(".item a.enable-ability").forEach(el => el.addEventListener("click", (event) => this._onEnableAbility(event)));
    root.querySelectorAll(".item a.delete-ability").forEach(el => el.addEventListener("click", (event) => this._onDeleteAbility(event)));
    root.querySelectorAll(".item a.add-ability").forEach(el => el.addEventListener("click", (event) => this._onAddAbility(event)));
    root.querySelectorAll(".item .change-class-ability-level").forEach(el => el.addEventListener("change", this._onAbilityLevelChange.bind(this)));

    root.querySelectorAll(".view-details-material").forEach(el => el.addEventListener("click", (event) => this._onMaterialItemSummary(event)));

    let handler = (ev) => this._onDragStart(ev);
    root.querySelectorAll("li.item").forEach((li) => {
      if (li.classList.contains("inventory-header")) return;
      li.setAttribute("draggable", true);
      li.addEventListener("dragstart", handler, false);
    });

    root.querySelectorAll(".full-attack").forEach(el => el.addEventListener("drop", this._onDropFullAttack.bind(this)));
    root.querySelectorAll(".full-attack-control.full-attack-delete").forEach(el => el.addEventListener("click", (event) => this._onDeleteFullAttack(event)));

    root.querySelectorAll(".spell").forEach(el => el.addEventListener("drop", this._onDropSpell.bind(this)));
    root.querySelectorAll(".special-actions").forEach(el => el.addEventListener("drop", this._onDropBuff.bind(this)));
    root.querySelectorAll(".charge-link").forEach(el => el.addEventListener("drop", this._onDropChargeLink.bind(this)));
    root.querySelectorAll(".remove-charge-link").forEach(el => el.addEventListener("click", (event) => this._onRemoveChargeLink(event)));
    root.querySelectorAll(".summons").forEach(el => el.addEventListener("drop", this._onDropSummomnRolltableLink.bind(this)));
    root.querySelectorAll(".rolltable-link").forEach(el => el.addEventListener("drop", this._onDropRolltableLink.bind(this)));
    root.querySelectorAll(".remove-rolltable-link").forEach(el => el.addEventListener("click", (event) => this._onRemoveRolltableLink(event)));

    root.querySelectorAll(".spellbook").forEach(el => el.addEventListener("drop", this._onDropSpellListSpell.bind(this)));
    root.querySelectorAll('div[data-tab="spellbook"] .item-delete').forEach(el => el.addEventListener("click", this._onSpellListSpellDelete.bind(this)));
    root.querySelectorAll('div[data-tab="spellbook"] .item-add').forEach(el => el.addEventListener("click", this._addSpellListSpellToSpellbook.bind(this)));

    root.querySelectorAll(".search-list").forEach(el => el.addEventListener("change", (event) => event.stopPropagation()));

    root.querySelectorAll("li.conditional").forEach((li) => {
      li.setAttribute("draggable", true);
      li.addEventListener("dragstart", (ev) => this._onDragConditionalStart(ev), false);
    });

    root.querySelectorAll('div[data-tab="conditionals"]').forEach(el => el.addEventListener("drop", this._onConditionalDrop.bind(this)));

    root.querySelectorAll(".generate-uid").forEach(el => el.addEventListener("click", (event) => this._onGenerateUid(event)));

    this.sheetComponents.forEach((component) => {
      component.activateListeners(html);
    });

    if (["weapon", "equipment"].includes(this.item.type)) {
      root.querySelectorAll(".intelligent-item-control").forEach((el) => {
        el.addEventListener("click", this._onIntelligentItemControl.bind(this));
      });
      const tierPicker = root.querySelector(".intelligent-tier-picker");
      if (tierPicker) {
        // Populate the power picker for the initially-selected tier
        this._repopulatePowerPicker(root, tierPicker.value);
        tierPicker.addEventListener("change", (ev) => {
          this._repopulatePowerPicker(root, ev.currentTarget.value);
        });
      }
    }

    injectFormulaCreatorButtons(root, this);
  }

  /* -------------------------------------------- */

  _moveTooltips(event) {
    event.currentTarget.querySelectorAll(".tooltip:hover .tooltipcontent").forEach(el => {
      el.style.left = `${event.clientX}px`;
      el.style.top = `${event.clientY + 24}px`;
    });
  }

  _onTextAreaDrop(event) {
    event.preventDefault();
    const elem = event.currentTarget;
  }

  /**
   * Add or remove a damage part from the damage formula
   * @param {Event} event     The original click event
   * @return {Promise}
   * @private
   */
  async _onDamageControl(event) {
    event.preventDefault();
    const a = event.currentTarget;

    // Add new damage component
    if (a.classList.contains("add-damage")) {
      await this._onSubmit(event);
      const damage = this.item.system.damage;
      return this.item.update({ "system.damage.parts": damage.parts.concat([["", ""]]) });
    }

    // Remove a damage component
    if (a.classList.contains("delete-damage")) {
      await this._onSubmit(event);
      const li = a.closest(".damage-part");
      const damage = foundry.utils.duplicate(this.item.system.damage);
      damage.parts.splice(Number(li.dataset.damagePart), 1);
      return this.item.update({ "system.damage.parts": damage.parts });
    }
  }

  /**
   * Add or remove a alternativedamage part from the damage formula
   * @param {Event} event     The original click event
   * @return {Promise}
   * @private
   */
  async _onAltDamageControl(event) {
    event.preventDefault();
    const a = event.currentTarget;

    // Add new damage component
    if (a.classList.contains("add-alt-damage")) {
      await this._onSubmit(event);
      const damage = this.item.system.damage;
      return this.item.update({ "system.damage.alternativeParts": (damage.alternativeParts || []).concat([["", ""]]) });
    }

    // Remove a damage component
    if (a.classList.contains("delete-alt-damage")) {
      await this._onSubmit(event);
      const li = a.closest(".damage-part");
      const damage = foundry.utils.duplicate(this.item.system.damage);
      damage.alternativeParts.splice(Number(li.dataset.damagePart), 1);
      return this.item.update({ "system.damage.alternativeParts": damage.alternativeParts });
    }
  }

  /**
   * Add, remove, or toggle the mode of an ammo damage part
   * @param {Event} event
   * @return {Promise}
   * @private
   */
  async _onAmmoDamageControl(event) {
    event.preventDefault();
    const a = event.currentTarget;

    if (a.classList.contains("add-ammo-damage")) {
      await this._onSubmit(event);
      const parts = foundry.utils.duplicate(this.item.system.ammoDamageParts || []);
      return this.item.update({ "system.ammoDamageParts": parts.concat([["", "", "", "replace"]]) });
    }

    if (a.classList.contains("delete-ammo-damage")) {
      await this._onSubmit(event);
      const li = a.closest(".ammo-damage-part");
      const parts = foundry.utils.duplicate(this.item.system.ammoDamageParts || []);
      parts.splice(Number(li.dataset.ammoDamagePart), 1);
      return this.item.update({ "system.ammoDamageParts": parts });
    }

    if (a.classList.contains("toggle-ammo-damage-mode")) {
      await this._onSubmit(event);
      const li = a.closest(".ammo-damage-part");
      const parts = foundry.utils.duplicate(this.item.system.ammoDamageParts || []);
      const idx = Number(li.dataset.ammoDamagePart);
      parts[idx][3] = parts[idx][3] === "replace" ? "add" : "replace";
      return this.item.update({ "system.ammoDamageParts": parts });
    }
  }

  generateId() {
    return "_" + Math.random().toString(36).substr(2, 9);
  }

  async _onCustomFieldControl(event) {
    event.preventDefault();
    const a = event.currentTarget;

    // Add new attack component
    if (a.classList.contains("add")) {
      await this._onSubmit(event);
      let _customAttributes = foundry.utils.duplicate(this.item.system.customAttributes || {});
      let newAttribute = { id: this.generateId(), name: "", value: "" };
      _customAttributes[newAttribute.id] = newAttribute;
      //game.D35E.logger.log(`Adding custom attribute | `,_customAttributes)
      return this.item.update({ "system.customAttributes": _customAttributes });
    }

    // Remove an attack component
    if (a.classList.contains("delete")) {
      await this._onSubmit(event);
      const li = a.closest(".custom-field");
      //game.D35E.logger.log(`Removing custom attribute | ${li.dataset.customField}`, this.item.system.customAttributes)
      const updateData = {};
      updateData[`system.customAttributes.-=${li.dataset.customField}`] = null;
      return this.item.update(updateData);
    }
  }

  async _onAttackControl(event) {
    event.preventDefault();
    const a = event.currentTarget;

    // Add new attack component
    if (a.classList.contains("add-attack")) {
      await this._onSubmit(event);
      const attackParts = this.item.system.attackParts;
      return this.item.update({ "system.attackParts": attackParts.concat([["", ""]]) });
    }

    // Remove an attack component
    if (a.classList.contains("delete-attack")) {
      await this._onSubmit(event);
      const li = a.closest(".attack-part");
      const attackParts = foundry.utils.duplicate(this.item.system.attackParts);
      attackParts.splice(Number(li.dataset.attackPart), 1);
      return this.item.update({ "system.attackParts": attackParts });
    }
  }

  async _onSummonControl(event) {
    event.preventDefault();
    const a = event.currentTarget;

    // Remove an attack component
    if (a.classList.contains("delete-summons")) {
      await this._onSubmit(event);
      const li = a.closest(".summons-part");
      const summons = foundry.utils.duplicate(this.item.system.summon);
      summons.splice(Number(li.dataset.summons), 1);
      return this.item.update({ "system.summon": summons });
    }
  }

  async _onSpecialControl(event) {
    event.preventDefault();
    const a = event.currentTarget;
    // Add new attack component
    if (a.classList.contains("add-special")) {
      await this._onSubmit(event);
      let specialActions = this.item.system.specialActions;
      if (specialActions === undefined) specialActions = [];
      return this.item.update({
        "system.specialActions": specialActions.concat([
          [
            {
              name: "",
              action: "",
              range: "",
              img: "",
              condition: "",
            },
          ],
        ]),
      });
    }
    if (a.classList.contains("add-special-template")) {
      await this._onSubmit(event);
      return this._addSpecialActionDialog(event)
    }

    // Remove an attack component
    if (a.classList.contains("delete-special")) {
      await this._onSubmit(event);
      const li = a.closest(".special-part");
      const specialActions = foundry.utils.duplicate(this.item.system.specialActions);
      specialActions.splice(Number(li.dataset.specialActions), 1);
      return this.item.update({ "system.specialActions": specialActions });
    }
  }

  async _onActivateSpecialControl(event) {
    event.preventDefault();
    const a = event.currentTarget;
    // Add new attack component
    if (a.classList.contains("add-special")) {
      await this._onSubmit(event);
      let activateActions = this.item.system.activateActions;
      if (activateActions === undefined) activateActions = [];
      return this.item.update({
        "system.activateActions": activateActions.concat([
          [
            {
              name: "",
              action: "",
              range: "",
              img: "",
              condition: "",
            },
          ],
        ]),
      });
    }

    // Remove an attack component
    if (a.classList.contains("delete-special")) {
      await this._onSubmit(event);
      const li = a.closest(".special-part");
      const activateActions = foundry.utils.duplicate(this.item.system.activateActions);
      activateActions.splice(Number(li.dataset.activateActions), 1);
      return this.item.update({ "system.activateActions": activateActions });
    }
  }

  /**
   * Adds or removes per round action from buffs.
   * Available for item type: Buff
   * @private
   */
  async _onPerRoundSpecialControl(event) {
    event.preventDefault();
    const a = event.currentTarget;
    // Add new attack component
    if (a.classList.contains("add-special")) {
      await this._onSubmit(event);
      let perRoundActions = this.item.system.perRoundActions;
      if (perRoundActions === undefined) perRoundActions = [];
      return this.item.update({
        "system.perRoundActions": perRoundActions.concat([
          [
            {
              name: "",
              action: "",
              range: "",
              img: "",
              condition: "",
            },
          ],
        ]),
      });
    }

    // Remove an attack component
    if (a.classList.contains("delete-special")) {
      await this._onSubmit(event);
      const li = a.closest(".special-part");
      const perRoundActions = foundry.utils.duplicate(this.item.system.perRoundActions);
      perRoundActions.splice(Number(li.dataset.perRoundActions), 1);
      return this.item.update({ "system.perRoundActions": perRoundActions });
    }
  }

  async _onDeactivateSpecialControl(event) {
    event.preventDefault();
    const a = event.currentTarget;
    // Add new attack component
    if (a.classList.contains("add-special")) {
      await this._onSubmit(event);
      let deactivateActions = this.item.system.deactivateActions;
      if (deactivateActions === undefined) deactivateActions = [];
      return this.item.update({
        "system.deactivateActions": deactivateActions.concat([
          [
            {
              name: "",
              action: "",
              range: "",
              img: "",
              condition: "",
            },
          ],
        ]),
      });
    }

    // Remove an attack component
    if (a.classList.contains("delete-special")) {
      await this._onSubmit(event);
      const li = a.closest(".special-part");
      const deactivateActions = foundry.utils.duplicate(this.item.system.deactivateActions);
      deactivateActions.splice(Number(li.dataset.deactivateActions), 1);
      return this.item.update({ "system.deactivateActions": deactivateActions });
    }
  }

  async _onNoteControl(event) {
    event.preventDefault();
    const a = event.currentTarget;

    // Add new note
    if (a.classList.contains("add-note")) {
      //await this._onSubmit(event);
      const contextNotes = foundry.utils.duplicate(this.item.system.contextNotes) || [];
      return this.item.update({ "system.contextNotes": contextNotes.concat([["", "", "", 0]]) });
    }

    // Remove a note
    if (a.classList.contains("delete-note")) {
      //await this._onSubmit(event);
      const li = a.closest(".context-note");
      const contextNotes = foundry.utils.duplicate(this.item.system.contextNotes);
      contextNotes.splice(Number(li.dataset.note), 1);
      return this.item.update({ "system.contextNotes": contextNotes });
    }
  }

  async _onShapechangeDrop(event) { }

  async _createAttack(event) {
    event.preventDefault();
    if (this.item.actor == null) throw new Error(game.i18n.localize("D35E.ErrorItemNoOwner"));

    //await this._onSubmit(event);

    return this.item.parent.createAttackFromWeapon(this.item);
  }

  _onEntrySelector(event) {
    event.preventDefault();
    const a = event.currentTarget;
    const options = {
      name: a.getAttribute("for"),
      isProgression: a.getAttribute("data-progression"),
      title: a.innerText,
      fields: a.dataset.fields,
      dtypes: a.dataset.dtypes,
    };
    new EntrySelector(this.item, options).render(true);
  }

  async saveMCEContent(updateData = null) {
    let manualUpdate = false;
    if (updateData == null) {
      manualUpdate = true;
      updateData = {};
    }

    for (const [key, editor] of Object.entries(this.editors ?? {})) {
      if (editor.mce == null) continue; // ProseMirror editors auto-save; skip them
      updateData[key] = editor.mce.getContent();
    }

    if (manualUpdate && Object.keys(updateData).length > 0) await this.item.update(updateData);
  }

  async _onAbilityLevelChange(event) {
    event.preventDefault();
    let li = event.currentTarget.closest(".item-box"),
      uid = li.getAttribute("data-item-uid"),
      level = li.getAttribute("data-item-level"),
      pack = li.getAttribute("data-pack");

    let updateData = {};
    const value = Number(event.currentTarget.value);
    let _addedAbilities = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `addedAbilities`) || []);
    let canChange = true;
    let foundAtSameLevel = 0;
    _addedAbilities
      .filter(function (obj) {
        return obj.uid === uid && (level === "" || parseInt(obj.level) === parseInt(level));
      })
      .forEach((i) => {
        i.level = value;
      });
    _addedAbilities.forEach(ability => {
      if (ability.uid === uid && ability.level === value) {
        foundAtSameLevel++;
      }
    })
    canChange = foundAtSameLevel < 2;
    if (canChange) {
      updateData[`system.addedAbilities`] = _addedAbilities;
      return this.item.update(updateData);
    } else {
      // Display warning
      ui.notifications.warn(game.i18n.localize("D35E.WarningAbilityLevelChange"));
      this.render(true);
    }
  }

  async _onAddAbility(event) {
    event.preventDefault();
    let li = event.currentTarget.closest(".item-box"),
      uid = li.getAttribute("data-item-uid"),
      level = li.getAttribute("data-item-level"),
      pack = li.getAttribute("data-pack");

    let updateData = {};
    let _addedAbilities = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `addedAbilities`) || []);
    let newAbility = { uid: uid, level: 1 };
    _addedAbilities.forEach(ability => {
      if (ability.uid === uid) {
        newAbility.level = Math.max(newAbility.level, ability.level + 1);
      }
    })
    _addedAbilities.push(newAbility);
    updateData[`system.addedAbilities`] = _addedAbilities;
    await this.item.update(updateData);
  }

  async _onDeleteAbility(event) {
    event.preventDefault();
    let li = event.currentTarget.closest(".item-box"),
      uid = li.getAttribute("data-item-uid"),
      level = li.getAttribute("data-item-level"),
      pack = li.getAttribute("data-pack");

    let updateData = {};
    let _addedAbilities = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `addedAbilities`) || []);
    _addedAbilities = _addedAbilities.filter(function (obj) {
      return !(obj.uid === uid && (level === "" || parseInt(obj.level) === parseInt(level)));
    });
    updateData[`system.addedAbilities`] = _addedAbilities;
    await this.item.update(updateData);
  }
  async _onEnableAbility(event) {
    event.preventDefault();
    let li = event.currentTarget.closest(".item-box"),
      uid = li.getAttribute("data-item-uid"),
      level = li.getAttribute("data-item-level"),
      pack = li.getAttribute("data-pack");

    let updateData = {};
    let _disabledAbilities = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `disabledAbilities`) || []);
    _disabledAbilities = _disabledAbilities.filter(function (obj) {
      return !(obj.uid === uid && (level === "" || parseInt(obj.level) === parseInt(level)));
    });
    updateData[`system.disabledAbilities`] = _disabledAbilities;
    await this.item.update(updateData);
  }

  async _onDisableAbility(event) {
    event.preventDefault();
    let li = event.currentTarget.closest(".item-box"),
      uid = li.getAttribute("data-item-uid"),
      level = li.getAttribute("data-item-level"),
      pack = li.getAttribute("data-pack");
    let updateData = {};
    let _disabledAbilities = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `disabledAbilities`) || []);
    _disabledAbilities.push({ uid: uid, level: level });
    updateData[`system.disabledAbilities`] = _disabledAbilities;
    await this.item.update(updateData);
  }

  _onChildItemSummary(event) {
    event.preventDefault();
    let li = event.currentTarget.closest(".item-box"),
      item = CACHE.AllAbilities.get(li.getAttribute("data-item-uid")),
      pack = this.childItemMap.get(li.getAttribute("data-pack"));

    item.sheet.render(true);
  }

  _onMaterialItemSummary(event) {
    event.preventDefault();
    let li = event.currentTarget.closest(".item-box"),
      materialData = this.item.system.material?.system,
      item = CACHE.Materials.get(materialData.uniqueId),
      pack = this.childItemMap.get(li.getAttribute("data-pack"));

    item.sheet.render(true);
  }

  _onDragStart(event) {
    // Get the Compendium pack
    const li = event.currentTarget;
    const packName = li.getAttribute("data-pack");
    const pack = game.packs.get(packName);
    // //game.D35E.logger.log(event)
    if (!pack) return;
    // Set the transfer data
    event.dataTransfer.setData(
      "text/plain",
      JSON.stringify({
        type: pack.documentName,
        pack: pack.collection,
        id: li.getAttribute("data-item-id"),
      })
    );
  }

  async _onDropFullAttack(event) {
    event.preventDefault();
    let attackId = event.currentTarget.getAttribute("data-attack");
    let droppedData;

    try {
      droppedData = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (droppedData.type !== "Item") return;
    } catch (err) {
      return false;
    }
    let droppedItem = await fromUuid(droppedData.uuid);
    if (droppedItem.parent.uuid !== this.actor.uuid) {
      return ui.notifications.warn(game.i18n.localize("D35E.FullAttackNeedDropFromActor"));
    }
    if (droppedData.type === "Item" && droppedItem?.type === "attack") {
      let updateData = {};
      updateData[`system.attacks.${attackId}.id`] = droppedItem._id;
      updateData[`system.attacks.${attackId}.name`] = droppedItem.name;
      updateData[`system.attacks.${attackId}.img`] = droppedItem.img;
      updateData[`system.attacks.${attackId}.count`] = 1;
      updateData[`system.attacks.${attackId}.primary`] =
        droppedItem.system.attackType === "natural" && droppedItem.system.primaryAttack;
      updateData[`system.attacks.${attackId}.isWeapon`] = droppedItem.system.attackType === "weapon";
      this.item.update(updateData);
    }
  }

  async _onDeleteFullAttack(event) {
    event.preventDefault();

    let elem = event.currentTarget.closest(".full-attack");
    let attackId = elem.getAttribute("data-attack");
    let updateData = {};
    updateData[`system.attacks.${attackId}.id`] = null;
    updateData[`system.attacks.${attackId}.name`] = null;
    updateData[`system.attacks.${attackId}.img`] = null;
    updateData[`system.attacks.${attackId}.count`] = 0;
    updateData[`system.attacks.${attackId}.primary`] = false;
    updateData[`system.attacks.${attackId}.isWeapon`] = false;
    this.item.update(updateData);
  }

  async _onRemoveChargeLink(event) {
    let updateData = {};

    updateData[`system.linkedChargeItem.id`] = null;
    updateData[`system.linkedChargeItem.name`] = null;
    updateData[`system.linkedChargeItem.img`] = null;
    this.item.update(updateData);
  }

  async _onRemoveRolltableLink(event) {
    let updateData = {};
    updateData[`system.rollTableDraw.id`] = null;
    updateData[`system.rollTableDraw.name`] = null;
    updateData[`system.rollTableDraw.pack`] = null;
    this.item.update(updateData);
  }

  async _onDropChargeLink(event) {
    event.preventDefault();
    let droppedData;

    try {
      droppedData = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (droppedData.type !== "Item") return;
    } catch (err) {
      return false;
    }

    let droppedItem = await fromUuid(droppedData.uuid);
    if (droppedItem.parent.uuid !== this.actor.uuid) {
      return ui.notifications.warn(game.i18n.localize("D35E.FullAttackNeedDropFromActor"));
    }
    if (droppedData.type === "Item" && droppedItem?.system?.uses?.canBeLinked && droppedItem?.system?.uses?.max) {
      let updateData = {};

      updateData[`system.linkedChargeItem.id`] = droppedItem.system.uniqueId
        ? droppedItem.system.uniqueId
        : droppedItem._id;
      updateData[`system.linkedChargeItem.name`] = droppedItem.name;
      updateData[`system.linkedChargeItem.img`] = droppedItem.img;
      this.item.update(updateData);
    }
    if (!droppedItem?.system?.uses?.canBeLinked) {
      return ui.notifications.warn(game.i18n.localize("D35E.ResourceMustBeSetAsLinkable"));
    }
  }

  async _onDropSummomnRolltableLink(event) {
    event.preventDefault();
    let droppedData;
    try {
      droppedData = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (droppedData.type !== "RollTable") return;
    } catch (err) {
      return false;
    }

    let dataType = "";
    if (droppedData.type === "RollTable") {
      let itemData = {};
      let droppedItem = await fromUuid(droppedData.uuid);
      if (droppedItem.pack) {
        let updateData = {};
        dataType = "compendium";
        const pack = game.packs.find((p) => p.metadata.id === droppedItem.pack);
        const packItem = droppedItem;
        if (packItem != null) {
          let summons = foundry.utils.duplicate(this.item.system.summon);
          if (summons === undefined || summons.rollTables !== undefined) summons = [];
          summons = summons.concat([
            {
              name: packItem.name,
              id: packItem.id,
              pack: droppedItem.pack,
              formula: "",
            },
          ]);
          await this.item.update({
            "system.summon": summons,
          });
        }
      } else {
        return ui.notifications.warn(game.i18n.localize("D35E.ResourceNeedDropFromCompendium"));
      }
    }
  }

  async _onDropRolltableLink(event) {
    event.preventDefault();
    let droppedData;

    try {
      droppedData = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (droppedData.type !== "RollTable") return;
    } catch (err) {
      return false;
    }

    let droppedItem = await fromUuid(droppedData.uuid);
    if (!droppedItem.pack) {
      return ui.notifications.warn(game.i18n.localize("D35E.ResourceNeedDropFromCompendium"));
    }
    if (droppedData.type === "RollTable") {
      let updateData = {};
      let rt = droppedItem;
      updateData[`system.rollTableDraw.id`] = rt.id;
      updateData[`system.rollTableDraw.pack`] = rt.pack;
      updateData[`system.rollTableDraw.name`] = rt.name;
      this.item.update(updateData);
    }
  }

  async _onDropSpellListSpell(event) {
    event.preventDefault();
    let spellLevel = event.currentTarget.getAttribute("data-spell-level");
    let droppedData;
    try {
      droppedData = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (droppedData.type !== "Item") return;
    } catch (err) {
      return false;
    }

    let dataType = "";

    if (droppedData.type === "Item") {
      let itemData = {};

      let droppedItem = await fromUuid(droppedData.uuid);
      if (droppedItem.pack) {
        if (droppedItem != null) {
          let spell = {
            id: droppedItem.id,
            pack: droppedItem.pack,
            name: droppedItem.name,
            img: droppedItem.img,
            uuid: droppedData.uuid,
          };
          this.item.addSpellToClassSpellbook(spellLevel, spell);
        }
      }
    }
  }

  /**
   * Handle deleting an existing Enhancement item
   * @param {Event} event   The originating click event
   * @private
   */
  async _onSpellListSpellDelete(event) {
    event.preventDefault();

    const button = event.currentTarget;
    if (button.disabled) return;

    const li = event.currentTarget.closest(".item");
    if (game.keyboard.isModifierActive("Shift")) {
      this.item.deleteSpellFromClassSpellbook(li.dataset.level, li.dataset.itemId);
    } else {
      button.disabled = true;

      const msg = `<p>${game.i18n.localize("D35E.DeleteItemConfirmation")}</p>`;
      Dialog.confirm({
        title: game.i18n.localize("D35E.DeleteItem"),
        content: msg,
        yes: () => {
          this.item.deleteSpellFromClassSpellbook(li.dataset.level, li.dataset.itemId);
          button.disabled = false;
        },
        no: () => (button.disabled = false),
      });
    }
  }

  async _addSpellListSpellToSpellbook(event) {
    event.preventDefault();
    const li = event.currentTarget.closest(".item");
    await this.item.parent.addSpellFromSpellListToSpellbook(li.dataset.level, li.dataset.itemId, li.dataset.itemPack);
  }

  async _onDropSpell(event) {
    event.preventDefault();
    let spellLevel = event.currentTarget.getAttribute("data-spell");
    let droppedData;
    try {
      droppedData = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (droppedData.type !== "Item") return;
    } catch (err) {
      return false;
    }

    let dataType = "";

    if (droppedData.type === "Item") {
      let droppedItem = await fromUuid(droppedData.uuid);
      let itemData = {};
      if (droppedItem.pack) {
        let updateData = {};
        const packItem = droppedItem;
        if (packItem != null) {
          updateData[`system.spellSpecialization.spells.${spellLevel}.id`] = droppedItem._id;
          updateData[`system.spellSpecialization.spells.${spellLevel}.pack`] = droppedItem.pack;
          updateData[`system.spellSpecialization.spells.${spellLevel}.name`] = packItem.name;
          updateData[`system.spellSpecialization.spells.${spellLevel}.img`] = packItem.img;
          this.item.update(updateData);
        }
      }
    }
  }

  async _onDropBuff(event) {
    event.preventDefault();
    let droppedData;
    try {
      droppedData = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (droppedData.type !== "Item") return;
    } catch (err) {
      return false;
    }
    let target = "target";
    if (this.item.system?.target?.value === "self") target = "self";
    if (droppedData.type === "Item") {
      let droppedItem = await fromUuid(droppedData.uuid);
      if (droppedItem.pack) {
        const packItem = droppedItem;
        if (packItem != null && packItem.type === "buff") {
          const buffLevel = this.item.type === "spell" ? "max(1,(@cl))" : "1";
          let buffString = `Create unique "${packItem.name}" from "${droppedItem.pack}" on ${target};Set buff "${packItem.name}" field data.level to ${buffLevel} on ${target};Activate buff "${packItem.name}" on ${target}`;

          let specialActions = foundry.utils.duplicate(this.item.system.specialActions);
          if (specialActions === undefined) specialActions = [];
          specialActions = specialActions.concat([
            {
              name: packItem.name,
              action: buffString,
              range: "",
              img: packItem.img,
              condition: "",
            },
          ]);
          await this.item.update({
            "system.specialActions": specialActions,
          });
        }
      } else {
        return ui.notifications.warn(game.i18n.localize("D35E.ResourceNeedDropFromCompendium"));
      }
    }
  }

  _onDragConditionalStart(event) {
    const elem = event.currentTarget;
    const conditional = this.object.system.conditionals[elem.dataset?.conditional];
    event.dataTransfer.setData("text/plain", JSON.stringify(conditional));
  }

  async _onConditionalDrop(event) {
    event.preventDefault();

    let droppedData;
    try {
      droppedData = JSON.parse(event.dataTransfer.getData("text/plain"));
      // Surface-level check for conditional
      if (
        !(droppedData.default != null && typeof droppedData.name === "string" && Array.isArray(droppedData.modifiers))
      )
        return;
    } catch (e) {
      return false;
    }

    const item = this.object;
    // Check targets and other fields for valid values, reset if necessary
    for (let modifier of droppedData.modifiers) {
      if (!Object.keys(item.getConditionalTargets()).includes(modifier.target)) modifier.target = "";
      let keys;
      for (let [k, v] of Object.entries(modifier)) {
        switch (k) {
          case "subTarget":
            keys = Object.keys(item.getConditionalSubTargets(modifier.target));
            break;
          case "type":
            keys = Object.keys(item.getConditionalModifierTypes(modifier.target));
            break;
          case "critical":
            keys = Object.keys(item.getConditionalCritical(modifier.target));
            break;
        }
        if (!keys?.includes(v)) v = keys?.[0] ?? "";
      }
    }

    const conditionals = item.system.conditionals || [];
    await this.object.update({ "system.conditionals": conditionals.concat([droppedData]) });
  }
  async _onConditionalControl(event) {
    event.preventDefault();
    const a = event.currentTarget;

    // Add new conditional
    if (a.classList.contains("add-conditional")) {
      await this._onSubmit(event);
      const conditionals = this.item.system.conditionals || [];
      return this.item.update({ "system.conditionals": conditionals.concat([Item35E.defaultConditional]) });
    }

    // Remove a conditional
    if (a.classList.contains("delete-conditional")) {
      await this._onSubmit(event);
      const li = a.closest(".conditional");
      const conditionals = foundry.utils.duplicate(this.item.system.conditionals);
      conditionals.splice(Number(li.dataset.conditional), 1);
      return this.item.update({ "system.conditionals": conditionals });
    }

    // Add a new conditional modifier
    if (a.classList.contains("add-conditional-modifier")) {
      await this._onSubmit(event);
      const li = a.closest(".conditional");
      const conditionals = this.item.system.conditionals;
      conditionals[Number(li.dataset.conditional)].modifiers.push(Item35E.defaultConditionalModifier);
      // duplicate object to ensure update
      return this.item.update({ "system.conditionals": foundry.utils.duplicate(conditionals) });
    }

    // Remove a conditional modifier
    if (a.classList.contains("delete-conditional-modifier")) {
      await this._onSubmit(event);
      const li = a.closest(".conditional-modifier");
      const conditionals = foundry.utils.duplicate(this.item.system.conditionals);
      conditionals[Number(li.dataset.conditional)].modifiers.splice(Number(li.dataset.modifier), 1);
      return this.item.update({ "system.conditionals": conditionals });
    }
  }

  async _onGenerateUid(event) {
    await this.item.update({ "system.uniqueId": this.item.tag + "-" + Math.random().toString(36).slice(-6) });
    this.render(true);
  }

  async _addSpecialActionDialog(itemData) {
    let template = `<form><em>${game.i18n.localize("D35E.CreateSpecialActionFromTemplateHint").format(itemData.name)}</em></form>`;
    new Dialog({
      title: game.i18n.localize("D35E.CreateSpecialActionFromTemplate").format(itemData.name),
      content: template,
      classes: ["custom-dialog", "stacked-buttons"],
      buttons: {
        abilityDrain: {
          icon: '<i class="fas fa-prescription-bottle"></i>',
          label: "Ability Drain/Damage",
          callback: (html) => {
            this._addSpecialActionAbilityDrain(itemData)
          },
        },
        poison: {
          icon: '<i class="fas fa-flask"></i>',
          label: "Poison or Disease",
          callback: (html) => this._addSpecialActionPoison(itemData),
        },
      },
      default: "abilityDrain",
    }, { classes: ["dialog", "stacked-buttons"] }).render(true);
  }

  _addSpecialActionAbilityDrain(itemData) {
    let template = `<form>
                          <div class="form-group">
                            <label>${game.i18n.localize('D35E.Ability')}</label>
                            <select name="ability">
                              <option value="str">${game.i18n.localize('D35E.AbilityStr')}</option>
                              <option value="dex">${game.i18n.localize('D35E.AbilityDex')}</option>
                              <option value="con">${game.i18n.localize('D35E.AbilityCon')}</option>
                              <option value="int">${game.i18n.localize('D35E.AbilityInt')}</option>
                              <option value="wis">${game.i18n.localize('D35E.AbilityWis')}</option>
                              <option value="cha">${game.i18n.localize('D35E.AbilityCha')}</option>
                            </select>
                          </div>
                          <div class="form-group">
                            <label>${game.i18n.localize('D35E.Roll')}</label>
                            <input type="text" name="roll" value="1d4" />
                          </div>  
                          </form>`;
    new Dialog({
      title: game.i18n.localize("D35E.CreateSpecialActionFromTemplate").format(itemData.name),
      content: template,
      classes: ["dialog", "stacked-buttons"],
      buttons: {
        abilityDrain: {
          label: game.i18n.localize("D35E.AbilityDrain"),
          icon: '<i class="fas fa-prescription-bottle"></i>',
          callback: (dlg) => {
            const dlgRoot = dlg?.nodeType === 1 ? dlg : dlg?.[0] ?? dlg;
            let ability = dlgRoot.querySelector('[name="ability"]').value;
            let specialActions = foundry.utils.duplicate(this.item.system.specialActions);
            if (specialActions === undefined) specialActions = [];
            return this.item.update({
              "system.specialActions": specialActions.concat([
                {
                  name: game.i18n.localize("D35E.AbilityDrain"),
                  action: `AbilityDrain ${ability} ${dlgRoot.querySelector('[name="roll"]').value}`,
                  range: "",
                  img: this.item.img,
                  condition: "",
                }
              ])
            });
          }
        },
        abilityDamage: {
          label: game.i18n.localize("D35E.AbilityDamage"),
          icon: '<i class="fas fa-scroll"></i>',
          callback: (dlg) => {
            const dlgRoot = dlg?.nodeType === 1 ? dlg : dlg?.[0] ?? dlg;
            let ability = dlgRoot.querySelector('[name="ability"]').value;
            let specialActions = foundry.utils.duplicate(this.item.system.specialActions);
            if (specialActions === undefined) specialActions = [];
            return this.item.update({
              "system.specialActions": specialActions.concat([
                {
                  name: game.i18n.localize("D35E.AbilityDamage"),
                  action: `AbilityDamage ${ability} ${dlgRoot.querySelector('[name="roll"]').value}`,
                  range: "",
                  img: this.item.img,
                  condition: "",
                },
              ])
            });
          }
        },
        cureAbilityDamage: {
          label: game.i18n.localize("D35E.CureAbilityDamage"),
          icon: '<i class="fas fa-medkit"></i>',
          callback: (dlg) => {
            const dlgRoot = dlg?.nodeType === 1 ? dlg : dlg?.[0] ?? dlg;
            let ability = dlgRoot.querySelector('[name="ability"]').value;
            let specialActions = foundry.utils.duplicate(this.item.system.specialActions);
            if (specialActions === undefined) specialActions = [];
            return this.item.update({
              "system.specialActions": specialActions.concat([
                {
                  name: game.i18n.localize("D35E.CureAbilityDamage"),
                  action: `CureAbilityDamage ${ability} ${dlgRoot.querySelector('[name="roll"]').value}`,
                  range: "",
                  img: this.item.img,
                  condition: "",
                },
              ])
            });
          }
        },
        cureAbilityDrain: {
          label: game.i18n.localize("D35E.CureAbilityDrain"),
          icon: '<i class="fas fa-star-of-life"></i>',
          callback: (dlg) => {
            const dlgRoot = dlg?.nodeType === 1 ? dlg : dlg?.[0] ?? dlg;
            let ability = dlgRoot.querySelector('[name="ability"]').value;
            let specialActions = foundry.utils.duplicate(this.item.system.specialActions);
            if (specialActions === undefined) specialActions = [];
            return this.item.update({
              "system.specialActions": specialActions.concat([
                {
                  name: game.i18n.localize("D35E.CureAbilityDrain"),
                  action: `CureAbilityDrain ${ability} ${dlgRoot.querySelector('[name="roll"]').value}`,
                  range: "",
                  img: this.item.img,
                  condition: "",
                },
              ])
            });
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("D35E.Cancel"),
        }
      },
    }, { classes: ["dialog", "stacked-buttons"] }).render(true);;
  }

  _addSpecialActionPoison(itemData) {
    let saveDc = null;
    let saveType = null;
    let saveName = null;
    let dc = this.item.system.description.value.match(/(Fortitude|Will|Reflex) DC (\d+)/);
    if (dc) {
      saveDc = parseInt(dc[2]);
      saveType = dc[1].toLowerCase();
      if (saveType === 'fortitude') {
        saveName = "Fortitude";
        saveType = 'fort';
      }
    }
    // Create a template form with save DC field and save type field (already prefilled with the save type from the poison)
    // Also add checkbox to possibly try to extract ability damages from the description
    let template = `<form>
           <div class="form-group">
              <label>${game.i18n.localize('D35E.SaveDC')}</label>
              <input type="number" name="dc" value="${saveDc}" />
            </div>
            <div class="form-group">
              <label>${game.i18n.localize('D35E.SavingThrow')}</label>
              <select name="saveType">
                <option value="fort" ${saveType === 'fort' ? 'selected' : ''}>${game.i18n.localize('D35E.SavingThrowFort')}</option>
                <option value="ref" ${saveType === 'ref' ? 'selected' : ''}>${game.i18n.localize('D35E.SavingThrowRef')}</option>
                <option value="will" ${saveType === 'will' ? 'selected' : ''}>${game.i18n.localize('D35E.SavingThrowWill')}</option>
              </select>
            </div>
            <div class="form-group">
              <label>${game.i18n.localize('D35E.ExtractAbilityDamage')}</label>
              <input type="checkbox" name="extractAbilityDamage" value="1" />
            </div>
            </form>`;
    new Dialog({
      title: game.i18n.localize("D35E.CreateSpecialActionFromTemplate").format(itemData.name),
      content: template,
      classes: ["dialog", "stacked-buttons"],
      buttons: {
        poison: {
          label: game.i18n.localize("D35E.CreatePoison"),
          icon: '<i class="fas fa-flask"></i>',
          callback: (html) => {

            return this._createPoisonOrDiseaseSpecialAction("poison", saveName, saveDc, html, itemData);
          }
        },
        disease: {
          label: game.i18n.localize("D35E.CreateDisease"),
          icon: '<i class="fas fa-disease"></i>',
          callback: (html) => {
            return this._createPoisonOrDiseaseSpecialAction("disease", saveName, saveDc, html, itemData);
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("D35E.Cancel"),
        }
      }
    }

    ).render(true);
  }

  _createPoisonOrDiseaseSpecialAction(type, saveName, saveDc, dlg, itemData) {
    let specialActionTemplate = ''
    let actionName = ''
    if (type === 'poison') {
      actionName = game.i18n.localize("D35E.Poisoned");
      specialActionTemplate = 'Create unique "Poisoned" from "warcraftrpg2e.commonbuffs" on target;Set buff "Poisoned" field data.level to max(1,[DC]) on target;Set buff "Poisoned" field system.description.value exact "[Desc]" on target;Set buff "Poisoned" field name to "Poisoned ([Monster])" on target;Activate buff "Poisoned ([Monster])" on target;';
    } else {
      actionName = itemData.name;
      specialActionTemplate = `Create unique "Diseased" from "warcraftrpg2e.commonbuffs" on target;Set buff "Diseased" field data.level to max(1,[DC]) on target;Set buff "Poisoned" field system.description.value exact "[Desc]" on target;Set buff "Diseased" field name to "${itemData.name}" on target;Activate buff "${itemData.name}" on target;`;
    }

    let secondaryDamageDescription = `${saveName} DC ${saveDc}<br>For details see @UUID[${this.item.uuid}]`;
    specialActionTemplate = specialActionTemplate.replace(/\[DC\]/g, saveDc);
    specialActionTemplate = specialActionTemplate.replace(/\[Monster\]/g,
      this.item.actor.name);
    specialActionTemplate = specialActionTemplate.replace(/\[Desc\]/g,
      secondaryDamageDescription);

    let addedSpecialActions = [
      {
        name: itemData.name,
        action: specialActionTemplate,
        range: '',
        img: this.item.img,
        condition: '',
      },
    ];

    // if we selcted extract ability damage, we need to extract it and add it to the special actions
    const dlgRoot = dlg?.nodeType === 1 ? dlg : dlg?.[0] ?? dlg;
    if (dlgRoot.querySelector('[name="extractAbilityDamage"]').checked) {
      // Extract initial damage, ex. initial damage 1d2 Con
      let initialDamage = this.item.system.description.value.match(
        /initial damage (\d+d\d+) (\w+)/);
      // Extract secondary damage, ex. secondary damage 1d2 Con
      let secondaryDamage = this.item.system.description.value.match(
        /secondary damage (\d+d\d+) (\w+)/);
      // Extract combined damage, ex. initial and secondary damage 1d2 Con
      let combinedDamage = this.item.system.description.value.match(
        /initial and secondary damage (\d+d\d+) (\w+)/);
      // Get the damage dices and ability from extracted damages
      let initialDamageDice = initialDamage ? initialDamage[1] : null;
      let initialDamageAbility = initialDamage ? initialDamage[2] : null;
      let secondaryDamageDice = secondaryDamage ? secondaryDamage[1] : null;
      let secondaryDamageAbility = secondaryDamage ? secondaryDamage[2] : null;
      // If they are zero check for combined damage, same for initial and secondary
      if (!initialDamageDice) {
        initialDamageDice = combinedDamage ? combinedDamage[1] : null;
        initialDamageAbility = combinedDamage ? combinedDamage[2] : null;
        secondaryDamageDice = combinedDamage ? combinedDamage[1] : null;
        secondaryDamageAbility = combinedDamage ? combinedDamage[2] : null;
      }
      if (!initialDamageDice && type === 'disease') {
        initialDamage = this.item.system.description.value.match(
          /damage (\d+d\d+) (\w+)/);
        initialDamageDice = initialDamage ? initialDamage[1] : null;
        initialDamageAbility = initialDamage ? initialDamage[2] : null;
      }
      if (!initialDamageDice) {
        // make a notifictaion but proceed
        ui.notifications.warn(game.i18n.localize('D35E.PoisonNoDamageFound'));
      } else {

        // Ability damage special action template
        let abilityDamTemplate = 'AbilityDamage [ability] [damage] on target;';
        // Replace ability and damage dice in template
        let initialDamageSpecialAction = abilityDamTemplate.replace(
          /\[ability\]/g, initialDamageAbility.toLowerCase());
        initialDamageSpecialAction = initialDamageSpecialAction.replace(
          /\[damage\]/g, initialDamageDice);

        // Add the special actions
        addedSpecialActions = addedSpecialActions.concat([
          {
            name: 'Initial Damage',
            action: initialDamageSpecialAction,
            img: `systems/warcraftrpg2e/icons/special-abilities/${type}-initial.png`,
          },
        ]);
        if (secondaryDamageDice) {
          let secondaryDamageSpecialAction = abilityDamTemplate.replace(
            /\[ability\]/g, secondaryDamageAbility.toLowerCase());
          secondaryDamageSpecialAction = secondaryDamageSpecialAction.replace(
            /\[damage\]/g, secondaryDamageDice);

          // Add the special actions
          addedSpecialActions = addedSpecialActions.concat([
            {
              name: 'Secondary Damage',
              action: secondaryDamageSpecialAction,
              img: 'systems/warcraftrpg2e/icons/special-abilities/poison-secondary.png',
            },
          ]);
        }
      }
    }

    let specialActions = foundry.utils.duplicate(this.item.system.specialActions);
    if (specialActions === undefined) specialActions = [];
    return this.item.update({
      'system.specialActions': specialActions.concat(addedSpecialActions),
    });
  }

  /**
   * Repopulates the `.intelligent-power-picker` select with options for the given tier.
   * @param {HTMLElement} root
   * @param {string} tier  "lesser" | "greater"
   */
  _repopulatePowerPicker(root, tier) {
    const picker = root.querySelector(".intelligent-power-picker");
    if (!picker) return;
    // Show only options matching the selected tier; keep first match selected
    let first = true;
    for (const opt of picker.options) {
      const match = opt.dataset.tier === tier;
      opt.hidden = !match;
      opt.disabled = !match;
      if (match && first) {
        opt.selected = true;
        first = false;
      }
    }
    if (first) {
      // No options for this tier — rebuild from cached data
      const opts = this._intelligentOptions?.[tier] ?? [];
      picker.innerHTML = "";
      if (opts.length === 0) {
        const empty = document.createElement("option");
        empty.disabled = true;
        empty.textContent = game.i18n.localize("D35E.IntelligentItemNoTable");
        picker.appendChild(empty);
        return;
      }
      for (const opt of opts) {
        const el = document.createElement("option");
        el.value = opt.uuid;
        el.dataset.label = opt.label;
        el.dataset.ego = String(opt.egoPoints);
        el.dataset.tier = tier;
        if (opt.itemUuid) el.dataset.itemUuid = opt.itemUuid;
        el.textContent = opt.label;
        picker.appendChild(el);
      }
    }
  }

  async _onIntelligentItemControl(event) {
    event.preventDefault();
    const action = event.currentTarget.dataset.action;
    const gmTableActions = new Set([
      "intelligent-roll-full",
      "intelligent-draw-alignment",
      "intelligent-draw-capabilities",
      "intelligent-draw-lesser",
      "intelligent-draw-greater",
      "intelligent-draw-purpose",
      "intelligent-draw-dedicated",
    ]);
    if (gmTableActions.has(action) && !game.user.isGM) return;

    if (action === "intelligent-conflict-roll") {
      if (!this.item.actor?.isOwner) return;
      await IntelligentItemHelper.rollPersonalityConflict(this.item.actor, this.item);
      return;
    }

    if (action === "intelligent-add-power" || action === "intelligent-remove-power") {
      if (!this.item.isOwner) return;
    }

    if (action === "intelligent-add-power") {
      const el = this.element;
      const root = el?.nodeType === 1 ? el : el?.[0] ?? el;
      const tierPicker = root?.querySelector(".intelligent-tier-picker");
      const tier = tierPicker?.value === "greater" ? "greater" : "lesser";
      const select = root?.querySelector(".intelligent-power-picker");
      const opt = select?.selectedOptions[0];
      if (!opt) return;

      const egoPoints = Number(opt.dataset.ego) || (tier === "greater" ? 2 : 1);
      const itemUuid = opt.dataset.itemUuid;

      if (itemUuid && this.item.hasExtension("intelligentPowers")) {
        // New path: resolve actual item and embed as full snapshot
        const itemDoc = await fromUuid(itemUuid).catch(() => null);
        if (!itemDoc) {
          ui.notifications.warn(game.i18n.localize("D35E.IntelligentItemPowerNotFound"));
          return;
        }
        const type = itemDoc.type;
        if (type === "spell") {
          // Default to "day" when adding from roll table; user can edit uses afterward
          await this.item.intelligentPowers.addPowerFromSpell(itemDoc.toObject(), "day", egoPoints, tier);
        } else {
          await this.item.intelligentPowers.addPowerFromFeat(itemDoc.toObject(), egoPoints, tier);
        }
      } else {
        // Legacy path: table result has no linked item — store plain text entry
        const powers = foundry.utils.duplicate(
          IntelligentItemHelper.coercePowersArray(this.item.system?.intelligent?.powers),
        );
        powers.push({
          _id: foundry.utils.randomID(),
          tier,
          label: opt.dataset.label ?? opt.textContent.trim(),
          text: opt.dataset.label ?? opt.textContent.trim(),
          egoPoints,
        });
        await this.item.update({ "system.intelligent.powers": powers });
      }
      return;
    }

    if (action === "intelligent-remove-power") {
      if (!this.item.isOwner) return;
      const powerId = event.currentTarget.dataset.powerId;
      if (powerId && this.item.hasExtension("intelligentPowers")) {
        await this.item.intelligentPowers.deletePower(powerId);
        return;
      }
      // Legacy index-based removal for old plain-text entries
      const idx = Number(event.currentTarget.dataset.index);
      const powers = foundry.utils.duplicate(
        IntelligentItemHelper.coercePowersArray(this.item.system?.intelligent?.powers),
      );
      if (!Number.isFinite(idx) || idx < 0 || idx >= powers.length) return;
      powers.splice(idx, 1);
      await this.item.update({ "system.intelligent.powers": powers });
      return;
    }

    switch (action) {
      case "intelligent-add-skill":
        if (!this.item.isOwner) return;
        await this.item.intelligentPowers.addSkill("int");
        break;
      case "intelligent-roll-full":
        await IntelligentItemHelper.rollFullProfile(this.item);
        break;
      case "intelligent-draw-alignment": {
        const draw = await IntelligentItemHelper.drawFromKind("alignment");
        const res = IntelligentItemHelper.primaryResult(draw);
        if (res) {
          const af = IntelligentItemHelper.getResultFlags(res);
          const u = { "system.intelligent.enabled": true };
          if (af.alignment) u["system.intelligent.alignment"] = af.alignment;
          await this.item.update(u);
        }
        break;
      }
      case "intelligent-draw-capabilities":
        await IntelligentItemHelper.applyCapabilitiesDraw(this.item, false);
        break;
      case "intelligent-draw-lesser": {
        const more = await IntelligentItemHelper.rollPowerPool(this.item, "lesser", 1);
        if (more.length) {
          const powers = foundry.utils.duplicate(
            IntelligentItemHelper.coercePowersArray(this.item.system?.intelligent?.powers),
          );
          await this.item.update({
            "system.intelligent.enabled": true,
            "system.intelligent.powers": powers.concat(more),
          });
        }
        break;
      }
      case "intelligent-draw-greater": {
        const more = await IntelligentItemHelper.rollPowerPool(this.item, "greater", 1);
        if (more.length) {
          const powers = foundry.utils.duplicate(
            IntelligentItemHelper.coercePowersArray(this.item.system?.intelligent?.powers),
          );
          await this.item.update({
            "system.intelligent.enabled": true,
            "system.intelligent.powers": powers.concat(more),
          });
        }
        break;
      }
      case "intelligent-draw-purpose": {
        const draw = await IntelligentItemHelper.drawFromKind("purpose");
        const res = IntelligentItemHelper.primaryResult(draw);
        if (res) {
          const text = res.type === "document"
            ? `@UUID[${res.documentUuid}]{${res.name}}`
            : (res.description ?? res.name ?? "");
          await this.item.update({
            "system.intelligent.enabled": true,
            "system.intelligent.hasSpecialPurpose": true,
            "system.intelligent.specialPurpose": text,
          });
        }
        break;
      }
      case "intelligent-draw-dedicated": {
        const draw = await IntelligentItemHelper.drawFromKind("dedicated");
        const res = IntelligentItemHelper.primaryResult(draw);
        if (res) {
          const text = res.type === "document"
            ? `@UUID[${res.documentUuid}]{${res.name}}`
            : (res.description ?? res.name ?? "");
          await this.item.update({
            "system.intelligent.enabled": true,
            "system.intelligent.hasSpecialPurpose": true,
            "system.intelligent.dedicatedPower": text,
          });
        }
        break;
      }
      default:
        return;
    }
    await this.render(false);
  }
}
