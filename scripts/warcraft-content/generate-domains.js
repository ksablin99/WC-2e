const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const outputDir = path.join(root, "source", "warcraft-spells");
const sourceDir = path.join(root, "source", "spell-school-domain");
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "warcraft-spell-catalog.json"), "utf8"));
const readDocs = (directory) => fs.readdirSync(directory).filter((file) => file.endsWith(".json") && file !== ".index.json")
  .map((file) => ({ file, document: JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")) }));
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const idFor = (name) => crypto.createHash("sha256").update(`warcraftrpg2e:domain:${name}`).digest("hex").slice(0, 16);
const sourceDomains = new Map(readDocs(sourceDir).filter(({ document }) => document.system?.spellSpecialization?.isDomain)
  .map(({ document }) => [normalize(document.name), document]));
const domainBase = sourceDomains.get("animal domain");
const spellDocs = readDocs(outputDir).filter(({ document }) => document.type === "spell");
const spellsByName = new Map(spellDocs.map(({ document }) => [normalize(document.name), document]));

for (const { file, document } of readDocs(outputDir)) {
  if (document.flags?.warcraftrpg2e?.domain?.generated) fs.unlinkSync(path.join(outputDir, file));
}

const powerSummaries = {
  Animal: "Lesser: speak with animals once/day. Greater: path level + Charisma wild empathy, including magical beasts of Intellect 1-2 at -4.",
  Death: "Lesser: death touch once/day using 1d6 per priest level against current hp. Greater: overwhelming evil aura; controlled undead within 60 feet gain +4 turn resistance.",
  Destruction: "Lesser: +1 caster level for domain spells. Greater: once/day imbue a weapon; its first hit explodes for 1d6 per path level in 20 feet, Reflex DC 20 half, then destroys the weapon.",
  Elements: "Lesser: +1 caster level for domain spells. Greater: once/day energy-resistance aura, radius based on Charisma, resistance Spirit modifier + half path level, lasting half path level rounds.",
  Healing: "Lesser: +1 caster level for domain spells. Greater: cast a prepared cure/healing spell as a free out-of-turn action using a slot one level higher, 1 + Spirit modifier times/day.",
  Protection: "Lesser: +1 caster level for domain spells. Greater: once/day aura gives allies a Spirit-modifier save bonus and equal physical DR for half path level rounds.",
  Spirits: "Lesser: +1 caster level for domain spells. Greater: once/day gain path level Spot (max +20) and tenfold normal vision range for 3 + Spirit modifier rounds.",
  War: "Lesser: favored-weapon proficiency and Weapon Focus. Greater: once/day empower that weapon with Spirit modifier to attack and damage for path level rounds; extra uses accrue by path level.",
  Wild: "Lesser: +10-foot speed in animal form. Greater: once/day natural weapons gain Spirit modifier to attack/damage and count as magical for half druid level rounds.",
};

const domains = [...new Set(catalog.flatMap((entry) => entry.assignments)
  .filter((assignment) => assignment.kind === "domain")
  .map((assignment) => assignment.list.replace(/ Domain$/, "")))].sort();

for (const name of domains) {
  const fullName = `${name} Domain`;
  const source = sourceDomains.get(normalize(fullName));
  const document = JSON.parse(JSON.stringify(source || domainBase));
  document._id = idFor(name);
  document.name = fullName;
  document.system.identifiedName = fullName;
  document.system.originId = document._id;
  document.system.originPack = "warcraftrpg2e.warcraft-spells";
  document.system.spellSpecializationName = normalize(name).replace(/ /g, "-");
  document.system.uniqueId = `wc-domain-${normalize(name).replace(/ /g, "-")}`;
  document.system.index.uniqueId = document.system.uniqueId;
  document.system.description.value = `<p>${powerSummaries[name]}</p><p>Domain spells are linked below. Full situational details remain in the private core rulebook.</p>`;
  document.system.source = "World of Warcraft RPG, 2nd Edition, pp. 271-273";
  document.system.spellSpecialization = { isDomain: true, spells: {} };
  const entries = catalog.filter((entry) => entry.assignments.some((assignment) => assignment.kind === "domain" && assignment.list === fullName));
  for (const entry of entries) {
    const assignment = entry.assignments.find((candidate) => candidate.kind === "domain" && candidate.list === fullName);
    const spell = spellsByName.get(normalize(entry.name));
    document.system.spellSpecialization.spells[`level${assignment.level}`] = {
      id: spell?._id || null, img: spell?.img || "icons/svg/book.svg", level: assignment.level,
      name: entry.name, pack: "warcraftrpg2e.warcraft-spells",
    };
  }
  document.flags = { warcraftrpg2e: {
    source: { book: "World of Warcraft: The Roleplaying Game, Second Edition", file: "docs/World_of_Warcraft_2nd_Edition.pdf", pdfPages: [273,274,275], printedPages: [271,272,273], section: fullName, verification: "text+spell-list" },
    domain: { generated: true, parentClass: "Healer", spellCount: entries.length, status: "linked-content-manual-access-rules" },
  } };
  fs.writeFileSync(path.join(outputDir, `${normalize(fullName).replace(/ /g, "-")}-${document._id}.json`), `${JSON.stringify(document, null, 2)}\n`);
}

const documents = readDocs(outputDir).sort((a,b) => a.document.name.localeCompare(b.document.name) || a.document.type.localeCompare(b.document.type));
const index = documents.map(({ file, document }) => ({ childKeyByCollection: {}, embeddedCollections: [], file, key: `!items!${document._id}` }));
fs.writeFileSync(path.join(outputDir, ".index.json"), `${JSON.stringify(index, null, 2)}\n`);
console.log(`Generated and linked ${domains.length} Warcraft domains.`);
