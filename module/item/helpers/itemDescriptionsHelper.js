import { Roll35e } from "../../roll.js";
import { ItemRolls } from "../extensions/rolls.js";
import { ItemCombatChangesHelper } from "./itemCombatChangesHelper.js";
import { ItemCombatCalculationsHelper } from "./itemCombatCalculationsHelper.js";

export class ItemDescriptionsHelper {
  static async attackDescription(item, _rollData) {
    // //game.D35E.logger.log('AB ', item.hasAttack)
    let rollData = foundry.utils.duplicate(_rollData);
    if (!rollData) {
      if (!item.actor) return []; //There are no requirements when item has no actor!
      rollData = item.actor.getRollData();
    }
    rollData.item = item.getRollData();

    if (item.hasAttack) {
      let bab = Math.max(0, Number(foundry.utils.getProperty(item.actor.system, "attributes.bab.nonepic")) || 0);
      let totalBonus = await this.attackBonus(item, rollData);
      let autoScaleWithBab =
        (game.settings.get("warcraftrpg2e", "autoScaleAttacksBab") &&
          item.actor.type !== "npc" &&
          foundry.utils.getProperty(item.system, "attackType") === "weapon" &&
          foundry.utils.getProperty(item.system, "autoScaleOption") !== "never") ||
        foundry.utils.getProperty(item.system, "autoScaleOption") === "always";
      let attacks = [];
      if (autoScaleWithBab) {
        const extraIter = Math.max(0, Math.floor((bab - 1) / 5));
        attacks.push(`${totalBonus >= 0 ? "+" + totalBonus : totalBonus}`);
        for (let k = 1; k <= extraIter; k++) {
          const partBonus = totalBonus - 5 * k;
          attacks.push(`${partBonus >= 0 ? "+" + partBonus : partBonus}`);
        }
      } else {
        attacks.push(`${totalBonus >= 0 ? "+" + totalBonus : totalBonus}`);
        for (let part of foundry.utils.getProperty(item.system, "attackParts")) {
          let partBonus = totalBonus + parseInt(part[0]);
          attacks.push(`${partBonus >= 0 ? "+" + partBonus : partBonus}`);
        }
      }
      return attacks.join("/");
    }
    return "";
  }

  static async attackBonus(item, rollData) {
    // //game.D35E.logger.log('AB ', item.hasAttack)
    if (!rollData) {
      if (!item.actor) return [];
      rollData = item.actor.getRollData();
    }
    rollData.item = item.getRollData();

    if (item.hasAttack) {
      if (item.actor) {
        let allCombatChanges = [];
        let attackType = item.type;
        item.actor.combatChangeItems
          .filter((o) => ItemCombatChangesHelper.canHaveCombatChanges(o, rollData, attackType))
          .forEach((i) => {
            allCombatChanges = allCombatChanges.concat(i.combatChanges.getPossibleCombatChanges(attackType, rollData));
          });
        item._addCombatChangesToRollData(allCombatChanges, rollData);
      }

      let roll = await new ItemRolls(item).rollAttack({
        data: rollData,
        bonus: 0,
        extraParts: [],
        primaryAttack: item.system.primaryAttack,
        replacedEnh: rollData.item?.enh || 0,
        bonusOnly: true,
      });

      try {
        return Math.floor(roll.total);
      } catch (e) {
        ui.notifications.error(
          game.i18n.format("DICE.WarnAttackRollIncorrect", {
            name: item.name,
            roll: roll?.formula ?? "",
          })
        );
        return 0;
      }
    }
    return 0;
  }

  static async damageRoll(item, rollData) {
    return Math.floor(new Roll35e(await this.damageDescription(item, rollData)).evaluateSync().total);
  }

  static async damageDescription(item, rollData) {
    // //game.D35E.logger.log('DD ', item.hasDamage)
    if (!rollData) {
      if (!item.actor) return []; //There are no requirements when item has no actor!
      rollData = item.actor.getRollData();
    }
    rollData.critMult = 1;
    rollData.item = item.getRollData();
    let abilityBonus = 0;
    let results = [];
    if (item.hasDamage) {
      // rework that into for loop so it work with async functions
      for (let d of item.system.damage.parts) {
        if (d) {
          try {
            let roll = new Roll35e(d[0].replace("@useAmount", 1), rollData)
            let parsedRoll = await roll.roll();
            results.push(parsedRoll.formula);
          } catch (e) {
            console.error(`D35E | Failed to evaluate damage formula for ${item.name}: ${d[0]}`, e);
          }
        }
      }
    }
    if (foundry.utils.getProperty(item.system, "ability.damage"))
      abilityBonus = Math.floor(
        parseInt(item.actor.system.abilities[item.system.ability.damage].mod) *
          ItemCombatCalculationsHelper.calculateAbilityModifier(
            item,
            item.system.ability.damageMult,
            item.system.attackType,
            item.system.primaryAttack
          )
      );
    if (abilityBonus < 0) abilityBonus = item.actor.system.abilities[item.system.ability.damage].mod;
    if (abilityBonus) results.push(abilityBonus);
    if (foundry.utils.getProperty(item.system, "enh")) results.push(foundry.utils.getProperty(item.system, "enh"));
    return results.join(" + ").replaceAll(" + -", " - ");
  }

  static rangeDescription(item) {
    let rng = foundry.utils.getProperty(item.system, "range") || {};
    if (!["ft", "mi", "spec"].includes(rng.units)) {
      rng.value = null;
      rng.long = null;
    }
    if (rng.units === "ft")
      if (foundry.utils.getProperty(item.system, "thrown")) {
        rng.long = rng.value * 5;
      } else {
        if (foundry.utils.getProperty(item.system, "actionType") === "rwak") rng.long = rng.value * 10;
      }
    let range = [rng.value, rng.long ? `/ ${rng.long}` : null, CONFIG.D35E.distanceUnitsShort[rng.units]].filterJoin(
      " "
    );
    if (range.length > 0) return [range].join(" ");
    return "";
  }

  static linkItemDescription(item, uuid) {
    if (["spell", "card"].includes(item.type)) {
      item.system.shortDescription = `@LinkedDescription[${uuid}]`;
    } else {
      item.system.description.value = `@LinkedDescription[${uuid}]`;
    }
  }
}
