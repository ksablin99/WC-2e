export class WorldDefaultConfig extends FormApplication {
  constructor(object, options) {
    super(object || WorldDefaultConfig.defaultSettings, options)
    let settings = game.settings.get("warcraftrpg2e", "worldDefaults")
    settings = foundry.utils.mergeObject(WorldDefaultConfig.defaultSettings, settings)
    this.entries = settings.worldDefaults.customSkills
  }

  get skillOptions() {
    return {fields: 'Name;Attribute (Short);Requires Training;Armor Check Penalty', dtypes: 'String;Attribute;Boolean;Boolean'}
  }

  get fields() {
    return this.skillOptions.fields.split(";");
  }

  get dtypes() {
    return this.skillOptions.dtypes.split(";");
  }

  get dataCount() {
    return this.fields.length;
  }

  /** Collect data for the template. @override */
  async getData() {
    let settings = await game.settings.get("warcraftrpg2e", "worldDefaults")
    settings = foundry.utils.mergeObject(WorldDefaultConfig.defaultSettings, settings)
    game.D35E.logger.log(settings)
    const entries = this.entries.map(o => {
      return o.map((o2, a) => {
        return [o2, this.dtypes[a]];
      });
    });
    return {
      settings: settings,
      skillsets: CONFIG.D35E.skills,
      abilities: CONFIG.D35E.abilities,
      entries: entries,
      fields: this.fields,
    }
  }

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title:  game.i18n.localize("SETTINGS.D35EWorldDefaults"),
      id: 'world-defaults',
      template: "systems/warcraftrpg2e/templates/settings/world-defaults.html",
      width: 1220,
      height: "auto"
    })
  }

  static get defaultSettings() {
    return {
      worldDefaults: {
        skills: {
          aut: "hide",
          kdu: "hide",
          ken: "hide",
          kge: "hide",
          khi: "hide",
          kps: "hide",
          mos: "hide",
          psi: "hide",
          upd: "hide",
        },
        customSkills: [],
        
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
    root.querySelectorAll(".entry-control").forEach(el => el.addEventListener("click", this._onEntryControl.bind(this)));
    root.querySelectorAll('tr td input[type="text"]').forEach(el => el.addEventListener("change", this._onEntryChange.bind(this)));
    root.querySelectorAll('tr td select.custom-skill').forEach(el => el.addEventListener("change", this._onEntryChange.bind(this)));
  }

  async _onEntryControl(event) {
    event.preventDefault();
    const a = event.currentTarget;

    if (a.classList.contains("add-entry")) {
      let obj = [];
      if (this.progression) {
        for (let a = 0; a < this.dataCount; a++) {
          let dataType = this.dtypes[a];
          if (a > 0) {
            if (dataType === "Number") obj.push(this.entries.length === 0 ? -1 : this.entries[this.entries.length - 1][a]);
            else obj.push("");
          } else {
            obj.push(this.entries.length+1);
          }
        }
        this.entries.push(obj);
      } else {
        for (let a = 0; a < this.dataCount; a++) {
          let dataType = this.dtypes[a];
          if (dataType === "Number") obj.push(0);
          else obj.push("");
        }
        this.entries.push(obj);
      }
      this._render(false);
    }

    if (a.classList.contains("delete-entry")) {
      const tr = a.closest("tr");
      const index = parseInt(tr.dataset.index);
      this.entries.splice(index, 1);
      this._render(false);
    }
  }

  async _onEntryChange(event) {
    const a = event.currentTarget;

    const tr = a.closest("tr.entry");
    const index = parseInt(tr.dataset.index);
    const index2 = parseInt(a.dataset.index);
    const value = a.value;
    game.D35E.logger.log(tr.dataset, a.dataset, a.value)
    if (a.dataset.dtype === "Number") {
      let v = parseFloat(value);
      if (isNaN(v)) v = 0;
	  /** round off to the nearest .0001 of a standard gp */
      this.entries[index][index2] = v === 0 ? 0 : Math.floor(v * 1000000) / 1000000;
    }
    else this.entries[index][index2] = value;
  }

  /**
   * Handle button click to reset default settings
   * @param event {Event}   The initial button click event
   * @private
   */
  async _onReset(event) {
    event.preventDefault();
    await game.settings.set("warcraftrpg2e", "worldDefaults", WorldDefaultConfig.defaultSettings)
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
    settings.worldDefaults.customSkills = this.entries
    await game.settings.set("warcraftrpg2e", "worldDefaults", settings)
    ui.notifications.info(`Updated D35E roll configuration.`)
  }
}
