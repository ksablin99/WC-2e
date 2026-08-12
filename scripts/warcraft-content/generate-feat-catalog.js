const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const outputDir = path.join(root, "source", "warcraft-feats");
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "warcraft-feat-catalog.json"), "utf8"));
fs.mkdirSync(outputDir, { recursive: true });

function documentsIn(directory) {
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith(".json") && file !== ".index.json")
    .map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")));
}
function normalized(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function idFor(name) { return crypto.createHash("sha256").update(`warcraftrpg2e:feat:${name}`).digest("hex").slice(0, 16); }
function slug(name) { return normalized(name).replace(/ /g, "-"); }

const sourceFeats = documentsIn(path.join(root, "source", "feats"));
const byName = new Map(sourceFeats.map((document) => [normalized(document.name), document]));
const base = byName.get(normalized("Power Attack"));
for (const file of fs.readdirSync(outputDir)) {
  if (file.endsWith(".json")) fs.unlinkSync(path.join(outputDir, file));
}

const categoryTypes = {
  "General": "feat", "Item Creation": "itemCreation", "Metamagic": "metamagic",
  "Shout": "feat", "Technology": "feat", "Special": "feat",
};
const fixes = {
  "Thunderous Blow": "Strength 15, Bash, Power Attack, base attack bonus +4.",
};
const warriorBonus = new Set([
  "Bash","Battle Language","Battle Shout","Blind-Fight","Bloodletter","Careful Strike","Challenging Shout","Cleave","Close Shot","Combat Expertise","Combat Reflexes","Counterattack","Defend","Deflect Arrows","Demoralizing Shout","Dodge","Exotic Weapon Proficiency","Expert Rider","Far Shot","Furious Charge","Great Cleave","Greater Two-Weapon Fighting","Greater Weapon Focus","Greater Weapon Specialization","Improved Bull Rush","Improved Critical","Improved Disarm","Improved Feint","Improved Grapple","Improved Overrun","Improved Precise Shot","Improved Sunder","Improved Trip","Improved Two-Weapon Fighting","Improved Unarmed Strike","Intimidating Shout","Lightning Reload","Manyshot","Mobility","Mounted Archery","Mounted Combat","Pistol Whip","Point Blank Shot","Power Attack","Precise Shot","Pulverize","Punishing Blow","Quick Draw","Rapid Reload","Rapid Shot","Reckless Attack","Ride Bareback","Ride-By Attack","Shot on the Run","Snatch Arrows","Sniper Shot","Spirited Charge","Spring Attack","Storm Bolt","Stunning Fist","Thunderous Blow","Trample","Trick Shot","Two-Weapon Defense","Two-Weapon Fighting","War Stomp","Weapon Finesse","Weapon Focus","Weapon Specialization","Whirlwind Attack",
]);
const repeatable = new Set([
  "Exotic Weapon Proficiency","Greater Spell Focus","Greater Weapon Focus","Greater Weapon Specialization","Martial Weapon Proficiency","Mighty Lungs","Punishing Blow","Skill Focus","Skilled","Spell Focus","Vehicle Proficiency","Weapon Focus","Weapon Specialization",
]);
const shoutRules = {
  "Battle Shout": { activation: "free action; once per round", usesSharedPool: true, radius: 30, targets: "self and allies", duration: "half character level rounds (minimum 1)", effect: "+2 morale bonus on damage rolls" },
  "Challenging Shout": { activation: "free action; once per round", usesSharedPool: true, radius: "adjacent", targets: "opponents", duration: "half character level rounds (minimum 1)", save: "Will DC 10 + half character level + Charisma modifier", effect: "failed targets cannot make melee attacks against the shouter's allies" },
  "Collective Fury": { activation: "on entering rage", usesSharedPool: false, radius: 30, targets: "allies already in the area", duration: "while the user rages and allies remain in range", effect: "qualifying raging allies gain Intimidating Shout" },
  "Demoralizing Shout": { activation: "free action; once per round", usesSharedPool: true, radius: 30, targets: "opponents", duration: "half character level rounds (minimum 1)", effect: "-2 morale penalty on damage rolls" },
  "Inner Rage": { activation: "on entering rage", usesSharedPool: false, effect: "use one shout without spending a shared use; its duration is halved" },
  "Intimidating Shout": { activation: "free action; once per round", usesSharedPool: true, radius: 30, targets: "opponents", duration: "half character level rounds (minimum 1)", save: "Will DC 10 + half character level + Charisma modifier (+2 with 5 Intimidate ranks)", effect: "failed targets are shaken; fear effect", heroPointSpecial: "failed targets are panicked for 1d6 rounds" },
  "Triumphant Yell": { activation: "immediately after dropping a foe in melee", usesSharedPool: false, effect: "use one shout without spending a shared use; its duration is halved" },
};
const commonShoutRules = {
  descriptors: ["extraordinary", "sonic", "mind-affecting"],
  sharedUses: "daily maximum equals the number of distinct shout feats, plus Mighty Lungs bonuses",
  defaultRadius: 30,
  defaultDuration: "half character level rounds (minimum 1)",
  activation: "free action; at most once per round",
  heroPointGeneral: "one additional daily use; double range and duration where appropriate",
  generalSource: { printedPage: 137, pdfPage: 139, section: "Shout Feats" },
};
let inherited = 0;
for (const entry of catalog) {
  const source = byName.get(normalized(entry.name));
  const document = JSON.parse(JSON.stringify(source || base));
  document._id = idFor(entry.name);
  document.name = entry.name;
  document.img = source?.img || "icons/svg/book.svg";
  document.system.identifiedName = entry.name;
  document.system.featType = categoryTypes[entry.category] || "feat";
  document.system.originId = document._id;
  document.system.originPack = "warcraftrpg2e.warcraft-feats";
  document.system.uniqueId = `wc-feat-${document._id.slice(0, 8)}`;
  document.system.index.uniqueId = document.system.uniqueId;
  const prerequisite = fixes[entry.name] || entry.prerequisite;
  if (!source) {
    document.system.changes = [];
    document.system.combatChanges = [];
    document.system.contextNotes = [];
    document.system.conditionals = [];
    document.system.specialActions = [];
    document.system.activateActions = [];
    document.system.deactivateActions = [];
    document.system.damage.parts = [];
    document.system.attack.parts = [];
    document.system.description.value = [
      `<p><strong>Category:</strong> ${entry.category}.</p>`,
      prerequisite ? `<p><strong>Prerequisites:</strong> ${prerequisite}</p>` : "",
      `<p>This catalogue record identifies the feat and its requirements. Resolve its complete benefit from the private core rulebook (printed p. ${entry.printedPages.join(", ")}) until a verified automation record replaces this note.</p>`,
    ].join("");
    document.system.shortDescription = `<p>${entry.category} feat${prerequisite ? `; requires ${prerequisite}` : ""}.</p>`;
  } else {
    inherited += 1;
  }
  document.system.source = `World of Warcraft RPG, 2nd Edition, p. ${entry.printedPages.join(", ")}`;
  if (entry.category === "Shout") {
    const rules = shoutRules[entry.name];
    if (!rules) throw new Error(`Missing shout rule metadata for ${entry.name}`);
    document.system.range = {
      value: typeof rules.radius === "number" ? rules.radius : null,
      units: typeof rules.radius === "number" ? "ft" : "",
      long: null,
    };
    document.system.description.value = [
      `<p><strong>Shout:</strong> ${rules.effect}.</p>`,
      `<p><strong>Use:</strong> ${rules.activation}. ${rules.targets ? `Targets ${rules.targets}. ` : ""}${rules.radius ? `Range ${rules.radius === "adjacent" ? "adjacent creatures" : `${rules.radius}-foot radius`}. ` : ""}${rules.duration ? `Duration ${rules.duration}.` : ""}</p>`,
      rules.save ? `<p><strong>Save:</strong> ${rules.save}.</p>` : "",
      `<p><strong>Hero Point (general shout rule, printed p. 137):</strong> ${commonShoutRules.heroPointGeneral}.</p>`,
      rules.heroPointSpecial ? `<p><strong>Hero Point (this feat):</strong> ${rules.heroPointSpecial}.</p>` : "",
      `<p>The actor's Shout Uses resource tracks the shared daily pool. The system resolves scene range, Will saves, timed conditions, and damage modifiers; hearing, immunity, and exceptional positioning remain GM-adjudicated.</p>`,
    ].join("");
    document.system.shortDescription = `<p>${rules.effect}.</p>`;
  }
  document.flags = {
    ...(document.flags || {}),
    warcraftrpg2e: {
      source: {
        book: "World of Warcraft: The Roleplaying Game, Second Edition",
        file: "docs/World_of_Warcraft_2nd_Edition.pdf",
        pdfPages: entry.pdfPages,
        printedPages: entry.printedPages,
        section: entry.name,
        verification: "text+catalogue-table",
      },
      feat: {
        category: entry.category,
        prerequisite,
        warriorBonus: warriorBonus.has(entry.name),
        tinkerBonus: entry.category === "Technology",
        repeatable: repeatable.has(entry.name),
        status: entry.category === "Shout"
          ? (shoutRules[entry.name].usesSharedPool ? "structured-automated-effect" : "structured-trigger-manual")
          : (source ? "srd-mechanics-with-warcraft-metadata" : "manual-effect-pending-verification"),
        ...(entry.category === "Shout" ? { rules: { ...commonShoutRules, ...shoutRules[entry.name] } } : {}),
      },
    },
  };
  fs.writeFileSync(path.join(outputDir, `${slug(entry.name)}-${document._id}.json`), `${JSON.stringify(document, null, 2)}\n`);
}

const documents = fs.readdirSync(outputDir)
  .filter((file) => file.endsWith(".json") && file !== ".index.json")
  .map((file) => ({ file, document: JSON.parse(fs.readFileSync(path.join(outputDir, file), "utf8")) }))
  .sort((a, b) => a.document.name.localeCompare(b.document.name));
const index = documents.map(({ file, document }) => ({
  childKeyByCollection: {}, embeddedCollections: [], file, key: `!items!${document._id}`,
}));
fs.writeFileSync(path.join(outputDir, ".index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Generated ${documents.length} Warcraft feat records (${inherited} inherited SRD mechanics).`);
