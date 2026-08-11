import {Item35E} from "./entity.js";
import {ItemEnhancements} from "./extensions/enhancement.js";
import { ItemSpellHelper } from './helpers/itemSpellHelper.js'

export class Spell35E extends Item35E {
    constructor(...args) {
        super(...args);
    }


    get subType() {
    }

    async getDescription(unidentified = false) {
        return foundry.applications.ux.TextEditor.enrichHTML(foundry.utils.getProperty(this.system, "shortDescription"), {async: true, rollData: this.getActorItemRollData()})
    }

    async getChatDescription() {
        const data = await ItemSpellHelper.generateSpellDescription(this, true);
        return foundry.applications.handlebars.renderTemplate("systems/warcraftrpg2e/templates/internal/spell-description.html", data);
    }
}
