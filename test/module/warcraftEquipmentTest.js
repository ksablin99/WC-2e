import {
  adjustedReloadAction,
  explosiveRangeData,
  explosivePrimeDc,
  explosiveScatter,
  firearmMalfunctionFromAttacks,
  gunpowderOuncesFromName,
  gunpowderModifiers,
  isWarcraftExplosive,
  packageCountFromName,
  unpackSupplyUpdate,
} from "../../module/item/helpers/warcraftEquipment.js";

describe("Warcraft firearms and explosives", () => {
  test("tracks ammunition packages and gunpowder in base units", () => {
    expect(packageCountFromName("Pistol Balls (10)")).toBe(10);
    expect(gunpowderOuncesFromName("Gunpowder Horn (2 lb.)")).toBe(32);
    expect(gunpowderOuncesFromName("Gunpowder Keg (15 lb.)")).toBe(240);
    expect(gunpowderModifiers("Imbued Gunpowder Horn (2 lb.)")).toEqual({ attack: 1, damage: 1, malfunction: 1, magic: true });
    const item = { system: { quantity: 2, price: 5, weight: 3 }, flags: {} };
    expect(unpackSupplyUpdate(item, 1, 10)).toMatchObject({ valid: true, update: { "system.quantity": 19, "system.price": 0.5, "system.weight": 0.3 } });
  });

  test("Lightning Reload reduces listed action categories", () => {
    const actorItems = [{ type: "feat", name: "Lightning Reload" }];
    expect(adjustedReloadAction({ reload: "standard action" }, actorItems)).toBe("move action");
    expect(adjustedReloadAction({ reload: "move action" }, actorItems)).toBe("free action");
  });

  test("malfunctions use the natural attack die and bomb delay raises DC", () => {
    const weapon = { type: "weapon", flags: { warcraftrpg2e: { rules: { malfunctionRating: 2 } } } };
    const attack = (natural) => ({ rolls: [{ terms: [{ results: [{ result: natural }] }] }] });
    expect(firearmMalfunctionFromAttacks(weapon, [attack(2)])).toMatchObject({ malfunctioned: true, naturalRoll: 2 });
    expect(firearmMalfunctionFromAttacks(weapon, [attack(12)])).toMatchObject({ malfunctioned: false });
    expect(explosivePrimeDc(4)).toBe(16);
  });

  test("mortar shells are ammunition, not hand-primed bombs", () => {
    const catalog = { category: "explosive" };
    expect(isWarcraftExplosive({ flags: { warcraftrpg2e: { catalog, rules: { damage: "3d6 fire", blastRadius: 5, launchedOnly: true } } } })).toBe(false);
    expect(isWarcraftExplosive({ flags: { warcraftrpg2e: { catalog, rules: { damage: "2d6 fire", blastRadius: 10 } } } })).toBe(true);
  });

  test("thrown explosives use five range increments and scatter by missed increments", () => {
    expect(explosiveRangeData({ distanceFeet: 23, rangeIncrement: 10 })).toEqual({
      increments: 3,
      penalty: -4,
      maximumIncrements: 5,
    });
    expect(explosiveScatter({ distanceFeet: 23, rangeIncrement: 10, directionRoll: 5 })).toMatchObject({
      direction: 5,
      directionLabel: "directly away from the thrower",
      squares: 3,
    });
  });
});
