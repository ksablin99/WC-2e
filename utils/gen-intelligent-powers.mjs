/**
 * gen-intelligent-powers.mjs
 *
 * Generates source JSON items for every intelligent-item power table entry and
 * links them back into the roll table result flags.
 *
 * Run: node utils/gen-intelligent-powers.mjs
 * Then: npm run sources:repack
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const POWERS_DIR = join(ROOT, "source", "intelligent-item-powers");
const PACK_NAME = "intelligent-item-powers";

mkdirSync(POWERS_DIR, { recursive: true });

// ── Deterministic 16-char ID from a seed string ──────────────────────────────
function makeId(seed) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const hash = createHash("sha256").update(seed).digest();
  let id = "";
  for (let i = 0; i < 16; i++) id += chars[hash[i] % chars.length];
  return id;
}

// ── Base templates ────────────────────────────────────────────────────────────
const STATS = {
  compendiumSource: null,
  coreVersion: "13.351",
  createdTime: null,
  duplicateSource: null,
  exportSource: null,
  lastModifiedBy: null,
  modifiedTime: null,
  systemId: null,
  systemVersion: null,
};

function makeSpellItem({ id, name, img, desc, usageType, usesPerDay, spellLevel }) {
  const atWill = usageType === "atwill";
  const per = atWill ? "" : usageType; // "day" or "charges"
  const maxUses = atWill ? 0 : (usesPerDay ?? 1);
  return {
    _embedded: {},
    _id: id,
    _stats: { ...STATS },
    effects: [],
    flags: {},
    folder: null,
    img: img || "icons/magic/light/orb-lightbulb-yellow.webp",
    name,
    ownership: { default: 0 },
    sort: 0,
    type: "spell",
    system: {
      ability: { attack: null, critMult: 2, critRange: 20, damage: null, damageMult: 1, twoHandedOnly: false, vsTouchAc: false },
      actionType: "spellsave",
      activateActions: [],
      activation: { cost: 1, type: "standard" },
      addedLevel: 0,
      attack: { parts: [] },
      attackBonus: "",
      attackCountFormula: "",
      attackNotes: "",
      attackParts: [],
      atWill,
      autoscaleAttackParts: "",
      baseCl: "0",
      bookSource: "3.5e SRD",
      castTime: "",
      changes: [],
      classSource: "",
      clOffset: 0,
      combatChanges: [],
      components: { divineFocus: 0, focus: false, material: false, somatic: true, verbal: true },
      contextNotes: [],
      counterName: "",
      createdBy: "",
      creationChanges: [],
      critConfirmBonus: "",
      crOffset: "",
      customAttributes: {},
      customAttributesLocked: false,
      customTag: "",
      damage: { alternativeParts: [], parts: [] },
      description: { chat: "", unidentified: "", value: desc || "" },
      duration: { units: "", value: null },
      effectNotes: "",
      favorite: false,
      formula: "",
      index: { subType: "spell", uniqueId: "" },
      linkedChargeItem: { id: null, img: null, name: null },
      linkedItems: [],
      linkId: "",
      linkImported: false,
      links: { charges: [] },
      linkSourceId: "",
      linkSourceName: "",
      maxDamageDice: 0,
      maxDamageDiceFormula: "",
      measureTemplate: { customColor: "", customTexture: "", overrideColor: false, overrideTexture: false, size: 0, type: "" },
      nameFormula: "",
      nameFromFormula: false,
      originId: "",
      originPack: "",
      originVersion: 103,
      possibleUpdate: false,
      range: { long: null, units: "", value: null },
      resistances: [],
      save: { ability: "", dc: 0, dcAutoAbility: "", dcAutoType: "", description: "", type: "" },
      showInQuickbar: false,
      sizeOverride: "",
      source: "",
      specialActions: [],
      spellLevel: spellLevel ?? 0,
      sr: false,
      summon: [],
      target: { value: "" },
      uniqueId: "",
      userNonRemovable: false,
      uses: {
        allowMultipleUses: false,
        autoDeductCharges: true,
        canBeLinked: false,
        chargesPerUse: 1,
        isResource: false,
        max: maxUses,
        maxFormula: "",
        maxPerUse: null,
        maxPerUseFormula: "",
        per: per || null,
        rechargeFormula: null,
        value: maxUses,
      },
    },
  };
}

function makeFeatItem({ id, name, img, desc, skillChanges }) {
  const changes = (skillChanges || []).map(([val, skillKey]) => [String(val), "skill", `skill.${skillKey}`, "untyped"]);
  return {
    _embedded: {},
    _id: id,
    _stats: { ...STATS },
    effects: [],
    flags: {},
    folder: null,
    img: img || "icons/skills/trades/academics-book-study-purple.webp",
    name,
    ownership: { default: 0 },
    sort: 0,
    type: "feat",
    system: {
      ability: { attack: null, critMult: 2, critRange: 20, damage: null, damageMult: 1, twoHandedOnly: false, vsTouchAc: false },
      abilityType: "",
      actionType: "",
      activation: { cost: 1, type: "" },
      addedLevel: 0,
      associations: { classes: [] },
      attack: { parts: [] },
      attackBonus: "",
      attackCountFormula: "",
      attackNotes: "",
      attackParts: [],
      autoscaleAttackParts: "",
      baseCl: "0",
      bookSource: "3.5e SRD",
      changeFlags: {
        heavyArmorFullSpeed: false, loseDexToAC: false, mediumArmorFullSpeed: false, multiAttack: false,
        multiweaponAttack: false, noCon: false, noDex: false, noEncumbrance: false, noInt: false,
        noStr: false, oneCha: false, oneInt: false, oneWis: false, uncannyDodge: false,
      },
      changes,
      classSource: "",
      combatChangeCustomDisplayName: "",
      combatChangeCustomReferenceName: "",
      combatChanges: [],
      combatChangesAdditionalRanges: {
        hasAdditionalRanges: false,
        slider1: { max: 0, maxFormula: "", name: "" },
        slider2: { max: 0, maxFormula: "", name: "" },
        slider3: { max: 0, maxFormula: "", name: "" },
      },
      combatChangesApplySpecialActionsOnce: true,
      combatChangesRange: { max: 0, maxFormula: "" },
      combatChangesUsesCost: "chargesPerUse",
      conditionFlags: { dazzled: false, polymorphed: false, wildshaped: false },
      contextNotes: [],
      counterName: "",
      createdBy: "",
      creationChanges: [],
      critConfirmBonus: "",
      crOffset: "",
      customAttributes: {},
      customAttributesLocked: false,
      customTag: "",
      damage: { alternativeParts: [], parts: [] },
      damageReduction: [],
      description: { chat: "", unidentified: "", value: desc || "" },
      duration: { units: "", value: null },
      effectNotes: "",
      epic: "",
      favorite: false,
      featType: "feat",
      formula: "",
      index: { subType: "feat", uniqueId: "" },
      linkedChargeItem: { id: null, img: null, name: null },
      linkedItems: [],
      linkId: "",
      linkImported: false,
      links: { charges: [] },
      linkSourceId: "",
      linkSourceName: "",
      maxDamageDice: 0,
      maxDamageDiceFormula: "",
      measureTemplate: { customColor: "", customTexture: "", overrideColor: false, overrideTexture: false, size: 0, type: "" },
      metamagic: { code: "", enabled: false, shortDesc: "" },
      metamagicFeats: { empowered: false, enhanced: false, enhancedHalf: false, enlarged: false, intensified: false, maximized: false, widened: false },
      nameFormula: "",
      nameFromFormula: false,
      originId: "",
      originPack: "",
      originVersion: 103,
      possibleUpdate: false,
      pr: false,
      psionic: "",
      range: { long: null, units: "", value: null },
      requirements: [],
      requiresPsionicFocus: false,
      resistances: [],
      rollTableDraw: { formula: "", id: "", name: "", pack: "" },
      save: { ability: "", dc: 0, dcAutoAbility: "", dcAutoType: "", description: "", originVersion: 97, type: "" },
      senses: { blindsight: 0, darkvision: 0, lowLight: false, lowLightMultiplier: 2, tremorsense: 0, truesight: 0 },
      showInQuickbar: false,
      sizeOverride: "",
      source: "",
      specialActions: [],
      sr: false,
      summon: [],
      tags: [["General"]],
      target: { value: "" },
      uniqueId: "",
      userNonRemovable: false,
      uses: {
        allowMultipleUses: false, autoDeductCharges: true, canBeLinked: false, chargesPerUse: 1,
        isResource: false, max: 0, maxFormula: "", maxPerUse: null, maxPerUseFormula: "",
        per: null, rechargeFormula: null, value: 0,
      },
    },
  };
}

// ── Power definitions ─────────────────────────────────────────────────────────
// Each entry: { tableResultId, name, type, ...args }
// tableResultId is the _id in the roll table result JSON
const LESSER_POWERS = [
  { resultId: "aeWG4PTGKZK1VVIX", type: "spell", name: "Bless (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 1 },
  { resultId: "rvDM9hjSAVzCan3K", type: "spell", name: "Faerie Fire (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 1 },
  { resultId: "zQzjRlTgjyUdOXyq", type: "spell", name: "Minor Image (1/day)", usageType: "day", usesPerDay: 1, spellLevel: 2 },
  { resultId: "kdzQgBxCSofS9hSF", type: "spell", name: "Deathwatch (continuous)", usageType: "atwill", spellLevel: 1 },
  { resultId: "xojD0KCHWFRHrhhf", type: "spell", name: "Detect Magic (at will)", usageType: "atwill", spellLevel: 0 },
  { resultId: "yYDNJKLT5BwYnPKs", type: "feat", name: "Intelligent Item: Intimidate 10", skillChanges: [[10, "itm"]] },
  { resultId: "ClWy2CQQvuYRFkxb", type: "feat", name: "Intelligent Item: Decipher Script 10", skillChanges: [[10, "dsc"]] },
  { resultId: "2gOHTtDfJ8GjU28V", type: "feat", name: "Intelligent Item: Knowledge 10", skillChanges: [[10, "kna"]] },
  { resultId: "z9LNeLIQJTqQMwzF", type: "feat", name: "Intelligent Item: Search 10", skillChanges: [[10, "src"]] },
  { resultId: "qwZbkZ5rBPFMNMwH", type: "feat", name: "Intelligent Item: Spot 10", skillChanges: [[10, "spt"]] },
  { resultId: "tWSFFV4JTYe55eQk", type: "feat", name: "Intelligent Item: Listen 10", skillChanges: [[10, "lis"]] },
  { resultId: "IiGAIZrKhuphyLnb", type: "feat", name: "Intelligent Item: Spellcraft 10", skillChanges: [[10, "spl"]] },
  { resultId: "ai6N5rX3OBjEbMGA", type: "feat", name: "Intelligent Item: Sense Motive 10", skillChanges: [[10, "sen"]] },
  { resultId: "qBC2HbLOZRmOH4ji", type: "feat", name: "Intelligent Item: Bluff 10", skillChanges: [[10, "blf"]] },
  { resultId: "3WhiLaBoPPTnscwa", type: "feat", name: "Intelligent Item: Diplomacy 10", skillChanges: [[10, "dip"]] },
  { resultId: "sXccbHejvp4iwN18", type: "spell", name: "Major Image (1/day)", usageType: "day", usesPerDay: 1, spellLevel: 3 },
  { resultId: "AYx8ZxpmbpeR4YkI", type: "spell", name: "Darkness (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 2 },
  { resultId: "6tXnaxBc8v4f0RRS", type: "spell", name: "Hold Person (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 2 },
  { resultId: "dIBIlVtggdljcJjE", type: "spell", name: "Zone of Truth (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 2 },
  { resultId: "goI1QSP4AJnhCSPS", type: "spell", name: "Daze Monster (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 2 },
  { resultId: "SSCHjePvGJyqrdtv", type: "spell", name: "Locate Object (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 2 },
  { resultId: "Er7PTzMBN9JYqWBd", type: "spell", name: "Cure Moderate Wounds (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 2 },
];

const GREATER_POWERS = [
  { resultId: "owAgLZoQJ1XVJyUZ", type: "spell", name: "Detect Opposing Alignment (at will)", usageType: "atwill", spellLevel: 2 },
  { resultId: "G2ekyBy7p6jGG3Y5", type: "spell", name: "Detect Undead (at will)", usageType: "atwill", spellLevel: 1 },
  { resultId: "1hRW5HhpYzvINVQ1", type: "spell", name: "Cause Fear (at will)", usageType: "atwill", spellLevel: 1 },
  { resultId: "3zlEysdZcT2TNI4w", type: "spell", name: "Dimensional Anchor (1/day)", usageType: "day", usesPerDay: 1, spellLevel: 4 },
  { resultId: "y2uB9smSWVZemn0z", type: "spell", name: "Dismissal (1/day)", usageType: "day", usesPerDay: 1, spellLevel: 4 },
  { resultId: "63S3MVs35G1BLrYd", type: "spell", name: "Lesser Globe of Invulnerability (1/day)", usageType: "day", usesPerDay: 1, spellLevel: 4 },
  { resultId: "apaZwz4Rfe2wNcf5", type: "spell", name: "Arcane Eye (1/day)", usageType: "day", usesPerDay: 1, spellLevel: 4 },
  { resultId: "OmIWooB8zpCXtnID", type: "spell", name: "Detect Scrying (continuous)", usageType: "atwill", spellLevel: 4 },
  { resultId: "mqfWki5sfS8ZOU4v", type: "spell", name: "Wall of Fire (1/day)", usageType: "day", usesPerDay: 1, spellLevel: 4 },
  { resultId: "0vbNk1zjvJ0wprhU", type: "spell", name: "Quench (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 3 },
  { resultId: "mOFhGgK5AlXlmG0B", type: "spell", name: "Status (at will)", usageType: "atwill", spellLevel: 2 },
  { resultId: "3BaWMBxUIAMGODrR", type: "spell", name: "Gust of Wind (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 2 },
  { resultId: "OsLTexHEJvvpFu8n", type: "spell", name: "Clairvoyance (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 3 },
  { resultId: "FGI8baMzzbMbC0tX", type: "spell", name: "Magic Circle Against Alignment (at will)", usageType: "atwill", spellLevel: 3 },
  { resultId: "SxBw9VaMOHdJcogh", type: "spell", name: "Haste (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 3 },
  { resultId: "gICnB7VC1UkrDwak", type: "spell", name: "Daylight (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 3 },
  { resultId: "E9BGbiwtUSPoFL2b", type: "spell", name: "Deeper Darkness (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 3 },
  { resultId: "ayKSJWHQcfdC5YdQ", type: "spell", name: "Invisibility Purge (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 3 },
  { resultId: "i4zfmdcy9z9BzIkp", type: "spell", name: "Slow (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 3 },
  { resultId: "V6AshojNyvLRbKWn", type: "spell", name: "Locate Creature (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 4 },
  { resultId: "e5p1FSQmPFYUKsL5", type: "spell", name: "Fear (3/day)", usageType: "day", usesPerDay: 3, spellLevel: 4 },
  { resultId: "YIffDRDZ2ojxdxDC", type: "spell", name: "Detect Thoughts (at will)", usageType: "atwill", spellLevel: 2 },
];

// ── Icon mapping ──────────────────────────────────────────────────────────────
const NAMED_SPELLS = "systems/warcraftrpg2e/icons/spells/named-spells/";
const SKILL_ICON = "systems/warcraftrpg2e/icons/feats/skill-focus.png";
const SPELL_ICON_MAP = {
  "bless": "bless", "faerie fire": "faerie-fire", "minor image": "minor-image",
  "deathwatch": "deathwatch", "detect magic": "detect-magic",
  "major image": "major-image", "darkness": "darkness", "hold person": "hold-person",
  "locate object": "locate-object", "cure moderate wounds": "cure-wounds",
  "cause fear": "cause-fear", "dimensional anchor": "dimensional-anchor",
  "dismissal": "dismissal", "lesser globe of invulnerability": "globe-of-invulnerability",
  "globe of invulnerability": "globe-of-invulnerability", "arcane eye": "arcane-eye",
  "detect scrying": "detect-scrying", "wall of fire": "wall-of-fire",
  "status": "status", "gust of wind": "gust-of-wind",
  "clairvoyance": "clairaudience", "magic circle against alignment": "magic-circle-against-evil",
  "haste": "haste", "daylight": "daylight", "deeper darkness": "darkness",
  "invisibility purge": "invisibility", "locate creature": "locate-object",
  "fear": "fear", "detect thoughts": "detect-thoughts",
  "detect opposing alignment": "detect-magic", "detect undead": "detect-magic",
  "quench": "wall-of-fire", "zone of truth": "suggestion",
  "daze monster": "hold-person", "slow": "haste",
};

function spellIcon(name) {
  const base = name.toLowerCase().replace(/\s*\([^)]+\)$/, "").trim();
  const slug = SPELL_ICON_MAP[base];
  return slug ? `${NAMED_SPELLS}${slug}.png` : `${NAMED_SPELLS}detect-magic.png`;
}

// ── Generate items ────────────────────────────────────────────────────────────
const allPowers = [...LESSER_POWERS, ...GREATER_POWERS];
const resultIdToItemId = {};

for (const p of allPowers) {
  const id = makeId(`intelligent-item-power:${p.name}`);
  resultIdToItemId[p.resultId] = id;
  const img = p.type === "feat" ? SKILL_ICON : spellIcon(p.name);

  let item;
  if (p.type === "spell") {
    item = makeSpellItem({ id, name: p.name, img, usageType: p.usageType, usesPerDay: p.usesPerDay, spellLevel: p.spellLevel });
  } else {
    item = makeFeatItem({ id, name: p.name, img, skillChanges: p.skillChanges });
  }

  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const filename = `${slug}-${id.toLowerCase()}.json`;
  const filePath = join(POWERS_DIR, filename);
  writeFileSync(filePath, JSON.stringify(item, null, 2) + "\n");
  console.log(`  wrote ${filename}`);
}

// ── Write .index.json ─────────────────────────────────────────────────────────
// pack-db.js expects an array of { file, key, embeddedCollections, childKeyByCollection }
const indexPath = join(POWERS_DIR, ".index.json");
const indexEntries = allPowers.map((p) => {
  const id = resultIdToItemId[p.resultId];
  const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const filename = `${slug}-${id.toLowerCase()}.json`;
  return {
    childKeyByCollection: {},
    embeddedCollections: [],
    file: filename,
    key: `!items!${id}`,
  };
});
writeFileSync(indexPath, JSON.stringify(indexEntries, null, 2) + "\n");
console.log(`  wrote .index.json (${indexEntries.length} entries)`);

// ── Update roll table source files ───────────────────────────────────────────
function updateTableFile(filePath, powers) {
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  for (const result of data._embedded.results) {
    const itemId = resultIdToItemId[result._id];
    if (itemId) {
      // Use standard Foundry compendium-type result so fields are editable in the UI
      result.type = "compendium";
      result.documentCollection = `D35E.${PACK_NAME}`;
      result.documentId = itemId;
      // Remove legacy itemUuid flag (now redundant)
      if (result.flags?.D35E) delete result.flags.D35E.itemUuid;
    }
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  console.log(`  updated ${filePath.split(/[\\/]/).at(-1)}`);
}

const TABLES_DIR = join(ROOT, "source", "intelligent-item-tables");
updateTableFile(join(TABLES_DIR, "intelligent-item-lesser-zzintitemlessp03.json"), LESSER_POWERS);
updateTableFile(join(TABLES_DIR, "intelligent-item-greater-zzintitemgrpwrtb4.json"), GREATER_POWERS);

console.log("\nDone. Now run: npm run sources:repack");
