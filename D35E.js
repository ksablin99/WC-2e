/**
 * The D35E edition game system for Foundry Virtual Tabletop
 * Author: LoopeeDK, Rughalt
 * Software License: GNU GPLv3
 */

// Import Modules
import { D35E } from './module/config.js';
import { registerSystemSettings } from './module/settings.js';
import { preloadHandlebarsTemplates } from './module/templates.js';
import {
  getConditions,
  measureDistance,
  measureDistances,
} from './module/canvas/canvas.js';
import { ActorPF } from './module/actor/entity.js';
import { ActorDamageHelper } from './module/actor/helpers/actorDamageHelper.js';
import { ActorSheetPFCharacter } from './module/actor/sheets/character.js';
import { ActorSheetPFNPC } from './module/actor/sheets/npc.js';
import { ActorSheetPFNPCLite } from './module/actor/sheets/npc-lite.js';
import { ActorSheetPFNPCLoot } from './module/actor/sheets/npc-loot.js';
import { ActorSheetPFNPCMonster } from './module/actor/sheets/npc-monster.js';
import { Item35E } from './module/item/entity.js';
import { ItemSheetPF } from './module/item/sheets/base.js';
import { TokenPF } from './module/token/token.js';
import {
  addLowLightVisionToLightConfig,
} from './module/canvas/low-light-vision.js';
import { PatchCore } from './module/patch-core.js';
import { DicePF } from './module/dice.js';
import { CombatantD35E, CombatD35E } from './module/combat/combat.js';
import * as chat from './module/chat.js';
import { createCustomChatMessage } from './module/chat.js';
import { MeasuredTemplatePF, TemplateLayerPF } from './module/measure.js';

import {
  getActorFromId,
  getItemOwner,
  isMinimumCoreVersion,
  sizeDie,
  sizeInt,
  sizeMonkDamageDie,
  sizeNaturalDie,
  CHAT_MESSAGE_STYLE_KEY,
  CHAT_MESSAGE_STYLE_OTHER,
  savy,
} from './module/lib.js';
import { ChatMessagePF } from './module/sidebar/chat-message.js';
import { TokenQuickActions } from './module/token-quick-actions.js';
import { TopPortraitBar } from './module/top-portrait-bar.js';
import * as migrations from './module/migration.js';
import * as cache from './module/cache.js';
import { CACHE } from './module/cache.js';
import D35ELayer from './module/layer.js';
import {
  EncounterGeneratorDialog,
} from './module/apps/encounter-generator-dialog.js';
import {
  TreasureGeneratorDialog,
} from './module/apps/treasure-generator-dialog.js';
import TreasureGenerator from './module/treasure/treasure.js';
import {
  MonsterImporterDialog,
} from './module/utils/monster-importer.js';
import { ActorSheetTrap } from './module/actor/sheets/trap.js';
import { applyConfigModifications } from './module/config-tools.js';
import { genTreasureFromToken } from './module/treasure/treasure.js';
import { ActiveEffectD35E } from './module/ae/entity.js';
import { CollateAuras } from './module/auras/aura-helpers.js';
import { ActorSheetObject } from './module/actor/sheets/object.js';
import { ActorChatListener } from './module/actor/chat/chatListener.js';
import { ItemChatListener } from './module/item/chat/chatListener.js';
import { D35ECombatTracker } from './module/combat/combat-tracker.js';
import { TokenDocumentPF } from './module/token/tokenDocument.js';
import {
  DetectionModeBlindSightD35E,
  DetectionModeInvisibilityD35E,
  DetectionModeTremorD35E,
} from './module/canvas/detection-modes.js';
import { darkvision } from './module/canvas/vision-modes.js';
import { EquipmentSheet35E } from './module/item/sheets/equipment.js';
import { WeaponSheet35E } from './module/item/sheets/weapon.js';
import { FeatSheet35E } from './module/item/sheets/feat.js';
import { Weapon35E } from './module/item/weapon.js';
import { Equipment35E } from './module/item/equipment.js';
import { Enhancement35E } from './module/item/enhancement.js';
import { ItemBase35E } from './module/item/base.js';
import { Spell35E } from './module/item/spell.js';
import { Card35E } from './module/item/card.js';
import { Feat35E } from './module/item/feat.js';
import { Sockets } from './module/sockets/sockets.js';
import { CompendiumBrowser } from './module/apps/compendium-browser.js';
import { LogHelper } from './module/helpers/LogHelper.js';
import { EnrichersHelper } from './module/enrichers.js';
import { DistanceHelper } from './module/canvas/distance-helper.js';
import { ItemContainerHook } from './module/item/hooks/itemContainerHook.js';
import { ItemEquipHook } from './module/item/hooks/itemEquipHook.js';
import { IntelligentItemEquipHook } from './module/item/hooks/intelligentItemEquipHook.js';
import { AlignmentSelectorDialog } from './module/apps/alignment-selector.js';
import { MigrationDialog } from './module/apps/migration-dialog.js';
import { ConjuredManager } from './module/conjuration/conjuredManager.js';

// Add String.format
if (!String.prototype.format) {
  String.prototype.format = function (...args) {
    return this.replace(/{(\d+)}/g, function (match, number) {
      return args[number] != null ? args[number] : match;
    });
  };
}

/* -------------------------------------------- */
/*  Foundry VTT Initialization                  */
/* -------------------------------------------- */

Hooks.once("init", async function () {
  console.log(`D35E | Initializing Warcraft RPG 2e System`);

  // Clean local storage
  var toRemove = [];

  // Create a D35E namespace within the game global
  game.D35E = {
    ActorPF,
    ActorDamageHelper,
    DicePF,
    Item35E,
    migrations,
    rollItemMacro,
    rollDefenses,
    requestRoll,
    rollTurnUndead,
    rollPreProcess: {
      sizeRoll: sizeDie,
      sizeNaturalRoll: sizeNaturalDie,
      sizeMonkDamageRoll: sizeMonkDamageDie,
      sizeVal: sizeInt,
    },
    migrateWorld: migrations.migrateWorld,
    migrateCompendium: migrations.migrateCompendium,
    createdMeasureTemplates: new Set(),
    sockets: new Sockets(),
    logger: LogHelper,
    EncounterGeneratorDialog,
    TreasureGeneratorDialog,
    TreasureGenerator,
    /** Native form persistence for inline dialog templates (replaces jQuery `.savy()`). */
    savy,
    DistanceHelper,
    conjured: ConjuredManager,
  };



  // Record Configuration Values
  CONFIG.D35E = D35E;
  CONFIG.D35E._apps = { AlignmentSelectorDialog };
  CONFIG.debug.hooks = true;
  CONFIG.Actor.documentClass = ActorPF;
  CONFIG.Item.documentClass = ItemBase35E;
  CONFIG.Item.documentClasses = {
    default: Item35E,
    weapon: Weapon35E,
    equipment: Equipment35E,
    enhancement: Enhancement35E,
    spell: Spell35E,
    card: Card35E,
    feat: Feat35E,
  };
  CONFIG.Item.compendiumIndexFields.push("system.index.subType");
  CONFIG.Item.compendiumIndexFields.push("system.index.uniqueId");
  CONFIG.ActiveEffect.documentClass = ActiveEffectD35E;
  CONFIG.MeasuredTemplate.objectClass = MeasuredTemplatePF;
  CONFIG.ChatMessage.documentClass = ChatMessagePF;
  CONFIG.Combat.documentClass = CombatD35E;
  CONFIG.Combatant.documentClass = CombatantD35E;
  CONFIG.Token.objectClass = TokenPF;
  CONFIG.Token.documentClass = TokenDocumentPF;
  CONFIG.Canvas.visionModes.darkvision = darkvision;
  CONFIG.Canvas.detectionModes[DetectionModeInvisibilityD35E.ID] = new DetectionModeInvisibilityD35E({
    id: DetectionModeInvisibilityD35E.ID,
    label: DetectionModeInvisibilityD35E.LABEL,
    type: DetectionModeInvisibilityD35E.DETECTION_TYPE || foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
  });
  CONFIG.Canvas.detectionModes[DetectionModeTremorD35E.ID] = new DetectionModeTremorD35E({
    id: DetectionModeTremorD35E.ID,
    label: DetectionModeTremorD35E.LABEL,
    type: DetectionModeTremorD35E.DETECTION_TYPE || foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
  });
  CONFIG.Canvas.detectionModes[DetectionModeBlindSightD35E.ID] = new DetectionModeBlindSightD35E({
    id: DetectionModeBlindSightD35E.ID,
    label: DetectionModeBlindSightD35E.LABEL,
    type: DetectionModeBlindSightD35E.DETECTION_TYPE || foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
  });

  CONFIG.ui.combat = D35ECombatTracker;

  foundry.documents.collections.Actors.unregisterSheet("core", foundry.appv1.sheets.ActorSheet);
  foundry.documents.collections.Actors.registerSheet("warcraftrpg2e", ActorSheetPFCharacter, {
    types: ["character"],
    makeDefault: true,
    label: game.i18n.localize("D35E.ActorSheetPFCharacter"),
  });
  foundry.documents.collections.Actors.registerSheet("warcraftrpg2e", ActorSheetPFNPC, {
    types: ["npc"],
    makeDefault: true,
    label: game.i18n.localize("D35E.ActorSheetPFNPC"),
  });
  foundry.documents.collections.Actors.registerSheet("warcraftrpg2e", ActorSheetPFNPCLite, {
    types: ["npc"],
    makeDefault: false,
    label: game.i18n.localize("D35E.ActorSheetPFNPCLite"),
  });
  foundry.documents.collections.Actors.registerSheet("warcraftrpg2e", ActorSheetPFNPCLoot, {
    types: ["npc", "character"],
    makeDefault: false,
    label: game.i18n.localize("D35E.ActorSheetPFNPCLoot"),
  });
  foundry.documents.collections.Actors.registerSheet("warcraftrpg2e", ActorSheetPFNPCMonster, {
    types: ["npc", "character"],
    makeDefault: false,
    label: game.i18n.localize("D35E.ActorSheetPFNPCMonster"),
  });
  foundry.documents.collections.Actors.registerSheet("warcraftrpg2e", ActorSheetTrap, {
    types: ["trap"],
    makeDefault: true,
    label: game.i18n.localize("D35E.ActorSheetPFNPCTrap"),
  });
  foundry.documents.collections.Actors.registerSheet("warcraftrpg2e", ActorSheetObject, {
    types: ["object"],
    makeDefault: true,
    label: game.i18n.localize("D35E.ActorSheetPFNPCObject"),
  });
  foundry.documents.collections.Items.unregisterSheet("core", foundry.appv1.sheets.ItemSheet);
  foundry.documents.collections.Items.registerSheet("warcraftrpg2e", ItemSheetPF, {
    types: [
      "class",
      "spell",
      "consumable",
      "enhancement",
      "loot",
      "buff",
      "aura",
      "attack",
      "race",
      "damage-type",
      "material",
      "full-attack",
      "card",
      "valuable",
    ],
    makeDefault: true,
  });
  foundry.documents.collections.Items.registerSheet("warcraftrpg2e", EquipmentSheet35E, { types: ["equipment"], makeDefault: true });
  foundry.documents.collections.Items.registerSheet("warcraftrpg2e", WeaponSheet35E, { types: ["weapon"], makeDefault: true });
  foundry.documents.collections.Items.registerSheet("warcraftrpg2e", FeatSheet35E, { types: ["feat"], makeDefault: true });

  // Register System Settings
  registerSystemSettings();

  CONFIG.statusEffects = getConditions();
  const layers = {
    d35e: {
      layerClass: D35ELayer,
      group: "primary",
    },
  };
  CONFIG.Canvas.layers = foundry.utils.mergeObject(foundry.canvas.Canvas.layers, layers);

  Handlebars.registerHelper("ifeq", function (a, b, options) {
    if (a == b) {
      return options.fn(this);
    }
    return options.inverse(this);
  });
  Handlebars.registerHelper("eq", (a, b) => a === b);
  Handlebars.registerHelper("itemFormulaRef", (systemPath) => {
    if (!systemPath || typeof systemPath !== "string") return "";
    if (systemPath.startsWith("system.")) return `@item.${systemPath.slice(7)}`;
    return systemPath.startsWith("@") ? systemPath : `@item.${systemPath}`;
  });
  Handlebars.registerHelper("select", function (selected, options) {
    const escapedValue = RegExp.escape(Handlebars.escapeExpression(selected));
    const rgx = new RegExp(` value=[\"']${escapedValue}[\"\']`);
    const html = options.fn(this);
    return html.replace(rgx, "$& selected");
  });

  // CONFIG.Canvas.layers.d35e = {
  //   layerClass: D35ELayer,
  //   group: "interface",
  // };

  // Patch Core Functions
  PatchCore();
  ConjuredManager.registerHooks();
  // Preload Handlebars Templates
  await preloadHandlebarsTemplates();
  applyConfigModifications();
  // Register sheet application classes
  game.D35E.sockets.init();

  game.D35E.compendiumBrowser = new CompendiumBrowser({ type: "spells", entityType: "Item" });
  // Enable skin
  document.body.classList.toggle("d35ecustom", game.settings.get("warcraftrpg2e", "customSkin"));
  document.body.classList.toggle("color-blind", game.settings.get("warcraftrpg2e", "colorblindColors"));
  document.body.classList.toggle("no-players-list", game.settings.get("warcraftrpg2e", "hidePlayersList"));
  EnrichersHelper.setupEnrichers();
});

/* -------------------------------------------- */
/*  Foundry VTT Setup                           */
/* -------------------------------------------- */

/**
 * This function runs after game data has been requested and loaded from the servers, so entities exist
 */
Hooks.once("setup", function () {
  // Localize CONFIG objects once up-front
  const toLocalize = [
    "abilities",
    "abilitiesShort",
    "alignments",
    "currencies",
    "distanceUnits",
    "distanceUnitsShort",
    "itemActionTypes",
    "summonWeaponBehaviors",
    "summonWeaponAttackTypes",
    "senses",
    "skills",
    "targetTypes",
    "timePeriods",
    "timePeriodsSpells",
    "savingThrows",
    "ac",
    "acValueLabels",
    "featTypes",
    "conditions",
    "lootTypes",
    "flyManeuverabilities",
    "spellPreparationModes",
    "weaponTypes",
    "weaponProperties",
    "spellComponents",
    "spellSchools",
    "spellLevels",
    "conditionTypes",
    "favouredClassBonuses",
    "armorProficiencies",
    "weaponProficiencies",
    "actorSizes",
    "actorTokenSizes",
    "abilityActivationTypes",
    "abilityActivationTypesPlurals",
    "limitedUsePeriods",
    "equipmentTypes",
    "equipmentSlots",
    "consumableTypes",
    "attackTypes",
    "attackTypesShort",
    "buffTypes",
    "buffTargets",
    "contextNoteTargets",
    "healingTypes",
    "divineFocus",
    "classSavingThrows",
    "classBAB",
    "classTypes",
    "measureTemplateTypes",
    "creatureTypes",
    "race",
    "damageTypes",
    "conditionalTargets",
    "savingThrowTypes",
    "requirements",
    "savingThrowCalculationTypes",
    "attackTypesIcon",
    "abilityTypes",
    "auraTarget",
  ];

  const doLocalize = function (obj) {
    return Object.entries(obj).reduce((obj, e) => {
      if (typeof e[1] === "string") obj[e[0]] = game.i18n.localize(e[1]);
      else if (typeof e[1] === "object") obj[e[0]] = doLocalize(e[1]);
      return obj;
    }, {});
  };
  for (let o of toLocalize) {
    try {
      CONFIG.D35E[o] = doLocalize(CONFIG.D35E[o]);
    } catch (e) {
      //ignore
    }
  }
});

/* -------------------------------------------- */

/**
 * Once the entire VTT framework is initialized, check to see if we should perform a data migration
 */
Hooks.once("ready", async function () {
  document.body.classList.toggle("d35gm", game.user.isGM);
  document.body.classList.toggle("hide-special-action", !game.settings.get("warcraftrpg2e", "allowPlayersApplyActions"));
  document.body.classList.toggle("transparent-sidebar", game.settings.get("warcraftrpg2e", "transparentSidebarWhenUsingTheme"));

  await cache.buildCache();
  game.D35E.cacheReady = true;

  const isCIEnvironment = game.settings.get("warcraftrpg2e", "isCIEnvironment");
  const migrationState = await migrations.prepareMigrationState();
  const pendingMigrations = migrations.getPendingWorldMigrations(migrationState);
  if (pendingMigrations.length && !isCIEnvironment) {
    new MigrationDialog({
      state: migrationState,
      pending: pendingMigrations,
      readOnly: !game.user.isGM,
    }).render(true);
  }
  let isDemo = game.settings.get("warcraftrpg2e", "demoWorld");
  if (isDemo) {
    const chatInput = document.getElementById("chat-message");
    if (chatInput) { chatInput.value = "Chat is disabled in Demo Mode. This world resets every 2 hours!"; chatInput.disabled = true; }
    if (game.paused) game.togglePause();
  }

  console.log("D35E | Cache is ", CACHE);
  //game.actors.contents.forEach(obj => { obj._updateChanges({sourceOnly: true}, {skipToken: true}); });


  Hooks.on("renderTokenHUD", (app, html, data) => {
    TokenQuickActions.addTop3Attacks(app, html, data);
  });
  Hooks.on("renderTokenHUD", (app, html, data) => {
    TokenQuickActions.addTop3Buffs(app, html, data);
  });

  for (let key of game.actors.keys()) {
    TopPortraitBar.render(game.actors.get(key));
  }

  let updateRequestArray = [];

  if (!game.user.isGM) {
    let isDemo = game.settings.get("warcraftrpg2e", "demoWorld");
    if (isDemo) {
      (
        await import(
          /* webpackChunkName: "welcome-screen" */
          "./module/demo-screen.js"
        )
      ).default();
    } else {
      (
        await import(
          /* webpackChunkName: "welcome-screen" */
          "./module/onboarding.js"
        )
      ).default();
    }
    return;
  }

  Hooks.on("renderCombatTracker", (_app, _element, _context, _options) => {
    if (game.combat) {
      game.combat.updateCombatCharacterSheet();
    }
  });
  Hooks.on("changeSidebarTab", (tab) => {
    if (tab instanceof D35ECombatTracker) {
      if (game.combat) {
        game.combat.updateCombatCharacterSheet();
      }
    }
  });

  // Edit next line to match module.
  const system = game.system;
  const title = system.title;
  const moduleVersion = system.version.replace(/-.*$/, '');
  game.settings.register("warcraftrpg2e", "version", {
    name: `${title} Version`,
    default: "0.0.0",
    type: String,
    scope: "world",
  });
  const oldVersion = game.settings.get("warcraftrpg2e", "version");
  if (isCIEnvironment) {
    return; // Skip onboarding screen and welcome screen in CI environment
  }

  (
    await import(
      /* webpackChunkName: "welcome-screen" */
      "./module/onboarding.js"
    )
  ).default();

  if (!foundry.utils.isNewerVersion(moduleVersion, oldVersion)) return;
  (
    await import(
      /* webpackChunkName: "welcome-screen" */
      "./module/welcome-screen.js"
    )
  ).default();
});

Hooks.on("renderSettings", (app, html) => {
  const settingsGame = html?.querySelector?.("#settings-game");
  if (!settingsGame) return;

  const lotdSection = document.createElement("h2");
  lotdSection.id = "d35e-help-section";
  lotdSection.dataset.action = "d35e-help";
  lotdSection.textContent = "Warcraft RPG 2e Help";
  settingsGame.after(lotdSection);

  const lotdDiv = document.createElement("div");
  lotdDiv.id = "d352-help";
  lotdSection.after(lotdDiv);

  const helpButton = document.createElement("button");
  helpButton.id = "d35e-help-btn";
  helpButton.dataset.action = "d35e-help";
  helpButton.innerHTML = "<i class=\"fas fa-question-circle\"></i> Documentation";
  lotdDiv.append(helpButton);
  helpButton.addEventListener("click", (ev) => {
    ev.preventDefault();
    window.open("https://docs.legaciesofthedragon.com", "lotdHelp", "width=1032,height=900");
  });

  const dicordButton = document.createElement("button");
  dicordButton.id = "d35e-discord";
  dicordButton.dataset.action = "d35e-discord";
  dicordButton.innerHTML = "<i class=\"fab fa-discord\"></i> Community Discord";
  lotdDiv.append(dicordButton);
  dicordButton.addEventListener("click", (ev) => {
    ev.preventDefault();
    window.open("https://discord.gg/wDyUaZH", "_blank");
  });

  const patreonButton = document.createElement("button");
  patreonButton.dataset.action = "d35e-patreon";
  patreonButton.innerHTML = "<i class=\"fab fa-patreon\"></i> Support on Patreon";
  lotdDiv.append(patreonButton);
  patreonButton.addEventListener("click", (ev) => {
    ev.preventDefault();
    window.open("https://patreon.com/rughalt", "_blank");
  });
});

Hooks.on("renderSidebarTab", async (app, html) => {
  if (game.user.isGM) {
    if (app?.options?.id == "compendium" || app instanceof CompendiumDirectory) {
      if (html) {
        html.querySelectorAll?.(".drgh-encounter-browser").forEach((el) => el.remove());
        const button = document.createElement("button");
        button.className = "drgh-encounter-browser";
        button.textContent = "Compendium Browser";
        button.addEventListener("click", () => {
          game.D35E.compendiumBrowser.render(true);
        });
        const headerActions = html.querySelector?.(".header-actions");
        if (headerActions) headerActions.append(button);
      }
    }
  }
});


Hooks.on("renderActorSheet", function (sheet, window, data) {
  //sheet.object.refresh({render: false})
});

/* -------------------------------------------- */
/*  Canvas Initialization                       */
/* -------------------------------------------- */

Hooks.on("canvasInit", function () {
  // Extend Diagonal Measurement
  /**
   * @FoundryVersionSpecificCode(<14)
   * Keep the v13 canvas grid patch path unchanged.
   */
  if (game.release.generation < 14) {
    canvas.grid.diagonalRule = game.settings.get("warcraftrpg2e", "diagonalMovement");
    if (isMinimumCoreVersion("0.5.6")) SquareGrid.prototype.measureDistances = measureDistances;
    else SquareGrid.prototype.measureDistance = measureDistance;
    return;
  }
  /**
   * @FoundryVersionSpecificCode(>=14)
   * V14 moved SquareGrid under `foundry.grid` and no longer exposes
   * `diagonalRule` on all grid types.
   */
  if ("diagonalRule" in canvas.grid) {
    canvas.grid.diagonalRule = game.settings.get("warcraftrpg2e", "diagonalMovement");
  }
  const squareGrid = foundry.grid?.SquareGrid ?? globalThis.SquareGrid;
  if (!squareGrid) return;
  if (isMinimumCoreVersion("0.5.6")) squareGrid.prototype.measureDistances = measureDistances;
  else squareGrid.prototype.measureDistance = measureDistance;
});

Hooks.on("renderSceneNavigation", function () {
  TopPortraitBar.renderAll();
});

Hooks.on("dropActorSheetData", function (actor, sheet, dropData, userId) {
  if (actor && actor.sheet && dropData.id) {
    //We only handle the weird drops that do not have UUID
    actor.sheet.addItemFromDropData(dropData);
  }
});

Hooks.on("deleteActor", function () {
  TopPortraitBar.renderAll();
});

Hooks.on("createActor", (actor, data, options) => {
  if (actor.type === "character") {
    let updateData = {};
    if (
      actor.system.details?.levelUpProgression === undefined ||
      actor.system.details?.levelUpProgression === null
    ) {
      updateData["system.details.levelUpProgression"] = true;
    }
    updateData["prototypeToken.sight.enabled"] = true;
    updateData["prototypeToken.actorLink"] = true;
    if (updateData) actor.update(updateData);
  } else if (actor.type === "npc") {
    let updateData = {};
    updateData["prototypeToken.bar1"] = { attribute: "attributes.hp" };
    updateData["prototypeToken.displayName"] = 20;
    updateData["prototypeToken.displayBars"] = 40;
    if (updateData) actor.update(updateData);
  }
});
/* -------------------------------------------- */
/*  Other Hooks                                 */
/* -------------------------------------------- */

Hooks.on("renderChatMessageHTML", (chatMessage, html, data) => {
  // Display action buttons
  chat.displayChatActionButtons(chatMessage, html, data);

  // Hide roll info
  chat.hideRollInfo(chatMessage, html, data);

  // Hide GM sensitive info
  chat.hideGMSensitiveInfo(chatMessage, html, data);

  chat.enableToggles(chatMessage, html, data);

  chat.bindShowReveal(chatMessage, html, data);

  // Optionally collapse the content
  if (game.settings.get("warcraftrpg2e", "autoCollapseItemCards")) {
    html?.querySelectorAll?.(".card-content.item").forEach((el) => { el.style.display = "none"; });
  }

  // AoO notification: clicking a threatening-token row selects that token on canvas
  html?.querySelectorAll?.(".aoo-threatener").forEach((el) => {
    el.addEventListener("click", (event) => {
      const tokenId = el.dataset.tokenId;
      const token = canvas?.tokens?.get(tokenId);
      if (token) token.control({ releaseOthers: !event.shiftKey });
    });
    el.addEventListener("mouseenter", () => {
      const token = canvas?.tokens?.get(el.dataset.tokenId);
      if (token) try { token._onHoverIn(new Event("mouseenter"), { hoverOutOthers: false }); } catch { }
    });
    el.addEventListener("mouseleave", () => {
      const token = canvas?.tokens?.get(el.dataset.tokenId);
      if (token) try { token._onHoverOut(new Event("mouseleave")); } catch { }
    });
  });
});

// Hooks.on("getChatLogEntryContext", addChatMessageContextOptions);
Hooks.on("renderChatLog", (_, html) => ItemChatListener.chatListeners(html));
Hooks.on("renderChatLog", (_, html) => ActorChatListener.chatListeners(html));
Hooks.on("renderChatPopout", (_, html) => ItemChatListener.chatListeners(html));
Hooks.on("renderChatPopout", (_, html) => ActorChatListener.chatListeners(html));

const debouncedCollate = foundry.utils.debounce((a, b, c, d) => CollateAuras(a, b, c, d), 100);
Hooks.on("updateItem", (item, changedData, options, user) => {
  console.log("D35E | Updated Item", item, changedData, options, user, game.userId);
  let actor = item.parent;
  if (actor) {
    TopPortraitBar.render(actor);
    if (!(actor instanceof Actor)) return;

    if (user !== game.userId) {
      console.log("Not updating actor as action was started by other user");
      return;
    }
    //actor.refresh(options)
  }
});

function _injectTokenVisionInfo(actor, html) {
  const tabElem = html?.querySelector?.(`.tab[data-tab="vision"]`);
  if (!tabElem) return;
  console.log("D35E | _injectTokenVisionInfo", actor);
  const noVisionOverride = foundry.utils.getProperty(actor, "system.noVisionOverride") === true;
  const div = document.createElement("div");
  div.style.cssText = "width: 100%; padding: 4px; border-bottom: 1px solid var(--color-border-light-primary); margin-bottom: 4px;";
  div.innerHTML = `<i class="fa-solid fa-circle-info"></i> ${game.i18n.localize(noVisionOverride ? "D35E.VisionNoAutomation" : "D35E.VisionControlledByActor")}`;
  tabElem.prepend(div);
  if (!noVisionOverride) {
    tabElem.querySelectorAll("input, select").forEach((el) => { el.disabled = true; });
    tabElem.querySelectorAll("a").forEach((a) => {
      a.replaceWith(a.cloneNode(true));
    });
  }
}

// Placed token config (TokenConfig extends DocumentSheetV2)
Hooks.on("renderTokenConfig", async (app, html, state) => {
  console.log("D35E | renderTokenConfig", state.document);
  const actor = state.document?.actor;
  if (actor) _injectTokenVisionInfo(actor, html);
});

// Prototype token config (PrototypeTokenConfig extends ApplicationV2)
Hooks.on("renderPrototypeTokenConfig", async (app, html, state) => {
  console.log("D35E | renderPrototypeTokenConfig", app, html, state);
  const actor = app.actor;
  if (actor) _injectTokenVisionInfo(actor, html);
});

Hooks.on("renderAmbientLightConfig", (app, html) => {
  addLowLightVisionToLightConfig(app, html);
});

Hooks.on("createToken", async (token, options, userId) => {
  if (userId !== game.user.id) return;

  const actor = canvas.tokens?.get(token.id)?.actor ?? game.actors.get(token.actorId);
  actor.conditions.toggleConditionStatusIcons();

  // Update changes and generate sourceDetails to ensure valid actor data
  if (actor != null) await actor.refresh();

  if (game.settings.get("warcraftrpg2e", "randomizeHp") && token.actor.type === "npc" && !token.actor.hasPlayerOwner) {
    function getRandomInt(min, max) {
      min = Math.ceil(min);
      max = Math.floor(max);
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }
    let itemUpdates = [];
    token.actor.items
      .filter((obj) => {
        return obj.type === "class";
      })
      .forEach((item) => {
        if (item.system.classType === "template") return;
        if (item.system.classType === "minion") return;
        let hd = item.system.hd;
        let hp = 0;
        let levels = item.system.levels;
        for (let i = 0; i < levels; i++) {
          hp += getRandomInt(1, hd);
        }
        itemUpdates.push({ id: item.id, "system.hp": hp });
      });
    await token.actor.updateEmbeddedDocuments("Item", itemUpdates, { stopUpdates: false, ignoreSpellbookAndLevel: true });
  }

  debouncedCollate(canvas.scene.id, true, true, "createToken");
});

Hooks.on("canvasReady", async (canvas, options, userId) => {
  TopPortraitBar.renderAll();
  if (options?.stopAuraUpdate) return;
  debouncedCollate(canvas.scene.id, true, true, "canvasReady");
});

Hooks.on("refreshToken", (token, options) => {
  if (!game.user.isGM) return;
  if (options?.stopAuraUpdate) return;
  if (options?.refreshPosition) {
    debouncedCollate(canvas.scene.id, true, true, "refreshToken");
  }
});

Hooks.on("updateToken", async (token, data, options, userId) => {

  if (userId !== game.user.id) return false;
  if (options?.stopAuraUpdate) return;
  if (options.tokenOnly) return;
  if (!("x" in data) && !("y" in data)) {
    debouncedCollate(canvas.scene.id, true, true, "updateToken");
  }
});

Hooks.on("preUpdateToken", async (token, data, options, userId) => {
  // if token is selected by the user, we need to update the threatened tokens
  if (canvas && canvas.tokens.controlled.length > 0 && (data?.x || data?.y)) {
    DistanceHelper.clearThreatHighlights();
    {

      var rawToken = canvas.tokens.placeables.find((t) => t.id === token.id);
      // if the movement length is lesser then sqrt(2)*canvas.grid.size, then the token moved only one square
      var movedDistance = Math.sqrt(Math.pow((data.x || rawToken.x) - rawToken.x, 2) + Math.pow((data.y || rawToken.y) - rawToken.y, 2));
      var movedOnlyOneSquare = movedDistance <= Math.sqrt(2) * canvas.grid.size;
      if (!movedOnlyOneSquare && game.settings.get("warcraftrpg2e", "advanced-combat-tracking")) {
        // Go through all tokens and check if the token is threatened by any of them
        let threateningTokens = [];
        for (let enemyToken of canvas.tokens.placeables) {
          var threatened = DistanceHelper.isThreatened(enemyToken, rawToken)
          if (threatened) {
            threateningTokens.push(enemyToken);
          }
        }
        let result = Hooks.call("D35E.Threatened.tokenThreatened", rawToken, threateningTokens, game.user.id);
        if (result === false) {
          // if the result of a tokenThreatened hook is false, then we need to cancel the movement
          return false;
        }
        if (userId === game.user.id && threateningTokens.length > 0 && game.combat) {
          const content = await foundry.applications.handlebars.renderTemplate(
            "systems/warcraftrpg2e/templates/chat/aoo-notification.html",
            {
              moverImg: rawToken.document.texture.src,
              moverName: rawToken.document.name,
              threateningTokens: threateningTokens.map(t => {
                const combatant = game.combat.combatants.find(c => c.tokenId === t.id);
                const aooMax = combatant?.getFlag("D35E", "aaoCount") ?? 1;
                const aooUsed = combatant?.getFlag("D35E", "usedAaoCount") ?? 0;
                const aooLeft = Math.max(0, aooMax - aooUsed);
                return {
                  id: t.id,
                  img: t.document.texture.src,
                  name: t.document.name,
                  aooLeft,
                  aooMax,
                  hasAoo: aooLeft > 0,
                };
              }),
            }
          );
          ChatMessage.create({
            content,
            speaker: ChatMessage.getSpeaker({ token: rawToken.document }),
          });
        }
      }
    }
  }

  // #1532 – auto-mark move action used when the token moves more than one grid square
  if (userId === game.user.id && game.combat && (data?.x !== undefined || data?.y !== undefined)
    && game.settings.get("warcraftrpg2e", "advanced-combat-tracking")) {
    const combatant = game.combat.combatants.find(c => c.tokenId === token.id);
    if (combatant && !combatant.getFlag("D35E", "usedMoveAction")) {
      const moveToken = canvas?.tokens?.placeables?.find(t => t.id === token.id);
      if (moveToken) {
        const dx = (data.x ?? moveToken.x) - moveToken.x;
        const dy = (data.y ?? moveToken.y) - moveToken.y;
        const movedDist = Math.sqrt(dx * dx + dy * dy);
        // Only mark if moved more than one diagonal square (> 5-foot step)
        if (movedDist > Math.sqrt(2) * canvas.grid.size) {
          combatant.setFlag("D35E", "usedMoveAction", true);
        }
      }
    }
  }

  if (userId !== game.user.id) return false;
  if (token.actor.getFlag("D35E", "lootsheettype")) {
    if (data?.x || data?.y) {
      if (!game.user.isGM && !token.actor.getFlag("D35E", "allowPlayerMovement")) {
        return false;
      }
    }
  }
});

Hooks.on("deleteToken", async (token, options, userId) => {
  DistanceHelper.clearThreatHighlights();
  if (options?.stopAuraUpdate) return;
  if (options.tokenOnly) return;
  debouncedCollate(canvas.scene.id, true, true, "deleteToken");
});

Hooks.on("createCombatant", (combat, combatant, info, data) => {
  if (!game.user.isGM) return;
  const actor = canvas.tokens?.get(combatant.tokenId)?.actor;
  if (actor != null) {
    let itemResourcesData = {};
    for (let i of actor.items || []) {
      actor.getItemResourcesUpdate(i, itemResourcesData);
    }
    actor.refreshWithData(itemResourcesData, {});
  }
});

Hooks.on("updateCombat", async (combat, combatant, info, data) => {
  if (!game.user.isGM) return;
  if (
    (combat.current.turn <= combat.previous.turn && combat.current.round === combat.previous.round) ||
    combat.current.round < combat.previous.round
  )
    return; // We moved back in time
  debouncedCollate(canvas.scene?.id, true, true, "updateCombat");
  // const actor = combat.combatant.actor;
  // const buffId = combat.combatant.data?.flags?.D35E?.buffId;
  // if (actor != null) {
  //     await actor.progressRound();
  // } else if (buffId) {
  //     let actor;
  //     if (combat.combatant.data?.flags?.D35E?.isToken) {
  //         actor = canvas.scene.tokens.get(combat.combatant.data?.flags?.D35E?.tokenId).actor;
  //     } else {
  //         actor = game.actors.get(combat.combatant.data?.flags?.D35E?.actor);
  //     }
  //
  //     await actor.progressBuff(buffId,1);
  //     foundry.utils.debounce(canvas.scene.id, true, true, "updateToken")
  // }
});

function trackCreatedMeasuredTemplate(document) {
  const id = document?.document?.id ?? document?.id;
  if (id) game.D35E.createdMeasureTemplates.add(id);
}


Hooks.on("createMeasuredTemplate", (template) => {
  if (game.release.generation < 14) {
    trackCreatedMeasuredTemplate(template);
  }
});
Hooks.on("createRegion", (region) => {
  /**
   * @FoundryVersionSpecificCode(>=14)
   * In V14, MeasuredTemplate documents were replaced by more generic Region documents 
   * with a MeasuredTemplate flag, so we need to track creation of those instead
   */
  if (game.release.generation >= 14) {
    if (!foundry.utils.getProperty(region, "flags.core.MeasuredTemplate")) return;
    trackCreatedMeasuredTemplate(region);
  }
});


// Create race on actor
Hooks.on("preCreateOwnedItem", (actor, item) => {
  if (!(actor instanceof Actor)) return;
  if (actor.race == null) return;

  if (item.type === "race") {
    actor.race.update(item);
    return false;
  }
});

Hooks.on("preCreateItem", (data, d, options, user) => {
  if (!(data.parent instanceof Actor)) return;

  if (user !== game.userId) {
    console.log("Not updating actor as action was started by other user");
    return;
  }
  //data.parent.refresh(options);
});

Hooks.on("createItem", (data, options, user) => {
  if (!(data.parent instanceof Actor)) return;

  if (user !== game.userId) {
    console.log("Not updating actor as action was started by other user");
    return;
  }
  //data.parent.refresh(options);
});
Hooks.on("deleteItem", (data, options, user) => {
  if (!(data.parent instanceof Actor)) return;

  if (user !== game.userId) {
    console.log("Not updating actor as action was started by other user");
    return;
  }
  //data.parent.refresh(options);
});

Hooks.on("getChatLogEntryContext", chat.addChatMessageContextOptions);

Hooks.on("updateActor", (actor, data, options, user) => {
  TopPortraitBar.render(actor);
  if (!(actor instanceof Actor)) return;
  if (user !== game.userId) {
    console.log("Not updating actor as action was started by other user");
    return;
  } else {
    if (options?.stopAuraUpdate) return;
    if (canvas.scene) {
      debouncedCollate(canvas.scene.id, true, true, "updateActor");
    }
    if (actor.system.companionAutosync) {
      actor.syncToCompendium();
    }
  }
});

Hooks.on("controlToken", (token, selected) => {
  /**
   * @FoundryVersionSpecificCode(<14)
   * Keep the v13 token-control highlight path unchanged.
   */
  if (game.release.generation < 14) {
    canvas.perception.update({
      initializeLighting: true,
      refreshLighting: true,
      refreshVision: true,
      refreshSounds: true,
      refreshTiles: true,
    });
    if (canvas.tokens.controlled.length === 1) {
      DistanceHelper.drawThreatenedHighlights(canvas.tokens.controlled[0]);
    } else {
      DistanceHelper.clearThreatHighlights();
    }
    return;
  }
  /**
   * @FoundryVersionSpecificCode(>=14)
   * In v14, `refreshTiles` is no longer a supported perception render flag and
   * control state can settle after the hook fires, so defer highlight redraw.
   */
  canvas.perception.update({
    initializeLighting: true,
    refreshLighting: true,
    refreshVision: true,
    refreshSounds: true,
  });
  window.setTimeout(() => {
    if (!canvas) return;
    if (!selected && canvas.tokens.controlled.length === 0) {
      DistanceHelper.clearThreatHighlights();
      return;
    }
    if (canvas.tokens.controlled.length === 1) {
      DistanceHelper.drawThreatenedHighlights(canvas.tokens.controlled[0]);
    } else {
      DistanceHelper.clearThreatHighlights();
    }
  }, 0);
});

// Redraw highlights after any token moves (drag-and-drop or constrained path).
// updateToken fires on all clients for every position change; we wait for the
// movement animation to settle before redrawing so coordinates are final.
Hooks.on("updateToken", (tokenDoc, data, _options, _userId) => {
  if (!canvas) return;
  if (data?.x === undefined && data?.y === undefined) return;
  if (canvas.tokens.controlled.length !== 1) return;
  const placeable = tokenDoc.object;
  const redraw = () => DistanceHelper.drawThreatenedHighlights(canvas.tokens.controlled[0]);
  placeable?.movementAnimationPromise?.finally(redraw) ?? redraw();
});

/* -------------------------------------------- */
/*  Hotbar Macros                               */
/* -------------------------------------------- */

Hooks.on("hotbarDrop", (bar, data, slot) => {
  if (data.type === "skill") {
    createSkillMacro(data.uuid, data.skill, slot)
    return false;
  }
  if (data.type === "Item") {
    createItemMacro(data.uuid, slot);
    return false;
  }
});

Hooks.on("updateWorldTime", async (date, delta, other) => {
  let roundsDelta = Math.floor(delta / 6);
  if (roundsDelta === 0) return;
  if (!game.user.isGM) return;
  let alreadyChecked = new Set();
  let updatePromises = [];
  for (const source of canvas.tokens.placeables) {
    if (!source.actor) continue;
    let actor = ActorPF.getActorFromTokenPlaceable(source);

    let trueId = actor.id;
    if (actor.isToken) trueId = source.id;
    if (alreadyChecked.has(trueId)) continue;
    alreadyChecked.add(trueId);

    if (actor) {
      updatePromises.push(actor.progressTime(roundsDelta));
    }
  }
  Promise.all(updatePromises).then(() => {
    debouncedCollate(canvas.scene.id, true, true, "updateWorldTime");
  });
});

Hooks.on("combatTurnChange", (combat, previous, current) => {
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
  if (!combatant?.actor) return;
  if (combatant.flags?.D35E?.isBuff) return;

  void combatant.actor.progressRechargeOnCombatTurnStart().catch((err) => {
    console.error("D35E | progressRechargeOnCombatTurnStart failed", err);
  });
});

Hooks.on("diceSoNiceReady", (dice3d) => {
  dice3d.addColorset(
    {
      name: "Legacies of the Dragon",
      description: "Legacies of the Dragon",
      category: "Standard",
      foreground: "#fff4eb",
      background: "#340403",
      texture: "dragon",
      edge: "#340403",
    },
    "default"
  );
});

Hooks.on("aipSetup", (packageConfig) => {
  const api = game.modules.get("autocomplete-inline-properties").API;
  const DATA_MODE = api.CONST.DATA_MODE;

  // Define the config for our package
  const config = {
    packageName: "warcraftrpg2e",
    sheetClasses: [
      {
        name: "ItemSheetPF", // this _must_ be the class name of the `Application` you want it to apply to
        fieldConfigs: [
          {
            selector: `.tab[data-tab="details"] input[type="text"]`, // this targets all text input fields on the "details" tab. Any css selector should work here.
            showButton: true,
            allowHotkey: true,
            dataMode: DATA_MODE.CUSTOM,
            inlinePrefix: "@",
            customDataGetter: (sheet) => {
              return sheet.item.getActorItemRollData();
            },
          },
          // Add more field configs if necessary
        ],
      },
      // Add more sheet classes if necessary
    ],
  };

  // Add our config
  packageConfig.push(config);
});

/**
 * Create a Macro from an Skill drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {Object} actorId  The actor id
 * @param {string} skill    The skill name
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
async function createSkillMacro(actorId, skill, slot) {
  const actor = fromUuidSync(actorId);
  let skillName = CONFIG.D35E.skills[skill] ? CONFIG.D35E.skills[skill] : skill;
  const command =
    `fromUuidSync("${actorId}").rollSkill("${skill}");`;
  let macro = game.macros.contents.find((m) => m.name === skillName && m.command === command);
  if (!macro) {
    macro = await Macro.create(
      {
        name: skillName,
        type: "script",
        img: CONFIG.D35E.skills[skill] ? `/systems/warcraftrpg2e/icons/skills/${skill}.png` : `/systems/warcraftrpg2e/icons/actions/unknown.png`,
        command: command,
        flags: { "D35E.skillMacro": true },
      },
      { displaySheet: false }
    );
  }
  game.user.assignHotbarMacro(macro, slot);
}

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {Object} item     The item data
 * @param {number} slot     The hotbar slot to use
 * @returns {Promise}
 */
async function createItemMacro(itemUuid, slot) {
  const item = await fromUuid(itemUuid);
  const actor = getItemOwner(item);
  const command =
    `fromUuidSync("${itemUuid}").use({})`;
  let macro = game.macros.contents.find((m) => m.name === item.name && m.command === command);
  if (!macro) {
    macro = await Macro.create(
      {
        name: item.name,
        type: "script",
        img: item.img,
        command: command,
        flags: { "D35E.itemMacro": true },
      },
      { displaySheet: false }
    );
  }
  game.user.assignHotbarMacro(macro, slot);
}

/**
 * Create a Macro from an Item drop.
 * Get an existing item macro if one exists, otherwise create a new one.
 * @param {string} itemName
 * @param {object} [options={}]
 * @return {Promise}
 */
function rollItemMacro(itemName, { itemId = null, itemType = null, actorId = null } = {}) {
  let actor = getActorFromId(actorId);
  if (actor && !actor.testUserPermission(game.user, "OWNER"))
    return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoActorPermission"));
  const item = actor
    ? actor.items.find((i) => {
      if (itemId != null && i.id !== itemId) return false;
      if (itemType != null && i.type !== itemType) return false;
      return i.name === itemName;
    })
    : null;
  if (!item) return ui.notifications.warn(`Your controlled Actor does not have an item named ${itemName}`);

  // Trigger the item roll
  if (!game.keyboard.isModifierActive("Control")) {
    return item.use({ skipDialog: game.keyboard.isModifierActive("Shift") });
  }
  return item.roll();
}

/**
 * Show an actor's defenses.
 */
function rollDefenses({ actorName = null, actorId = null } = {}) {
  const speaker = ChatMessage.getSpeaker();
  let actor = game.actors.contents.filter((o) => {
    if (!actorName && !actorId) return false;
    if (actorName && o.name !== actorName) return false;
    if (actorId && o.id !== actorId) return false;
    return true;
  })[0];
  if (speaker.token && !actor) actor = canvas.tokens?.get(speaker.token)?.actor;
  if (!actor) actor = game.actors.get(speaker.actor);
  if (!actor) return ui.notifications.warn("No applicable actor found");

  return actor.displayDefenses();
}

/**
 * Roll Turn Undead
 * @param actorName
 * @param actorId
 * @returns {*|void}
 */
function rollTurnUndead({ actorName = null, actorId = null } = {}) {
  const speaker = ChatMessage.getSpeaker();
  let actor = game.actors.contents.filter((o) => {
    if (!actorName && !actorId) return false;
    if (actorName && o.name !== actorName) return false;
    if (actorId && o.id !== actorId) return false;
    return true;
  })[0];
  if (speaker.token && !actor) actor = canvas.tokens?.get(speaker.token)?.actor;
  if (!actor) actor = game.actors.get(speaker.actor);
  if (!actor) return ui.notifications.warn("No applicable actor found");

  return actor.rollTurnUndead();
}

function requestRoll({ rollType = "skill", rollTarget = "apr", dcTarget = 0, rollMode = "public" }) {
  // Create a chat message with a button depending on the selected roll type
  if (rollType === "save") {
    let buttonCode = `<div class="flexcol card-buttons"><button class="everyone no-actor" data-action="rollSave" data-value="${rollTarget}" data-ability="${dcTarget}" data-targetrollmode="${rollMode}" data-target="${dcTarget}">
${game.i18n.localize("D35E.RollSavingThrow")}
            </button></div>`;
    let chatTemplateData = {
      name: game.i18n.localize("D35E.RollSavingThrow") + ` (${CONFIG.D35E.savingThrows[rollTarget]})`,
      [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
      rollMode: rollMode,
      text: buttonCode,
      targetText: `
      <div class="dice-result box">
          <h4 class="box-title">
          DC
          </h4>
          <h4 class="dice-total rolled-roll">
          ${dcTarget}
          </h4>
      </div>`,
    };
    createCustomChatMessage("systems/warcraftrpg2e/templates/chat/request-roll.html", chatTemplateData, {}, {});
  }
  else if (rollType === "skill") {
    let buttonCode = `<div class="flexcol card-buttons"><button class="everyone no-actor" data-action="rollSkill" data-value="${rollTarget}" data-ability="${dcTarget}" data-targetrollmode="${rollMode}" data-target="${dcTarget}">
${game.i18n.localize("D35E.RollSkillCheck")}
            </button></div>`;
    let skillName = CONFIG.D35E.skills[rollTarget];
    let chatTemplateData = {
      name: `${game.i18n.localize("D35E.RollSkillCheck")} (${skillName})`,
      [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
      rollMode: rollMode,
      text: buttonCode,
      // DC target text
      targetText: `
      <div class="dice-result box">
          <h4 class="box-title">
          DC
          </h4>
          <h4 class="dice-total rolled-roll">
          ${dcTarget}
          </h4>
      </div>`,
    };
    createCustomChatMessage("systems/warcraftrpg2e/templates/chat/request-roll.html", chatTemplateData, {}, {});
  } else if (rollType === "ability") {
    let buttonCode = `<div class="flexcol card-buttons"><button class="everyone no-actor" data-action="rollAbility" data-value="${rollTarget}" data-ability="${dcTarget}" data-targetrollmode="${rollMode}" data-target="${dcTarget}">
${game.i18n.localize("D35E.RollSkillCheck")}
            </button></div>`;
    let abilityName = CONFIG.D35E.abilities[rollTarget];
    let chatTemplateData = {
      name: `${game.i18n.localize("D35E.RollAbilityCheck")} (${abilityName})`,
      [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
      rollMode: rollMode,
      text: buttonCode,
      // DC target text
      targetText: `
      <div class="dice-result box">
          <h4 class="box-title">
          DC
          </h4>
          <h4 class="dice-total rolled-roll">
          ${dcTarget}
          </h4>
      </div>`,
    };
    createCustomChatMessage("systems/warcraftrpg2e/templates/chat/request-roll.html", chatTemplateData, {}, {});
  }

}

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  game.D35E.logger.log("Adding D35E GM Tools and scene controls");

  // v13: controls is a plain object keyed by control name (e.g. controls.tokens).
  // v12: controls was an array.  tools must also be a plain object (keyed by name) in v13.
  const isV13 = !Array.isArray(controls);

  if (isV13) {
    // ── Token control: add per-token button tools ─────────────────────────────
    const tokenControl = controls.tokens;
    if (tokenControl?.tools) {
      tokenControl.tools["d35e-gm-tools-convert-to-loot"] = {
        name: "d35e-gm-tools-convert-to-loot",
        order: 10,
        title: "D35E.ConvertToLoot",
        icon: "fa-regular fa-treasure-chest",
        visible: game.user.isGM,
        onChange: async () => {
          let selectedTokens = canvas.tokens.controlled.filter((t) => {
            /**
             * @FoundryVersionSpecificCode(>=14)
             * Unlinked or synthetic v14 tokens can resolve actor type through the
             * placeable actor or synthetic document actor instead of only the world actor.
             */
            if (game.release.generation >= 14) {
              const type = t.actor?.type ?? t.document.actor?.type ?? game.actors.get(t.document.actorId)?.type;
              return type === "npc" || type === "character";
            }
            return game.actors.get(t.document.actorId)?.type === "npc"
              || game.actors.get(t.document.actorId)?.type === "character";
          });
          if (selectedTokens.length === 0) {
            ui.notifications.error(`Please select at least one token`);
            return;
          }
          for (let token of selectedTokens) {
            const baseActorId = token.document.actorId;
            await token.document.update({
              actorLink: false,
              "delta.flags.core.sheetClass": "warcraftrpg2e.ActorSheetPFNPCLoot",
            });
            const actor = token.document.actor;
            // Unlinking does not set options.previousActorId (only actorId changes do), so Foundry
            // never closes apps on the world actor — the old NPC/PC sheet stays open and matches
            // the token's actor id, so it looks like the token still uses the previous sheet.
            const baseActor = game.actors.get(baseActorId);
            if (baseActor) {
              await Promise.all(
                Object.values(baseActor.apps).map((app) => app.close({ submit: false })),
              );
              baseActor._sheet = null;
            }
            if (actor && actor !== baseActor) {
              await Promise.all(
                Object.values(actor.apps).map((app) => app.close({ submit: false })),
              );
              actor._sheet = null;
            }
            await actor?.sheet?.render(true, { token: token.document });
          }
          ui.notifications.info(`Converted to Loot`);
        },
        button: true,
      };
      tokenControl.tools["d35e-gm-tools-treasure-generator"] = {
        name: "d35e-gm-tools-treasure-generator",
        order: 11,
        title: "D35E.TreasureGenerator",
        icon: "fas fa-gem",
        visible: game.user.isGM,
        onChange: async () => {
          let selectedNpcTokens = canvas.tokens.controlled.filter(
            (t) => game.actors.get(t.document.actorId)?.type === "npc"
          );
          if (selectedNpcTokens.length === 0) {
            ui.notifications.error(`Please select at least a token`);
            return;
          }
          for (let token of selectedNpcTokens) {
            await genTreasureFromToken(token);
          }
          ui.notifications.info(`Treasure generation finished`);
        },
        button: true,
      };
    }

    // ── D35E GM Tools control group ───────────────────────────────────────────
    controls["d35e"] = {
      name: "d35e",
      order: 10,
      title: "D35E.GMTools",
      icon: "fas fa-dungeon",
      layer: "d35e",
      visible: game.user.isGM,
      onChange: (event, active) => {
        if (active) canvas.d35e?.activate?.();
      },
      onToolChange: () => { },
      // tools must be a plain object keyed by tool name in v13
      tools: {
        select: {
          name: "select",
          order: 1,
          title: "CONTROLS.BasicSelect",
          icon: "fas fa-expand",
        },
        "d35e-gm-tools-encounter-generator": {
          name: "d35e-gm-tools-encounter-generator",
          order: 2,
          title: "D35E.EncounterGenerator",
          icon: "fas fa-dragon",
          onChange: () => {
            new EncounterGeneratorDialog().render(true);
          },
          button: true,
        },
        "d35e-gm-tools-custom-treasure-generator": {
          name: "d35e-gm-tools-custom-treasure-generator",
          order: 3,
          title: "D35E.CustomTreasureGenerator",
          icon: "fas fa-store",
          onChange: () => {
            new TreasureGeneratorDialog().render(true);
          },
          button: true,
        },
        "d35e-gm-tools-rest-party": {
          name: "d35e-gm-tools-rest-party",
          order: 4,
          title: "D35E.RestParty",
          icon: "fas fa-bed",
          onChange: () => {
            if (typeof SimpleCalendar !== "undefined") {
              SimpleCalendar.api.changeDate({ hour: 8 });
            }
            let restingPromises = [];
            for (let actor of game.actors.filter((a) => a.system.isPartyMember)) {
              restingPromises.push(actor.rest(true, true, false));
            }
            Promise.all(restingPromises).then(() => {
              let chatTemplateData = {
                name: game.i18n.localize("D35E.PartyRestedHeader"),
                [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
                rollMode: "public",
                text: game.i18n.localize("D35E.PartyRested"),
              };
              createCustomChatMessage("systems/warcraftrpg2e/templates/chat/gm-message.html", chatTemplateData, {}, {});
            });
          },
          button: true,
        },
      },
      activeTool: "select",
    };
  } else {
    // ── v12 fallback: controls is an array ────────────────────────────────────
    const tokenControl = controls.find((c) => c.name === "token");
    if (!tokenControl?.tools) return;
    tokenControl.tools.push(
      {
        name: "d35e-gm-tools-convert-to-loot",
        title: "D35E.ConvertToLoot",
        icon: "fa-regular fa-treasure-chest",
        onClick: async () => {
          let selectedTokens = canvas.tokens.controlled.filter(
            (t) =>
              game.actors.get(t.actorId).type === "npc" || game.actors.get(t.actorId).type === "character"
          );
          if (selectedTokens.length === 0) {
            ui.notifications.error(`Please select at least one token`);
            return;
          }
          for (let token of selectedTokens) {
            /**
             * @FoundryVersionSpecificCode(<13)
             * Legacy token actor overrides are stored on `actorData` in the v12 control path.
             * Keep this isolated so it can be removed cleanly once old-core support is dropped.
             */
            await token.document.update({
              actorLink: false,
              actorData: { flags: { core: { sheetClass: "warcraftrpg2e.ActorSheetPFNPCLoot" } } },
            });
            await canvas.scene.updateEmbeddedDocuments("Token", [{ _id: token.id }]);
          }
          ui.notifications.info(`Converted to Loot`);
        },
        button: true,
      },
      {
        name: "d35e-gm-tools-treasure-generator",
        title: "D35E.TreasureGenerator",
        icon: "fas fa-gem",
        onClick: async () => {
          let selectedNpcTokens = canvas.tokens.controlled.filter(
            (t) => game.actors.get(t.actorId).type === "npc"
          );
          if (selectedNpcTokens.length === 0) {
            ui.notifications.error(`Please select at least a token`);
            return;
          }
          for (let token of canvas.tokens.controlled.filter(
            (t) => game.actors.get(t.actorId).type === "npc"
          )) {
            await genTreasureFromToken(token);
          }
          ui.notifications.info(`Treasure generation finished`);
        },
        button: true,
      }
    );
    controls.push({
      name: "d35e-gm-tools",
      title: "D35E.GMTools",
      icon: "fas fa-dungeon",
      layer: "d35e",
      tools: [
        { name: "select", title: "CONTROLS.BasicSelect", icon: "fas fa-expand" },
        {
          name: "d35e-gm-tools-encounter-generator",
          title: "D35E.EncounterGenerator",
          icon: "fas fa-dragon",
          onClick: () => { new EncounterGeneratorDialog().render(true); },
          button: true,
        },
        {
          name: "d35e-gm-tools-custom-treasure-generator",
          title: "D35E.CustomTreasureGenerator",
          icon: "fas fa-store",
          onClick: () => { new TreasureGeneratorDialog().render(true); },
          button: true,
        },
        {
          name: "d35e-gm-tools-rest-party",
          title: "D35E.RestParty",
          icon: "fas fa-bed",
          onClick: () => {
            if (typeof SimpleCalendar !== "undefined") {
              SimpleCalendar.api.changeDate({ hour: 8 });
            }
            let restingPromises = [];
            for (let actor of game.actors.filter((a) => a.system.isPartyMember)) {
              restingPromises.push(actor.rest(true, true, false));
            }
            Promise.all(restingPromises).then(() => {
              let chatTemplateData = {
                name: game.i18n.localize("D35E.PartyRestedHeader"),
                [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_OTHER,
                rollMode: "public",
                text: game.i18n.localize("D35E.PartyRested"),
              };
              createCustomChatMessage("systems/warcraftrpg2e/templates/chat/gm-message.html", chatTemplateData, {}, {});
            });
          },
          button: true,
        },
      ],
      activeTool: "select",
    });
  }
});

Hooks.on("renderItemSheet", (app, html) => {
  if (!app?.object?.system.uniqueId) return;
  const div = html?.querySelector?.("h4.window-title");
  if (!div) return;
  const copyUidButton = document.createElement("a");
  copyUidButton.className = "document-uid-link";
  copyUidButton.alt = "Copy document UID";
  copyUidButton.dataset.tooltip = `Item UID: ${app?.object?.system.uniqueId}`;
  copyUidButton.dataset.tooltipDirection = "UP";
  copyUidButton.innerHTML = "<i class=\"fa-solid fa-anchor\"></i>";
  copyUidButton.addEventListener("click", async () => {
    navigator.clipboard.writeText(app?.object?.system.uniqueId);
  });
  div.append(copyUidButton);
});

EnrichersHelper.setupHooks();
ItemContainerHook.register();
ItemEquipHook.register();
IntelligentItemEquipHook.register();
