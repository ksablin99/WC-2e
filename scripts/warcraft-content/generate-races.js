const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const packDir = path.join(root, "source", "warcraft-races");
const humanPath = path.join(packDir, "human-mq9ljmcrgjj0bgvo.json");
const base = JSON.parse(fs.readFileSync(humanPath, "utf8"));
const classPackDir = path.join(root, "source", "warcraft-classes");
const featureBasePath = fs.readdirSync(classPackDir).find((file) => file.startsWith("warrior-bonus-feat-"));
if (!featureBasePath) throw new Error("Warrior Bonus Feat source is required as the racial-feature template.");
const featureBase = JSON.parse(fs.readFileSync(path.join(classPackDir, featureBasePath), "utf8"));
const harvestGolem = JSON.parse(fs.readFileSync(
  path.join(root, "source", "warcraft-bestiary", "harvest-golem-wcharvestgolem01.json"),
  "utf8"
));
const attackBase = harvestGolem._embedded.items.find((item) => item.type === "attack");
if (!attackBase) throw new Error("Harvest Golem attack source is required as the natural-attack template.");

const ability = (value, key) => [String(value), "ability", key, "racial"];
const skill = (value, key) => [String(value), "skill", `skill.${key}`, "racial"];
const speed = (value) => [String(value), "speed", "landSpeed", "base-replace"];
const save = (value) => [String(value), "savingThrows", "allSavingThrows", "racial"];
const note = (text, category, target) => [text, category, target];

const specs = [
  {
    slug: "ironforge-dwarf",
    name: "Ironforge Dwarf",
    pages: [35],
    pdfPages: [37],
    changes: [speed(20), ability(2, "con"), ability(-2, "cha")],
    flags: { heavyArmorFullSpeed: true, mediumArmorFullSpeed: true, noEncumbrance: true },
    senses: { darkvision: 60, lowLight: false },
    notes: [
      note("[[+2]] racial bonus against poison", "savingThrows", "allSavingThrows"),
      note("[[+4]] to resist bull rush or trip while standing on the ground", "misc", "cmb"),
    ],
    description: [
      "+2 Stamina, -2 Charisma; Medium; land speed 20 feet, unchanged by medium/heavy armor or medium/heavy loads.",
      "Darkvision 60 feet; stability; stonecunning.",
      "Treat long rifles, flintlock pistols, dwarven waraxes, dwarven battle hammers, and dwarven tossing hammers as martial weapons.",
      "+2 saves against poison. +2 Appraise and Craft for stone or metal, including gunsmithing where applicable.",
      "Automatic Common and Dwarven; bonus Gnome, Goblin, Orc, and Thalassian.",
      "Favored class Warrior; eligible for up to three Ironforge dwarf racial levels.",
    ],
  },
  {
    slug: "high-elf",
    name: "High Elf",
    pages: [37],
    pdfPages: [39],
    changes: [speed(30), ability(2, "int"), ability(-2, "con"), skill(2, "coc"), skill(2, "kar"), skill(2, "spl")],
    senses: { darkvision: null, lowLight: true },
    activeAbility: "Magic Addiction",
    notes: [
      note("[[+2]] racial bonus against mind-affecting spells and effects", "savingThrows", "allSavingThrows"),
      note("[[-2]] circumstance penalty on Charisma-based skills involving night elves or tauren", "skills", "skills"),
    ],
    description: [
      "+2 Intellect, -2 Stamina; Medium; land speed 30 feet; low-light vision.",
      "Magic addiction requires one hour of morning meditation or imposes -1 arcane caster level and -2 saves against spells for that day; moonwells can suspend the requirement.",
      "-2 circumstance penalty on Charisma-based skill checks involving night elves or tauren.",
      "Proficient with longbow, composite longbow, short sword, and longsword.",
      "+2 saves against mind-affecting effects; +2 Concentration, Knowledge (arcana), and Spellcraft, which are always class skills.",
      "Automatic Common and Thalassian; bonus Darnassian, Dwarven, Goblin, Kalimdoran, and Orcish.",
      "Favored class Mage; eligible for up to three high elf racial levels.",
    ],
  },
  {
    slug: "night-elf",
    name: "Night Elf",
    pages: [39],
    pdfPages: [41],
    changes: [speed(30), ability(2, "wis"), skill(2, "kna"), skill(2, "sur")],
    senses: { darkvision: null, lowLight: true },
    description: [
      "+2 Spirit; the detailed and summary tables conflict on the penalty, so no penalty is automated pending a campaign ruling.",
      "Medium; land speed 30 feet; low-light vision.",
      "+2 Knowledge (nature) and Survival, which are always class skills.",
      "Treat moonglaives, moon swords, and warglaives as martial weapons.",
      "Automatic Common and Darnassian; bonus Goblin, Low Common, Orcish, and Thalassian.",
      "Favored class Scout; eligible for up to three night elf racial levels.",
    ],
  },
  {
    slug: "gnome",
    name: "Gnome",
    pages: [41],
    pdfPages: [43],
    size: "sm",
    changes: [speed(20), ability(2, "int"), ability(2, "cha"), ability(-2, "str"), skill(2, "crf"), skill(2, "lis"), save(1)],
    senses: { darkvision: null, lowLight: true },
    counterName: "feat.tinker",
    description: [
      "+2 Intellect, +2 Charisma, -2 Strength; Small; land speed 20 feet; low-light vision.",
      "+2 all Craft checks and Listen; +1 all saving throws.",
      "Begins with one tinker bonus feat for which the character meets the prerequisites.",
      "Automatic Common and Gnome; bonus Dwarven, Goblin, and Thalassian.",
      "Favored class Tinker.",
    ],
  },
  {
    slug: "goblin",
    name: "Goblin",
    pages: [43],
    pdfPages: [45],
    size: "sm",
    changes: [speed(20), ability(2, "dex"), ability(-2, "str"), skill(2, "apr"), skill(2, "dip"), skill(2, "lis"), skill(3, "ctd")],
    senses: { darkvision: null, lowLight: true },
    counterName: "feat.technology",
    description: [
      "+2 Agility, -2 Strength; Small; land speed 20 feet; low-light vision.",
      "Treat flintlock pistols and long rifles as martial weapons; gain one technology feat at 1st level.",
      "+2 Appraise, Craft (alchemy), Diplomacy, and Listen; +3 Craft (technological device). These are always class skills.",
      "+2 Craft checks involving adamantine items.",
      "Automatic Common and Goblin; any unrestricted bonus language.",
      "Favored class Tinker.",
    ],
  },
  {
    slug: "orc",
    name: "Orc",
    pages: [46],
    pdfPages: [48],
    changes: [speed(30), ability(2, "con"), ability(-2, "int"), skill(2, "int")],
    senses: { darkvision: null, lowLight: true },
    activeAbility: "Battle Rage",
    notes: [
      note("[[+1]] racial bonus against humans", "attacks", "attack"),
      note("[[+2]] racial bonus on Handle Animal checks involving wolves", "skills", "skill.han"),
    ],
    description: [
      "+2 Stamina, -2 Intellect; Medium; land speed 30 feet; low-light vision.",
      "Battle rage once per day and no more than once per encounter; classes with rage gain one additional daily use.",
      "+2 Handle Animal with wolves and Intimidate; Intimidate is always a class skill. +1 attacks against humans.",
      "Treat orc claws of attack as martial weapons.",
      "Automatic Common and Orcish; bonus Goblin, Low Common, and Taur-ahe.",
      "Favored class Barbarian.",
    ],
  },
  {
    slug: "tauren",
    name: "Tauren",
    pages: [48],
    pdfPages: [50],
    changes: [speed(30), ability(2, "str"), ability(-2, "dex"), skill(2, "han"), skill(2, "sur")],
    activeAbility: "Horns",
    description: [
      "+2 Strength, -2 Agility; Medium; land speed 30 feet.",
      "Horns are a proficient natural weapon dealing 1d8 plus Strength modifier.",
      "Treat tauren halberds and totems as martial weapons; proficient with longspears and shortspears.",
      "+2 Handle Animal and Survival, which are always class skills.",
      "Automatic Common and Taur-ahe; bonus Goblin, Low Common, and Orcish.",
      "Favored class Warrior; eligible for up to three tauren racial levels.",
    ],
  },
  {
    slug: "jungle-troll",
    name: "Jungle Troll",
    pages: [50],
    pdfPages: [52],
    changes: [speed(30), ability(2, "dex"), ability(-2, "int"), ability(-2, "cha"), skill(2, "sur"), skill(2, "jmp"), skill(2, "tmb")],
    senses: { darkvision: null, lowLight: true },
    notes: [note("[[+1]] racial bonus with thrown weapons", "attacks", "attack")],
    description: [
      "+2 Agility, -2 Intellect, -2 Charisma; Medium; land speed 30 feet; low-light vision.",
      "Rapid healing doubles hit points recovered from rest.",
      "+1 attacks with thrown weapons; +2 Survival, Jump, and Tumble. These three skills are always class skills.",
      "Automatic Common and Low Common; bonus Goblin, Orc, and Taur-ahe.",
      "Favored class Barbarian; eligible for up to three jungle troll racial levels.",
    ],
  },
];

// Searchable, non-automating character-creation data.  These fields deliberately
// live under the Warcraft flag namespace until the Ultra pass defines a guided
// creation schema; they are still available to compendium filters and validators.
const raceMetadata = {
  "Ironforge Dwarf": {
    automaticLanguages: ["Common", "Dwarven"],
    bonusLanguages: ["Gnome", "Goblin", "Orcish", "Thalassian"],
    proficiencies: [
      "Long rifle (treated as martial)", "Flintlock pistol (treated as martial)",
      "Dwarven waraxe (treated as martial)", "Dwarven battle hammer (treated as martial)",
      "Dwarven tossing hammer (treated as martial)",
    ],
    favoredClass: ["Warrior"], racialLevel: { available: true, name: "Ironforge Dwarf", max: 3 },
  },
  "High Elf": {
    automaticLanguages: ["Common", "Thalassian"],
    bonusLanguages: ["Darnassian", "Dwarven", "Goblin", "Kalimdoran", "Orcish"],
    proficiencies: ["Longbow", "Composite longbow", "Short sword", "Longsword"],
    favoredClass: ["Mage"], racialLevel: { available: true, name: "High Elf", max: 3 },
  },
  "Night Elf": {
    automaticLanguages: ["Common", "Darnassian"],
    bonusLanguages: ["Goblin", "Low Common", "Orcish", "Thalassian"],
    proficiencies: [
      "Moonglaive (treated as martial)", "Moon sword (treated as martial)",
      "Warglaive (treated as martial)",
    ],
    favoredClass: ["Scout"], racialLevel: { available: true, name: "Night Elf", max: 3 },
  },
  Gnome: {
    automaticLanguages: ["Common", "Gnome"], bonusLanguages: ["Dwarven", "Goblin", "Thalassian"],
    proficiencies: [], favoredClass: ["Tinker"], racialLevel: { available: false, name: "", max: 0 },
  },
  Goblin: {
    automaticLanguages: ["Common", "Goblin"], bonusLanguages: ["Any unrestricted language"],
    proficiencies: ["Flintlock pistol (treated as martial)", "Long rifle (treated as martial)"],
    favoredClass: ["Tinker"], racialLevel: { available: false, name: "", max: 0 },
  },
  Human: {
    automaticLanguages: ["Common"], bonusLanguages: ["Any unrestricted language"], proficiencies: [],
    favoredClass: ["Any"], racialLevel: { available: false, name: "", max: 0 },
  },
  Orc: {
    automaticLanguages: ["Common", "Orcish"], bonusLanguages: ["Goblin", "Low Common", "Taur-ahe"],
    proficiencies: ["Orc claws of attack (treated as martial)"],
    favoredClass: ["Barbarian"],
    racialLevel: {
      available: false,
      sourceSupported: true,
      name: "Orc",
      max: 0,
      status: "source-omits-progression",
    },
  },
  Tauren: {
    automaticLanguages: ["Common", "Taur-ahe"], bonusLanguages: ["Goblin", "Low Common", "Orcish"],
    proficiencies: [
      "Horns (natural weapon)", "Longspear", "Shortspear",
      "Tauren halberd (treated as martial)", "Tauren totem (treated as martial)",
    ],
    favoredClass: ["Warrior"], racialLevel: { available: true, name: "Tauren", max: 3 },
  },
  "Jungle Troll": {
    automaticLanguages: ["Common", "Low Common"], bonusLanguages: ["Goblin", "Orcish", "Taur-ahe"],
    proficiencies: [], favoredClass: ["Barbarian"],
    racialLevel: { available: true, name: "Jungle Troll", max: 3 },
  },
  Forsaken: {
    automaticLanguages: ["Common"], bonusLanguages: ["Goblin", "Low Common", "Orcish", "Thalassian"],
    proficiencies: [], favoredClass: ["Warrior"],
    racialLevel: { available: true, name: "Forsaken", max: 3 },
  },
};

function idFor(name) {
  return crypto.createHash("sha256").update(`warcraftrpg2e:race:${name}`).digest("hex").slice(0, 16);
}

function racialAbilityUid(name) {
  return `wc-race-${crypto.createHash("sha256").update(`warcraftrpg2e:race-ability:${name}`).digest("hex").slice(0, 10)}`;
}

function racialAbilitySource(spec, section) {
  return {
    book: "World of Warcraft: The Roleplaying Game, Second Edition",
    file: "docs/World_of_Warcraft_2nd_Edition.pdf",
    pdfPages: spec.pdfPages,
    printedPages: spec.pages,
    section,
    verification: "text+render",
  };
}

function makeRacialFeature(spec, name, description) {
  const doc = JSON.parse(JSON.stringify(featureBase));
  doc._id = idFor(`ability:${name}`);
  doc.name = name;
  doc.img = "icons/svg/aura.svg";
  doc.flags = { warcraftrpg2e: {
    source: racialAbilitySource(spec, `${spec.name} racial traits: ${name}`),
    baselineRacialFeature: true,
  } };
  doc.system.identifiedName = name;
  doc.system.featType = "racial";
  doc.system.associations = { classes: [] };
  doc.system.changes = [];
  doc.system.counterName = "";
  doc.system.description.value = `<p>${description}</p>`;
  doc.system.shortDescription = `<p>${description}</p>`;
  doc.system.source = `World of Warcraft RPG, 2nd Edition, p. ${spec.pages.join("-")}`;
  doc.system.uniqueId = racialAbilityUid(name);
  doc.system.index.uniqueId = doc.system.uniqueId;
  return doc;
}

function makeBattleRage(spec) {
  const doc = makeRacialFeature(
    spec,
    "Battle Rage",
    "Once per day, and no more than once per encounter, enter battle rage as a 1st-level barbarian. A class that already grants rage receives one additional daily use instead. Activate and resolve the rage from the appropriate class feature; this record tracks the racial daily use."
  );
  doc.system.uses = { ...doc.system.uses, value: 1, max: 1, maxFormula: "1", per: "day" };
  doc.system.activation = { ...doc.system.activation, type: "free", cost: 0 };
  return doc;
}

function makeMagicAddiction(spec) {
  return makeRacialFeature(
    spec,
    "Magic Addiction",
    "Spend one uninterrupted hour in morning meditation. If this requirement is not met, apply -1 arcane caster level and -2 on saves against spells until the next morning. A moonwell or equivalent source can suspend this requirement. Foundry does not infer elapsed meditation or proximity to a moonwell; toggle the penalties manually when required."
  );
}

function makeTaurenHorns(spec) {
  const doc = JSON.parse(JSON.stringify(attackBase));
  doc._id = idFor("ability:Horns");
  doc.name = "Horns";
  doc.img = "icons/svg/sword.svg";
  doc.flags = { warcraftrpg2e: {
    source: racialAbilitySource(spec, "Tauren racial traits: horns"),
    baselineRacialFeature: true,
  } };
  doc.system.identifiedName = "Horns";
  doc.system.uniqueId = racialAbilityUid("Horns");
  doc.system.index = { ...(doc.system.index || {}), uniqueId: doc.system.uniqueId };
  doc.system.ability = { ...doc.system.ability, attack: "str", damage: "str", damageMult: 1, critRange: 20, critMult: 2 };
  doc.system.actionType = "mwak";
  doc.system.attackBonus = "";
  doc.system.attackType = "natural";
  doc.system.baseWeaponType = "Horns";
  doc.system.damage = { ...doc.system.damage, parts: [["1d8", "Piercing", "damage-piercing"]] };
  doc.system.description.value = "<p>Primary natural weapon. Make a proficient melee attack dealing 1d8 piercing damage plus the tauren's Strength modifier.</p>";
  doc.system.enh = 0;
  doc.system.magic = false;
  doc.system.primaryAttack = true;
  doc.system.proficient = true;
  doc.system.source = `World of Warcraft RPG, 2nd Edition, p. ${spec.pages.join("-")}`;
  doc.system.threatRangeExtended = false;
  return doc;
}

function makeRace(spec) {
  const doc = JSON.parse(JSON.stringify(base));
  doc._id = idFor(spec.name);
  doc.name = spec.name;
  doc.img = "icons/svg/mystery-man.svg";
  doc.flags.warcraftrpg2e.source = {
    book: "World of Warcraft: The Roleplaying Game, Second Edition",
    file: "docs/World_of_Warcraft_2nd_Edition.pdf",
    pdfPages: spec.pdfPages,
    printedPages: spec.pages,
    section: `${spec.name} racial traits`,
    verification: "text+render",
  };
  doc.system.identifiedName = spec.name;
  doc.system.changes = spec.changes;
  doc.system.contextNotes = spec.notes || [];
  // The template is Human, whose feat/skill-point counters are racial traits.
  // Never leak those counters into cloned races.
  doc.system.counterName = spec.counterName || "";
  doc.system.addedAbilities = spec.activeAbility ? [{ uid: racialAbilityUid(spec.activeAbility), level: 1 }] : [];
  doc.system.sizeOverride = spec.size || "med";
  doc.system.creatureType = "humanoid";
  doc.system.deathRule = "warcraft";
  doc.system.source = `World of Warcraft RPG, 2nd Edition, p. ${spec.pages.join("-")}`;
  doc.system.senses = {
    blindsight: null,
    darkvision: spec.senses?.darkvision ?? null,
    lowLight: spec.senses?.lowLight ?? false,
    lowLightMultiplier: spec.senses?.lowLight ? 2 : null,
    tremorsense: null,
    truesight: null,
  };
  Object.assign(doc.system.changeFlags, spec.flags || {});
  doc.system.description.value = `<p>${spec.name} racial traits.</p><ul>${spec.description.map((entry) => `<li>${entry}</li>`).join("")}</ul>`;
  return doc;
}

// Remove only baseline abilities owned by this generator. Racial-level records
// are owned by generate-racial-levels.js and must survive this pass.
for (const file of fs.readdirSync(packDir).filter((name) => name.endsWith(".json") && name !== ".index.json")) {
  const filePath = path.join(packDir, file);
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (doc.flags?.warcraftrpg2e?.baselineRacialFeature) fs.unlinkSync(filePath);
}

for (const spec of specs) {
  const doc = makeRace(spec);
  const filename = `${spec.slug}-${doc._id}.json`;
  fs.writeFileSync(path.join(packDir, filename), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  let active = null;
  if (spec.activeAbility === "Magic Addiction") active = makeMagicAddiction(spec);
  if (spec.activeAbility === "Battle Rage") active = makeBattleRage(spec);
  if (spec.activeAbility === "Horns") active = makeTaurenHorns(spec);
  if (active) {
    const filename = `${spec.slug}-${active.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${active._id}.json`;
    fs.writeFileSync(path.join(packDir, filename), `${JSON.stringify(active, null, 2)}\n`, "utf8");
  }
}

const documents = fs.readdirSync(packDir)
  .filter((file) => file.endsWith(".json") && file !== ".index.json")
  .map((file) => ({ file, doc: JSON.parse(fs.readFileSync(path.join(packDir, file), "utf8")) }))
  .sort((a, b) => a.doc.name.localeCompare(b.doc.name) || a.doc.type.localeCompare(b.doc.type));

for (const { file, doc } of documents) {
  if (doc.type !== "race" || !raceMetadata[doc.name]) continue;
  const metadata = raceMetadata[doc.name];
  doc.flags = doc.flags || {};
  doc.flags.warcraftrpg2e = doc.flags.warcraftrpg2e || {};
  doc.flags.warcraftrpg2e.race = {
    ...metadata,
    category: "player-race",
    size: doc.system.sizeOverride || "med",
    searchableTraits: [
      ...metadata.automaticLanguages,
      ...metadata.bonusLanguages,
      ...metadata.proficiencies,
      ...metadata.favoredClass.map((name) => `Favored class: ${name}`),
    ],
  };
  fs.writeFileSync(path.join(packDir, file), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

const index = documents.map(({ file, doc }) => ({
  childKeyByCollection: {},
  embeddedCollections: [],
  file,
  key: `!items!${doc._id}`,
}));

fs.writeFileSync(path.join(packDir, ".index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Generated ${specs.length} race records; indexed ${documents.length} Warcraft race-pack documents.`);
