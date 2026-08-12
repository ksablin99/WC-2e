const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
const CONFIGURED_SKILLS = readJson("template.json").Actor.templates.common.skills;

const PACKS = {
  "warcraft-races": {
    foundryType: "Item",
    allowAdditionalDocuments: true,
    expectedDocuments: [
      "class:Forsaken Racial Levels",
      "class:High Elf Racial Levels",
      "class:Ironforge Dwarf Racial Levels",
      "class:Jungle Troll Racial Levels",
      "class:Night Elf Racial Levels",
      "class:Tauren Racial Levels",
      "race:Forsaken",
      "race:Gnome",
      "race:Goblin",
      "race:High Elf",
      "race:Human",
      "race:Ironforge Dwarf",
      "race:Jungle Troll",
      "race:Night Elf",
      "race:Orc",
      "race:Tauren",
    ],
  },
  "warcraft-classes": {
    foundryType: "Item",
    allowAdditionalDocuments: true,
    expectedDocuments: [
      "class:Arcanist",
      "class:Warrior",
      "feat:Arcanist Bonus Feat",
      "feat:Mage: Arcane Adept",
      "feat:Mage: Call Elemental",
      "feat:Mage: Enhanced Counterspell",
      "feat:Mage: Fire and Frost",
      "feat:Mage: Summon Familiar",
      "feat:Scribe Scroll",
      "feat:Warrior Bonus Feat",
    ],
  },
  "warcraft-spells": {
    foundryType: "Item",
    allowAdditionalDocuments: true,
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
  "warcraft-feats": {
    foundryType: "Item",
    allowAdditionalDocuments: true,
    expectedDocuments: [
      "feat:Battle Shout",
      "feat:Crafty Leader",
      "feat:Power Attack",
      "feat:Triumphant Yell",
    ],
  },
  "warcraft-equipment": {
    foundryType: "Item",
    allowAdditionalDocuments: true,
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
  "warcraft-rules": {
    foundryType: "JournalEntry",
    expectedDocuments: [
      "journal:Character Creation", "journal:Classes, Paths, and Advancement", "journal:Combat and Conditions",
      "journal:Equipment, Firearms, and Explosives", "journal:Faith and Affiliation", "journal:Hero Points and Shouts",
      "journal:Magic and Spell Preparation", "journal:Races and Racial Levels", "journal:Skills and Feats", "journal:Technology",
    ],
  },
  "warcraft-bestiary": {
    foundryType: "Actor",
    allowAdditionalDocuments: true,
    expectedDocuments: [
      "npc:Basilisk",
      "npc:Elite Dark Iron Rifleman",
      "npc:Fel Orc",
      "npc:Harvest Golem",
    ],
  },
  "warcraft-creature-rules": {
    foundryType: "Item",
    allowAdditionalDocuments: true,
    expectedDocuments: [
      "feat:Construct Traits",
      "feat:Corrupted Creature Template",
      "feat:Elite Creature Template",
      "feat:Undead Traits",
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
  test("declares every private Warcraft compendium with correct Foundry types", () => {
    const system = readJson("system.json");
    const expectedNames = Object.keys(PACKS);
    const declarations = system.packs.filter((pack) => expectedNames.includes(pack.name));

    expect(declarations).toHaveLength(expectedNames.length);
    for (const [packName, expectation] of Object.entries(PACKS)) {
      expect(declarations.find((pack) => pack.name === packName)).toMatchObject({
        name: packName,
        path: `./packs/${packName}`,
        system: "warcraftrpg2e",
        type: expectation.foundryType,
      });
    }

    const folder = system.packFolders.find((entry) => entry.name === "Warcraft RPG 2e");
    expect(folder?.folders.flatMap((entry) => entry.packs).sort()).toEqual([...expectedNames].sort());
  });

  test("contains all ten core race records with source-accurate static traits", () => {
    const races = loadSourcePack("warcraft-races").documents
      .map(({ document }) => document)
      .filter((document) => document.type === "race");
    expect(races.map((race) => race.name).sort()).toEqual([
      "Forsaken", "Gnome", "Goblin", "High Elf", "Human", "Ironforge Dwarf", "Jungle Troll",
      "Night Elf", "Orc", "Tauren",
    ].sort());

    const change = (race, target, subTarget) => race.system.changes.find(
      (entry) => entry[1] === target && entry[2] === subTarget
    )?.[0];
    const byName = Object.fromEntries(races.map((race) => [race.name, race]));

    expect(change(byName["Ironforge Dwarf"], "ability", "con")).toBe("2");
    expect(change(byName["Ironforge Dwarf"], "ability", "cha")).toBe("-2");
    expect(byName["Ironforge Dwarf"].system.changeFlags).toMatchObject({
      heavyArmorFullSpeed: true,
      mediumArmorFullSpeed: true,
      noEncumbrance: true,
    });
    expect(byName["Ironforge Dwarf"].system.senses.darkvision).toBe(60);

    expect(change(byName["High Elf"], "ability", "int")).toBe("2");
    expect(change(byName["High Elf"], "ability", "con")).toBe("-2");
    expect(byName["High Elf"].system.senses.lowLight).toBe(true);

    expect(change(byName["Night Elf"], "ability", "wis")).toBe("2");
    expect(byName["Night Elf"].system.changes.some((entry) => entry[1] === "ability" && ["int", "cha"].includes(entry[2]))).toBe(false);
    expect(byName["Night Elf"].system.description.value).toMatch(/conflict.*no penalty is automated/i);

    expect(byName.Gnome.system.sizeOverride).toBe("sm");
    expect(change(byName.Gnome, "savingThrows", "allSavingThrows")).toBe("1");
    expect(byName.Goblin.system.sizeOverride).toBe("sm");
    expect(change(byName.Goblin, "skill", "skill.ctd")).toBe("3");

    expect(change(byName.Orc, "ability", "con")).toBe("2");
    expect(change(byName.Orc, "ability", "int")).toBe("-2");
    expect(change(byName.Tauren, "ability", "str")).toBe("2");
    expect(change(byName.Tauren, "ability", "dex")).toBe("-2");
    expect(change(byName["Jungle Troll"], "ability", "dex")).toBe("2");
    expect(change(byName["Jungle Troll"], "ability", "int")).toBe("-2");
    expect(change(byName["Jungle Troll"], "ability", "cha")).toBe("-2");

    // Human counters must not leak through the race-generator clone template.
    expect(byName.Human.system.counterName).toBe("feat.human; bonusSkillPoints");
    expect(byName.Gnome.system.counterName).toBe("feat.tinker");
    expect(byName.Goblin.system.counterName).toBe("feat.technology");
    for (const name of ["Ironforge Dwarf", "High Elf", "Night Elf", "Orc", "Tauren", "Jungle Troll", "Forsaken"]) {
      expect(byName[name].system.counterName).toBe("");
    }

    for (const race of races) {
      expect(race.system.creatureType).toMatch(/humanoid|undead/);
      expect(race.system.deathRule).toMatch(/warcraft|forsaken/);
      expectProvenance(race);
    }
  });

  test.each(Object.entries(PACKS))("%s index covers every source document and type", (packName, expectation) => {
    const { index, sourceFiles, documents } = loadSourcePack(packName);
    const collection = expectation.foundryType === "Actor" ? "actors" : expectation.foundryType === "JournalEntry" ? "journal" : "items";

    expect(index.map((entry) => entry.file).sort()).toEqual(sourceFiles);
    expect(new Set(index.map((entry) => entry.file)).size).toBe(index.length);

    for (const { entry, document } of documents) {
      expect(fs.existsSync(path.join(root, "source", packName, entry.file))).toBe(true);
      expect(entry.key).toBe(`!${collection}!${document._id}`);
      if (expectation.foundryType !== "JournalEntry") {
        expect(typeof document.type).toBe("string");
        expect(document.type).not.toBe("");
      }
    }

    const actualDocuments = documents.map(({ document }) => `${expectation.foundryType === "JournalEntry" ? "journal" : document.type}:${document.name}`).sort();
    if (expectation.allowAdditionalDocuments) {
      expect(actualDocuments).toEqual(expect.arrayContaining([...expectation.expectedDocuments].sort()));
    } else {
      expect(actualDocuments).toEqual([...expectation.expectedDocuments].sort());
    }
  });

  test("marks Human and Forsaken with their distinct death rules", () => {
    expect(findDocument("warcraft-races", "Human", "race").system.deathRule).toBe("warcraft");
    expect(findDocument("warcraft-races", "Forsaken", "race").system.deathRule).toBe("forsaken");
  });

  test("provides searchable language, proficiency, favored-class, and racial-level metadata for every race", () => {
    const races = loadSourcePack("warcraft-races").documents
      .map(({ document }) => document)
      .filter((document) => document.type === "race");
    expect(races).toHaveLength(10);
    for (const race of races) {
      const metadata = race.flags.warcraftrpg2e.race;
      expect(metadata.category).toBe("player-race");
      expect(metadata.automaticLanguages.length).toBeGreaterThan(0);
      expect(Array.isArray(metadata.bonusLanguages)).toBe(true);
      expect(Array.isArray(metadata.proficiencies)).toBe(true);
      expect(metadata.favoredClass.length).toBeGreaterThan(0);
      expect(metadata.searchableTraits.length).toBeGreaterThan(0);
      expect(metadata.racialLevel).toEqual(expect.objectContaining({
        available: expect.any(Boolean), max: expect.any(Number), name: expect.any(String),
      }));
    }
    expect(findDocument("warcraft-races", "Forsaken", "race").flags.warcraftrpg2e.race).toMatchObject({
      automaticLanguages: ["Common"],
      bonusLanguages: ["Goblin", "Low Common", "Orcish", "Thalassian"],
      favoredClass: ["Warrior"],
      racialLevel: { available: true, name: "Forsaken", max: 3 },
    });
  });

  test("provides baseline active racial records without automating situational judgment", () => {
    const highElf = findDocument("warcraft-races", "High Elf", "race");
    const orc = findDocument("warcraft-races", "Orc", "race");
    const tauren = findDocument("warcraft-races", "Tauren", "race");
    const addiction = findDocument("warcraft-races", "Magic Addiction", "feat");
    const rage = findDocument("warcraft-races", "Battle Rage", "feat");
    const horns = findDocument("warcraft-races", "Horns", "attack");

    expect(highElf.system.addedAbilities).toEqual([{ uid: addiction.system.uniqueId, level: 1 }]);
    expect(orc.system.addedAbilities).toEqual([{ uid: rage.system.uniqueId, level: 1 }]);
    expect(tauren.system.addedAbilities).toEqual([{ uid: horns.system.uniqueId, level: 1 }]);
    expect(rage.system).toMatchObject({
      featType: "racial",
      uses: { maxFormula: "1", per: "day" },
      activation: { type: "free" },
    });
    expect(addiction.system.description.value).toMatch(/toggle the penalties manually/i);
    expect(horns.system).toMatchObject({
      actionType: "mwak",
      attackType: "natural",
      proficient: true,
      primaryAttack: true,
      ability: { attack: "str", damage: "str", damageMult: 1 },
      damage: { parts: [["1d8", "Piercing", "damage-piercing"]] },
    });
    for (const document of [addiction, rage, horns]) expectProvenance(document);
  });

  test("contains every printed racial class with exact three-level chassis and linked feature records", () => {
    const documents = loadSourcePack("warcraft-races").documents.map(({ document }) => document);
    const classes = documents.filter((document) => document.type === "class");
    const features = documents.filter((document) => document.flags?.warcraftrpg2e?.racialClassFeature);
    const byName = Object.fromEntries(classes.map((document) => [document.name, document]));

    const expected = {
      "Ironforge Dwarf Racial Levels": [8, "med", "high", "low", "low", null],
      "High Elf Racial Levels": [8, "med", "low", "low", "high", "arcane"],
      "Night Elf Racial Levels": [8, "med", "low", "low", "high", null],
      "Tauren Racial Levels": [10, "med", "high", "low", "high", "divine"],
      "Jungle Troll Racial Levels": [8, "high", "high", "high", "low", "divine"],
      "Forsaken Racial Levels": [12, "med", "low", "low", "high", null],
    };
    expect(Object.keys(byName).sort()).toEqual(Object.keys(expected).sort());
    expect(features).toHaveLength(30);

    for (const [name, [hd, bab, fort, ref, will, casting]] of Object.entries(expected)) {
      const document = byName[name];
      expect(document.system).toMatchObject({
        classType: "racial",
        levels: 1,
        maxLevel: 3,
        hd,
        bab,
        skillsPerLevel: 2,
        automaticFeatures: true,
        savingThrows: { fort: { value: fort }, ref: { value: ref }, will: { value: will } },
        warcraftPrerequisites: [{ type: "race", value: document.system.racialRequirement }],
      });
      if (casting) {
        expect(document.system.warcraftSpellcastingAdvancement).toMatchObject({
          mode: "full",
          spellcastingType: casting,
          affectsSlots: false,
        });
      } else {
        expect(document.system.warcraftSpellcastingAdvancement).toEqual({});
      }
      expectProvenance(document);
    }

    for (const feature of features) {
      expect(feature.system.uniqueId).toMatch(/^wc-racial-[a-f0-9]{8}-\*$/);
      expect(feature.system.associations.classes.length).toBeGreaterThan(0);
      expect(feature.system.associations.classes.every(([name, level]) =>
        Boolean(byName[name]) && Number.isInteger(level) && level >= 1 && level <= 3
      )).toBe(true);
      expectProvenance(feature);
    }

    expect(byName["High Elf Racial Levels"].system.warcraftSpellcastingAdvancement.bonusCasterLevels)
      .toEqual([{ atLevel: 2, amount: 1 }]);
    expect(findDocument("warcraft-races", "Night Elf Resistances", "feat").system.resistances)
      .toEqual(expect.arrayContaining([
        ["2 + floor(@attributes.hd.total / 4)", "energy-cold", false, false, false],
        ["2 + floor(@attributes.hd.total / 4)", "energy-fire", false, false, false],
      ]));
    expect(findDocument("warcraft-races", "Empower Magic", "feat").system).toMatchObject({
      uses: { maxFormula: "1", per: "day" },
      activation: { type: "free" },
      metamagic: { enabled: true },
    });
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
        choices: expect.arrayContaining([{ id: "mage", name: "Mage" }]),
      },
      pathLevels: { mage: 0 },
      currentPath: "",
      spellcastingPreparationMode: "repertoire",
      repertoireSkill: "spl",
      spellcastingSpontaneus: true,
      hasSpellbook: true,
    });
  });

  test("contains all nine base classes with their printed chassis and visible class skills", () => {
    const classes = loadSourcePack("warcraft-classes").documents
      .map(({ document }) => document)
      .filter((document) => document.type === "class" && document.system.classType === "base");
    const byName = Object.fromEntries(classes.map((document) => [document.name, document]));
    expect(Object.keys(byName).sort()).toEqual([
      "Arcanist", "Barbarian", "Healer", "Hunter", "Paladin", "Rogue", "Scout", "Tinker", "Warrior",
    ].sort());

    const expected = {
      Barbarian: [12, "high", "high", "low", "low", 4, ["clm","crf","han","int","jmp","lis","rid","sur","swm"]],
      Healer: [8, "med", "high", "low", "high", 4, ["blf","coc","crf","dip","hea","kar","kre","kpl","lis","pro","spk","spl"]],
      Hunter: [8, "high", "low", "high", "low", 4, ["clm","crf","han","hea","hid","jmp","kna","lis","pro","src","spt","sur","swm","uro"]],
      Paladin: [10, "high", "high", "low", "low", 2, ["coc","crf","dip","han","hea","kmt","kno","kre","pmc","pro","rid","sen"]],
      Rogue: [6, "med", "low", "high", "low", 8, ["apr","blc","blf","clm","crf","dev","dip","dis","esc","fog","gif","hid","int","jmp","klo","lis","opl","prf","pro","sen","slt","spt","src","swm","tmb","umd","uro"]],
      Scout: [8, "med", "high", "high", "low", 6, ["clm","crf","hea","hid","jmp","kmt","kna","lis","pro","src","spt","sur","swm","uro"]],
      Tinker: [6, "med", "low", "high", "high", 8, ["apr","coc","crf","ctd","dev","dsc","fog","klo","kmt","kna","kno","kpl","opl","pro","src","umd","utd"]],
    };
    for (const [name, [hd, bab, fort, ref, will, skills, classSkills]] of Object.entries(expected)) {
      const document = byName[name];
      expect(document.system).toMatchObject({ hd, bab, skillsPerLevel: skills });
      expect(document.system.savingThrows).toEqual({
        fort: { value: fort }, ref: { value: ref }, will: { value: will },
      });
      const enabled = Object.entries(document.system.classSkills)
        .filter(([, value]) => value)
        .map(([key]) => key)
        .filter((key) => Object.hasOwn(CONFIGURED_SKILLS, key))
        .sort();
      expect(enabled).toEqual([...classSkills].sort());
      expectProvenance(document);
    }

    expect(byName.Healer.system.spellsPerLevel[0]).toEqual([1,3,1,-1,-1,-1,-1,-1,-1,-1,-1]);
    expect(byName.Healer.system.spellsPerLevel[19]).toEqual([20,6,5,5,5,5,5,4,4,4,4]);
    expect(byName.Paladin.system.spellsPerLevel[0]).toEqual([1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1]);
    expect(byName.Paladin.system.spellsPerLevel[19]).toEqual([20,-1,3,3,3,3,-1,-1,-1,-1,-1]);
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

  test("imports all ten prestige-class tables and links their granted features", () => {
    const documents = loadSourcePack("warcraft-classes").documents.map(({ document }) => document);
    const classes = documents.filter((document) => document.type === "class" && document.system.classType === "prestige");
    expect(classes.map((document) => document.name).sort()).toEqual([
      "Archmage of Kirin Tor", "Assassin", "Beastmaster", "Berserker", "Duelist", "Elven Ranger",
      "Fel-Sworn", "Gladiator", "Infiltrator", "Mounted Warrior",
    ].sort());
    const expected = {
      "Archmage of Kirin Tor": [6,"low","low","low","high",2,5], Assassin: [6,"med","low","high","low",4,10],
      Beastmaster: [12,"high","high","low","low",4,10], Berserker: [12,"high","high","low","low",4,10],
      Duelist: [10,"high","low","high","low",4,10], "Elven Ranger": [8,"high","high","high","low",4,10],
      "Fel-Sworn": [6,"high","low","high","low",4,5], Gladiator: [10,"high","high","low","low",2,10],
      Infiltrator: [6,"med","low","high","high",6,10], "Mounted Warrior": [10,"high","high","low","low",2,10],
    };
    for (const document of classes) {
      const [hd,bab,fort,ref,will,skillsPerLevel,maxLevel] = expected[document.name];
      expect(document.system).toMatchObject({ hd,bab,skillsPerLevel,maxLevel,automaticFeatures: true });
      expect(document.system.savingThrows).toEqual({ fort:{value:fort},ref:{value:ref},will:{value:will} });
      expectProvenance(document);
    }
    const prestigeFeatures = documents.filter((document) => document.flags?.warcraftrpg2e?.prestige?.parentClass);
    expect(prestigeFeatures).toHaveLength(75);
    expect(prestigeFeatures.every((feature) => feature.system.associations.classes.length > 0)).toBe(true);
  });

  test("imports every core feat description with category, prerequisites, status, and provenance", () => {
    const catalog = readJson("scripts/warcraft-content/warcraft-feat-catalog.json");
    const feats = loadSourcePack("warcraft-feats").documents.map(({ document }) => document);
    const byName = Object.fromEntries(feats.map((feat) => [feat.name, feat]));
    expect(feats).toHaveLength(catalog.length);
    expect(feats.map((feat) => feat.name).sort()).toEqual(catalog.map((entry) => entry.name).sort());
    for (const entry of catalog) {
      const feat = byName[entry.name];
      expect(feat.type).toBe("feat");
      expect(feat.flags.warcraftrpg2e.feat.category).toBe(entry.category);
      expect(feat.flags.warcraftrpg2e.feat.status).toMatch(/srd-mechanics|manual-effect|automated-effect|trigger-manual/);
      expect(feat.system.uniqueId).toMatch(/^wc-feat-/);
      expectProvenance(feat);
    }
    expect(byName["Thunderous Blow"].flags.warcraftrpg2e.feat.prerequisite).toMatch(/Strength 15.*Bash.*base attack bonus \+4/i);
    expect(byName["Battle Shout"].flags.warcraftrpg2e.feat.category).toBe("Shout");
    expect(byName["Battle Shout"].flags.warcraftrpg2e.feat.warriorBonus).toBe(true);
    expect(byName["Crafty Leader"].flags.warcraftrpg2e.feat.category).toBe("Technology");
    expect(byName["Crafty Leader"].flags.warcraftrpg2e.feat.tinkerBonus).toBe(true);
    expect(byName["Weapon Focus"].flags.warcraftrpg2e.feat.repeatable).toBe(true);
    expect(byName["War Stomp"].flags.warcraftrpg2e.feat.prerequisite).toMatch(/tauren or size Large/i);
    expect(byName["Spell Mastery"].flags.warcraftrpg2e.feat.prerequisite).toMatch(/Arcanist level 1/i);
  });

  test("structures all shout metadata for the shared actor resource", () => {
    const shouts = loadSourcePack("warcraft-feats").documents
      .map(({ document }) => document)
      .filter((document) => document.flags?.warcraftrpg2e?.feat?.category === "Shout");
    expect(shouts).toHaveLength(7);
    for (const shout of shouts) {
      expect(shout.flags.warcraftrpg2e.feat.status).toMatch(/^structured-(?:manual-effect|automated-effect|trigger-manual)$/);
      expect(shout.flags.warcraftrpg2e.feat.rules).toMatchObject({
        descriptors: ["extraordinary", "sonic", "mind-affecting"],
        sharedUses: expect.stringMatching(/number of distinct shout feats/i),
        effect: expect.any(String),
        usesSharedPool: expect.any(Boolean),
      });
      expect(shout.system.description.value).toMatch(/Shout Uses resource/);
    }
    expect(findDocument("warcraft-feats", "Battle Shout", "feat").flags.warcraftrpg2e.feat.rules).toMatchObject({
      radius: 30, targets: "self and allies", effect: "+2 morale bonus on damage rolls",
    });
  });

  test("imports every extracted core spell-list entry with assignment and provenance metadata", () => {
    const spells = loadSourcePack("warcraft-spells").documents
      .map(({ document }) => document)
      .filter((document) => document.type === "spell");
    const catalog = readJson("scripts/warcraft-content/warcraft-spell-catalog.json");
    const byName = Object.fromEntries(spells.map((spell) => [spell.name, spell]));

    expect(spells).toHaveLength(catalog.length);
    expect(spells.map((spell) => spell.name).sort()).toEqual(catalog.map((entry) => entry.name).sort());
    for (const entry of catalog) {
      const spell = byName[entry.name];
      expectProvenance(spell);
      for (const assignment of entry.assignments) {
        if (assignment.kind === "domain" || assignment.list.endsWith(" Domain")) {
          expect(spell.system.learnedAt.domain).toContainEqual([
            assignment.list.replace(/ Domain$/, ""), assignment.level,
          ]);
        } else {
          expect(spell.system.learnedAt.class).toContainEqual([assignment.list, assignment.level]);
        }
      }
      expect(spell.flags.warcraftrpg2e.catalog.completeListEntry).toBe(true);
      expect(spell.system.warcraftManualPolicy).toMatchObject({
        mode: expect.stringMatching(/^(?:manual|srd-baseline|srd-baseline-with-manual-boundary|verified-vertical-slice)$/),
        reason: expect.any(String),
      });
      expect(spell.system.source).toEqual(expect.any(String));
      expect(spell.system.source).not.toBe("");
    }
  });

  test("preserves the complete printed Warcraft spell-list matrix and explicit header fallbacks", () => {
    const catalog = readJson("scripts/warcraft-content/warcraft-spell-catalog.json");
    expect(catalog).toHaveLength(342);
    expect(catalog.reduce((total, entry) => total + entry.assignments.length, 0)).toBe(504);
    const expectedCounts = {
      Arcanist: [6, 10, 8, 8, 15, 10, 8, 8, 5, 5],
      Mage: [3, 3, 4, 7, 6, 3, 2, 3, 3, 2],
      Necromancer: [2, 3, 7, 3, 4, 3, 3, 3, 3, 2],
      Warlock: [1, 5, 3, 4, 4, 6, 5, 3, 2, 2],
      Healer: [9, 13, 12, 11, 8, 7, 9, 7, 4, 7],
      Druid: [1, 6, 6, 6, 3, 5, 4, 4, 4, 4],
      Priest: [1, 4, 6, 6, 4, 5, 5, 4, 4, 4],
      Shaman: [1, 5, 4, 6, 4, 3, 3, 3, 2, 2],
      Paladin: [0, 9, 8, 7, 6, 0, 0, 0, 0, 0],
    };
    for (const [list, expected] of Object.entries(expectedCounts)) {
      const actual = Array.from({ length: 10 }, (_, level) => catalog.filter((entry) =>
        entry.assignments.some((assignment) => assignment.list === list && assignment.level === level)).length);
      expect(actual).toEqual(expected);
    }
    for (const domain of ["Animal", "Death", "Destruction", "Elements", "Healing", "Protection", "Spirits", "War", "Wild"]) {
      const levels = catalog.flatMap((entry) => entry.assignments)
        .filter((assignment) => assignment.list === `${domain} Domain`)
        .map((assignment) => assignment.level).sort((a, b) => a - b);
      expect(levels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
    expect(catalog.filter((entry) => entry.header)).toHaveLength(337);
    expect(catalog.filter((entry) => !entry.header).map((entry) => entry.name).sort()).toEqual([
      "Geas/Quest", "Lesser Geas", "Mass Suggestion", "Suggestion", "Unseen Servant",
    ].sort());
    for (const name of ["Geas/Quest", "Lesser Geas", "Mass Suggestion", "Suggestion", "Unseen Servant"]) {
      expect(findDocument("warcraft-spells", name, "spell").flags.warcraftrpg2e.catalog.status).toBe("srd-mechanics-with-warcraft-list-data");
    }
    for (const [name, assignments] of Object.entries({
      "Arcane Mark": [["Arcanist", 0]],
      "Minor Image": [["Arcanist", 2]],
      "Mirror Image": [["Arcanist", 2]],
      "See Invisibility": [["Arcanist", 2]],
      "Storm Hammer": [["Arcanist", 2]],
      "Touch of Idiocy": [["Arcanist", 2]],
      "Zone of Truth": [["Paladin", 2]],
    })) {
      expect(catalog.find((entry) => entry.name === name).assignments.map(({ list, level }) => [list, level]))
        .toEqual(expect.arrayContaining(assignments));
    }
    const frostbolt = findDocument("warcraft-spells", "Frostbolt", "spell");
    expect(frostbolt.system).toMatchObject({
      school: "evo",
      types: "cold",
      activation: { cost: 1, type: "standard" },
      range: { units: "close" },
      spellDurationData: { units: "inst" },
      save: { type: "fortitudenegates" },
      sr: true,
    });
    expect(findDocument("warcraft-spells", "Polymorph", "spell").system.warcraftManualPolicy.mode)
      .toBe("srd-baseline-with-manual-boundary");
    expect(findDocument("warcraft-spells", "Mana Burn", "spell").system.warcraftManualPolicy.mode)
      .toBe("manual");
  });

  test("links all nine healer domains to nine Warcraft spell records apiece", () => {
    const documents = loadSourcePack("warcraft-spells").documents.map(({ document }) => document);
    const domains = documents.filter((document) => document.flags?.warcraftrpg2e?.domain?.generated);
    expect(domains.map((domain) => domain.name).sort()).toEqual([
      "Animal Domain", "Death Domain", "Destruction Domain", "Elements Domain", "Healing Domain",
      "Protection Domain", "Spirits Domain", "War Domain", "Wild Domain",
    ].sort());
    const spellIds = new Set(documents.filter((document) => document.type === "spell").map((spell) => spell._id));
    for (const domain of domains) {
      const links = Object.values(domain.system.spellSpecialization.spells);
      expect(links).toHaveLength(9);
      expect(links.every((link) => link.pack === "warcraftrpg2e.warcraft-spells" && spellIds.has(link.id))).toBe(true);
      expectProvenance(domain);
    }
  });

  test("keeps the five verified Mage spell records and their Mage learned-at levels", () => {
    const spells = ["Arcane Intellect", "Arcane Missile", "Frost Nova", "Mana Shield", "Slow Fall"]
      .map((name) => findDocument("warcraft-spells", name, "spell"));

    for (const spell of spells) {
      expectProvenance(spell);
      if (spell.name !== "Mana Shield") {
        expect(spell.system.learnedAt.class).toContainEqual(["Mage", spell.system.level]);
      }
    }
  });

  test("keeps provenance on all equipment and bestiary records", () => {
    for (const packName of ["warcraft-equipment", "warcraft-bestiary"]) {
      for (const { document } of loadSourcePack(packName).documents) expectProvenance(document);
    }
  });

  test("provides the complete core equipment-table catalogue and four Warcraft materials", () => {
    const documents = loadSourcePack("warcraft-equipment").documents.map(({ document }) => document);
    expect(documents).toHaveLength(275);
    const byName = Object.fromEntries(documents.map((document) => [document.name, document]));
    for (const name of [
      "Dagger", "Longsword", "Orc Claws of Attack", "Moon Sword", "Flintlock Pistol",
      "Catapult Bomb", "Full Plate", "Backpack", "Alchemist's Lab", "Cold Weather Outfit",
      "Gryphon", "Sailing Ship", "Castle",
    ]) {
      expect(byName[name]).toBeDefined();
      expect(byName[name].flags.warcraftrpg2e.catalog.completeTableEntry).toBe(true);
      expectProvenance(byName[name]);
    }
    expect(byName["Moon Sword"].system.weaponData).toMatchObject({
      damageRoll: "2d4", critRange: "18", critMult: "2", damageType: "S",
    });
    expect(byName["Tauren Totem"].system.weaponData).toMatchObject({ damageRoll: "2d8", critMult: "2" });
    expect(byName["Dwarven Tossing Hammer"].system.weaponData.range).toBe(20);

    expect(byName.Arcanite).toMatchObject({ type: "material", system: { hardness: "15", hpPerInch: "30" } });
    expect(byName.Dragonhide).toMatchObject({ type: "material", system: { hardness: "10", hpPerInch: "20" } });
    expect(byName.Mithril).toMatchObject({ type: "material", system: { hardness: "15", hpPerInch: "30" } });
    expect(byName.Thorium).toMatchObject({ type: "material", system: { hardness: "25", hpPerInch: "40" } });
  });

  test("stores exact non-SRD table values, firearm links, explosive metadata, and material rules", () => {
    const documents = loadSourcePack("warcraft-equipment").documents.map(({ document }) => document);
    expect(documents.filter((document) => document.flags?.warcraftrpg2e?.catalog?.status === "manual-noncombat-details")).toHaveLength(0);
    const byName = Object.fromEntries(documents.map((document) => [document.name, document]));
    expect(byName.Backpack.system).toMatchObject({ price: 2, weight: 2 });
    expect(byName.Backpack.flags.warcraftrpg2e.catalog.tableValue).toMatch(/holds 1 cu\. ft\./);
    expect(byName["Catapult Bomb"].system).toMatchObject({ price: 150, weight: 10 });
    expect(byName["Catapult Bomb"].flags.warcraftrpg2e.rules).toMatchObject({
      malfunctionRating: 1, damage: "8d6 fire", blastRadius: 15, rangeIncrement: 5,
    });
    expect(byName["Long Rifle"].flags.warcraftrpg2e.rules).toMatchObject({
      ammunition: "Rifle Bullets (10)", capacity: 1, reload: "standard action", reloadProvokes: true,
      ammunitionLink: { pack: "warcraftrpg2e.warcraft-equipment", id: byName["Rifle Bullets (10)"]._id },
    });
    expect(byName.Blunderbuss.flags.warcraftrpg2e.rules).toMatchObject({
      area: "20-foot cone", damage: "3d6 piercing", save: "Reflex DC 15 half", proficiencyRequired: false,
    });
    expect(byName["Tauren Halberd"].system.properties.rch).toBe(true);

    expect(byName.Arcanite.flags.warcraftrpg2e.rules).toMatchObject({
      costModifiersGp: { heavyArmor: 18000, weapon: 5000 },
      weapon: { damageEnhancement: 1, piercingOrSlashingThreatRangeIncrease: 1 },
    });
    expect(byName.Dragonhide.flags.warcraftrpg2e.rules).toMatchObject({
      priceMultiplier: 25, suppliedHidePriceMultiplier: 20, craftingTimeMultiplier: 3, craftDcModifier: 10,
    });
    expect(byName.Mithril.flags.warcraftrpg2e.rules).toMatchObject({ weightMultiplier: 0.5 });
    expect(byName.Thorium.flags.warcraftrpg2e.rules).toMatchObject({
      weightMultiplier: 2, costModifiersGp: { heavyArmor: 36000, weapon: 10000 },
    });
    expect(new Set([byName.Arcanite, byName.Dragonhide, byName.Mithril, byName.Thorium]
      .map((material) => material.system.uniqueId)).size).toBe(4);
  });

  test("places every Warcraft compendium in the final manifest folder hierarchy", () => {
    const system = readJson("system.json");
    const rootFolder = system.packFolders.find((folder) => folder.name === "Warcraft RPG 2e");
    const packs = rootFolder.folders.flatMap((folder) => folder.packs).sort();
    expect(rootFolder.packs).toEqual([]);
    expect(rootFolder.folders.map((folder) => folder.name)).toEqual([
      "Characters", "Magic", "Equipment", "Rules Reference", "Bestiary (Final Phase)",
    ]);
    expect(packs).toEqual(system.packs.filter((pack) => pack.name.startsWith("warcraft-")).map((pack) => pack.name).sort());
  });

  test("ships concise rules-reference journals with valid embedded page maps", () => {
    const { documents } = loadSourcePack("warcraft-rules");
    expect(documents).toHaveLength(10);
    for (const { entry, document } of documents) {
      expect(document.pages).toHaveLength(1);
      expect(document._embedded.pages).toHaveLength(1);
      const page = document._embedded.pages[0];
      expect(document.pages[0]).toBe(page._id);
      expect(entry.childKeyByCollection.pages[page._id]).toBe(`!journal.pages!${document._id}.${page._id}`);
      expect(page.text.content).toMatch(/^<p>.+<\/p>$/);
    }
  });

  test("models the Harvest Golem's printed stat block exactly", () => {
    const harvestGolem = findDocument("warcraft-bestiary", "Harvest Golem", "npc");
    const { abilities, attributes, details, skills, traits } = harvestGolem.system;

    expect(Object.fromEntries(Object.entries(abilities).map(([key, ability]) => [key, ability.value]))).toEqual({
      cha: 1,
      con: 0,
      dex: 14,
      int: 0,
      str: 23,
      wis: 12,
    });
    expect(abilities).toMatchObject({
      cha: { mod: -5 },
      con: { isZero: true, mod: 0 },
      dex: { mod: 2 },
      int: { isZero: true, mod: 0 },
      str: { mod: 6 },
      wis: { mod: 1 },
    });
    expect(attributes).toMatchObject({
      ac: {
        flatFooted: { total: 18 },
        normal: { total: 20 },
        touch: { total: 12 },
      },
      bab: { base: 5, nonepic: 5, total: 5 },
      cmb: { total: 11 },
      creatureType: "construct",
      deathRule: "warcraft-construct",
      fortification: { total: 100 },
      hd: { racialClass: 7, total: 7 },
      hp: { base: 38, max: 58, value: 58 },
      init: { total: 2 },
      maxAoO: 1,
      naturalACTotal: 8,
      savingThrows: {
        fort: { total: 2 },
        ref: { total: 4 },
        will: { total: 3 },
      },
      senses: { darkvision: 60, lowLight: true },
      speed: { land: { base: 40, total: 40 } },
    });
    expect(details).toMatchObject({
      alignment: "Always neutral",
      cr: 5,
      environment: "Any",
      totalCr: 5,
      type: "Construct",
      advancement: { hd: [{ lower: 8, upper: 15, size: "med" }], originalHD: 7 },
    });
    expect(traits.actualSize).toBe("med");
    expect(traits.di).toEqual({ value: [], custom: "Nonlethal damage" });
    expect(skills.hid).toMatchObject({
      ability: "dex",
      abilityModifier: 2,
      changeBonus: 8,
      mod: 10,
      points: 0,
      rank: 0,
    });
  });

  test("derives the Harvest Golem's defenses and Stealth bonus from construct Hit Dice", () => {
    const harvestGolem = findDocument("warcraft-bestiary", "Harvest Golem", "npc");
    const construct = harvestGolem._embedded.items.find((item) => item.name === "Construct Hit Dice");

    expect(construct).toBeDefined();
    expect(construct.system).toMatchObject({
      bab: "med",
      changeFlags: { noCon: true, noInt: true },
      creatureType: "construct",
      hd: 10,
      hp: 38,
      levels: 7,
      savingThrows: {
        fort: { value: "low" },
        ref: { value: "low" },
        will: { value: "low" },
      },
      skillsPerLevel: 0,
    });
    expect(construct.system.changes).toEqual(expect.arrayContaining([
      ["20", "misc", "mhp", "untyped"],
      ["100", "misc", "fortification", "untyped"],
      ["8", "ac", "nac", "racial"],
      ["8", "skill", "skill.hid", "racial"],
    ]));
  });

  test("gives the Harvest Golem a +1 keen claw and a linked two-claw full attack", () => {
    const harvestGolem = findDocument("warcraft-bestiary", "Harvest Golem", "npc");
    const claw = harvestGolem._embedded.items.find((item) => item.name === "Keen Claw");
    const fullAttack = harvestGolem._embedded.items.find((item) => item.type === "full-attack");

    expect(claw).toBeDefined();
    expect(claw.system).toMatchObject({
      ability: {
        attack: "str",
        critMult: 2,
        critRange: 17,
        damage: "str",
        damageMult: 1,
      },
      actionType: "mwak",
      attackBonus: "",
      attackType: "natural",
      damage: { parts: [["1d4", "Piercing or Slashing", "damage-piercing-or-slashing"]] },
      enh: 1,
      magic: true,
      primaryAttack: true,
      proficient: true,
      threatRangeExtended: true,
      weaponSubtype: "light",
    });
    expect(fullAttack.system.attacks.attack1).toMatchObject({
      attackMode: "primary",
      count: 2,
      id: claw._id,
      name: "Keen Claw",
      primary: true,
    });
    expect(Object.values(fullAttack.system.attacks).filter((attack) => attack.count > 0)).toHaveLength(1);

    // BAB + Strength + enhancement = +12; Strength + enhancement = +7 damage.
    expect(harvestGolem.system.attributes.bab.total + harvestGolem.system.abilities.str.mod + claw.system.enh).toBe(12);
    expect(harvestGolem.system.abilities.str.mod + claw.system.enh).toBe(7);
  });

  test("separates and configures every Harvest Golem special ability", () => {
    const harvestGolem = findDocument("warcraft-bestiary", "Harvest Golem", "npc");
    const features = harvestGolem._embedded.items.filter((item) => item.type === "feat");
    const byName = Object.fromEntries(features.map((feature) => [feature.name, feature]));

    expect(Object.keys(byName).sort()).toEqual([
      "Backstab (Ex)",
      "Construct Traits",
      "Immunity to Magic (Su)",
      "Keen Claws (Ex)",
      "Lifeless Mien (Ex)",
    ]);
    expect(byName["Backstab (Ex)"].system.combatChanges).toContainEqual([
      "attackOptional",
      "mwak",
      "",
      "&featDamage.precision",
      "2d6",
    ]);
    expect(byName["Backstab (Ex)"].system.combatChangesApplySpecialActionsOnce).toBe(false);
    expect(byName["Lifeless Mien (Ex)"].system.range).toEqual({ value: 30, units: "ft", long: null });
    expect(byName["Construct Traits"].system).toMatchObject({
      abilityType: "nat",
      senses: { darkvision: 60, lowLight: true },
    });

    const descriptions = Object.fromEntries(Object.entries(byName).map(([name, feature]) => [
      name,
      feature.system.description.value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
    ]));
    expect(descriptions["Backstab (Ex)"]).toMatch(/denied its Agility bonus|flanks/i);
    expect(descriptions["Backstab (Ex)"]).toMatch(/cannot choose.*nonlethal/i);
    expect(descriptions["Immunity to Magic (Su)"]).toMatch(/spell resistance/i);
    expect(descriptions["Immunity to Magic (Su)"]).toMatch(/fire descriptor.*exception/i);
    expect(descriptions["Lifeless Mien (Ex)"]).toMatch(/30 feet.*DC 20 Spot/i);
    expect(descriptions["Construct Traits"]).toMatch(/destroyed at 0 hit points/i);
    expect(descriptions["Keen Claws (Ex)"]).toMatch(/eight masterwork daggers/i);
    expect(descriptions["Backstab (Ex)"]).not.toMatch(/require manual resolution|imported automatically/i);
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
