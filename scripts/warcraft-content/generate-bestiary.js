const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { buildMonsterMagic, loadMonsterSpellSources } = require("./bestiary-magic.js");

const root = path.resolve(__dirname, "../..");
const packDir = path.join(root, "source", "warcraft-bestiary");
const catalogPath = path.join(__dirname, "warcraft-monster-statblocks.json");
const magicPath = path.join(__dirname, "warcraft-monster-magic.json");
const harvestPath = path.join(packDir, "harvest-golem-wcharvestgolem01.json");

const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
const monsterMagic = JSON.parse(fs.readFileSync(magicPath, "utf8"));
const monsterSpellSources = loadMonsterSpellSources(root);
const preservedHarvest = JSON.parse(fs.readFileSync(harvestPath, "utf8"));
const existingIds = new Map();
for (const file of fs.readdirSync(packDir).filter((file) => file.endsWith(".json") && file !== ".index.json")) {
  const document = JSON.parse(fs.readFileSync(path.join(packDir, file), "utf8"));
  existingIds.set(document.name, document._id);
}

function hashId(seed) {
  return crypto.createHash("sha256").update(`warcraftrpg2e:bestiary:${seed}`).digest("hex").slice(0, 16);
}

function slugify(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function signed(value) {
  const match = String(value || "").match(/[+\-]?\d+/);
  return match ? Number(match[0]) : 0;
}

function parseHd(value) {
  const dice = [...String(value || "").matchAll(/(\d+)d(\d+)/gi)];
  const hpMatch = String(value || "").match(/\(([\d,]+)\s*hp\)/i);
  const pools = dice.map((match, index) => ({
    count: Number(match[1]),
    die: Number(match[2]),
    expression: `${match[1]}d${match[2]}`,
    index,
  }));
  return {
    levels: pools.reduce((total, pool) => total + pool.count, 0),
    die: pools[0]?.die || 8,
    hp: hpMatch ? Number(hpMatch[1].replace(/,/g, "")) : 1,
    expression: String(value || ""),
    pools: pools.length ? pools : [{ count: 1, die: 8, expression: "1d8", index: 0 }],
  };
}

function parseAc(value) {
  const text = String(value || "");
  const total = Number(text.match(/^\s*(\d+)/)?.[1] || 10);
  const touch = Number(text.match(/touch\s+([+\-]?\d+)/i)?.[1] || total);
  const flat = Number(text.match(/flat-?\s*footed\s+([+\-]?\d+)/i)?.[1] || total);
  const natural = Number(text.match(/([+\-]?\d+)\s+natural/i)?.[1] || 0);
  return { total, touch, flat, natural };
}

function parseBab(value) {
  const match = String(value || "").match(/([+\-]?\d+)\s*\/\s*([+\-]?\d+|-)/);
  return { bab: match ? Number(match[1]) : 0, grapple: match && match[2] !== "-" ? Number(match[2]) : 0 };
}

function parseSaves(value) {
  const text = String(value || "");
  return {
    fort: Number(text.match(/Fort\s+([+\-]?\d+)/i)?.[1] || 0),
    ref: Number(text.match(/Ref\s+([+\-]?\d+)/i)?.[1] || 0),
    will: Number(text.match(/Will\s+([+\-]?\d+)/i)?.[1] || 0),
  };
}

const abilityNames = { Str: "str", Agy: "dex", Sta: "con", Int: "int", Spt: "wis", Cha: "cha" };
function parseAbilities(value) {
  const result = {};
  for (const [label, key] of Object.entries(abilityNames)) {
    const raw = String(value || "").match(new RegExp(`\\b${label}\\s+([^,; ]+)`, "i"))?.[1] || "-";
    const absent = /^(?:-|—|–|â)/.test(raw);
    const score = absent ? 0 : Number(raw.replace(/[^\d]/g, "")) || 0;
    const mod = absent ? 0 : Math.floor((score - 10) / 2);
    result[key] = {
      checkMod: 0,
      damage: 0,
      drain: 0,
      isZero: absent,
      mod,
      origMod: mod,
      origTotal: score,
      penalty: 0,
      total: score,
      userPenalty: 0,
      value: score,
    };
  }
  result.str.carryBonus = 0;
  result.str.carryMultiplier = 1;
  return result;
}

function parseCr(value, kind) {
  if (kind === "summon" && !value) return null;
  const match = String(value || "").match(/(\d+)(?:\/(\d+))?/);
  if (!match) return 0;
  return match[2] ? Number(match[1]) / Number(match[2]) : Number(match[1]);
}

const sizes = {
  fine: "fine", diminutive: "dim", tiny: "tiny", small: "sm", medium: "med",
  large: "lg", huge: "huge", gargantuan: "grg", colossal: "col",
};
const sizeMods = { fine: 8, dim: 4, tiny: 2, sm: 1, med: 0, lg: -1, huge: -2, grg: -4, col: -8 };
const typeKeys = {
  aberration: "aberration", animal: "animal", construct: "construct", dragon: "dragon",
  elemental: "elemental", fey: "fey", giant: "giant", humanoid: "humanoid",
  "magical beast": "magicalBeast", "monstrous humanoid": "monstrousHumanoid", ooze: "ooze",
  outsider: "outsider", plant: "plant", undead: "undead", vermin: "vermin",
};
const typeProgressions = {
  aberration: [8, "med", "low", "low", "high"],
  animal: [8, "med", "high", "high", "low"],
  construct: [10, "med", "low", "low", "low"],
  dragon: [12, "high", "high", "high", "high"],
  elemental: [8, "med", "high", "low", "low"],
  fey: [6, "low", "low", "high", "high"],
  giant: [8, "med", "high", "low", "low"],
  humanoid: [8, "med", "low", "low", "low"],
  magicalBeast: [10, "high", "high", "high", "low"],
  monstrousHumanoid: [8, "high", "low", "high", "high"],
  ooze: [10, "med", "low", "low", "low"],
  outsider: [8, "high", "high", "high", "high"],
  plant: [8, "med", "high", "low", "low"],
  undead: [12, "low", "low", "low", "high"],
  vermin: [8, "med", "high", "low", "low"],
};

function parseType(typeLine) {
  const sizeName = String(typeLine || "").match(/^(Fine|Diminutive|Tiny|Small|Medium|Large|Huge|Gargantuan|Colossal)\b/i)?.[1]?.toLowerCase() || "medium";
  const withoutSize = String(typeLine || "").replace(/^(Fine|Diminutive|Tiny|Small|Medium|Large|Huge|Gargantuan|Colossal)\s+/i, "");
  const baseType = Object.keys(typeKeys).sort((a, b) => b.length - a.length)
    .find((candidate) => withoutSize.toLowerCase().startsWith(candidate)) || "humanoid";
  const subtypes = String(typeLine || "").match(/\(([^)]+)\)/)?.[1]?.split(",").map((value) => value.trim()).filter(Boolean) || [];
  return { size: sizes[sizeName], typeKey: typeKeys[baseType], typeName: baseType.replace(/\b\w/g, (letter) => letter.toUpperCase()), subtypes };
}

function parseSpeeds(value) {
  const text = String(value || "");
  const speed = {};
  const land = Number(text.match(/^(?:[^\d]*)?(\d+)\s*ft/i)?.[1] || 0);
  if (land) speed.land = { base: land, total: land };
  for (const [key, label] of Object.entries({ climb: "climb", swim: "swim", burrow: "burrow", fly: "fly" })) {
    const amount = Number(text.match(new RegExp(`${label}\\s+(\\d+)\\s*ft`, "i"))?.[1] || 0);
    if (amount) speed[key] = { base: amount, total: amount };
  }
  return speed;
}

function parseSenses(value) {
  const text = String(value || "");
  return {
    darkvision: Number(text.match(/darkvision\s+(\d+)/i)?.[1] || 0) || null,
    lowLight: /low-light vision/i.test(text),
    lowLightMultiplier: /low-light vision/i.test(text) ? 2 : null,
    blindsight: Number(text.match(/blindsight\s+(\d+)/i)?.[1] || 0) || null,
    blindsense: Number(text.match(/blindsense\s+(\d+)/i)?.[1] || 0) || null,
    tremorsense: Number(text.match(/tremorsense\s+(\d+)/i)?.[1] || 0) || null,
  };
}

const energyResistanceUids = {
  acid: "energy-acid",
  cold: "energy-cold",
  electricity: "energy-electric",
  fire: "energy-fire",
  force: "energy-force",
  sonic: "energy-sonic",
};

const supportedDrBypass = new Set([
  "adamantine", "any", "bludgeoning", "chaotic", "coldiron", "epic", "evil",
  "good", "lawful", "magic", "piercing", "silver", "slashing",
]);

function addEnergyDefense(result, energy, value = "", immunity = false, vulnerable = false) {
  const uid = energyResistanceUids[energy.toLowerCase()];
  if (!uid) return;
  const existing = result.resistances.find((entry) => entry[1] === uid);
  if (existing) {
    if (Number(value || 0) > Number(existing[0] || 0)) existing[0] = String(value);
    existing[2] ||= immunity;
    existing[3] ||= vulnerable;
    return;
  }
  result.resistances.push([String(value || ""), uid, immunity, vulnerable, false]);
}

function parsePassiveDefenses(value) {
  const text = String(value || "").replace(/[†‡*]/g, "").replace(/\s+/g, " ");
  const result = {
    damageReduction: [],
    fastHealing: Number(text.match(/\bfast healing\s+(\d+)/i)?.[1] || 0) || null,
    regeneration: Number(text.match(/\bregeneration\s+(\d+)/i)?.[1] || 0) || null,
    resistances: [],
    spellResistance: Number(text.match(/\bspell resistance\s+(\d+)/i)?.[1] || 0),
  };

  for (const match of text.matchAll(/\bdamage (?:reduction|resistance)\s+(\d+)\s*\/\s*([^,;]+)/gi)) {
    const amount = match[1];
    const originalClause = match[2].trim().toLowerCase();
    if (/\band\s*$/.test(originalClause)) continue;
    const clause = originalClause;
    if (/^(?:-|none)$/.test(clause)) {
      result.damageReduction.push([amount, "any", false]);
      continue;
    }
    const bypasses = clause.split(/\s+and\s+/i).map((rawBypass) => {
      const normalized = rawBypass.trim().replace(/[- ]/g, "");
      return normalized === "alchemicalsilver" ? "silver" : normalized;
    });
    // Every conjunct must be representable. Partially encoding
    // "good and truesilver" would incorrectly let an ordinary good weapon
    // bypass the entire reduction.
    if (bypasses.some((bypass) => !supportedDrBypass.has(bypass))) continue;
    for (const bypass of bypasses) {
      result.damageReduction.push([amount, bypass, false]);
    }
  }

  // Book resistance clauses often continue as "cold 10, and electricity 10"
  // after the first label, so read the complete qualities line.
  if (/\bresistance to\b/i.test(text)) {
    for (const match of text.matchAll(/\b(acid|cold|electricity|fire|sonic)\s+(\d+)\b/gi)) {
      addEnergyDefense(result, match[1], match[2]);
    }
  }
  for (const match of text.matchAll(/\b(acid|cold|electricity|fire|sonic) resistance\s+(\d+)\b/gi)) {
    addEnergyDefense(result, match[1], match[2]);
  }
  for (const match of text.matchAll(/\b(?:immunity|immune) to\s+((?:(?:acid|cold|electricity|fire|force|sonic)(?:\s*(?:,|and)\s*)?)+)/gi)) {
    for (const energy of match[1].match(/acid|cold|electricity|fire|force|sonic/gi) || []) {
      addEnergyDefense(result, energy, "", true, false);
    }
  }
  for (const match of text.matchAll(/\b(?:immunity|immune) to\s+([^,;]+)/gi)) {
    for (const energy of match[1].match(/acid|cold|electricity|fire|force|sonic/gi) || []) {
      addEnergyDefense(result, energy, "", true, false);
    }
  }
  for (const match of text.matchAll(/\b(?:vulnerability to|vulnerable to)\s+(acid|cold|electricity|fire|sonic)\b/gi)) {
    addEnergyDefense(result, match[1], "", false, true);
  }
  if (/\bfire subtype\b/i.test(text)) {
    addEnergyDefense(result, "fire", "", true, false);
    addEnergyDefense(result, "cold", "", false, true);
  }
  if (/\bcold subtype\b/i.test(text)) {
    addEnergyDefense(result, "cold", "", true, false);
    addEnergyDefense(result, "fire", "", false, true);
  }

  result.damageReduction = result.damageReduction.filter((entry, index, all) =>
    all.findIndex((candidate) => candidate[0] === entry[0] && candidate[1] === entry[1]) === index);
  return result;
}

function topLevelSplit(value) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const character of String(value || "")) {
    if (character === "(") depth += 1;
    if (character === ")") depth = Math.max(0, depth - 1);
    if ((character === "," || character === ";") && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = "";
    } else current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter((part) => !/^(?:-|—|–|none)$/i.test(part));
}

function splitAttackOptions(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    else if (text[index] === ")") depth = Math.max(0, depth - 1);
    if (depth) continue;
    const separator = text.slice(index).match(/^(?:\s*;\s*or\s+|\s*,\s*or\s+|\s+or\s+)/i)?.[0];
    if (!separator) continue;
    const option = text.slice(start, index).trim().replace(/[;,]\s*$/, "");
    if (option) parts.push(option);
    index += separator.length - 1;
    start = index + 1;
  }
  const finalOption = text.slice(start).trim();
  if (finalOption) parts.push(finalOption);
  return parts;
}

const legacySkillDefinitions = {
  Appraise: ["apr", "int"], Balance: ["blc", "dex"], Bluff: ["blf", "cha"], Climb: ["clm", "str"],
  Concentration: ["coc", "con"], "Craft (alchemy)": ["crf", "int"], Decipher: ["dsc", "int"],
  Diplomacy: ["dip", "cha"], "Disable Device": ["dev", "int"], Disguise: ["dis", "cha"],
  "Escape Artist": ["esc", "dex"], "Gather Information": ["gif", "cha"], "Handle Animal": ["han", "cha"],
  Heal: ["hea", "wis"], Stealth: ["hid", "dex"], Intimidate: ["int", "cha"], Jump: ["jmp", "str"],
  Listen: ["lis", "wis"], "Open Lock": ["opl", "dex"], Ride: ["rid", "dex"], Search: ["src", "int"],
  "Sense Motive": ["sen", "wis"], "Sleight of Hand": ["slt", "dex"], Spellcraft: ["spl", "int"],
  Spot: ["spt", "wis"], Survival: ["sur", "wis"], Swim: ["swm", "str"], Tumble: ["tmb", "dex"],
  "Use Magic Device": ["umd", "cha"], "Use Rope": ["uro", "dex"], "Use Technological Device": ["utd", "int"],
};

function parseLegacySkills(value, abilities) {
  const skills = {};
  const raw = String(value || "");
  for (const [label, [key, ability]] of Object.entries(legacySkillDefinitions)) {
    const match = raw.match(new RegExp(`(?:^|[,;])\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^+\\-\d]*([+\\-]\\d+)`, "i"));
    if (!match) continue;
    const total = Number(match[1]);
    const abilityModifier = abilities[ability]?.mod || 0;
    skills[key] = {
      ability,
      abilityModifier,
      acp: ["blc", "clm", "esc", "hid", "jmp", "slt", "swm", "tmb"].includes(key),
      acpPenalty: 0,
      background: false,
      changeBonus: total - abilityModifier,
      cs: false,
      energyDrainPenalty: 0,
      mod: total,
      notes: `Printed total ${total >= 0 ? "+" : ""}${total}`,
      points: 0,
      rank: 0,
      rt: false,
      value: 0,
      visibility: "default",
    };
  }
  return skills;
}

const skillDefinitions = new Map(Object.entries({
  appraise: ["apr", "int"], balance: ["blc", "dex"], bluff: ["blf", "cha"], climb: ["clm", "str"],
  concentration: ["coc", "con"], "craft (technological device)": ["ctd", "int"], "decipher script": ["dsc", "int"], decipher: ["dsc", "int"],
  diplomacy: ["dip", "cha"], "disable device": ["dev", "int"], disguise: ["dis", "cha"],
  "escape artist": ["esc", "dex"], forgery: ["fog", "int"], "gather information": ["gif", "cha"], "handle animal": ["han", "cha"],
  heal: ["hea", "wis"], stealth: ["hid", "dex"], intimidate: ["int", "cha"], jump: ["jmp", "str"],
  "knowledge (arcana)": ["kar", "int"], "knowledge (local)": ["klo", "int"], "knowledge (military tactics)": ["kmt", "int"],
  "knowledge (nature)": ["kna", "int"], "knowledge (nobility and royalty)": ["kno", "int"], "knowledge (the planes)": ["kpl", "int"],
  "knowledge (religion)": ["kre", "int"], listen: ["lis", "wis"], "open lock": ["opl", "dex"],
  "profession (military commander)": ["pmc", "wis"], ride: ["rid", "dex"], search: ["src", "int"],
  "sense motive": ["sen", "wis"], "sleight of hand": ["slt", "dex"], "speak language": ["spk", ""], spellcraft: ["spl", "int"],
  spot: ["spt", "wis"], survival: ["sur", "wis"], swim: ["swm", "str"], tumble: ["tmb", "dex"],
  "use magic device": ["umd", "cha"], "use rope": ["uro", "dex"], "use technological device": ["utd", "int"],
}));

const acpSkills = new Set(["blc", "clm", "esc", "hid", "jmp", "slt", "swm", "tmb"]);

function skillRow(total, ability, abilities, key, notes, extra = {}) {
  const abilityModifier = abilities[ability]?.mod || 0;
  return {
    ability,
    abilityModifier,
    acp: acpSkills.has(key),
    acpPenalty: 0,
    background: false,
    changeBonus: total - abilityModifier,
    cs: false,
    energyDrainPenalty: 0,
    mod: total,
    notes,
    points: 0,
    rank: 0,
    rt: false,
    value: 0,
    visibility: "default",
    ...extra,
  };
}

function parseSkills(value, abilities) {
  const skills = {};
  for (const rawEntry of topLevelSplit(value)) {
    const match = rawEntry.match(/^(.+?)\s*([+\-]\d+)(.*)$/);
    if (!match) continue;
    const label = match[1].trim().replace(/\s+/g, " ");
    const normalized = label.toLowerCase();
    const total = Number(match[2]);
    const qualifier = match[3].trim();
    const notes = `Printed total ${total >= 0 ? "+" : ""}${total}${qualifier ? ` ${qualifier}` : ""}`;
    const definition = skillDefinitions.get(normalized);
    if (definition) {
      const [key, ability] = definition;
      skills[key] = skillRow(total, ability, abilities, key, notes);
      continue;
    }

    const specialized = label.match(/^(Craft|Perform|Profession)\s*\((.+)\)$/i);
    if (specialized && !/^Profession\s*\(military commander\)$/i.test(label)) {
      const parentKey = { craft: "crf", perform: "prf", profession: "pro" }[specialized[1].toLowerCase()];
      const ability = parentKey === "prf" ? "cha" : parentKey === "pro" ? "wis" : "int";
      const subSkillId = `wc${hashId(`skill:${label}`).slice(0, 8)}`;
      const parent = skills[parentKey] || skillRow(0, ability, abilities, parentKey, "", { subSkills: {} });
      parent.subSkills = parent.subSkills || {};
      parent.subSkills[subSkillId] = skillRow(total, ability, abilities, parentKey, notes, { name: specialized[2].trim() });
      skills[parentKey] = parent;
      continue;
    }

    const ability = /^Knowledge\b|^Craft\b/i.test(label) ? "int" : /^Profession\b/i.test(label) ? "wis" : "int";
    const customKey = `wc${hashId(`skill:${label}`).slice(0, 8)}`;
    skills[customKey] = skillRow(total, ability, abilities, customKey, notes, {
      acp: false,
      custom: true,
      name: label,
      worldCustom: false,
    });
  }
  return skills;
}

function damageTypeFor(name) {
  const value = name.toLowerCase();
  if (/claw|talon|rake/.test(value)) return ["Piercing or Slashing", "damage-piercing-or-slashing"];
  if (/bite|mandible/.test(value)) return ["Piercing or Bludgeoning", "damage-piercing-bludgeoning"];
  if (/dagger|blade|sword|axe/.test(value)) return ["Piercing or Slashing", "damage-piercing-or-slashing"];
  if (/bow|crossbow|firearm|pistol|rifle|gore|horn|sting|spike|spear|javelin|arrow|rock/.test(value)) return ["Piercing", "damage-piercing"];
  return ["Bludgeoning", "damage-bludg"];
}

function isNaturalAttack(name) {
  return /\b(?:bite|claw|gore|hoof|horn|pseudopod|rake|slam|slap|sting|tail|talon|tentacle|touch)\b/i.test(name);
}

function creatureRuleReference(kind, name) {
  return {
    pack: "warcraftrpg2e.warcraft-creature-rules",
    id: hashId(`${kind}:${name}`),
    name: kind === "template" ? name : `${name} Traits`,
  };
}

function isMeaningful(value) {
  return Boolean(String(value || "").trim()) && !/^(?:-|—|–|none)$/i.test(String(value).trim());
}

function attackKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^\+\d+\s+/, "")
    .replace(/\b(?:attacks?|weapons?)\b/g, "")
    .replace(/s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseAttackEntries(value) {
  const text = String(value || "").replace(/([+\-]\d+)(melee|ranged)/gi, "$1 $2").replace(/\s+/g, " ");
  const entries = [];
  const pattern = /(?:^|\b(?:or|and)\s+)(?:(\d+)\s+)?([^;]{1,70}?)\s+([+\-]\d+(?:\s*\/\s*[+\-]\d+)*)\s+(melee|ranged(?:\s+touch)?)\s*\(([^()]+)\)/gi;
  for (const match of text.matchAll(pattern)) {
    let name = match[2].trim().replace(/^(?:and|or)\s+/i, "");
    name = name.replace(/^\+\d+\s+/, (prefix) => prefix);
    const bonuses = match[3].split("/").map((part) => Number(part.trim()));
    const payload = match[5].trim();
    const damage = payload.match(/\b(\d+d\d+(?:[+\-]\d+)?)/i)?.[1] || "0";
    const crit = payload.match(/\/(\d+)(?:-(\d+))?\s*\/\s*x?(\d+)/i) || payload.match(/\/(\d+)-(\d+)/i);
    const multiplierOnly = payload.match(/\/x(\d+)/i);
    const critRange = crit ? Number(crit[1]) : 20;
    const critMult = crit?.[3] ? Number(crit[3]) : multiplierOnly ? Number(multiplierOnly[1]) : 2;
    entries.push({
      count: Number(match[1] || 1),
      name: name.replace(/\b(?:a|an|the)\s+/i, "").replace(/\s+/g, " "),
      bonuses,
      kind: match[4].toLowerCase(),
      payload,
      damage,
      critRange,
      critMult,
    });
  }
  if (!entries.length) {
    const relaxed = /^(?:(\d+)\s+)?(.+?)\s+([+\-]\d+(?:\s*\/\s*[+\-]?\d+)*)(?:\s+(melee|ranged(?:\s+touch)?))?\s*\(([^()]+)\)/i.exec(text);
    if (relaxed) {
      const payload = relaxed[5].trim();
      const damage = payload.match(/\b(\d+d\d+(?:[+\-]\d+)?)/i)?.[1] || "0";
      const crit = payload.match(/\/(\d+)(?:-(\d+))?\s*\/\s*x?(\d+)/i) || payload.match(/\/(\d+)-(\d+)/i);
      const multiplierOnly = payload.match(/\/x(\d+)/i);
      entries.push({
        count: Number(relaxed[1] || 1),
        name: relaxed[2].trim(),
        bonuses: relaxed[3].split("/").map((part) => Number(part.trim())),
        kind: (relaxed[4] || "melee").toLowerCase(),
        payload,
        damage,
        critRange: crit ? Number(crit[1]) : 20,
        critMult: crit?.[3] ? Number(crit[3]) : multiplierOnly ? Number(multiplierOnly[1]) : 2,
      });
    }
  }
  if (!entries.length) {
    const automatic = /^(?:(\d+)\s+)?(.+?)\s*(?:melee|ranged)?\s*\(([^()]+)\)/i.exec(text);
    if (automatic) {
      const payload = automatic[3].trim();
      const damage = payload.match(/\b(\d+d\d+(?:[+\-]\d+)?)/i)?.[1] || "0";
      entries.push({
        automatic: true,
        count: Number(automatic[1] || 1),
        name: automatic[2].trim(),
        bonuses: [],
        kind: "automatic",
        payload,
        damage,
        critRange: 20,
        critMult: 2,
      });
    }
  }
  return entries;
}

const energyDamageTypes = {
  acid: ["Acid", "energy-acid"],
  cold: ["Cold", "energy-cold"],
  electricity: ["Electricity", "energy-electric"],
  fel: ["Fel", "damage-untyped-energy"],
  fire: ["Fire", "energy-fire"],
  force: ["Force", "energy-force"],
  holy: ["Holy", "energy-divine"],
  negative: ["Negative Energy", "energy-negative"],
  positive: ["Positive Energy", "energy-positive"],
  shadow: ["Shadow", "damage-untyped-energy"],
  sonic: ["Sonic", "energy-sonic"],
};

function damagePartsFor(attack) {
  // Alternative damage clauses are choices, not simultaneous damage components.
  const payload = String(attack.payload || "").split(/,\s*or\s+/i)[0];
  const matches = [...payload.matchAll(/\b(\d+d\d+(?:[+\-]\d+)?)(?:\s+(acid|cold|electricity|fel|fire|force|holy|negative|positive|shadow|sonic))?/gi)];
  if (!matches.length) {
    const [label, uid] = damageTypeFor(attack.name);
    return [[attack.damage || "0", label, uid]];
  }
  return matches.map((match, index) => {
    const explicitType = match[2]?.toLowerCase();
    if (explicitType && energyDamageTypes[explicitType]) return [match[1], ...energyDamageTypes[explicitType]];
    if (index > 0) return [match[1], "Untyped", "damage-untyped"];
    const [label, uid] = damageTypeFor(attack.name);
    return [match[1], label, uid];
  });
}

function itemShell(id, name, type, img) {
  return { _id: id, effects: [], flags: {}, folder: null, img, name, ownership: { default: 0 }, sort: 0, system: {}, type };
}

function makeAttackItem(actorName, attack, bab, size) {
  const printedBonus = attack.bonuses[0];
  const id = hashId(`${actorName}:attack:${attack.name}:${printedBonus ?? "automatic"}:${attack.damage}`);
  const item = itemShell(id, attack.name.replace(/\b\w/g, (letter) => letter.toUpperCase()), "attack", "icons/svg/sword.svg");
  item.system = {
    ability: {
      attack: "",
      critMult: attack.critMult,
      critRange: attack.critRange,
      damage: "",
      damageMult: 1,
      vsTouchAc: /touch/.test(attack.kind),
    },
    actionType: attack.automatic ? "special" : /ranged\s+touch/.test(attack.kind) ? "rsak" : attack.kind.startsWith("ranged") ? "rwak" : "mwak",
    activation: { cost: 1, type: "standard" },
    attackBonus: attack.automatic ? "" : String(printedBonus - bab - (sizeMods[size] || 0)),
    attackParts: attack.automatic ? [] : attack.bonuses.slice(1).map((bonus) => [String(bonus - printedBonus), "Iterative attack"]),
    attackType: isNaturalAttack(attack.name) ? "natural" : "weapon",
    autoScaleOption: "never",
    baseWeaponType: attack.name,
    damage: { parts: damagePartsFor(attack) },
    description: { value: `<p><strong>Printed attack:</strong> ${escapeHtml(attack.name)} ${attack.bonuses.map((bonus) => bonus >= 0 ? `+${bonus}` : bonus).join("/")} ${escapeHtml(attack.kind)} (${escapeHtml(attack.payload)}).</p>${attack.automatic ? "<p>This attack deals its listed damage without a normal attack roll.</p>" : ""}` },
    enh: 0,
    favorite: true,
    magic: /\+\d+\s|magic|fel/i.test(attack.name),
    primaryAttack: true,
    proficient: true,
    source: "World of Warcraft: Monster Guide",
    threatRangeExtended: attack.critRange < 20,
    weaponSubtype: isNaturalAttack(attack.name) ? "natural" : "other",
  };
  item.flags.warcraftrpg2e = { bestiary: { printedBonus: attack.bonuses, printedDamage: attack.payload } };
  if (isNaturalAttack(attack.name)) item.flags.warcraftrpg2e.reference = creatureRuleReference("capability", "Natural Attacks");
  else {
    const equipmentReference = equipmentReferenceFor(attack.name);
    if (equipmentReference) item.flags.warcraftrpg2e.reference = equipmentReference;
  }
  return item;
}

function makeFeature(actorName, name, category, raw, pages, reference = null) {
  const id = hashId(`${actorName}:feature:${category}:${name}`);
  const item = itemShell(id, name, "feat", "icons/svg/aura.svg");
  const referenceLink = reference
    ? `<p><strong>Shared rule:</strong> @UUID[Compendium.${reference.pack}.Item.${reference.id}]{${escapeHtml(reference.name)}}.</p>`
    : "";
  const resolution = reference
    ? "linked-reference"
    : /\b(?:damage (?:reduction|resistance)|fast healing\s+\d+|regeneration\s+\d+|spell resistance\s+\d+|(?:immunity|vulnerability|resistance) to\b|(?:acid|cold|electricity|fire|sonic) subtype)\b/i.test(raw)
      ? "actor-defense"
      : "manual";
  const boundary = resolution === "manual"
    ? "<p><strong>Resolution:</strong> This situational ability is recorded for play but remains GM-adjudicated from the cited private source page.</p>"
    : resolution === "actor-defense"
      ? "<p><strong>Resolution:</strong> Numeric defenses from this declaration are represented on the actor; exceptional conditions remain GM-adjudicated.</p>"
      : "";
  item.system = {
    abilityType: "nat",
    description: {
      value: `<p><strong>${escapeHtml(category)}:</strong> ${escapeHtml(raw)}.</p>${referenceLink}${boundary}`,
    },
    featType: "trait",
    source: `World of Warcraft: Monster Guide, p. ${pages.join("-")}`,
    uniqueId: `wc-monster-${slugify(actorName)}-${slugify(name)}`,
  };
  item.flags.warcraftrpg2e = {
    source: { book: "World of Warcraft: Monster Guide", printedPages: pages, section: actorName },
    bestiary: { automation: resolution, category, raw },
  };
  if (reference) item.flags.warcraftrpg2e.reference = reference;
  return item;
}

function makeFullAttack(actorName, raw, attacks, optionIndex = 0, optionCount = 1) {
  const id = hashId(`${actorName}:full-attack:${optionIndex}:${raw}`);
  const optionLabel = attacks.map(({ attack }) => `${attack.count > 1 ? `${attack.count} ` : ""}${attack.name}`).join(" and ");
  const item = itemShell(id, optionCount > 1 ? `Full Attack - ${optionLabel || optionIndex + 1}` : "Full Attack", "full-attack", "icons/svg/sword.svg");
  const slots = {};
  attacks.slice(0, 5).forEach(({ item: attackItem, attack }, index) => {
    slots[`attack${index + 1}`] = {
      _id: index + 1,
      attackMode: "primary",
      count: attack.count,
      id: attackItem._id,
      img: attackItem.img,
      isWeapon: false,
      name: attackItem.name,
      primary: true,
    };
  });
  for (let index = attacks.length; index < 5; index += 1) {
    slots[`attack${index + 1}`] = { _id: index + 1, attackMode: "primary", count: 0, id: "", img: "", isWeapon: false, name: "", primary: false };
  }
  item.system = {
    attacks: slots,
    attackType: "full",
    description: { value: `<p><strong>Printed full attack:</strong> ${escapeHtml(raw)}.</p>${attacks.length ? "" : "<p>The source layout could not be linked safely; resolve this full attack from the printed summary.</p>"}` },
    source: "World of Warcraft: Monster Guide",
  };
  item.flags.warcraftrpg2e = { reference: creatureRuleReference("capability", "Full Attacks") };
  return item;
}

function loadReferenceMap(packName) {
  const directory = path.join(root, "source", packName);
  if (!fs.existsSync(directory)) return new Map();
  return new Map(fs.readdirSync(directory).filter((file) => file.endsWith(".json") && file !== ".index.json").map((file) => {
    const document = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8"));
    return [document.name.toLowerCase(), { pack: `warcraftrpg2e.${packName}`, id: document._id, name: document.name }];
  }));
}

function mergeReferenceMaps(...maps) {
  const result = new Map();
  for (const map of maps.reverse()) for (const [name, reference] of map) result.set(name, reference);
  return result;
}

const featReferences = mergeReferenceMaps(loadReferenceMap("warcraft-feats"), loadReferenceMap("feats"));
const spellReferences = mergeReferenceMaps(loadReferenceMap("warcraft-spells"), loadReferenceMap("spells"));
const equipmentReferences = mergeReferenceMaps(
  loadReferenceMap("warcraft-equipment"),
  loadReferenceMap("weapons-and-ammo"),
  loadReferenceMap("equipment"),
);

function normalizedFeatureName(name) {
  return String(name || "")
    .replace(/[†‡*]+/g, "")
    .replace(/\s+B(?=\s|,|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function equipmentReferenceFor(name) {
  const normalized = normalizedFeatureName(name)
    .replace(/^improved\s+/i, "")
    .replace(/^\+\d+\s+/, "")
    .replace(/\b(?:axiomatic|flaming|unholy|keen|masterwork|magic|icy burst|wounding)\b/gi, "")
    .replace(/\bof wounding\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (equipmentReferences.has(normalized)) return equipmentReferences.get(normalized);
  for (const [equipmentName, reference] of equipmentReferences) {
    if (normalized.endsWith(` ${equipmentName}`) || normalized.includes(equipmentName)) return reference;
  }
  return null;
}

function legacyReferenceFor(name) {
  const normalized = name.replace(/[B*†‡]+$/g, "").trim().toLowerCase();
  const withoutQualifier = normalized.replace(/\s*\([^)]*\)$/, "");
  const direct = featReferences.get(normalized) || spellReferences.get(normalized)
    || featReferences.get(withoutQualifier) || spellReferences.get(withoutQualifier);
  if (direct) return direct;
  if (/^spell-like abilities?\b/.test(withoutQualifier)) return creatureRuleReference("capability", "Spell-Like Abilities");
  if (/^spells?\b/.test(withoutQualifier)) return creatureRuleReference("capability", "Monster Spellcasting");
  if (/^summon\b/.test(withoutQualifier)) return creatureRuleReference("capability", "Summoning Creatures");
  return null;
}

function referenceFor(name) {
  const normalized = normalizedFeatureName(name).toLowerCase();
  const withoutQualifier = normalized.replace(/\s*\([^)]*\)$/, "");
  const direct = featReferences.get(normalized) || spellReferences.get(normalized)
    || featReferences.get(withoutQualifier) || spellReferences.get(withoutQualifier);
  if (direct) return direct;
  if (/^spell-like abilities?\b/.test(withoutQualifier)) return creatureRuleReference("capability", "Spell-Like Abilities");
  if (/^spells?\b(?!\s+resistance)/.test(withoutQualifier)) return creatureRuleReference("capability", "Monster Spellcasting");
  if (/^summon\b/.test(withoutQualifier)) return creatureRuleReference("capability", "Summoning Creatures");
  return null;
}

const exampleTemplates = {
  "Fel Orc": "Corrupted Creature Template",
  "Elite Dark Iron Rifleman": "Elite Creature Template",
  "Ghostly Warrior": "Ghost Template",
  "Human Lich": "Lich Template",
  Mechanostrider: "Mechanized Animal Template",
  "Risen Warrior": "Risen Template",
  "Skeletal Warrior": "Skeletal Creature Template",
  "Rot Hide Gnoll": "Withered Creature Template",
  "Human Zombie": "Zombie Template",
  "Nerubian Worker Crypt Fiend": "Crypt Fiend Template",
};

function makeActor(record) {
  const fields = record.fields;
  const actorId = existingIds.get(record.name) || hashId(`actor:${record.name}`);
  const hd = parseHd(fields["Hit Dice"]);
  const ac = parseAc(fields["Armor Class"]);
  const { bab, grapple } = parseBab(fields["Base Attack/Grapple"]);
  const saves = parseSaves(fields.Saves);
  const abilities = parseAbilities(fields.Abilities);
  const cr = parseCr(fields["Challenge Rating"], record.kind);
  const parsedType = parseType(record.typeLine);
  const speed = parseSpeeds(fields.Speed);
  const senses = parseSenses(fields["Special Qualities"]);
  const passiveDefenses = parsePassiveDefenses(fields["Special Qualities"]);
  const skills = parseSkills(fields.Skills, abilities);
  const progression = typeProgressions[parsedType.typeKey] || typeProgressions.humanoid;
  const sourcePages = record.printedPages;
  const itemIds = [];
  const embedded = [];

  const changes = [
    [String(hd.hp), "misc", "mhp", "replace"],
    [String(bab), "misc", "babattack", "base-replace"],
    [String(ac.total), "ac", "pac", "replace"],
    [String(ac.touch), "ac", "tch", "replace"],
    [String(ac.flat), "ac", "ffac", "replace"],
    [String(saves.fort), "savingThrows", "fort", "replace"],
    [String(saves.ref), "savingThrows", "ref", "replace"],
    [String(saves.will), "savingThrows", "will", "replace"],
  ];
  for (const [key, data] of Object.entries(speed)) changes.push([String(data.base), "speed", `${key}Speed`, "base-replace"]);
  const initiativeDelta = signed(fields.Initiative) - abilities.dex.mod;
  if (initiativeDelta) changes.push([String(initiativeDelta), "misc", "init", "untyped"]);
  for (const pool of hd.pools) {
    const primaryPool = pool.index === 0;
    const poolLabel = hd.pools.length > 1 ? ` (${pool.expression} pool)` : "";
    const classItem = itemShell(
      primaryPool ? hashId(`${record.name}:hit-dice`) : hashId(`${record.name}:hit-dice:${pool.index}:${pool.expression}`),
      `${parsedType.typeName} Hit Dice${poolLabel}`,
      "class",
      "icons/svg/book.svg",
    );
    classItem.system = {
      automaticFeatures: false,
      bab: progression[1],
      changeFlags: { noCon: abilities.con.isZero, noInt: abilities.int.isZero },
      // Printed totals are actor-wide overrides and must be applied exactly once.
      changes: primaryPool ? changes : [],
      classType: "racial",
      creatureType: parsedType.typeKey,
      damageReduction: primaryPool ? passiveDefenses.damageReduction : [],
      hd: pool.die,
      hp: 0,
      levels: pool.count,
      maxLevel: Math.max(pool.count, 50),
      resistances: primaryPool ? passiveDefenses.resistances : [],
      savingThrows: { fort: { value: progression[2] }, ref: { value: progression[3] }, will: { value: progression[4] } },
      skillsPerLevel: 0,
      source: `World of Warcraft: Monster Guide, p. ${sourcePages.join("-")}`,
    };
    classItem.flags.warcraftrpg2e = {
      bestiary: {
        hdPool: { count: pool.count, die: pool.die, expression: pool.expression, index: pool.index },
      },
    };
    embedded.push(classItem);
  }

  const standardAttacks = parseAttackEntries(fields.Attack);
  const fullAttackOptions = splitAttackOptions(fields["Full Attack"]).map((raw) => ({
    raw,
    attacks: parseAttackEntries(raw).map((attack) => {
      if (attack.bonuses.length) return attack;
      const standard = standardAttacks.find((candidate) => attackKey(candidate.name) === attackKey(attack.name));
      return standard ? { ...attack, automatic: false, bonuses: standard.bonuses, kind: standard.kind } : attack;
    }),
  }));
  const fullAttacks = fullAttackOptions.flatMap((option) => option.attacks);
  const attackItems = [];
  for (const attack of [...standardAttacks, ...fullAttacks]) {
    const signature = `${attackKey(attack.name)}:${attack.bonuses[0] ?? "automatic"}:${attack.damage}`;
    if (attackItems.some((entry) => entry.signature === signature)) continue;
    attackItems.push({ signature, attack, item: makeAttackItem(record.name, attack, bab, parsedType.size) });
  }
  embedded.push(...attackItems.map((entry) => entry.item));

  if (isMeaningful(fields["Full Attack"])) {
    fullAttackOptions.forEach((option, optionIndex) => {
      const linked = option.attacks.map((attack) => {
        const exact = attackItems.find((entry) => entry.signature === `${attackKey(attack.name)}:${attack.bonuses[0] ?? "automatic"}:${attack.damage}`);
        return exact ? { attack, item: exact.item } : { attack, item: makeAttackItem(record.name, attack, bab, parsedType.size) };
      });
      embedded.push(makeFullAttack(record.name, option.raw, linked, optionIndex, fullAttackOptions.length));
    });
  }

  const magic = buildMonsterMagic({
    root,
    actorName: record.name,
    config: monsterMagic[record.name],
    abilities,
    hitDice: hd.levels,
    sourcePages,
    hashId,
    spellSources: monsterSpellSources,
  });
  embedded.push(...magic.items);

  for (const [category, value] of [["Special Attack", fields["Special Attacks"]], ["Special Quality", fields["Special Qualities"]]]) {
    for (const raw of topLevelSplit(value)) {
      const name = raw.replace(/\s*\([^)]*(?:DC\s*)?\d+[^)]*\)\s*$/i, "").trim();
      embedded.push(makeFeature(record.name, name, category, raw, sourcePages, referenceFor(name)));
    }
  }
  for (const raw of topLevelSplit(fields.Feats).map(normalizedFeatureName)) {
    const name = raw.replace(/[B*†‡]+$/g, "").trim();
    embedded.push(makeFeature(record.name, name, "Feat", raw, sourcePages, referenceFor(name)));
  }
  embedded.push(makeFeature(
    record.name,
    `${parsedType.typeName} Traits`,
    "Creature Type",
    `${record.typeLine}; use the reusable creature-type record for shared immunities, senses, proficiencies, and life-cycle rules`,
    sourcePages,
    creatureRuleReference("type", parsedType.typeName),
  ));
  for (const subtype of parsedType.subtypes) {
    embedded.push(makeFeature(
      record.name,
      `${subtype} Subtype Traits`,
      "Creature Subtype",
      `${subtype} subtype; use the reusable subtype record for shared rules and the actor's printed totals for exceptions`,
      sourcePages,
      creatureRuleReference("subtype", `${subtype} Subtype`),
    ));
  }
  if (exampleTemplates[record.name]) {
    const templateName = exampleTemplates[record.name];
    embedded.push(makeFeature(
      record.name,
      templateName,
      "Applied Template",
      templateName,
      sourcePages,
      creatureRuleReference("template", templateName),
    ));
  }

  const uniqueEmbedded = [];
  const usedIds = new Set();
  for (const item of embedded) {
    if (usedIds.has(item._id)) continue;
    usedIds.add(item._id);
    uniqueEmbedded.push(item);
    itemIds.push(item._id);
  }
  const rulesCoverage = uniqueEmbedded
    .filter((item) => item.type === "feat")
    .reduce((counts, item) => {
      const mode = item.flags?.warcraftrpg2e?.bestiary?.automation || "manual";
      counts[mode] = (counts[mode] || 0) + 1;
      return counts;
    }, { "actor-defense": 0, "linked-reference": 0, manual: 0 });

  const noteRows = [
    ["Hit Dice", fields["Hit Dice"]], ["Initiative", fields.Initiative], ["Speed", fields.Speed],
    ["Armor Class", fields["Armor Class"]], ["Base Attack/Grapple", fields["Base Attack/Grapple"]],
    ["Attack", fields.Attack], ["Full Attack", fields["Full Attack"]], ["Space/Reach", fields["Space/Reach"]],
    ["Special Attacks", fields["Special Attacks"]], ["Special Qualities", fields["Special Qualities"]],
    ["Saves", fields.Saves], ["Abilities", fields.Abilities], ["Skills", fields.Skills], ["Feats", fields.Feats],
    ["Area", fields.Area], ["Organization", fields.Organization], ["Treasure", fields.Treasure],
    ["Advancement", fields.Advancement], ["Level Adjustment", fields["Level Adjustment"]],
  ].filter(([, value]) => value);

  const deathRule = parsedType.typeKey === "construct"
    ? "warcraft-construct"
    : parsedType.typeKey === "undead"
      ? "warcraft-undead"
      : "warcraft";
  const actor = {
    _embedded: { items: uniqueEmbedded },
    _id: actorId,
    effects: [],
    flags: {
      warcraftrpg2e: {
        source: {
          book: "World of Warcraft: Monster Guide",
          file: "docs/WoW - Monster Guide [2007] {WW17212}.pdf",
          pdfPages: record.pdfPages,
          printedPages: record.printedPages,
          section: record.name,
          verification: record.verification,
        },
        bestiary: {
          completeStatblock: true,
          kind: record.kind || "creature",
          magic: magic.coverage,
          rawFields: fields,
          rulesCoverage,
          subtypes: parsedType.subtypes,
        },
      },
    },
    folder: null,
    img: "icons/svg/mystery-man.svg",
    items: itemIds,
    name: record.name,
    ownership: { default: 0 },
    sort: 0,
    system: {
      abilities,
      attributes: {
        ac: { flatFooted: { total: ac.flat, value: 0 }, normal: { total: ac.total, value: 0 }, touch: { total: ac.touch, value: 0 } },
        attack: { bullrush: 0, general: 0, melee: 0, ranged: 0, sunder: 0 },
        bab: { base: bab, nonepic: bab, total: bab, value: 0 },
        cmb: { total: grapple, value: 0 },
        cmd: { flatFootedTotal: 0, total: 0, value: 0 },
        creatureType: parsedType.typeKey,
        damage: { general: 0, spell: 0, weapon: 0 },
        deathRule,
        energyDrain: 0,
        fortification: { total: /construct traits|undead traits|plant traits|ooze traits|elemental traits/i.test(fields["Special Qualities"] || "") ? 100 : 0, value: 0 },
        hd: { racialClass: hd.levels, total: hd.levels },
        hp: { base: hd.hp, max: hd.hp, min: ["construct", "undead"].includes(parsedType.typeKey) ? 0 : -(abilities.con.value || 10), nonlethal: 0, temp: 0, value: hd.hp },
        init: { bonus: 0, total: signed(fields.Initiative), value: 0 },
        maxAoO: 1,
        naturalAC: 0,
        naturalACTotal: ac.natural,
        savingThrows: { fort: { base: saves.fort, total: saves.fort }, ref: { base: saves.ref, total: saves.ref }, will: { base: saves.will, total: saves.will } },
        senses,
        speed,
        sr: { formula: passiveDefenses.spellResistance ? String(passiveDefenses.spellResistance) : "", total: passiveDefenses.spellResistance },
        ...(magic.spellAttributes ? { spells: magic.spellAttributes } : {}),
      },
      details: {
        alignment: fields.Alignment || "",
        biography: { public: "", value: `<p>${escapeHtml(record.name)} is provided as a complete mechanical statblock conversion. Descriptive setting prose and book artwork are intentionally not reproduced.</p>` },
        cr: cr ?? 0,
        environment: fields.Environment || "",
        level: { available: 0, max: Math.max(hd.levels, 50), min: hd.levels, value: hd.levels },
        notes: {
          public: "",
          value: `<h2>Printed Statblock</h2>${noteRows.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`).join("")}<p><strong>Manual boundary:</strong> situational targeting, tactical decisions, and exceptional special abilities remain GM-adjudicated unless an embedded item provides a roll or effect.</p>`,
        },
        totalCr: cr ?? 0,
        type: parsedType.typeName,
      },
      skills,
      traits: {
        actualSize: parsedType.size,
        ci: { custom: "", value: [] },
        di: { custom: "", value: [] },
        fastHealing: passiveDefenses.fastHealing,
        fastHealingTotal: passiveDefenses.fastHealing,
        regen: passiveDefenses.regeneration,
        regenTotal: passiveDefenses.regeneration,
        senses: fields["Special Qualities"] || "",
        size: parsedType.size,
        tokensize: "actor",
      },
    },
    type: "npc",
  };
  return actor;
}

function makePreservedHarvest(record) {
  const actor = structuredClone(preservedHarvest);
  actor.flags ||= {};
  actor.flags.warcraftrpg2e ||= {};
  actor.flags.warcraftrpg2e.source = {
    ...actor.flags.warcraftrpg2e.source,
    file: "docs/WoW - Monster Guide [2007] {WW17212}.pdf",
    pdfPages: record.pdfPages,
    printedPages: record.printedPages,
    verification: "visually-reviewed-complete-statblock",
  };
  actor.flags.warcraftrpg2e.bestiary = {
    completeStatblock: true,
    kind: record.kind || "creature",
    rawFields: record.fields,
    subtypes: ["Golem"],
  };
  return actor;
}

for (const file of fs.readdirSync(packDir).filter((file) => file.endsWith(".json") && file !== ".index.json")) {
  fs.unlinkSync(path.join(packDir, file));
}

const documents = catalog.map((record) => record.name === "Harvest Golem" ? makePreservedHarvest(record) : makeActor(record));
for (const document of documents) {
  const filename = `${slugify(document.name)}-${document._id.toLowerCase()}.json`;
  fs.writeFileSync(path.join(packDir, filename), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

const index = documents
  .map((document) => {
    const childKeyByCollection = { items: {} };
    for (const item of document._embedded?.items || []) childKeyByCollection.items[item._id] = `!actors.items!${document._id}.${item._id}`;
    return {
      childKeyByCollection,
      embeddedCollections: ["items"],
      file: `${slugify(document.name)}-${document._id.toLowerCase()}.json`,
      key: `!actors!${document._id}`,
    };
  })
  .sort((a, b) => a.file.localeCompare(b.file));
fs.writeFileSync(path.join(packDir, ".index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");

console.log(`Generated ${documents.length} Monster Guide actor records (${documents.reduce((total, document) => total + document.items.length, 0)} embedded items).`);
