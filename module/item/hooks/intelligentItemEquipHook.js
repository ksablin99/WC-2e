import { IntelligentItemHelper } from "../helpers/intelligentItemHelper.js";

export class IntelligentItemEquipHook {
  static register() {
    Hooks.on("D35E.ItemEquip.postEquipItem", (item, _options, user) => {
      if (user !== game.userId) return;
      if (!game.settings.get("warcraftrpg2e", "intelligentItemEquipWarn")) return;
      if (!["weapon", "equipment"].includes(item.type)) return;
      const intel = item.system?.intelligent;
      if (!intel?.enabled) return;
      const actor = item.parent;
      if (!(actor instanceof Actor)) return;
      const n = IntelligentItemHelper.getAlignmentMismatchLevels(item, actor);
      if (n <= 0) return;
      ui.notifications?.info(
        game.i18n.format("D35E.IntelligentItemEquipNegLevels", { item: item.name, count: n }),
      );
    });
  }
}
