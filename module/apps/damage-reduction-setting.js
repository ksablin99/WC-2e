import {CACHE} from "../cache.js";
import {ActorDamageHelper} from "../actor/helpers/actorDamageHelper.js";

export class DamageReductionSetting extends FormApplication {

    constructor(...args) {
        super(...args);

        this.damageReduction = ActorDamageHelper.getDRForActor(this.object, true)
        this.energyResistance = ActorDamageHelper.getERForActor(this.object, true)
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "dr-setting",
            classes: ["D35E", "dr-setting"],
            title: "Damage Reduction and Energy Resistance",
            template: "systems/warcraftrpg2e/templates/apps/damage-reduction-setting.html",
            width: 640,
            height: "auto",
            closeOnSubmit: false,
            submitOnClose: false,
        });
    }

    get actor() {
        return this.object;
    }

    getData() {
        return {
            damageReduction: this.damageReduction,
            energyResistance: this.energyResistance
        };
    }

    _appElement() {
        return this.element?.nodeType === 1 ? this.element : this.element?.[0] ?? this.element;
    }

    _refreshComputedDisplay(scope) {
        const el = scope ?? this._appElement();
        if (!el) return;
        const drInput = el.querySelector('input[name="computed-dr"]');
        const erInput = el.querySelector('input[name="computed-er"]');
        if (drInput) drInput.value = ActorDamageHelper.computeDRString(this.damageReduction);
        if (erInput) erInput.value = ActorDamageHelper.computeERString(this.energyResistance);
    }

    activateListeners(html) {
        super.activateListeners(html);
        const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
        root.querySelectorAll('input.value').forEach(el => el.addEventListener("change", this._onEntryChange.bind(this)));
        root.querySelectorAll('input[type="checkbox"]').forEach(el => {
            el.addEventListener("change", this._onEntryChange.bind(this));
            el.addEventListener("change", this._onCheckboxChange.bind(this));
        });

        this._refreshComputedDisplay(root);
    }

    async _onEntryChange(event) {
        let key = event.target.getAttribute('name')
        let value = event.target.value
        this._updateDRERDataFromForm(key, value)
        this._refreshComputedDisplay();
    }
    async _onCheckboxChange(event) {
        let key = event.target.getAttribute('name')
        let value = event.target.checked
        this._updateDRERDataFromForm(key, value)
        this._refreshComputedDisplay();
    }

    async _updateObject(event, formData) {
        Object.keys(formData).forEach(key => {
            let data = formData[key];
            this._updateDRERDataFromForm(key, data);
        })
        const updateData = {};
        updateData[`system.damageReduction`] = ActorDamageHelper.getActorMapForDR(this.damageReduction);
        updateData[`system.energyResistance`] = ActorDamageHelper.getActorMapForER(this.energyResistance);
        await this.actor.update(updateData);

        this.close();
    }

    _updateDRERDataFromForm(key, data) {
        if (key.startsWith("dr-or-")) {
            let dr = key.replace("dr-or-", "")
            ActorDamageHelper.getDamageTypeForUID(this.damageReduction, dr).or = data;
        } else if (key.startsWith("dr-value-")) {
            let dr = key.replace("dr-value-", "")
            ActorDamageHelper.getDamageTypeForUID(this.damageReduction, dr).value = parseInt(data);
        } else if (key.startsWith("dr-lethal-")) {
            let dr = key.replace("dr-lethal-", "")
            ActorDamageHelper.getDamageTypeForUID(this.damageReduction, dr).lethal = data;
        } else if (key.startsWith("dr-immunity-")) {
            let dr = key.replace("dr-immunity-", "")
            ActorDamageHelper.getDamageTypeForUID(this.damageReduction, dr).immunity = data;
        } else if (key.startsWith("er-value-")) {
            let dr = key.replace("er-value-", "")
            ActorDamageHelper.getDamageTypeForUID(this.energyResistance, dr).value = parseInt(data);
        } else if (key.startsWith("er-immunity-")) {
            let dr = key.replace("er-immunity-", "")
            ActorDamageHelper.getDamageTypeForUID(this.energyResistance, dr).immunity = data;
        } else if (key.startsWith("er-vulnerable-")) {
            let dr = key.replace("er-vulnerable-", "")
            ActorDamageHelper.getDamageTypeForUID(this.energyResistance, dr).vulnerable = data;
        } else if (key.startsWith("er-lethal-")) {
            let dr = key.replace("er-lethal-", "")
            ActorDamageHelper.getDamageTypeForUID(this.energyResistance, dr).lethal = data;
        } else if (key.startsWith("er-half-")) {
            let dr = key.replace("er-half-", "")
            ActorDamageHelper.getDamageTypeForUID(this.energyResistance, dr).half = data;
        }
    }
}
