const DANCING_SUMMON_WEAPON = {
  attackActionType: "mwak",
  behavior: "dancing",
  cooldownRounds: 4,
  dancingRounds: 4,
};

const EVERDANCING_SUMMON_WEAPON = {
  attackActionType: "mwak",
  behavior: "dancing",
  cooldownRounds: 0,
  dancingRounds: 0,
};

const isDancingName = (name) => name === "Dancing" || name === "Everdancing";

/**
 * Compute update data for a standalone enhancement item.
 * Returns a flat updateData object, or {} if nothing needs changing.
 * Pure function — no Foundry runtime required.
 */
export const dancingEnhancementItemUpdate = function (item) {
  if (item.type !== "enhancement") return {};
  if (!isDancingName(item.name)) return {};
  const sys = item.system ?? {};
  if (sys.properties?.dnc === true && sys.actionType === "summonWeapon" && sys.summonWeapon) return {};

  const defaults = item.name === "Everdancing" ? EVERDANCING_SUMMON_WEAPON : DANCING_SUMMON_WEAPON;
  return {
    "system.actionType": "summonWeapon",
    "system.summonWeapon": { ...defaults },
    "system.properties.dnc": true,
  };
};

/**
 * Migrate embedded enhancement rows inside system.enhancements.items.
 * Returns { items, changed } — items is the (possibly mutated) duplicate array.
 * Pure function — no Foundry runtime required.
 */
export const migrateDancingEnhancementItems = function (enhancementItems) {
  if (!Array.isArray(enhancementItems) || !enhancementItems.length) {
    return { items: enhancementItems, changed: false };
  }

  let changed = false;
  const items = enhancementItems.map((enh) => {
    if (!isDancingName(enh.name)) return enh;
    const sys = enh.system ?? {};
    if (sys.properties?.dnc === true && sys.actionType === "summonWeapon" && sys.summonWeapon) return enh;

    const defaults = enh.name === "Everdancing" ? EVERDANCING_SUMMON_WEAPON : DANCING_SUMMON_WEAPON;
    changed = true;
    return {
      ...enh,
      system: {
        ...sys,
        actionType: "summonWeapon",
        summonWeapon: { ...defaults },
        properties: { ...(sys.properties ?? {}), dnc: true },
      },
    };
  });

  return { items, changed };
};

/**
 * Compute weapon/equipment item update data — migrates embedded dancing enhancements.
 * Returns flat updateData or {} if nothing needs changing.
 * Pure function — no Foundry runtime required.
 */
export const dancingWeaponItemUpdate = function (item) {
  if (item.type !== "weapon" && item.type !== "equipment") return {};
  const raw = item.system?.enhancements?.items;
  const { items, changed } = migrateDancingEnhancementItems(raw);
  if (!changed) return {};
  return { "system.enhancements.items": items };
};
