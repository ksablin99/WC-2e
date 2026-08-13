import { getSystemFlag, setSystemFlag, unsetSystemFlag } from "../utils/system-flags.js";

export class ActorSheetFlags extends DocumentSheet {
  static get defaultOptions() {
    const options = super.defaultOptions;
    return foundry.utils.mergeObject(options, {
      id: "actor-flags",
      classes: ["D35E"],
      template: "systems/warcraftrpg2e/templates/apps/actor-flags.html",
      width: 500,
      closeOnSubmit: true
    });
  }

  /* -------------------------------------------- */

  /**
   * Configure the title of the special traits selection window to include the Actor name
   * @type {String}
   */
  get title() {
    return `${game.i18n.localize('D35E.FlagsTitle')}: ${this.object.name}`;
  }

  /* -------------------------------------------- */

  /**
   * Prepare data used to render the special Actor traits selection UI
   * @return {Object}
   */
  getData() {
    const data = super.getData();
    data.flags = this._getFlags();
    return data;
  }

  /* -------------------------------------------- */

  /**
   * Prepare an object of flags data which groups flags by section
   * Add some additional data for rendering
   * @return {Object}
   */
  _getFlags() {
    const flags = {};
    for ( let [k, v] of Object.entries(CONFIG.D35E.characterFlags) ) {
      if ( !flags.hasOwnProperty(v.section) ) flags[v.section] = {};
      let flag = foundry.utils.duplicate(v);
      flag.type = v.type.name;
      flag.isCheckbox = v.type === Boolean;
      flag.isSelect = v.hasOwnProperty('choices');
      flag.value = getSystemFlag(this.entity, k);
      flags[v.section][k] = flag;
    }
    return flags;
  }

  /* -------------------------------------------- */

  /**
   * Update the Actor using the configured flags
   * Remove/unset any flags which are no longer configured
   */
  async _updateObject(event, formData) {
    const actor = this.object;

    // Iterate over the flags which may be configured
    for ( let [k, v] of Object.entries(CONFIG.D35E.characterFlags) ) {
      const shouldUnset = [undefined, null, "", false].includes(formData[k])
        || ((v.type === Number) && (formData[k] === 0));
      if (shouldUnset) await unsetSystemFlag(actor, k);
      else await setSystemFlag(actor, k, formData[k]);
    }
    return actor;
  }
}
