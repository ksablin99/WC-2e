import {
  allocateWarcraftPrestigeCasterLevels,
  calculateWarcraftSlotPools,
  enforceWarcraftCasterLevelMinimum,
  evaluateWarcraftSpellEligibility,
  findWarcraftCastSlotLevel,
  getWarcraftFeatureProgression,
  getWarcraftSpellcastingAdjustments,
  getWarcraftSlotPoolKey,
  meetsWarcraftCastingAbilityMinimum,
} from "../../module/actor/helpers/warcraftSpellcastingHelper.js";

describe("Warcraft spellcasting paths", () => {
  const arcanist = {
    name: "Arcanist",
    levels: 6,
    pathLevels: { mage: 4, necromancer: 0, warlock: 2 },
    currentPath: "warlock",
  };

  it("uses path levels for path features and parent levels otherwise", () => {
    expect(getWarcraftFeatureProgression({}, arcanist, "Arcanist")).toMatchObject({ level: 6, path: "" });
    expect(
      getWarcraftFeatureProgression({ warcraftPath: { parentClass: "Arcanist", id: "mage" } }, arcanist, "Arcanist")
    ).toMatchObject({ level: 4, path: "mage" });
  });

  it("allows learned paths and reports current-path casting penalties", () => {
    const spell = { learnedAt: { class: [["Mage", 3]] }, level: 3 };
    const eligibility = evaluateWarcraftSpellEligibility(spell, arcanist, { parentClass: "Arcanist" });
    expect(eligibility).toMatchObject({ eligible: true, path: "mage", spellLevel: 3 });
    expect(eligibility.penalties).toMatchObject({ casterLevel: -2, saveDc: -2, failurePercent: 6 });
  });

  it("rejects a path-only spell when its path is not acquired", () => {
    const spell = { learnedAt: { class: [["Necromancer", 2]] }, level: 2 };
    expect(evaluateWarcraftSpellEligibility(spell, arcanist, { parentClass: "Arcanist" })).toMatchObject({
      eligible: false,
    });
  });

  it("keeps a real parent-list spell general even when another path also lists it", () => {
    const spell = { learnedAt: { class: [["Arcanist", 4], ["Warlock", 9]] }, level: 4 };
    expect(evaluateWarcraftSpellEligibility(spell, arcanist, { parentClass: "Arcanist" })).toMatchObject({
      eligible: true,
      path: "",
      spellLevel: 4,
      penalties: null,
    });
  });

  it("applies the path DC benefit and Forbidden Arts penalties together", () => {
    const spell = { learnedAt: { class: [["Mage", 3]] }, level: 3 };
    expect(getWarcraftSpellcastingAdjustments(spell, arcanist, { parentClass: "Arcanist" })).toMatchObject({
      casterLevel: -2,
      saveDc: -1,
      failurePercent: 6,
    });
  });

  it("chooses the current acquired path for a multiply-listed spell", () => {
    const spell = { learnedAt: { class: [["Mage", 3], ["Warlock", 4]] }, level: 3 };
    expect(evaluateWarcraftSpellEligibility(spell, arcanist, { parentClass: "Arcanist" })).toMatchObject({
      eligible: true,
      path: "warlock",
      spellLevel: 4,
      penalties: null,
    });
  });

  it("re-evaluates a previously rejected import after its path is acquired", () => {
    const spell = {
      learnedAt: { class: [["Necromancer", 2]] },
      level: 2,
      warcraftEligibilityError: "Requires a level in necromancer.",
    };
    const newlyEligible = {
      ...arcanist,
      pathLevels: { ...arcanist.pathLevels, necromancer: 1 },
      currentPath: "necromancer",
    };
    expect(evaluateWarcraftSpellEligibility(spell, newlyEligible, { parentClass: "Arcanist" })).toMatchObject({
      eligible: true,
      path: "necromancer",
    });
  });

  it("enforces the off-path caster-level floor and casting ability minimum", () => {
    expect(enforceWarcraftCasterLevelMinimum(0, { casterLevel: -2 })).toBe(1);
    expect(enforceWarcraftCasterLevelMinimum(0, { casterLevel: 0 })).toBe(0);
    expect(meetsWarcraftCastingAbilityMinimum(12, 2)).toBe(true);
    expect(meetsWarcraftCastingAbilityMinimum(12, 3)).toBe(false);
  });
});

describe("Warcraft generic spell-slot pools", () => {
  const book = (max, value = max) => ({
    usesWarcraftSlotPool: true,
    ability: "int",
    spells: { spell1: { max, value } },
  });

  it("keys compatible books by their slot ability", () => {
    expect(getWarcraftSlotPoolKey(book(1))).toBe("int");
    expect(getWarcraftSlotPoolKey({ ability: "int" })).toBe("");
  });

  it("adds compatible class slots but preserves slots already spent", () => {
    const pools = calculateWarcraftSlotPools(
      { primary: book(3), secondary: book(2) },
      { int: { spells: { spell1: { max: 4, value: 2 } } } }
    );
    expect(pools.int.spells.spell1).toEqual({ max: 5, value: 3 });
    expect(pools.int.spellbooks).toEqual(["primary", "secondary"]);
  });

  it("uses an exact slot before the lowest higher slot", () => {
    const pool = { spells: { spell2: { value: 0 }, spell3: { value: 2 }, spell4: { value: 1 } } };
    expect(findWarcraftCastSlotLevel(pool, 2)).toBe(3);
    expect(findWarcraftCastSlotLevel(pool, 2, 4)).toBe(4);
    expect(findWarcraftCastSlotLevel(pool, 5)).toBeNull();
  });
});

describe("Warcraft prestige caster advancement", () => {
  const base = (id, name, type) => ({
    id,
    name,
    type: "class",
    system: { classType: "base", levels: 5, customTag: name.toLowerCase(), spellcastingType: type },
  });

  it("advances a sole compatible parent caster", () => {
    const prestige = {
      id: "archmage",
      name: "Archmage of Kirin Tor",
      system: {
        classType: "prestige",
        levels: 3,
        warcraftSpellcastingAdvancement: { mode: "full", spellcastingType: "arcane" },
      },
    };
    expect(allocateWarcraftPrestigeCasterLevels([base("a", "Arcanist", "arcane"), prestige])).toEqual({
      byClass: { arcanist: 3 },
      slotByClass: { arcanist: 3 },
      unresolved: [],
    });
  });

  it("does not guess between two compatible casters", () => {
    const prestige = {
      id: "p",
      name: "Prestige",
      system: {
        classType: "prestige",
        levels: 1,
        warcraftSpellcastingAdvancement: { mode: "full", spellcastingType: "arcane" },
      },
    };
    const result = allocateWarcraftPrestigeCasterLevels([
      base("a", "Arcanist", "arcane"),
      base("b", "Assassin", "arcane"),
      prestige,
    ]);
    expect(result.byClass).toEqual({});
    expect(result.slotByClass).toEqual({});
    expect(result.unresolved[0].candidates).toEqual(["a", "b"]);
  });

  it("supports racial caster stacking and threshold bonuses through the same schema", () => {
    const highElf = {
      id: "race-class",
      name: "High Elf Racial Levels",
      system: {
        classType: "racial",
        levels: 2,
        warcraftSpellcastingAdvancement: {
          mode: "full",
          spellcastingType: "arcane",
          bonusCasterLevels: [{ atLevel: 2, amount: 1 }],
        },
      },
    };
    const result = allocateWarcraftPrestigeCasterLevels([base("a", "Arcanist", "arcane"), highElf]);
    expect(result.byClass).toEqual({
      arcanist: 3,
    });
    expect(result.slotByClass).toEqual({});
  });

  it("stacks racial levels with the uniquely highest compatible caster", () => {
    const racialClass = {
      id: "tauren-racial",
      name: "Tauren Racial Levels",
      system: {
        classType: "racial",
        levels: 2,
        warcraftSpellcastingAdvancement: { mode: "full", spellcastingType: "divine" },
      },
    };
    const healer = base("h", "Healer", "divine");
    healer.system.levels = 7;
    const paladin = base("p", "Paladin", "divine");
    paladin.system.levels = 3;
    const result = allocateWarcraftPrestigeCasterLevels([healer, paladin, racialClass]);
    expect(result.byClass).toEqual({ healer: 2 });
    expect(result.unresolved).toEqual([]);
  });
});
