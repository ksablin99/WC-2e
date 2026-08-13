import { ActorSheetPF } from "../sheets/base.js";
import { CR } from "../../lib.js";
import { Roll35e } from "../../roll.js";

/**
 * An Actor sheet for NPC type characters in the D&D5E system.
 * Extends the base ActorSheetPF class.
 * @type {ActorSheetPF}
 */
export class ActorSheetObject extends ActorSheetPF {
  /**
   * Define default rendering options for the NPC sheet
   * @return {Object}
   */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["D35E", "sheet", "actor", "npc", "object"],
      width: 725,
      height: 400,
    });
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */

  /* -------------------------------------------- */

  /**
   * Get the correct HTML template path to use for rendering this particular sheet
   * @type {String}
   */
  get template() {
    return "systems/warcraftrpg2e/templates/actors/object-sheet.html";
  }

  /* -------------------------------------------- */

  /**
   * Add some extra data when rendering the sheet to reduce the amount of logic required within the template.
   */
  async getData() {
    const sheetData = await super.getData();
    sheetData.material = this.actor.material;
    sheetData.attackFeatures = [];
    sheetData.items
      .filter((obj) => {
        return obj.type === "feat" || obj.type === "attack";
      })
      .forEach((obj) => {
        sheetData.attackFeatures.push(obj);
      });
    // Challenge Rating
    const cr = parseFloat(sheetData.system.details.cr || 0);
    sheetData.labels.cr = CR.fromNumber(cr);
    return sheetData;
  }

  /* -------------------------------------------- */
  /*  Object Updates                              */

  /* -------------------------------------------- */

  /**
   * This method is called upon form submission after form data is validated
   * @param event {Event}       The initial triggering submission event
   * @param formData {Object}   The object of validated form data with which to update the object
   * @private
   */
  async _updateObject(event, formData) {
    // Parent ActorSheet update steps
    super._updateObject(event, formData);
  }

  /* -------------------------------------------- */
  /*  Event Listeners and Handlers                */

  /* -------------------------------------------- */

  /**
   * Activate event listeners using the prepared sheet HTML
   * @param html {HTML}   The prepared HTML object ready to be rendered into the DOM
   */
  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;

    root.querySelectorAll(".health .rollable").forEach(el => el.addEventListener("click", this._onRollHealthFormula.bind(this)));
  }

  /* -------------------------------------------- */

  /**
   * Handle rolling NPC health values using the provided formula
   * @param {Event} event     The original click event
   * @private
   */
  async _onRollHealthFormula(event) {
    event.preventDefault();
    const formula = this.actor.system.attributes.hp.formula;
    if (!formula) return;
    const hp = (await new Roll35e(formula).roll()).total;
    AudioHelper.play({ src: CONFIG.sounds.dice });
    await this.actor.update({ "system.attributes.hp.value": hp, "system.attributes.hp.max": hp });
  }
}
