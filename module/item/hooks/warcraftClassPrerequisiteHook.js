import {
  evaluateWarcraftPrerequisites,
  getWarcraftItemPrerequisites,
} from "../helpers/warcraftPrerequisiteHelper.js";

/** Enforce structured class prerequisites when adding a class to an actor. */
export class WarcraftClassPrerequisiteHook {
  static register() {
    Hooks.on("preCreateItem", (item, _data, options, userId) => {
      if (item?.type !== "class" || !item?.parent || options?._warcraftBypassClassValidation) return;
      if (userId !== game.userId) return;
      const requirements = getWarcraftItemPrerequisites(item.system);
      if (!requirements.length) return;
      const pendingItems = Array.isArray(options?._warcraftPendingItems)
        ? options._warcraftPendingItems.filter((pending) =>
            pending.type !== item.type || pending.name !== item.name)
        : [];
      const validationActor = pendingItems.length
        ? {
            system: item.parent.system,
            items: [...item.parent.items, ...pendingItems],
          }
        : item.parent;
      const result = evaluateWarcraftPrerequisites(requirements, validationActor);
      if (result.manual.length) {
        ui.notifications.warn(
          `${item.name} needs GM verification: ${result.manual.map((entry) => entry.label).join("; ")}`
        );
      }
      if (result.automatedMet) return;
      ui.notifications.error(
        `Cannot add ${item.name}: ${result.automatedUnmet.map((entry) => entry.label).join("; ")}`
      );
      return false;
    });
  }
}
