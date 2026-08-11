export class PointBuyCalculator extends FormApplication {

    constructor(...args) {
        super(...args);

        this.abilities = [];
        for (let [k, name] of Object.entries(CONFIG.D35E.abilities)) {
            this.abilities.push({
                key: k,
                name: name,
                value: 10,
            });
        }
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "pointbuy-calculator",
            classes: ["D35E", "pointbuy-calculator"],
            title: "Point Buy Calculator",
            template: "systems/warcraftrpg2e/templates/apps/point-buy-calculator.html",
            width: 320,
            height: "auto",
            closeOnSubmit: false,
            submitOnClose: false,
        });
    }

    get actor() {
        return this.object.actor;
    }

    getData() {
        const points = this.getSpentPoints();

        return {
            abilities: this.abilities,
            points: points,
        };
    }

    getSpentPoints() {
        let result = 0;

        for (let a of this.abilities) {
            result += CONFIG.D35E.abilityCost[a.value];
        }
        return result;
    }

    activateListeners(html) {
        super.activateListeners(html);
        const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
        root.querySelectorAll(".ability-control").forEach(el => el.addEventListener("click", this._onAbilityControl.bind(this)));
    }

    _onAbilityControl(event) {
        event.preventDefault();
        const a = event.currentTarget;
        const ablKey = a.closest(".item").dataset.ability;
        const abl = this.abilities.find(o => o.key === ablKey);

        if (a.classList.contains("add")) {
            abl.value = Math.min(18, abl.value + 1);
        }
        else if (a.classList.contains("subtract")) {
            abl.value = Math.max(7, abl.value - 1);
        }
        this.render();
    }

    async _updateObject(event, formData) {
        const updateData = {};
        for (let a of this.abilities) {
            updateData[`system.abilities.${a.key}.value`] = a.value;
        }
        await this.actor.update(updateData);
        this.close();
    }
}
