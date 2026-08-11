import { ItemEnhancementHelper } from "../helpers/itemEnhancementHelper.js";
import { IntelligentItemPowerConverter } from "../converters/intelligentItemPowerConverter.js";
import { ItemExtension } from "./itemExtension.js";

export class IntelligentItemPowers extends ItemExtension {
  /**
   * Add a spell item as a spell-like power.
   * @param {object} itemData  Raw item data (toObject() output)
   * @param {string} usageType "day" | "charges" | "atwill"
   * @param {number} [egoPoints=0] Ego point cost override
   * @param {string} [powerTier="lesser"] "lesser" | "greater"
   */
  async addPowerFromSpell(itemData, usageType, egoPoints = 0, powerTier = "lesser") {
    const power = IntelligentItemPowerConverter.toSpellPower(itemData, usageType);
    power.egoPoints = egoPoints;
    power.powerTier = powerTier;
    return this.#savePower(power);
  }

  /**
   * Add a feat/ability item as a feat power.
   * @param {object} itemData  Raw item data (toObject() output)
   * @param {number} [egoPoints=0] Ego point cost override
   * @param {string} [powerTier="lesser"] "lesser" | "greater"
   */
  async addPowerFromFeat(itemData, egoPoints = 0, powerTier = "lesser") {
    const power = IntelligentItemPowerConverter.toFeatPower(itemData);
    power.egoPoints = egoPoints;
    power.powerTier = powerTier;
    return this.#savePower(power);
  }

  /**
   * Use a stored power — resolves the virtual item and calls item.use().
   * Decrements per-day / charged uses on success.
   * At-will powers are never decremented.
   * @param {string} powerId
   */
  async usePower(powerId) {
    const actor = this.item.actor;
    if (!actor) return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoActorPermission"));

    const power = this.#getPowers().find((p) => p._id === powerId);
    if (!power) return;

    // Charge check — only applies when uses are tracked (per-day or charges)
    const atWill = !!power.system?.atWill;
    const usesPer = power.system?.uses?.per;
    if (!atWill && usesPer) {
      const usesVal = power.system?.uses?.value ?? 0;
      if (usesVal <= 0) {
        return ui.notifications.warn(game.i18n.localize("D35E.ErrorNoCharges").format(power.name ?? "Power"));
      }
    }

    const virtualItem = this.getPowerItem(powerId);
    if (!virtualItem) return;

    let fired = false;
    try {
      // use(options, tempActor, skipChargeCheck) — Item35E.use() options-object form
      const result = await virtualItem.use({ skipDialog: false, temporaryItem: true }, actor, true);
      // useAttack returns { wasRolled, roll } on fire, { wasRolled: false } on cancel.
      fired = result?.wasRolled === true || result?.rolled === true;
    } catch (err) {
      console.error("D35E | Intelligent item usePower error:", err);
      return;
    }

    // Decrement uses if the power actually fired
    if (fired && !atWill && usesPer) {
      const current = power.system.uses.value ?? 0;
      await this.updatePower(powerId, { system: { uses: { value: Math.max(0, current - 1) } } });
    }
  }

  /**
   * Delete a power entry by its _id.
   * @param {string} powerId
   */
  async deletePower(powerId) {
    const powers = this.#getPowers().filter((p) => p._id !== powerId);
    return this.item.update({ "system.intelligent.powers": powers });
  }

  /**
   * Update fields on a stored power (e.g. egoPoints, uses.value).
   * @param {string} powerId
   * @param {object} delta  Plain object of fields to merge into the power
   */
  async updatePower(powerId, delta) {
    const powers = foundry.utils.duplicate(this.#getPowers());
    const entry = powers.find((p) => p._id === powerId);
    if (!entry) return;
    foundry.utils.mergeObject(entry, delta, { inplace: true });
    return this.item.update({ "system.intelligent.powers": powers });
  }

  /**
   * Return a virtual Item35E built from the stored power snapshot.
   * @param {string} powerId
   * @returns {Item35E|null}
   */
  getPowerItem(powerId) {
    const entry = this.#getPowers().find((p) => p._id === powerId);
    if (!entry) return null;
    return ItemEnhancementHelper.getEnhancementItemFromData(entry, this.item.actor, this.item.isOwner);
  }

  // ----------------------------------------
  // Skill CRUD (stored in system.intelligent.skills)
  // ----------------------------------------

  /**
   * Add a new blank skill row.
   * @param {string} [ability="int"]
   */
  async addSkill(ability = "int") {
    const skills = foundry.utils.duplicate(this.#getSkills());
    skills.push({ _id: foundry.utils.randomID(), name: "", ability, ranks: 0, misc: 0 });
    return this.item.update({ "system.intelligent.skills": skills });
  }

  /**
   * Delete a skill row by id.
   * @param {string} skillId
   */
  async deleteSkill(skillId) {
    const skills = this.#getSkills().filter((s) => s._id !== skillId);
    return this.item.update({ "system.intelligent.skills": skills });
  }

  /**
   * Update fields on a stored skill.
   * @param {string} skillId
   * @param {object} delta
   */
  async updateSkill(skillId, delta) {
    const skills = foundry.utils.duplicate(this.#getSkills());
    const entry = skills.find((s) => s._id === skillId);
    if (!entry) return;
    foundry.utils.mergeObject(entry, delta, { inplace: true });
    return this.item.update({ "system.intelligent.skills": skills });
  }

  // ----------------------------------------
  // Private helpers
  // ----------------------------------------

  #getPowers() {
    return foundry.utils.getProperty(this.item.system, "intelligent.powers") || [];
  }

  #getSkills() {
    return foundry.utils.getProperty(this.item.system, "intelligent.skills") || [];
  }

  async #savePower(power) {
    const powers = foundry.utils.duplicate(this.#getPowers());
    powers.push(power);
    return this.item.update({ "system.intelligent.powers": powers });
  }
}
