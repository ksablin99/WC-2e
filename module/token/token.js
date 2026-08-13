import { hasTokenVision } from "../apps/vision-permission.js";
import { getSystemFlag } from "../utils/system-flags.js";

export class TokenPF extends foundry.canvas.placeables.Token {
  get actorVision() {
    return {
      lowLight: foundry.utils.getProperty(this.actor, "system.senses.lowLight"),
      lowLightMultiplier: foundry.utils.getProperty(this.actor, "system.senses.lowLightMultiplier"),
      lowLightMultiplierBright: foundry.utils.getProperty(this.actor, "system.senses.lowLightMultiplier"),
    };
  }

  get disableLowLight() {
    return getSystemFlag(this.document, "disableLowLight") === true;
  }

  // Token#observer patch to make use of vision permission settings
  get observer() {
    return game.user.isGM || hasTokenVision(this);
  }

  _onUpdate(data, options, user) {
    if (options.render === false) return;

    if (
      foundry.utils.hasProperty(data, "flags.warcraftrpg2e.customVisionRules")
      || foundry.utils.hasProperty(data, "flags.D35E.customVisionRules")
    ) {
      // Make sure this token's perception changes
      data.sight ||= {};
    }
    return super._onUpdate(data, options, user);
  }

  updateVisionSource(...args) {
    this.document.refreshDetectionModes();
    super.updateVisionSource(...args);
  }
}
