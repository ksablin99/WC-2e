import { ActorSheetPFNPC } from "./npc.js";

export class ActorSheetPFNPCCombat extends ActorSheetPFNPC {

  /**
   * Define default rendering options for the NPC sheet
   * @return {Object}
   */
	static get defaultOptions() {
	  return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["D35E", "sheet", "actor", "npc", "monster", "sidebar"],
        height: 0,
        popOut: false,
        id: "actor-combat-sheet"
    });
  }

  get id() {
    return "actor-combat-sheet";
  }
    
  get template() {
    return "systems/warcraftrpg2e/templates/actors/npc-sheet-combat.html";
  }

  _render(...args) {
    this._element = null;
    return super._render(...args);
  }

  /**
   * When the placeholder element doesn't exist in the DOM (v13 ApplicationV2 tracker
   * no longer renders combat-tracker.html which contained #actor-combat-sheet), inject
   * the form directly before the combat controls footer so it stays at the bottom of the
   * combat sidebar rather than being appended to <body>.
   * @override
   */
  _injectHTML(html) {
    const combatSection = document.querySelector('section[data-tab="combat"]')
      ?? document.querySelector('#combat');
    if (combatSection) {
      const footer = combatSection.querySelector('nav.combat-controls, .directory-footer, #combat-controls');
      if (footer) footer.before(html[0]);
      else combatSection.append(html[0]);
      this._element = html;
      html.hide().fadeIn(200);
    } else {
      super._injectHTML(html);
    }
  }
}
