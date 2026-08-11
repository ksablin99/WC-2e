/**
 * Add a checkbox to enable/disable low-light vision effects to a light's configuration
 *
 * @param {AmbientLightConfig} app - The LightConfig app
 * @param {HTMLElement} html - The application HTML element
 */
export function addLowLightVisionToLightConfig(app, html) {
  /** @type {AmbientLightDocument} */
  const light = app.document;

  // Create checkbox HTML element
  const bf = new foundry.data.fields.BooleanField();

  /** @type {HTMLElement} */
  const el = bf.toFormGroup(
    {
      label: game.i18n.localize("D35E.SETTINGS.DisableLLV.Label"),
      hint: game.i18n.localize("D35E.SETTINGS.DisableLLV.Hint"),
    },
    {
      name: "flags.D35E.disableLowLight",
      value: light.getFlag("D35E", "disableLowLight") ?? false,
    }
  );

  // Create containing fieldset
  const field = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = game.i18n.localize("D35E.Vision");
  field.append(legend, el);

  // Insert new checkbox
  html.querySelector('section.tab[data-tab="advanced"]').append(field);
}

/**
 * @param {TokenDocument} token
 * @returns {boolean}
 */
const hasSystemVision = (token) => token.getFlag("D35E", "customVisionRules") !== true;

/**
 * LLV support mixin for AmbientLight and Token
 *
 * Adds light-radius multiplication effect to both light sources.
 *
 * @param {class} Base - Base class
 * @returns {class} - Mixin class
 */
export const LLVMixin = (Base) =>
  class extends Base {
    /** @override */
    _getLightSourceData() {
      const data = super._getLightSourceData();

      const { dim, bright } = this.getRadius(data.dim, data.bright);

      // Avoid NaN and introducing keys that shouldn't be in the data
      // Without undefined check, global illumination will cause darkvision and similar vision modes to glitch.
      // We're assuming getRadius gives sensible values otherwise.
      if (data.dim !== undefined) data.dim = dim;
      if (data.bright !== undefined) data.bright = bright;

      return data;
    }

    /**
     * @param {number} dim - Dim radius
     * @param {number} bright - Bright radius
     * @returns {{dim:number,bright:number}} - Adjusted distances
     */
    getRadius(dim, bright) {
      const result = { dim, bright };
      let multiplier = { dim: 1, bright: 1 };

      // System vision is disabled
      if (!game.settings.get("warcraftrpg2e", "vision")) return result;
      // This light source has LLV handling disabled
      if (this.document.getFlag("D35E", "disableLowLight")) return result;

      const token = this.object?.document;
      if (token && !hasSystemVision(token)) return result;

      const requiresSelection = game.user.isGM || game.settings.get("warcraftrpg2e", "lowLightVisionMode");
      const relevantTokens = canvas.tokens.placeables.filter((token) => {
        const tokenDoc = token.document;
        return (
          token.actor?.testUserPermission(game.user, "OBSERVER") &&
          (requiresSelection ? token.controlled : true) &&
          hasSystemVision(tokenDoc)
        );
      });
      const lowLightTokens = relevantTokens.filter((o) => o.actorVision.lowLight === true);

      if (requiresSelection) {
        if (lowLightTokens.length > 0 && lowLightTokens.length === relevantTokens.length) {
          multiplier = { dim: 999, bright: 999 };
          for (const t of lowLightTokens) {
            const tokenVision = t.actorVision;
            multiplier.dim = Math.min(multiplier.dim, tokenVision.lowLightMultiplier);
            multiplier.bright = Math.min(multiplier.bright, tokenVision.lowLightMultiplierBright);
          }
        }
      } else {
        for (const t of lowLightTokens) {
          const tokenVision = t.actorVision;
          multiplier.dim = Math.max(multiplier.dim, tokenVision.lowLightMultiplier);
          multiplier.bright = Math.max(multiplier.bright, tokenVision.lowLightMultiplierBright);
        }
      }

      result.dim *= multiplier.dim;
      result.bright *= multiplier.bright;

      return result;
    }
  };

/**
 * Re-initialize light sources.
 *
 * @remarks
 * Foundry v12 no longer initializes the lights fully on calling perception manager to do so, making the following insufficient.
 * ```js
 * canvas.perception.update({ initializeLighting: true }, true);
 * ```
 */
export function reinitLightSources() {
  // On strange occasions looping lightSources directly causes the loop to become infinite
  // ... if this early array transformation is not done.
  // For example if token with light source is given greater priority.
  const lights = [...canvas.effects.lightSources];

  for (const light of lights) {
    light.object?.initializeLightSource?.();
  }
}

/**
 * Debounced call to {@link reinitLightSources}
 */
export const debouncedLightSourceReInit = foundry.utils.debounce(reinitLightSources, 100);
