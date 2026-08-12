const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const packDir = path.join(root, "source", "warcraft-classes");
const classBase = JSON.parse(fs.readFileSync(path.join(packDir, "warrior-sgwzt7dg1zhxqlrw.json"), "utf8"));
const featureBase = JSON.parse(fs.readFileSync(path.join(packDir, "warrior-bonus-feat-uyhwjrfcckzfgwo6.json"), "utf8"));

const healerSlots = [
  [1,3,1,-1,-1,-1,-1,-1,-1,-1,-1],[2,4,2,-1,-1,-1,-1,-1,-1,-1,-1],
  [3,4,2,1,-1,-1,-1,-1,-1,-1,-1],[4,5,3,2,-1,-1,-1,-1,-1,-1,-1],
  [5,5,3,2,1,-1,-1,-1,-1,-1,-1],[6,5,3,3,2,-1,-1,-1,-1,-1,-1],
  [7,6,4,3,2,-1,-1,-1,-1,-1,-1],[8,6,4,3,3,2,-1,-1,-1,-1,-1],
  [9,6,4,4,3,2,1,-1,-1,-1,-1],[10,6,4,4,3,3,2,-1,-1,-1,-1],
  [11,6,5,4,4,3,2,1,-1,-1,-1],[12,6,5,4,4,3,3,2,-1,-1,-1],
  [13,6,5,5,4,4,3,2,1,-1,-1],[14,6,5,5,4,4,3,3,2,-1,-1],
  [15,6,5,5,5,4,4,3,2,1,-1],[16,6,5,5,5,4,4,3,3,2,-1],
  [17,6,5,5,5,5,4,4,3,2,1],[18,6,5,5,5,5,4,4,3,3,2],
  [19,6,5,5,5,5,5,4,4,3,3],[20,6,5,5,5,5,5,4,4,4,4],
];

const paladinByLevel = [
  null,null,null,[0],[0],[1],[1],[1,0],[1,0],[1,1],[1,1,0],[1,1,1],[1,1,1],
  [2,1,1,0],[2,1,1,1],[2,2,1,1],[2,2,2,1],[3,2,2,1],[3,3,3,2],[3,3,3,3],
];
const paladinSlots = paladinByLevel.map((slots, index) => [
  index + 1,
  -1,
  ...Array.from({ length: 9 }, (_, spellIndex) => slots?.[spellIndex] ?? -1),
]);

const classes = [
  {
    name: "Barbarian", slug: "barbarian", pdf: [64,65,66], printed: [62,63,64], hd: 12, bab: "high",
    saves: ["high","low","low"], skills: 4,
    classSkills: ["clm","crf","han","int","jmp","lis","rid","sur","swm"],
    description: "Ferocious martial class using rage, speed, uncanny defenses, trap sense, and damage reduction.",
    proficiencies: "All simple and martial weapons, light and medium armor, and shields except tower shields.",
  },
  {
    name: "Healer", slug: "healer", pdf: [67,68,69,70], printed: [65,66,67,68], hd: 8, bab: "med",
    saves: ["high","low","high"], skills: 4,
    classSkills: ["blf","coc","crf","dip","hea","kar","kre","kpl","lis","pro","spk","spl"],
    description: "Parent divine class for the druid, priest, and shaman paths, with domains, inspirations, and turning.",
    proficiencies: "All simple weapons and light armor.",
    casting: { ability: "wis", type: "divine", slots: healerSlots },
  },
  {
    name: "Hunter", slug: "hunter", pdf: [75,76,77,78], printed: [73,74,75,76], hd: 8, bab: "high",
    saves: ["low","high","low"], skills: 4,
    classSkills: ["clm","crf","han","hea","jmp","kna","lis","pro","src","spt","hid","sur","swm","uro"],
    description: "Ranged wilderness combatant using stings, persistent aspects, and a tamed companion.",
    proficiencies: "All simple and martial weapons plus light and medium armor.",
  },
  {
    name: "Paladin", slug: "paladin", pdf: [79,80,81,82], printed: [77,78,79,80], hd: 10, bab: "high",
    saves: ["high","low","low"], skills: 2,
    classSkills: ["coc","crf","dip","han","hea","kmt","kno","kre","pro","pmc","rid","sen"],
    description: "Good-aligned martial divine caster using holy strikes, auras, turning, and lay on hands.",
    proficiencies: "All simple and martial weapons, all armor, and shields except tower shields.",
    casting: { ability: "wis", type: "divine", slots: paladinSlots, half: true },
  },
  {
    name: "Rogue", slug: "rogue", pdf: [82,83,84,85], printed: [80,81,82,83], hd: 6, bab: "med",
    saves: ["low","high","low"], skills: 8,
    classSkills: ["apr","blc","blf","clm","crf","dip","dev","dis","esc","fog","gif","int","jmp","klo","lis","opl","prf","pro","src","sen","slt","spt","hid","swm","tmb","umd","uro"],
    description: "Skill specialist using Backstab, trapfinding, evasion, uncanny defenses, and selectable special abilities.",
    proficiencies: "All simple weapons plus hand crossbows, saps, shortbows, short swords, and warblades; light armor.",
    backstab: true,
  },
  {
    name: "Scout", slug: "scout", pdf: [85,86,87], printed: [83,84,85], hd: 8, bab: "med",
    saves: ["high","high","low"], skills: 6,
    classSkills: ["clm","crf","hea","jmp","kmt","kna","lis","pro","src","spt","hid","sur","swm","uro"],
    description: "Mobile wilderness guide combining tracking, natural healing, defensive agility, and exploration spell-like abilities.",
    proficiencies: "All simple and martial weapons, light and medium armor, and shields.",
  },
  {
    name: "Tinker", slug: "tinker", pdf: [88,89,90], printed: [86,87,88], hd: 6, bab: "med",
    saves: ["low","high","high"], skills: 8,
    classSkills: ["apr","coc","crf","ctd","dsc","dev","fog","klo","kmt","kna","kno","kpl","opl","pro","src","umd","utd"],
    description: "Technology specialist using bonus feats, scavenged materials, rapid construction, device expertise, and energy resistance.",
    proficiencies: "All simple weapons.",
  },
];

const features = [
  ["Barbarian","Fast Movement",[1],"+10-foot land speed while unarmored or in light/medium armor and not carrying a heavy load."],
  ["Barbarian","Illiteracy",[1],"Does not begin literate; two skill points grant literacy, and any other class level grants it automatically."],
  ["Barbarian","Rage",[1,4,8,12,16,20],"Once per encounter and the listed times per day: +4 Strength, +4 Stamina, +2 morale Will, -2 AC; lasts 3 + improved Stamina modifier rounds, then fatigues."],
  ["Barbarian","Uncanny Dodge",[2],"Retains Agility bonus to AC while flat-footed or attacked invisibly, but not while immobilized."],
  ["Barbarian","Trap Sense",[3,6,9,12,15,18],"Scaling bonus on Reflex saves and dodge AC against traps."],
  ["Barbarian","Improved Uncanny Dodge",[5],"Cannot be flanked except by a rogue with at least four more rogue levels; compatible class levels stack."],
  ["Barbarian","Damage Reduction",[7,10,13,16,19],"Physical damage reduction begins at 1/- and rises by one at each listed level."],
  ["Barbarian","Greater Rage",[11],"Rage becomes +6 Strength, +6 Stamina, and +3 morale Will; AC penalty stays -2."],
  ["Barbarian","Indomitable Will",[14],"While raging, +4 Will against enchantment; stacks with the rage morale bonus."],
  ["Barbarian","Tireless Rage",[17],"No longer fatigued when rage ends."],
  ["Barbarian","Mighty Rage",[20],"Rage becomes +8 Strength, +8 Stamina, and +4 morale Will; AC penalty stays -2."],

  ["Healer","Brew Potion",[1],"Gain Brew Potion as a bonus feat."],
  ["Healer","Healer Domains",[1,10,20],"Gain lesser and greater domain access according to the healer table, including one restricted domain slot per spell level."],
  ["Healer","Turn or Rebuke",[1],"Affect the creature type defined by the current path 3 + Charisma modifier times per day."],
  ["Healer","Healer Bonus Feat",[5,10,15,20],"Choose a metamagic feat, item-creation feat, or Spell Focus; prerequisites apply."],

  ["Hunter","Animal Empathy",[1],"+2 Handle Animal."],
  ["Hunter","Sting",[1,5,10,15,20],"Apply a known poison sting to a damaging ranged attack; starts at three uses/day and gains one use at each later listed level."],
  ["Hunter","Serpent Sting",[1],"A damaging ranged hit deals +1 immediately and 1 damage each round for hunter level rounds."],
  ["Hunter","Aspect of the Monkey",[3],"Persistent selectable aspect granting evasion in light or no armor."],
  ["Hunter","Tame Animal",[5],"Tame one animal of HD no greater than hunter level - 2 after the required Handle Animal check and bonding period."],
  ["Hunter","Hunter Companion",[5],"Tamed companion gains scaling HD, natural armor, Strength/Agility, tricks, and special abilities from Table 3-12."],
  ["Hunter","Aspect of the Hawk",[6],"Persistent selectable aspect granting +1 insight ranged damage per three hunter levels, maximum +5."],
  ["Hunter","Eagle Eye",[7],"Ranged weapon increments increase by 150%; +2 Spot, with distance penalties assessed per 20 feet."],
  ["Hunter","Aspect of the Beast",[9],"Persistent selectable aspect granting trackless movement and normal movement through natural undergrowth."],
  ["Hunter","Scorpid Sting",[10],"Fortitude negates 1d4 Strength and 1d4 Agility loss for hunter level rounds."],
  ["Hunter","Aspect of the Cheetah",[12],"Persistent selectable aspect granting +5-foot base speed per five hunter levels."],
  ["Hunter","Tame Magical Beast",[14],"May tame magical beasts with the normal method at -4 on the Handle Animal check."],
  ["Hunter","Aspect of the Pack",[15],"Persistent selectable aspect: an ally adjacent to the same enemy as the hunter counts as flanking it."],
  ["Hunter","Aspect of the Wilds",[18],"Persistent selectable aspect granting +4 insight on all saving throws."],
  ["Hunter","Viper Sting",[20],"Will negates inability to cast spells for one full round; no effect on non-spellcasters."],

  ["Paladin","Aura of Good",[1],"Good aura power equals paladin level."],
  ["Paladin","Detect Undead",[1],"Use detect undead at will as a spell-like ability."],
  ["Paladin","Holy Strike",[1,5,10,15,20],"Declare before a melee attack; on hit deal 1d6 + paladin level holy damage and count the weapon as good-aligned. Uses/day scale at listed levels."],
  ["Paladin","Divine Grace",[2],"Add Charisma modifier to all saving throws."],
  ["Paladin","Paladin Auras",[3,6,9,12,15,18],"Learn and gain daily activations of the aura listed in the class table; only one may be active at a time."],
  ["Paladin","Divine Health",[3],"Immune to disease, including magical and supernatural disease."],
  ["Paladin","Turn Undead",[4],"Turn undead 3 + Charisma modifier times/day as a priest three levels lower."],
  ["Paladin","Lay on Hands",[4],"Spend all remaining spell slots to heal living or harm undead for 5 hp per expended spell-slot level."],
  ["Paladin","Crusader Strike",[5],"Repeated holy strikes against one creature gain cumulative Charisma-based holy damage."],
  ["Paladin","Fist of Justice",[7],"Gain Bash as a bonus feat and may use it with slashing or piercing weapons."],

  ["Rogue","Backstab",[1,3,5,7,9,11,13,15,17,19],"Extra d6 precision damage at level 1 and every odd rogue level when the target is denied Agility to AC or flanked; ranged limit 30 feet; not multiplied on a critical."],
  ["Rogue","Trapfinding",[1],"May find traps above DC 20 and disarm magical traps; beating Disable Device DC by 10 allows bypass."],
  ["Rogue","Evasion",[2],"Successful Reflex save against a half-damage effect instead deals no damage in light or no armor."],
  ["Rogue","Rogue Special Ability",[3,6,9,12,15,18],"Choose Crippling Strike, Finishing Strike, Improved Evasion, Opportunist, Skill Mastery, Spell Stopper, Sprint, Stalk, or a feat."],
  ["Rogue","Trap Sense",[3,6,9,12,15,18],"Scaling bonus on Reflex saves and dodge AC against traps; prose grants +1 at level 3 despite its omission from the table."],
  ["Rogue","Uncanny Dodge",[4],"Retains Agility bonus to AC while flat-footed or attacked invisibly, but not while immobilized."],
  ["Rogue","Improved Uncanny Dodge",[8],"Cannot be flanked except by a rogue with at least four more rogue levels; compatible class levels stack."],

  ["Scout","Track",[1],"Gain Track as a bonus feat."],
  ["Scout","Nature Sense",[1],"+2 Knowledge (nature) and Survival."],
  ["Scout","Wild Healing",[2,6,10,14,18],"Use Survival to gather a wilderness remedy, then Heal to restore hit points; competence bonus scales at listed levels."],
  ["Scout","Woodland Stride",[3],"Move normally through natural undergrowth without damage or impairment."],
  ["Scout","Trackless Step",[4],"Leave no trail in natural surroundings unless choosing otherwise."],
  ["Scout","Uncanny Dodge",[4],"Retains Agility bonus to AC while flat-footed or attacked invisibly."],
  ["Scout","Trap Sense",[5,8,11,14,17,20],"Scaling bonus on Reflex saves and dodge AC against traps."],
  ["Scout","Locate Object",[6],"Use locate object once/day as a divine spell-like ability at scout caster level."],
  ["Scout","Improved Uncanny Dodge",[7],"Cannot be flanked except by a rogue with at least four more rogue levels; compatible class levels stack."],
  ["Scout","Swift Tracker",[8],"Track at normal speed without -5, or twice speed at -10 instead of -20."],
  ["Scout","Venom Immunity",[9],"Immune to organic poisons, but not mineral poison or poison gas."],
  ["Scout","Locate Creature",[11],"Use locate creature once/day as a divine spell-like ability at scout caster level."],
  ["Scout","Evasion",[12],"Successful Reflex save against a half-damage effect instead deals no damage in light or no armor."],
  ["Scout","Commune with Nature",[13],"Use commune with nature once/day as a divine spell-like ability at scout caster level."],
  ["Scout","Find the Path",[16],"Use find the path once/day as a divine spell-like ability at scout caster level."],
  ["Scout","Wind Walk",[20],"Use wind walk once/day as a divine spell-like ability at scout caster level."],

  ["Tinker","Tinker Bonus Feat",[1,5,10,15,20],"Choose a technology feat or eligible technological Exotic Weapon Proficiency; prerequisites apply."],
  ["Tinker","Packrat",[2],"Calculate carrying capacity as though Strength were 5 points higher."],
  ["Tinker","Scavenge",[2],"Search DC 15 + device Technology Score can substitute gathered parts for raw materials worth half tinker level x 50 gp."],
  ["Tinker","Cobble",[3,8,13,18],"Make hourly construction progress instead of weekly; completed device gains +5 Malfunction Rating and +1 per later operation."],
  ["Tinker","Bomb Bouncing",[4],"Double range increment when throwing grenade-like weapons."],
  ["Tinker","Evasion",[4],"Successful Reflex save against a half-damage effect instead deals no damage in light or no armor."],
  ["Tinker","Coolness Under Fire",[5,7,9,11,13,15,17,19],"Take 10 on construction, operation, or repair checks despite pressure; not attack rolls. Uses/day scale at listed levels."],
  ["Tinker","Energy Resistance",[6,12,16,20],"Choose acid, cold, electricity, fire, or sonic resistance 5 at each listed level; selections may stack."],
  ["Tinker","Improved Evasion",[14],"No damage on a successful Reflex save and half damage on failure, while not helpless."],
];

function idFor(kind, name) {
  return crypto.createHash("sha256").update(`warcraftrpg2e:${kind}:${name}`).digest("hex").slice(0, 16);
}

function provenance(spec, section = spec.name) {
  return {
    book: "World of Warcraft: The Roleplaying Game, Second Edition",
    file: "docs/World_of_Warcraft_2nd_Edition.pdf",
    pdfPages: spec.pdf,
    printedPages: spec.printed,
    section,
    verification: "text+render",
  };
}

function classDocument(spec) {
  const doc = JSON.parse(JSON.stringify(classBase));
  doc._id = idFor("class", spec.name);
  doc.name = spec.name;
  doc.system.identifiedName = spec.name;
  doc.img = spec.name === "Healer" || spec.name === "Paladin" ? "icons/svg/holy-shield.svg" : "icons/svg/sword.svg";
  doc.flags = { warcraftrpg2e: { source: provenance(spec) } };
  doc.system.hd = spec.hd;
  doc.system.bab = spec.bab;
  doc.system.savingThrows = {
    fort: { value: spec.saves[0] }, ref: { value: spec.saves[1] }, will: { value: spec.saves[2] },
  };
  doc.system.skillsPerLevel = spec.skills;
  for (const key of Object.keys(doc.system.classSkills)) doc.system.classSkills[key] = false;
  for (const key of spec.classSkills) doc.system.classSkills[key] = true;
  doc.system.description.value = `<p>${spec.description}</p><ul><li>d${spec.hd} Hit Die; ${spec.skills} + Intellect skill points per level.</li><li>${spec.proficiencies}</li></ul>`;
  doc.system.extraDescription.value = "<p>Level-granted features are supplied as separate linked class-feature records in this compendium.</p>";
  doc.system.source = `World of Warcraft RPG, 2nd Edition, pp. ${spec.printed[0]}-${spec.printed.at(-1)}`;
  doc.system.sneakAttackFormula = spec.backstab ? "ceil(@level/2)" : "0";
  doc.system.sneakAttackGroup = spec.backstab ? "rogue" : "none";
  if (spec.casting) {
    doc.system.hasSpellbook = true;
    doc.system.spellcastingType = spec.casting.type;
    doc.system.spellcastingAbility = spec.casting.ability;
    doc.system.spellcastingSpontaneus = true;
    doc.system.spellcastingPreparationMode = "repertoire";
    doc.system.repertoireSkill = "spl";
    doc.system.usesWarcraftSlotPool = true;
    doc.system.warcraftPoolKey = spec.casting.ability;
    doc.system.warcraftParentClass = spec.name.toLowerCase();
    doc.system.spellsPerLevel = spec.casting.slots;
    doc.system.halfCasterLevel = Boolean(spec.casting.half);
    doc.system.spellPointGroup = spec.name.toLowerCase();
    doc.system.spellbook = Array.from({ length: 10 }, (_, level) => ({ level, spells: [] }));
    doc.system.spellcastingDescription = "Learn eligible spells, prepare a persistent repertoire, and expend generic slots by spell level. A spell may use the lowest available higher-level slot. Eight hours of rest refills slots without erasing the repertoire.";
    if (spec.name === "Healer") {
      doc.system.classPaths = {
        enabled: true,
        default: "druid",
        choices: [
          { id: "druid", name: "Druid" },
          { id: "priest", name: "Priest" },
          { id: "shaman", name: "Shaman" },
        ],
      };
      doc.system.pathLevels = { druid: 0, priest: 0, shaman: 0 };
      doc.system.currentPath = "";
      doc.system.hasSpecialSlot = true;
      doc.system.specialSlotLevel0 = false;
    }
  }
  return doc;
}

function featureDocument([className, name, levels, description]) {
  const classSpec = classes.find((entry) => entry.name === className);
  const doc = JSON.parse(JSON.stringify(featureBase));
  doc._id = idFor("class-feature", `${className}:${name}`);
  doc.name = name;
  doc.system.identifiedName = name;
  doc.flags = { warcraftrpg2e: { source: provenance(classSpec, `${className}: ${name}`) } };
  doc.system.associations.classes = levels.map((level) => [className, level]);
  doc.system.description.value = `<p>${description}</p>`;
  doc.system.shortDescription = `<p>${description}</p>`;
  doc.system.source = `World of Warcraft RPG, 2nd Edition, pp. ${classSpec.printed[0]}-${classSpec.printed.at(-1)}`;
  doc.system.counterName = `feat.${className.toLowerCase().replace(/\s+/g, "-")}`;
  doc.system.uniqueId = `wc-${idFor("feature-uid", `${className}:${name}`).slice(0, 8)}-*`;
  doc.system.index.uniqueId = doc.system.uniqueId;
  doc.system.changes = [];
  if (className === "Hunter" && name === "Animal Empathy") doc.system.changes = [["2","skill","skill.han","classAbility"]];
  if (className === "Scout" && name === "Nature Sense") doc.system.changes = [["2","skill","skill.kna","classAbility"],["2","skill","skill.sur","classAbility"]];
  return doc;
}

for (const spec of classes) {
  const doc = classDocument(spec);
  fs.writeFileSync(path.join(packDir, `${spec.slug}-${doc._id}.json`), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

for (const feature of features) {
  const doc = featureDocument(feature);
  const slug = `${feature[0]}-${feature[1]}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  fs.writeFileSync(path.join(packDir, `${slug}-${doc._id}.json`), `${JSON.stringify(doc, null, 2)}\n`, "utf8");
}

const documents = fs.readdirSync(packDir)
  .filter((file) => file.endsWith(".json") && file !== ".index.json")
  .map((file) => ({ file, doc: JSON.parse(fs.readFileSync(path.join(packDir, file), "utf8")) }))
  .sort((a, b) => a.doc.name.localeCompare(b.doc.name) || a.doc.type.localeCompare(b.doc.type));
const index = documents.map(({ file, doc }) => ({ childKeyByCollection: {}, embeddedCollections: [], file, key: `!items!${doc._id}` }));
fs.writeFileSync(path.join(packDir, ".index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Generated ${classes.length} base classes and ${features.length} class-feature records; indexed ${documents.length} documents.`);
