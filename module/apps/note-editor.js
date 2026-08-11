export class NoteEditor extends FormApplication {
    constructor(...args) {
        super(...args);

        this.noteData = foundry.utils.duplicate(foundry.utils.getProperty(this.object, this.attribute) || "");
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "note-editor",
            classes: ["D35E", "entry"],
            title: "Notes Selector",
            template: "systems/warcraftrpg2e/templates/apps/note-editor.html",
            width: 800,
            height: 600,
            closeOnSubmit: false,
            submitOnClose: false,
        });
    }

    get attribute() {
        return this.options.name;
    }

    getData() {
        return {noteData: this.noteData}
    }

    activateListeners(html) {
        const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
        root.querySelectorAll('button[type="submit"]').forEach(el => el.addEventListener("click", this._submitAndClose.bind(this)));
        root.querySelectorAll('textarea').forEach(el => el.addEventListener("change", this._onEntryChange.bind(this)));
    }

    async _onEntryChange(event) {
        const a = event.currentTarget;
        this.noteData = a.value;
    }

    async _updateObject(event, formData) {
        const updateData = {};

        updateData[this.attribute] = this.noteData;

        return this.object.update(updateData);
    }

    async _submitAndClose(event) {
        event.preventDefault();
        await this._onSubmit(event);
        this.close();
    }
}