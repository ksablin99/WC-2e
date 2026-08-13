import { getSystemFlag, unsetSystemFlag } from "../../utils/system-flags.js";

export class ItemEquipHook {
  /**
   * Check whether an actor's slot is at or over capacity for the given equipment item.
   * Returns false (not full) for slotless or non-equipment items.
   * @param {Actor} actor
   * @param {Item}  item       The item being equipped
   * @param {string|null} excludeId  Item id to exclude from the count (for updates)
   * @returns {boolean}
   */
  /**
   * Resolve the effective body slot for an equipment item.
   * Armor and shield items use their equipmentType as the slot (the slot field
   * is "slotless" for those subtypes). Misc/wondrous items use system.slot.
   * @param {Item} item
   * @returns {string|null}  slot key, or null if the item occupies no tracked slot
   */
  static getEffectiveSlot(item) {
    if (item.type !== "equipment") return null;
    const equipmentType = item.system?.equipmentType;
    if (equipmentType === "armor")  return "armor";
    if (equipmentType === "shield") return "shield";
    const slot = item.system?.slot;
    return (!slot || slot === "slotless") ? null : slot;
  }

  static isSlotFull(actor, item, excludeId = null) {
    const slot = ItemEquipHook.getEffectiveSlot(item);
    if (!slot) return false;
    const capacity = actor.system?.slotCapacities?.[slot] ?? 1;
    const used = actor.items.filter(i =>
      i.id !== excludeId &&
      i.type === "equipment" &&
      i.system.equipped &&
      ItemEquipHook.getEffectiveSlot(i) === slot
    ).length;
    return used >= capacity;
  }

  /**
   * Show a slot-full warning or (for GMs) a confirmation dialog.
   * Returns a Promise that resolves to true if the equip should proceed.
   * For non-GMs always resolves to false.
   * @param {string} slot
   * @param {number} capacity
   * @returns {Promise<boolean>}
   */
  static async _promptSlotFull(slot, capacity) {
    const slotLabel = game.i18n.localize(`D35E.EquipSlot${slot.charAt(0).toUpperCase()}${slot.slice(1)}`);
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.format("D35E.SlotFull", { slot: slotLabel, capacity }));
      return false;
    }
    return foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("D35E.SlotFullTitle") },
      content: `<p>${game.i18n.format("D35E.SlotFullConfirm", { slot: slotLabel, capacity })}</p>`,
      rejectClose: false,
    });
  }

  /**
   * Returns true if the item has any Changes that grant extra slots.
   */
  static _hasSlotChanges(item) {
    // Changes are stored as arrays: [value, target, subTarget, ...]
    return (item.system?.changes ?? []).some(c => typeof c[2] === "string" && c[2].startsWith("slot."));
  }

  /**
   * Sum slot grants by slot key from a changes array.
   * @param {Array[]} changes
   * @returns {Object}  e.g. { ring: 2, neck: 1 }
   */
  static _slotGrantsFromChanges(changes = []) {
    const grants = {};
    for (const ch of changes) {
      if (typeof ch[2] === "string" && ch[2].startsWith("slot.") && Number(ch[0]) > 0) {
        const key = ch[2].slice(5);
        grants[key] = (grants[key] ?? 0) + Number(ch[0]);
      }
    }
    return grants;
  }

  /**
   * Unequip and clear slotSource for all items that reference this provider.
   * Called when a provider's slot count is reduced so stale position data
   * doesn't leave items in phantom slots.
   */
  static async _clearProviderSlotData(actor, providerName) {
    const affected = actor.items.filter(i => {
      const src = getSystemFlag(i, "slotSource");
      return src === providerName || (src && src.startsWith(providerName + ":"));
    });
    for (const item of affected) {
      if (item.system.equipped) {
        await item.update({ "system.equipped": false }, { _forceUnequip: true });
      }
      await unsetSystemFlag(item, "slotSource");
    }
  }

  /**
   * Unequip all items on the actor that are occupying a slot provided by providerName.
   */
  static async _unequipProviderItems(actor, providerName) {
    const toUnequip = actor.items.filter(i => {
      if (i.type !== "equipment" || !i.system.equipped) return false;
      const src = getSystemFlag(i, "slotSource");
      return src === providerName || (src && src.startsWith(providerName + ":"));
    });
    for (const item of toUnequip) {
      // Keep slotSource so items remember which provider slot they were in —
      // _reequipProviderItems will restore them when the provider is re-equipped.
      await item.update({ "system.equipped": false }, { _forceUnequip: true });
    }
  }

  static async _reequipProviderItems(actor, providerName) {
    const toReequip = actor.items.filter(i => {
      if (i.type !== "equipment" || i.system.equipped) return false;
      const src = getSystemFlag(i, "slotSource");
      return src === providerName || (src && src.startsWith(providerName + ":"));
    });
    for (const item of toReequip) {
      await item.update({ "system.equipped": true }, { _slotBypass: true });
    }
  }

  static register() {
    Hooks.on("preCreateItem", (item, d, options, user) => {
      if (!(item.parent instanceof Actor)) return;
      if (user !== game.userId) return;
      // we care only about items that are equipped
      if (item.system.equipped === true && ['weapon', 'equipment'].includes(item.type)) {
        /**
         * @hook D35E.ItemEquip.preEquipItem
         * The hook is called before an item is equipped (by the means of creating a new item or updating an existing one)
         * The item has not been changed yet, so you can use this hook to modify the item before it is equipped.
         *
         * Params:
         * @param{item} the item being equipped
         * @param{options} the options passed to the creation of the item
         * @param{user} the user that is equipping the item
         */
        Hooks.call("D35E.ItemEquip.preEquipItem", item, options, user)
      }
    });

    Hooks.on("createItem", (item, options, user) => {
      if (!(item.parent instanceof Actor)) return;
      if (user !== game.userId) return;
      if (!['weapon', 'equipment'].includes(item.type)) return;
      if (item.system.equipped !== true) return;

      // Items should always land unequipped when added to an actor — the player
      // equips them explicitly. Skip this only when _slotBypass is set, which
      // means a GM confirmed a force-equip through the slot-full dialog.
      if (!options._slotBypass) {
        item.update({ "system.equipped": false }, { _forceUnequip: true });
        return;
      }

      /**
       * @hook D35E.ItemEquip.postEquipItem
       * The hook is called after an item is equipped (by the means of creating a new item or updating an existing one)
       *
       * Params:
       * @param{item} the item being equipped
       * @param{options} the options passed to the creation of the item
       * @param{user} the user that is equipping the item
       */
      Hooks.call("D35E.ItemEquip.postEquipItem", item, options, user)
    });


    Hooks.on("preDeleteItem", (data, options, user) => {
      if (!(data.parent instanceof Actor)) return;
      if (user !== game.userId) return;
      // deleted items are unequipped
      /**
       * @hook D35E.ItemEquip.preUnequipItem
       * The hook is called before an item is unequipped (by the means of creating a new item or updating an existing one)
       * The item has not been changed yet, so you can use this hook to modify the item before it is unequipped.
       *
       * Params:
       * @param{item} the item being unequipped
       * @param{options} the options passed to the creation of the item
       * @param{user} the user that is equipping the item
       */
      Hooks.call("D35E.ItemEquip.preUnequipItem", data, options, user)
    });

    Hooks.on("deleteItem", (data, options, user) => {
      if (!(data.parent instanceof Actor)) return;
      if (user !== game.userId) return;
      // deleted items are unequipped
      /**
       * @hook D35E.ItemEquip.postUnequipItem
       * The hook is called before an item is unequipped (by the means of creating a new item or updating an existing one)
       *
       * Params:
       * @param{item} the item being unequipped
       * @param{options} the options passed to the creation of the item
       * @param{user} the user that is equipping the item
       */
      Hooks.call("D35E.ItemEquip.postUnequipItem", data, options, user)

      // Auto-unequip items that occupied slots provided by this item
      if (ItemEquipHook._hasSlotChanges(data)) {
        ItemEquipHook._unequipProviderItems(data.parent, data.id).catch(err =>
          console.error("D35E | Error auto-unequipping provider items on delete:", err)
        );
      }
    });


    Hooks.on("preUpdateItem", (data, updateData, options, user) => {
      if (!(data.parent instanceof Actor)) return;
      if (user !== game.userId) return;
      // Internal force-unequip on creation — skip all hook logic
      if (options._forceUnequip) return;

      // Stash provider name before the update mutates the document so that
      // the updateItem hook (which receives the post-mutation document) can cascade.
      if (ItemEquipHook._hasSlotChanges(data)) {
        if (updateData.system?.equipped === false && data.system.equipped === true) {
          options._wasProviderUnequipped = data.id;
        }
        if (updateData.system?.active === false && data.system.active === true) {
          options._wasProviderDeactivated = data.id;
        }
        // Detect if slot grants are being reduced — stash provider id so updateItem
        // can clear stale slotSource data from items in now-gone positions.
        if (updateData.system?.changes !== undefined) {
          const oldGrants = ItemEquipHook._slotGrantsFromChanges(data.system.changes);
          const newGrants = ItemEquipHook._slotGrantsFromChanges(updateData.system.changes);
          const reduced = Object.keys(oldGrants).some(k => (newGrants[k] ?? 0) < oldGrants[k]);
          if (reduced) options._providerSlotsReduced = data.id;
        }
      }

      if (updateData.system?.equipped === undefined) return;
      // Slot capacity check when equipping (false → true), skip on bypass
      if (!options._slotBypass &&
          data.type === "equipment" &&
          data.system.equipped === false &&
          updateData.system.equipped === true) {
        const actor = data.parent;
        if (ItemEquipHook.isSlotFull(actor, data, data.id)) {
          const slot = ItemEquipHook.getEffectiveSlot(data);
          const capacity = actor.system?.slotCapacities?.[slot] ?? 1;
          ItemEquipHook._promptSlotFull(slot, capacity).then(confirmed => {
            if (confirmed) {
              data.update(updateData, { ...options, _slotBypass: true });
            }
          }).catch(err => console.error("D35E | Slot capacity dialog error:", err));
          return false;
        }
      }
      if (data.system.equipped === false && data.system.equipped != updateData.system.equipped && ['weapon', 'equipment'].includes(data.type)) {
        Hooks.call("D35E.ItemEquip.preEquipItem", data, options, user)
      } else if (data.system.equipped === true && data.system.equipped != updateData.system.equipped && ['weapon', 'equipment'].includes(data.type)) {
        Hooks.call("D35E.ItemEquip.preUnequipItem", data, options, user)
      }
    });

    Hooks.on("updateItem", (data, updateData, options, user) => {
      if (!(data.parent instanceof Actor)) return;
      if (user !== game.userId) return;
      if (options._forceUnequip) return;

      // preUpdateItem stashed the provider name in options before the document
      // was mutated; act on it here where async calls are safe.
      if (options._wasProviderUnequipped || options._wasProviderDeactivated) {
        const providerId = options._wasProviderUnequipped ?? options._wasProviderDeactivated;
        ItemEquipHook._unequipProviderItems(data.parent, providerId).catch(err =>
          console.error("D35E | Error auto-unequipping provider items on update:", err)
        );
      }

      // When slot grants are reduced, unequip and clear slotSource for all items on
      // that provider so they don't remain stranded in positions that no longer exist.
      if (options._providerSlotsReduced) {
        ItemEquipHook._clearProviderSlotData(data.parent, options._providerSlotsReduced).catch(err =>
          console.error("D35E | Error clearing slot data on provider slot reduction:", err)
        );
      }

      // When a slot-granting item is re-equipped, restore items that were using its slots.
      if (updateData.system?.equipped === true && ItemEquipHook._hasSlotChanges(data)) {
        ItemEquipHook._reequipProviderItems(data.parent, data.id).catch(err =>
          console.error("D35E | Error re-equipping provider items on update:", err)
        );
      }

      // When an item is manually unequipped, clear its slotSource so it's released
      // from its position. (Provider-cascade unequips use _forceUnequip and are
      // already returned above — this only runs for user-initiated unequips.)
      if (updateData.system?.equipped === false) {
        Promise.resolve(unsetSystemFlag(data, "slotSource")).catch(err =>
          console.error("D35E | Error clearing slotSource on manual unequip:", err)
        );
      }

      if (updateData.system?.equipped === undefined) return;
      if (data.system.equipped === true && ['weapon', 'equipment'].includes(data.type)) {
        Hooks.call("D35E.ItemEquip.postEquipItem", data, options, user)
      } else if (data.system.equipped === false && ['weapon', 'equipment'].includes(data.type)) {
        Hooks.call("D35E.ItemEquip.postUnequipItem", data, options, user)
      }
    });

    ItemEquipHook.registerInternalHooksHandlers();
  }

  /**
   * Register the internal hooks handlers for the ItemEquipHook
   */
  static registerInternalHooksHandlers() {
    Hooks.on("D35E.ItemEquip.postEquipItem", (item, options, user) => {
      if (item.parent && item.type === "weapon") {
        item.parent.createAttackFromWeapon(item, {deleteExistingAttack: false});
      }
    });
  }
}
