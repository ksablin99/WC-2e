const fs = require("fs");
const os = require("os");
const path = require("path");
const { ClassicLevel } = require("classic-level");
const {
  unpackPackToSource,
  repackSourceToPack,
  verifySourceAndPackSync
} = require("../../utils/pack-db");

describe("pack-db unpack/repack", () => {
  const tempDirs = [];

  function mkTmpDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d35e-packdb-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_err) {
        // Ignore cleanup failures for already-removed temp paths.
      }
    }
  });

  async function seedPack(packPath) {
    fs.mkdirSync(packPath, { recursive: true });
    const db = new ClassicLevel(packPath, { valueEncoding: "utf8" });
    await db.open();
    try {
      await db.put(
        "!actors!A1",
        JSON.stringify({ _id: "A1", _key: "!actors!A1", name: "Goblin Chief", type: "npc", system: {} })
      );
      await db.put(
        "!actors.items!A1.I1",
        JSON.stringify({ _id: "I1", _key: "!actors.items!A1.I1", name: "Shortsword", type: "weapon" })
      );
      await db.put(
        "!actors.effects!A1.E1",
        JSON.stringify({ _id: "E1", _key: "!actors.effects!A1.E1", name: "Rage", icon: "x" })
      );
      await db.put(
        "!actors!A2",
        JSON.stringify({ _id: "A2", _key: "!actors!A2", name: "Wolf", type: "npc", system: {} })
      );
      await db.put(
        "!items!W1",
        JSON.stringify({ _id: "W1", _key: "!items!W1", name: "Longsword", type: "weapon", system: {} })
      );
    } finally {
      await db.close();
    }
  }

  function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
    if (value && typeof value === "object") {
      const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
      return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }

  async function canonicalPackMap(packPath) {
    const db = new ClassicLevel(packPath, { valueEncoding: "utf8" });
    const map = new Map();
    await db.open();
    try {
      for await (const [key, value] of db.iterator()) {
        const raw = String(value);
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (_err) {
          parsed = raw;
        }
        map.set(String(key), stableStringify(parsed));
      }
    } finally {
      await db.close();
    }
    return map;
  }

  it("merges embedded docs into parent source files and round-trips without loss", async () => {
    const tmp = mkTmpDir();
    const sourcePath = path.join(tmp, "source", "bestiary");
    const originalPackPath = path.join(tmp, "packs", "bestiary");
    const rebuiltPackPath = path.join(tmp, "packs-rebuilt", "bestiary");

    await seedPack(originalPackPath);
    await unpackPackToSource(originalPackPath, sourcePath);

    const files = fs
      .readdirSync(sourcePath)
      .filter((name) => name.endsWith(".json") && name !== ".index.json")
      .sort();
    expect(files.length).toBe(3);

    const actorFile = files.find((name) => {
      const doc = JSON.parse(fs.readFileSync(path.join(sourcePath, name), "utf8"));
      return doc._id === "A1";
    });
    expect(actorFile).toBeTruthy();

    const actorDoc = JSON.parse(fs.readFileSync(path.join(sourcePath, actorFile), "utf8"));
    expect(Array.isArray(actorDoc._embedded?.items)).toBe(true);
    expect(Array.isArray(actorDoc._embedded?.effects)).toBe(true);
    expect(actorDoc._embedded.items).toHaveLength(1);
    expect(actorDoc._embedded.effects).toHaveLength(1);
    expect(actorDoc._embedded.items[0]._id).toBe("I1");
    expect(actorDoc._embedded.effects[0]._id).toBe("E1");

    await repackSourceToPack(sourcePath, rebuiltPackPath);
    const verification = await verifySourceAndPackSync(sourcePath, rebuiltPackPath);
    expect(verification.ok).toBe(true);
    expect(verification.mismatches).toHaveLength(0);

    const rebuilt = new ClassicLevel(rebuiltPackPath, { valueEncoding: "utf8" });
    await rebuilt.open();
    try {
      const keys = [];
      for await (const [key] of rebuilt.iterator()) keys.push(String(key));
      expect(keys).toContain("!actors!A1");
      expect(keys).toContain("!actors.items!A1.I1");
      expect(keys).toContain("!actors.effects!A1.E1");
      expect(keys).toContain("!actors!A2");
      expect(keys).toContain("!items!W1");
    } finally {
      await rebuilt.close();
    }
  });

  it("round-trips real item-roll-tables pack without content loss", async () => {
    const fixturePack = path.resolve("packs", "item-roll-tables");
    expect(fs.existsSync(fixturePack)).toBe(true);

    const tmp = mkTmpDir();
    const inputPackPath = path.join(tmp, "fixture-input", "item-roll-tables");
    const sourcePath = path.join(tmp, "source", "item-roll-tables");
    const rebuiltPackPath = path.join(tmp, "rebuilt", "item-roll-tables");

    fs.mkdirSync(path.dirname(inputPackPath), { recursive: true });
    fs.cpSync(fixturePack, inputPackPath, { recursive: true });

    const beforeMap = await canonicalPackMap(inputPackPath);
    await unpackPackToSource(inputPackPath, sourcePath);
    await repackSourceToPack(sourcePath, rebuiltPackPath);

    const syncCheck = await verifySourceAndPackSync(sourcePath, rebuiltPackPath);
    expect(syncCheck.ok).toBe(true);

    const afterMap = await canonicalPackMap(rebuiltPackPath);
    expect(afterMap.size).toBe(beforeMap.size);

    for (const [key, beforeValue] of beforeMap.entries()) {
      expect(afterMap.has(key)).toBe(true);
      expect(afterMap.get(key)).toBe(beforeValue);
    }
  });
});
