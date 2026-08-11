import { Item35E } from "./entity.js";
import { ItemEnhancements } from "./extensions/enhancement.js";
import { IntelligentItemPowers } from "./extensions/intelligentItemPowers.js";

export class Equipment35E extends Item35E {
  constructor(...args) {
    super(...args);

    this.extensionMap.set("enhancement", new ItemEnhancements(this));
    this.extensionMap.set("intelligentPowers", new IntelligentItemPowers(this));
  }

  get subType() {
    return this.system.subType;
  }

  updateGetSubtype(updated) {
    return updated["system.subType"] || this.system.subType;
  }
}
