export class TokenDocumentPF extends TokenDocument {
  // Todo: Declare this in TokenDocumentPF when/ if TokenDocument.getData calls the constructor's method
  static getTrackedAttributes(data, path = []) {
    const attr = super.getTrackedAttributes(data, path);
    if (path.length === 0) {
      if (!attr.value.find(a => a[0] === "attributes" && a[1] === "hp" && a[2] === "temp")) {
        attr.value.push(["attributes", "hp", "temp"]);
      }
      if (!attr.value.find(a => a[0] === "attributes" && a[1] === "hp" && a[2] === "nonlethal")) {
        attr.value.push(["attributes", "hp", "nonlethal"]);
      }
      if (!attr.bar.find(a => a[0] === "damage" && a[1] === "nonlethal")) {
        attr.bar.push(["damage", "nonlethal"]);
      }
    }
    return attr;
  }

  /**
   * Hijack Token health bar rendering to include temporary and temp-max health in the bar display
   *
   * @param barName
   * @param root0
   * @param root0.alternative
   */
  getBarAttribute(barName, { alternative = null } = {}) {
    let data;
    try {
      data = super.getBarAttribute(barName, { alternative: alternative });
    } catch (e) {
      data = null;
    }

    if (data != null) {
      // Add temp HP to current current health value for HP and Vigor
      if (data.attribute === "attributes.hp") {
        data.value += parseInt(foundry.utils.getProperty(this.actor, "system.attributes.hp.temp") || 0);
      } else if (data.attribute === "attributes.vigor") {
        data.value += parseInt(foundry.utils.getProperty(this.actor, "system.attributes.vigor.temp") || 0);
      }

      // Make resources editable
      if (data.attribute.startsWith("resources.")) data.editable = true;
    }

    return data;
  }

  /**
   * Refresh sight and detection modes according to the actor's senses associated with this token.
   */
  refreshDetectionModes() {
    if (!this.actor) return;
    if (!["character", "npc"].includes(this.actor.type)) return;
    if (this.actor?.system?.noVisionOverride) return;

    // Reset sight properties
    this.sight.color = null;
    this.sight.attenuation = 0;
    this.sight.brightness = 0;
    this.sight.contrast = 0;
    this.sight.saturation = 0;
    this.sight.enabled = true;
    this.sight.visionMode = "basic";
    this.sight.range = 0;

    // Read senses from the correct path (system.attributes.senses)
    const senses = this.actor?.system?.attributes?.senses ?? {};
    const darkvisionRange = senses.darkvision ?? 0;
    const blindsightRange = senses.blindsight ?? 0;
    const tremorsenseRange = senses.tremorsense ?? 0;
    const truesightRange = senses.truesight ?? 0;

    // Prepare sight
    if (darkvisionRange > 0) {
      this.sight.range = darkvisionRange;
      this.sight.visionMode = "darkvision";
    }

    // Helper: upsert a detection mode by id
    const upsertMode = (id, range) => {
      const existing = this.detectionModes.find((m) => m.id === id);
      if (range > 0) {
        if (!existing) this.detectionModes.push({ id, enabled: true, range });
        else existing.range = range;
      } else if (existing) {
        this.detectionModes.splice(this.detectionModes.indexOf(existing), 1);
      }
    };

    // Set basic detection mode (always present, range = darkvision)
    const basicId = foundry.canvas.perception.DetectionMode.BASIC_MODE_ID;
    const basicMode = this.detectionModes.find((m) => m.id === basicId);
    if (!basicMode) this.detectionModes.push({ id: basicId, enabled: true, range: this.sight.range });
    else basicMode.range = this.sight.range;

    upsertMode("seeInvisibility", truesightRange);
    upsertMode("blindSight", blindsightRange);
    upsertMode("feelTremor", tremorsenseRange);

    // Sort detection modes
    this.detectionModes.sort(this._sortDetectionModes.bind(this));

    const visionDefaults = CONFIG.Canvas.visionModes[this.sight.visionMode]?.vision?.defaults || {};
    for (const fieldName of ["attenuation", "brightness", "saturation", "contrast"]) {
      if (fieldName in visionDefaults) {
        this.sight[fieldName] = visionDefaults[fieldName];
      }
    }

  }

  _sortDetectionModes(a, b) {
    if (a.id === foundry.canvas.perception.DetectionMode.BASIC_MODE_ID) return -1;
    if (b.id === foundry.canvas.perception.DetectionMode.BASIC_MODE_ID) return 1;

    const src = { a: CONFIG.Canvas.detectionModes[a.id], b: CONFIG.Canvas.detectionModes[b.id] };
    return (src.a.constructor.PRIORITY ?? 0) - (src.b.constructor.PRIORITY ?? 0);
  }
}
