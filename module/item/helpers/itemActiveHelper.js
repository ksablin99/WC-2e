import { Roll35e } from "../../roll.js";
import { linkData } from "../../lib.js";

export class ItemActiveHelper {
  static isActive(item) {
    if (!item) return false;
    return (
      item.type === "feat" ||
      item.type === "race" ||
      item.type === "class" ||
      ((item.type === "aura" || item.type === "buff") && foundry.utils.getProperty(item.system, "active")) ||
      (item.type === "equipment" &&
        foundry.utils.getProperty(item.system, "equipped") === true &&
        !foundry.utils.getProperty(item.system, "melded"))
    );
  }
}
