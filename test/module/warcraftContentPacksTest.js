const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

const PACKS = {
  "warcraft-races": {
    foundryType: "Item",
    expectedDocuments: ["class:Forsaken Racial Levels", "race:Forsaken", "race:Human"],
  },
  "warcraft-classes": {
    foundryType: "Item",
    expectedDocuments: [
      "class:Arcanist",
      "class:Warrior",
      "feat:Arcanist Bonus Feat",
      "feat:Mage Arcana: Arcane Adept",
      "feat:Mage Arcana: Call Elemental",
      "feat:Mage Arcana: Enhanced Counterspell",
      "feat:Mage Arcana: Fire and Frost",
      "feat:Mage Arcana: Summon Familiar",
      "feat:Scribe Scroll",
      "feat:Warrior Bonus Feat",
    ],
  },
  "warcraft-spells": {
    foundryType: "Item",
    expectedDocuments: [
      "buff:Arcane Intellect (Effect)",
      "buff:Chilled",
      "buff:Mana Shield (Effect)",
      "buff:Slow Fall (Effect)",
      "spell:Arcane Intellect",
      "spell:Arcane Missile",
      "spell:Frost Nova",
      "spell:Mana Shield",
      "spell:Slow Fall",
    ],
  },
  "warcraft-equipment": {
    foundryType: "Item",
    expectedDocuments: [
      "equipment:Chain Shirt",
      "equipment:Light Steel Shield",
      "loot:Firearm Ammunition (10)",
      "loot:Gunpowder Horn (2 lb.)",
      "loot:Spell Component Pouch",
      "loot:Spellbook",
      "weapon:Flintlock Pistol",
      "weapon:Long Rifle",
      "weapon:Longsword",
      "weapon:Shortbow",
    ],
  },
  "warcraft-bestiary": {
    foundryType: "Actor",
    expectedDocuments: [
      "npc:Basilisk",
      "npc:Darkhound",
      "npc:Elite Dark Iron Rifleman",
      "npc:Fel Orc",
      "npc:Harvest Golem",
    ],
  },
};

function loadSourcePack(packName) {
  const relativeDirectory = `source/${packName}`;
  const absoluteDirectory = path.join(root, relativeDirectory);
  const index = readJson(`${relativeDirectory}/.index.json`);
  const sourceFiles = fs
    .readdirSync(absoluteDirectory)
    .filter((file) => file.endsWith(".json") && file !== ".index.json")
    .sort();
  const documents = index.map((entry) => ({
    entry,
    document: readJson(`${relativeDirectory}/${entry.file}`),
  }));
  return { index, sourceFiles, documents };
}

function findDocument(packName, name, type) {
  const match = loadSourcePack(packName).documents.find(
    ({ document }) => document.name === name && (!type || document.type === type)
  );
  expect(match).toBeDefined();
  return match.document;
}

function expectProvenance(document) {
  const source = document.flags?.warcraftrpg2e?.source;
  expect(source).toEqual(expect.objectContaining({
    book: expect.stringMatching(/World of Warcraft/i),
    section: expect.any(String),
  }));
  expect(source.section.trim()).not.toBe("");

  const pages = source.pages ?? source.printedPages;
  if (Array.isArray(pages)) expect(pages.length).toBeGreaterThan(0);
  else expect(String(pages || "").trim()).not.toBe("");
}

describe("Warcraft content pack integrity", () => {
  test("declares the five private Warcraft compendia with correct Foundry types", () => {
    const system = readJson("system.json");
    const expectedNames = Object.keys(PACKS);
    const declarations = system.packs.filter((pack) => expectedNames.includes(pack.name));

    expect(declarations).toHaveLength(5);
    for (const [packName, expectation] of Object.entries(PACKS)) {
      expect(declarations.find((pack) => pack.name === packName)).toMatchObject({
        name: packName,
        path: `./packs/${packName}`,
        system: "warcraftrpg2e",
        type: expectation.foundryType,
      });
    }

    const folder = system.packFolders.find((entry) => entry.name === "Warcraft RPG 2e");
    expect(folder?.packs).toEqual(expectedNames);
  });

  test.each(Object.entries(PACKS))("%s index covers every source document and type", (packName, expectation) => {
    const { index, sourceFiles, documents } = loadSourcePack(packName);
    const collection = expectation.foundryType === "Actor" ? "actors" : "items";

    expect(index.map((entry) => entry.file).sort()).toEqual(sourceFiles);
    expect(new Set(index.map((entry) => entry.file)).size).toBe(index.length);

    for (const { entry, document } of documents) {
      expect(fs.existsSync(path.join(root, "source", packName, entry.file))).toBe(true);
      expect(entry.key).toBe(`!${collection}!${document._id}`);
      expect(typeof document.type).toBe("string");
      expect(document.type).not.toBe("");
    }

    const actualDocuments = documents.map(({ document }) => `${document.type}:${document.name}`).sort();
    expect(actualDocuments).toEqual([...expectation.expectedDocuments].sort());
  });

  test("marks Human and Forsaken with their distinct death rules", () => {
    expect(findDocument("warcraft-races", "Human", "race").system.deathRule).toBe("warcraft");
    expect(findDocument("warcraft-races", "Forsaken", "race").system.deathRule).toBe("forsaken");
  });

  test("configures Warrior as mundane and Arcanist as a Mage-path repertoire caster", () => {
    const warrior = findDocument("warcraft-classes", "Warrior", "class");
    const arcanist = findDocument("warcraft-classes", "Arcanist", "class");

    expect(warrior.system.classPaths?.enabled ?? false).toBe(false);
    expect(warrior.system).toMatchObject({
      hasSpellbook: false,
      spellcastingType: "none",
    });
    expect(arcanist.system).toMatchObject({
      classPaths: {
        enabled: true,
        default: "mage",
        choices: [{ id: "mage", name: "Mage" }],
      },
      pathLevels: { mage: 0 },
      currentPath: "",
      spellcastingPreparationMode: "repertoire",
      repertoireSkill: "spl",
      spellcastingSpontaneus: true,
      hasSpellbook: true,
    });
  });

  test("gives every Warcraft class feature a cacheable association and unique id", () => {
    const features = loadSourcePack("warcraft-classes").documents
      .map(({ document }) => document)
      .filter((document) => document.type === "feat");
    const uniqueIds = features.map((feature) => feature.system.uniqueId);

    expect(new Set(uniqueIds).size).toBe(features.length);
    for (const feature of features) {
      expect(feature.system.uniqueId).toEqual(expect.any(String));
      expect(feature.system.uniqueId).not.toBe("");
      expect(feature.system.associations?.classes?.length).toBeGreaterThan(0);
    }
  });

  test("keeps book provenance and Arcanist/Mage learned-at levels on each player spell", () => {
    const spells = loadSourcePack("warcraft-spells").documents
      .map(({ document }) => document)
      .filter((document) => document.type === "spell");

    expect(spells.map((spell) => spell.name).sort()).toEqual(
      ["Arcane Intellect", "Arcane Missile", "Frost Nova", "Mana Shield", "Slow Fall"].sort()
    );
    for (const spell of spells) {
      expectProvenance(spell);
      expect(spell.system.source).toEqual(expect.any(String));
      expect(spell.system.source).not.toBe("");
      expect(spell.system.learnedAt.class).toEqual(expect.arrayContaining([
        ["Arcanist", spell.system.level],
        ["Mage", spell.system.level],
      ]));
    }
  });

  test("keeps provenance on all equipment and bestiary records", () => {
    for (const packName of ["warcraft-equipment", "warcraft-bestiary"]) {
      for (const { document } of loadSourcePack(packName).documents) expectProvenance(document);
    }
  });

  test("marks the Harvest Golem as a Warcraft construct", () => {
    const harvestGolem = findDocument("warcraft-bestiary", "Harvest Golem", "npc");
    expect(harvestGolem.system.attributes.deathRule).toBe("warcraft-construct");
  });

  test("indexes every bestiary actor's embedded items", () => {
    for (const { entry, document } of loadSourcePack("warcraft-bestiary").documents) {
      const embeddedIds = document._embedded?.items?.map((item) => item._id).sort();
      const childKeys = entry.childKeyByCollection?.items || {};

      expect(embeddedIds?.length).toBeGreaterThan(0);
      expect([...document.items].sort()).toEqual(embeddedIds);
      expect(entry.embeddedCollections).toContain("items");
      expect(Object.keys(childKeys).sort()).toEqual(embeddedIds);
      for (const embeddedId of embeddedIds) {
        expect(childKeys[embeddedId]).toBe(`!actors.items!${document._id}.${embeddedId}`);
      }
    }
  });
});
