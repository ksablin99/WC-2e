/**
 * When items are placed in containers, actorUpdater unequips them and mirrors the
 * container's carried state. When they return to root, nothing restores carried
 * or prompts to re-equip — see issue #1528.
 */
export class ItemContainerHook {
  static FLAG_EQUIPPED_BEFORE_CONTAINER = "equippedBeforeContainer";

  /**
   * In-flight prompts: DialogV2.wait() does not await render(), so the dialog is not in
   * `foundry.applications.instances` synchronously — a second `updateItem` in the same turn
   * must be blocked here. A stable `id` also matches
   * `ApplicationV2#_insertElement`’s duplicate-id `replaceWith` behavior if two dialogs ever
   * raced (client/applications/api/dialog.mjs, application.mjs).
   */
  static _pendingReequipPrompt = new Set();

  static _reequipDialogApplicationId(actorId, itemId) {
    return `d35e-container-reequip-${actorId}-${itemId}`;
  }

  static _normContainerId(v) {
    return v === undefined || v === null || v === "" ? "none" : v;
  }

  static _getNewContainerId(updateData) {
    if (!updateData) return undefined;
    if (Object.prototype.hasOwnProperty.call(updateData, "system.containerId")) {
      return updateData["system.containerId"];
    }
    if (updateData.system && Object.prototype.hasOwnProperty.call(updateData.system, "containerId")) {
      return updateData.system.containerId;
    }
    if (foundry.utils.hasProperty(updateData, "system.containerId")) {
      return foundry.utils.getProperty(updateData, "system.containerId");
    }
    return undefined;
  }

  static _escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
    );
  }

  static _mergeFlagEquippedBeforeContainer(updateData) {
    updateData.flags = updateData.flags || {};
    updateData.flags.D35E = updateData.flags.D35E || {};
    updateData.flags.D35E[ItemContainerHook.FLAG_EQUIPPED_BEFORE_CONTAINER] = true;
  }

  static _mergeCarriedTrue(updateData) {
    updateData.system = updateData.system || {};
    updateData.system.carried = true;
  }

  static register() {
    Hooks.on("preUpdateItem", (item, updateData, options, user) => {
      if (!(item.parent instanceof Actor)) return;
      if (user !== game.userId) return;
      if (options._forceUnequip) return;

      const newContainerId = ItemContainerHook._getNewContainerId(updateData);
      if (newContainerId === undefined) return;

      const oldC = ItemContainerHook._normContainerId(item.system?.containerId);
      const newC = ItemContainerHook._normContainerId(newContainerId);

      const entersContainer = oldC === "none" && newC !== "none";
      const leavesContainer = oldC !== "none" && newC === "none";

      if (entersContainer) {
        if (!["weapon", "equipment"].includes(item.type)) return;
        if (item.system?.equipped !== true) return;
        ItemContainerHook._mergeFlagEquippedBeforeContainer(updateData);
        return;
      }

      if (leavesContainer) {
        if (!Object.prototype.hasOwnProperty.call(item.system ?? {}, "quantity")) return;
        ItemContainerHook._mergeCarriedTrue(updateData);
      }
    });

    Hooks.on("updateItem", (item, updateData, options, user) => {
      if (!(item.parent instanceof Actor)) return;
      if (user !== game.userId) return;
      if (options._forceUnequip) return;

      const newC = ItemContainerHook._getNewContainerId(updateData);
      if (newC === undefined) return;
      if (ItemContainerHook._normContainerId(newC) !== "none") return;
      if (!["weapon", "equipment"].includes(item.type)) return;
      if (!item.getFlag("D35E", ItemContainerHook.FLAG_EQUIPPED_BEFORE_CONTAINER)) return;

      const actorId = item.parent.id;
      const itemId = item.id;
      const dialogAppId = ItemContainerHook._reequipDialogApplicationId(actorId, itemId);

      if (foundry.applications.instances.has(dialogAppId)) return;
      if (ItemContainerHook._pendingReequipPrompt.has(dialogAppId)) return;
      ItemContainerHook._pendingReequipPrompt.add(dialogAppId);

      ItemContainerHook._promptReequip(actorId, itemId, dialogAppId)
        .finally(() => ItemContainerHook._pendingReequipPrompt.delete(dialogAppId))
        .catch((err) =>
          console.error("D35E | ItemContainerHook re-equip prompt error:", err)
        );
    });
  }

  static async _promptReequip(actorId, itemId, dialogAppId) {
    const actor = game.actors.get(actorId);
    if (!actor) return;
    const item = actor.items.get(itemId);
    if (!item) return;
    if (!item.getFlag("D35E", ItemContainerHook.FLAG_EQUIPPED_BEFORE_CONTAINER)) return;

    const itemName = item.name;
    const title = game.i18n.localize("D35E.ContainerReequipTitle");
    const content = game.i18n.format("D35E.ContainerReequipContent", {
      item: ItemContainerHook._escapeHtml(itemName),
    });

    let confirmed = false;
    try {
      confirmed = await foundry.applications.api.DialogV2.confirm({
        id: dialogAppId,
        window: { title },
        content,
        rejectClose: false,
      });
    } finally {
      await item.unsetFlag("D35E", ItemContainerHook.FLAG_EQUIPPED_BEFORE_CONTAINER).catch(() => { });
    }

    if (!confirmed) return;

    const fresh = game.actors.get(actorId)?.items.get(itemId);
    if (!fresh) return;
    await fresh.update({ "system.equipped": true });
  }
}
