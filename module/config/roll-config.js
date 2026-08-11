import { getRollModesForSelect } from "../lib.js";

export class RollConfig extends FormApplication {
  constructor(object, options) {
    super(object || RollConfig.defaultSettings, options)
  }

  /** Collect data for the template. @override */
  async getData() {
    let settings = await game.settings.get("warcraftrpg2e", "rollConfig")
    settings = foundry.utils.mergeObject(RollConfig.defaultSettings, settings)
    return { settings, rollModes: CONFIG.Dice.rollModes, rollModesForSelect: getRollModesForSelect() }
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title:  game.i18n.localize("SETTINGS.D35ERollConfigName"),
      id: 'roll-config',
      template: "systems/warcraftrpg2e/templates/settings/roll-config.html",
      width: 480,
      height: "auto"
    })
  }

  static get defaultSettings() {
    return {
      rollConfig: {
        character:     {attack: "", applyDamage: "", skill: "", savingThrow: "", grapple: "", hpRoll: ""},
        npc:    {attack: "", applyDamage: "", skill: "", savingThrow: "", grapple: "", hpRoll: ""},
        trap:    {attack: "", applyDamage: "", skill: "", savingThrow: "", grapple: "", hpRoll: ""}
      }
    }
  }

  /**
   * Activate the default set of listeners for the Entity sheet These listeners handle basic stuff like form submission or updating images.
   * @override
   */
  activateListeners(html) {
    super.activateListeners(html)
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;

    root.querySelector('button[name="reset"]')?.addEventListener("click", this._onReset.bind(this));
    root.querySelector('button[name="submit"]')?.addEventListener("click", this._onSubmit.bind(this));
  }

  /**
   * Handle button click to reset default settings
   * @param event {Event}   The initial button click event
   * @private
   */
  async _onReset(event) {
    event.preventDefault();
    await game.settings.set("warcraftrpg2e", "rollConfig", RollConfig.defaultSettings)
    ui.notifications.info(`Reset D35E roll configuration.`)
    return this.render()
  }

  _onSubmit(event) {
    super._onSubmit(event)
  }

  /**
   * This method is called upon form submission after form data is validated.
   * @override
   */
  async _updateObject(event, formData) {
    const settings = foundry.utils.expandObject(formData)
    await game.settings.set("warcraftrpg2e", "rollConfig", settings)
    ui.notifications.info(`Updated D35E roll configuration.`)
  }
}
