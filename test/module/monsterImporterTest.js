const fs = require("fs");
const path = require("path");

describe("monster importer input boundary", () => {
  let MonsterImporterDialog;
  let parseMonsterImportText;
  let priorFormApplication;
  let priorFolder;

  beforeAll(() => {
    priorFormApplication = global.FormApplication;
    global.FormApplication = class FormApplication {
      static get defaultOptions() { return {}; }
      activateListeners() {}
    };

    ({ MonsterImporterDialog, parseMonsterImportText } = require("../../module/utils/monster-importer.js"));
  });

  beforeEach(() => {
    priorFolder = global.Folder;
    global.Folder = { create: jest.fn() };
  });

  afterEach(() => {
    global.Folder = priorFolder;
  });

  afterAll(() => {
    global.FormApplication = priorFormApplication;
  });

  test("accepts one JSON object or an array of objects", () => {
    expect(parseMonsterImportText('{"name":"Harvest Golem"}')).toEqual([
      { name: "Harvest Golem" },
    ]);
    expect(parseMonsterImportText('[{"name":"A"},{"name":"B"}]')).toEqual([
      { name: "A" },
      { name: "B" },
    ]);
  });

  test("blank or absent input is an empty import", () => {
    expect(parseMonsterImportText()).toEqual([]);
    expect(parseMonsterImportText(null)).toEqual([]);
    expect(parseMonsterImportText(" \r\n\t ")).toEqual([]);
  });

  test("rejects malformed JSON and non-object payloads with clear errors", () => {
    expect(() => parseMonsterImportText("not json")).toThrow(
      /Monster import input is not valid JSON/
    );
    expect(() => parseMonsterImportText("42")).toThrow(
      /object or an array of objects/
    );
    expect(() => parseMonsterImportText('[{"name":"A"},null]')).toThrow(
      /object or an array of objects/
    );
    expect(() => parseMonsterImportText({ name: "A" })).toThrow(
      /must be a JSON string/
    );
  });

  test("blank import performs no folder, actor, or pack side effects", async () => {
    const importer = Object.create(MonsterImporterDialog.prototype);
    const packGet = jest.fn();
    const priorPacks = game.packs;
    const priorActor = global.Actor;
    game.packs = { get: packGet };
    global.Actor = { create: jest.fn() };

    try {
      await expect(importer.importMonster("   ")).resolves.toEqual([]);
      expect(global.Folder.create).not.toHaveBeenCalled();
      expect(global.Actor.create).not.toHaveBeenCalled();
      expect(packGet).not.toHaveBeenCalled();
    } finally {
      game.packs = priorPacks;
      global.Actor = priorActor;
    }
  });

  test("missing dialog input also performs no side effects", async () => {
    const importer = Object.create(MonsterImporterDialog.prototype);
    const priorDocument = global.document;
    global.document = undefined;

    try {
      await expect(importer.importMonster()).resolves.toEqual([]);
      expect(global.Folder.create).not.toHaveBeenCalled();
    } finally {
      global.document = priorDocument;
    }
  });

  test("text extractors do not leak their regex match variable", () => {
    const importer = Object.create(MonsterImporterDialog.prototype);
    delete global.m;

    importer.diceFromText("1d6");
    importer.spellsFromText("<i>Frostbolt</i>");
    importer.dcFromText("DC 15");
    importer.distanceFromText("30 ft.");
    importer.regenFromText("regeneration 5");

    expect(Object.prototype.hasOwnProperty.call(global, "m")).toBe(false);
  });
});

describe("monster importer v14 update schema", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../module/utils/monster-importer.js"),
    "utf8"
  );

  test("contains no legacy data.* update keys", () => {
    expect(source).not.toMatch(/["'`]data\./);
  });

  test("qualifies importer helper calls", () => {
    const importBody = source.slice(source.indexOf("async importMonster"));
    expect(importBody).not.toMatch(
      /(?<!\.)(diceFromText|spellsFromText|dcFromText|distanceFromText|regenFromText|parseChallengeRating|capitalize)\(/
    );
  });

  test("uses v14 actor and embedded-document update roots", () => {
    expect(source).toContain('"system.details.cr"');
    expect(source).toContain('"prototypeToken.sight.enabled"');
    expect(source).toContain("abilityUpdateData['_id']");
  });
});
