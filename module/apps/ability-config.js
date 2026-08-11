/**
 * A simple form to set actor movement speeds
 * @implements {BaseEntitySheet}
 */
export default class AbilityConfig extends DocumentSheet {
    constructor(...args) {
        super(...args);
        this.ability = this.options.name;
    }


    /** @override */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["D35E"],
            template: "systems/warcraftrpg2e/templates/apps/ability-config.html",
            width: 300,
            height: "auto"
        });
    }

    /* -------------------------------------------- */

    /** @override */
    get title() {
        return `${game.i18n.localize("D35E.AttributeDamageConfig")}: ${this.object.name}`;
    }

    /* -------------------------------------------- */

    /** @override */
    getData(options) {
        const ability = this.object.system.abilities[this.ability] ?? {};
        const data = {
            ability: ability,
            name: this.ability
        };
        return data;
    }
}
