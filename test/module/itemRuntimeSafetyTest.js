const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

jest.mock("../../module/item/extensions/rolls.js", () => ({
  ItemRolls: jest.fn(),
}));

const { ItemRolls } = require("../../module/item/extensions/rolls.js");
const { ItemChargeUpdateHelper } = require("../../module/item/helpers/itemChargeUpdateHelper.js");
const { ItemDescriptionsHelper } = require("../../module/item/helpers/itemDescriptionsHelper.js");

const root = path.resolve(__dirname, "../..");

describe("item runtime safety", () => {
  beforeAll(() => {
    foundry.utils.hasProperty = (object, propertyPath) =>
      foundry.utils.getProperty(object, propertyPath) !== undefined;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("merges supplied actor system data when recalculating item charges", async () => {
    const item = {
      actor: null,
      getRollData: () => ({}),
    };
    const srcData = {
      system: {
        uses: {
          maxFormula: "@abilities.str.mod + 2",
        },
      },
    };
    const update = {};

    await ItemChargeUpdateHelper.updateMaxUses(item, update, {
      srcData,
      actorData: {
        system: {
          abilities: {
            str: { mod: 4 },
          },
        },
      },
    });

    expect(update["system.uses.max"]).toBe(6);
    expect(srcData.system.uses.max).toBe(6);
  });

  test("reports an invalid attack formula without throwing a second reference error", async () => {
    const brokenRoll = { formula: "1d20 + @missing" };
    Object.defineProperty(brokenRoll, "total", {
      get() {
        throw new Error("invalid total");
      },
    });
    ItemRolls.mockImplementation(() => ({
      rollAttack: jest.fn().mockResolvedValue(brokenRoll),
    }));
    const notification = jest.spyOn(ui.notifications, "error").mockImplementation(() => {});
    const item = {
      actor: {
        combatChangeItems: [],
        getRollData: () => ({}),
      },
      getRollData: () => ({}),
      hasAttack: true,
      name: "Broken attack",
      system: { primaryAttack: true },
      type: "attack",
      _addCombatChangesToRollData: jest.fn(),
    };

    await expect(ItemDescriptionsHelper.attackBonus(item, {})).resolves.toBe(0);
    expect(notification).toHaveBeenCalledWith("DICE.WarnAttackRollIncorrect");
  });

  test("keeps event and formula-error identifiers lexically bound", () => {
    const checks = new Map([
      ["module/item/extensions/enhancement.js", new Set(["event"])],
      ["module/item/extensions/use.js", new Set(["event", "ev"])],
      ["module/item/helpers/itemChargeUpdateHelper.js", new Set(["actorsystem"])],
      [
        "module/item/helpers/itemDescriptionsHelper.js",
        new Set(["bab", "attackBonus", "abilityBonus", "sizeBonus"]),
      ],
    ]);
    const unbound = [];

    for (const [relativePath, watchedNames] of checks) {
      const source = fs.readFileSync(path.join(root, relativePath), "utf8");
      const ast = parser.parse(source, { sourceType: "module" });
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
    }

    expect(unbound).toEqual([]);
  });

  test("damage formula diagnostics contain actionable context, not placeholder logging", () => {
    const source = fs.readFileSync(
      path.join(root, "module/item/helpers/itemDescriptionsHelper.js"),
      "utf8"
    );

    expect(source).toContain("Failed to evaluate damage formula");
    expect(source).not.toContain("YYYY");
  });

  test("actor actions do not dump normalized update payloads to the browser console", () => {
    const source = fs.readFileSync(path.join(root, "module/actor/entity.js"), "utf8");

    expect(source).not.toContain("ACTION | actorUpdates after self. replacement");
  });
});
