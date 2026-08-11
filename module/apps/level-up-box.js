export class LevelUpDialog extends FormApplication {
    constructor(...args) {
        super(...args);

        this.actor = this.object;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "level-up-box",
            classes: ["D35E", "entry"],
            title: "Level Up Wizard",
            template: "systems/warcraftrpg2e/templates/apps/level-up-box.html",
            width: 320,
            height: "auto",
            closeOnSubmit: false,
            submitOnClose: false,
        });
    }

    get attribute() {
        return this.options.name;
    }

    getData() {
        let data = {actor: this.actor, hasNewFeat: (this.actor.system.details.level.available + 1) % 3 == 0, hasNewAbility: (this.actor.system.details.level.available + 1) % 4 == 0,
            config: CONFIG.D35E}
        return data
    }

    activateListeners(html) {
        const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
        root.querySelectorAll('button[type="submit"]').forEach(el => el.addEventListener("click", this._submitAndClose.bind(this)));
        root.querySelectorAll('textarea').forEach(el => el.addEventListener("change", this._onEntryChange.bind(this)));
    }

    async _onEntryChange(event) {
        const a = event.currentTarget;
    }

    async _updateObject(event, formData) {
        const updateData = {};
        let ability = formData['ability'];
        if (ability !== undefined)
            updateData[`system.abilities.${ability}.value`] = this.actor.system.abilities[ability].value + 1

        updateData[`system.details.level.available`] = (this.actor.system.details.level.available || 0) + 1
        return this.object.update(updateData);
    }

    async _submitAndClose(event) {
        event.preventDefault();
        await this._onSubmit(event);
        this.close();
    }
}