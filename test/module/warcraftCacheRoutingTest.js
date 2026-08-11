import {
  addClassAbilitiesFromPackToCache,
  buildCache,
  CACHE,
  isClassAbilityPack,
} from "../../module/cache.js";

describe("Warcraft class feature cache routing", () => {
  beforeEach(() => {
    CACHE.ClassFeatures = new Map();
    CACHE.AllClassFeatures = [];
    CACHE.AllAbilities = new Map();
  });

  afterEach(() => {
    delete global.game;
    delete global.ui;
  });

  it("recognizes the Warcraft class compendium as a class-ability source", () => {
    expect(isClassAbilityPack("warcraftrpg2e.class-abilities")).toBe(true);
    expect(isClassAbilityPack("warcraftrpg2e.warcraft-classes")).toBe(true);
    expect(isClassAbilityPack("module.custom-features", "custom-features")).toBe(true);
    expect(isClassAbilityPack("warcraftrpg2e.warcraft-spells")).toBe(false);
  });

  it("indexes associated Warcraft features by class and unique id", async () => {
    const warriorFeature = {
      system: {
        associations: { classes: [["Warrior", 1]] },
        uniqueId: "warcraft-warrior-bonus-feat",
      },
    };
    const arcanistFeature = {
      system: {
        associations: { classes: [["Arcanist", 1], ["Mage", 1]] },
        uniqueId: "warcraft-arcanist-bonus-feat",
      },
    };
    const pack = { getDocuments: jest.fn().mockResolvedValue([warriorFeature, arcanistFeature]) };

    await addClassAbilitiesFromPackToCache(pack);

    expect(CACHE.ClassFeatures.get("Warrior")).toEqual([warriorFeature]);
    expect(CACHE.ClassFeatures.get("Arcanist")).toEqual([arcanistFeature]);
    expect(CACHE.ClassFeatures.get("Mage")).toEqual([arcanistFeature]);
    expect(CACHE.AllAbilities.get("warcraft-warrior-bonus-feat")).toBe(warriorFeature);
    expect(CACHE.AllAbilities.get("warcraft-arcanist-bonus-feat")).toBe(arcanistFeature);
    expect(CACHE.AllClassFeatures).toEqual([warriorFeature, arcanistFeature]);
  });

  it("waits for Warcraft class documents before declaring the cache built", async () => {
    const feature = {
      system: {
        associations: { classes: [["Warrior", 1]] },
        uniqueId: "warcraft-cache-readiness-feature",
      },
    };
    let resolveDocuments;
    const itemPack = {
      getDocuments: jest.fn().mockReturnValue(new Promise((resolve) => {
        resolveDocuments = resolve;
      })),
    };
    global.game = {
      packs: new Map([["warcraftrpg2e.warcraft-classes", itemPack]]),
      settings: { get: jest.fn().mockReturnValue("") },
    };
    global.ui = { notifications: { info: jest.fn() } };

    let finished = false;
    const building = buildCache().then(() => {
      finished = true;
    });
    await Promise.resolve();

    expect(itemPack.getDocuments).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);

    resolveDocuments([feature]);
    await building;

    expect(finished).toBe(true);
    expect(CACHE.ClassFeatures.get("Warrior")).toEqual([feature]);
  });
});
