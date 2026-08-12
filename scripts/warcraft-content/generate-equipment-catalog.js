const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const outputDir = path.join(root, "source", "warcraft-equipment");
const load = (directory) => fs.readdirSync(directory)
  .filter((file) => file.endsWith(".json") && file !== ".index.json")
  .map((file) => ({ file, document: JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")) }));
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const variants = (name) => {
  const values = [normalize(name)];
  if (name.includes(",")) {
    const [first, ...rest] = name.split(",");
    values.push(normalize(`${rest.join(" ")} ${first}`));
  }
  return values;
};
const idFor = (name) => crypto.createHash("sha256").update(`warcraftrpg2e:equipment:${name}`).digest("hex").slice(0, 16);
const slug = (name) => normalize(name).replace(/ /g, "-");

const categories = {
  weapon: {
    pages: [184,185,186],
    names: [
      "Gauntlet","Unarmed Strike","Dagger","Spiked Gauntlet","Light Mace","Sickle","Club","Heavy Mace","Morningstar","Shortspear","Longspear","Quarterstaff","Spear","Heavy Crossbow","Crossbow Bolts (10)","Light Crossbow","Dart","Javelin","Sling","Sling Bullets (10)","Throwing Axe","Handaxe","Kukri","Light Pick","Sap","Light Shield Bash","Short Sword","Battleaxe","Miniature Bayonet","Flail","Longsword","Heavy Pick","Scimitar","Heavy Shield Bash","Trident","Warblade","Warhammer","Bayonet","Falchion","Heavy Flail","Glaive","Greataxe","Greatclub","Greathammer","Greatsword","Halberd","Lance","Scythe","Longbow","Arrows (20)","Composite Longbow","Shortbow","Composite Shortbow","Orc Claws of Attack","Moonglaive","Dwarven Battle Hammer","Dwarven Tossing Hammer","Moon Sword","Bastard Sword","Dwarven Waraxe","Warglaive","Whip","Spiked Chain","Tauren Halberd","Two-Bladed Sword","Tauren Totem","Blunderbuss","Blunderbuss Shot (12)","Bolas","Hand Crossbow","Hand Crossbow Bolts (10)","Flintlock Pistol","Pistol Balls (10)","Long Rifle","Rifle Bullets (10)","Mortar","Net",
    ],
  },
  explosive: { pages: [186], names: ["Catapult Bomb","Emplaced Bomb","Grenade Bomb","Gunpowder Horn (2 lb.)","Gunpowder Keg (15 lb.)","Imbued Gunpowder Horn (2 lb.)","Refined Gunpowder Horn (2 lb.)","Refined Gunpowder Keg (15 lb.)","Mortar Shell"] },
  armor: { pages: [193], names: ["Padded Armor","Leather Armor","Studded Leather Armor","Chain Shirt","Hide Armor","Scale Mail","Chainmail","Breastplate","Splint Mail","Banded Mail","Half-Plate","Full Plate","Buckler","Light Wooden Shield","Light Steel Shield","Heavy Wooden Shield","Heavy Steel Shield","Tower Shield","Locked Gauntlet"] },
  adventuringGear: { pages: [199], names: ["Acid Flask","Alchemist's Fire Flask","Antitoxin Vial","Backpack","Barrel","Basket","Bedroll","Bell","Winter Blanket","Block and Tackle","Glass Bottle","Bucket","Caltrops","Candle","Canvas (1 sq. yd.)","Map or Scroll Case","Chain (10 ft.)","Chalk","Chest","Crowbar","Firewood (1 day)","Fishhook","Fishing Net","Flask","Flint and Steel","Grappling Hook","Hammer","Ink (1 oz.)","Ink Pen","Clay Jug","Ladder (10 ft.)","Common Lamp","Bull's-Eye Lantern","Hooded Lantern","Very Simple Lock","Average Lock","Good Lock","Amazing Lock","Manacles","Masterwork Manacles","Small Steel Mirror","Clay Mug","Oil Flask","Paper","Parchment","Liquid Phlogiston Vial","Miner's Pick","Clay Pitcher","Piton","Pole (10 ft.)","Iron Pot","Belt Pouch","Portable Ram","Trail Rations","Hemp Rope (50 ft.)","Silk Rope (50 ft.)","Spidersilk Rope (50 ft.)","Sack","Saddlebags","Sealing Wax","Sewing Needle","Signal Whistle","Signet Ring","Sledge","Smokestick","Soap","Spade or Shovel","Spyglass","Sunrod","Tanglefoot Bag","Tent","Thunderstone","Tindertwig","Torch","Vial","Waterskin","Whetstone"] },
  tools: { pages: [201], names: ["Alchemist's Lab","Artisan's Tools","Masterwork Artisan's Tools","Climber's Kit","Disguise Kit","Healer's Kit","Wooden Holy Symbol","Silver Holy Symbol","Hourglass","Magnifying Glass","Masterwork Tool","Common Musical Instrument","Masterwork Musical Instrument","Merchant's Scale","Spell Component Pouch","Spellbook","Thieves' Tools","Masterwork Thieves' Tools","Water Clock"] },
  clothing: { pages: [202], names: ["Artisan's Outfit","Cold Weather Outfit","Courtier's Outfit","Entertainer's Outfit","Explorer's Outfit","Noble's Outfit","Peasant's Outfit","Priest's Vestments","Royal Outfit","Scholar's Outfit","Traveler's Outfit"] },
  foodAndLodging: { pages: [202], names: ["Ale (gallon)","Ale (mug)","Banquet","Bread","Cheese","Good Inn Stay","Common Inn Stay","Poor Inn Stay","Good Meal","Common Meal","Poor Meal","Meat","Common Wine (pitcher)","Fine Wine (bottle)"] },
  mounts: { pages: [203], names: ["Medium Creature Barding","Large Creature Barding","Bit and Bridle","Cart","Donkey or Mule","Feed","Gryphon","Heavy Horse","Light Horse","Pony","Heavy Warhorse","Light Warhorse","Warpony","Nightsaber Panther","Exotic Military Saddle","Exotic Pack Saddle","Exotic Riding Saddle","Regular Military Saddle","Regular Pack Saddle","Regular Riding Saddle","Sled","Stabling","Wagon","Dire Wolf"] },
  transport: { pages: [203,204], names: ["Coach Cab","Galley","Keelboat","Longship","Messenger","Oar","Road or Gate Toll","Rowboat","Sailing Ship","Ship's Passage","Teleportation Service","Warship"] },
  buildings: { pages: [204], names: ["Simple House","Grand House","Mansion","Tower","Keep","Castle","Huge Castle","Moat with Bridge"] },
};

const explicitWeapons = {
  "Miniature Bayonet": [8,"1d4",20,2,null,1,"P or S","1h"], "Warblade": [20,"1d8",20,2,null,3,"S","1h"],
  "Bayonet": [15,"1d8",20,3,null,2,"P","2h"], "Greathammer": [40,"2d6",20,3,null,14,"B","2h"],
  "Orc Claws of Attack": [25,"1d6",18,2,null,2,"S","light"], "Moonglaive": [20,"1d6",19,2,20,3,"S","light"],
  "Dwarven Battle Hammer": [30,"1d10",20,3,null,9,"B","1h"], "Dwarven Tossing Hammer": [15,"1d6",20,3,20,4,"B","1h"],
  "Moon Sword": [100,"2d4",18,2,null,4,"S","1h"], "Warglaive": [125,"2d4",20,3,null,3,"S","1h"],
  "Tauren Halberd": [50,"2d6",20,3,null,25,"P or S","2h"], "Tauren Totem": [20,"2d8",20,2,null,50,"B","2h"],
  "Blunderbuss": [250,"special",20,2,null,10,"P","ranged"], "Mortar": [75,"special",20,2,40,20,"special","ranged"],
  "Short Sword": [10,"1d6",19,2,null,2,"P","light","martial"],
  "Composite Longbow": [100,"1d8",20,3,110,3,"P","ranged","martial"],
  "Composite Shortbow": [75,"1d6",20,3,70,2,"P","ranged","martial"],
  "Light Shield Bash": [0,"1d3",20,2,null,0,"B","light","martial"],
  "Heavy Shield Bash": [0,"1d4",20,2,null,0,"B","1h","martial"],
};

// Exact values for table rows whose names do not have a one-to-one legacy SRD
// document. Prices are normalized to gp and negligible/unspecified weights to 0;
// the original printed value is retained in tableValue for display and auditing.
const exactTableData = {
  "Arrows (20)": [1,3,"1 gp; 3 lb."], "Blunderbuss Shot (12)": [10,3,"10 gp; 3 lb."],
  "Crossbow Bolts (10)": [1,1,"1 gp; 1 lb."], "Hand Crossbow Bolts (10)": [1,1,"1 gp; 1 lb."],
  "Pistol Balls (10)": [5,3,"5 gp; 3 lb."], "Rifle Bullets (10)": [6,3,"6 gp; 3 lb."],
  "Sling Bullets (10)": [0.1,5,"1 sp; 5 lb."],

  "Catapult Bomb": [150,10,"150 gp; 10 lb.", { malfunctionRating: 1, damage: "8d6 fire", blastRadius: 15, rangeIncrement: 5 }],
  "Emplaced Bomb": [80,5,"80 gp; 5 lb.", { malfunctionRating: 1, damage: "4d6 fire", blastRadius: 5, rangeIncrement: null }],
  "Grenade Bomb": [40,1,"40 gp; 1 lb.", { malfunctionRating: 1, damage: "2d6 fire", blastRadius: 10, rangeIncrement: 10 }],
  "Gunpowder Keg (15 lb.)": [250,20,"250 gp; 20 lb.", { malfunctionRating: 1 }],
  "Imbued Gunpowder Horn (2 lb.)": [1300,2,"1,300 gp; 2 lb.", { malfunctionRating: 2 }],
  "Mortar Shell": [25,1,"25 gp; 1 lb.", { malfunctionRating: 1, damage: "3d6 fire", blastRadius: 5, rangeIncrement: null, launchedOnly: true }],
  "Refined Gunpowder Horn (2 lb.)": [100,2,"100 gp; 2 lb.", { malfunctionRating: 1 }],
  "Refined Gunpowder Keg (15 lb.)": [1400,20,"1,400 gp; 20 lb.", { malfunctionRating: 1 }],

  "Acid Flask": [10,0,"10 gp; negligible weight"], "Alchemist's Fire Flask": [20,0,"20 gp; negligible weight"],
  "Antitoxin Vial": [50,0,"50 gp; negligible weight"], Backpack: [2,2,"2 gp; 2 lb.; holds 1 cu. ft."],
  "Bull's-Eye Lantern": [12,3,"12 gp; 3 lb."], "Canvas (1 sq. yd.)": [0.1,1,"1 sp; 1 lb."],
  "Clay Mug": [0.02,0,"2 cp; negligible weight; holds 1 pint"], "Firewood (1 day)": [0.01,20,"1 cp; 20 lb."],
  "Fishing Net": [4,5,"4 gp; 5 lb."], "Glass Bottle": [2,0,"2 gp; negligible weight; holds 1 1/2 pints"],
  "Hemp Rope (50 ft.)": [1,10,"1 gp; 10 lb."], "Ink (1 oz.)": [8,0,"8 gp; negligible weight"],
  "Ink Pen": [0.1,0,"1 sp; negligible weight"], "Ladder (10 ft.)": [0.05,20,"5 cp; 20 lb."],
  "Liquid Phlogiston Vial": [20,0.25,"20 gp; 1/4 lb."], "Masterwork Manacles": [50,2,"50 gp; 2 lb."],
  "Oil Flask": [0.1,1,"1 sp; 1 lb."], "Pole (10 ft.)": [0.2,8,"2 sp; 8 lb."],
  "Silk Rope (50 ft.)": [10,5,"10 gp; 5 lb."], "Spidersilk Rope (50 ft.)": [25,3,"25 gp; 3 lb."],
  Vial: [1,0,"1 gp; negligible weight; holds 1 ounce"], "Locked Gauntlet": [8,5,"8 gp; +5 lb."],

  "Priest's Vestments": [5,6,"5 gp; 6 lb."],
  "Ale (gallon)": [0.2,8,"2 sp; 8 lb."], "Ale (mug)": [0.04,1,"4 cp; 1 lb."],
  Banquet: [10,0,"10 gp per person"], Bread: [0.02,0.5,"2 cp; 1/2 lb."], Cheese: [0.1,0.5,"1 sp; 1/2 lb."],
  "Common Inn Stay": [0.5,0,"5 sp per night"], "Common Meal": [0.3,0,"3 sp per day"],
  "Common Wine (pitcher)": [0.2,6,"2 sp; 6 lb."], "Fine Wine (bottle)": [10,1.5,"10 gp; 1 1/2 lb."],
  "Good Inn Stay": [2,0,"2 gp per night"], "Good Meal": [0.5,0,"5 sp per day"], Meat: [0.3,0.5,"3 sp; 1/2 lb."],
  "Poor Inn Stay": [0.2,0,"2 sp per night"], "Poor Meal": [0.1,0,"1 sp per day"],

  Cart: [15,200,"15 gp; 200 lb."], "Dire Wolf": [600,0,"600 gp"],
  "Exotic Military Saddle": [60,40,"60 gp; 40 lb."], "Exotic Pack Saddle": [15,20,"15 gp; 20 lb."],
  "Exotic Riding Saddle": [30,30,"30 gp; 30 lb."], Gryphon: [5000,0,"5,000 gp"],
  "Nightsaber Panther": [600,0,"600 gp"], "Regular Military Saddle": [20,30,"20 gp; 30 lb."],
  "Regular Pack Saddle": [5,15,"5 gp; 15 lb."], "Regular Riding Saddle": [10,25,"10 gp; 25 lb."],
  Sled: [20,300,"20 gp; 300 lb."], Wagon: [35,400,"35 gp; 400 lb."],

  "Masterwork Artisan's Tools": [55,5,"55 gp; 5 lb."], "Masterwork Musical Instrument": [100,3,"100 gp; 3 lb."],
  "Masterwork Thieves' Tools": [100,2,"100 gp; 2 lb."], "Masterwork Tool": [50,0,"+50 gp; negligible weight"],

  "Coach Cab": [0.03,0,"3 cp per mile"], Galley: [30000,0,"30,000 gp"], Keelboat: [3000,0,"3,000 gp"],
  Longship: [10000,0,"10,000 gp"], Messenger: [0.02,0,"2 cp per mile"], Oar: [2,0,"2 gp"],
  "Road or Gate Toll": [0.01,0,"1 cp"], Rowboat: [50,0,"50 gp"], "Sailing Ship": [10000,0,"10,000 gp"],
  "Ship's Passage": [0.1,0,"1 sp per mile"], "Teleportation Service": [0,0,"Varies"], Warship: [25000,0,"25,000 gp"],

  "Simple House": [1000,0,"1,000 gp"], "Grand House": [5000,0,"5,000 gp"], Mansion: [100000,0,"100,000 gp"],
  Tower: [50000,0,"50,000 gp"], Keep: [150000,0,"150,000 gp"], Castle: [500000,0,"500,000 gp"],
  "Huge Castle": [1000000,0,"1,000,000 gp"], "Moat with Bridge": [50000,0,"50,000 gp"],
};
const ammunitionPackages = new Map([
  ["Arrows (20)", 20], ["Blunderbuss Shot (12)", 12], ["Crossbow Bolts (10)", 10],
  ["Hand Crossbow Bolts (10)", 10], ["Pistol Balls (10)", 10], ["Rifle Bullets (10)", 10],
  ["Sling Bullets (10)", 10], ["Mortar Shell", 1],
]);

const sourceDirectories = ["weapons-and-ammo","armors-and-shields","items"].map((name) => path.join(root, "source", name));
const sourceDocuments = sourceDirectories.flatMap(load).map(({ document }) => document);
const sourceByName = new Map();
for (const document of sourceDocuments) for (const key of variants(document.name)) if (!sourceByName.has(key)) sourceByName.set(key, document);
const retained = load(outputDir);
for (const { file, document } of retained) if (document.flags?.warcraftrpg2e?.catalog?.generated) fs.unlinkSync(path.join(outputDir, file));
const current = load(outputDir);
const currentByName = new Map(current.map((entry) => [normalize(entry.document.name), entry]));
const weaponBase = currentByName.get(normalize("Longsword")).document;
const lootBase = currentByName.get(normalize("Spell Component Pouch")).document;

const entries = [];
for (const [category, data] of Object.entries(categories)) for (const name of data.names) entries.push({ name, category, pages: data.pages });
const uniqueEntries = [...new Map(entries.map((entry) => [normalize(entry.name), entry])).values()];
let inherited = 0;
let manual = 0;
for (const entry of uniqueEntries) {
  const currentEntry = currentByName.get(normalize(entry.name));
  if (currentEntry) {
    currentEntry.document.flags.warcraftrpg2e.catalog = { completeTableEntry: true, generated: false, category: entry.category };
    fs.writeFileSync(path.join(outputDir, currentEntry.file), `${JSON.stringify(currentEntry.document, null, 2)}\n`);
    continue;
  }
  const source = variants(entry.name).map((key) => sourceByName.get(key)).find(Boolean);
  const explicit = explicitWeapons[entry.name];
  const tableData = exactTableData[entry.name];
  const document = JSON.parse(JSON.stringify(source || (explicit ? weaponBase : lootBase)));
  document._id = idFor(entry.name);
  document.name = entry.name;
  document.system.identifiedName = entry.name;
  if (source) inherited += 1; else manual += 1;
  if (explicit) {
    const [price,damage,critRange,critMult,range,weight,damageType,subtype,weaponType = "exotic"] = explicit;
    document.type = "weapon";
    Object.assign(document.system, { price, weight, weaponType, weaponSubtype: subtype, baseWeaponType: entry.name });
    Object.assign(document.system.weaponData, { damageRoll: damage, critRange: String(critRange), critMult: String(critMult), range, damageType, size: "med" });
  } else if (!source) {
    document.type = "loot";
    if (!tableData) throw new Error(`Missing exact table data for ${entry.name}`);
    const [price, weight, tableValue] = tableData;
    document.system.price = price;
    document.system.weight = weight;
    document.system.subType = ammunitionPackages.has(entry.name) ? "ammo" : "gear";
    document.system.description.value = `<p><strong>Printed table value:</strong> ${tableValue}.</p>`;
  }
  document.system.source = `World of Warcraft RPG, 2nd Edition, p. ${entry.pages.map((page) => page - 2).join("-")}`;
  document.flags = {
    ...(document.flags || {}),
    warcraftrpg2e: {
      source: { book: "World of Warcraft: The Roleplaying Game, Second Edition", file: "docs/World_of_Warcraft_2nd_Edition.pdf", pdfPages: entry.pages, printedPages: entry.pages.map((page) => page - 2), section: entry.name, verification: "table-extraction" },
      catalog: {
        completeTableEntry: true, generated: true, category: entry.category,
        status: source || explicit ? "structured" : "structured-table-data",
        ...(tableData ? { tableValue: tableData[2] } : {}),
      },
      ...(tableData?.[3] ? { rules: tableData[3] } : {}),
    },
  };
  if (ammunitionPackages.has(entry.name)) {
    document.flags.warcraftrpg2e.rules = {
      ...(document.flags.warcraftrpg2e.rules || {}),
      ammunition: true,
      unitsPerPackage: ammunitionPackages.get(entry.name),
    };
  }
  if (/Gunpowder .*\((?:2|15) lb\.\)$/.test(entry.name)) {
    document.flags.warcraftrpg2e.rules = {
      ...(document.flags.warcraftrpg2e.rules || {}),
      gunpowderOuncesPerPackage: entry.name.includes("15 lb.") ? 240 : 32,
    };
  }
  fs.writeFileSync(path.join(outputDir, `${slug(entry.name)}-${document._id}.json`), `${JSON.stringify(document, null, 2)}\n`);
}

const materialBase = JSON.parse(fs.readFileSync(path.join(root, "source", "materials", "adamantine-ajfpffycxeiku74d.json"), "utf8"));
const materials = [
  ["Arcanite",193,15,30,"Metal only; always masterwork. Weapons gain +1 damage and piercing/slashing threat range expands by 1. Armor grants 10/20/30% fortification by weight; a heavy shield adds 5%. Steel items gain one-quarter more hit points."],
  ["Dragonhide",193,10,20,"Masterwork dragon-hide armor and shields have 0% arcane spell failure. Cost is 25 times normal, or 20 times when the hide is supplied; crafting takes three times as long and Craft DC increases by 10."],
  ["Mithril",194,15,30,"Metal items weigh half normal. Armor counts one category lighter, reduces spell failure by 10 points, raises maximum Agility by 2, and reduces armor check penalty by 3; always masterwork."],
  ["Thorium",194,25,40,"Metal items weigh twice normal and steel items have double hit points. Weapons require their exotic proficiency and improve Strength damage scaling. Armor gains +2 AC and 3/6/9 adamantine DR, counts one category heavier, reduces maximum Agility by 2, and doubles check penalty and spell failure; always masterwork."],
];
const materialRules = {
  Arcanite: {
    allowedItems: "Metal weapons, armor, shields, and ammunition",
    costModifiersGp: { ammunition: 100, lightArmor: 6000, mediumArmor: 12000, heavyArmor: 18000, shield: 4000, weapon: 5000 },
    weightMultiplier: 1, hitPointMultiplierForSteel: 1.25, masterworkIncluded: true,
    weapon: { damageEnhancement: 1, piercingOrSlashingThreatRangeIncrease: 1 },
    armorFortificationPercent: { light: 10, medium: 20, heavy: 30, heavyShield: 5 },
    sourceNote: "The printed heavy-armor cost appears as +18,0000 gp; this record uses +18,000 gp and logs the defect in ERRATA.md.",
  },
  Dragonhide: {
    allowedItems: "Armor and shields produced from a sufficiently large dragon",
    priceMultiplier: 25, suppliedHidePriceMultiplier: 20, craftingTimeMultiplier: 3, craftDcModifier: 10,
    weightMultiplier: 1, masterworkIncluded: true, arcaneSpellFailure: 0,
  },
  Mithril: {
    allowedItems: "Items made primarily of metal",
    costModifiersGp: { lightArmor: 1000, mediumArmor: 4000, heavyArmor: 9000, shield: 1000, otherPerPound: 500 },
    weightMultiplier: 0.5, masterworkIncluded: true,
    armor: { categoryStepsLighter: 1, minimumCategory: "light", spellFailureModifier: -10, maxAgilityModifier: 2, armorCheckPenaltyModifier: 3 },
  },
  Thorium: {
    allowedItems: "Items made primarily of metal",
    costModifiersGp: { lightArmor: 12000, mediumArmor: 24000, heavyArmor: 36000, weapon: 10000 },
    weightMultiplier: 2, hitPointMultiplierForSteel: 2, masterworkIncluded: true,
    weapon: { requiresExoticProficiency: true, strengthDamageMultiplierOneHanded: 1.5, strengthDamageMultiplierTwoHanded: 2 },
    armor: {
      acEnhancement: 2, damageReduction: { light: "3/adamantine", medium: "6/adamantine", heavy: "9/adamantine" },
      categoryStepsHeavier: 1, maximumCategory: "heavy", maxAgilityModifier: -2,
      armorCheckPenaltyMultiplier: 2, spellFailureMultiplier: 2,
    },
  },
};
for (const [name, printedPage, hardness, hpPerInch, description] of materials) {
  const document = JSON.parse(JSON.stringify(materialBase));
  document._id = idFor(name); document.name = name; document.system.identifiedName = name;
  document.system.description.value = `<p>${description}</p>`; document.system.hardness = String(hardness); document.system.hpPerInch = String(hpPerInch);
  document.system.uniqueId = `wc-material-${slug(name)}`;
  document.system.index = { ...(document.system.index || {}), uniqueId: `wc-material-${slug(name)}` };
  document.system.isAdamantineEquivalent = false;
  document.system.source = `World of Warcraft RPG, 2nd Edition, p. ${printedPage}`;
  document.flags = { warcraftrpg2e: { source: { book: "World of Warcraft: The Roleplaying Game, Second Edition", file: "docs/World_of_Warcraft_2nd_Edition.pdf", pdfPages: [printedPage + 2], printedPages: [printedPage], section: name, verification: "text+render" }, catalog: { completeTableEntry: true, generated: true, category: "material", status: "structured-summary" }, rules: materialRules[name] } };
  fs.writeFileSync(path.join(outputDir, `${slug(name)}-${document._id}.json`), `${JSON.stringify(document, null, 2)}\n`);
}

const equipmentRules = {
  "Flintlock Pistol": { ammunition: "Pistol Balls (10)", capacity: 1, gunpowderPerShotOunces: 1, reload: "standard action", reloadProvokes: true, clearMalfunction: "usually a full-round action", firingHands: 1, loadingHands: 2, malfunctionRating: 1 },
  "Long Rifle": { ammunition: "Rifle Bullets (10)", capacity: 1, gunpowderPerShotOunces: 1, reload: "standard action", reloadProvokes: true, clearMalfunction: "usually a full-round action", firingHands: 2, loadingHands: 2, oneHandedAttackPenalty: -4, malfunctionRating: 1 },
  Blunderbuss: { ammunition: "Blunderbuss Shot (12)", capacity: 1, gunpowderPerShotOunces: 1, reload: "full-round action", reloadProvokes: true, clearMalfunction: "usually a full-round action", firingHands: 2, malfunctionRating: 1, area: "20-foot cone", damage: "3d6 piercing", save: "Reflex DC 15 half", proficiencyRequired: false },
  Mortar: { ammunition: "Mortar Shell", capacity: 1, gunpowderPerShotOunces: 4, reload: "full-round action", reloadProvokes: true, clearMalfunction: "usually a full-round action", firingHands: 2, malfunctionRating: 1, minimumRangeIncrements: 1, attackIgnoresCoverUnlessProtectedFromAbove: true },
  Moonglaive: { thrown: true, rangeIncrement: 20 },
  "Dwarven Tossing Hammer": { thrown: true, rangeIncrement: 20 },
  "Tauren Halberd": { reach: true },
  "Light Shield Bash": { linkedArmor: "Light Wooden Shield or Light Steel Shield" },
  "Heavy Shield Bash": { linkedArmor: "Heavy Wooden Shield or Heavy Steel Shield" },
};

const generatedDocuments = load(outputDir);
const generatedByName = new Map(generatedDocuments.map((entry) => [entry.document.name, entry.document]));
for (const { file, document } of generatedDocuments) {
  const rules = equipmentRules[document.name];
  const packageUnits = ammunitionPackages.get(document.name);
  const powderOunces = /gunpowder/i.test(document.name) ? (/(?:keg|15 lb\.)/i.test(document.name) ? 240 : 32) : 0;
  if (!rules && !packageUnits && !powderOunces) continue;
  document.flags.warcraftrpg2e.rules = {
    ...(document.flags.warcraftrpg2e.rules || {}),
    ...(packageUnits ? { ammunition: true, unitsPerPackage: packageUnits } : {}),
    ...(powderOunces ? { gunpowderOuncesPerPackage: powderOunces } : {}),
    ...(rules || {}),
  };
  if (document.type === "loot" && packageUnits) document.system.subType = "ammo";
  if (rules?.ammunition) {
    const ammunition = generatedByName.get(rules.ammunition);
    if (!ammunition) throw new Error(`Missing ammunition record ${rules.ammunition} for ${document.name}`);
    document.flags.warcraftrpg2e.rules.ammunitionLink = {
      pack: "warcraftrpg2e.warcraft-equipment", id: ammunition._id,
    };
  }
  document.system.properties = document.system.properties || {};
  if (rules?.reach) document.system.properties.rch = true;
  if (rules?.thrown) document.system.properties.thr = true;
  if (document.name === "Blunderbuss") {
    Object.assign(document.system.weaponData, { damageRoll: "3d6", damageType: "piercing", range: 20 });
    document.system.effectNotes = "20-foot cone; Reflex DC 15 half; no attack roll or proficiency required.";
  }
  if (document.name === "Mortar") {
    Object.assign(document.system.weaponData, { damageRoll: "3d6", damageType: "fire", range: 40 });
    document.system.effectNotes = "5-foot blast radius; cannot fire within one range increment; ignores cover that does not protect from above.";
  }
  fs.writeFileSync(path.join(outputDir, file), `${JSON.stringify(document, null, 2)}\n`);
}

const documents = load(outputDir).sort((a,b) => a.document.name.localeCompare(b.document.name) || a.document.type.localeCompare(b.document.type));
const index = documents.map(({ file, document }) => ({ childKeyByCollection: {}, embeddedCollections: [], file, key: `!items!${document._id}` }));
fs.writeFileSync(path.join(outputDir, ".index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Indexed ${uniqueEntries.length} equipment entries plus 4 materials (${inherited} inherited, ${manual} newly catalogued).`);
