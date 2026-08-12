import { Roll35e } from "../../roll.js";
import { spellbookUsesSharedSlots } from "../helpers/spellbookPreparationHelper.js";
import {
  findWarcraftCastSlotLevel,
  getWarcraftSlotPool,
  getWarcraftSlotPoolKey,
} from "../../actor/helpers/warcraftSpellcastingHelper.js";

export class ItemCharges {
  /**
   * @param {Item35E} item Item
   */
  constructor(item) {
    this.item = item;
  }

  getCharges() {
    if (this.item.type === "card") return this.item.system.state === "hand";
    if (this.item.system?.linkedChargeItem?.id) {
      if (!this.item.actor) return 0;
      return this.item.actor.getChargesFromItemById(this.item.system?.linkedChargeItem?.id);
    } else {
      if (foundry.utils.getProperty(this.item.system, "uses.per") === "single") return foundry.utils.getProperty(this.item.system, "quantity");
      if (this.item.type === "spell") return this.#getSpellUses(false);
      return foundry.utils.getProperty(this.item.system, "uses.value") || 0;
    }
  }

  getMaxCharges() {
    if (this.item.system?.linkedChargeItem?.id) {
      if (!this.item.actor) return 0;
      return this.item.actor.getMaxChargesFromItemById(this.item.system?.linkedChargeItem?.id);
    } else {
      if (foundry.utils.getProperty(this.item.system, "uses.per") === "single") return foundry.utils.getProperty(this.item.system, "quantity");
      if (this.item.type === "spell") return this.#getSpellUses(true);
      return foundry.utils.getProperty(this.item.system, "uses.max") || 0;
    }
  }

  /**
   * Generic charge addition (or subtraction) function that either adds charges
   * or quantity, based on item data.
   * @param {number} value       - The amount of charges to add.
   * @param {Object} [data=null] - An object in the style of that of an update call to alter, rather than applying the change immediately.
   * @returns {Promise}
   */
  async addCharges(value, data = null) {
    // make value an object that can be passed to hooks and modified
    let hookValue = { value: value };
    Hooks.call("D35E.ItemCharges.preAddCharges", this.item, data, hookValue, game.userId);
    value = hookValue.value;

    let chargeItem = this.item;
    let isChargeLinked = false;
    if (this.item.system?.linkedChargeItem?.id) {
      isChargeLinked = true;
      chargeItem = this.item.actor.getItemByUidOrId(this.item.system?.linkedChargeItem?.id);
      if (!chargeItem) return;
    }

    if (foundry.utils.getProperty(this.item.system, "requiresPsionicFocus")) {
      if (this.item.actor) {
        await this.item.actor.update({ "system.attributes.psionicFocus": false });
      }
    }

    if (foundry.utils.getProperty(chargeItem.system, "uses.per") === "single" && foundry.utils.getProperty(chargeItem.system, "quantity") == null)
      return;

    if (this.item.type === "card") return this.#addCardCharges(value, data);
    if (this.item.type === "spell") return this.#addSpellUses(value, data);

    let prevValue = this.item.isSingleUse
      ? foundry.utils.getProperty(chargeItem.system, "quantity")
      : foundry.utils.getProperty(chargeItem.system, "uses.value");
    if (data != null && this.item.isSingleUse && data["system.quantity"] != null) prevValue = data["system.quantity"];
    else if (data != null && !this.item.isSingleUse && data["system.uses.value"] != null)
      prevValue = data["system.uses.value"];

    let newUses = prevValue + value;
    let rechargeTime = 0;
    let rechargeFormula = null;
    if (!isChargeLinked && newUses === 0) {
      rechargeFormula = foundry.utils.getProperty(this.item.system, "recharge.formula");
    } else if (isChargeLinked && newUses === 0) {
      rechargeFormula = foundry.utils.getProperty(chargeItem.system, "recharge.formula");
    }

    if (rechargeFormula) {
      const roll = await Roll35e.create(rechargeFormula, {}).roll();
      rechargeTime = Number(roll.total) || 0;
    }
    game.D35E.logger.log("Recharge and uses", data, newUses, rechargeFormula, rechargeTime);
    if (data != null && !isChargeLinked) {
      if (this.item.isSingleUse) {
        data["system.quantity"] = newUses;
      } else {
        data["system.uses.value"] = newUses;
        data["system.recharge.current"] = rechargeTime;
      }
    } else {
      if (this.item.isSingleUse) await chargeItem.update({ "system.quantity": newUses }, { stopUpdates: true });
      else
        await chargeItem.update(
          { "system.uses.value": newUses, "system.recharge.current": rechargeTime },
          { stopUpdates: true }
        );
    }
    Hooks.call("D35E.ItemCharges.postAddCharges", this.item, data, value, game.userId);
  }

  #getSpellUses(maximum = false) {
    if (!this.item.actor) return 0;
    if (foundry.utils.getProperty(this.item.system, "atWill")) return Number.POSITIVE_INFINITY;

    if (foundry.utils.getProperty(this.item.system, "requiresPsionicFocus") && !this.item.actor?.system?.attributes?.psionicFocus)
      return 0;
    const spellbook = foundry.utils.getProperty(this.item.actor.system, `attributes.spells.spellbooks.${this.item.system.spellbook}`);
    if (!spellbook) return 0;
    if (this.item.system?.specialPrepared) {
      return foundry.utils.getProperty(
        this.item.system,
        maximum ? "preparation.maxAmount" : "preparation.preparedAmount"
      ) || 0;
    }
    const usesSharedSlots = spellbookUsesSharedSlots(spellbook),
      usePowerPoints = spellbook.usePowerPoints,
      isEpic = foundry.utils.getProperty(this.item.system, "level") > 9,
      spellLevel = foundry.utils.getProperty(this.item.system, "level");
    const warcraftPool = getWarcraftSlotPool(this.item.actor.system, spellbook);
    if (warcraftPool && !isEpic) {
      if (maximum) {
        return Array.from({ length: 10 - spellLevel }, (_, offset) => spellLevel + offset)
          .reduce((total, level) => total + (Number(warcraftPool?.spells?.[`spell${level}`]?.max) || 0), 0);
      }
      const castLevel = findWarcraftCastSlotLevel(
        warcraftPool,
        spellLevel,
        this.item.system?.preparation?.castSlotLevel
      );
      return castLevel == null ? 0 : Number(warcraftPool.spells[`spell${castLevel}`].value) || 0;
    }
    return usePowerPoints
      ? foundry.utils.getProperty(spellbook, `powerPoints`) - foundry.utils.getProperty(this.item.system, "powerPointsCost") >= 0 || 0
      : usesSharedSlots && !isEpic
      ? foundry.utils.getProperty(spellbook, `spells.spell${spellLevel}.value`) || 0
      : foundry.utils.getProperty(this.item.system, "preparation.preparedAmount") || 0;
  }

  async #addCardCharges(value, data) {
    let newState = "deck";
    if (value < 0) newState = "discarded";
    if (value >= 0) newState = "hand";
    const key = "system.state";
    if (data == null) {
      data = {};
      data[key] = newState;
      return this.item.update(data);
    } else {
      data[key] = newState;
    }
  }

  async #addSpellUses(value, data = null) {
    if (!this.item.actor) return;
    if (foundry.utils.getProperty(this.item.system, "atWill")) return;
    //if (foundry.utils.getProperty(this.item.system,"level") === 0) return;

    //game.D35E.logger.log(`Adding spell uses ${value}`)
    const spellbook = foundry.utils.getProperty(this.item.actor.system, `attributes.spells.spellbooks.${this.item.system.spellbook}`);
    if (!spellbook) return;
    if (this.item.system?.specialPrepared) {
      const newCharges = Math.max(
        0,
        (Number(foundry.utils.getProperty(this.item.system, "preparation.preparedAmount")) || 0) + value
      );
      const key = "system.preparation.preparedAmount";
      if (data == null) return this.item.update({ [key]: newCharges });
      data[key] = newCharges;
      return null;
    }
    const usesSharedSlots = spellbookUsesSharedSlots(spellbook),
      usePowerPoints = spellbook.usePowerPoints,
      spellbookKey = foundry.utils.getProperty(this.item.system, "spellbook") || "primary",
      spellLevel = foundry.utils.getProperty(this.item.system, "level");
    const warcraftPool = getWarcraftSlotPool(this.item.actor.system, spellbook);
    if (warcraftPool && spellLevel <= 9) {
      const castLevel = value < 0
        ? findWarcraftCastSlotLevel(warcraftPool, spellLevel, this.item.system?.preparation?.castSlotLevel)
        : spellLevel;
      if (castLevel == null) return null;
      const poolKey = getWarcraftSlotPoolKey(spellbook);
      const key = `system.attributes.spells.warcraftPools.${poolKey}.spells.spell${castLevel}.value`;
      const current = Number(warcraftPool?.spells?.[`spell${castLevel}`]?.value) || 0;
      const max = Number(warcraftPool?.spells?.[`spell${castLevel}`]?.max) || 0;
      return this.item.actor.update({ [key]: Math.min(max, Math.max(0, current + value)) });
    }
    const newCharges = usePowerPoints
      ? Math.max(
          0,
          (foundry.utils.getProperty(spellbook, `powerPoints`) || 0) + value * foundry.utils.getProperty(this.item.system, "powerPointsCost")
        )
      : usesSharedSlots
      ? Math.max(0, (foundry.utils.getProperty(spellbook, `spells.spell${spellLevel}.value`) || 0) + value)
      : Math.max(0, (foundry.utils.getProperty(this.item.system, "preparation.preparedAmount") || 0) + value);

    if (!usesSharedSlots && !usePowerPoints) {
      const key = "system.preparation.preparedAmount";
      if (data == null) {
        data = {};
        data[key] = newCharges;
        return this.item.update(data);
      } else {
        data[key] = newCharges;
      }
    } else if (usePowerPoints) {
      const key = `system.attributes.spells.spellbooks.${spellbookKey}.powerPoints`;
      const actorUpdateData = {};
      if (foundry.utils.getProperty(this.item.system, "requiresPsionicFocus"))
        actorUpdateData["system.attributes.psionicFocus"] = false;
      actorUpdateData[key] = newCharges;
      return this.item.actor.update(actorUpdateData);
    } else {
      const key = `system.attributes.spells.spellbooks.${spellbookKey}.spells.spell${spellLevel}.value`;
      const actorUpdateData = {};
      actorUpdateData[key] = newCharges;
      return this.item.actor.update(actorUpdateData);
    }

    return null;
  }

  getChargeCost() {
    if (foundry.utils.getProperty(this.item.system, "uses.per") === "single") return 1;
    if (this.item.type === "spell") return 1;
    return foundry.utils.getProperty(this.item.system, "uses.chargesPerUse") || 1;
  }

  isRecharging() {
    return this.item.system?.recharge?.enabled && this.item.system?.recharge?.current;
  }

  hasTimedRecharge() {
    return this.item.system?.recharge?.enabled;
  }
}
