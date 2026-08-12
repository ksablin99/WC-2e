const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const packDir = path.join(root, "source", "warcraft-classes");
const classBase = JSON.parse(fs.readFileSync(path.join(packDir, "warrior-sgwzt7dg1zhxqlrw.json"), "utf8"));
const featureBase = JSON.parse(fs.readFileSync(path.join(packDir, "warrior-bonus-feat-uyhwjrfcckzfgwo6.json"), "utf8"));
const idFor = (kind, name) => crypto.createHash("sha256").update(`warcraftrpg2e:${kind}:${name}`).digest("hex").slice(0, 16);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const classes = [
  ["Archmage of Kirin Tor",6,"low",["low","low","high"],2,5,[94,95],["coc","crf","kar","klo","kmt","kna","kno","kpl","kre","prf","src","spl"],"High arcana and full advancement of an existing arcane spellcasting class."],
  ["Assassin",6,"med",["low","high","low"],4,10,[95,96,97],["blc","blf","clm","crf","dsc","dip","dis","esc","fog","gif","hid","int","jmp","klo","lis","opl","src","sen","slt","spt","swm","tmb","uro"],"Contract killer using Backstab, death attack, poison, stealth, and limited spellcasting."],
  ["Beastmaster",12,"high",["high","low","low"],4,10,[97,98,99],["clm","crf","han","hea","jmp","kna","lis","rid","spt","sur","swm"],"Horde or night-elf wilderness warrior with animal companions and animal magic."],
  ["Berserker",12,"high",["high","low","low"],4,10,[99,100,101],["clm","crf","han","int","jmp","lis","rid","sur","swm"],"Orc or troll rage specialist gaining berserk techniques and superior rage."],
  ["Duelist",10,"high",["low","high","low"],4,10,[101,102],["blc","blf","esc","jmp","lis","pro","sen","tmb"],"Agile one-weapon combatant using canny defense, reaction, mobility, and precise strikes."],
  ["Elven Ranger",8,"high",["high","high","low"],4,10,[102,103,104],["clm","coc","crf","hea","hid","jmp","kmt","kna","lis","pro","rid","src","spt","sur","swm","uro"],"High-elf or night-elf archer with favored enemies, wilderness abilities, and limited divine spells."],
  ["Fel-Sworn",6,"high",["low","high","low"],4,5,[105,106],["blf","dip","dsc","esc","gif","int","kar","kpl","sen","spl","umd"],"Fel-corrupted servant gaining a sworn bond and one fel boon at every level."],
  ["Gladiator",10,"high",["high","low","low"],2,10,[106,107,108],["blf","clm","crf","int","jmp","kmt","pro","sen","swm"],"Close-combat master, called a blademaster among the Horde, focused on weapon mastery."],
  ["Infiltrator",6,"med",["low","high","high"],6,10,[108,109,110],["apr","blc","blf","clm","crf","dsc","dip","dis","esc","fog","gif","hid","int","jmp","klo","lis","opl","prf","pro","src","sen","slt","spt","tmb","uro"],"Alliance spy and social manipulator using disguise, connections, enchantment, and stealth."],
  ["Mounted Warrior",10,"high",["high","low","low"],2,10,[110,111,112,113],["blc","clm","coc","crf","han","hea","jmp","kna","lis","pro","rid","spt","sur","swm"],"Mounted combat specialist with a superior mount, mounted expertise, and shock charge."],
];

const features = {
  "Archmage of Kirin Tor": [["High Arcana",[1,2,3,4,5]]],
  Assassin: [["Backstab",[1,3,5,7,9]],["Death Attack",[1]],["Poison Use",[1]],["Assassin Spells",[1]],["Poison Save",[2,4,6,8,10]],["Uncanny Dodge",[2]],["Improved Uncanny Dodge",[5]],["Hide in Plain Sight",[8]]],
  Beastmaster: [["Animal Companion",[1]],["Wild Empathy",[1]],["Charm Animal",[2,4,6,8,10]],["Empathic Link",[3,7]],["Natural Weaponry",[4,7]],["Speak with Animals",[5]],["Magic Fang",[6,8,10]],["Scry on Companion",[9]],["Greater Magic Fang",[10]]],
  Berserker: [["Rage",[1,4,7,10]],["Berserk",[2,4,6,8,10]],["Ferocity",[2]],["Greater Rage",[5]],["Undying Rage",[8]]],
  Duelist: [["Canny Defense",[1]],["Improved Reaction",[2,8]],["Enhanced Mobility",[3]],["Grace",[4]],["Precise Strike",[5,10]],["Acrobatic Charge",[6]],["Elaborate Parry",[7]],["Deflect Arrows",[9]]],
  "Elven Ranger": [["Elven Ranger Spells",[1]],["Favored Enemy",[1,3,5,7,9]],["Archery Combat Style",[1,6,10]],["Extended Range",[1]],["Heightened Perception",[2]],["Woodland Stride",[2]],["Keen Arrows",[4]],["Swift Tracker",[5]],["Bow Strike",[6]],["Anticipation",[8]],["Arrow Cleave",[10]]],
  "Fel-Sworn": [["Fel Corruption",[1]],["Fel Boon",[1,2,3,4,5]],["Sworn",[1]]],
  Gladiator: [["Supreme Cleave",[1]],["Command",[2]],["Two-Handed Mastery",[3]],["Critical Strike",[3,5,7,9]],["Weapon Focus",[3,6,9]],["Weapon Proficiency",[4,6,8,10]],["Mobility",[4]],["Weapon Specialization",[5,10]],["Maximize Blow",[6,8,10]],["Spring Attack",[7]],["Whirlwind Attack",[10]]],
  Infiltrator: [["Canny Defense",[1]],["Connections",[1]],["Smooth Talker",[2]],["Uncanny Dodge",[2]],["Flawless Disguise",[3]],["Suggestion",[4,6]],["Improved Uncanny Dodge",[5]],["Improvisation",[5]],["Slippery Mind",[7]],["Mass Suggestion",[8]],["Hide in Plain Sight",[9]],["Dominate",[10]]],
  "Mounted Warrior": [["Superior Mount",[1]],["Mounted Expertise",[2]],["Mounted Warrior Bonus Feat",[3,6,9]],["Improved Mounted Combat",[4,8]],["Mounted Command",[5]],["Woodland Ride",[7]],["Shock Charge",[10]]],
};

const prerequisiteData = {
  "Archmage of Kirin Tor": [
    { type: "skill", key: "kar", minimum: 15, label: "Knowledge (arcana) 15 ranks" },
    { type: "skill", key: "spl", minimum: 15, label: "Spellcraft 15 ranks" },
    // The generated catalogue currently represents Skill Focus as a generic
    // selectable feat; the selected skill is GM-verified until feat choices
    // gain a structured target field.
    { type: "feat", name: "Skill Focus", label: "Skill Focus feat" },
    { type: "manual", label: "Skill Focus is applied to Spellcraft" },
    { type: "manual", label: "Spell Focus in two schools of magic" },
    { type: "spell-level", spellcastingType: "arcane", minimum: 7, label: "Cast 7th-level arcane spells" },
    { type: "spell-schools", minimumLevel: 5, count: 5, label: "Know 5th-level spells from five schools" },
    { type: "path", parentClass: "Arcanist", key: "mage", minimum: 1, label: "Mage path (Necromancer and Warlock barred)" },
    { type: "not", label: "Does not follow the Necromancer or Warlock path", requirement: { type: "any", requirements: [{ type: "path", parentClass: "Arcanist", key: "necromancer", minimum: 1 }, { type: "path", parentClass: "Arcanist", key: "warlock", minimum: 1 }] } },
  ],
  Assassin: [
    { type: "alignment", value: "any-evil", label: "Any evil alignment" },
    { type: "affiliation", value: "independent", label: "Independent affiliation" },
    { type: "skill", key: "dsc", minimum: 4, label: "Disguise 4 ranks" },
    { type: "skill", key: "hid", minimum: 10, label: "Stealth 10 ranks" },
    { type: "manual", label: "Complete a contract killing solely for profit" },
  ],
  Beastmaster: [
    { type: "any", label: "Horde affiliation or Night Elf", requirements: [{ type: "affiliation", value: "horde" }, { type: "race", value: "Night Elf" }] },
    { type: "skill", key: "han", minimum: 5, label: "Handle Animal 5 ranks" },
    { type: "skill", key: "sur", minimum: 8, label: "Survival 8 ranks" },
    { type: "any", label: "Skill Focus (Handle Animal or Survival)", requirements: [{ type: "feat", name: "Skill Focus (Handle Animal)" }, { type: "feat", name: "Skill Focus (Survival)" }] },
    { type: "feat", name: "Toughness" },
  ],
  Berserker: [
    { type: "any", label: "Orc or Troll", requirements: [{ type: "race", value: "Orc" }, { type: "race", value: "Jungle Troll" }] },
    { type: "alignment", value: "non-lawful", label: "Non-lawful alignment" },
    { type: "affiliation", value: "horde", label: "Horde affiliation" },
    { type: "bab", minimum: 6, label: "Base attack bonus +6" },
    { type: "item", name: "Rage", label: "Rage at least once per day" },
  ],
  Duelist: [
    { type: "bab", minimum: 6, label: "Base attack bonus +6" },
    { type: "skill", key: "prf", minimum: 3, label: "Perform 3 ranks" },
    { type: "skill", key: "tmb", minimum: 5, label: "Tumble 5 ranks" },
    ...["Dodge", "Mobility", "Weapon Finesse"].map((name) => ({ type: "feat", name })),
  ],
  "Elven Ranger": [
    { type: "any", label: "High Elf or Night Elf", requirements: [{ type: "race", value: "High Elf" }, { type: "race", value: "Night Elf" }] },
    { type: "affiliation", value: "alliance", label: "Alliance affiliation" },
    { type: "bab", minimum: 5, label: "Base attack bonus +5" },
    { type: "skill", key: "kna", minimum: 6, label: "Knowledge (nature) 6 ranks" },
    { type: "skill", key: "sur", minimum: 6, label: "Survival 6 ranks" },
    { type: "feat", name: "Point Blank Shot" }, { type: "feat", name: "Track" },
  ],
  "Fel-Sworn": [
    { type: "any", label: "Warlock level or verified fel exposure", requirements: [{ type: "path", parentClass: "Arcanist", key: "warlock", minimum: 1 }, { type: "manual", satisfied: false, label: "Exposure to fel poison or fel-energy spells" }] },
  ],
  Gladiator: [
    { type: "bab", minimum: 5, label: "Base attack bonus +5" },
    { type: "skill", key: "blf", minimum: 2, label: "Bluff 2 ranks" },
    { type: "skill", key: "int", minimum: 5, label: "Intimidate 5 ranks" },
    ...["Cleave", "Dodge", "Power Attack"].map((name) => ({ type: "feat", name })),
  ],
  Infiltrator: [
    { type: "affiliation", value: "alliance", label: "Alliance affiliation" },
    { type: "all", label: "Six infiltration skills at 5 ranks", requirements: ["blf", "dip", "dsc", "gif", "lis", "sen"].map((key) => ({ type: "skill", key, minimum: 5 })) },
    { type: "skill-count", skills: ["blf", "dip", "dsc", "gif", "lis", "sen"], minimum: 8, count: 2, label: "Two infiltration skills at 8 ranks" },
  ],
  "Mounted Warrior": [
    { type: "bab", minimum: 5, label: "Base attack bonus +5" },
    { type: "skill", key: "rid", minimum: 8, label: "Ride 8 ranks" },
    { type: "feat", name: "Mounted Combat" },
  ],
};

const assassinSlots = [[1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1],[2,-1,1,-1,-1,-1,-1,-1,-1,-1,-1],[3,-1,2,0,-1,-1,-1,-1,-1,-1,-1],[4,-1,3,1,-1,-1,-1,-1,-1,-1,-1],[5,-1,3,2,0,-1,-1,-1,-1,-1,-1],[6,-1,3,3,1,-1,-1,-1,-1,-1,-1],[7,-1,3,3,2,0,-1,-1,-1,-1,-1],[8,-1,3,3,3,1,-1,-1,-1,-1,-1],[9,-1,3,3,3,2,-1,-1,-1,-1,-1],[10,-1,3,3,3,3,-1,-1,-1,-1,-1]];
const elvenRangerSlots = [[1,-1,0,-1,-1,-1,-1,-1,-1,-1,-1],[2,-1,1,-1,-1,-1,-1,-1,-1,-1,-1],[3,-1,1,0,-1,-1,-1,-1,-1,-1,-1],[4,-1,1,1,-1,-1,-1,-1,-1,-1,-1],[5,-1,1,1,0,-1,-1,-1,-1,-1,-1],[6,-1,1,1,1,-1,-1,-1,-1,-1,-1],[7,-1,2,1,1,0,-1,-1,-1,-1,-1],[8,-1,2,1,1,1,-1,-1,-1,-1,-1],[9,-1,2,2,1,1,-1,-1,-1,-1,-1],[10,-1,2,2,2,1,-1,-1,-1,-1,-1]];

for (const file of fs.readdirSync(packDir)) {
  if (!file.endsWith(".json") || file === ".index.json") continue;
  const document = JSON.parse(fs.readFileSync(path.join(packDir, file), "utf8"));
  if (document.flags?.warcraftrpg2e?.prestige?.generated) fs.unlinkSync(path.join(packDir, file));
}

for (const [name,hd,bab,saves,skills,maxLevel,pages,classSkills,description] of classes) {
  const document = JSON.parse(JSON.stringify(classBase));
  document._id = idFor("prestige-class", name); document.name = name; document.system.identifiedName = name;
  Object.assign(document.system, { classType: "prestige", hd, bab, skillsPerLevel: skills, maxLevel, automaticFeatures: true, hasSpellbook: false, spellcastingType: "none" });
  document.system.warcraftPrerequisites = prerequisiteData[name] || [];
  if (name === "Archmage of Kirin Tor") {
    document.system.warcraftSpellcastingAdvancement = { mode: "full", spellcastingType: "arcane", selectedClass: "" };
  }
  if (name === "Assassin" || name === "Elven Ranger") {
    const arcane = name === "Assassin";
    Object.assign(document.system, {
      hasSpellbook: true,
      spellcastingType: arcane ? "arcane" : "divine",
      spellcastingAbility: arcane ? "int" : "wis",
      spellslotAbility: arcane ? "int" : "wis",
      spellcastingSpontaneus: true,
      spellcastingPreparationMode: "repertoire",
      repertoireSkill: "spl",
      spellsPerLevel: arcane ? assassinSlots : elvenRangerSlots,
      spellbook: Array.from({ length: 10 }, (_, level) => ({ level, spells: [] })),
      usesWarcraftSlotPool: true,
      warcraftPoolKey: arcane ? "int" : "wis",
      warcraftParentClass: slug(name),
      spellcastingDescription: "Prepare a persistent repertoire and expend generic slots. Compatible spellbooks using the same casting ability pool slots while keeping their repertoires separate.",
    });
  }
  document.system.savingThrows = { fort: { value: saves[0] }, ref: { value: saves[1] }, will: { value: saves[2] } };
  for (const key of Object.keys(document.system.classSkills)) document.system.classSkills[key] = false;
  for (const key of classSkills) document.system.classSkills[key] = true;
  document.system.description.value = `<p>${description}</p><p>d${hd}; ${skills} + Intellect skill points; maximum ${maxLevel} levels. Structured prerequisites are validated against actor data; narrative requirements remain explicitly GM-verified.</p>`;
  document.system.source = `World of Warcraft RPG, 2nd Edition, pp. ${pages[0]-2}-${pages.at(-1)-2}`;
  document.flags = { warcraftrpg2e: { source: { book: "World of Warcraft: The Roleplaying Game, Second Edition", file: "docs/World_of_Warcraft_2nd_Edition.pdf", pdfPages: pages, printedPages: pages.map((page) => page-2), section: name, verification: "text+class-table" }, prestige: { generated: true, prerequisites: "structured-with-explicit-manual-gates", spellcastingAdvancement: name === "Archmage of Kirin Tor" ? "full-existing-arcane" : (name === "Assassin" || name === "Elven Ranger") ? "own-table" : "none" } } };
  fs.writeFileSync(path.join(packDir, `${slug(name)}-${document._id}.json`), `${JSON.stringify(document, null, 2)}\n`);

  for (const [featureName, levels] of features[name]) {
    const feature = JSON.parse(JSON.stringify(featureBase));
    feature._id = idFor("prestige-feature", `${name}:${featureName}`); feature.name = `${name}: ${featureName}`; feature.system.identifiedName = feature.name;
    feature.system.associations.classes = levels.map((level) => [name, level]);
    feature.system.uniqueId = `wc-prestige-${feature._id.slice(0,8)}-*`; feature.system.index.uniqueId = feature.system.uniqueId;
    feature.system.description.value = `<p>Granted by ${name} at ${levels.map((level) => `level ${level}`).join(", ")}. See the private rulebook for the complete situational effect.</p>`;
    feature.system.shortDescription = feature.system.description.value;
    feature.system.source = document.system.source;
    feature.flags = { warcraftrpg2e: { source: document.flags.warcraftrpg2e.source, prestige: { generated: true, parentClass: name, levels, status: "table-linked-manual-effect" } } };
    fs.writeFileSync(path.join(packDir, `${slug(name)}-${slug(featureName)}-${feature._id}.json`), `${JSON.stringify(feature, null, 2)}\n`);
  }
}

const documents = fs.readdirSync(packDir).filter((file) => file.endsWith(".json") && file !== ".index.json")
  .map((file) => ({ file, document: JSON.parse(fs.readFileSync(path.join(packDir, file), "utf8")) }))
  .sort((a,b) => a.document.name.localeCompare(b.document.name) || a.document.type.localeCompare(b.document.type));
const index = documents.map(({ file, document }) => ({ childKeyByCollection: {}, embeddedCollections: [], file, key: `!items!${document._id}` }));
fs.writeFileSync(path.join(packDir, ".index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Generated ${classes.length} prestige classes and ${Object.values(features).flat().length} table-linked prestige features.`);
