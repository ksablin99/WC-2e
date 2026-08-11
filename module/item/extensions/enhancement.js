import { createTag, linkData } from "../../lib.js";
import { Roll35e } from "../../roll.js";
import { ItemEnhancementConverter } from "../converters/enhancement.js";
import { Item35E } from "../entity.js";
import { ItemEnhancementHelper } from "../helpers/itemEnhancementHelper.js";
import { ItemExtension } from "./itemExtension.js";

export class ItemEnhancements extends ItemExtension {
  prepareUpdateData(updateData, srcData, rollData) {
    this.#updateCalculateEnhancementData(rollData, updateData);
    this.#updateCalculatePriceData(updateData, rollData);
    let _enhancements = foundry.utils.duplicate(foundry.utils.getProperty(srcData, `system.enhancements.items`) || []);
    this.#updateBaseEnhancement(updateData, _enhancements, this.item.type, srcData);
    this.#updateAlignmentEnhancement(updateData, _enhancements, this.item.type, srcData);
  }

  async getEnhancementItem(tag) {
    const enhancements = foundry.utils.getProperty(this.item.system, `enhancements.items`) || [];
    let itemData = enhancements.find((i) => createTag(i.name) === tag);
    if (itemData != null) {
      return ItemEnhancementHelper.getEnhancementItemFromData(itemData, this.item.actor, this.item.isOwner);
    } else return itemData;
  }

  async useEnhancementItem(item) {
    let chargeCost = item.system?.uses?.chargesPerUse !== undefined ? item.system.uses.chargesPerUse : item.chargeCost;
    let chargesLeft = item.system?.uses?.value || 0;
    if (foundry.utils.getProperty(this.item.system, "enhancements.uses.commonPool")) {
      if (foundry.utils.getProperty(this.item.system, "enhancements.uses.value") < chargeCost) {
        return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoCharges").format(this.item.name));
      }
    } else {
      if (chargesLeft < chargeCost) {
        return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoCharges").format(this.item.name));
      }
    }
    if (foundry.utils.getProperty(this.item.system, "enhancements.clFormula")) {
      item.system.baseCl = new Roll35e(
        foundry.utils.getProperty(this.item.system, "enhancements.clFormula"),
        this.item.actor.getRollData()
      ).evaluateSync().total;
    }
    if (item.system.save) {
      let ablMod = 0;
      if (foundry.utils.getProperty(this.item.system, "enhancements.spellcastingAbility") !== "")
        ablMod = foundry.utils.getProperty(
          this.item.actor.system,
          `abilities.${this.item.system.enhancements.spellcastingAbility}.mod`
        );
      item.system.save.dc = parseInt(item.system.save.dc) + ablMod;
    }
    item.conjuredSourceWeaponId = this.item.id;
    item.parentItem = this.item;

    let roll = await item.use({ ev: event, skipDialog: event.shiftKey, temporaryItem: true }, this.item.actor, true);
    if (roll.wasRolled) {
      if (foundry.utils.getProperty(this.item.system, "enhancements.uses.commonPool")) {
        let updateData = {};
        updateData[`system.enhancements.uses.value`] =
          foundry.utils.getProperty(this.item.system, "enhancements.uses.value") - chargeCost;
        updateData[`system.uses.value`] = foundry.utils.getProperty(this.item.system, "enhancements.uses.value") - chargeCost;
        updateData[`system.uses.max`] = foundry.utils.getProperty(this.item.system, "enhancements.uses.max");
        await this.item.update(updateData);
      } else {
        await this.item.enhancements.addEnhancementCharges(item, -1 * chargeCost);
      }
    }
  }

  async addEnhancementCharges(item, charges) {
    let updateData = {};
    let _enhancements = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `enhancements.items`) || []);
    _enhancements
      .filter(function (obj) {
        return createTag(obj.name) === createTag(item.name);
      })
      .forEach((i) => {
        let enhancementData = ItemEnhancementHelper.getEnhancementData(i);
        enhancementData.uses.value = enhancementData.uses.value + charges;
      });
    updateData[`system.enhancements.items`] = _enhancements;
    await this.item.update(updateData);
  }

  async createEnhancementSpell(itemData, type) {
    if (this.hasEnhancement(itemData.name)) return;

    const updateData = {};
    let _enhancements = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `enhancements.items`) || []);
    let enhancement = await ItemEnhancementConverter.toEnhancement(itemData, type);
    if (enhancement.id) enhancement._id = this.item._id + "-" + enhancement.id;
    _enhancements.push(enhancement);
    this.#preUpdateMagicItemName(updateData, _enhancements);
    this.#preUpdateMagicItemProperties(updateData, _enhancements);
    updateData[`system.enhancements.items`] = _enhancements;
    await this.item.update(updateData);
  }

  async createEnhancementBuff(itemData) {
    if (this.hasEnhancement(itemData.name)) return;

    const updateData = {};
    let _enhancements = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `enhancements.items`) || []);
    let enhancement = await ItemEnhancementConverter.toEnhancementBuff(itemData);
    if (enhancement.id) enhancement._id = this.item._id + "-" + enhancement.id;
    _enhancements.push(enhancement);
    this.#preUpdateMagicItemName(updateData, _enhancements);
    this.#preUpdateMagicItemProperties(updateData, _enhancements);
    updateData[`system.enhancements.items`] = _enhancements;
    await this.item.update(updateData);
  }

  async getEnhancementFromData(itemData) {
    const updateData = {};
    let _enhancements = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `enhancements.items`) || []);
    const enhancement = foundry.utils.duplicate(itemData);
    if (enhancement._id) enhancement.id = this.item._id + "-" + itemData._id;
    _enhancements.push(enhancement);
    this.#preUpdateMagicItemName(updateData, _enhancements);
    this.#preUpdateMagicItemProperties(updateData, _enhancements);
    updateData[`system.enhancements.items`] = _enhancements;
    return updateData;
  }

  async addEnhancementFromData(itemData) {
    if (this.hasEnhancement(itemData.name)) return;
    return this.item.update(await this.getEnhancementFromData(itemData));
  }

  hasEnhancement(name) {
    const tag = createTag(name);
    return (foundry.utils.getProperty(this.item.system, `enhancements.items`) || []).some((i) => createTag(i.name) === tag);
  }

  async updateBaseItemName(stopUpdates = false) {
    const updateData = {};
    //game.D35E.logger.log("updating name")
    let _enhancements = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `enhancements.items`) || []);
    this.#preUpdateMagicItemName(updateData, _enhancements, true);
    this.#preUpdateMagicItemProperties(updateData, _enhancements, true);
    await this.item.update(updateData, { stopUpdates: stopUpdates });
  }

  async deleteEnhancement(enhancementId) {
    const updateData = {};
    let _enhancements = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `enhancements.items`) || []);
    _enhancements = _enhancements.filter(function (obj) {
      return createTag(obj.name) !== enhancementId;
    });
    this.#preUpdateMagicItemName(updateData, _enhancements);
    this.#preUpdateMagicItemProperties(updateData, _enhancements);
    updateData[`system.enhancements.items`] = _enhancements;
    await this.item.update(updateData);
  }

  /***
   * Updated embedded enhancement item
   * @param enhancementId
   * @param enhancementUpdateData
   * @returns {Promise<void>}
   */
  async updateEnhancement(enhancementId, enhancementUpdateData) {
    const updateData = {};
    let _enhancements = foundry.utils.duplicate(foundry.utils.getProperty(this.item.system, `enhancements.items`) || []);
    _enhancements
      .filter(function (obj) {
        return createTag(obj.name) === enhancementId;
      })
      .forEach((i) => {
        const snap = foundry.utils.duplicate(i);
        const beforeData = foundry.utils.duplicate(ItemEnhancementHelper.getEnhancementData(snap));
        i.system = foundry.utils.mergeObject(ItemEnhancementHelper.getEnhancementData(i), enhancementUpdateData);
        const afterData = ItemEnhancementHelper.getEnhancementData(i);
        if (!this.#formulaEmpty(beforeData.priceFormula) && this.#formulaEmpty(afterData.priceFormula)) {
          i.system.price = 0;
        }
        if (!this.#formulaEmpty(beforeData.enhIncreaseFormula) && this.#formulaEmpty(afterData.enhIncreaseFormula)) {
          i.system.enhIncrease = 0;
        }
        this.#setEnhancementPrice(i);
        // Clean up old data, as we use system now
        delete i.data;
      });
    updateData[`system.enhancements.items`] = _enhancements;
    this.#preUpdateMagicItemName(updateData, _enhancements);
    this.#preUpdateMagicItemProperties(updateData, _enhancements);
    await this.item.update(updateData);
  }

  /***
   * Adds item from compendium to this instance as enhancement
   * @param packName name of compendium that enhancement is imported from
   * @param packId id of enhancement to add to item
   * @param enhValue value to set on enhancement
   * @returns {Promise<void>} awaitable item promise
   */
  async addEnhancementFromCompendium(packName, packId, enhValue) {
    let itemData = {};
    const packItem = await game.packs.find((p) => p.metadata.id === packName).getDocument(packId);
    if (packItem != null) {
      itemData = packItem;
      itemData.system.enh = enhValue;
      this.#setEnhancementPrice(itemData);
      return await this.getEnhancementFromData(itemData);
    }
  }

  /***
   * Calculates enhancement price
   * @param enhancement
   */
  #setEnhancementPrice(enhancement) {
    let enhancementData = ItemEnhancementHelper.getEnhancementData(enhancement);
    let rollData = {};
    if (this.item.actor != null) rollData = this.item.actor.getRollData();

    rollData.enhancement = enhancementData.enh;
    if (!this.#formulaEmpty(enhancementData.enhIncreaseFormula)) {
      enhancement.system.enhIncrease = new Roll35e(String(enhancement.system.enhIncreaseFormula), rollData).evaluateSync().total;
    }
    rollData.enhIncrease = enhancementData.enhIncrease;
    if (!this.#formulaEmpty(enhancementData.priceFormula)) {
      enhancement.system.price = new Roll35e(String(enhancementData.priceFormula), rollData).evaluateSync().total;
    }
  }

  #preUpdateMagicItemName(updateData, _enhancements, force = false, useIdentifiedName = false) {
    if (
      (foundry.utils.getProperty(this.item.system, "enhancements") !== undefined &&
        foundry.utils.getProperty(this.item.system, "enhancements.automation") !== undefined &&
        foundry.utils.getProperty(this.item.system, "enhancements.automation") !== null) ||
      force
    ) {
      if (foundry.utils.getProperty(this.item.system, "enhancements.automation.updateName") || force) {
        let baseName =
          (useIdentifiedName && foundry.utils.getProperty(this.item.system, "identifiedName")) ||
          foundry.utils.getProperty(this.item.system, "unidentified.name");
        if (foundry.utils.getProperty(this.item.system, "unidentified.name") === "") {
          updateData[`system.unidentified.name`] = this.item.name;
          baseName = this.item.name;
        }
        updateData[`system.identifiedName`] = this.#buildName(baseName, _enhancements);
      }
    }
  }

  #preUpdateMagicItemProperties(updateData, _enhancements, force = false) {
    if (
      (foundry.utils.getProperty(this.item.system, "enhancements") !== undefined &&
        foundry.utils.getProperty(this.item.system, "enhancements.automation") !== undefined &&
        foundry.utils.getProperty(this.item.system, "enhancements.automation") !== null) ||
      force
    ) {
      const automation = foundry.utils.getProperty(this.item.system, "enhancements.automation") || {};
      if (automation.updatePrice || force) {
        let basePrice = this.item.system.unidentified.price;
        if (!foundry.utils.getProperty(this.item.system, "unidentified.price")) {
          updateData[`system.unidentified.price`] = foundry.utils.getProperty(this.item.system, "price");
          basePrice = this.item.system.price;
        }
        updateData[`system.price`] = this.#buildPrice(basePrice, _enhancements);
      }
    }
  }

  #buildName(name, enhancements) {
    let prefixes = [];
    let suffixes = [];
    let totalEnchancement = 0;
    for (const obj of enhancements) {
      let enhancementData = ItemEnhancementHelper.getEnhancementData(obj);
      if (enhancementData.nameExtension !== undefined && enhancementData.nameExtension !== null) {
        if (enhancementData.nameExtension.prefix !== null && enhancementData.nameExtension.prefix.trim() !== "")
          prefixes.push(enhancementData.nameExtension.prefix.trim());
        if (enhancementData.nameExtension.suffix !== null && enhancementData.nameExtension.suffix.trim() !== "")
          suffixes.push(enhancementData.nameExtension.suffix.trim());
      }

      if (enhancementData.enhancementType === "weapon" && this.item.type === "weapon")
        if (!enhancementData.enhIsLevel) totalEnchancement += enhancementData.enh;
      if (enhancementData.enhancementType === "armor" && this.item.type === "equipment")
        if (!enhancementData.enhIsLevel) totalEnchancement += enhancementData.enh;
    }
    let enhSuffix = "";
    let ofSuffix = "";
    if (totalEnchancement > 0) enhSuffix = ` +${totalEnchancement}`;
    if (suffixes.length > 0) {
      ofSuffix = ` of ${suffixes.join(" and ").trim()}`;
    }
    return `${prefixes.join(" ")} ${name}${ofSuffix}`.trim() + `${enhSuffix}`;
  }

  #buildPrice(basePrice, enhancements) {
    let totalPrice = basePrice;
    let totalEnchancementIncrease = 0;
    let totalEnchancement = 0;
    let maxSingleEnhancementIncrease = 0;
    let flatPrice = 0;
    for (const obj of enhancements) {
      let enhancementData = ItemEnhancementHelper.getEnhancementData(obj);
      if (enhancementData.enhancementType === "weapon" && this.item.type === "weapon") {
        totalEnchancementIncrease += enhancementData.enhIncrease;
        if (!enhancementData.enhIsLevel) totalEnchancement += enhancementData.enh;
        flatPrice += enhancementData.price;
        maxSingleEnhancementIncrease = Math.max(enhancementData.enhIncrease, maxSingleEnhancementIncrease);
      }
      if (enhancementData.enhancementType === "armor" && this.item.type === "equipment") {
        totalEnchancementIncrease += enhancementData.enhIncrease;
        if (!enhancementData.enhIsLevel) totalEnchancement += enhancementData.enh;
        flatPrice += enhancementData.price;
        maxSingleEnhancementIncrease = Math.max(enhancementData.enhIncrease, maxSingleEnhancementIncrease);
      }
      if (enhancementData.enhancementType === "misc") {
        totalEnchancementIncrease += enhancementData.enhIncrease;
        flatPrice += enhancementData.price;
        maxSingleEnhancementIncrease = Math.max(enhancementData.enhIncrease, maxSingleEnhancementIncrease);
      }
    }
    let useEpicPricing = false;
    if (maxSingleEnhancementIncrease > 5 || totalEnchancement > 5) useEpicPricing = true;
    // Base price for weapon
    if (this.item.type === "weapon") {
      if (totalEnchancementIncrease > 0) totalPrice += 300;
      if (!useEpicPricing) totalPrice += totalEnchancementIncrease * totalEnchancementIncrease * 2000 + flatPrice;
      else totalPrice += totalEnchancementIncrease * totalEnchancementIncrease * 2000 * 10 + 10 * flatPrice;
    } else if (this.item.type === "equipment") {
      if (totalEnchancementIncrease > 0) totalPrice += 150;
      if (!useEpicPricing) totalPrice += totalEnchancementIncrease * totalEnchancementIncrease * 1000 + flatPrice;
      else totalPrice += totalEnchancementIncrease * totalEnchancementIncrease * 1000 * 10 + 10 * flatPrice;
    }

    return totalPrice;
  }

  #updateCalculateEnhancementData(rollData, data) {
    rollData.enhancement = data["system.enh"] !== undefined ? data["system.enh"] : foundry.utils.getProperty(this.item.system, "enh");
    let rollFormula = foundry.utils.getProperty(this.item.system, "enhIncreaseFormula");
    if (
      data["system.enhIncreaseFormula"] != null &&
      data["system.enhIncreaseFormula"] !== foundry.utils.getProperty(this.item.system, "enhIncreaseFormula")
    )
      rollFormula = data["system.enhIncreaseFormula"];
    const prevEnhFormula = foundry.utils.getProperty(this.item.system, "enhIncreaseFormula");
    if (
      this.item.type === "enhancement" &&
      !this.#formulaEmpty(prevEnhFormula) &&
      this.#formulaEmpty(rollFormula)
    ) {
      data["system.enhIncrease"] = 0;
    }
    if (!this.#formulaEmpty(rollFormula)) {
      data["system.enhIncrease"] = new Roll35e(String(rollFormula), rollData).evaluateSync().total;
    }
    rollData.enhancement = data["system.enh"] !== undefined ? data["system.enh"] : foundry.utils.getProperty(this.item.system, "enh");
    rollData.enhIncrease =
      data["system.enhIncrease"] !== undefined
        ? data["system.enhIncrease"]
        : foundry.utils.getProperty(this.item.system, "enhIncrease");
  }

  #updateCalculatePriceData(data, rollData) {
    let rollFormula = foundry.utils.getProperty(this.item.system, "priceFormula");
    if (
      data["system.priceFormula"] != null &&
      data["system.priceFormula"] !== foundry.utils.getProperty(this.item.system, "priceFormula")
    )
      rollFormula = data["system.priceFormula"];
    const prevPriceFormula = foundry.utils.getProperty(this.item.system, "priceFormula");
    if (
      this.item.type === "enhancement" &&
      !this.#formulaEmpty(prevPriceFormula) &&
      this.#formulaEmpty(rollFormula)
    ) {
      data["system.price"] = 0;
    }
    if (!this.#formulaEmpty(rollFormula)) {
      data["system.price"] = new Roll35e(String(rollFormula), rollData).evaluateSync().total;
    }
  }

  /** @returns {boolean} true if there is no formula to evaluate (empty string, whitespace, null, undefined, or numeric 0) */
  #formulaEmpty(f) {
    if (f === undefined || f === null) return true;
    if (typeof f === "number") return f === 0 || Number.isNaN(f);
    return String(f).trim() === "";
  }

  #updateAlignmentEnhancement(data, enhancements, type, srcData) {
    let doLinkData = true;
    if (srcData == null) {
      srcData = this.item.toObject();
      doLinkData = false;
    }

    let alignment = {
      good: false,
      evil: false,
      lawful: false,
      chaotic: false,
    };

    enhancements.forEach(function (obj) {
      let objEnhancement = ItemEnhancementHelper.getEnhancementData(obj);
      if (objEnhancement?.weaponData?.alignment) {
        alignment.good = objEnhancement.weaponData.alignment.good || alignment.good;
        alignment.evil = objEnhancement.weaponData.alignment.evil || alignment.evil;
        alignment.lawful = objEnhancement.weaponData.alignment.lawful || alignment.lawful;
        alignment.chaotic = objEnhancement.weaponData.alignment.chaotic || alignment.chaotic;
      }
    });
    //game.D35E.logger.log('Total enh',totalEnchancement, type)
    if (type === "weapon" && enhancements.length) {
      if (doLinkData) linkData(srcData, data, "system.weaponData.alignment", alignment);
      else data["system.weaponData.alignment"] = alignment;
    }
  }

  #updateBaseEnhancement(data, enhancements, type, srcData) {
    let doLinkData = true;
    if (srcData == null) {
      srcData = this.item.toObject();
      doLinkData = false;
    }
    let totalEnchancement = 0;
    enhancements.forEach(function (obj) {
      let objEnhancement = ItemEnhancementHelper.getEnhancementData(obj);
      if (!objEnhancement.enhIsLevel) {
        if (objEnhancement.enhancementType === "weapon" && type === "weapon") totalEnchancement += objEnhancement.enh;
        if (objEnhancement.enhancementType === "armor" && type === "equipment") totalEnchancement += objEnhancement.enh;
      }
    });
    //game.D35E.logger.log('Total enh',totalEnchancement, type)
    if (totalEnchancement > 0) {
      if (type === "weapon") {
        if (doLinkData) linkData(srcData, data, "system.enh", totalEnchancement);
        else data["system.enh"] = totalEnchancement;
      } else if (type === "equipment") {
        if (doLinkData) linkData(srcData, data, "system.armor.enh", totalEnchancement);
        else data["system.armor.enh"] = totalEnchancement;
      }
    }
  }
}
