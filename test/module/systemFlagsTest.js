import {
  getSystemFlag,
  setSystemFlag,
  SYSTEM_FLAG_SCOPE,
  systemFlagPath,
  unsetSystemFlag,
} from "../../module/utils/system-flags.js";
import fs from "fs";
import path from "path";

function flagDocument({ modern, legacy, sourceLegacy } = {}) {
  const document = {
    flags: {
      ...(modern === undefined ? {} : { warcraftrpg2e: modern }),
      ...(legacy === undefined ? {} : { D35E: legacy }),
    },
    _source: sourceLegacy === undefined ? {} : { flags: { D35E: sourceLegacy } },
  };
  document.getFlag = jest.fn((scope, key) => {
    if (scope === "D35E") throw new Error("Invalid flag scope D35E");
    return foundry.utils.getProperty(document.flags?.[scope], key);
  });
  document.setFlag = jest.fn(async () => document);
  document.unsetFlag = jest.fn(async () => document);
  document.update = jest.fn(async () => document);
  return document;
}

function findLegacyFlagApiCalls(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.name.endsWith(".js")) files.push(fullPath);
    }
  };
  visit(root);

  return files.flatMap((file) => {
    const source = fs.readFileSync(file, "utf8");
    return source.match(/\.(?:get|set|unset)Flag\s*\(\s*["']D35E["']/g)
      ?.map((match) => `${path.relative(root, file)}: ${match}`)
      ?? [];
  });
}

describe("system flag compatibility", () => {
  test("reads modern flags through the active system scope", () => {
    const document = flagDocument({ modern: { nested: { value: false } } });

    expect(getSystemFlag(document, "nested.value")).toBe(false);
    expect(document.getFlag).toHaveBeenCalledWith(SYSTEM_FLAG_SCOPE, "nested.value");
    expect(document.getFlag).not.toHaveBeenCalledWith("D35E", expect.anything());
  });

  test("falls back to raw legacy flags without invoking an invalid scope", () => {
    const document = flagDocument({ legacy: { priceModifier: 1.25 } });

    expect(getSystemFlag(document, "priceModifier")).toBe(1.25);
    expect(document.getFlag).not.toHaveBeenCalledWith("D35E", expect.anything());
  });

  test("falls back to legacy _source data when prepared flags omit it", () => {
    const document = flagDocument({ sourceLegacy: { visionPermission: { default: "yes" } } });

    expect(getSystemFlag(document, "visionPermission.default")).toBe("yes");
  });

  test("falls back to _source when the prepared scope exists but omits the key", () => {
    const document = flagDocument({
      legacy: { unrelated: true },
      sourceLegacy: { visionPermission: { default: "yes" } },
    });

    expect(getSystemFlag(document, "visionPermission.default")).toBe("yes");
  });

  test("modern false values take precedence over legacy values", () => {
    const document = flagDocument({ modern: { secret: false }, legacy: { secret: true } });

    expect(getSystemFlag(document, "secret")).toBe(false);
  });

  test("writes and ordinary unsets use only the active scope", async () => {
    const document = flagDocument();

    await setSystemFlag(document, "slotSource", "head");
    await unsetSystemFlag(document, "slotSource");

    expect(document.setFlag).toHaveBeenCalledWith(SYSTEM_FLAG_SCOPE, "slotSource", "head");
    expect(document.unsetFlag).toHaveBeenCalledWith(SYSTEM_FLAG_SCOPE, "slotSource");
  });

  test("unsetting a legacy-backed flag removes it through a raw document update", async () => {
    const document = flagDocument({ legacy: { equipment: { slotSource: "head" } } });

    await unsetSystemFlag(document, "equipment.slotSource");

    expect(document.unsetFlag).toHaveBeenCalledWith(SYSTEM_FLAG_SCOPE, "equipment.slotSource");
    expect(document.update).toHaveBeenCalledWith({
      "flags.D35E.equipment.-=slotSource": null,
    });
  });

  test("builds modern raw update paths", () => {
    expect(systemFlagPath("customVisionRules")).toBe("flags.warcraftrpg2e.customVisionRules");
  });

  test("production code never calls Document flag APIs with the invalid D35E scope", () => {
    const moduleRoot = path.resolve(__dirname, "../../module");
    expect(findLegacyFlagApiCalls(moduleRoot)).toEqual([]);
  });

  test("entrypoint hooks use the compatibility helper for system flag reads", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../../D35E.js"), "utf8");

    expect(source).toContain('getSystemFlag(combatant, "isBuff")');
    expect(source).not.toContain("combatant.flags?.D35E?.isBuff");
    expect(source).not.toMatch(/flags:\s*\{\s*["']D35E\./);
    expect(source.match(/\.(?:get|set|unset)Flag\s*\(\s*["']D35E["']/g) ?? []).toEqual([]);
  });

  test("loot stacking reads the same modern flag written by its sheet", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../module/actor/sheets/npc-loot.js"),
      "utf8"
    );

    expect(source).toContain('getSystemFlag(this.actor, "shopStack") ?? true');
    expect(source).not.toContain('getSystemFlag(this.actor, "stopStack")');
  });

  test("e2e tests never call Document flag APIs with the invalid D35E scope", () => {
    const e2eRoot = path.resolve(__dirname, "../e2e");
    expect(findLegacyFlagApiCalls(e2eRoot)).toEqual([]);
  });
});
