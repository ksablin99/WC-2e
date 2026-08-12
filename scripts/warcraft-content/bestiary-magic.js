const fs = require("fs");
const path = require("path");

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function loadSpellDocuments(root, packName) {
  const directory = path.join(root, "source", packName);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((file) => file.endsWith(".json") && file !== ".index.json")
    .map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")))
    .filter((document) => document.type === "spell")
    .map((document) => ({ document, packName }));
}

function loadMonsterSpellSources(root) {
  const legacy = loadSpellDocuments(root, "spells");
  const warcraft = loadSpellDocuments(root, "warcraft-spells");
  const byName = new Map();
  // Warcraft records deliberately override an identically named SRD record.
  for (const entry of [...legacy, ...warcraft]) byName.set(normalizeName(entry.document.name), entry);
  return { byName, warcraft };
}

function makeItemShell(id, name, type, img = "icons/svg/aura.svg") {
  return {
    _id: id,
    effects: [],
    flags: {},
    folder: null,
    img,
    name,
    ownership: { default: 0 },
    sort: 0,
    system: {},
    type,
  };
}

function slotsFor(values = []) {
  const spells = {};
  for (let level = 0; level <= 9; level += 1) {
    const maximum = Math.max(0, Number(values[level]) || 0);
    spells[`spell${level}`] = { base: maximum, bonus: 0, known: 0, max: maximum, value: maximum };
  }
  return spells;
}

function emptySpecialSlots() {
  return Object.fromEntries(Array.from({ length: 10 }, (_, level) => [`level${level}`, null]));
}

function makeSpellbook({ name, casterLevel, ability, baseDCFormula, preparationMode, slots = [], poolKey = "" }) {
  const usesPool = Boolean(poolKey);
  return {
    name,
    class: "",
    cl: { base: casterLevel, value: 0, total: casterLevel, formula: "0" },
    concentration: 0,
    bonusPrestigeCl: 0,
    concentrationFormula: "",
    concentrationNotes: "",
    clNotes: "",
    ability,
    spellslotAbility: ability,
    autoSpellLevels: false,
    usePowerPoints: false,
    autoSetup: false,
    spellcastingType: "arcane",
    powerPointsFormula: "",
    dailyPowerPointsFormula: "",
    powerPoints: 0,
    powerPointsTotal: 0,
    maximumPowerPointLimit: "@cl",
    arcaneSpellFailure: false,
    baseDCFormula,
    spontaneous: false,
    preparationMode,
    repertoireSkill: "spl",
    repertoireLimitOverride: 0,
    usesWarcraftSlotPool: usesPool,
    warcraftPoolKey: poolKey,
    warcraftParentClass: "",
    warcraftCurrentPath: "",
    warcraftPathBonusSlot: false,
    specialSlotLevel0: false,
    hasSpecialSlot: false,
    showOnlyPrepared: false,
    specialSlots: emptySpecialSlots(),
    spells: slotsFor(slots),
  };
}

function sourceMetadata(actorName, sourcePages) {
  return {
    book: "World of Warcraft: Monster Guide",
    file: "docs/WoW - Monster Guide [2007] {WW17212}.pdf",
    pdfPages: sourcePages.map((page) => page + 1),
    printedPages: sourcePages,
    section: actorName,
    verification: "text+render",
  };
}

function usageLabel(sla) {
  return sla.frequency === "atWill" ? "At will" : `${Number(sla.uses) || 1}/day`;
}

function appendDescription(document, html) {
  document.system.description ||= {};
  document.system.description.value = `${document.system.description.value || ""}${html}`;
}

function cloneSla({ actorName, sla, source, casterLevel, charismaModifier, sourcePages, hashId }) {
  const item = structuredClone(source.document);
  const sourceSpellMetadata = structuredClone(item.flags?.warcraftrpg2e?.source || null);
  const uses = sla.frequency === "atWill" ? 0 : Math.max(1, Number(sla.uses) || 1);
  const spellLevel = Math.max(0, Number(item.system.level) || 0);
  const saveDC = Number.isFinite(Number(sla.dc)) ? Number(sla.dc) : 10 + spellLevel + charismaModifier;
  const displayName = `${sla.label || sla.name} (Sp)`;

  item._id = hashId(`${actorName}:sla:${sla.label || sla.name}:${usageLabel(sla)}`);
  item.name = displayName;
  item.img = "icons/svg/aura.svg";
  item.folder = null;
  item.sort = 0;
  item.system.identifiedName = displayName;
  item.system.spellbook = "spelllike";
  item.system.baseCl = String(casterLevel);
  item.system.clOffset = 0;
  item.system.atWill = sla.frequency === "atWill";
  item.system.specialPrepared = sla.frequency !== "atWill";
  item.system.activation = { cost: 1, type: "standard" };
  item.system.castTime = "1 standard action";
  item.system.components = {
    ...(item.system.components || {}),
    divineFocus: 0,
    focus: false,
    material: false,
    somatic: false,
    value: "",
    verbal: false,
  };
  item.system.preparation = {
    ...(item.system.preparation || {}),
    autoDeductCharges: true,
    maxAmount: uses,
    mode: "prepared",
    prepared: true,
    preparedAmount: uses,
  };
  item.system.uses = {
    ...(item.system.uses || {}),
    autoDeductCharges: true,
    chargesPerUse: 1,
    max: uses,
    per: sla.frequency === "atWill" ? "" : "day",
    value: uses,
  };
  item.system.save ||= {};
  item.system.save.dc = String(saveDC);
  item.system.source = `World of Warcraft: Monster Guide, p. ${sourcePages.join("-")}`;
  appendDescription(
    item,
    `<hr><p><strong>${escapeHtml(actorName)} spell-like ability:</strong> ${escapeHtml(usageLabel(sla))}; caster level ${casterLevel}${saveDC ? `; save DC ${saveDC} where applicable` : ""}. Spell-like abilities have no components and normally use a standard action.</p>${sla.note ? `<p><strong>Source exception:</strong> ${escapeHtml(sla.note)}</p>` : ""}`,
  );
  item.flags ||= {};
  item.flags.warcraftrpg2e = {
    ...(item.flags.warcraftrpg2e || {}),
    source: sourceMetadata(actorName, sourcePages),
    reference: {
      pack: `warcraftrpg2e.${source.packName}`,
      id: source.document._id,
      name: source.document.name,
    },
    monsterMagic: {
      kind: "sla",
      automation: "spell-clone",
      casterLevel,
      saveDC,
      frequency: sla.frequency,
      uses,
      sourceSpell: {
        pack: source.packName,
        id: source.document._id,
        source: sourceSpellMetadata,
      },
    },
  };
  return item;
}

function makeManualSla({ actorName, sla, casterLevel, sourcePages, hashId }) {
  const uses = sla.frequency === "atWill" ? 0 : Math.max(1, Number(sla.uses) || 1);
  const item = makeItemShell(
    hashId(`${actorName}:sla-manual:${sla.label || sla.name}:${usageLabel(sla)}`),
    `${sla.label || sla.name} (Sp)`,
    "feat",
  );
  const dcText = Number.isFinite(Number(sla.dc)) ? `; save DC ${Number(sla.dc)} where applicable` : "";
  item.system = {
    abilityType: "sp",
    activation: { cost: 1, type: "standard" },
    description: {
      value: `<p><strong>Spell-like ability:</strong> ${escapeHtml(usageLabel(sla))}; caster level ${casterLevel}${dcText}.</p>${sla.note ? `<p><strong>Source exception:</strong> ${escapeHtml(sla.note)}</p>` : ""}<p><strong>Resolution:</strong> The source spell is not present in the available core or system spell catalogues. Track the listed uses here; its effect remains GM-adjudicated from the cited private source, and no substitute effect has been invented.</p>`,
    },
    featType: "trait",
    source: `World of Warcraft: Monster Guide, p. ${sourcePages.join("-")}`,
    uniqueId: `wc-monster-${normalizeName(actorName).replace(/[^a-z0-9]+/g, "-")}-${normalizeName(sla.label || sla.name).replace(/[^a-z0-9]+/g, "-")}-sla`,
    uses: {
      autoDeductCharges: true,
      chargesPerUse: 1,
      max: uses,
      per: sla.frequency === "atWill" ? "" : "day",
      value: uses,
    },
  };
  item.flags.warcraftrpg2e = {
    source: sourceMetadata(actorName, sourcePages),
    bestiary: { automation: "manual", category: "Spell-Like Ability", raw: sla.name },
    monsterMagic: {
      kind: "sla",
      automation: "manual-missing-spell",
      casterLevel,
      saveDC: Number.isFinite(Number(sla.dc)) ? Number(sla.dc) : null,
      frequency: sla.frequency,
      uses,
    },
  };
  return item;
}

function matchingSpellLevel(document, lists = []) {
  const assignments = Array.isArray(document.system?.learnedAt?.class) ? document.system.learnedAt.class : [];
  const levels = [];
  for (const assignment of assignments) {
    const [name, level] = Array.isArray(assignment) ? assignment : [assignment?.name, assignment?.level];
    const list = lists.find((entry) => normalizeName(entry.name) === normalizeName(name));
    if (list && Number(level) <= Number(list.maxLevel)) levels.push(Number(level));
  }
  return levels.length ? Math.min(...levels) : null;
}

function clonePreparedSpell({ actorName, source, spellLevel, prepared, casterLevel, sourcePages, hashId }) {
  const item = structuredClone(source.document);
  const sourceSpellMetadata = structuredClone(item.flags?.warcraftrpg2e?.source || null);
  item._id = hashId(`${actorName}:monster-spell:${item.name}`);
  item.img = "icons/svg/aura.svg";
  item.folder = null;
  item.sort = 0;
  item.system.spellbook = "primary";
  item.system.level = spellLevel;
  item.system.baseCl = "0";
  item.system.clOffset = 0;
  item.system.atWill = false;
  item.system.specialPrepared = false;
  item.system.preparation = {
    ...(item.system.preparation || {}),
    autoDeductCharges: true,
    maxAmount: 0,
    mode: "repertoire",
    prepared,
    preparedAmount: 0,
  };
  item.system.save ||= {};
  item.system.save.dc = "0";
  item.system.source = `World of Warcraft: Monster Guide, p. ${sourcePages.join("-")}`;
  item.flags ||= {};
  item.flags.warcraftrpg2e = {
    ...(item.flags.warcraftrpg2e || {}),
    source: sourceMetadata(actorName, sourcePages),
    reference: {
      pack: `warcraftrpg2e.${source.packName}`,
      id: source.document._id,
      name: source.document.name,
    },
    monsterMagic: {
      kind: "spell",
      automation: item.system.warcraftManualPolicy?.mode === "manual" ? "manual-catalogue-spell" : "spell-clone",
      casterLevel,
      prepared,
      spellLevel,
      sourceSpell: {
        pack: source.packName,
        id: source.document._id,
        source: sourceSpellMetadata,
      },
    },
  };
  return item;
}

function makeSpellcastingSummary({ actorName, casting, sourcePages, hashId, regularSpellCount }) {
  const lists = casting.lists.map((entry) => `${entry.name} through level ${entry.maxLevel}`).join(", ");
  const ordinarySlots = casting.slots.slice(0, 10).map((value, level) => `${level}: ${value}`).join(", ");
  const epicSlots = casting.slots.slice(10).map((value, offset) => `${offset + 10}: ${value}`).join(", ");
  const preparedText = casting.prepared.length
    ? `${casting.prepared.length} source-named favorites are initially marked prepared; other eligible spells remain available for repertoire selection.`
    : "The source does not specify an exact prepared repertoire; eligible spells are imported unprepared for the GM to select.";
  const item = makeItemShell(hashId(`${actorName}:spellcasting-summary`), "Spellcasting Summary", "feat");
  item.system = {
    abilityType: "sp",
    description: {
      value: `<p>Casts at caster level ${casting.casterLevel}; save DC ${casting.dcBase} + spell level; preparation ability ${escapeHtml(casting.ability.toUpperCase())}. Accessible lists: ${escapeHtml(lists)}.</p><p><strong>Slots per day (levels 0-9):</strong> ${escapeHtml(ordinarySlots)}.</p><p><strong>Repertoire:</strong> up to ${casting.preparedLimit} distinct prepared spells at each spell level. ${escapeHtml(preparedText)}</p><p><strong>Imported catalogue:</strong> ${regularSpellCount} eligible spells are embedded on this actor.</p>${epicSlots ? `<p><strong>Epic slots (manual):</strong> ${escapeHtml(epicSlots)}. The current system slot engine ends at level 9, so these printed epic slots are recorded here but remain GM-managed.</p>` : ""}<p><strong>Shared rule:</strong> @UUID[Compendium.warcraftrpg2e.warcraft-creature-rules.Item.a2af9f319e850676]{Monster Spellcasting Traits}.</p>`,
    },
    featType: "trait",
    source: `World of Warcraft: Monster Guide, p. ${sourcePages.join("-")}`,
    uniqueId: `wc-monster-${normalizeName(actorName).replace(/[^a-z0-9]+/g, "-")}-spellcasting-summary`,
  };
  item.flags.warcraftrpg2e = {
    source: sourceMetadata(actorName, sourcePages),
    reference: {
      pack: "warcraftrpg2e.warcraft-creature-rules",
      id: "a2af9f319e850676",
      name: "Monster Spellcasting Traits",
    },
    bestiary: { automation: "linked-reference", category: "Monster Spellcasting", raw: lists },
    monsterMagic: {
      kind: "spellcasting-summary",
      automation: "spellbook",
      casterLevel: casting.casterLevel,
      preparedLimit: casting.preparedLimit,
      regularSpellCount,
      slots: casting.slots,
    },
  };
  return item;
}

/**
 * Build executable monster spell/SLA items and the actor spellbook overrides.
 * Unknown supplement powers deliberately become charged manual records rather
 * than guessed spell implementations.
 */
function buildMonsterMagic({ root, actorName, config, abilities, hitDice, sourcePages, hashId, spellSources }) {
  if (!config) return { items: [], spellAttributes: null, coverage: null };
  const sources = spellSources || loadMonsterSpellSources(root);
  const items = [];
  const coverage = { slaExecutable: 0, slaManual: 0, regularSpells: 0 };
  const spellbooks = {};
  const warcraftPools = {};

  if (Array.isArray(config.slas) && config.slas.length) {
    const casterLevel = Math.max(1, Number(config.slaCasterLevel) || Number(hitDice) || 1);
    const charismaModifier = Number(abilities?.cha?.mod) || 0;
    spellbooks.spelllike = makeSpellbook({
      name: "Spell-like Abilities",
      casterLevel,
      ability: "cha",
      baseDCFormula: "0",
      preparationMode: "prepared",
    });
    for (const sla of config.slas) {
      const source = sources.byName.get(normalizeName(sla.name));
      if (source) {
        items.push(cloneSla({ actorName, sla, source, casterLevel, charismaModifier, sourcePages, hashId }));
        coverage.slaExecutable += 1;
      } else {
        items.push(makeManualSla({ actorName, sla, casterLevel, sourcePages, hashId }));
        coverage.slaManual += 1;
      }
    }
  }

  if (config.spellcasting) {
    const casting = config.spellcasting;
    const prepared = new Set(casting.prepared.map(normalizeName));
    const regular = [];
    for (const source of sources.warcraft) {
      const spellLevel = matchingSpellLevel(source.document, casting.lists);
      if (spellLevel == null) continue;
      regular.push(clonePreparedSpell({
        actorName,
        source,
        spellLevel,
        prepared: prepared.has(normalizeName(source.document.name)),
        casterLevel: casting.casterLevel,
        sourcePages,
        hashId,
      }));
    }
    regular.sort((left, right) => left.system.level - right.system.level || left.name.localeCompare(right.name));
    items.push(...regular);
    coverage.regularSpells = regular.length;

    const poolKey = "monster-primary";
    const primary = makeSpellbook({
      name: "Monster Spellcasting",
      casterLevel: casting.casterLevel,
      ability: casting.ability,
      baseDCFormula: `${casting.dcBase} + @sl`,
      preparationMode: "repertoire",
      slots: casting.slots,
      poolKey,
    });
    primary.repertoireLimitOverride = casting.preparedLimit;
    spellbooks.primary = primary;
    warcraftPools[poolKey] = {
      key: poolKey,
      spellbooks: ["primary"],
      spells: Object.fromEntries(Object.entries(primary.spells).map(([key, slot]) => [key, { max: slot.max, value: slot.value }])),
    };
    items.push(makeSpellcastingSummary({
      actorName,
      casting,
      sourcePages,
      hashId,
      regularSpellCount: regular.length,
    }));
  }

  return {
    items,
    spellAttributes: { warcraftPools, spellbooks },
    coverage,
  };
}

module.exports = {
  buildMonsterMagic,
  loadMonsterSpellSources,
  matchingSpellLevel,
  normalizeName,
};
