export class ItemCombatCalculationsHelper {
  /**
   * Seeds rollData.damageAbilityMultiplier from melee weapon fighting mode (GL#1488).
   * Dialog extractFormData overwrites this from the form; skipDialog / full-attack rolls need it here.
   * Also re-applied in ItemRolls.rollDamage when rollData.d35eWeaponDamageAttackTypePinned is set, because
   * ChatAttack clones rollData with duplicate() (JSON round-trip) and pins must survive that copy.
   */
  static applyWeaponModeDamageMultiplier(rollData, attackType, item) {
    if (!rollData || !item) return;
    delete rollData.damageAbilityMultiplier;
    if (
      foundry.utils.getProperty(item.system, "attackType") !== "weapon" ||
      foundry.utils.getProperty(item.system, "actionType") === "rwak"
    ) {
      return;
    }
    switch (attackType) {
      case "offhand-light":
      case "offhand-normal":
        rollData.damageAbilityMultiplier = 0.5;
        break;
      case "two-handed":
        rollData.damageAbilityMultiplier = 1.5;
        break;
      default:
        break;
    }
  }

  static calculateAbilityModifier(item, damageMult, attackType, primaryAttack) {
    if (damageMult === -1 && attackType === 'natural') {
      damageMult = 1
      if (primaryAttack === false) damageMult = 0.5
      let naturalAttackCount = item.actor?.system.naturalAttackCount;
      if (primaryAttack && naturalAttackCount === 1) damageMult = 1.5
    } else if (damageMult === -1) {
      damageMult = 1
    }
    return damageMult || 0;
  }
}
