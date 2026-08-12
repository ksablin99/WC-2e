const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const packDir = path.join(root, "source", "warcraft-spells");
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "warcraft-spell-catalog.json"), "utf8"));

function loadDocuments(directory) {
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith(".json") && file !== ".index.json")
    .map((file) => ({ file, document: JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")) }));
}

function normalizedName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(greater|lesser|mass)\s+(.+)/, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function idFor(name) {
  return crypto.createHash("sha256").update(`warcraftrpg2e:spell:${name}`).digest("hex").slice(0, 16);
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const genericSpells = loadDocuments(path.join(root, "source", "spells"))
  .filter(({ document }) => document.type === "spell");
const genericByName = new Map(genericSpells.map((entry) => [normalizedName(entry.document.name), entry.document]));
for (const [warcraftName, srdName] of Object.entries({
  "Lesser Geas": "Geas, Lesser",
  "Mass Suggestion": "Suggestion, Mass",
})) {
  const source = genericByName.get(normalizedName(srdName));
  if (source) genericByName.set(normalizedName(warcraftName), source);
}
const current = loadDocuments(packDir);
for (const { file, document } of current) {
  if (document.flags?.warcraftrpg2e?.catalog?.generated) fs.unlinkSync(path.join(packDir, file));
}
const retained = loadDocuments(packDir);
const retainedSpells = new Map(retained
  .filter(({ document }) => document.type === "spell")
  .map((entry) => [normalizedName(entry.document.name), entry.document]));
const spellTemplate = retainedSpells.get(normalizedName("Arcane Missile"));

const schoolCodes = {
  abjuration: "abj", conjuration: "con", divination: "div", enchantment: "enc",
  evocation: "evo", illusion: "ill", necromancy: "nec", transmutation: "trs", universal: "uni",
};

function assignmentsFor(entry) {
  const learnedAt = { bloodline: [], class: [], domain: [], elementalSchool: [], subDomain: [] };
  for (const assignment of entry.assignments) {
    if (assignment.kind === "domain" || assignment.list.endsWith(" Domain")) {
      learnedAt.domain.push([assignment.list.replace(/ Domain$/, ""), assignment.level]);
    } else {
      learnedAt.class.push([assignment.list, assignment.level]);
    }
  }
  for (const key of ["class", "domain"]) {
    const seen = new Set();
    learnedAt[key] = learnedAt[key].filter((pair) => {
      const identity = `${pair[0]}:${pair[1]}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }
  return learnedAt;
}

function lowestLevel(entry) {
  const classLevels = entry.assignments.filter((assignment) => assignment.kind !== "domain").map((assignment) => assignment.level);
  return Math.min(...(classLevels.length ? classLevels : entry.assignments.map((assignment) => assignment.level)));
}

function applyHeader(document, header = {}) {
  const schoolText = String(header.school || "");
  const school = schoolText.match(/^[A-Za-z]+/)?.[0]?.toLowerCase();
  if (schoolCodes[school]) document.system.school = schoolCodes[school];
  const descriptorMatch = schoolText.match(/\[([^\]]+)\]/);
  if (descriptorMatch) document.system.types = descriptorMatch[1].toLowerCase().replace(/\s*,\s*/g, ", ");
  const components = String(header.Components || "");
  document.system.components.value = components;
  document.system.components.verbal = /(?:^|,\s*)V(?:,|$)/.test(components);
  document.system.components.somatic = /(?:^|,\s*)S(?:,|$)/.test(components);
  document.system.components.material = /(?:^|,\s*)M(?:\/|,|$)/.test(components);
  document.system.components.focus = /(?:^|,\s*)F(?:,|$)/.test(components);
  document.system.components.divineFocus = /DF/.test(components) ? 1 : 0;
  if (header["Casting Time"]) {
    const castingTime = String(header["Casting Time"]);
    document.system.castTime = castingTime;
    const normalized = castingTime.toLowerCase();
    const cost = Number(normalized.match(/^(\d+)/)?.[1] || 1);
    let type = "special";
    if (/standard action/.test(normalized)) type = "standard";
    else if (/full[- ]round action/.test(normalized)) type = "full";
    else if (/swift action/.test(normalized)) type = "swift";
    else if (/immediate action/.test(normalized)) type = "immediate";
    else if (/move action/.test(normalized)) type = "move";
    else if (/free action/.test(normalized)) type = "free";
    else if (/\brounds?\b/.test(normalized)) type = "round";
    else if (/\bminutes?\b/.test(normalized)) type = "minute";
    else if (/\bhours?\b/.test(normalized)) type = "hour";
    document.system.activation = { cost, type };
  }
  if (header.Range) {
    const range = String(header.Range);
    const normalized = range.toLowerCase();
    document.system.display = range;
    let units = "spec", value = null;
    if (/^personal\b/.test(normalized)) units = "personal";
    else if (/^touch\b/.test(normalized)) units = "touch";
    else if (/^close\b/.test(normalized)) units = "close";
    else if (/^medium\b/.test(normalized)) units = "medium";
    else if (/^long\b/.test(normalized)) units = "long";
    else if (/^unlimited\b/.test(normalized)) units = "unlimited";
    else if (/see text/.test(normalized)) units = "seeText";
    else if (/\/level|per level/.test(normalized)) units = "spec";
    else if (/\bft\.?\b/.test(normalized)) {
      units = "ft";
      value = Number(normalized.match(/(\d[\d,]*)\s*ft/)?.[1]?.replace(/,/g, "") || 0);
    } else if (/\bmiles?\b/.test(normalized)) {
      units = "mi";
      value = Number(normalized.match(/(\d[\d,]*)\s*miles?/)?.[1]?.replace(/,/g, "") || 0);
    }
    document.system.range = { value, units, long: null };
  }
  const target = header.Target || header.Targets || header.Area || header.Effect;
  if (target) document.system.target.value = target;
  if (header.Area) document.system.spellArea = header.Area;
  if (header.Effect) document.system.spellEffect = header.Effect;
  if (header.Duration) {
    const duration = String(header.Duration);
    const normalized = duration.toLowerCase();
    document.system.spellDuration = duration;
    let units = "spec", value = null;
    if (/^instantaneous\b/.test(normalized)) units = "inst";
    else if (/^permanent\b/.test(normalized)) units = "perm";
    else if (/see text/.test(normalized)) units = "seeText";
    else {
      const amount = Number(normalized.match(/^(\d+)/)?.[1] || 1);
      value = amount;
      if (/round\/level|round per level/.test(normalized)) units = "roundPerLevel";
      else if (/min(?:ute)?\.?\/level|minute per level/.test(normalized)) units = "minutePerLevel";
      else if (/hour\/level|hour per level/.test(normalized)) units = "hourPerLevel";
      else if (/\brounds?\b/.test(normalized)) units = "round";
      else if (/\bminutes?\b/.test(normalized)) units = "minute";
      else if (/\bhours?\b/.test(normalized)) units = "hour";
      else if (/\bdays?\b/.test(normalized)) units = "day";
    }
    document.system.spellDurationData = { value, units };
  }
  if (header["Saving Throw"]) {
    const savingThrow = String(header["Saving Throw"]);
    const normalized = savingThrow.toLowerCase();
    document.system.save.description = savingThrow;
    let saveType = "";
    const ability = normalized.includes("fortitude") ? "fortitude"
      : normalized.includes("reflex") ? "reflex"
        : normalized.includes("will") ? "will" : "";
    const result = normalized.includes("half") ? "half"
      : normalized.includes("partial") ? "partial"
        : normalized.includes("negates") ? "negates" : "";
    if (ability && result) saveType = `${ability}${result}`;
    document.system.save.type = saveType;
  }
  if (header["Spell Resistance"]) document.system.sr = !/^No\b/i.test(header["Spell Resistance"]);
}

function automationPolicy(entry, generic, existing = null) {
  const name = normalizedName(entry.name);
  const complex = /(?:summon|polymorph|shapechange|reincarnate|raise dead|resurrection|soulstone|mana shield|mana burn|disjunction|dispel|counterspell|dominate|charm|planar binding|teleport|plane shift)/.test(name);
  if (!generic) {
    return {
      mode: "manual",
      reason: "No verified executable effect is available; resolve the complete effect from the private rulebook.",
    };
  }
  if (complex) {
    return {
      mode: "srd-baseline-with-manual-boundary",
      reason: "SRD mechanics are retained, but Warcraft-specific creatures, forms, slot manipulation, or persistent cross-actor state require GM adjudication.",
    };
  }
  return {
    mode: existing ? "verified-vertical-slice" : "srd-baseline",
    reason: existing
      ? "This spell has a purpose-built Warcraft implementation."
      : "The inherited SRD implementation is used with the Warcraft list assignment and spell level.",
  };
}

let inherited = 0;
let manual = 0;
for (const entry of catalog) {
  const key = normalizedName(entry.name);
  const existing = retainedSpells.get(key);
  if (existing) {
    existing.system.learnedAt = assignmentsFor(entry);
    existing.system.level = lowestLevel(entry);
    existing.flags.warcraftrpg2e.catalog = {
      completeListEntry: true, generated: false,
      status: entry.header ? "verified-vertical-slice" : "verified-vertical-slice-with-list-only-header",
    };
    existing.system.warcraftManualPolicy = automationPolicy(entry, true, existing);
    const fileEntry = retained.find(({ document }) => document === existing);
    fs.writeFileSync(path.join(packDir, fileEntry.file), `${JSON.stringify(existing, null, 2)}\n`, "utf8");
    continue;
  }

  const generic = genericByName.get(key);
  const document = JSON.parse(JSON.stringify(generic || spellTemplate));
  document._id = idFor(entry.name);
  document.name = entry.name;
  document.system.identifiedName = entry.name;
  document.system.originId = document._id;
  document.system.originPack = "warcraftrpg2e.warcraft-spells";
  document.system.learnedAt = assignmentsFor(entry);
  document.system.level = lowestLevel(entry);
  document.system.source = `World of Warcraft RPG, 2nd Edition, spell lists pp. ${Math.min(...entry.listPages) - 2}-${Math.max(...entry.listPages) - 2}`;
  const summary = entry.summary || "See the private core rulebook for the complete effect.";
  document.system.description.value = `<p>${summary}</p>${generic ? "" : "<p><strong>Automation:</strong> Catalogue record only; adjudicate from the private rulebook until a verified action is linked.</p>"}`;
  document.system.shortDescription = `<p>${summary}</p>`;
  document.system.snip = summary;
  if (!generic) {
    document.system.actionType = "";
    document.system.attack.parts = [];
    document.system.attackParts = [];
    document.system.damage.parts = [];
    document.system.damage.alternativeParts = [];
    document.system.changes = [];
    document.system.conditionals = [];
    document.system.measureTemplate = { customColor: "", customTexture: "", overrideColor: false, overrideTexture: false, size: 0, type: "" };
    document.system.summon = [];
    manual += 1;
  } else {
    inherited += 1;
  }
  applyHeader(document, entry.header);
  document.system.warcraftManualPolicy = automationPolicy(entry, Boolean(generic));
  const pages = [...new Set([...entry.listPages, ...(entry.header?.descriptionPages || [])])].sort((a, b) => a - b);
  document.flags = {
    ...(document.flags || {}),
    warcraftrpg2e: {
      source: {
        book: "World of Warcraft: The Roleplaying Game, Second Edition",
        file: "docs/World_of_Warcraft_2nd_Edition.pdf",
        pdfPages: pages,
        printedPages: pages.map((page) => page - 2),
        section: entry.name,
        verification: entry.header ? "text-extracted-header" : "spell-list-entry",
      },
      catalog: {
        completeListEntry: true,
        generated: true,
        status: entry.header
          ? (generic ? "srd-mechanics-with-warcraft-header" : "manual-effect-pending-verification")
          : (generic ? "srd-mechanics-with-warcraft-list-data" : "manual-effect-pending-verification"),
      },
    },
  };
  fs.writeFileSync(path.join(packDir, `${slug(entry.name)}-${document._id}.json`), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

const documents = loadDocuments(packDir)
  .sort((a, b) => a.document.name.localeCompare(b.document.name) || a.document.type.localeCompare(b.document.type));
const index = documents.map(({ file, document }) => ({
  childKeyByCollection: {}, embeddedCollections: [], file, key: `!items!${document._id}`,
}));
fs.writeFileSync(path.join(packDir, ".index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Indexed ${catalog.length} Warcraft spells (${inherited} inherited SRD mechanics, ${manual} catalogue-only) plus ${documents.length - catalog.length} helper records.`);
