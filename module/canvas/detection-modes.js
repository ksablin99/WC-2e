/**
 * See invisibility detection mode with respect to sight (light & darkvision)
 *
 * Replacement for `CONFIG.Canvas.detectionModes.seeInvisibility`
 *
 * @internal
 * @hideconstructor
 */
export class DetectionModeInvisibilityPF extends foundry.canvas.perception.DetectionModeInvisibility {
    static ID = "seeInvisibility";
    static LABEL = "D35E.Sense.seeInvis";
    static PRIORITY = 100_000;
  
    /**
     * Copy of DetectionModeBasicSight._testPoint instead of the one inherited from DetectionMode.
     *
     * Allows seeing invisible in lit areas.
     *
     * @override
     * @hidden
     */
    _testPoint(visionSource, mode, target, test) {
      // Blocked by walls
      if (!this._testLOS(visionSource, mode, target, test)) return false;
      // Otherwise allowed within range
      if (this._testRange(visionSource, mode, target, test)) return true;
  
      // If limited (e.g. true seeing), do not care about other light sources beyond range
      if (mode.limited) return false;
  
      // Allowed outside of range if lit
      const { x, y } = test.point;
      for (const lightSource of canvas.effects.lightSources.values()) {
        if (!lightSource.active) continue;
        if (lightSource.shape.contains(x, y)) return true;
      }
      return false;
    }
  }
  
  /**
   * Blindsense
   *
   * Registered at `CONFIG.Canvas.detectionModes.blindSense`
   *
   * @internal
   * @hideconstructor
   */
  export class DetectionModeBlindSensePF extends foundry.canvas.perception.DetectionMode {
    static ID = "blindSense";
    static LABEL = "D35E.Sense.blindsense";
    static DETECTION_TYPE = foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER;
    static PRIORITY = 200_100;
  
    constructor(data = {}, ...args) {
      data.walls = true;
      super(data, ...args);
    }
  
    /**
     * @override
     * @hidden
     */
    static getDetectionFilter() {
      this._detectionFilter ??= foundry.canvas.rendering.filters.OutlineOverlayFilter.create({
        outlineColor: [0, 0.33, 0.6, 1],
        knockout: false,
        wave: this.ID === "blindSense",
      });
      return this._detectionFilter;
    }
  
    /**
     * @override
     * @hidden
     */
    _canDetect(visionSource, target) {
      return true;
    }
  }
  
  /**
   * Blindsight
   *
   * Registered at `CONFIG.Canvas.detectionModes.blindSight`
   *
   * @internal
   * @hideconstructor
   */
  export class DetectionModeBlindSightPF extends DetectionModeBlindSensePF {
    static ID = "blindSight";
    static LABEL = "D35E.Sense.blindsight";
    static DETECTION_TYPE = foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER;
    static PRIORITY = 200_000;
  
    /**
     * @override
     * @hidden
     */
    static getDetectionFilter() {
      this._detectionFilter ??= foundry.canvas.rendering.filters.OutlineOverlayFilter.create({
        outlineColor: [0, 0.33, 0.6, 1],
        knockout: false,
        wave: false,
      });
      return this._detectionFilter;
    }
  }
  
  /**
   * Lifesense
   *
   * Registered at `CONFIG.Canvas.detectionModes.lifesense`
   *
   * @internal
   * @hideconstructor
   */
  export class DetectionModeLifesensePF extends foundry.canvas.perception.DetectionMode {
    static ID = "lifesense";
    static LABEL = "PF1.Sense.lifesense";
    static DETECTION_TYPE = foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER;
    static PRIORITY = 200_200;
  
    /**
     * @override
     * @hidden
     */
    static getDetectionFilter() {
      this._detectionFilter ??= foundry.canvas.rendering.filters.OutlineOverlayFilter.create({
        outlineColor: [1, 0.1, 0.2, 1],
        knockout: false,
        wave: this.ID === "lifesense",
      });
      return this._detectionFilter;
    }
  
    /**
     * @override
     * @hidden
     */
    _canDetect(visionSource, target) {
      const rv = super._canDetect(visionSource, target);
  
      if (rv) {
        const traits = target.actor?.system?.traits;
        if (!traits?.living) {
          return false;
        }
      }
  
      return rv;
    }
  }
  
  /**
   * Tremorsense
   *
   * Unlike base implementation, does not block with walls but also does not detect swimming.
   *
   * Replacement for `CONFIG.Canvas.detectionModes.feelTremor`
   *
   * @internal
   * @hideconstructor
   */
  export class DetectionModeTremorPF extends foundry.canvas.perception.DetectionModeTremor {
    static ID = "feelTremor";
    static LABEL = "D35E.Sense.tremorsense";
    static DETECTION_TYPE = foundry.canvas.perception.DetectionMode.DETECTION_TYPES.MOVE;
    static PRIORITY = 201_000;
  
    constructor(data = {}, ...args) {
      data.walls = false;
      super(data, ...args);
    }
  
    /**
     * @override
     * @hidden
     */
    static getDetectionFilter() {
      this._detectionFilter ??= foundry.canvas.rendering.filters.OutlineOverlayFilter.create({
        outlineColor: [1, 0.8, 0.6, 1],
        knockout: false,
        wave: this.ID === "feelTremor",
      });
      return this._detectionFilter;
    }
  
    /**
     * @override
     * @hidden
     */
    _canDetect(visionSource, target) {
      const rv = super._canDetect(visionSource, target);
      if (!rv) return false;
  
      const source = visionSource?.object;
  
      // Tremorsense only works while touching the ground
      if (
        source.document.hasStatusEffect(CONFIG.specialStatusEffects.FLY) ||
        source.document.hasStatusEffect(CONFIG.specialStatusEffects.HOVER)
      ) {
        return false;
      }
  
      // If only one party is swimming, tremorsense does not work
      const targetSwimming = target.document.hasStatusEffect(CONFIG.specialStatusEffects.SWIM);
      const sourceSwimming = source?.document.hasStatusEffect(CONFIG.specialStatusEffects.SWIM);
      if (sourceSwimming !== targetSwimming) return false;
  
      // Only aquatic creatures can use tremorsense in water
      const sourceIsAquatic = source?.actor?.system.traits?.creatureSubtypes?.standard?.has("aquatic") ?? false;
      if (targetSwimming && !sourceIsAquatic) return false;
  
      return true;
    }
  }
  
  /**
   * Thoughtsense
   *
   * Registered at `CONFIG.Canvas.detectionModes.thoughtsense`
   *
   * @internal
   * @hideconstructor
   */
  export class DetectionModeThoughtSensePF extends foundry.canvas.perception.DetectionMode {
    static ID = "thoughtsense";
    static LABEL = "PF1.Sense.thoughtsense";
    static DETECTION_TYPE = foundry.canvas.perception.DetectionMode.DETECTION_TYPES.OTHER;
    static PRIORITY = 200_300;
  
    /**
     * @override
     * @hidden
     */
    static getDetectionFilter() {
      this._detectionFilter ??= foundry.canvas.rendering.filters.OutlineOverlayFilter.create({
        outlineColor: [0.3, 0, 0.8, 1],
        knockout: true,
        wave: this.ID === "thoughtsense",
      });
      return this._detectionFilter;
    }
  
    /**
     * @override
     * @hidden
     */
    _canDetect(visionSource, target) {
      const rv = super._canDetect(visionSource, target);
  
      if (rv) {
        const actor = target.actor;
        if (!actor) return false;
  
        const int = actor?.system?.abilities?.int;
        if (int?.total < 1) {
          return false;
        }
  
        if (
          actor.statuses.has(CONFIG.specialStatusEffects.DEAD) ||
          actor.statuses.has(CONFIG.specialStatusEffects.UNCONSCIOUS)
        ) {
          return false;
        }
      }

      return rv;
    }
  };

// D35E aliases for registration in D35E.js
export { DetectionModeInvisibilityPF as DetectionModeInvisibilityD35E };
export { DetectionModeBlindSightPF as DetectionModeBlindSightD35E };
export { DetectionModeTremorPF as DetectionModeTremorD35E };
