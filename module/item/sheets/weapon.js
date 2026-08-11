import { Item35E } from "../entity.js";
import { EnhancementSheetComponent } from "./components/enhancementSheetComponent.js";
import { ItemSheetPF } from "./base.js";
import { IntelligentItemPowersSheetComponent } from "./components/intelligentItemPowersSheetComponent.js";
import { ItemEnhancementHelper } from "../helpers/itemEnhancementHelper.js";
import { ConjuredManager } from "../../conjuration/conjuredManager.js";
import { createTag } from "../../lib.js";

export class WeaponSheet35E extends ItemSheetPF {
  constructor(...args) {
    super(...args);

    this.sheetComponents.push(new EnhancementSheetComponent(this));
    this.sheetComponents.push(new IntelligentItemPowersSheetComponent(this));
  }

  async getData() {
    let sheetData = await super.getData();
    sheetData.isRanged = (this.item.system.weaponSubtype === "ranged" || this.item.system.properties["thr"] === true);

    sheetData.weaponCategories = { types: {}, subTypes: {} };
    for (let [k, v] of Object.entries(CONFIG.D35E.weaponTypes)) {
      if (typeof v === "object") sheetData.weaponCategories.types[k] = v._label;
    }
    const type = this.item.system.weaponType;
    if (foundry.utils.hasProperty(CONFIG.D35E.weaponTypes, type)) {
      for (let [k, v] of Object.entries(CONFIG.D35E.weaponTypes[type])) {
        if (!k.startsWith("_")) sheetData.weaponCategories.subTypes[k] = v;
      }
    }

    const enhancements = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, "enhancements.items") ?? []);
    const dancingEnhData = enhancements.find((e) => ItemEnhancementHelper.getEnhancementData(e)?.properties?.dnc);
    if (dancingEnhData) {
      const enhSystem = ItemEnhancementHelper.getEnhancementData(dancingEnhData);
      sheetData.dancingEnhancement = {
        tag: createTag(dancingEnhData.name),
        dancingRounds: enhSystem.summonWeapon?.dancingRounds ?? 4,
        cooldownRounds: enhSystem.summonWeapon?.cooldownRounds ?? 4,
      };
      sheetData.dancingState = foundry.utils.getProperty(this.item, "flags.D35E.dancingWeapon") ?? {};
    } else {
      sheetData.dancingEnhancement = null;
      sheetData.dancingState = null;
    }

    return sheetData;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
    root.querySelector('[data-action="dancing-dance"]')
      ?.addEventListener("click", (ev) => { ev.preventDefault(); this._onDancingDance(); });
    root.querySelector('[data-action="dancing-return"]')
      ?.addEventListener("click", (ev) => { ev.preventDefault(); this._onDancingReturn(); });
    root.querySelector('[data-action="dancing-reset-cooldown"]')
      ?.addEventListener("click", (ev) => { ev.preventDefault(); this._onDancingResetCooldown(); });
  }

  async _onDancingDance() {
    const enhancements = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, "enhancements.items") ?? []);
    const enhData = enhancements.find((e) => ItemEnhancementHelper.getEnhancementData(e)?.properties?.dnc);
    if (!enhData) return;
    const enh = await this.item.enhancements.getEnhancementItem(createTag(enhData.name));
    if (!enh) return;
    enh.parentItem = this.item;
    enh.conjuredSourceWeaponId = this.item.id;
    await ConjuredManager.createSummonedWeapon(enh, this.item.actor);
  }

  async _onDancingReturn() {
    const enhancements = foundry.utils.getProperty(this.item.system, "enhancements.items") ?? [];
    const enhData = enhancements.find((e) => ItemEnhancementHelper.getEnhancementData(e)?.properties?.dnc);
    if (!enhData) return;
    const enh = await this.item.enhancements.getEnhancementItem(createTag(enhData.name));
    if (!enh) return;
    enh.parentItem = this.item;
    enh.conjuredSourceWeaponId = this.item.id;
    await ConjuredManager.createSummonedWeapon(enh, this.item.actor);
  }

  async _onDancingResetCooldown() {
    await this.item.update({ "flags.D35E.dancingWeapon.cooldownRounds": 0 });
  }
}
