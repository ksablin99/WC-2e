const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const racePackDir = path.join(root, "source", "warcraft-races");
const classPackDir = path.join(root, "source", "warcraft-classes");
const classBasePath = fs.readdirSync(classPackDir).find((file) => file.startsWith("warrior-") && !file.startsWith("warrior-bonus"));
const featureBasePath = fs.readdirSync(classPackDir).find((file) => file.startsWith("warrior-bonus-feat-"));
const classBase = JSON.parse(fs.readFileSync(path.join(classPackDir, classBasePath), "utf8"));
const featureBase = JSON.parse(fs.readFileSync(path.join(classPackDir, featureBasePath), "utf8"));

const specs = [
  {
    race: "Ironforge Dwarf", className: "Ironforge Dwarf Racial Levels", slug: "ironforge-dwarf-racial-levels",
    pdf: [37], printed: [35], hd: 8, bab: "med", saves: ["high", "low", "low"],
    skills: ["apr", "clm", "crf", "coc", "lis", "src", "sen", "spt"],
    features: [
      ["Attacks Against Giants", [1], "+2 racial bonus on attack rolls against giants."],
      ["Stoneflesh", [1], "Once per day, gain +2 natural armor per racial level for Stamina modifier + racial level rounds."],
      ["Dwarven Weapon Proficiency", [1, 2, 3], "Choose long rifle, flintlock pistol, dwarven waraxe, dwarven battle hammer, or dwarven tossing hammer."],
      ["Dwarven Strength", [2], "+2 Strength.", [["2", "ability", "str", "racial"]]],
      ["Dodge Giants", [2], "+4 dodge AC against giants."],
      ["Dwarven Spell Resistance", [3], "+3 racial bonus on saves against spells and spell-like effects."],
    ],
  },
  {
    race: "High Elf", className: "High Elf Racial Levels", slug: "high-elf-racial-levels",
    pdf: [39, 40], printed: [37, 38], hd: 8, bab: "med", saves: ["low", "low", "high"],
    skills: ["coc", "crf", "dip", "kar", "lis", "sen", "spl", "spt"], casterStack: "arcane",
    features: [
      ["High Elf Agility", [1, 2], "+1 Agility at each listed racial level.", [["1", "ability", "dex", "racial"]]],
      ["High Elf Spell-Like Abilities", [1], "With Intellect 10+, choose four arcanist 0-level spells; cast each day as spell-like abilities at racial caster level."],
      ["Increased Caster Level", [2], "All arcane spells are cast at +1 caster level; excludes spell-like abilities."],
      ["Empower Magic", [3], "Once per day, apply Empower Spell to an arcane spell without extra casting time or a higher slot."],
    ],
  },
  {
    race: "Night Elf", className: "Night Elf Racial Levels", slug: "night-elf-racial-levels",
    pdf: [41, 42], printed: [39, 40], hd: 8, bab: "med", saves: ["low", "low", "high"],
    skills: ["clm", "coc", "han", "lis", "sen", "spl", "spt", "hid", "sur"],
    features: [
      ["Shadowmeld", [1], "+10 circumstance bonus on Stealth while stationary at night or in low light."],
      ["Night Elf Acrobatics", [1], "+2 racial bonus on Balance and Tumble.", [["2", "skill", "skill.blc", "racial"], ["2", "skill", "skill.tmb", "racial"]]],
      ["Night Elf Weapon Proficiency", [1, 2, 3], "Choose moonglaive, moon sword, or warglaive."],
      ["Night Elf Resistances", [2], "Cold and fire resistance 2, increasing by +1 per four total character levels."],
      ["Night Elf Agility", [3], "+2 Agility.", [["2", "ability", "dex", "racial"]]],
      ["Arcane Resistance", [3], "+2 racial bonus on saves against arcane magic."],
    ],
  },
  {
    race: "Tauren", className: "Tauren Racial Levels", slug: "tauren-racial-levels",
    pdf: [50, 51], printed: [48, 49], hd: 10, bab: "med", saves: ["high", "low", "high"],
    skills: ["clm", "coc", "han", "lis", "sen", "spl", "spt", "sur"], casterStack: "divine",
    features: [
      ["Tauren Strength", [1, 3], "+1 Strength at each listed racial level.", [["1", "ability", "str", "racial"]]],
      ["Tauren Charge", [1], "Charge using horns for horn damage plus 1-1/2 Strength modifier."],
      ["Tauren Spirit", [2], "+2 Spirit.", [["2", "ability", "wis", "racial"]]],
      ["Tauren Courage", [2], "+4 racial bonus on saves against fear."],
      ["Tauren Weapon Proficiency", [2, 3], "Choose tauren halberd or tauren totem."],
      ["Improved Tauren Charge", [3], "Count as Large for tauren charges and bull rushes; +4 racial Strength checks to bull rush."],
    ],
  },
  {
    race: "Jungle Troll", className: "Jungle Troll Racial Levels", slug: "jungle-troll-racial-levels",
    pdf: [52, 53], printed: [50, 51], hd: 8, bab: "high", saves: ["high", "high", "low"],
    skills: ["blc", "clm", "jmp", "lis", "spt", "hid", "sur", "swm", "tmb"], casterStack: "divine",
    features: [
      ["Jungle Troll Stamina", [1, 3], "+1 Stamina at each listed racial level.", [["1", "ability", "con", "racial"]]],
      ["Improved Rapid Healing", [1], "Recover hit points equal to Stamina modifier each hour; replaces Rapid Healing."],
      ["Jungle Troll Agility", [2], "+1 Agility.", [["1", "ability", "dex", "racial"]]],
      ["Fast Healing 1", [2], "Gain fast healing 1; replaces Improved Rapid Healing.", [["1", "misc", "fastHeal", "racial"]]],
      ["Troll Healing", [3], "Fast healing equals half Stamina modifier, rounded down, minimum 1; replaces Fast Healing 1.", [["max(1, floor(@abilities.con.mod / 2))", "misc", "fastHeal", "racial"]]],
    ],
  },
  {
    race: "Forsaken", className: "Forsaken Racial Levels", slug: "forsaken-racial-levels",
    pdf: [55], printed: [53], hd: 12, bab: "med", saves: ["low", "low", "high"],
    skills: ["blf", "crf", "int", "jmp", "hid"], noCon: true,
    features: [
      ["Forsaken Racial Advancement", [1, 2, 3], "+1 natural armor and +1 Strength at each racial level.", [["1", "ac", "nac", "racial"], ["1", "ability", "str", "racial"]]],
      ["Forsaken Slam", [2], "Gain a slam natural attack dealing 1d6 plus Strength modifier."],
      ["Increased Hit Die", [3], "All future Hit Dice increase one die step; d12 becomes d12+2."],
    ],
  },
];

const idFor = (kind, value) => crypto.createHash("sha256")
  .update(`warcraftrpg2e:${kind}:${value}`).digest("hex").slice(0, 16);
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const source = (spec, section) => ({
  book: "World of Warcraft: The Roleplaying Game, Second Edition",
  file: "docs/World_of_Warcraft_2nd_Edition.pdf",
  pdfPages: spec.pdf,
  printedPages: spec.printed,
  section,
  verification: "text+render",
});

function classDocument(spec) {
  const doc = JSON.parse(JSON.stringify(classBase));
  doc._id = idFor("racial-class", spec.race);
  doc.name = spec.className;
  doc.img = "icons/svg/book.svg";
  doc.flags = { warcraftrpg2e: {
    source: source(spec, `${spec.race} levels`),
    racialClass: { race: spec.race, maxLevel: 3, casterStack: spec.casterStack ?? null },
  } };
  doc.system.identifiedName = spec.className;
  doc.system.classType = "racial";
  doc.system.racialRequirement = spec.race;
  doc.system.maxLevel = 3;
  doc.system.levels = 1;
  doc.system.automaticFeatures = true;
  doc.system.hd = spec.hd;
  doc.system.hp = spec.hd;
  doc.system.bab = spec.bab;
  doc.system.skillsPerLevel = 2;
  doc.system.savingThrows = { fort: { value: spec.saves[0] }, ref: { value: spec.saves[1] }, will: { value: spec.saves[2] } };
  for (const key of Object.keys(doc.system.classSkills)) doc.system.classSkills[key] = false;
  for (const key of spec.skills) if (key in doc.system.classSkills) doc.system.classSkills[key] = true;
  doc.system.changeFlags.noCon = Boolean(spec.noCon);
  doc.system.changes = [];
  doc.system.warcraftSpellcastingAdvancement = spec.casterStack ? {
    mode: "full",
    spellcastingType: spec.casterStack,
    target: "highest",
    affectsSlots: false,
    ...(spec.race === "High Elf" ? { bonusCasterLevels: [{ atLevel: 2, amount: 1 }] } : {}),
  } : {};
  doc.system.warcraftPrerequisites = [{ type: "race", value: spec.race }];
  doc.system.description.value = `<p>Optional ${spec.race} racial class; maximum 3 levels.</p><ul><li>d${spec.hd} Hit Die; 2 + Intellect skill points per level.</li><li>Base attack and saves follow the printed racial table.</li>${spec.casterStack ? `<li>Racial levels stack with the highest ${spec.casterStack} spellcasting class for caster level.</li>` : ""}</ul>`;
  doc.system.extraDescription.value = "<p>Level features are granted automatically from linked records in this compendium.</p>";
  doc.system.source = `World of Warcraft RPG, 2nd Edition, pp. ${spec.printed.join("-")}`;
  return doc;
}

function featureDocument(spec, [name, levels, description, changes = []]) {
  const doc = JSON.parse(JSON.stringify(featureBase));
  doc._id = idFor("racial-feature", `${spec.race}:${name}`);
  doc.name = name;
  doc.system.identifiedName = name;
  doc.flags = { warcraftrpg2e: { source: source(spec, `${spec.race} levels: ${name}`), racialClassFeature: true } };
  doc.system.associations.classes = levels.map((level) => [spec.className, level]);
  doc.system.description.value = `<p>${description}</p>`;
  doc.system.shortDescription = `<p>${description}</p>`;
  doc.system.source = `World of Warcraft RPG, 2nd Edition, pp. ${spec.printed.join("-")}`;
  doc.system.changes = changes;
  if (spec.race === "Night Elf" && name === "Night Elf Resistances") {
    doc.system.resistances = [
      ["2 + floor(@attributes.hd.total / 4)", "energy-cold", false, false, false],
      ["2 + floor(@attributes.hd.total / 4)", "energy-fire", false, false, false],
    ];
  }
  if (spec.race === "Ironforge Dwarf" && name === "Stoneflesh") {
    doc.system.uses = { ...doc.system.uses, value: 1, max: 1, maxFormula: "1", per: "day" };
    doc.system.activation = { ...doc.system.activation, type: "swift", cost: 1 };
  }
  if (spec.race === "High Elf" && name === "Empower Magic") {
    doc.system.uses = { ...doc.system.uses, value: 1, max: 1, maxFormula: "1", per: "day" };
    doc.system.activation = { ...doc.system.activation, type: "free", cost: 0 };
    doc.system.metamagic = {
      enabled: true,
      shortDesc: "Empower one arcane spell without increasing its slot level; consumes the feature's daily use.",
      code: "newSpell.name = game.i18n.localize('D35E.SpellEmpowered') + ' ' + newSpell.name; newSpell.system.metamagicFeats.empowered = true; newSpell.system.warcraftManualPolicy = 'Consume one Empower Magic daily use; slot level is unchanged.';",
    };
  }
  doc.system.uniqueId = `wc-racial-${idFor("racial-feature-uid", `${spec.race}:${name}`).slice(0, 8)}-*`;
  doc.system.index.uniqueId = doc.system.uniqueId;
  return doc;
}

// Remove only documents owned by this generator so unrelated race work survives.
for (const file of fs.readdirSync(racePackDir).filter((name) => name.endsWith(".json") && name !== ".index.json")) {
  const filePath = path.join(racePackDir, file);
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (doc.flags?.warcraftrpg2e?.racialClassFeature || doc.flags?.warcraftrpg2e?.racialClass) fs.unlinkSync(filePath);
  else if (doc.type === "class" && doc.system?.classType === "racial") fs.unlinkSync(filePath);
}

for (const spec of specs) {
  const cls = classDocument(spec);
  fs.writeFileSync(path.join(racePackDir, `${spec.slug}-${cls._id}.json`), `${JSON.stringify(cls, null, 2)}\n`, "utf8");
  for (const feature of spec.features) {
    const doc = featureDocument(spec, feature);
    fs.writeFileSync(path.join(racePackDir, `${slug(`${spec.race}-${feature[0]}`)}-${doc._id}.json`), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  }
}

const documents = fs.readdirSync(racePackDir)
  .filter((file) => file.endsWith(".json") && file !== ".index.json")
  .map((file) => ({ file, doc: JSON.parse(fs.readFileSync(path.join(racePackDir, file), "utf8")) }))
  .sort((a, b) => a.doc.name.localeCompare(b.doc.name) || a.doc.type.localeCompare(b.doc.type));
const index = documents.map(({ file, doc }) => ({ childKeyByCollection: {}, embeddedCollections: [], file, key: `!items!${doc._id}` }));
fs.writeFileSync(path.join(racePackDir, ".index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Generated ${specs.length} racial classes and ${specs.reduce((sum, entry) => sum + entry.features.length, 0)} racial features.`);
