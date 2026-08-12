import { IntelligentItemHelper } from "./item/helpers/intelligentItemHelper.js";
import { legacyAlignmentUpdate } from "./alignment-migration.js";
import { dancingEnhancementItemUpdate, dancingWeaponItemUpdate } from "./dancing-migration.js";
import { buildStealthMigrationUpdate } from "./actor/helpers/warcraftStealthMigration.js";
import {
  createMigrationState,
  getPendingMigrations,
  markMigrationCompleted,
  markMigrationFailed,
  markMigrationSkipped,
  normalizeMigrationAffected,
  normalizeMigrationState,
} from "./migration-framework.js";

export const LEGACY_MIGRATION_ID = "legacy-3-0-1";
export const LEGACY_ALIGNMENT_MIGRATION_ID = "legacy-alignment-3-0-3";
export const DANCING_MIGRATION_ID = "dancing-enhancement-3-0-3";
export const WARCRAFT_STEALTH_MIGRATION_ID = "warcraft-stealth-3-1-3";

export const MIGRATIONS = [
  {
    id: LEGACY_MIGRATION_ID,
    version: "3.0.1",
    title: "D35E.MigrationLegacyTitle",
    description: "D35E.MigrationLegacyDescription",
    run: async () => runLegacyMigrationBundle(),
  },
  {
    id: LEGACY_ALIGNMENT_MIGRATION_ID,
    version: "3.0.3",
    title: "D35E.MigrationLegacyAlignmentTitle",
    description: "D35E.MigrationLegacyAlignmentDescription",
    run: async () => migrateLegacyAlignment(),
  },
  {
    id: DANCING_MIGRATION_ID,
    version: "3.0.3",
    optional: true,
    title: "D35E.MigrationDancingEnhancementTitle",
    description: "D35E.MigrationDancingEnhancementDescription",
    run: async () => migrateDancingEnhancements(),
  },
  {
    id: WARCRAFT_STEALTH_MIGRATION_ID,
    version: "3.1.3",
    title: "D35E.MigrationWarcraftStealthTitle",
    description: "D35E.MigrationWarcraftStealthDescription",
    run: async () => migrateWarcraftStealth(),
  },
];

const createMigrationAffected = function() {
  return { total: 0, byType: {} };
};

const recordMigrationAffected = function(summary, type, count = 1) {
  if (!summary || !type || !count) return summary;
  summary.byType[type] = (summary.byType[type] ?? 0) + count;
  summary.total += count;
  return summary;
};

const migrationResult = function(summary) {
  return { affected: normalizeMigrationAffected(summary) };
};

export const migrateActor = async function(a) {
  try {

    let itemsToAdd = []
    const updateData = await migrateActorData(a, itemsToAdd);
    //game.D35E.logger.log(`Migrating Actor entity ${a.name}`);
    const changed = !foundry.utils.isEmpty(updateData) || itemsToAdd.length > 0;
    if (!foundry.utils.isEmpty(updateData)) await a.update(updateData);
    //game.D35E.logger.log(`Adding missing items to ${a.name}`);
    if (itemsToAdd.length)
      await a.createEmbeddedDocuments("Item", itemsToAdd, {stopUpdates: true});
    return changed;
  } catch (err) {
    game.D35E.logger.error(err);
    return false;
  }
}

export const migrateItem = async function(i) {
  try {
    const updateData = await migrateItemData(i);
    if (foundry.utils.isEmpty(updateData)) return false;
    await i.update(updateData);
    return true;
  } catch (err) {
    game.D35E.logger.error(err);
    return false;
  }
}


export const getMigrationState = function() {
  return normalizeMigrationState(game.settings.get("warcraftrpg2e", "systemMigrationState"), {
    legacyVersion: game.settings.get("warcraftrpg2e", "systemMigrationVersion"),
    worldSystemVersion: game.world?.systemVersion,
    currentSystemVersion: game.system.version,
  });
};

export const prepareMigrationState = async function() {
  const stored = game.settings.get("warcraftrpg2e", "systemMigrationState");
  const state = stored && Object.keys(stored).length
    ? normalizeMigrationState(stored, { currentSystemVersion: game.system.version })
    : createMigrationState({
      legacyVersion: game.settings.get("warcraftrpg2e", "systemMigrationVersion"),
      worldSystemVersion: game.world?.systemVersion,
      currentSystemVersion: game.system.version,
    });

  state.currentSystemVersion = game.system.version;
  if (game.user.isGM) await game.settings.set("warcraftrpg2e", "systemMigrationState", state);
  return state;
};

export const getPendingWorldMigrations = function(state = getMigrationState()) {
  return getPendingMigrations(MIGRATIONS, state);
};

export const skipWorldMigration = async function(migrationId, reason = "user") {
  if (!game.user.isGM) return ui.notifications.error(game.i18n.localize("D35E.ErrorUnauthorizedAction"));
  const migration = MIGRATIONS.find((m) => m.id === migrationId);
  if (!migration || !migration.optional) return getMigrationState();

  const state = markMigrationSkipped(getMigrationState(), migration, new Date().toISOString(), reason);
  state.currentSystemVersion = game.system.version;
  await game.settings.set("warcraftrpg2e", "systemMigrationState", state);
  return state;
};

export const runWorldMigrations = async function(pendingMigrations, { onStatus } = {}) {
  if (!game.user.isGM) return ui.notifications.error(game.i18n.localize("D35E.ErrorUnauthorizedAction"));
  let state = getMigrationState();
  const migrationsToRun = Array.isArray(pendingMigrations) ? pendingMigrations : getPendingWorldMigrations(state);
  if (!migrationsToRun.length) return state;

  ui.notifications.info(`Applying Warcraft RPG 2e system migration for version ${game.system.version}. Please stand by.`);
  for (const migration of migrationsToRun) {
    try {
      onStatus?.(migration, "running");
      state.lastAttempt = {
        id: migration.id,
        version: migration.version,
        status: "running",
        startedAt: new Date().toISOString(),
      };
      await game.settings.set("warcraftrpg2e", "systemMigrationState", state);
      const result = await migration.run();
      state = markMigrationCompleted(state, migration, new Date().toISOString(), result);
      await game.settings.set("warcraftrpg2e", "systemMigrationState", state);
      onStatus?.(migration, "success");
    } catch (err) {
      state = markMigrationFailed(state, migration, err);
      await game.settings.set("warcraftrpg2e", "systemMigrationState", state);
      onStatus?.(migration, "failed", err);
      game.D35E.logger.error(`Migration ${migration.id} failed:`, err);
      throw err;
    }
  }

  state.lastSuccessVersion = game.system.version;
  state.currentSystemVersion = game.system.version;
  await game.settings.set("warcraftrpg2e", "systemMigrationState", state);
  await game.settings.set("warcraftrpg2e", "systemMigrationVersion", game.system.version);
  ui.notifications.info(`Warcraft RPG 2e system migration to version ${game.system.version} succeeded!`);
  return state;
};

/**
 * Perform all pending system migrations for the entire World.
 * @return {Promise}      A Promise which resolves once migration is completed
 */
export const migrateWorld = async function() {
  return runWorldMigrations();
};

/**
 * Legacy migration bundle for data model updates through D35E 3.0.1.
 * @return {Promise}      A Promise which resolves once the migration is completed
 */
export const runLegacyMigrationBundle = async function() {
  const affected = createMigrationAffected();

  // Migrate World Actors
  for ( let a of game.actors.contents ) {
    if (await migrateActor(a)) recordMigrationAffected(affected, "Actor");
  }

  // Migrate World Items
  for ( let i of game.items.contents ) {
    try {
      const updateData = migrateItemData(i);
      //game.D35E.logger.log(`Migrating Item entity ${i.name}`);
      if (!foundry.utils.isEmpty(updateData)) {
        await i.update(updateData, {enforceTypes: false});
        recordMigrationAffected(affected, "Item");
      }
    } catch(err) {
      game.D35E.logger.error(err);
    }
  }

  game.D35E.logger.log("Migrating Scene documents.");
  for (const s of game.scenes.contents) {
    try {
      const updateData = migrateSceneData(s);
      if (!foundry.utils.isEmpty(updateData)) {
        game.D35E.logger.log(`Migrating Scene document ${s.name}`);
        await s.update(updateData, { enforceTypes: false });
        recordMigrationAffected(affected, "Scene");
        // If we do not do this, then synthetic token actors remain in cache
        // with the un-updated actorData.
        s.tokens.contents.forEach((t) => {
          t._actor = null;
        });
      }
    } catch (err) {
      game.D35E.logger.error(`Error migrating scene document ${s.name}`, err);
    }
  }


  // Migrate World Compendium Packs
  const packs = game.packs.filter(p => {
    return (p.metadata.package === "world") && ["Actor", "Item", "Scene"].includes(p.documentName)
  });
  for ( let p of packs ) {
    const count = await migrateCompendium(p);
    recordMigrationAffected(affected, `Compendium ${p.documentName}`, count);
  }

  return migrationResult(affected);
};

/* -------------------------------------------- */

export const migrateLegacyAlignment = async function() {
  if (!game.user.isGM) return ui.notifications.error(game.i18n.localize("D35E.ErrorUnauthorizedAction"));
  const affected = createMigrationAffected();

  for (const actor of game.actors.contents) {
    try {
      const updateData = legacyAlignmentUpdate(actor);
      if (!foundry.utils.isEmpty(updateData)) {
        await actor.update(updateData, { enforceTypes: false });
        recordMigrationAffected(affected, "Actor");
      }
    } catch (err) {
      game.D35E.logger.error(`migrateLegacyAlignment failed for actor ${actor.name}:`, err);
    }
  }

  game.D35E.logger.log("Migrating Scene alignment overrides.");
  for (const scene of game.scenes.contents) {
    try {
      const updateData = migrateSceneAlignmentData(scene);
      if (!foundry.utils.isEmpty(updateData)) {
        await scene.update(updateData, { enforceTypes: false });
        recordMigrationAffected(affected, "Scene");
      }
    } catch (err) {
      game.D35E.logger.error(`migrateLegacyAlignment failed for scene ${scene.name}:`, err);
    }
  }

  const packs = game.packs.filter(p => {
    return (p.metadata.package === "world") && ["Actor", "Scene"].includes(p.documentName)
  });
  for (const pack of packs) {
    const count = await migrateLegacyAlignmentCompendium(pack);
    recordMigrationAffected(affected, `Compendium ${pack.documentName}`, count);
  }

  return migrationResult(affected);
};

export const migrateDancingEnhancements = async function() {
  if (!game.user.isGM) return ui.notifications.error(game.i18n.localize("D35E.ErrorUnauthorizedAction"));
  const affected = createMigrationAffected();

  for (const item of game.items.contents) {
    try {
      const updateData = {
        ...dancingEnhancementItemUpdate(item),
        ...dancingWeaponItemUpdate(item),
      };
      if (!foundry.utils.isEmpty(updateData)) {
        await item.update(updateData, { enforceTypes: false });
        recordMigrationAffected(affected, "Item");
      }
    } catch (err) {
      game.D35E.logger.error(`migrateDancingEnhancements failed for item ${item.name}:`, err);
    }
  }

  for (const actor of game.actors.contents) {
    try {
      const updateData = {};
      const items = actor.items.reduce((arr, i) => {
        const itemData = i instanceof CONFIG.Item.documentClass ? i.toObject() : i;
        const itemUpdate = {
          ...dancingEnhancementItemUpdate(itemData),
          ...dancingWeaponItemUpdate(itemData),
        };
        if (!foundry.utils.isEmpty(itemUpdate)) {
          itemUpdate._id = itemData._id;
          arr.push(foundry.utils.expandObject(itemUpdate));
        }
        return arr;
      }, []);
      if (items.length > 0) {
        updateData.items = items;
        await actor.update(updateData, { enforceTypes: false });
        recordMigrationAffected(affected, "Actor");
      }
    } catch (err) {
      game.D35E.logger.error(`migrateDancingEnhancements failed for actor ${actor.name}:`, err);
    }
  }

  const packs = game.packs.filter(
    (p) => p.metadata.package === "world" && ["Actor", "Item"].includes(p.documentName)
  );
  for (const pack of packs) {
    const count = await migrateDancingEnhancementsCompendium(pack);
    recordMigrationAffected(affected, `Compendium ${pack.documentName}`, count);
  }

  return migrationResult(affected);
};

/**
 * Merge legacy Hide and Move Silently records into Warcraft Stealth.
 * Every affected actor receives a reversible flag backup and refund report.
 */
export const migrateWarcraftStealth = async function() {
  if (!game.user.isGM) return ui.notifications.error(game.i18n.localize("D35E.ErrorUnauthorizedAction"));
  const affected = createMigrationAffected();
  let refundableInvestment = 0;

  const updateActor = async (actor, type) => {
    const updateData = buildStealthMigrationUpdate(actor);
    if (foundry.utils.isEmpty(updateData)) return false;
    refundableInvestment += Number(updateData["flags.warcraftrpg2e.migrations.stealth"]?.refundableInvestment ?? 0);
    await actor.update(updateData, { enforceTypes: false });
    recordMigrationAffected(affected, type);
    return true;
  };

  for (const actor of game.actors.contents) await updateActor(actor, "Actor");

  for (const scene of game.scenes.contents) {
    const tokens = [];
    for (const token of scene.tokens.contents ?? scene.tokens ?? []) {
      if (token.actorLink || !token.actor) continue;
      const updateData = buildStealthMigrationUpdate(token.actor);
      if (foundry.utils.isEmpty(updateData)) continue;
      refundableInvestment += Number(updateData["flags.warcraftrpg2e.migrations.stealth"]?.refundableInvestment ?? 0);
      const tokenData = token.toObject();
      const targetKey = tokenData.delta ? "delta" : "actorData";
      tokenData[targetKey] = tokenData[targetKey] ?? {};
      foundry.utils.mergeObject(tokenData[targetKey], foundry.utils.expandObject(updateData), {
        inplace: true,
        performDeletions: true,
      });
      tokens.push(tokenData);
    }
    if (tokens.length) {
      await scene.update({ tokens }, { enforceTypes: false });
      recordMigrationAffected(affected, "Scene token", tokens.length);
    }
  }

  for (const pack of game.packs.filter((entry) => entry.metadata.package === "world" && entry.documentName === "Actor")) {
    let count = 0;
    await pack.migrate();
    for (const actor of await pack.getDocuments()) {
      const updateData = buildStealthMigrationUpdate(actor);
      if (foundry.utils.isEmpty(updateData)) continue;
      refundableInvestment += Number(updateData["flags.warcraftrpg2e.migrations.stealth"]?.refundableInvestment ?? 0);
      await actor.update(updateData, { enforceTypes: false });
      count += 1;
    }
    recordMigrationAffected(affected, `Compendium ${pack.documentName}`, count);
  }

  if (refundableInvestment) {
    game.D35E.logger.warn(
      `Warcraft Stealth migration preserved the greater legacy investment and reported ${refundableInvestment} potentially refundable skill points in actor migration flags.`
    );
  }
  return { ...migrationResult(affected), refundableInvestment };
};

const migrateDancingEnhancementsCompendium = async function(pack) {
  const entity = pack.documentName;
  if (!["Actor", "Item"].includes(entity)) return 0;
  let affected = 0;
  let content = [];
  try {
    await pack.migrate();
    content = await pack.getDocuments();
  } catch (err) {
    ui.notifications.error(game.i18n.localize("D35E.ErrorProblemWithMigratingPack") + pack.collection);
    game.D35E.logger.error(err);
  }
  for (const doc of content) {
    try {
      if (entity === "Item") {
        const updateData = {
          ...dancingEnhancementItemUpdate(doc),
          ...dancingWeaponItemUpdate(doc),
        };
        if (!foundry.utils.isEmpty(updateData)) {
          await doc.update(updateData, { enforceTypes: false });
          affected += 1;
        }
      } else if (entity === "Actor") {
        const items = doc.items.reduce((arr, i) => {
          const itemData = i instanceof CONFIG.Item.documentClass ? i.toObject() : i;
          const itemUpdate = {
            ...dancingEnhancementItemUpdate(itemData),
            ...dancingWeaponItemUpdate(itemData),
          };
          if (!foundry.utils.isEmpty(itemUpdate)) {
            itemUpdate._id = itemData._id;
            arr.push(foundry.utils.expandObject(itemUpdate));
          }
          return arr;
        }, []);
        if (items.length > 0) {
          await doc.update({ items }, { enforceTypes: false });
          affected += 1;
        }
      }
    } catch (err) {
      game.D35E.logger.error(`migrateDancingEnhancements failed for ${doc.name} in ${pack.collection}:`, err);
    }
  }
  return affected;
};

/* -------------------------------------------- */

export const migrateLegacyAlignmentCompendium = async function(pack) {
  const entity = pack.documentName;
  if (!["Actor", "Scene"].includes(entity)) return 0;
  let affected = 0;

  let content = [];
  try {
    await pack.migrate();
    content = await pack.getDocuments();
  } catch (err) {
    ui.notifications.error(game.i18n.localize("D35E.ErrorProblemWithMigratingPack") + pack.collection);
    game.D35E.logger.error(err);
  }

  for (const doc of content) {
    try {
      if (entity === "Actor") {
        const updateData = legacyAlignmentUpdate(doc);
        if (!foundry.utils.isEmpty(updateData)) {
          await doc.update(updateData, { enforceTypes: false });
          affected += 1;
        }
      } else if (entity === "Scene") {
        const updateData = migrateSceneAlignmentData(doc);
        if (!foundry.utils.isEmpty(updateData)) {
          await doc.update(updateData, { enforceTypes: false });
          affected += 1;
        }
      }
    } catch (err) {
      game.D35E.logger.error(`migrateLegacyAlignment failed for ${doc.name} in ${pack.collection}:`, err);
    }
  }
  return affected;
};

export const migrateSceneAlignmentData = function(scene) {
  const tokenUpdates = [];
  for (const token of scene.tokens ?? []) {
    const t = token.toJSON ? token.toJSON() : foundry.utils.duplicate(token);
    if (!t.actorData || t.actorLink) continue;
    const updateData = legacyAlignmentUpdate({ system: t.actorData.system ?? t.actorData.data });
    if (foundry.utils.isEmpty(updateData)) continue;

    const expanded = foundry.utils.expandObject(updateData);
    foundry.utils.mergeObject(t.actorData, expanded.system ? { system: expanded.system } : expanded);
    tokenUpdates.push(t);
  }
  return tokenUpdates.length ? { tokens: tokenUpdates } : {};
};

/* -------------------------------------------- */

/**
 * Apply migration rules to all Entities within a single Compendium pack
 * @param pack
 * @return {Promise}
 */
export const migrateCompendium = async function(pack) {
  const entity = pack.documentName;
  if ( !["Actor", "Item", "Scene"].includes(entity) ) return 0;
  let content = []
  let affected = 0;
  try {
    // Begin by requesting server-side data model migration and get the migrated content
    await pack.migrate();
    content = await pack.getDocuments();
  } catch(err) {
    ui.notifications.error(game.i18n.localize("D35E.ErrorProblemWithMigratingPack") + pack.collection);
    game.D35E.logger.error(err);
  }

  game.D35E.logger.log(`Starting migration of ${pack.collection}`)
  // Iterate over compendium entries - applying fine-tuned migration functions
  for ( let ent of content ) {
    try {
      let updateData = null;
      if (entity === "Item") {
        if (await migrateItem(ent)) affected += 1;
      }
      else if (entity === "Actor") {
        if (await migrateActor(ent)) affected += 1;
      }
      else if ( entity === "Scene" ) {
        updateData = await migrateSceneData(ent);
        if (!foundry.utils.isEmpty(updateData)) {
          await ent.update(updateData, { enforceTypes: false });
          affected += 1;
        }
      }

      //game.D35E.logger.log(`Migrated ${entity} entity ${ent.name} in Compendium ${pack.collection}`);
    } catch(err) {
      game.D35E.logger.error(err);
    }
  }
  game.D35E.logger.log(`Migrated all ${entity} entities from Compendium ${pack.collection}`);
  return affected;
};

/* -------------------------------------------- */
/*  Entity Type Migration Helpers               */
/* -------------------------------------------- */


/**
 * Migrate a single Actor entity to incorporate latest data model changes
 * Return an Object of updateData to be applied
 * @param {Actor} actor   The actor to Update
 * @return {Object}       The updateData to apply
 */
export const migrateActorData = async function(actor, itemsToAdd) {
  const updateData = {};
  _migrateCharacterLevel(actor, updateData);
  _migrateActorEncumbrance(actor, updateData);
  _migrateActorDefenseNotes(actor, updateData);
  _migrateActorSpeed(actor, updateData);
  _migrateSpellDivineFocus(actor, updateData);
  _migrateActorSpellbookSlots(actor, updateData);
  _migrateActorBaseStats(actor, updateData);
  _migrateActorCreatureType(actor, updateData);
  _migrateActorSpellbookDCFormula(actor, updateData);
  _migrateActorRace(actor, updateData)
  _migrateActorTokenVision(actor, updateData);
  _migrateActorSkillRanksToPoints(actor, updateData);
  await _migrateWeaponProficiencies(actor,updateData,itemsToAdd)
  await _migrateArmorProficiencies(actor,updateData,itemsToAdd)

  if (!actor.items) return updateData;
  const items = actor.items.reduce((arr, i) => {
    // Migrate the Owned Item
    const itemData = i instanceof CONFIG.Item.documentClass ? i.toObject() : i;
    const itemUpdate = migrateItemData(itemData);

    // Update the Owned Item
    if (!foundry.utils.isEmpty(itemUpdate)) {
      itemUpdate._id = itemData._id;
      arr.push(foundry.utils.expandObject(itemUpdate));
    }

    return arr;
  }, []);
  if (items.length > 0) updateData.items = items;
  return updateData;

};

/* -------------------------------------------- */

/**
 * Migrate a single Item entity to incorporate latest data model changes
 * @param item
 */
const _migrateIntelligentItem = function (item, updateData) {
  if (!["weapon", "equipment"].includes(item.type)) return;
  if (item.system?.intelligent !== undefined) return;
  updateData["system.intelligent"] = IntelligentItemHelper.defaultIntelligentShape();
};

export const migrateItemData = function(item) {
  const updateData = {};

  _migrateIcon(item, updateData);
  _migrateItemSpellUses(item, updateData);
  _migrateWeaponDamage(item, updateData);
  _migrateWeaponImprovised(item, updateData);
  _migrateSpellDescription(item, updateData);
  _migrateItemDC(item, updateData);
  _migrateClassDynamics(item, updateData);
  _migrateClassType(item, updateData);
  _migrateWeaponCategories(item, updateData);
  _migrateEquipmentCategories(item, updateData);
  _migrateWeaponSize(item, updateData);
  _migrateContainer(item, updateData);
  _migrateEnhancement(item, updateData);
  _migrateEnhancementCraftingRequirements(item, updateData);
  _migrateIntelligentItem(item, updateData);
  _migrateSpellName(item, updateData);
  _migrateClassSpellbook(item, updateData);
  _migrateSpellDuration(item, updateData);

  // Return the migrated update data
  return updateData;
};

/* -------------------------------------------- */

/**
 * Migrate a single Scene document to incorporate changes to the data model of it's actor data overrides
 * Return an Object of updateData to be applied
 *
 * @param {object} scene - The Scene to Update
 * @returns {object} The updateData to apply
 */
 export const migrateSceneData = function (scene) {
  const tokens = scene.tokens.map((token) => {
    const t = token.toJSON();
    if (!t.actorId || t.actorLink) {
      t.actorData = {};
    } else if (!game.actors.has(t.actorId)) {
      t.actorId = null;
      t.actorData = {};
    } else if (!t.actorLink) {
      const actorData = {};
      actorData.type = token.actor?.type;
      actorData.data = foundry.utils.duplicate(t.actorData)
      const update = migrateActorData(actorData, token);
      ["items", "effects"].forEach((embeddedName) => {
        if (!update[embeddedName]?.length) return;
        const updates = new Map(update[embeddedName].map((u) => [u._id, u]));
        t.actorData[embeddedName].forEach((original) => {
          const update = updates.get(original._id);
          if (update) foundry.utils.mergeObject(original, update);
        });
        delete update[embeddedName];
      });

      foundry.utils.mergeObject(t.actorData, update);
    }
    return t;
  });
  return { tokens };
};



const _migrateActorTokenVision = function(ent, updateData) {
  const vision = foundry.utils.getProperty(ent.data, "data.attributes.vision");
  if (!vision) return;

  updateData["data.attributes.-=vision"] = null;
  updateData["token.flags.D35E.lowLightVision"] = vision.lowLight;
  if (!foundry.utils.getProperty(ent.data, "token.brightSight")) updateData["token.brightSight"] = vision.darkvision;
};

const _migrateActorSkillRanksToPoints = function(ent, updateData) {
  
  for (let [sklKey, skl] of Object.entries(ent.system?.skills || {})) {
    if (skl.points !== undefined) continue;
    updateData[`data.skills.${sklKey}.points`] = skl.rank;
    for (let [subSklKey, subSkl] of Object.entries(skl.subSkills || {})) {
      if (subSkl.points !== undefined) continue;
      updateData[`data.skills.${sklKey}.subSkills.${subSklKey}.points`] = subSkl.rank; 
    }
}

  let data = foundry.utils.duplicate(ent.system?.details?.levelUpData || []);
  if (data) {
    data.forEach(a => {
      for (let skill of Object.entries(a.skills || {})) {
        if (skill[1].points !== undefined) continue;
        skill[1].points = skill[1].rank
        if (skill[1].subskills) {
          for (let skl of Object.entries(skill[1].subskills || {})) {
            if (skl[1].points !== undefined) continue;
            skl[1].points = skl[1].rank
          }
        }
      }
    })
    updateData[`data.details.levelUpData`] = data;
  }
};

const migrateTokenVision = function(token, updateData) {
  if (!token.actor) return;

  foundry.utils.setProperty(updateData, "flags.D35E.lowLightVision", foundry.utils.getProperty(token.actor.system, "token.flags.D35E.lowLightVision"));
  foundry.utils.setProperty(updateData, "brightSight", foundry.utils.getProperty(token.actor.system, "token.brightSight"));
};



/* -------------------------------------------- */
/*  Low level migration utilities
/* -------------------------------------------- */

/**
 * Migrate string format traits with a comma separator to an array of strings.
 * Runs per-actor; called by migrateActorTraits().
 * @private
 */
const _migrateActorTraits = function(actor, updateData) {
  if ( !actor.data.traits ) return;
  // Use a hardcoded English→key map: migration reads legacy stored English
  // strings (pre-i18n), so we cannot rely on the localized config values.
  const dt = {
    "Bludgeoning": "bludgeoning", "Piercing": "piercing", "Slashing": "slashing",
    "Cold": "cold", "Fire": "fire", "Electricity": "electric", "Sonic": "sonic",
    "Acid": "acid", "Force": "force", "Negative": "negative", "Positive": "positive",
  };
  const map = {
    "dr": dt,
    "di": dt,
    "dv": dt,
    "ci": invertObject(CONFIG.D35E.conditionTypes),
    "languages": invertObject(CONFIG.D35E.languages)
  };
  for ( let [t, choices] of Object.entries(map) ) {
    const trait = actor.data.traits[t];
    if ( trait && (typeof trait.value === "string") ) {
      updateData[`data.traits.${t}.value`] = trait.value.split(",").map(t => choices[t.trim()]).filter(t => !!t);
    }
  }
};

/**
 * Standalone migration: convert legacy comma-separated trait strings to arrays.
 * Iterates all world actors and applies _migrateActorTraits to any that still
 * store dr/di/dv/ci/languages as a plain string.
 *
 * Intended to be called as a discrete, named migration step so future tooling
 * can track and skip it once it has been applied to a world.
 *
 * @return {Promise}
 */
export const migrateActorTraits = async function() {
  if (!game.user.isGM) return ui.notifications.error(game.i18n.localize("D35E.ErrorUnauthorizedAction"));
  for (const actor of game.actors.contents) {
    try {
      const updateData = {};
      _migrateActorTraits(actor, updateData);
      if (!foundry.utils.isEmpty(updateData)) await actor.update(updateData);
    } catch (err) {
      game.D35E.logger.error(`migrateActorTraits failed for actor ${actor.name}:`, err);
    }
  }
};

/* -------------------------------------------- */


/**
 * Flatten several attributes which currently have an unnecessarily nested {value} object
 * @private
 */
const _migrateFlattenValues = function(ent, updateData, toFlatten) {
  for ( let a of toFlatten ) {
    const attr = foundry.utils.getProperty(ent.data, a);
    if ( attr instanceof Object && !updateData.hasOwnProperty("data."+a) ) {
      updateData["data."+a] = attr.hasOwnProperty("value") ? attr.value : null;
    }
  }
};

const _migrateAddValues = function(ent, updateData, toAdd) {
  for (let [k, v] of Object.entries(toAdd)) {
    const attr = foundry.utils.getProperty(ent.data, k);
    if (!attr && !updateData.hasOwnProperty(k)) {
      updateData[k] = v;
    }
  }
};

/* -------------------------------------------- */

const _migrateCharacterLevel = function(ent, updateData) {
  const arr = ["details.level.value", "details.level.min", "details.level.max"];
  for (let k of arr) {
    const value = foundry.utils.getProperty(ent.system, k);
    if (value == null) {
      updateData["data."+k] = 0;
    }
  }
  let k = "details.levelUpProgression"
  const value = foundry.utils.getProperty(ent.system, k);
  //game.D35E.logger.log(`Migrate | Level up progression ${value}`)
  if (value === null || value === undefined) {

    updateData["data.details.levelUpProgression"] = false;
  }
};

const _migrateActorEncumbrance = function(ent, updateData) {
  const arr = ["attributes.encumbrance.level", "attributes.encumbrance.levels.light",
  "attributes.encumbrance.levels.medium", "attributes.encumbrance.levels.heavy",
  "attributes.encumbrance.levels.carry", "attributes.encumbrance.levels.drag",
  "attributes.encumbrance.carriedWeight"];
  for (let k of arr) {
    const value = foundry.utils.getProperty(ent.system, k);
    if (value == null) {
      updateData["data."+k] = 0
    }
  }
};

const _migrateWeaponProficiencies = async function(actor, updateData, itemsToAdd) {
  if (!itemsToAdd) return;
  let weaponProfItemId = "F7ouXcMvMxDFNq8S";
  let martialWeaponProfItemId = "L6Zih954XajPhxk0";
  let simpleWeaponProfItemId = "5jR5ehCRndtJpCGb";
  let pack = game.packs.get("warcraftrpg2e.feats");
  if (!(actor instanceof Actor)) return;
  let data = actor.system;
  if (data.traits && data.traits.weaponProf && data.traits.weaponProf.value) {
    if (data.traits.weaponProf.value.indexOf("sim") !== -1) {
      let item = await pack.getDocument(simpleWeaponProfItemId)
      let data = foundry.utils.duplicate(item.data);
      delete data._id;
      itemsToAdd.push(data);
    }
    if (data.traits.weaponProf.value.indexOf("mar") !== -1) {
      let item = await pack.getDocument(martialWeaponProfItemId)
      let data = foundry.utils.duplicate(item.data);
      delete data._id;
      itemsToAdd.push(data);
    }
    updateData["data.traits.weaponProf.value"] = [];
  }
  if (data.traits && data.traits.weaponProf && data.traits.weaponProf.custom) {
    let weaponProfsCustom =  data.traits.weaponProf.custom.split(";");
    for (const weaponName of weaponProfsCustom) {
      let item = await pack.getDocument(weaponProfItemId)
      let data = foundry.utils.duplicate(item.data);
      delete data._id;
      data.data.customAttributes["_87nolel8u"].value = weaponName
      data.name = data.data.nameFormula.replace("${this.custom.weaponname}",weaponName)
      itemsToAdd.push(data);
    }
    updateData["data.traits.weaponProf.custom"] = '';
  }
}

const _migrateArmorProficiencies = async function(actor, updateData, itemsToAdd) {
  if (!itemsToAdd) return;
  let spr = "AfSyZ6BqEOyyDzBD"
  let sprTower = "L2aYtdPHUaGH8UPE"
  let armProfLight = "tflks0QMIbzAyEle"
  let armProfMed = "ZwIMzns2opN6xxIo"
  let armProfHeavy = "sh3SLeHp45GMtm3n"
  let pack = game.packs.get("warcraftrpg2e.feats");
  if (!(actor instanceof Actor)) return;
  let data = actor.system;
  if (data.traits && data.traits.weaponProf && data.traits.armorProf.value) {
    if (data.traits.armorProf.value.indexOf("twr") !== -1) {
      let item = await pack.getDocument(sprTower)
      let data = foundry.utils.duplicate(item.data);
      delete data._id;
      itemsToAdd.push(data);
    }
    if (data.traits.armorProf.value.indexOf("shl") !== -1) {
      let item = await pack.getDocument(spr)
      let data = foundry.utils.duplicate(item.data);
      delete data._id;
      itemsToAdd.push(data);
    }
    if (data.traits.armorProf.value.indexOf("lgt") !== -1) {
      let item = await pack.getDocument(armProfLight)
      let data = foundry.utils.duplicate(item.data);
      delete data._id;
      itemsToAdd.push(data);
    }
    if (data.traits.armorProf.value.indexOf("med") !== -1) {
      let item = await pack.getDocument(armProfMed)
      let data = foundry.utils.duplicate(item.data);
      delete data._id;
      itemsToAdd.push(data);
    }
    if (data.traits.armorProf.value.indexOf("hvy") !== -1) {
      let item = await pack.getDocument(armProfHeavy)
      let data = foundry.utils.duplicate(item.data);
      delete data._id;
      itemsToAdd.push(data);
    }
    updateData["data.traits.armorProf.value"] = [];
  }

}


const _migrateActorRace = function(actor, updateData) {
  // if (!(actor instanceof Actor)) return;
  // if (actor.race == null) return;
  //
  // if (item.type === "race") {
  //   actor.race.update(item);
  //   return false;
  // }
}


const _migrateActorDefenseNotes = function(ent, updateData) {
  const arr = ["attributes.acNotes", "attributes.cmdNotes", "attributes.srNotes"];
  for (let k of arr) {
    const value = foundry.utils.getProperty(ent.system, k);
    if (value == null) {
      updateData["data."+k] = "";
    }
  }
};

const _migrateActorSpeed = function(ent, updateData) {
  const arr = ["attributes.speed.land", "attributes.speed.climb", "attributes.speed.swim", "attributes.speed.fly", "attributes.speed.burrow"];
  for (let k of arr) {
    let value = foundry.utils.getProperty(ent.system, k);
    if (typeof value === "string") value = parseInt(value);
    if (typeof value === "number") {
      updateData[`data.${k}.base`] = value;
      updateData[`data.${k}.total`] = value;
    }
    else if (value == null) {
      updateData[`data.${k}.base`] = 0;
      updateData[`data.${k}.total`] = null;
    }

    // Add maneuverability
    if (k === "attributes.speed.fly" && foundry.utils.getProperty(ent.system, `${k}.maneuverability`) === undefined) {
      updateData[`data.${k}.maneuverability`] = "average";
    }
  }
};

const _migrateActorSpellbookSlots = function(ent, updateData) {
  for (let spellbookSlot of Object.keys(foundry.utils.getProperty(ent.system, "attributes.spells.spellbooks") || {})) {
    if (foundry.utils.getProperty(ent.system, `attributes.spells.spellbooks.${spellbookSlot}.autoSpellLevels`) == null) {
      updateData[`data.attributes.spells.spellbooks.${spellbookSlot}.autoSpellLevels`] = true;
    }

    for (let a = 0; a < 10; a++) {
      const baseKey = `data.attributes.spells.spellbooks.${spellbookSlot}.spells.spell${a}.base`;
      const maxKey = `data.attributes.spells.spellbooks.${spellbookSlot}.spells.spell${a}.max`;
      const base = foundry.utils.getProperty(ent.data, baseKey);
      const max = foundry.utils.getProperty(ent.data, maxKey);
      if (base === undefined && typeof max === "number" && max > 0) {
        updateData[baseKey] = max.toString();
      }
      else if (base === undefined) {
        updateData[baseKey] = "";
      }
    }
  }
};

const _migrateActorBaseStats = function(ent, updateData) {
  const keys = ["attributes.hp.base", "attributes.hd.base", "attributes.savingThrows.fort.value",
    "attributes.savingThrows.ref.value", "attributes.savingThrows.will.value"];
  for (let k of keys) {
    if (k === "attributes.hp.base" && !(foundry.utils.getProperty(ent, "items") || []).filter(o => o.type === "class")?.length) continue;
    if (foundry.utils.getProperty(ent.system, k) != null) {
      let kList = k.split(".");
      kList[kList.length-1] = `-=${kList[kList.length-1]}`;
      updateData[`data.${kList.join(".")}`] = null;
    }
  }

  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.wildshaped") == null) {
    updateData["data.attributes.conditions.wildshaped"] = false;
  }

  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.polymorphed") == null) {
    updateData["data.attributes.conditions.polymorphed"] = false;
  }
  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.prone") == null) {
    updateData["data.attributes.conditions.prone"] = false;
  }
  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.dead") == null) {
    updateData["data.attributes.conditions.dead"] = false;
  }
  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.dying") == null) {
    updateData["data.attributes.conditions.dying"] = false;
  }
  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.disabled") == null) {
    updateData["data.attributes.conditions.disabled"] = false;
  }
  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.stable") == null) {
    updateData["data.attributes.conditions.stable"] = false;
  }
  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.staggered") == null) {
    updateData["data.attributes.conditions.staggered"] = false;
  }
  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.unconscious") == null) {
    updateData["data.attributes.conditions.unconscious"] = false;
  }
  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.invisibility")) {
    updateData["data.attributes.conditions.invisibility"] = null;
  }
  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.invisible") == null) {
    updateData["data.attributes.conditions.invisible"] = false;
  }
  if (foundry.utils.getProperty(ent.data, "data.attributes.conditions.banished") == null) {
    updateData["data.attributes.conditions.banished"] = false;
  }


};

const _migrateActorCreatureType = function(ent, updateData) {
  if (foundry.utils.getProperty(ent.data, "data.attributes.creatureType") == null) {
    updateData["data.attributes.creatureType"] = "humanoid";
  }
};

const _migrateActorSpellbookDCFormula = function(ent, updateData) {
  const spellbooks = Object.keys(foundry.utils.getProperty(ent.data, "data.attributes.spells.spellbooks") || {});

  for (let k of spellbooks) {
    const key = `data.attributes.spells.spellbooks.${k}.baseDCFormula`;
    const curFormula = foundry.utils.getProperty(ent.data, key);
    if (curFormula == null) updateData[key] = "10 + @sl + @ablMod";
  }
};

const _migrateIcon = function(ent, updateData) {
  const value = foundry.utils.getProperty(ent.data, "img") || "";
  if (value.endsWith("/con.png")) updateData["img"] = value.replace("/con.png","/con_.png");
};

const _migrateItemSpellUses = function(ent, updateData) {
  if (foundry.utils.getProperty(ent.system, "preparation") === undefined) return;

  const value = foundry.utils.getProperty(ent.system, "preparation.maxAmount");
  if (typeof value !== "number") updateData["data.preparation.maxAmount"] = 0;
};

const _migrateWeaponDamage = function(ent, updateData) {
  if (ent.type !== "weapon") return;

  const value = foundry.utils.getProperty(ent.system, "weaponData");
  if (typeof value !== "object") {
    updateData["data.weaponData"] = {};
    updateData["data.weaponData.critRange"] = 20;
    updateData["data.weaponData.critMult"] = 2;
  }

  if (foundry.utils.getProperty(ent.data, "data.threatRangeExtended") == null) {
    updateData["data.threatRangeExtended"] = false;
  }
  if (foundry.utils.getProperty(ent.data, "data.finesseable") == null) {
    updateData["data.finesseable"] = false;
  }
};

const _migrateEnhancement = function(ent, updateData) {
  if (ent.type !== "weapon" || ent.type !== "equipment" ) return;

  const value = foundry.utils.getProperty(ent.system, "enhancement");
  if (typeof value !== "object") {
    updateData["data.enhancement"] = {};
    updateData["data.enhancement.items"] = [];
    updateData["data.enhancement.uses"] = {
          "value": 0,
          "max": 0,
          "per": null,
          "autoDeductCharges": true,
          "allowMultipleUses": false
    };
  }
};

/**
 * Crafting text for enhancement items lived under system.requirements (colliding with the changes-tab array).
 * Move to system.enhancementRequirements (string) and drop system.requirements on enhancement docs
 * and on rows embedded in weapon / equipment enhancements.items.
 */
const _migrateEnhancementCraftingRequirements = function(item, updateData) {
  const migrateEnhSystem = function (sys) {
    if (!sys || typeof sys !== "object") return false;
    if (!Object.prototype.hasOwnProperty.call(sys, "requirements")) return false;
    const req = sys.requirements;
    if (typeof req !== "string") return false;
    const existing = sys.enhancementRequirements;
    const existingStr = existing !== undefined && existing !== null ? String(existing) : "";
    sys.enhancementRequirements = existingStr.length > 0 ? existingStr : req;
    delete sys.requirements;
    return true;
  };

  if (item.type === "enhancement") {
    const sys = item.system || {};
    if (!Object.prototype.hasOwnProperty.call(sys, "requirements")) return;
    const req = sys.requirements;
    if (typeof req !== "string") return;
    const existing = sys.enhancementRequirements;
    const existingStr = existing !== undefined && existing !== null ? String(existing) : "";
    updateData["system.enhancementRequirements"] = existingStr.length > 0 ? existingStr : req;
    updateData["system.requirements"] = [];
    return;
  }

  if (item.type !== "weapon" && item.type !== "equipment") return;
  const items = foundry.utils.getProperty(item, "system.enhancements.items");
  if (!Array.isArray(items) || !items.length) return;

  const next = foundry.utils.duplicate(items);
  let changed = false;
  for (const ent of next) {
    const merged = foundry.utils.mergeObject(foundry.utils.duplicate(ent.data || {}), ent.system || {});
    if (!migrateEnhSystem(merged)) continue;
    ent.system = merged;
    delete ent.data;
    changed = true;
  }
  if (changed) updateData["system.enhancements.items"] = next;
};

const _migrateWeaponImprovised = function(ent, updateData) {
  if (ent.type !== "weapon") return;

  const value = foundry.utils.getProperty(ent.system, "weaponType");
  if (value === "improv") {
    updateData["data.weaponType"] = "misc";
    updateData["data.properties.imp"] = true;
  }
};

const _migrateSpellName = function(ent, updateData) {
  if (ent.type !== "spell") return;
  updateData["name"] = (ent.data.name || ent.name).trim()
}

const _migrateSpellDuration = function(ent, updateData) {
  if (ent.type !== "spell") return;
  let duration = (foundry.utils.getProperty(ent.system, "spellDuration") || "").toLowerCase().trim()
  if (!duration)
    return;
  let newDurationUnits = "spec"
  let value = parseInt(duration) || "";
  if (isNaN(value) || !value)
    value = "";
  let dismissable = false;
  if (duration.indexOf("(d)") !== -1) {
    dismissable = true;
  }

  function __updateValuePerLevel() {
    if (value === "1") {
      value = "@cl"
    } else {
      value = value + "*@cl"
    }
  }

  if (duration.indexOf("concentration") !== -1) {
    newDurationUnits = "spec"
    value = foundry.utils.getProperty(ent.system, "spellDuration").replace("(D)","").trim();
  }
  else if (duration.indexOf("until discharged") !== -1) {
    newDurationUnits = "spec"
    value = foundry.utils.getProperty(ent.system, "spellDuration").replace("(D)","").trim();
  }
  else if (duration.indexOf("see text") !== -1) {
    newDurationUnits = "seeText"
  }
  else if (duration.indexOf("round/level") !== -1) {
    newDurationUnits = "roundPerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("rounds/level") !== -1) {
    newDurationUnits = "roundPerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("hour/level") !== -1) {
    newDurationUnits = "hourPerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("hours/level") !== -1) {
    newDurationUnits = "hourPerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("minute/level") !== -1) {
    newDurationUnits = "minutePerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("minutes/level") !== -1) {
    newDurationUnits = "minutePerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("min./level") !== -1) {
    newDurationUnits = "minutePerLevel"
    __updateValuePerLevel();
  }
  else if (duration.indexOf("rounds") !== -1) {
    newDurationUnits = "rounds"
  }
  else if (duration.indexOf("turns") !== -1) {
    newDurationUnits = "turns"
  }
  else if (duration.indexOf("hour") !== -1) {
    newDurationUnits = "hour"
  }
  else if (duration.indexOf("hour") !== -1) {
    newDurationUnits = "hour"
  }
  else if (duration.indexOf("day") !== -1) {
    newDurationUnits = "days"
  }
  else if (duration.indexOf("days") !== -1) {
    newDurationUnits = "days"
  }
  else if (duration.indexOf("instantaneous") !== -1) {
    newDurationUnits = "inst"
  }
  else if (duration.indexOf("permanent") !== -1) {
    newDurationUnits = "perm"
  }

  const oldValue = foundry.utils.getProperty(ent.system, "spellDurationData.units");
  if (!oldValue || true) {
    updateData["data.spellDurationData"] = {value: value, units: newDurationUnits, dismissable: dismissable}
  }

}


const _migrateClassSpellbook = function(ent, updateData) {
  if (ent.type !== "class") return;
  const curValue = foundry.utils.getProperty(ent.system, "spellbook");
  if (curValue != null || (curValue?.length || 0) > 0) return;
  let spellbook = []
  for (let a = 0; a < 10; a++) {
    spellbook.push({level: a, spells: []})
  }
  updateData["data.spellbook"] = spellbook;
}

const _migrateSpellDescription = function(ent, updateData) {
  if (ent.type !== "spell") return;

  const curValue = foundry.utils.getProperty(ent.system, "shortDescription");
  if (curValue != null) return;

  const obj = foundry.utils.getProperty(ent.system, "description.value");
  if (typeof obj !== "string") return;
  const temp = document.createElement("div");
  temp.innerHTML = obj;
  const h2 = temp.querySelector("h2");
  const elem = h2 ? h2.nextElementSibling : null;
  if (elem) updateData["data.shortDescription"] = elem.outerHTML;
  else updateData["data.shortDescription"] = temp.innerHTML;
};

const _migrateSpellDivineFocus = function(ent, updateData) {
  if (ent.type !== "spell") return;

  const value = foundry.utils.getProperty(ent.system, "components.divineFocus");
  if (typeof value === "boolean") updateData["data.components.divineFocus"] = (value === true ? 1 : 0);
};

const _migrateItemDC = function(ent, updateData) {
  // const value = foundry.utils.getProperty(ent.system, "save.type");
  // if (value == null) return;
  // if (value === "") updateData["data.save.description"] = "";
  // else if (value === "fort") updateData["data.save.description"] = "Fortitude partial";
  // else if (value === "ref") updateData["data.save.description"] = "Reflex half";
  // else if (value === "will") updateData["data.save.description"] = "Will negates";
  // updateData["data.save.-=type"] = null;
};

const _migrateClassDynamics = function(ent, updateData) {
  if (ent.type !== "class") return;

  const bab = foundry.utils.getProperty(ent.system, "bab");
  if (typeof bab === "number") updateData["data.bab"] = "low";

  const stKeys = ["data.savingThrows.fort.value", "data.savingThrows.ref.value", "data.savingThrows.will.value"];
  for (let key of stKeys) {
    let value = foundry.utils.getProperty(ent.data, key);
    if (typeof value === "number") updateData[key] = "low";
  }
};

const _migrateClassType = function(ent, updateData) {
  if (ent.type !== "class") return;

  if (foundry.utils.getProperty(ent.system, "classType") == null) updateData["data.classType"] = "base";


  if (foundry.utils.getProperty(ent.system, "powersKnown" === null)) {
    let powersKnown = {}
    for (let i = 1; i <= 20; i++) {
      powersKnown[i] = 0;
    }
    updateData["data.powersKnown"] = powersKnown
  }
  if (foundry.utils.getProperty(ent.system, "powerPointTable" === null)) {
    let powerPointTable = {}
    for (let i = 1; i <= 20; i++) {
      powerPointTable[i] = 0;
    }
    updateData["data.powerPointTable"] = powerPointTable
  }
  if (foundry.utils.getProperty(ent.system, "powersMaxLevel" === null)) {
    let powersMaxLevel = {}
    for (let i = 1; i <= 20; i++) {
      powersMaxLevel[i] = 0;
    }
    updateData["data.powersMaxLevel"] = powersMaxLevel
  }
};

const _migrateWeaponCategories = function(ent, updateData) {
  if (ent.type !== "weapon") return;

  // Change category
  const type = foundry.utils.getProperty(ent.system, "weaponType");
  if (type === "misc") {
    updateData["data.weaponType"] = "misc";
    updateData["data.weaponSubtype"] = "other";
  }
  else if (type === "splash") {
    updateData["data.weaponType"] = "misc";
    updateData["data.weaponSubtype"] = "splash";
  }

  const changeProp = (["simple", "martial", "exotic"].includes(type));
  if (changeProp && foundry.utils.getProperty(ent.system, "weaponSubtype") == null) {
    updateData["data.weaponSubtype"] = "1h";
  }

  // Change light property
  const lgt = foundry.utils.getProperty(ent.system, "properties.lgt");
  if (lgt != null) {
    updateData["data.properties.-=lgt"] = null;
    if (lgt === true && changeProp) {
      updateData["data.weaponSubtype"] = "light";
    }
  }

  // Change two-handed property
  const two = foundry.utils.getProperty(ent.system, "properties.two");
  if (two != null) {
    updateData["data.properties.-=two"] = null;
    if (two === true && changeProp) {
      updateData["data.weaponSubtype"] = "2h";
    }
  }

  // Change melee property
  const melee = foundry.utils.getProperty(ent.system, "weaponData.isMelee");
  if (melee != null) {
    updateData["data.weaponData.-=isMelee"] = null;
    if (melee === false && changeProp) {
      updateData["data.weaponSubtype"] = "ranged";
    }
  }
};

const _migrateEquipmentCategories = function(ent, updateData) {
  if (ent.type !== "equipment") return;

  const oldType = foundry.utils.getProperty(ent.system, "armor.type");
  if (oldType == null) return;

  if (oldType === "clothing") {
    updateData["data.equipmentType"] = "misc";
    updateData["data.equipmentSubtype"] = "clothing";
  }
  else if (oldType === "shield") {
    updateData["data.equipmentType"] = "shield";
    updateData["data.equipmentSubtype"] = "lightShield";
    updateData["data.slot"] = "shield";
  }
  else if (oldType === "misc") {
    updateData["data.equipmentType"] = "misc";
    updateData["data.equipmentSubtype"] = "wondrous";
  }
  else if (["light", "medium", "heavy"].includes(oldType)) {
    updateData["data.equipmentType"] = "armor";
    updateData["data.equipmentSubtype"] = `${oldType}Armor`;
  }

  updateData["data.armor.-=type"] = null;
};

const _migrateWeaponSize = function(ent, updateData) {
  if (ent.type !== "weapon") return;
  
  if (!foundry.utils.getProperty(ent.data, "data.weaponData.size")) {
    updateData["data.weaponData.size"] = "med";
  }
};

const _migrateContainer = function(ent, updateData) {
  if (!foundry.utils.getProperty(ent.data, "data.quantity")) return;

  if (!foundry.utils.getProperty(ent.data, "data.container")) {
    updateData["data.container"] = "None";
    updateData["data.containerId"] = "none";
    updateData["data.containerWeightless"] = false;
  }
};

/* -------------------------------------------- */

/**
 * Migrate from a string spell casting time like "1 Bonus Action" to separate fields for activation type and numeric cost
 * @private
 */
const _migrateCastTime = function(item, updateData) {
  const value = foundry.utils.getProperty(item.data, "time.value");
  if ( !value ) return;
  const ATS = invertObject(CONFIG.D35E.abilityActivationTypes);
  let match = value.match(/([\d]+\s)?([\w\s]+)/);
  if ( !match ) return;
  let type = ATS[match[2]] || "none";
  let cost = match[1] ? Number(match[1]) : 0;
  if ( type === "none" ) cost = 0;
  updateData["data.activation"] = {type, cost};
};

/* -------------------------------------------- */
/*  General Migrations                          */
/* -------------------------------------------- */

/**
 * Migrate from a string based damage formula like "2d6 + 4 + 1d4" and a single string damage type like "slash" to
 * separated damage parts with associated damage type per part.
 * @private
 */
const _migrateDamage = function(item, updateData) {

  // Regular Damage
  let damage = item.data.damage;
  if ( damage && damage.value ) {
    let type = item.data.damageType ? item.data.damageType.value : "";
    const parts = damage.value.split("+").map(s => s.trim()).map(p => [p, type || null]);
    if ( item.type === "weapon" && parts.length ) parts[0][0] += " + @mod";
    updateData["data.damage.parts"] = parts;
    updateData["data.damage.-=value"] = null;
  }
};

/* -------------------------------------------- */

/**
 * Migrate from a string duration field like "1 Minute" to separate fields for duration units and numeric value
 * @private
 */
const _migrateDuration = function(item, updateData) {
  const TIME = invertObject(CONFIG.D35E.timePeriods);
  const dur = item.data.duration;
  if ( dur && dur.value && !dur.units ) {
    let match = dur.value.match(/([\d]+\s)?([\w\s]+)/);
    if ( !match ) return;
    let units = TIME[match[2]] || "inst";
    let value = units === "inst" ? "" : Number(match[1]) || "";
    updateData["data.duration"] = {units, value};
  }
};

/* -------------------------------------------- */

/**
 * Migrate from a string range field like "150 ft." to separate fields for units and numeric distance value
 * @private
 */
const _migrateRange = function(item, updateData) {
  if ( updateData["data.range"] ) return;
  const range = item.data.range;
  if ( range && range.value && !range.units ) {
    let match = range.value.match(/([\d\/]+)?(?:[\s]+)?([\w\s]+)?/);
    if ( !match ) return;
    let units = "none";
    if ( /ft/i.test(match[2]) ) units = "ft";
    else if ( /mi/i.test(match[2]) ) units = "mi";
    else if ( /touch/i.test(match[2]) ) units = "touch";
    updateData["data.range.units"] = units;

    // Range value
    if ( match[1] ) {
      let value = match[1].split("/").map(Number);
      updateData["data.range.value"] = value[0];
      if ( value[1] ) updateData["data.range.long"] = value[1];
    }
  }
};

/* -------------------------------------------- */

const _migrateRarity = function(item, updateData) {
  const rar = item.data.rarity;
  if ( (rar instanceof Object) && !rar.value ) updateData["data.rarity"] = "Common";
  else if ( (typeof rar === "string") && (rar === "") ) updateData["data.rarity"] = "Common";
};

/* -------------------------------------------- */


/**
 * A general migration to remove all fields from the data model which are flagged with a _deprecated tag
 * @private
 */
const _migrateRemoveDeprecated = function(ent, updateData, toFlatten) {
  const flat = foundry.utils.flattenObject(ent.data);

  // Deprecate entire objects
  const toDeprecate = Object.entries(flat).filter(e => e[0].endsWith("_deprecated") && (e[1] === true)).map(e => {
    let parent = e[0].split(".");
    parent.pop();
    return parent.join(".");
  });
  for ( let k of toDeprecate ) {
    let parts = k.split(".");
    parts[parts.length-1] = "-=" + parts[parts.length-1];
    updateData[`data.${parts.join(".")}`] = null;
  }

  // Deprecate types and labels
  for ( let [k, v] of Object.entries(flat) ) {
    let parts = k.split(".");
    parts.pop();

    // Skip any fields which have already been touched by other migrations
    if ( toDeprecate.some(f => k.startsWith(f) ) ) continue;
    if ( toFlatten.some(f => k.startsWith(f)) ) continue;
    if ( updateData.hasOwnProperty(`data.${k}`) ) continue;

    // Remove the data type field
    const dtypes = ["Number", "String", "Boolean", "Array", "Object"];
    if ( k.endsWith("type") && dtypes.includes(v) ) {
      updateData[`data.${k.replace(".type", ".-=type")}`] = null;
    }

    // Remove string label
    else if ( k.endsWith("label") ) {
      updateData[`data.${k.replace(".label", ".-=label")}`] = null;
    }
  }
};

/* -------------------------------------------- */

/**
 * Migrate from a target string like "15 ft. Radius" to a more explicit data model with a value, units, and type
 * @private
 */
const _migrateTarget = function(item, updateData) {
  const target = item.data.target;
  if ( target.value && !Number.isNumeric(target.value) ) {

    // Target Type
    let type = null;
    for ( let t of Object.keys(CONFIG.D35E.targetTypes) ) {
      let rgx = new RegExp(t, "i");
      if ( rgx.test(target.value) ) {
        type = t;
        continue;
      }
    }

    // Target Units
    let units = null;
    if ( /ft/i.test(target.value) ) units = "ft";
    else if ( /mi/i.test(target.value) ) units = "mi";
    else if ( /touch/i.test(target.value) ) units = "touch";

    // Target Value
    let value = null;
    let match = target.value.match(/([\d]+)([\w\s]+)?/);
    if ( match ) value = Number(match[1]);
    else if ( /one/i.test(target.value) ) value = 1;
    updateData["data.target"] = {type, units, value};
  }
};

/* -------------------------------------------- */

/**
 * Migrate from string based components like "V,S,M" to boolean flags for each component
 * Move concentration and ritual flags into the components object
 * @private
 */
const _migrateSpellComponents = function(item, updateData) {
  const components = item.data.components;
  if ( !components.value ) return;
  let comps = components.value.toUpperCase().replace(/\s/g, "").split(",");
  updateData["data.components"] = {
    value: "",
    verbal: comps.includes("V"),
    somatic: comps.includes("M"),
    material: comps.includes("S"),
    concentration: item.data.concentration.value === true,
    ritual: item.data.ritual.value === true
  };
};

/* -------------------------------------------- */

/**
 * Migrate from a simple object with save.value to an expanded object where the DC is also configured
 * @private
 */
const _migrateSpellAction = function(item, updateData) {

  // Set default action type for spells
  if ( item.data.spellType ) {
    updateData["data.actionType"] = {
      "attack": "rsak",
      "save": "save",
      "heal": "heal",
      "utility": "util",
    }[item.data.spellType.value] || "util";
  }

  // Spell saving throw
  const save = item.data.save;
  if ( !save.value ) return;
  updateData["data.save"] = {
    ability: save.value,
    dc: null
  };
  updateData["data.save.-=value"] = null;
};

/* -------------------------------------------- */

/**
 * Migrate spell preparation data to the new preparation object
 * @private
 */
const _migrateSpellPreparation = function(item, updateData) {
  const prep = item.data.preparation;
  if ( prep && !prep.mode ) {
    updateData["data.preparation.mode"] = "prepared";
    updateData["data.preparation.prepared"] = item.data.prepared ? Boolean(item.data.prepared.value) : false;
  }
};

/* -------------------------------------------- */

/**
 * Migrate from a string based weapon properties like "Heavy, Two-Handed" to an object of boolean flags
 * @private
 */
const _migrateWeaponProperties = function(item, updateData) {

  // Set default activation mode for weapons
  updateData["data.activation"] = {type: "action", cost: 1};

  // Set default action type for weapons
  updateData["data.actionType"] = {
    "simpleM": "mwak",
    "simpleR": "rwak",
    "martialM": "mwak",
    "martialR": "rwak",
    "natural": "mwak",
    "improv": "mwak",
    "ammo": "rwak"
  }[item.data.weaponType.value] || "mwak";

  // Set default melee weapon range
  if ( updateData["data.actionType"] === "mwak" ) {
    updateData["data.range"] = {
      value: updateData["data.properties.rch"] ? 10 : 5,
      units: "ft"
    }
  }

  // Map weapon property strings to boolean flags
  const props = item.data.properties;
  if ( props.value ) {
    const labels = invertObject(CONFIG.D35E.weaponProperties);
    for (let k of props.value.split(",").map(p => p.trim())) {
      if (labels[k]) updateData[`data.properties.${labels[k]}`] = true;
    }
    updateData["data.properties.-=value"] = null;
  }
};

const migrateTokenStatuses = function (token, updateData) {
  if (!token.actor) return;

  if (token.effects.length) {
    var effects = token.effects;
    effects = effects.filter((e) => {
      const [key, tex] = Object.entries(CONFIG.D35E.conditionTextures).find((t) => e === t[1]) ?? [];
      if (key && token.actor.system.attributes.conditions[key]) return false;
      if (token.actor.items.find((i) => i.type === "buff" && i.system.active && i.img === e)) return false;
      return true;
    });
  }
  foundry.utils.setProperty(updateData, "effects", effects);
};
