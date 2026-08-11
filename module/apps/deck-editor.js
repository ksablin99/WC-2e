export class DeckEditor extends FormApplication {
    constructor(...args) {
        super(...args);

        this.spellbook = foundry.utils.duplicate(foundry.utils.getProperty(this.object, this.attribute) || {});
        this.actor = this.object;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "deck-editor",
            classes: ["D35E", "entry"],
            title: "Notes Selector",
            template: "systems/warcraftrpg2e/templates/apps/deck-editor.html",
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
        return {spellbook: this.spellbook, actor: this.actor,
            config: CONFIG.D35E}
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
        if (!formData['autoSetup']) {
            for (const [key, value] of Object.entries(formData)) {
                updateData[`${this.attribute}.${key}`] = formData[key];
            }
        } else {
            updateData[`${this.attribute}.class`] = formData['class'];
            updateData[`${this.attribute}.name`] = formData['name']
            updateData[`${this.attribute}.autoSetup`] = true;
        }
        return this.object.update(updateData);
    }

    async _submitAndClose(event) {
        event.preventDefault();
        await this._onSubmit(event);
        this.close();
    }
}