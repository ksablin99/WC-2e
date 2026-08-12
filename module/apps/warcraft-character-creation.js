import {
  WARCRAFT_CREATION_STEPS,
  firstLevelSkillPoints,
  pointBuySpent,
  skillPointCost,
  summarizeCharacterCreation,
  validateCharacterCreationPlan,
  validateSkillAllocation,
} from "../actor/helpers/warcraftCharacterCreation.js";
import { validateWarcraftFeatAcquisition } from "../item/helpers/warcraftFeatRequirements.js";

const PACKS = Object.freeze({
  races: "warcraftrpg2e.warcraft-races",
  classes: "warcraftrpg2e.warcraft-classes",
  feats: "warcraftrpg2e.warcraft-feats",
  spells: "warcraftrpg2e.warcraft-spells",
  equipment: "warcraftrpg2e.warcraft-equipment",
});

// The actor schema retains retired 3.5e skills so old worlds remain readable.
// Only the consolidated Warcraft skill list belongs in new-character creation.
const CREATION_SKILLS = Object.freeze([
  "apr", "blc", "blf", "clm", "coc", "crf", "ctd", "dsc", "dip", "dev", "dis", "esc", "fog", "gif",
  "han", "hea", "hid", "int", "jmp", "kar", "klo", "kmt", "kna", "kno", "kpl", "kre", "lis", "opl", "prf", "pro",
  "pmc", "rid", "src", "sen", "slt", "spk", "spl", "spt", "sur", "swm", "tmb", "umd", "uro", "utd",
]);

const INDEX_FIELDS = Object.freeze([
  "type",
  "img",
  "system.classType",
  "system.classSkills",
  "system.classPaths",
  "system.hd",
  "system.hp",
  "system.levels",
  "system.skillsPerLevel",
  "system.bab",
  "system.hasSpellbook",
  "system.spellsPerLevel",
  "system.learnedAt",
  "system.level",
  "system.price",
  "system.featType",
  "flags.warcraftrpg2e",
]);

function idOf(entry) {
  return entry?.id ?? entry?._id ?? "";
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function sortByName(entries) {
  return entries.sort((left, right) => String(left.name).localeCompare(String(right.name), game.i18n.lang));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function itemPrice(item) {
  const price = item?.system?.price;
  if (typeof price === "number" || typeof price === "string") return Math.max(0, number(price));
  return Math.max(0, number(price?.value ?? price?.gp));
}

function abilityModifier(score) {
  return Math.floor((number(score, 10) - 10) / 2);
}

function selectedSet(values) {
  return new Set(Array.isArray(values) ? values : []);
}

function firstLevelSpellLimits(classEntry) {
  const firstRow = classEntry?.system?.spellsPerLevel?.[0]?.value ?? classEntry?.system?.spellsPerLevel?.[0];
  if (!Array.isArray(firstRow)) return { 0: 0, 1: 0 };
  return {
    0: Math.max(0, number(firstRow[1])),
    1: Math.max(0, number(firstRow[2])),
  };
}

function spellAssignment(spell, classEntry, classPath) {
  if (!classEntry?.system?.hasSpellbook) return null;
  const className = normalize(classEntry.name);
  const pathName = normalize(classPath);
  const assignments = Array.isArray(spell?.system?.learnedAt?.class) ? spell.system.learnedAt.class : [];
  const normalized = assignments.map((entry) => ({
    name: normalize(Array.isArray(entry) ? entry[0] : entry?.name),
    level: Math.max(0, Math.trunc(number(Array.isArray(entry) ? entry[1] : entry?.level))),
  }));
  const path = normalized.find((entry) => pathName && entry.name === pathName && entry.level <= 1);
  const parent = normalized.find((entry) => entry.name === className && entry.level <= 1);
  return path ?? parent ?? null;
}

function spellSelectionErrors(selected, available, limits) {
  const levels = new Map(available.map((spell) => [idOf(spell), spell.creationLevel]));
  const counts = { 0: 0, 1: 0 };
  let unavailable = 0;
  for (const id of selected) {
    const level = levels.get(id);
    if (level === undefined) unavailable += 1;
    if (level === 0 || level === 1) counts[level] += 1;
  }
  const errors = [];
  if (unavailable) errors.push(game.i18n.localize("D35E.WarcraftCreationUnavailableSpell"));
  for (const level of [0, 1]) {
    if (counts[level] > limits[level]) {
      errors.push(game.i18n.format("D35E.WarcraftCreationTooManySpells", { level, selected: counts[level], maximum: limits[level] }));
    }
  }
  return errors;
}

function virtualActorForPlan(actor, plan, race, classEntry, selectedFeats = []) {
  const abilities = Object.fromEntries(Object.entries(plan.abilities).map(([key, value]) => [key, { value, total: value }]));
  const skills = Object.fromEntries(Object.entries(actor.system.skills ?? {}).map(([key, skill]) => [key, {
    ...skill,
    points: number(plan.skills[key]),
    rank: number(plan.skills[key]),
  }]));
  const bab = classEntry?.system?.bab === "high" ? 1 : 0;
  return {
    system: {
      abilities,
      skills,
      attributes: { bab: { total: bab, value: bab }, hd: { total: 1 } },
      details: { level: { value: 1 } },
      traits: { size: race?.flags?.warcraftrpg2e?.race?.size ?? "med" },
    },
    items: [
      race && { ...race, type: "race", system: { ...race.system, levels: 0 } },
      classEntry && { ...classEntry, type: "class", system: { ...classEntry.system, levels: 1 } },
      ...selectedFeats,
    ].filter(Boolean),
  };
}

async function packIndex(packId) {
  const pack = game.packs.get(packId);
  if (!pack) throw new Error(game.i18n.format("D35E.WarcraftCreationMissingPack", { pack: packId }));
  const index = await pack.getIndex({ fields: INDEX_FIELDS });
  return Array.from(index?.values?.() ?? index ?? []);
}

function toImportData(document, packId) {
  const data = document.toObject();
  delete data._id;
  data.system = data.system ?? {};
  data.system.originPack = packId;
  data.system.originId = document.id;
  return data;
}

function goldToCurrency(gold) {
  let cp = Math.max(0, Math.round(number(gold) * 100));
  const gp = Math.floor(cp / 100); cp -= gp * 100;
  const sp = Math.floor(cp / 10); cp -= sp * 10;
  return { pp: 0, gp, sp, cp };
}

/** Guided, validation-first first-level Warcraft character builder. */
export class WarcraftCharacterCreation extends FormApplication {
  constructor(actor, options = {}) {
    super(actor, options);
    this.actor = actor;
    this.stepIndex = 0;
    this.choices = null;
    this.loadErrors = [];
    this.plan = {
      raceId: "",
      classId: "",
      classPath: "",
      racialLevelsPlanned: 0,
      pointBuyBudget: 25,
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      skills: {},
      featIds: [],
      spellIds: [],
      equipmentIds: [],
      startingGold: 100,
      equipmentCost: 0,
      gender: actor.system.details?.gender ?? "",
      deity: actor.system.details?.deity ?? "",
      affiliation: actor.system.details?.affiliation ?? "",
      affiliationRating: actor.system.details?.affiliationRating ?? 0,
    };
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "warcraft-character-creation",
      classes: ["D35E", "warcraft-character-creation"],
      title: "Warcraft Character Builder",
      template: "systems/warcraftrpg2e/templates/apps/warcraft-character-creation.html",
      width: 900,
      height: 780,
      resizable: true,
      closeOnSubmit: false,
      submitOnClose: false,
    });
  }

  async _loadChoices() {
    if (this.choices) return;
    const results = await Promise.allSettled(Object.entries(PACKS).map(async ([key, pack]) => [key, await packIndex(pack)]));
    const loaded = Object.fromEntries(Object.keys(PACKS).map((key) => [key, []]));
    for (const result of results) {
      if (result.status === "rejected") this.loadErrors.push(result.reason?.message ?? String(result.reason));
      else loaded[result.value[0]] = result.value[1];
    }
    this.choices = {
      races: sortByName(loaded.races.filter((entry) => entry.type === "race")),
      classes: sortByName(loaded.classes.filter((entry) => entry.type === "class" && entry.system?.classType === "base")),
      feats: sortByName(loaded.feats.filter((entry) => entry.type === "feat" && entry.system?.featType === "feat")),
      spells: sortByName(loaded.spells.filter((entry) => entry.type === "spell")),
      equipment: sortByName(loaded.equipment.filter((entry) => ["weapon", "equipment", "loot", "consumable", "technology"].includes(entry.type))),
    };
  }

  _selected(type, id) {
    return this.choices?.[type]?.find((entry) => idOf(entry) === id) ?? null;
  }

  _context() {
    const race = this._selected("races", this.plan.raceId);
    const classEntry = this._selected("classes", this.plan.classId);
    const human = normalize(race?.name) === "human";
    const classSkills = classEntry?.system?.classSkills ?? {};
    return {
      race,
      classEntry,
      human,
      classSkills,
      skillPoints: firstLevelSkillPoints({
        skillsPerLevel: classEntry?.system?.skillsPerLevel ?? 2,
        intellect: this.plan.abilities.int,
        human,
      }),
      featSlots: human ? 2 : 1,
      classPaths: classEntry?.system?.classPaths ?? { enabled: false, choices: [] },
      racialLevelMax: race?.flags?.warcraftrpg2e?.race?.racialLevel?.max ?? 0,
    };
  }

  _availableSpells(context) {
    return this.choices.spells.map((spell) => {
      const assignment = spellAssignment(spell, context.classEntry, this.plan.classPath);
      return assignment ? { ...spell, creationLevel: assignment.level, creationPath: assignment.name } : null;
    }).filter(Boolean);
  }

  _equipmentCost() {
    const selected = selectedSet(this.plan.equipmentIds);
    return this.choices.equipment.reduce((total, item) => total + (selected.has(idOf(item)) ? itemPrice(item) : 0), 0);
  }

  _featValidation(context) {
    const errors = [];
    const warnings = [];
    const selected = this.plan.featIds.map((id) => this._selected("feats", id)).filter(Boolean);
    for (const feat of selected) {
      const otherSelected = selected.filter((candidate) => idOf(candidate) !== idOf(feat));
      const actor = virtualActorForPlan(this.actor, this.plan, context.race, context.classEntry, otherSelected);
      const result = validateWarcraftFeatAcquisition(feat, actor);
      errors.push(...result.errors);
      warnings.push(...result.manual.map((requirement) => game.i18n.format("D35E.WarcraftCreationManualFeat", { feat: feat.name, requirement })));
    }
    return { errors, warnings };
  }

  _validation() {
    const context = this._context();
    this.plan.equipmentCost = this._equipmentCost();
    const base = validateCharacterCreationPlan(this.plan, context);
    const feat = this._featValidation(context);
    const availableSpells = this._availableSpells(context);
    const spellErrors = spellSelectionErrors(this.plan.spellIds, availableSpells, firstLevelSpellLimits(context.classEntry));
    const errorsByStep = {
      identity: base.errors.filter((error) => /race|class path|starting class|racial levels/i.test(error)),
      abilities: base.errors.filter((error) => /must be between|point buy/i.test(error)),
      skills: base.skillPoints.errors,
      feats: [
        ...base.errors.filter((error) => /starting feat/i.test(error)),
        ...feat.errors,
      ],
      spellsEquipment: [
        ...base.errors.filter((error) => /equipment costs/i.test(error)),
        ...spellErrors,
      ],
      review: [],
    };
    errorsByStep.review = Object.values(errorsByStep).flat().filter((value, index, all) => all.indexOf(value) === index);
    return {
      valid: errorsByStep.review.length === 0 && this.loadErrors.length === 0,
      errorsByStep,
      warnings: [...base.warnings, ...feat.warnings, ...this.loadErrors],
      context,
      availableSpells,
    };
  }

  async getData() {
    await this._loadChoices();
    const validation = this._validation();
    const context = validation.context;
    const step = WARCRAFT_CREATION_STEPS[this.stepIndex];
    const featIds = selectedSet(this.plan.featIds);
    const spellIds = selectedSet(this.plan.spellIds);
    const equipmentIds = selectedSet(this.plan.equipmentIds);
    const race = context.race;
    const classEntry = context.classEntry;
    const classPaths = context.classPaths?.enabled ? context.classPaths.choices ?? [] : [];
    const spellLimits = firstLevelSpellLimits(classEntry);
    const names = {
      race: race?.name,
      className: classEntry?.name,
      classPath: classPaths.find((path) => path.id === this.plan.classPath)?.name,
    };
    const existingFoundation = Array.from(this.actor.items ?? []).some((item) => item.type === "race" || item.type === "class");
    return {
      actor: this.actor,
      plan: this.plan,
      steps: Object.fromEntries(WARCRAFT_CREATION_STEPS.map((key, index) => [key, { active: index === this.stepIndex, complete: index < this.stepIndex }])),
      stepNumber: this.stepIndex + 1,
      stepCount: WARCRAFT_CREATION_STEPS.length,
      canBack: this.stepIndex > 0,
      canNext: this.stepIndex < WARCRAFT_CREATION_STEPS.length - 1,
      canComplete: this.stepIndex === WARCRAFT_CREATION_STEPS.length - 1 && validation.valid && !existingFoundation,
      existingFoundation,
      races: this.choices.races,
      classes: this.choices.classes,
      classPaths,
      hasClassPaths: classPaths.length > 0,
      abilities: Object.entries(CONFIG.D35E.abilities).map(([key, label]) => ({
        key,
        label,
        value: this.plan.abilities[key],
        modifier: abilityModifier(this.plan.abilities[key]),
      })),
      pointBuySpent: pointBuySpent(this.plan.abilities),
      pointBuyRemaining: this.plan.pointBuyBudget - pointBuySpent(this.plan.abilities),
      skillPoints: context.skillPoints,
      skillPointsSpent: skillPointCost(this.plan.skills, context.classSkills),
      skills: CREATION_SKILLS.filter((key) => this.actor.system.skills?.[key]).map((key) => ({
        key,
        label: CONFIG.D35E.skills[key] ?? key,
        value: number(this.plan.skills[key]),
        classSkill: context.classSkills[key] === true,
        maximum: context.classSkills[key] === true ? 4 : 2,
        cost: context.classSkills[key] === true ? 1 : 2,
      })),
      featSlots: context.featSlots,
      feats: this.choices.feats.map((feat) => ({
        ...feat,
        checked: featIds.has(idOf(feat)),
        prerequisite: feat.flags?.warcraftrpg2e?.feat?.prerequisite ?? "",
      })),
      spells: validation.availableSpells.map((spell) => ({ ...spell, checked: spellIds.has(idOf(spell)) })),
      hasSpells: validation.availableSpells.length > 0,
      spellLimits,
      spellLimit0: spellLimits[0],
      spellLimit1: spellLimits[1],
      equipment: this.choices.equipment.map((item) => ({ ...item, checked: equipmentIds.has(idOf(item)), displayPrice: itemPrice(item) })),
      equipmentRemaining: number(this.plan.startingGold) - this.plan.equipmentCost,
      errors: validation.errorsByStep[step] ?? [],
      reviewErrors: validation.errorsByStep.review,
      warnings: validation.warnings,
      summary: summarizeCharacterCreation(this.plan, names),
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
    root?.querySelectorAll?.("[data-warcraft-creation-action]").forEach((control) => {
      control.addEventListener("click", (event) => {
        event.preventDefault();
        void this._onAction(control.dataset.warcraftCreationAction, control, root);
      });
    });
    root?.querySelectorAll?.("select[name='raceId'], select[name='classId']").forEach((control) => {
      control.addEventListener("change", () => {
        this._capture(root);
        const paths = this._context().classPaths;
        if (paths?.enabled && !paths.choices?.some((choice) => choice.id === this.plan.classPath)) {
          this.plan.classPath = paths.default || paths.choices?.[0]?.id || "";
        }
        this.render(false);
      });
    });
    root?.querySelectorAll?.("[data-warcraft-filter]").forEach((control) => {
      control.addEventListener("input", () => {
        const list = root.querySelector(`#${control.dataset.warcraftFilter}`);
        const query = normalize(control.value).replace(/-/g, " ");
        list?.querySelectorAll?.("[data-warcraft-filter-text]").forEach((row) => {
          row.hidden = query && !normalize(row.dataset.warcraftFilterText).replace(/-/g, " ").includes(query);
        });
      });
    });
  }

  _capture(root) {
    const form = this.form ?? (root?.matches?.("form") ? root : root?.querySelector?.("form"));
    if (!form) return;
    const data = new FormData(form);
    for (const key of ["raceId", "classId", "classPath", "gender", "deity", "affiliation"]) {
      if (data.has(key)) this.plan[key] = String(data.get(key) ?? "");
    }
    for (const key of ["racialLevelsPlanned", "pointBuyBudget", "startingGold", "affiliationRating"]) {
      if (data.has(key)) this.plan[key] = number(data.get(key));
    }
    for (const key of Object.keys(this.plan.abilities)) {
      if (data.has(`abilities.${key}`)) this.plan.abilities[key] = number(data.get(`abilities.${key}`), 10);
    }
    for (const key of CREATION_SKILLS) {
      if (data.has(`skills.${key}`)) this.plan.skills[key] = number(data.get(`skills.${key}`));
    }
    for (const key of ["featIds", "spellIds", "equipmentIds"]) {
      if (form.querySelector(`[name='${key}']`)) this.plan[key] = data.getAll(key).map(String);
    }
    this.plan.equipmentCost = this._equipmentCost();
  }

  async _onAction(action, control, root) {
    this._capture(root);
    if (action === "ability") {
      const key = control.dataset.ability;
      const delta = number(control.dataset.delta);
      this.plan.abilities[key] = Math.max(8, Math.min(18, number(this.plan.abilities[key], 10) + delta));
      return this.render(false);
    }
    if (action === "back") {
      this.stepIndex = Math.max(0, this.stepIndex - 1);
      return this.render(false);
    }
    if (action === "next") {
      const step = WARCRAFT_CREATION_STEPS[this.stepIndex];
      const errors = this._validation().errorsByStep[step];
      if (errors.length) return ui.notifications.error(errors[0]);
      this.stepIndex = Math.min(WARCRAFT_CREATION_STEPS.length - 1, this.stepIndex + 1);
      return this.render(false);
    }
    if (action === "complete") return this._complete();
  }

  async _document(packKey, id) {
    return game.packs.get(PACKS[packKey])?.getDocument(id) ?? null;
  }

  async _complete() {
    const validation = this._validation();
    if (!validation.valid) return ui.notifications.error(validation.errorsByStep.review[0] ?? this.loadErrors[0]);
    if (Array.from(this.actor.items ?? []).some((item) => item.type === "race" || item.type === "class")) {
      return ui.notifications.error(game.i18n.localize("D35E.WarcraftCreationFreshActorOnly"));
    }

    const raceDocument = await this._document("races", this.plan.raceId);
    const classDocument = await this._document("classes", this.plan.classId);
    if (!raceDocument || !classDocument) return ui.notifications.error(game.i18n.localize("D35E.WarcraftCreationSourceMissing"));

    const raceData = toImportData(raceDocument, PACKS.races);
    const classData = toImportData(classDocument, PACKS.classes);
    classData.system.levels = 1;
    classData.system.hp = number(classData.system.hd, 1);
    if (classData.system.classPaths?.enabled) {
      classData.system.currentPath = this.plan.classPath;
      classData.system.pathLevels = Object.fromEntries(classData.system.classPaths.choices.map((path) => [path.id, path.id === this.plan.classPath ? 1 : 0]));
    }

    const foundation = await this.actor.createEmbeddedDocuments("Item", [raceData, classData], {
      _warcraftBypassFeatValidation: true,
      warcraftCharacterCreation: true,
    });
    const createdClass = foundation.find((item) => item.type === "class");
    if (!createdClass) throw new Error("Warcraft character creation could not create the starting class");

    const itemPlans = [
      ...this.plan.featIds.map((id) => ["feats", id]),
      ...this.plan.spellIds.map((id) => ["spells", id]),
      ...this.plan.equipmentIds.map((id) => ["equipment", id]),
    ];
    const imports = [];
    for (const [packKey, id] of itemPlans) {
      const document = await this._document(packKey, id);
      if (!document) continue;
      const data = toImportData(document, PACKS[packKey]);
      if (packKey === "spells") {
        const choice = validation.availableSpells.find((spell) => idOf(spell) === id);
        data.system.level = choice?.creationLevel ?? data.system.level;
        data.system.warcraftLearnedPath = choice?.creationPath ?? "";
        data.system.spellbook = "primary";
      }
      imports.push(data);
    }
    if (imports.length) {
      await this.actor.createEmbeddedDocuments("Item", imports, {
        _warcraftBypassFeatValidation: true,
        warcraftCharacterCreation: true,
      });
    }

    const skillRows = {};
    const update = {
      name: this.actor.name,
      "system.details.gender": this.plan.gender,
      "system.details.deity": this.plan.deity,
      "system.details.affiliation": this.plan.affiliation,
      "system.details.affiliationRating": this.plan.affiliationRating,
      "system.details.level.available": 1,
      "system.details.levelUpProgression": true,
      "flags.warcraftrpg2e.creation.completed": true,
      "flags.warcraftrpg2e.creation.racialLevelsPlanned": this.plan.racialLevelsPlanned,
    };
    for (const [key, value] of Object.entries(this.plan.abilities)) update[`system.abilities.${key}.value`] = value;
    for (const [key, value] of Object.entries(this.plan.skills)) {
      if (!number(value)) continue;
      const classSkill = validation.context.classSkills[key] === true;
      update[`system.skills.${key}.points`] = number(value);
      skillRows[key] = { points: classSkill ? number(value) : number(value) * 2, rank: number(value), cls: classSkill, subskills: {} };
    }
    Object.assign(update, Object.fromEntries(Object.entries(goldToCurrency(this.plan.startingGold - this.plan.equipmentCost)).map(([key, value]) => [`system.currency.${key}`, value])));
    update["system.details.levelUpData"] = [{
      level: 1,
      id: "_level1",
      classId: createdClass.id,
      class: createdClass.name,
      classImage: createdClass.img,
      path: this.plan.classPath || null,
      skills: skillRows,
      hp: number(createdClass.system.hd, 1),
      hasFeat: true,
      hasAbility: false,
    }];
    await this.actor.update(update, { warcraftCharacterCreation: true });
    ui.notifications.info(game.i18n.format("D35E.WarcraftCreationComplete", { actor: this.actor.name }));
    await this.close();
    this.actor.sheet?.render?.(false);
  }

  async _updateObject(_event, _formData) {
    // The wizard mutates its local plan while stepping. Only Complete writes.
  }
}
