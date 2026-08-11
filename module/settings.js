import { HealthConfig } from "./config/health.js";
import { WorldDefaultConfig } from "./config/world-defaults.js";
import { RollConfig } from "./config/roll-config.js";
import { isMinimumCoreVersion } from "./lib.js";
import { CurrencyConfig } from "./config/currency.js";
import { DistanceHelper } from "./canvas/distance-helper.js";

export const registerSystemSettings = function () {

  /**
   * Track the system version upon which point a migration was last applied
   */
  game.settings.register("warcraftrpg2e", "systemMigrationVersion", {
    name: "System Migration Version",
    scope: "world",
    config: false,
    type: String,
    default: "0.0.0"
  });
  game.settings.register("warcraftrpg2e", "systemMigrationState", {
    name: "System Migration State",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
  /**
   * Track if  we are running in CI/test environment
   */
  game.settings.register("warcraftrpg2e", "isCIEnvironment", {
    name: "Is CI Environment",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });
  // Health configuration
  game.settings.registerMenu(isMinimumCoreVersion("0.5.6") ? "warcraftrpg2e" : "system",
    "healthConfig", {
    name: "SETTINGS.D35EHealthConfigName",
    label: "SETTINGS.D35EHealthConfigLabel",
    hint: "SETTINGS.D35EHealthConfigHint",
    icon: "fas fa-heartbeat",
    type: HealthConfig,
    restricted: true
  }
  );


  game.settings.registerMenu(isMinimumCoreVersion("0.5.6") ? "warcraftrpg2e" : "system",
    "rollConfig", {
    name: "SETTINGS.D35ERollConfigName",
    label: "SETTINGS.D35ERollConfigLabel",
    hint: "SETTINGS.D35ERollConfigHint",
    icon: "fas fa-dice",
    type: RollConfig,
    restricted: true
  }
  );


  game.settings.registerMenu(isMinimumCoreVersion("0.5.6") ? "warcraftrpg2e" : "system",
    "worldDefaults", {
    name: "SETTINGS.D35EWorldDefaultsName",
    label: "SETTINGS.D35EWorldDefaultsLabel",
    hint: "SETTINGS.D35EWorldDefaultsHint",
    icon: "fas fa-world",
    type: WorldDefaultConfig,
    restricted: true
  }
  );


  game.settings.registerMenu(isMinimumCoreVersion("0.5.6") ? "warcraftrpg2e" : "system",
    "currencyConfig", {
    name: "SETTINGS.D35ECurrencyConfigName",
    label: "SETTINGS.D35ECurrencyConfigLabel",
    hint: "SETTINGS.D35ECurrencyConfigHint",
    icon: "fas fa-coins",
    type: CurrencyConfig,
    restricted: true
  }
  );

  game.settings.register("warcraftrpg2e", "healthConfig", {
    name: "SETTINGS.D35EHealthConfigName",
    scope: "world",
    default: HealthConfig.defaultSettings,
    type: Object,
    config: false,
    onChange: () => {
      game.actors.contents.forEach(o => { o.update({}); });
      (canvas.tokens?.placeables?.map(t => t.actor).filter(Boolean) ?? []).forEach(o => { o.update({}); });
    }
  });


  game.settings.register("warcraftrpg2e", "rollConfig", {
    name: "SETTINGS.D35ERollConfigName",
    scope: "world",
    default: RollConfig.defaultSettings,
    type: Object,
    config: false
  });

  game.settings.register("warcraftrpg2e", "currencyConfig", {
    name: "SETTINGS.D35ECurrencyConfigName",
    scope: "world",
    default: CurrencyConfig.defaultSettings,
    type: Object,
    config: false,
    onChange: () => {
      game.actors.contents.forEach(o => { o.update({}); });
      (canvas.tokens?.placeables?.map(t => t.actor).filter(Boolean) ?? []).forEach(o => { o.update({}); });
    }
  });


  game.settings.register("warcraftrpg2e", "worldDefaults", {
    name: "SETTINGS.D35EWorldDefaults",
    scope: "world",
    default: WorldDefaultConfig.defaultSettings,
    type: Object,
    config: false
  });


  game.settings.register("warcraftrpg2e", "autosizeWeapons", {
    name: "SETTINGS.D35EAutosizeWeaponsN",
    hint: "SETTINGS.D35EAutosizeWeaponsL",
    scope: "world",
    config: true,
    default: true,
    type: Boolean,
  });

  game.settings.register("warcraftrpg2e", "psionicsAreDifferent", {
    name: "SETTINGS.D35EPsionicsAreDifferentN",
    hint: "SETTINGS.D35EPsionicsAreDifferentL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
  });

  /**
   * Register diagonal movement rule setting
   */
  game.settings.register("warcraftrpg2e", "diagonalMovement", {
    name: "SETTINGS.D35EDiagN",
    hint: "SETTINGS.D35EDiagL",
    scope: "world",
    config: true,
    default: "5105",
    type: String,
    choices: {
      "555": "SETTINGS.D35EDiagPHB",
      "5105": "SETTINGS.D35EDiagDMG"
    },
    onChange: rule => {
      if (canvas?.grid && "diagonalRule" in canvas.grid) canvas.grid.diagonalRule = rule;
    }
  });

  /**
   * Experience rate
   */
  game.settings.register("warcraftrpg2e", "experienceRate", {
    name: "SETTINGS.D35EExpRateN",
    hint: "SETTINGS.D35EExpRateL",
    scope: "world",
    config: true,
    default: "medium",
    type: String,
    choices: {
      "slow": "Slow",
      "medium": "Medium",
      "fast": "Fast",
    },
    onChange: () => {
      [...game.actors.contents, ...(canvas.tokens?.placeables?.map(t => t.actor).filter(Boolean) ?? [])].filter(o => {
        return o.type === "character";
      }).forEach(o => {
        o.update({});
        if (o.sheet?.rendered) o.sheet.render();
      });
    },
  });

  /**
   * System of Units
   */
  game.settings.register("warcraftrpg2e", "units", {
    name: "SETTINGS.D35EUnitsN",
    hint: "SETTINGS.D35EUnitsL",
    scope: "world",
    config: true,
    default: "imperial",
    type: String,
    choices: {
      "imperial": "Imperial (feet, lbs)",
      "metric": "Metric (meters, kg)"
    },
    onChange: () => {
      [...game.actors.contents, ...(canvas.tokens?.placeables?.map(t => t.actor).filter(Boolean) ?? [])].filter(o => {
        return o.type === "character";
      }).forEach(o => {
        if (o.sheet?.rendered) o.sheet.render();
      });
    },
  });

  /**
   * Option to disable XP bar for session-based or story-based advancement.
   */
  game.settings.register("warcraftrpg2e", "disableExperienceTracking", {
    name: "SETTINGS.D35ENoExpN",
    hint: "SETTINGS.D35ENoExpL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
  });

  /**
   * Option to display class features in other tabs as well
   */
  game.settings.register("warcraftrpg2e", "classFeaturesInTabs", {
    name: "SETTINGS.D35EClassFeaturesInTabsN",
    hint: "SETTINGS.D35EClassFeaturesInTabsL",
    scope: "client",
    config: true,
    default: false,
    type: Boolean,
  });

  /**
   * Option to allow the background skills optional ruleset.
   */
  game.settings.register("warcraftrpg2e", "allowBackgroundSkills", {
    name: "SETTINGS.D35EBackgroundSkillsN",
    hint: "SETTINGS.D35EBackgroundSkillsH",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
    onChange: () => {
      game.actors.contents.forEach(o => { if (o.sheet && o.sheet.rendered) o.sheet.render(true); });
      (canvas.tokens?.placeables?.map(t => t.actor).filter(Boolean) ?? []).forEach(o => { if (o.sheet && o.sheet.rendered) o.sheet.render(true); });
    },
  });

  /**
   * Option to use the Fractional Base Bonuses optional ruleset.
   */
  game.settings.register("warcraftrpg2e", "useFractionalBaseBonuses", {
    name: "SETTINGS.D35EFractionalBaseBonusesN",
    hint: "SETTINGS.D35EFractionalBaseBonusesH",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
    onChange: () => {
      game.actors.contents.forEach(o => { o.update({}); });
      (canvas.tokens?.placeables?.map(t => t.actor).filter(Boolean) ?? []).forEach(o => { o.update({}); });
    },
  });

  /**
   * Option to use automatically scale weapon attacks using BAB
   */
  game.settings.register("warcraftrpg2e", "autoScaleAttacksBab", {
    name: "SETTINGS.D35EAutoScaleAttackBABN",
    hint: "SETTINGS.D35EAutoScaleAttackBABH",
    scope: "world",
    config: true,
    default: true,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", "allowNoAmmo", {
    name: "SETTINGS.D35EAllowNoAmmoN",
    hint: "SETTINGS.D35EAllowNoAmmoH",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", "useAutoAmmoRecovery", {
    name: "SETTINGS.D35EAutoAmmoRecoveryN",
    hint: "SETTINGS.D35EAutoAmmoRecoveryH",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", "noAutoSpellpointsCost", {
    name: "SETTINGS.D35ENoAutoSpellpoinCost",
    hint: "SETTINGS.D35ENoAutoSpellpoinCostH",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", "spellpointCostCustomFormula", {
    name: "SETTINGS.D35ESpellpointsCostFormula",
    hint: "SETTINGS.D35ESpellpointsCostFormulaH",
    scope: "world",
    config: true,
    default: "",
    type: String
  });

  /**
   * Option to automatically collapse Item Card descriptions
   */
  game.settings.register("warcraftrpg2e", "autoCollapseItemCards", {
    name: "SETTINGS.D35EAutoCollapseCardN",
    hint: "SETTINGS.D35EAutoCollapseCardL",
    scope: "client",
    config: true,
    default: false,
    type: Boolean,
    onChange: () => {
      ui.chat.render();
    }
  });


  game.settings.register("warcraftrpg2e", "hideSpellDescriptionsIfHasAction", {
    name: "SETTINGS.D35EHideSpellDescriptionsIfHasActionN",
    hint: "SETTINGS.D35EHideSpellDescriptionsIfHasActionL",
    scope: "client",
    config: true,
    default: false,
    type: Boolean,
    onChange: () => {
      ui.chat.render();
    }
  });

  game.settings.register("warcraftrpg2e", "fizzleSpellOnArcaneFailure", {
    name: "SETTINGS.D35EFizzleSpellOnArcaneFailureN",
    hint: "SETTINGS.D35EFizzleSpellOnArcaneFailureL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
  });

  game.settings.register("warcraftrpg2e", "showPartyHud", {
    name: "SETTINGS.D35EShowPartyHudN",
    hint: "SETTINGS.D35EShowPartyHudL",
    scope: "client",
    config: true,
    default: "none",
    type: String,
    choices: {
      "full": "Full Party HUD",
      "narrow": "Narrow Party HUD",
      "none": "No party HUD"
    },
    onChange: () => {
      ui.nav.render();
    }
  });

  game.settings.register("warcraftrpg2e", "showPartyHudTokenImage", {
    name: "SETTINGS.D35EShowPartyHudTokenN",
    hint: "SETTINGS.D35EShowPartyHudTokenL",
    scope: "client",
    config: true,
    default: true,
    type: Boolean,
    onChange: () => {
      ui.nav.render();
    }
  });


  game.settings.register("warcraftrpg2e", "customSkin", {
    name: "SETTINGS.D35ECustomSkinN",
    hint: "SETTINGS.D35ECustomSkinL",
    scope: "client",
    config: true,
    default: true,
    type: Boolean,
    onChange: () => {
      document.body.classList.toggle('d35ecustom', game.settings.get("warcraftrpg2e", "customSkin"));
    },
  });

  game.settings.register("warcraftrpg2e", "colorblindColors", {
    name: "SETTINGS.D35EColorblindN",
    hint: "SETTINGS.D35EColorblindL",
    scope: "client",
    config: true,
    default: false,
    type: Boolean,
    onChange: () => {
      document.body.classList.toggle('color-blind', game.settings.get("warcraftrpg2e", "colorblindColors"));
    },
  });


  game.settings.register("warcraftrpg2e", 'transparentSidebarWhenUsingTheme', {
    name: `SETTINGS.D35ETransparentSidebarWhenUsingThemeN`,
    hint: 'SETTINGS.D35ETransparentSidebarWhenUsingThemeH',
    default: false,
    type: Boolean,
    config: true,
    scope: 'client',
    onChange: () => {
      document.body.classList.toggle('transparent-sidebar', game.settings.get("warcraftrpg2e", "transparentSidebarWhenUsingTheme"));
    },
  });


  game.settings.register("warcraftrpg2e", "saveAttackWindow", {
    name: "SETTINGS.D35ESaveAttackWindowN",
    hint: "SETTINGS.D35ESaveAttackWindowL",
    scope: "client",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", '__onboarding', {
    name: `Tutorial shown`,
    hint: 'Basic system usage tutorial already shown. Uncheck to view again after reload.',
    scope: 'client',
    default: false,
    config: true,
    type: Boolean,
  });

  game.settings.register("warcraftrpg2e", "showFullAttackChatCard", {
    name: "SETTINGS.D35EFullAttackChatCardN",
    hint: "SETTINGS.D35EFullAttackChatCardL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });



  game.settings.register("warcraftrpg2e", "hidePlayersList", {
    name: "SETTINGS.D35ENoPlayersListN",
    hint: "SETTINGS.D35ENoPlayersListL",
    scope: "client",
    config: true,
    default: false,
    type: Boolean,
    onChange: () => {
      document.body.classList.toggle('no-players-list', game.settings.get("warcraftrpg2e", "hidePlayersList"));
    },
  });

  game.settings.register("warcraftrpg2e", "playersNoDamageDetails", {
    name: "SETTINGS.D35EPlayersNoDamageDetailsN",
    hint: "SETTINGS.D35EPlayersNoDamageDetailsL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", "playersNoDCDetails", {
    name: "SETTINGS.D35EPlayersNoDCDetailsN",
    hint: "SETTINGS.D35EPlayersNoDCDetailsL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });
  /**
   * Option to change measure style
   */
  game.settings.register("warcraftrpg2e", "measureStyle", {
    name: "SETTINGS.D35EMeasureStyleN",
    hint: "SETTINGS.D35EMeasureStyleL",
    scope: "world",
    config: true,
    default: true,
    type: Boolean,
  });

  /**
   * Enable system vision (low-light, detection modes). When false, low-light radius multiplier is not applied.
   */
  game.settings.register("warcraftrpg2e", "vision", {
    name: "SETTINGS.D35EVisionN",
    hint: "SETTINGS.D35EVisionH",
    scope: "world",
    config: true,
    default: true,
    type: Boolean,
  });

  /**
   * Low-light Vision Mode
   */
  game.settings.register("warcraftrpg2e", "lowLightVisionMode", {
    name: "SETTINGS.D35ELowLightVisionModeN",
    hint: "SETTINGS.D35ELowLightVisionModeH",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
  });

  /**
   * Preload Compendiums
   */
  // game.settings.register("warcraftrpg2e", "preloadCompendiums", {
  // name: "SETTINGS.D35EPreloadCompendiumsN",
  // hint: "SETTINGS.D35EPreloadCompendiumsH",
  // scope: "client",
  // config: true,
  // default: false,
  // type: Boolean,
  // });

  game.settings.register("warcraftrpg2e", '__onboarding', {
    name: `Tutorial shown`,
    hint: 'Basic system usage tutorial already shown. Uncheck to view again after reload.',
    default: false,
    type: Boolean,
    config: true,
    scope: 'client',
  });

  game.settings.register("warcraftrpg2e", '__onboardingHidden', {
    name: `SETTINGS.D35EDisableTutorialN`,
    hint: 'SETTINGS.D35EDisableTutorialL',
    default: false,
    type: Boolean,
    config: true,
    scope: 'world',
  });



  game.settings.register("warcraftrpg2e", 'hideSpells', {
    name: `SETTINGS.D35EHideSpellDescriptionsN`,
    hint: 'SETTINGS.D35EHideSpellDescriptionsH',
    default: false,
    type: Boolean,
    config: true,
    scope: 'client',
  });



  game.settings.register("warcraftrpg2e", "allowPlayersApplyActions", {
    name: "SETTINGS.D35EAllowPlayersApplyActionsN",
    hint: "SETTINGS.D35EAllowPlayersApplyActionsH",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
  });

  game.settings.register("warcraftrpg2e", "playersShowContextNotes", {
    name: "SETTINGS.D35EShowPlayerContextNotesN",
    hint: "SETTINGS.D35EShowPlayerContextNotesH",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
  });



  game.settings.register("warcraftrpg2e", "repeatAnimations", {
    name: "SETTINGS.D35ERepeatAnimationsN",
    hint: "SETTINGS.D35ERepeatAnimationsL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });


  game.settings.register("warcraftrpg2e", "globalDisableTokenLight", {
    name: "SETTINGS.D35EDisableTokenLightsN",
    hint: "SETTINGS.D35EDisableTokenLightsL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", "globalDisableTokenVision", {
    name: "SETTINGS.D35EDisableTokenVisionN",
    hint: "SETTINGS.D35EDisableTokenVisionL",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });


  /**
   * Hide token conditions
   */
  game.settings.register("warcraftrpg2e", "hideTokenConditions", {
    name: "SETTINGS.D35EHideTokenConditionsN",
    hint: "SETTINGS.D35EHideTokenConditionsH",
    scope: "world",
    config: true,
    default: false,
    type: Boolean,
    onChange: () => {
      let promises = [];
      const actors = [
        ...Array.from(game.actors.contents.filter((o) => o.prototypeToken?.actorLink)),
        ...(canvas.tokens?.placeables?.map(t => t.actor).filter(Boolean) ?? []),
      ];
      for (let actor of actors) {
        promises.push(actor.conditions.toggleConditionStatusIcons());
      }
      return Promise.all(promises);
    },
  });

  /**
   * Display default token conditions alongside system ones
   */
  game.settings.register("warcraftrpg2e", "coreEffects", {
    name: "SETTINGS.D35ECoreEffectsN",
    hint: "SETTINGS.D35ECoreEffectsH",
    scope: "world",
    config: true,
    requiresReload: true,
    default: false,
    type: Boolean,
  });

  /**
   * Display default token conditions alongside system ones
   */
  game.settings.register("warcraftrpg2e", "currencyNames", {
    name: "SETTINGS.D35ECurrencyNamesN",
    hint: "SETTINGS.D35ECurrencyNamesH",
    scope: "world",
    config: true,
    requiresReload: true,
    default: "",
    type: String,
  });

  game.settings.register("warcraftrpg2e", 'apiKeyWorld', {
    name: "SETTINGS.D35EApiKeyWorldN",
    hint: "SETTINGS.D35EApiKeyWorldH",
    default: "",
    type: String,
    config: true,
    scope: 'world',
  });

  game.settings.register("warcraftrpg2e", 'apiKeyPersonal', {
    name: "SETTINGS.D35EApiKeyPersonalN",
    hint: "SETTINGS.D35EApiKeyPersonalH",
    default: "",
    type: String,
    config: true,
    scope: 'client',
  });

  game.settings.register("warcraftrpg2e", "demoWorld", {
    name: "Demo Mode",
    hint: "This setting enables features related to Demo Mode. Do not set it in live games.",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", "randomizeHp", {
    name: "Randomize npc hp",
    hint: "This setting randomizes npc hp on canvas drop.",
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", "sharedVisionMode", {
    name: "SETTINGS.D35ESharedVisionModeN",
    hint: "SETTINGS.D35ESharedVisionModeH",
    scope: "world",
    config: true,
    default: "0",
    type: String,
    choices: {
      0: "SETTINGS.D35ESharedVisionWithoutSelection",
      1: "SETTINGS.D35ESharedVisionWithSelection",
    },
    onChange: () => {
      game.socket.emit("system.warcraftrpg2e", { eventType: "redrawCanvas" });
    },
  });

  /**
   * Option to allow the background skills optional ruleset.
   */
  game.settings.register("warcraftrpg2e", "useCombatCharacterSheet", {
    name: "SETTINGS.D35EUseCombatCharacterSheetN",
    hint: "SETTINGS.D35EUseCombatCharacterSheetH",
    scope: "world",
    config: true,
    requiresReload: true,
    default: true,
    type: Boolean,
  });

  game.settings.register("warcraftrpg2e", "changeScrollIcon", {
    name: game.i18n.localize("SETTINGS.lsChangeIconForSpellScrollsTitle"),
    hint: game.i18n.localize("SETTINGS.lsChangeIconForSpellScrollsHint"),
    scope: "world",
    config: true,
    default: true,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", "buyChat", {
    name: game.i18n.localize("SETTINGS.lsPurchaseChatMessageTitle"),
    hint: game.i18n.localize("SETTINGS.lsPurchaseChatMessageHint"),
    scope: "world",
    config: true,
    default: true,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", "clearInventory", {
    name: game.i18n.localize("SETTINGS.lsClearInventoryTitle"),
    hint: game.i18n.localize("SETTINGS.lsClearInventoryHint"),
    scope: "world",
    config: true,
    default: false,
    type: Boolean
  });



  game.settings.register("warcraftrpg2e", "debug-distance-overlay", {
    name: "Show Distance Debug Overlay",
    hint: "Draws debug PIXI rectangles showing threat range bounding boxes. For developer use only.",
    scope: "world",
    config: true,
    requiresReload: true,
    default: false,
    type: Boolean,
  });

  game.settings.register("warcraftrpg2e", "threatened-display-mode", {
    name: "Display Threatened Info",
    hint: "Controls how the threatened area is shown when a token is selected: none, color threatened tokens, or draw the full threat zone.",
    scope: "world",
    config: true,
    requiresReload: true,
    default: "tokens",
    type: String,
    choices: {
      none: "None",
      tokens: "Color Threatened Tokens",
      area: "Draw Threaten Areas",
    },
  });

  game.settings.register("warcraftrpg2e", "automate-flanking-threat", {
    name: "Automate Flanking/Threat Detection",
    hint: "When enabled, automatically detects flanking and pre-checks the flanking bonus in the attack dialog. Also enables threat-range checks (ranged attacks won't trigger AoO, etc.).",
    scope: "world",
    config: true,
    requiresReload: true,
    default: false,
    type: Boolean
  });

  game.settings.register("warcraftrpg2e", "advanced-combat-tracking", {
    name: "SETTINGS.D35EAdvancedCombatTrackingN",
    hint: "SETTINGS.D35EAdvancedCombatTrackingH",
    scope: "world",
    config: true,
    requiresReload: true,
    default: true,
    type: Boolean,
  });


  game.settings.register("warcraftrpg2e", "additionalCachedCompendiums_classAbilities", {
    name: "SETTINGS.additionalCachedCompendiums_classAbilitiesN",
    hint: "SETTINGS.additionalCachedCompendiums_classAbilitiesH",
    scope: "world",
    config: true,
    requiresReload: true,
    default: "",
    type: String,
  });

  game.settings.register("warcraftrpg2e", "additionalCachedCompendiums_racialAbilities", {
    name: "SETTINGS.additionalCachedCompendiums_racialAbilitiesN",
    hint: "SETTINGS.additionalCachedCompendiums_racialAbilitiesH",
    scope: "world",
    config: true,
    requiresReload: true,
    default: "",
    type: String,
  });

  game.settings.register("warcraftrpg2e", "additionalCachedCompendiums_spellLikeAbilities", {
    name: "SETTINGS.additionalCachedCompendiums_spellLikeAbilitiesN",
    hint: "SETTINGS.additionalCachedCompendiums_spellLikeAbilitiesH",
    scope: "world",
    config: true,
    requiresReload: true,
    default: "",
    type: String,
  });

  game.settings.register("warcraftrpg2e", "additionalCachedCompendiums_materials", {
    name: "SETTINGS.additionalCachedCompendiums_materialsN",
    hint: "SETTINGS.additionalCachedCompendiums_materialsH",
    scope: "world",
    config: true,
    requiresReload: true,
    default: "",
    type: String,
  });

  game.settings.register("warcraftrpg2e", "additionalCachedCompendiums_damageTypes", {
    name: "SETTINGS.additionalCachedCompendiums_damageTypesN",
    hint: "SETTINGS.additionalCachedCompendiums_damageTypesH",
    scope: "world",
    config: true,
    requiresReload: true,
    default: "",
    type: String,
  });

  const intelligentExtraTable = (key, nameKey, hintKey) => {
    game.settings.register("warcraftrpg2e", key, {
      name: nameKey,
      hint: hintKey,
      scope: "world",
      config: true,
      default: "",
      type: String,
    });
  };

  intelligentExtraTable(
    "intelligentItemExtraTablesAlignment",
    "SETTINGS.D35EIntelligentItemExtraTablesAlignmentN",
    "SETTINGS.D35EIntelligentItemExtraTablesAlignmentH",
  );
  intelligentExtraTable(
    "intelligentItemExtraTablesCapabilities",
    "SETTINGS.D35EIntelligentItemExtraTablesCapabilitiesN",
    "SETTINGS.D35EIntelligentItemExtraTablesCapabilitiesH",
  );
  intelligentExtraTable(
    "intelligentItemExtraTablesLesser",
    "SETTINGS.D35EIntelligentItemExtraTablesLesserN",
    "SETTINGS.D35EIntelligentItemExtraTablesLesserH",
  );
  intelligentExtraTable(
    "intelligentItemExtraTablesGreater",
    "SETTINGS.D35EIntelligentItemExtraTablesGreaterN",
    "SETTINGS.D35EIntelligentItemExtraTablesGreaterH",
  );
  intelligentExtraTable(
    "intelligentItemExtraTablesPurpose",
    "SETTINGS.D35EIntelligentItemExtraTablesPurposeN",
    "SETTINGS.D35EIntelligentItemExtraTablesPurposeH",
  );
  intelligentExtraTable(
    "intelligentItemExtraTablesDedicated",
    "SETTINGS.D35EIntelligentItemExtraTablesDedicatedN",
    "SETTINGS.D35EIntelligentItemExtraTablesDedicatedH",
  );

  game.settings.register("warcraftrpg2e", "intelligentItemEquipWarn", {
    name: "SETTINGS.D35EIntelligentItemEquipWarnN",
    hint: "SETTINGS.D35EIntelligentItemEquipWarnH",
    scope: "world",
    config: true,
    default: true,
    type: Boolean,
  });

  // game.settings.register("warcraftrpg2e", 'displayItemsInContainers', {
  //   name: `SETTINGS.D35EDisplayItemsInContainersN`,
  //   hint: 'SETTINGS.D35EDisplayItemsInContainersH',
  //   default: false,
  //   type: Boolean,
  //   config: true,
  //   scope: 'client',
  // });
};
