"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const script = path.resolve(__dirname, "../../utils/sort-json-dir.js");

describe("sort-json-dir", () => {
  let directory;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "warcraft-sort-json-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("sorts generated JSON deterministically", () => {
    const file = path.join(directory, "record.json");
    fs.writeFileSync(file, '{"z":1,"a":{"z":2,"a":3}}\n', "utf8");

    const result = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe('{\n  "a": {\n    "a": 3,\n    "z": 2\n  },\n  "z": 1\n}\n');
  });

  test("fails instead of silently accepting invalid JSON", () => {
    fs.writeFileSync(path.join(directory, "broken.json"), "{broken", "utf8");

    const result = spawnSync(process.execPath, [script, directory], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Failed to sort 1 JSON file/);
  });
});
