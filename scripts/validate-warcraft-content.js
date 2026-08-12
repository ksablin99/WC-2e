const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const system = JSON.parse(fs.readFileSync(path.join(root, "system.json"), "utf8"));
const declarations = system.packs.filter((pack) => pack.name.startsWith("warcraft-"));
const failures = [];
const warnings = [];
const ids = new Map();
const documentsByPack = new Map();

function fail(message) { failures.push(message); }
function meaningful(value) {
  return Boolean(String(value || "").trim()) && !/^(?:-|—|–|none)$/i.test(String(value).trim());
}
function loadPack(pack) {
  const directory = path.join(root, "source", pack.name);
  if (!fs.existsSync(directory)) { fail(`${pack.name}: missing source directory`); return []; }
  const index = JSON.parse(fs.readFileSync(path.join(directory, ".index.json"), "utf8"));
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(".json") && file !== ".index.json").sort();
  if (JSON.stringify(index.map((entry) => entry.file).sort()) !== JSON.stringify(files)) fail(`${pack.name}: index/source file mismatch`);
  const documents = index.map((entry) => ({ entry, file: entry.file, document: JSON.parse(fs.readFileSync(path.join(directory, entry.file), "utf8")) }));
  documentsByPack.set(pack.name, documents);
  return documents;
}

for (const pack of declarations) {
  for (const { entry, file, document } of loadPack(pack)) {
    const expectedCollection = pack.type === "Actor" ? "actors" : pack.type === "JournalEntry" ? "journal" : "items";
    if (entry.key !== `!${expectedCollection}!${document._id}`) fail(`${pack.name}/${file}: wrong index key`);
    if (!/^[A-Za-z0-9]{16}$/.test(document._id)) fail(`${pack.name}/${file}: invalid 16-character id ${document._id}`);
    if (ids.has(document._id)) fail(`${pack.name}/${file}: duplicate id also used by ${ids.get(document._id)}`);
    ids.set(document._id, `${pack.name}/${file}`);
    const source = document.flags?.warcraftrpg2e?.source;
    if (!source?.book || !source?.section) fail(`${pack.name}/${file}: missing source provenance`);
    if (pack.type !== "JournalEntry" && !source?.pdfPages && !source?.printedPages && !source?.pages) fail(`${pack.name}/${file}: provenance has no pages`);
    const image = document.img;
    const normalizedImage = image?.replace(/^\//, "");
    if (normalizedImage && !normalizedImage.startsWith("icons/") && !normalizedImage.startsWith("systems/warcraftrpg2e/")) fail(`${pack.name}/${file}: unsafe image path ${image}`);
    if (normalizedImage?.startsWith("systems/warcraftrpg2e/") && !fs.existsSync(path.join(root, normalizedImage.replace("systems/warcraftrpg2e/", "")))) {
      warnings.push(`${pack.name}/${file}: release-supplied icon ${image}`);
    }
    if (pack.type === "JournalEntry") {
      for (const page of document._embedded?.pages || []) {
        if (!document.pages.includes(page._id)) fail(`${pack.name}/${file}: embedded page missing from pages order`);
        if (entry.childKeyByCollection?.pages?.[page._id] !== `!journal.pages!${document._id}.${page._id}`) fail(`${pack.name}/${file}: broken page index link`);
      }
    }
  }
}

const spellDocs = documentsByPack.get("warcraft-spells") || [];
const spells = new Map(spellDocs.filter(({ document }) => document.type === "spell").map(({ document }) => [document._id, document]));
for (const { file, document } of spellDocs.filter(({ document }) => document.flags?.warcraftrpg2e?.domain?.generated)) {
  for (const link of Object.values(document.system.spellSpecialization.spells)) {
    if (!spells.has(link.id)) fail(`warcraft-spells/${file}: broken domain spell ${link.name} (${link.id})`);
  }
}

const spellCatalog = JSON.parse(fs.readFileSync(path.join(root, "scripts", "warcraft-content", "warcraft-spell-catalog.json"), "utf8"));
if (spells.size !== spellCatalog.length) fail(`warcraft-spells: ${spells.size} spell docs, expected ${spellCatalog.length}`);
const featCatalog = JSON.parse(fs.readFileSync(path.join(root, "scripts", "warcraft-content", "warcraft-feat-catalog.json"), "utf8"));
const featCount = (documentsByPack.get("warcraft-feats") || []).length;
if (featCount !== featCatalog.length) fail(`warcraft-feats: ${featCount} docs, expected ${featCatalog.length}`);

const races = (documentsByPack.get("warcraft-races") || []).filter(({ document }) => document.type === "race");
if (races.length !== 10) fail(`warcraft-races: ${races.length} player races, expected 10`);
for (const { file, document } of races) {
  const metadata = document.flags?.warcraftrpg2e?.race;
  if (!metadata?.automaticLanguages?.length || !metadata?.favoredClass?.length || !metadata?.racialLevel) {
    fail(`warcraft-races/${file}: incomplete character-creation metadata`);
  }
}

const equipmentDocs = documentsByPack.get("warcraft-equipment") || [];
const equipmentIds = new Set(equipmentDocs.map(({ document }) => document._id));
for (const { file, document } of equipmentDocs) {
  const catalog = document.flags?.warcraftrpg2e?.catalog;
  if (catalog?.status === "manual-noncombat-details") fail(`warcraft-equipment/${file}: still has placeholder table values`);
  if (catalog?.completeTableEntry && document.type !== "material") {
    if (!Number.isFinite(Number(document.system?.price)) || Number(document.system.price) < 0) fail(`warcraft-equipment/${file}: invalid price`);
    if (!Number.isFinite(Number(document.system?.weight)) || Number(document.system.weight) < 0) fail(`warcraft-equipment/${file}: invalid weight`);
  }
  const ammunitionLink = document.flags?.warcraftrpg2e?.rules?.ammunitionLink;
  if (ammunitionLink && (ammunitionLink.pack !== "warcraftrpg2e.warcraft-equipment" || !equipmentIds.has(ammunitionLink.id))) {
    fail(`warcraft-equipment/${file}: broken ammunition link`);
  }
  if (document.type === "material" && !document.flags?.warcraftrpg2e?.rules) fail(`warcraft-equipment/${file}: missing material rule metadata`);
}

const shoutFeats = (documentsByPack.get("warcraft-feats") || [])
  .filter(({ document }) => document.flags?.warcraftrpg2e?.feat?.category === "Shout");
if (shoutFeats.length !== 7) fail(`warcraft-feats: ${shoutFeats.length} shout feats, expected 7`);
for (const { file, document } of shoutFeats) {
  if (!document.flags?.warcraftrpg2e?.feat?.rules?.effect) fail(`warcraft-feats/${file}: missing shout rules`);
}

const bestiaryCatalog = JSON.parse(fs.readFileSync(path.join(root, "scripts", "warcraft-content", "warcraft-monster-statblocks.json"), "utf8"));
const bestiaryDocs = documentsByPack.get("warcraft-bestiary") || [];
const bestiaryByName = new Map(bestiaryDocs.map(({ document }) => [document.name, document]));
const damageTypeIds = new Set(fs.readdirSync(path.join(root, "source", "damage-types"))
  .filter((file) => file.endsWith(".json") && file !== ".index.json")
  .map((file) => JSON.parse(fs.readFileSync(path.join(root, "source", "damage-types", file), "utf8"))?.system?.uniqueId)
  .filter(Boolean));
if (bestiaryCatalog.length !== 152) fail(`warcraft-bestiary: extracted ${bestiaryCatalog.length} statblocks, expected 152`);
if (bestiaryDocs.length !== bestiaryCatalog.length) fail(`warcraft-bestiary: ${bestiaryDocs.length} actors, expected ${bestiaryCatalog.length}`);
for (const record of bestiaryCatalog) {
  const actor = bestiaryByName.get(record.name);
  if (!actor) { fail(`warcraft-bestiary: missing actor ${record.name}`); continue; }
  if (!actor.flags?.warcraftrpg2e?.bestiary?.completeStatblock) fail(`warcraft-bestiary: ${record.name} is not marked complete`);
  const embedded = actor._embedded?.items || [];
  const embeddedIds = embedded.map((item) => item._id).sort();
  if (JSON.stringify([...(actor.items || [])].sort()) !== JSON.stringify(embeddedIds)) fail(`warcraft-bestiary: ${record.name} item order mismatch`);
  if (meaningful(record.fields.Attack) && !embedded.some((item) => item.type === "attack")) fail(`warcraft-bestiary: ${record.name} has no attack item`);
  if (meaningful(record.fields["Full Attack"])) {
    const fullAttacks = embedded.filter((item) => item.type === "full-attack");
    if (!fullAttacks.length) fail(`warcraft-bestiary: ${record.name} has no full attack item`);
    for (const fullAttack of fullAttacks) {
      const links = Object.values(fullAttack.system?.attacks || {}).filter((slot) => slot.id);
      if (!links.length || links.some((slot) => !embeddedIds.includes(slot.id) || Number(slot.count) < 1)) {
        fail(`warcraft-bestiary: ${record.name}/${fullAttack.name} has an invalid linked attack`);
      }
    }
  }
  for (const attack of embedded.filter((item) => item.type === "attack")) {
    for (const part of attack.system?.damage?.parts || []) {
      if (!damageTypeIds.has(part[2])) fail(`warcraft-bestiary: ${record.name}/${attack.name} has unknown damage type ${part[2]}`);
    }
  }
  if (/64\.69\.87\.237|starter slice|require manual resolution|imported automatically/i.test(JSON.stringify(actor))) {
    fail(`warcraft-bestiary: ${record.name} contains extraction or placeholder residue`);
  }
  const fieldText = Object.values(record.fields || {}).join(" ");
  if (/64\.69\.87\.237|\b(?:Hit Dice|Initiative|Speed|Armor Class|Base Attack\/Grapple|Full Attack|Space\/Reach|Special Attacks|Special Qualities|Saves|Abilities|Skills|Feats|Environment|Area|Organization|Challenge Rating|Treasure|Alignment|Advancement|Level Adjustment|Villain Points):/i.test(fieldText)) {
    fail(`warcraft-bestiary: ${record.name} contains a neighbouring label or PDF residue`);
  }
  if (!/^[+\-]?\d+(?:\s*\([^)]*\))?$/.test(record.fields?.Initiative || "")) fail(`warcraft-bestiary: ${record.name} has malformed initiative`);
  if (!/Str\s*(?:\d+|-)(?:\s*\([^)]*\))?\s*,?\s*Agy\s*(?:\d+|-)\s*,?\s*Sta\s*(?:\d+|-)\s*,?\s*Int\s*(?:\d+|-)\s*,?\s*Spt\s*(?:\d+|-)\s*,?\s*Cha\s*(?:\d+|-)/i.test(record.fields?.Abilities || "")) {
    fail(`warcraft-bestiary: ${record.name} has malformed abilities`);
  }
}

const creatureRules = documentsByPack.get("warcraft-creature-rules") || [];
const typeRules = creatureRules.filter(({ document }) => document.flags?.warcraftrpg2e?.creatureRule?.kind === "type");
const subtypeRules = creatureRules.filter(({ document }) => document.flags?.warcraftrpg2e?.creatureRule?.kind === "subtype");
const capabilityRules = creatureRules.filter(({ document }) => document.flags?.warcraftrpg2e?.creatureRule?.kind === "capability");
const templateRules = creatureRules.filter(({ document }) => document.flags?.warcraftrpg2e?.creatureRule?.kind === "template");
if (typeRules.length !== 15) fail(`warcraft-creature-rules: ${typeRules.length} creature types, expected 15`);
if (subtypeRules.length !== 28) fail(`warcraft-creature-rules: ${subtypeRules.length} creature subtypes, expected 28`);
if (capabilityRules.length !== 5) fail(`warcraft-creature-rules: ${capabilityRules.length} shared capabilities, expected 5`);
if (templateRules.length !== 10) fail(`warcraft-creature-rules: ${templateRules.length} templates, expected 10`);

if (failures.length) {
  console.error(`Warcraft content validation failed (${failures.length}):\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Warcraft content validation passed: ${declarations.length} packs, ${ids.size} top-level documents, ${spells.size} spells, ${featCount} feats.`);
  if (warnings.length) console.log(`${warnings.length} icon references are supplied by the pinned release icon bundle.`);
}
