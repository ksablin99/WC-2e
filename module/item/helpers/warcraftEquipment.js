import { checkMalfunction } from "./warcraftTechnology.js";

export function warcraftEquipmentRules(item) {
  return item?.flags?.warcraftrpg2e?.rules ?? {};
}

export function isWarcraftFirearm(item) {
  const rules = warcraftEquipmentRules(item);
  return item?.type === "weapon" && Boolean(rules.ammunition && Number(rules.capacity) > 0);
}

export function isWarcraftExplosive(item) {
  const catalog = item?.flags?.warcraftrpg2e?.catalog;
  const rules = warcraftEquipmentRules(item);
  return catalog?.category === "explosive" && rules.launchedOnly !== true && Boolean(rules.damage && Number(rules.blastRadius) > 0);
}

export function packageCountFromName(name, fallback = 1) {
  const match = String(name ?? "").match(/\((\d+)\)/);
  return match ? Math.max(1, Number(match[1])) : fallback;
}

export function gunpowderOuncesFromName(name) {
  const text = String(name ?? "").toLowerCase();
  if (!text.includes("gunpowder")) return 0;
  return text.includes("keg") ? 15 * 16 : 2 * 16;
}

export function adjustedReloadAction(rules, actorItems = []) {
  const base = String(rules?.reload ?? "standard action");
  const lightning = Array.from(actorItems ?? []).some((item) => item?.type === "feat" && item?.name === "Lightning Reload");
  if (!lightning) return base;
  if (/move action/i.test(base)) return "free action";
  if (/standard action/i.test(base)) return "move action";
  if (/full-round action/i.test(base)) return "full-round action (half normal time when longer than 1 round)";
  return base;
}

export function firearmState(weapon) {
  const rules = warcraftEquipmentRules(weapon);
  const state = weapon?.flags?.warcraftrpg2e?.equipment ?? {};
  return {
    loaded: Math.max(0, Math.min(Number(rules.capacity) || 0, Number(state.loaded) || 0)),
    capacity: Math.max(0, Number(rules.capacity) || 0),
    jammed: Boolean(state.jammed),
    lastMalfunction: state.lastMalfunction ?? "",
  };
}

export function sourceWeaponForAttack(attack, actor) {
  if (attack?.type === "weapon") return attack;
  const id = attack?.system?.originalWeaponId;
  return id ? actor?.items?.get?.(id) ?? Array.from(actor?.items ?? []).find((item) => item?.id === id) : null;
}

export function compatibleAmmunition(actor, weapon) {
  const rules = warcraftEquipmentRules(weapon);
  const expected = String(rules.ammunition ?? "").toLowerCase();
  const linkId = rules.ammunitionLink?.id;
  return Array.from(actor?.items ?? []).find((item) => {
    if (item?.type !== "loot") return false;
    const origin = item?.system?.originId || item?.system?.uniqueId || item?.flags?.core?.sourceId;
    return (linkId && String(origin ?? "").includes(linkId)) || item?.name?.toLowerCase() === expected;
  }) ?? null;
}

export function compatibleGunpowder(actor) {
  const preferred = ["Gunpowder Horn (2 lb.)", "Gunpowder Keg (15 lb.)"];
  return preferred.map((name) => Array.from(actor?.items ?? []).find((item) => item?.name === name && Number(item?.system?.quantity) > 0)).find(Boolean)
    ?? compatibleGunpowders(actor)[0]
    ?? null;
}

export function compatibleGunpowders(actor) {
  return Array.from(actor?.items ?? []).filter((item) =>
    item?.type === "loot" && Number(item?.system?.quantity) > 0 && gunpowderOuncesFromName(item?.name) > 0
  );
}

export function gunpowderModifiers(name) {
  const value = String(name ?? "").toLowerCase();
  if (value.includes("imbued")) return { attack: 1, damage: 1, malfunction: 1, magic: true };
  if (value.includes("refined")) return { attack: 0, damage: 1, malfunction: 0, magic: false };
  return { attack: 0, damage: 0, malfunction: 0, magic: false };
}

export function unpackSupplyUpdate(item, amount, unitsPerPackage) {
  const quantity = Math.max(0, Number(item?.system?.quantity) || 0);
  const inBaseUnits = item?.flags?.warcraftrpg2e?.equipment?.baseUnitMode === true;
  const available = inBaseUnits ? quantity : quantity * Math.max(1, Number(unitsPerPackage) || 1);
  const required = Math.max(0, Number(amount) || 0);
  if (available < required) return { valid: false, available, update: null };
  const unitDivisor = inBaseUnits ? 1 : Math.max(1, Number(unitsPerPackage) || 1);
  return {
    valid: true,
    available,
    update: {
      "system.quantity": available - required,
      "system.price": (Number(item?.system?.price) || 0) / unitDivisor,
      "system.weight": (Number(item?.system?.weight) || 0) / unitDivisor,
      "flags.warcraftrpg2e.equipment.baseUnitMode": true,
      "flags.warcraftrpg2e.equipment.baseUnitLabel": unitsPerPackage === 1 ? "unit" : `1/${unitsPerPackage} package`,
    },
  };
}

export function firearmMalfunctionFromAttacks(weapon, attacks = []) {
  const powderModifier = Number(weapon?.flags?.warcraftrpg2e?.equipment?.loadedGunpowderModifiers?.malfunction) || 0;
  const rating = (Number(warcraftEquipmentRules(weapon).malfunctionRating) || 0) + powderModifier;
  const naturalRolls = Array.from(attacks).map((attack) => Number(attack?.rolls?.[0]?.terms?.[0]?.results?.[0]?.result ?? 0));
  const naturalRoll = naturalRolls.find((roll) => checkMalfunction({ naturalRoll: roll, malfunctionRating: rating }).malfunctioned) ?? null;
  return { malfunctioned: naturalRoll !== null, naturalRoll, rating };
}

export function loadedGunpowderModifiers(weapon) {
  return {
    attack: Number(weapon?.flags?.warcraftrpg2e?.equipment?.loadedGunpowderModifiers?.attack) || 0,
    damage: Number(weapon?.flags?.warcraftrpg2e?.equipment?.loadedGunpowderModifiers?.damage) || 0,
    malfunction: Number(weapon?.flags?.warcraftrpg2e?.equipment?.loadedGunpowderModifiers?.malfunction) || 0,
    magic: Boolean(weapon?.flags?.warcraftrpg2e?.equipment?.loadedGunpowderModifiers?.magic),
  };
}

export async function finalizeFirearmAttack(item, actor, attacks = []) {
  const weapon = sourceWeaponForAttack(item, actor);
  if (!isWarcraftFirearm(weapon) || !attacks.length) return { firearm: false, malfunctioned: false, note: "" };
  const state = firearmState(weapon);
  const malfunction = firearmMalfunctionFromAttacks(weapon, attacks);
  const update = {
    "flags.warcraftrpg2e.equipment.loaded": Math.max(0, state.loaded - attacks.length),
    "flags.warcraftrpg2e.equipment.loadedGunpowder": "",
    "flags.warcraftrpg2e.equipment.loadedGunpowderModifiers": null,
  };
  if (malfunction.malfunctioned) {
    update["flags.warcraftrpg2e.equipment.jammed"] = true;
    update["flags.warcraftrpg2e.equipment.lastMalfunction"] = `Natural ${malfunction.naturalRoll} (MR ${malfunction.rating})`;
  }
  await weapon.update(update);
  return {
    firearm: true,
    ...malfunction,
    note: malfunction.malfunctioned ? `Natural ${malfunction.naturalRoll} ≤ MR ${malfunction.rating}; the firearm jams and the shot fails.` : "",
  };
}

export function explosivePrimeDc(delayRounds = 0) {
  return 12 + Math.max(0, Math.trunc(Number(delayRounds) || 0));
}

export const EXPLOSIVE_SCATTER_DIRECTIONS = Object.freeze({
  1: "toward the thrower",
  2: "one step clockwise from the thrower",
  3: "two steps clockwise from the thrower",
  4: "three steps clockwise from the thrower",
  5: "directly away from the thrower",
  6: "three steps counter-clockwise from the thrower",
  7: "two steps counter-clockwise from the thrower",
  8: "one step counter-clockwise from the thrower",
});

export function explosiveRangeData({ distanceFeet = 0, rangeIncrement = 10 } = {}) {
  const increment = Math.max(1, Number(rangeIncrement) || 10);
  const increments = Math.max(1, Math.ceil(Math.max(0, Number(distanceFeet) || 0) / increment));
  return { increments, penalty: -2 * Math.max(0, increments - 1), maximumIncrements: 5 };
}

export function explosiveScatter({ distanceFeet = 0, rangeIncrement = 10, directionRoll = 1 } = {}) {
  const range = explosiveRangeData({ distanceFeet, rangeIncrement });
  const direction = Math.max(1, Math.min(8, Math.trunc(Number(directionRoll) || 1)));
  return {
    direction,
    directionLabel: EXPLOSIVE_SCATTER_DIRECTIONS[direction],
    squares: range.increments,
    ...range,
  };
}
