import { ActorSheetPFNPC } from "./npc.js";

export class ActorSheetPFNPCLite extends ActorSheetPFNPC {

  /**
   * Define default rendering options for the NPC sheet
   * @return {Object}
   */
	static get defaultOptions() {
	  return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["D35E", "sheet", "actor", "npc", "lite"],
      width: 440,
      height: 200,
    });
  }
    
  get template() {
    if ( !game.user.isGM && this.actor.limited ) return "systems/warcraftrpg2e/templates/actors/limited-sheet.html";
    return "systems/warcraftrpg2e/templates/actors/npc-sheet-lite.html";
  }
}