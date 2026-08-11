import { ItemSpellHelper } from "../helpers/itemSpellHelper.js";

export class IntelligentItemPowerConverter {
  /**
   * Convert a spell item into a spell-like power snapshot for intelligent items.
   *
   * The snapshot is typed "enhancement" with isFromSpell=true so it routes through
   * useAttack() → adjustSpellCL() using baseCl, bypassing the actor spellbook entirely.
   * This mirrors how ItemEnhancementConverter.toEnhancement() works for magic item
   * spell-like abilities.
   *
   * @param {object} itemData   Original spell item data (toObject() output)
   * @param {string} usageType  "day" | "charges" | "atwill"
   * @param {number} [clOverride]  Optional CL override — stored as system.baseCl.
   *                               Defaults to the spell's minimum CL.
   * @returns {object} Power data snapshot
   */
  static toSpellPower(itemData, usageType, clOverride) {
    const raw = itemData instanceof Item ? itemData.toObject() : itemData;
    const snapshot = foundry.utils.duplicate(raw);

    // Derive minimum CL from the spell's learnedAt data (same as toEnhancement).
    // Returns [spellLevel, minimumCL]; sentinel [9,20] means no class assignment.
    const slcl = ItemSpellHelper.getMinimumCasterLevelBySpellData(raw.system ?? {});
    if (slcl[0] === 9 && slcl[1] === 20) {
      // Spell has no class assignment — can't compute meaningful CL or spell level.
      // Fall back to safe floor values; user can correct via the CL field.
      ui.notifications?.warn(
        game.i18n?.format
          ? game.i18n.format("D35E.IntelligentItemSpellNoCL", { name: raw.name ?? "?" })
          : `"${raw.name ?? "?"}" has no class assignment — defaulting to CL 1. Adjust the CL field.`
      );
      slcl[0] = 1; // spell level
      slcl[1] = 1; // minimum CL
    }

    // --- Type: convert to enhancement so useAttack() is used, not useSpell() ---
    snapshot.type = "enhancement";
    snapshot._id = foundry.utils.randomID();
    snapshot.egoPoints = 0;
    snapshot.powerType = "spell";

    snapshot.system = snapshot.system || {};

    // Mark as spell-like so isSpellLike() returns true and adjustSpellCL() is invoked.
    snapshot.system.isFromSpell = true;

    // CL: use caller-supplied override, or computed minimum CL.
    snapshot.system.baseCl = clOverride != null ? String(clOverride) : String(slcl[1]);

    // Preserve spell combat properties so the roll card renders correctly.
    // Replace @sl references with the resolved spell level number.
    if (Array.isArray(snapshot.system.damage?.parts)) {
      snapshot.system.damage.parts = snapshot.system.damage.parts.map(([formula, type]) => [
        formula.replace(/@sl/g, String(slcl[0])),
        type,
      ]);
    }
    // Keep actionType, save, sr, pr — already on snapshot from the spell.

    // Uses tracking
    if (usageType === "atwill") {
      snapshot.system.uses = snapshot.system.uses || {};
      snapshot.system.uses.per = "";
      snapshot.system.uses.max = 0;
      snapshot.system.uses.value = 0;
      snapshot.system.atWill = true;
    } else if (usageType === "day") {
      snapshot.system.uses = snapshot.system.uses || {};
      if (!snapshot.system.uses.per) snapshot.system.uses.per = "day";
      if (!snapshot.system.uses.max || snapshot.system.uses.max === 0) {
        snapshot.system.uses.max = 1;
        snapshot.system.uses.value = 1;
      }
      snapshot.system.atWill = false;
    } else {
      // charges
      snapshot.system.uses = snapshot.system.uses || {};
      snapshot.system.uses.per = "charges";
      if (!snapshot.system.uses.max || snapshot.system.uses.max === 0) {
        snapshot.system.uses.max = 3;
        snapshot.system.uses.value = 3;
      }
      snapshot.system.atWill = false;
    }

    // Remove actor-spellbook references — CL comes from baseCl above.
    delete snapshot.system.spellbook;
    delete snapshot.system.preparation;

    return snapshot;
  }

  /**
   * Convert a feat/ability item into a feat power snapshot for intelligent items.
   * @param {object} itemData  Original feat or ability item data (toObject() output)
   * @returns {object} Power data object
   */
  static toFeatPower(itemData) {
    const snapshot = foundry.utils.duplicate(itemData instanceof Item ? itemData.toObject() : itemData);
    snapshot._id = foundry.utils.randomID();
    snapshot.egoPoints = 0;
    snapshot.powerType = "feat";
    return snapshot;
  }
}
