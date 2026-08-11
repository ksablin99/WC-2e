import { Item35E } from "./entity.js";
import { ItemEnhancements } from "./extensions/enhancement.js";

/**
 * Standalone enhancement documents (compendium / embedded definition items).
 * Registers formula-driven price / enhIncrease preparation like weapons and equipment.
 */
export class Enhancement35E extends Item35E {
  constructor(...args) {
    super(...args);
    this.extensionMap.set("enhancement", new ItemEnhancements(this));
  }
}
