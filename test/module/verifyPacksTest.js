const fs = require("fs");
const os = require("os");
const path = require("path");
const { repackSourceToPack } = require("../../utils/pack-db");
const { verifyDeclaredPacks } = require("../../utils/verify-packs");

describe("declared source/pack verification", () => {
  const tempDirs = [];

  function makeFixture() {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "d35e-verify-packs-"));
    tempDirs.push(repoRoot);
    const sourcePath = path.join(repoRoot, "source", "fixture");
    const packPath = path.join(repoRoot, "packs", "fixture");
    const file = "fixture-item-TESTITEM00000001.json";
    const document = {
      _id: "TESTITEM00000001",
      name: "Fixture Item",
      system: { value: 1 },
      type: "feat",
    };
    fs.mkdirSync(sourcePath, { recursive: true });
    fs.writeFileSync(path.join(sourcePath, file), `${JSON.stringify(document, null, 2)}\n`);
    fs.writeFileSync(
      path.join(sourcePath, ".index.json"),
      `${JSON.stringify(
        [
          {
            childKeyByCollection: {},
            embeddedCollections: [],
            file,
            key: `!items!${document._id}`,
          },
        ],
        null,
        2
      )}\n`
    );
    return {
      declarations: [{ name: "fixture", path: "./packs/fixture", type: "Item" }],
      document,
      file,
      packPath,
      repoRoot,
      sourcePath,
    };
  }

  afterEach(() => {
    while (tempDirs.length) fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
  });

  test("accepts a compiled pack that exactly matches source JSON", async () => {
    const fixture = makeFixture();
    await repackSourceToPack(fixture.sourcePath, fixture.packPath);

    const result = await verifyDeclaredPacks(fixture);

    expect(result).toMatchObject({ ok: true, failures: [] });
    expect(result.packs).toEqual([
      expect.objectContaining({ name: "fixture", ok: true, sourceCount: 1, packCount: 1, mismatches: [] }),
    ]);
  });

  test("rejects content drift and a missing compiled pack", async () => {
    const drifted = makeFixture();
    await repackSourceToPack(drifted.sourcePath, drifted.packPath);
    drifted.document.system.value = 2;
    fs.writeFileSync(path.join(drifted.sourcePath, drifted.file), `${JSON.stringify(drifted.document, null, 2)}\n`);

    const driftResult = await verifyDeclaredPacks(drifted);
    expect(driftResult.ok).toBe(false);
    expect(driftResult.failures.join("\n")).toMatch(/source\/pack drift/i);
    expect(driftResult.packs[0].mismatches).toContain("Content mismatch for key: !items!TESTITEM00000001");

    const missing = makeFixture();
    const missingResult = await verifyDeclaredPacks(missing);
    expect(missingResult.ok).toBe(false);
    expect(missingResult.failures.join("\n")).toMatch(/missing compiled pack.*sources:repack/i);
  });
});

describe("release pack safeguards", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8"));

  test("rebuilds and verifies packs without invoking private-PDF extraction", () => {
    expect(packageJson.scripts["build:release"]).toContain("warcraft:build");
    expect(packageJson.scripts["build:release"]).toContain("pack-system.js");
    expect(packageJson.scripts["warcraft:build"]).toContain("warcraft:generate");
    expect(packageJson.scripts["warcraft:build"]).toContain("sources:repack");
    expect(packageJson.scripts["warcraft:build"]).toContain("sources:verify");
    expect(packageJson.scripts["warcraft:build"]).not.toMatch(/warcraft:extract|python|\.pdf/i);
    expect(packageJson.scripts["pack:system"]).toContain("sources:verify");
  });
});
