/**
 * Rules accurate darkvision override.
 *
 * Replacement for `CONFIG.Canvas.visionModes.darkvision`
 *
 * @remarks
 * Compared to example implementation, this does not turn dim light into bright.
 *
 * @type {foundry.canvas.perception.VisionMode}
 */
export const darkvision = (() => {
    const data = CONFIG.Canvas.visionModes.darkvision.toObject();
    delete data.lighting.levels[foundry.canvas.perception.VisionMode.LIGHTING_LEVELS.DIM];
    return new foundry.canvas.perception.VisionMode(data);
})();
