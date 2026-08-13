const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const { LootSheetActions } = require("../../module/lootsheet/actions.js");

const root = path.resolve(__dirname, "../..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function unboundNames(relativePath, watchedNames) {
  const ast = parser.parse(source(relativePath), {
    sourceType: "module",
    plugins: ["classProperties", "classPrivateProperties", "classPrivateMethods"],
  });
  const unbound = [];
  traverse(ast, {
    Identifier(identifierPath) {
      const name = identifierPath.node.name;
      if (
        watchedNames.has(name) &&
        identifierPath.isReferencedIdentifier() &&
        !identifierPath.scope.hasBinding(name)
      ) {
        unbound.push(`${relativePath}:${identifierPath.node.loc.start.line}:${name}`);
      }
    },
  });
  return unbound;
}

describe("Foundry v14 runtime compatibility", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("combat control flow never returns undeclared sentinel variables", () => {
    expect(unboundNames("module/combat/combat.js", new Set(["results", "combat"]))).toEqual([]);
    const combatSource = source("module/combat/combat.js");
    expect(combatSource).toContain("if (!c) continue;");
    expect(combatSource).toMatch(/Skipping Round on non-GM Client[\s\S]{0,100}return this;/);
    expect(combatSource).toMatch(/Skipping Turn on non-GM Client[\s\S]{0,100}return this;/);
  });

  test("legacy migrations use the namespaced v14 object-inversion utility", () => {
    const migrationSource = source("module/migration.js");
    expect(migrationSource.match(/foundry\.utils\.invertObject\(/g)).toHaveLength(5);
    expect(unboundNames("module/migration.js", new Set(["invertObject"]))).toEqual([]);
  });

  test("loot movement has no unbound price and writes modern actor paths", () => {
    const lootSource = source("module/lootsheet/actions.js");
    expect(unboundNames("module/lootsheet/actions.js", new Set(["cost"]))).toEqual([]);
    expect(lootSource).not.toMatch(/["']data\.(?:currency|altCurrency)["']/);
    expect(lootSource).toContain('"system.currency": buyerFunds');
    expect(lootSource).toContain('"system.altCurrency": buyerFundsAlt');
    expect(lootSource).toContain("Math.floor(buyerFundsAlt[currency] / ratio)");
    expect(lootSource).not.toContain("const DEBUG = true");
  });

  test("loot transactions can pay from alternate currency and persist once via system paths", async () => {
    const item = {
      id: "item-1",
      name: "Test Item",
      system: { identified: true, price: 2, quantity: 1 },
    };
    const seller = {
      items: { get: jest.fn(() => item) },
      system: { currency: { pp: 0, gp: 0, sp: 0, cp: 0 } },
      update: jest.fn(async () => {}),
    };
    const buyer = {
      flags: {},
      system: {
        currency: { pp: 0, gp: 0, sp: 0, cp: 0 },
        altCurrency: { pp: 0, gp: 10, sp: 0, cp: 0 },
      },
      update: jest.fn(async () => {}),
    };
    jest.spyOn(LootSheetActions, "moveItem").mockResolvedValue(null);

    await LootSheetActions.transaction(seller, seller, buyer, item.id, 1);

    expect(buyer.update).toHaveBeenCalledTimes(1);
    expect(buyer.update).toHaveBeenCalledWith({
      "system.currency": { pp: 0, gp: 0, sp: 0, cp: 0 },
      "system.altCurrency": { pp: 0, gp: 8, sp: 0, cp: 0 },
    });
    expect(seller.update).toHaveBeenCalledTimes(1);
    expect(seller.update).toHaveBeenCalledWith({
      "system.currency": { pp: 0, gp: 2, sp: 0, cp: 0 },
    });
  });

  test("actor-sheet actions write modern system paths", () => {
    const characterSource = source("module/actor/sheets/character.js");
    const objectSource = source("module/actor/sheets/object.js");
    expect(characterSource).toContain('"system.preparation.prepared"');
    expect(characterSource).toContain('"system.currency"');
    expect(characterSource).not.toMatch(/["']data\.(?:preparation|currency)/);
    expect(objectSource).toContain('"system.attributes.hp.value"');
    expect(objectSource).toContain('"system.attributes.hp.max"');
    expect(objectSource).not.toMatch(/["']data\.attributes\.hp/);
  });

  test("first-run screens accept native v14 HTML and legacy wrapped HTML", () => {
    for (const relativePath of ["module/welcome-screen.js", "module/onboarding.js"]) {
      const screenSource = source(relativePath);
      expect(screenSource).toContain("html?.nodeType === 1 ? html : html?.[0] ?? html");
      expect(screenSource).not.toContain("const content = html[0].parentElement");
    }
  });

  test("actor compendium imports use v14 documentName and companion identity uses ids", () => {
    const actorSource = source("module/actor/entity.js");
    expect(actorSource).toContain("pack.documentName !== 'Item'");
    expect(actorSource).not.toMatch(/pack\.metadata\.(?:entity|type)\s*!==\s*['"]Item['"]/);
    expect(actorSource).toContain("u.character?.id === this.id");
    expect(actorSource).toContain("game.user.character?.id === this.id");
    expect(actorSource).not.toContain("game.users.current");
  });

  test("compendium drag payloads use the v14 document name", () => {
    expect(source("module/apps/crafting-station.js")).toContain("type: pack.documentName");
    expect(source("module/item/sheets/base.js")).toContain("type: pack.documentName");
    expect(source("module/apps/crafting-station.js")).not.toContain("type: pack.entity");
    expect(source("module/item/sheets/base.js")).not.toContain("type: pack.entity");
  });

  test("chat document references use public v14 ids", () => {
    const lootSource = source("module/lootsheet/actions.js");
    const itemSource = source("module/item/entity.js");
    expect(lootSource).toContain("game.user.id");
    expect(lootSource).not.toContain("game.user._id");
    expect(itemSource).toContain(".map((u) => u.id)");
    expect(itemSource).not.toContain(".map((u) => u._id)");
  });

  test("item formula-name updates read the same modern paths submitted by the sheet", () => {
    const itemSource = source("module/item/entity.js");
    expect(itemSource).toContain('updated["system.nameFromFormula"]');
    expect(itemSource).toContain('updated["system.nameFormula"]');
    expect(itemSource).not.toContain('updated["data.nameFromFormula"]');
    expect(itemSource).not.toContain('updated["data.nameFormula"]');
    expect(itemSource).not.toContain("Is true/false");
    expect(itemSource).not.toContain("Should be true/false");
  });

  test("high-frequency enrichers and hooks do not emit unconditional debug payloads", () => {
    expect(source("module/enrichers.js")).not.toMatch(/console\.(?:log|debug)\(/);
    expect(source("module/apps/formula-creator.js")).not.toContain("formula-creator: building rollData");
    const entrySource = source("D35E.js");
    expect(entrySource).not.toContain("D35E | Cache is");
    expect(entrySource).not.toContain("D35E | Updated Item");
    expect(entrySource).not.toContain("Not updating actor as action was started by other user");
  });

  test("both compendium browsers map v14 system data and class associations consistently", () => {
    for (const relativePath of ["module/apps/compendium-browser.js", "module/apps/crafting-station.js"]) {
      const browserSource = source(relativePath);
      expect(browserSource).toContain('foundry.utils.getProperty(item.system, "associations.classes")');
      expect(browserSource).toContain('path: "associations.class"');
      expect(browserSource).not.toContain("assocations");
      expect(browserSource).not.toMatch(/foundry\.utils\.getProperty\(item\.data,\s*["']data\./);
    }
  });

  test("both compendium browser mappers accept a v14 Item document without legacy data", () => {
    const originalApplication = global.Application;
    global.Application = class Application {};
    const item = {
      id: "feat-1",
      uuid: "Compendium.test.feats.Item.feat-1",
      name: "Class Feat",
      type: "feat",
      img: "feat.webp",
      system: {
        featType: "classFeat",
        tags: [["combat"]],
        associations: { classes: [["Gladiator", 1]] },
      },
    };
    const pack = {
      collection: "test.feats",
      metadata: { id: "test.feats", label: "Test Feats", packageName: "test" },
    };

    try {
      jest.isolateModules(() => {
        const { CompendiumBrowser } = require("../../module/apps/compendium-browser.js");
        const browser = Object.create(CompendiumBrowser.prototype);
        browser.type = "feats";
        browser.extraFilters = null;
        expect(browser._mapItem(pack, item).item.associations.class).toEqual(["Gladiator"]);
        expect(browser.extraFilters.associations.class).toEqual(["Gladiator"]);
      });
      jest.isolateModules(() => {
        const { CompendiumBrowser } = require("../../module/apps/crafting-station.js");
        const browser = Object.create(CompendiumBrowser.prototype);
        browser.options = { type: "feats" };
        browser.extraFilters = null;
        expect(browser._mapItem(pack, item).item.associations.class).toEqual(["Gladiator"]);
        expect(browser.extraFilters.associations.class).toEqual(["Gladiator"]);
      });
    } finally {
      if (originalApplication === undefined) delete global.Application;
      else global.Application = originalApplication;
    }
  });
});
