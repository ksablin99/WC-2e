/**
 * A small dialog to configure an actor's alignment via structured axes.
 * Supports three modes:
 *   "axes"      – Law–Chaos / Good–Evil radio buttons (including "any" per axis)
 *   "unaligned" – creature has no alignment
 *   "text"      – use the legacy free-text alignment field
 */
export class AlignmentSelectorDialog extends FormApplication {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "alignment-selector",
      classes: ["D35E", "alignment-selector"],
      title: game.i18n.localize("D35E.AlignmentSelector"),
      template: "systems/warcraftrpg2e/templates/apps/alignment-selector.html",
      width: 340,
      height: "auto",
      closeOnSubmit: true,
    });
  }

  /** @override */
  getData() {
    const details = this.object.system.details;
    return {
      mode: details.alignmentMode ?? "text",
      lawChaos: details.alignmentAxes?.lawChaos ?? "n",
      goodEvil: details.alignmentAxes?.goodEvil ?? "n",
      alignmentText: details.alignment ?? "",
      lawChaosOptions: [
        { value: "l", label: game.i18n.localize("D35E.AlignmentLawful") },
        { value: "n", label: game.i18n.localize("D35E.AlignmentNeutral") },
        { value: "c", label: game.i18n.localize("D35E.AlignmentChaotic") },
        { value: "any", label: game.i18n.localize("D35E.AlignmentAny") },
      ],
      goodEvilOptions: [
        { value: "g", label: game.i18n.localize("D35E.AlignmentGood") },
        { value: "n", label: game.i18n.localize("D35E.AlignmentNeutral") },
        { value: "e", label: game.i18n.localize("D35E.AlignmentEvil") },
        { value: "any", label: game.i18n.localize("D35E.AlignmentAny") },
      ],
    };
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
    root.querySelectorAll('input[name="mode"]').forEach((radio) => {
      radio.addEventListener("change", () => this._onModeChange(root));
    });
    this._onModeChange(root);
  }

  _onModeChange(root) {
    const mode = root.querySelector('input[name="mode"]:checked')?.value ?? "text";
    const axesSection = root.querySelector(".alignment-axes");
    const textSection = root.querySelector(".alignment-text");

    // Disable / grey-out fields that don't apply to the current mode, rather
    // than hiding them — keeps the dialog a fixed size.
    axesSection?.querySelectorAll('input[type="radio"]').forEach((r) => {
      r.disabled = mode !== "axes";
    });
    axesSection?.classList.toggle("inactive", mode !== "axes");

    const textInput = textSection?.querySelector('input[type="text"]');
    if (textInput) textInput.disabled = mode !== "text";
    textSection?.classList.toggle("inactive", mode !== "text");
  }

  /** @override */
  async _updateObject(_event, formData) {
    const updates = {
      "system.details.alignmentMode": formData.mode,
    };
    if (formData.mode === "axes") {
      updates["system.details.alignmentAxes.lawChaos"] = formData.lawChaos;
      updates["system.details.alignmentAxes.goodEvil"] = formData.goodEvil;
    } else if (formData.mode === "text") {
      updates["system.details.alignment"] = formData.alignmentText;
    }
    await this.object.update(updates);
  }
}
