import { validateWarcraftFeatAcquisition } from "../helpers/warcraftFeatRequirements.js";

/** Enforce Warcraft feat prerequisites at the actor-document boundary. */
export class WarcraftFeatHook {
  static register() {
    Hooks.on("preCreateItem", (item, _data, options, userId) => {
      if (item?.type !== "feat" || !item?.parent || options?._warcraftBypassFeatValidation) return;
      if (userId !== game.userId) return;
      const result = validateWarcraftFeatAcquisition(item, item.parent);
      if (result.manual.length) {
        ui.notifications.warn(
          game.i18n.format("D35E.WarcraftFeatManualPrerequisite", { prerequisites: result.manual.join(", ") })
        );
      }
      if (!result.errors.length) return;
      ui.notifications.error(
        game.i18n.format("D35E.WarcraftFeatAcquisitionBlocked", { reasons: result.errors.join("; ") })
      );
      return false;
    });
  }
}
