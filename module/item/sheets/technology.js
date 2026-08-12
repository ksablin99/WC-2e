import { Roll35e } from "../../roll.js";
import { ItemSheetPF } from "./base.js";
import {
  FUNCTION_DIFFICULTY_BENCHMARKS,
  MALFUNCTION_EFFECTS,
  TECHNOLOGY_FEATURES,
  TECHNOLOGY_MATERIALS,
  TIME_UNITS,
  calculateAddOn,
  calculateCraftProgress,
  calculateMasterwork,
  calculateTechnologyDesign,
  checkMalfunction,
  technologicalLimitForDevice,
  technologyFeatBonuses,
  consumeTechnologySupply,
  favoredTechnologyCraftBonus,
  getTechnologyMalfunctionRule,
  maneuverabilityCheck,
  technologyPermanentModifiers,
  technologyOperationModifiers,
  technologyUsePenalty,
} from "../helpers/warcraftTechnology.js";

const DEVICE_SIZES = Object.freeze(["fine", "dim", "tiny", "sm", "med", "lg", "huge", "grg", "col"]);
const PERSISTENT_MALFUNCTIONS = new Set([
  "Mangled", "Leaky", "Inhibited function", "Degradation", "Balky", "Awkward operation", "Frangible", "Bulky",
  "Self-destructive", "Noisemaker", "Fused function", "Fragile", "Pain machine",
]);

function escape(value) {
  const text = String(value ?? "");
  return foundry.utils.escapeHTML?.(text) ?? text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function naturalD20(roll) {
  return Number(roll?.terms?.[0]?.results?.[0]?.result ?? 0) || null;
}

function skillTotal(actor, key) {
  const skill = actor?.system?.skills?.[key] ?? {};
  return Number(skill.mod ?? skill.total ?? skill.value ?? skill.rank ?? 0) || 0;
}

function hasProficiency(actor, required) {
  if (!required) return true;
  const wanted = String(required).toLowerCase();
  return Array.from(actor?.items ?? []).some((item) => item?.type === "feat" && item.name?.toLowerCase().includes(wanted));
}

function actorWealthCp(actor) {
  const currency = actor?.system?.currency ?? {};
  return (Number(currency.pp) || 0) * 1000 + (Number(currency.gp) || 0) * 100 + (Number(currency.sp) || 0) * 10 + (Number(currency.cp) || 0);
}

async function spendGold(actor, amountGp) {
  const costCp = Math.max(0, Math.round(Number(amountGp || 0) * 100));
  const total = actorWealthCp(actor);
  if (total < costCp) return false;
  let remaining = total - costCp;
  const pp = Math.floor(remaining / 1000); remaining -= pp * 1000;
  const gp = Math.floor(remaining / 100); remaining -= gp * 100;
  const sp = Math.floor(remaining / 10); remaining -= sp * 10;
  await actor.update({
    "system.currency.pp": pp,
    "system.currency.gp": gp,
    "system.currency.sp": sp,
    "system.currency.cp": remaining,
  });
  return true;
}

async function postDeviceRoll(item, roll, title, details = [], malfunction = null, extraRolls = []) {
  const detailHtml = details.filter(Boolean).map((detail) => `<li>${escape(detail)}</li>`).join("");
  const malfunctionHtml = malfunction?.malfunctioned
    ? `<p class="failure"><strong>${game.i18n.localize("D35E.WarcraftTechMalfunction")}:</strong> ${escape(malfunction.effect || item.system.malfunction.effect || game.i18n.localize("D35E.WarcraftTechStopped"))}</p>`
    : "";
  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor: item.actor }),
    content: `<div class="D35E chat-card warcraft-technology-card"><h3>${escape(title)}</h3><p><strong>${escape(item.name)}</strong>: ${roll.total}</p>${detailHtml ? `<ul>${detailHtml}</ul>` : ""}${malfunctionHtml}</div>`,
    rolls: [roll, ...extraRolls].filter(Boolean),
  });
}

function deviceDamageFormula(item) {
  const feature = Array.from(item.system.design?.features ?? []).find((entry) => entry.type === "damage");
  const formula = String(feature?.value ?? "").match(/\d+d\d+(?:\s*[+-]\s*\d+)?/i)?.[0];
  return formula || "";
}

function rangedAttackTotal(actor) {
  const system = actor?.system ?? {};
  const size = CONFIG.D35E.sizeMods?.[system.traits?.actualSize] ?? 0;
  return (Number(system.attributes?.bab?.total) || 0)
    + (Number(system.abilities?.dex?.mod) || 0)
    + Number(size)
    - (Number(system.attributes?.energyDrain) || 0)
    + (Number(system.attributes?.attack?.general) || 0)
    + (Number(system.attributes?.attack?.ranged) || 0);
}

function firstTargetArmorClass() {
  const target = Array.from(game.user?.targets ?? [])[0];
  const armorClass = Number(target?.actor?.system?.attributes?.ac?.normal?.total);
  return Number.isFinite(armorClass) ? { name: target.name, armorClass } : null;
}

async function postMalfunctionConsequence(item, effect, rule) {
  let formula = "";
  if (rule.immediateDamage === "3d6") formula = "3d6";
  if (rule.immediateDamage === "technologyScoreD6") formula = `${Math.max(1, Number(item.system.design?.technologyScore) || 1)}d6`;
  if (rule.immediateDamage === "device") formula = deviceDamageFormula(item);
  if (formula) {
    const roll = await new Roll35e(formula).roll();
    return ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: item.actor }),
      content: `<div class="D35E chat-card warcraft-technology-card"><h3>${escape(effect)}</h3><p>${escape(game.i18n.format("D35E.WarcraftTechMalfunctionDamage", { formula, radius: rule.radiusFeet || 0 }))}</p></div>`,
      rolls: [roll],
    });
  }
  if (rule.lockedRounds) {
    const roll = await new Roll35e(rule.lockedRounds).roll();
    return ChatMessage.create({
      user: game.user.id,
      speaker: ChatMessage.getSpeaker({ actor: item.actor }),
      content: `<div class="D35E chat-card warcraft-technology-card"><h3>${escape(effect)}</h3><p>${escape(game.i18n.localize("D35E.WarcraftTechFunctionLockHint"))}</p></div>`,
      rolls: [roll],
    });
  }
  return null;
}

export class TechnologySheet35E extends ItemSheetPF {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, { width: 720, height: 760, resizable: true });
  }

  async getData() {
    const sheetData = await super.getData();
    const system = this.item.system;
    sheetData.technology = calculateTechnologyDesign({
      ...system.design,
      malfunctionRating: system.malfunction.rating,
      randomMalfunction: system.malfunction.random,
      size: system.design.size,
      operationDc: system.operation.dc,
    });
    sheetData.technologyFeatures = Object.entries(TECHNOLOGY_FEATURES).map(([key, value]) => ({ key, label: value.label }));
    sheetData.technologyMaterials = Object.entries(TECHNOLOGY_MATERIALS).map(([key, value]) => ({ key, label: value.label }));
    sheetData.timeUnits = TIME_UNITS;
    sheetData.functionBenchmarks = FUNCTION_DIFFICULTY_BENCHMARKS;
    sheetData.malfunctionEffects = MALFUNCTION_EFFECTS;
    const constructionTargetGp = system.state.upgrading ? Number(system.improvements.upgradeCost) || 0 : sheetData.technology.marketValue;
    sheetData.constructionTargetSp = constructionTargetGp * 10;
    sheetData.constructionPercent = sheetData.constructionTargetSp
      ? Math.min(100, Math.round((Number(system.construction.progressSp) || 0) / sheetData.constructionTargetSp * 100))
      : 0;
    sheetData.canOperate = system.construction.complete && !system.state.malfunctioned && !system.state.upgrading && !system.state.destroyed;
    sheetData.masterwork = calculateMasterwork({
      marketValue: sheetData.technology.marketValue,
      technologyScore: sheetData.technology.technologyScore,
    });
    const featBonuses = technologyFeatBonuses(this.item.actor, { ...system.design, vehicle: system.vehicle.enabled });
    sheetData.effectiveRawMaterialCost = this.item.actor ? this._rawMaterialCost(sheetData.technology) : sheetData.technology.rawMaterialCost;
    sheetData.effectiveMasterworkRawMaterialCost = sheetData.masterwork.componentRawMaterialCost * featBonuses.rawMaterialMultiplier;
    sheetData.masterworkTargetSp = sheetData.masterwork.componentPrice * 10;
    sheetData.masterworkPercent = sheetData.masterworkTargetSp
      ? Math.min(100, Math.round((Number(system.improvements.masterworkProgressSp) || 0) / sheetData.masterworkTargetSp * 100))
      : 0;
    sheetData.permanentMalfunctions = Array.from(system.state.permanentEffects ?? []).map((effect, index, all) => ({
      effect,
      index,
      repairable: index === all.length - 1,
    }));
    sheetData.destroyed = Boolean(system.state.destroyed);
    sheetData.technologyLimit = this.item.actor ? technologicalLimitForDevice(this.item.actor, {
      ...system.design,
      vehicle: system.vehicle.enabled,
    }) : null;
    sheetData.overTechnologyLimit = sheetData.technologyLimit != null && sheetData.technology.technologyScore > sheetData.technologyLimit;
    return sheetData;
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
    root?.querySelectorAll?.("[data-warcraft-tech-action]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        void this._onTechnologyAction(button.dataset.warcraftTechAction, button, event);
      });
    });
  }

  async _onTechnologyAction(action, element, event) {
    // Every device action uses the values currently visible in the form. This
    // avoids operating or crafting an older saved design when the player clicks
    // directly from a focused input.
    await this._onSubmit(event);
    if (action === "recalculate") return this._recalculate();
    if (action === "add-feature") return this._addFeature();
    if (action === "remove-feature") return this._removeFeature(Number(element.dataset.index));
    if (action === "add-addon") return this._addAddOn();
    if (action === "remove-addon") return this._removeAddOn(Number(element.dataset.index));
    if (action === "operate") return this._operate();
    if (action === "craft") return this._craft();
    if (action === "repair") return this._repair();
    if (action === "fuel-add") return this._changeSupply("fuel", 1);
    if (action === "ammo-add") return this._changeSupply("ammunition", 1);
    if (action === "fuel-remove") return this._changeSupply("fuel", -1);
    if (action === "ammo-remove") return this._changeSupply("ammunition", -1);
    if (action === "integrate-addon") return this._integrateAddOn(Number(element.dataset.index));
    if (action === "repair-addon") return this._repairAddOn(Number(element.dataset.index));
    if (action === "begin-upgrade") return this._beginUpgrade();
    if (action === "craft-masterwork") return this._craftMasterwork();
    if (action === "repair-permanent") return this._repairPermanent(Number(element.dataset.index));
    if (action === "maneuver") return this._maneuver();
  }

  _designInput() {
    return {
      ...this.item.system.design,
      malfunctionRating: this.item.system.malfunction.rating,
      randomMalfunction: this.item.system.malfunction.random,
      operationDc: this.item.system.operation.dc,
    };
  }

  _craftBonus(actor) {
    const design = {
      material: this.item.system.design.material,
      primaryFunction: this.item.system.design.primaryFunction,
      size: this.item.system.design.size,
      vehicle: this.item.system.vehicle.enabled,
    };
    return skillTotal(actor, "ctd")
      + favoredTechnologyCraftBonus(actor, design)
      + technologyFeatBonuses(actor, design).craft;
  }

  _rawMaterialCost(design) {
    const actor = this.item.actor;
    const feat = technologyFeatBonuses(actor, { ...this.item.system.design, vehicle: this.item.system.vehicle.enabled });
    const ordinaryRawCost = Math.max(0, design.rawMaterialCost - design.materialRawCost);
    return ordinaryRawCost * feat.rawMaterialMultiplier + design.materialRawCost;
  }

  _ordinaryRawMaterialCost(marketValue) {
    const feat = technologyFeatBonuses(this.item.actor, {
      ...this.item.system.design,
      vehicle: this.item.system.vehicle.enabled,
    });
    return Math.max(0, Number(marketValue) || 0) / 3 * feat.rawMaterialMultiplier;
  }

  async _recalculate() {
    const design = calculateTechnologyDesign(this._designInput());
    const permanent = technologyPermanentModifiers(this.item.system.state.permanentEffects);
    const maximumHp = Math.max(1, Math.floor(design.hp * permanent.maximumHpMultiplier));
    const update = {
      "system.design.technologyScore": design.technologyScore,
      "system.design.complexity": design.complexity,
      "system.design.features": design.features,
      "system.operation.dc": design.operationDc,
      "system.malfunction.effectiveRating": design.malfunctionRating,
      "system.price": design.marketValue * permanent.marketMultiplier,
      "system.hp.max": maximumHp,
      "system.hp.value": Math.min(Number(this.item.system.hp.value) || maximumHp, maximumHp),
      "system.hardness": design.hardness,
      "system.construction.craftDc": design.craftDc,
      "system.construction.rawMaterialCost": design.rawMaterialCost,
      "system.construction.repairCost": design.repairCost,
    };
    if (!Number(this.item.system.improvements.previousMarketValue)) {
      update["system.improvements.previousMarketValue"] = design.marketValue;
    }
    await this.item.update(update);
    this.render(false);
  }

  async _addFeature() {
    const features = foundry.utils.duplicate(this.item.system.design.features ?? []);
    features.push({ type: "armorBonus", name: "", ts: 1, value: "", unit: "", notes: "" });
    await this.item.update({ "system.design.features": features });
    this.render(false);
  }

  async _removeFeature(index) {
    const features = foundry.utils.duplicate(this.item.system.design.features ?? []);
    features.splice(index, 1);
    await this.item.update({ "system.design.features": features });
    await this._recalculate();
  }

  async _addAddOn() {
    const addOns = foundry.utils.duplicate(this.item.system.improvements.addOns ?? []);
    addOns.push({ name: "New add-on", technologyScore: 1, functionDifficulty: 10, independentMarketValue: 0, integrated: false, malfunctioned: false, materialsPaid: false, notes: "" });
    await this.item.update({ "system.improvements.addOns": addOns });
    this.render(false);
  }

  async _removeAddOn(index) {
    const addOns = foundry.utils.duplicate(this.item.system.improvements.addOns ?? []);
    addOns.splice(index, 1);
    await this.item.update({ "system.improvements.addOns": addOns });
    this.render(false);
  }

  async _operate() {
    const actor = this.item.actor;
    if (!actor) return ui.notifications.warn(game.i18n.localize("D35E.ErrorItemNoOwner"));
    if (this.item.system.state.destroyed) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechDestroyed"));
    if (!this.item.system.construction.complete) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechIncomplete"));
    if (this.item.system.state.malfunctioned) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechNeedsRepair"));
    if (this.item.system.state.upgrading) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechBeingUpgraded"));

    for (const key of ["fuel", "ammunition"]) {
      const supply = this.item.system.supplies[key];
      const check = consumeTechnologySupply({ current: supply.value, cost: supply.perUse });
      if (!check.valid) return ui.notifications.warn(game.i18n.format("D35E.WarcraftTechMissingSupply", { supply: supply.name || key, amount: check.missing }));
    }
    const checkType = this.item.system.operation.checkType ?? "utd";
    const skill = actor.system.skills?.utd ?? {};
    const trained = Number(skill.rank ?? skill.points ?? 0) > 0;
    const proficient = hasProficiency(actor, this.item.system.operation.requiredProficiency);
    const permanent = technologyPermanentModifiers(this.item.system.state.permanentEffects);
    const modifiers = technologyOperationModifiers({
      checkType,
      useDeviceBonus: skillTotal(actor, "utd") + technologyFeatBonuses(actor, {
        ...this.item.system.design,
        vehicle: this.item.system.vehicle.enabled,
      }).use,
      rangedAttackBonus: rangedAttackTotal(actor),
      deviceAttackBonus: this.item.system.operation.attackBonus,
      trained,
      proficient,
      masterwork: this.item.system.improvements.masterwork,
      permanentPenalty: permanent.operationPenalty,
    });
    const penalty = modifiers.penalty;
    const data = { bonus: modifiers.bonus, penalty, masterwork: modifiers.masterworkBonus };
    const roll = await new Roll35e("1d20 + @bonus + @penalty + @masterwork", data).roll();
    const randomRoll = this.item.system.malfunction.random ? await new Roll35e("1d20").roll() : null;
    const malfunction = checkMalfunction({
      naturalRoll: naturalD20(roll),
      malfunctionRating: Math.min(5, Number(this.item.system.malfunction.effectiveRating) + permanent.malfunctionRatingAdjustment),
      randomMalfunction: this.item.system.malfunction.random,
      malfunctionRoll: randomRoll?.total,
    });
    const target = checkType === "attack" ? firstTargetArmorClass() : null;
    const success = checkType === "utd" ? roll.total >= Number(this.item.system.operation.dc) : true;
    const hit = checkType === "attack" && target ? roll.total >= target.armorClass : null;
    let damageRoll = null;
    if (malfunction.malfunctioned) {
      const effect = malfunction.effect || this.item.system.malfunction.effect || "Stopped";
      const rule = getTechnologyMalfunctionRule(effect);
      const mangledAgain = effect === "Mangled" && this.item.system.state.permanentEffects?.includes("Mangled");
      const malfunctionUpdate = {
        "system.state.malfunctioned": true,
        "system.state.lastMalfunction": effect,
      };
      if (mangledAgain) {
        malfunctionUpdate["system.state.destroyed"] = true;
        malfunctionUpdate["system.hp.value"] = 0;
      }
      if (rule.consumesSupply) {
        malfunctionUpdate["system.supplies.fuel.value"] = 0;
        malfunctionUpdate["system.supplies.ammunition.value"] = 0;
      }
      if (rule.disablesAddOns) {
        malfunctionUpdate["system.improvements.addOns"] = foundry.utils.duplicate(this.item.system.improvements.addOns ?? [])
          .map((addOn) => ({ ...addOn, malfunctioned: true }));
      }
      await this.item.update(malfunctionUpdate);
      await postMalfunctionConsequence(this.item, effect, rule);
    } else if (success) {
      const update = {};
      for (const key of ["fuel", "ammunition"]) {
        const supply = this.item.system.supplies[key];
        update[`system.supplies.${key}.value`] = consumeTechnologySupply({ current: supply.value, cost: supply.perUse }).remaining;
      }
      if (permanent.deviceDamagePerUse) {
        const remainingHp = Math.max(0, Number(this.item.system.hp.value) - permanent.deviceDamagePerUse);
        update["system.hp.value"] = remainingHp;
        if (!remainingHp) update["system.state.destroyed"] = true;
      }
      await this.item.update(update);
      const damageFormula = deviceDamageFormula(this.item);
      if (damageFormula && hit !== false) damageRoll = await new Roll35e(damageFormula).roll();
      if (permanent.operatorDamagePerUse) {
        const consequence = await new Roll35e(permanent.operatorDamagePerUse).roll();
        await ChatMessage.create({
          user: game.user.id,
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<div class="D35E chat-card warcraft-technology-card"><p>${escape(game.i18n.localize("D35E.WarcraftTechPainMachineHint"))}</p></div>`,
          rolls: [consequence],
        });
      }
    }
    await postDeviceRoll(this.item, roll, game.i18n.localize("D35E.WarcraftTechOperate"), [
      checkType === "utd" ? `${game.i18n.localize("D35E.DC")}: ${this.item.system.operation.dc}` : "",
      checkType === "utd" ? (success ? game.i18n.localize("D35E.Success") : game.i18n.localize("D35E.Failure")) : "",
      checkType === "attack" ? game.i18n.localize("D35E.AttackRoll") : "",
      target ? `${target.name} ${game.i18n.localize("D35E.AC")}: ${target.armorClass} — ${hit ? game.i18n.localize("D35E.Hit") : game.i18n.localize("D35E.Miss")}` : "",
      damageRoll ? game.i18n.format("D35E.WarcraftTechDamageResult", { formula: deviceDamageFormula(this.item), total: damageRoll.total }) : "",
      penalty ? `${game.i18n.localize("D35E.Modifier")}: ${penalty}` : "",
      permanent.noisy ? game.i18n.localize("D35E.WarcraftTechNoisemakerHint") : "",
      permanent.leaky ? game.i18n.localize("D35E.WarcraftTechLeakyHint") : "",
    ], malfunction, damageRoll ? [damageRoll] : []);
    this.render(false);
  }

  async _craft() {
    const actor = this.item.actor;
    if (!actor) return ui.notifications.warn(game.i18n.localize("D35E.ErrorItemNoOwner"));
    const design = calculateTechnologyDesign(this._designInput());
    const upgrading = Boolean(this.item.system.state.upgrading);
    const technologicalLimit = technologicalLimitForDevice(actor, {
      ...this.item.system.design,
      vehicle: this.item.system.vehicle.enabled,
    });
    if (design.technologyScore > technologicalLimit) {
      return ui.notifications.warn(game.i18n.format("D35E.WarcraftTechLimitExceeded", {
        score: design.technologyScore,
        limit: technologicalLimit,
      }));
    }
    const replacementDebt = Number(this.item.system.construction.ruinedMaterialsOwed) || 0;
    if (replacementDebt) {
      if (!await spendGold(actor, replacementDebt)) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechCannotAffordMaterials"));
      await this.item.update({ "system.construction.ruinedMaterialsOwed": 0 });
    }
    if (!this.item.system.construction.materialsPaid) {
      if (!await spendGold(actor, this._rawMaterialCost(design))) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechCannotAffordMaterials"));
      await this.item.update({ "system.construction.materialsPaid": true });
    }
    const roll = await new Roll35e("1d20 + @bonus", { bonus: this._craftBonus(actor) }).roll();
    const progress = calculateCraftProgress({
      checkTotal: roll.total,
      craftDc: upgrading ? this.item.system.improvements.upgradeDc : design.craftDc,
      currentSp: this.item.system.construction.progressSp,
      rawMaterialCost: upgrading ? this._ordinaryRawMaterialCost(this.item.system.improvements.upgradeCost) : this._rawMaterialCost(design),
    });
    const targetGp = upgrading ? Number(this.item.system.improvements.upgradeCost) : design.marketValue;
    const reachedTarget = progress.totalProgressSp >= targetGp * 10;
    const complete = reachedTarget && (!design.requiresMasterwork || this.item.system.improvements.masterwork);
    const update = {
      "system.construction.progressSp": progress.totalProgressSp,
      "system.construction.complete": complete,
      "system.construction.ruinedMaterialsOwed": progress.ruinedMaterialsGp,
    };
    if (complete && upgrading) {
      update["system.state.upgrading"] = false;
      update["system.improvements.previousMarketValue"] = design.marketValue;
      update["system.construction.materialsPaid"] = false;
    }
    await this.item.update(update);
    await postDeviceRoll(this.item, roll, game.i18n.localize("D35E.WarcraftTechCraftWeek"), [
      `${game.i18n.localize("D35E.WarcraftTechProgress")}: ${progress.progressSp} sp`,
      progress.ruinedMaterialsGp ? game.i18n.format("D35E.WarcraftTechRuinedMaterials", { cost: progress.ruinedMaterialsGp }) : "",
      complete ? game.i18n.localize("D35E.WarcraftTechComplete") : "",
      reachedTarget && design.requiresMasterwork && !this.item.system.improvements.masterwork
        ? game.i18n.localize("D35E.WarcraftTechMaterialNeedsMasterwork") : "",
    ]);
    this.render(false);
  }

  async _repair() {
    const actor = this.item.actor;
    if (!actor) return ui.notifications.warn(game.i18n.localize("D35E.ErrorItemNoOwner"));
    if (this.item.system.state.destroyed) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechDestroyed"));
    const design = calculateTechnologyDesign(this._designInput());
    const effect = String(this.item.system.state.lastMalfunction ?? "");
    const rule = getTechnologyMalfunctionRule(effect);
    const repairCost = design.repairCost * (rule.repairCostMultiplier ?? 1) + design.marketValue * (rule.replacementCostMultiplier ?? 0);
    if (!await spendGold(actor, repairCost)) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechCannotAffordRepair"));
    const dc = design.craftDc + Number(rule.repairDcAdjustment || 0);
    const roll = await new Roll35e("1d20 + @bonus", { bonus: this._craftBonus(actor) }).roll();
    const success = roll.total >= dc;
    const details = [`${game.i18n.localize("D35E.DC")}: ${dc}`, `${game.i18n.localize("D35E.CostGP")}: ${repairCost}`, success ? game.i18n.localize("D35E.Success") : game.i18n.localize("D35E.Failure")];
    if (success) {
      const effects = Array.from(this.item.system.state.permanentEffects ?? []);
      const records = foundry.utils.duplicate(this.item.system.state.permanentRecords ?? []);
      const record = { effect, before: {} };
      if (PERSISTENT_MALFUNCTIONS.has(effect)) {
        effects.push(effect);
        records.push(record);
      }
      const update = {
        "system.state.malfunctioned": false,
        "system.state.lastMalfunction": "",
        "system.state.permanentEffects": effects,
        "system.state.permanentRecords": records,
      };
      if (effect === "Mangled") update["system.state.mangledCount"] = Number(this.item.system.state.mangledCount || 0) + 1;
      if (rule.timeFactorMultiplier) {
        record.before.timeFactor = Number(this.item.system.design.timeFactor);
        update["system.design.timeFactor"] = Math.max(1, Number(this.item.system.design.timeFactor) * rule.timeFactorMultiplier);
      }
      if (rule.maneuverabilityAdjustment) {
        record.before.maneuverability = Number(this.item.system.vehicle.maneuverability);
        update["system.vehicle.maneuverability"] = Math.max(1, Number(this.item.system.vehicle.maneuverability) + rule.maneuverabilityAdjustment);
      }
      if (rule.featureTsAdjustment && this.item.system.design.features?.length) {
        const features = foundry.utils.duplicate(this.item.system.design.features);
        const choice = await new Roll35e(`1d${features.length}`).roll();
        const featureIndex = Math.max(0, choice.total - 1);
        const feature = features[featureIndex];
        record.before.featureIndex = featureIndex;
        record.before.featureTs = Number(feature.ts);
        feature.ts = Math.max(0, Number(feature.ts) + rule.featureTsAdjustment);
        update["system.design.features"] = features;
        details.push(game.i18n.format("D35E.WarcraftTechDegradedFeature", { feature: feature.name || feature.type }));
      }
      if (rule.sizeAdjustment) {
        const currentIndex = Math.max(0, DEVICE_SIZES.indexOf(this.item.system.design.size));
        record.before.size = this.item.system.design.size;
        record.before.weight = Number(this.item.system.weight || 0);
        update["system.design.size"] = DEVICE_SIZES[Math.min(DEVICE_SIZES.length - 1, currentIndex + rule.sizeAdjustment)];
        update["system.weight"] = Number(this.item.system.weight || 0) * (rule.weightMultiplier ?? 1);
        const features = foundry.utils.duplicate(update["system.design.features"] ?? this.item.system.design.features ?? []);
        for (const feature of features) {
          if (["landSpeed", "climbSpeed", "flySpeed", "swimSpeed"].includes(feature.type)) {
            record.before.speedFeatures ??= [];
            record.before.speedFeatures.push({ index: features.indexOf(feature), value: feature.value });
            feature.value = Math.max(0, Number(feature.value) + Number(rule.speedAdjustmentMph || 0));
          }
        }
        update["system.design.features"] = features;
      }
      await this.item.update(update);
      await this._recalculate();
    } else this.render(false);
    await postDeviceRoll(this.item, roll, game.i18n.localize("D35E.WarcraftTechRepair"), details);
  }

  async _repairPermanent(index) {
    const actor = this.item.actor;
    const effects = Array.from(this.item.system.state.permanentEffects ?? []);
    const records = foundry.utils.duplicate(this.item.system.state.permanentRecords ?? []);
    if (!actor || index !== effects.length - 1 || !effects[index]) {
      return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechRepairPermanentOrder"));
    }
    const effect = effects[index];
    const record = records[index] ?? { before: {} };
    const design = calculateTechnologyDesign(this._designInput());
    const rule = getTechnologyMalfunctionRule(effect);
    const repairCost = design.repairCost * (rule.repairCostMultiplier ?? 1) + design.marketValue * (rule.replacementCostMultiplier ?? 0);
    if (!await spendGold(actor, repairCost)) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechCannotAffordRepair"));
    const dc = design.craftDc + Number(rule.repairDcAdjustment || 0);
    const roll = await new Roll35e("1d20 + @bonus", { bonus: this._craftBonus(actor) }).roll();
    const success = roll.total >= dc;
    if (success) {
      const update = {};
      const before = record.before ?? {};
      if (before.timeFactor != null) update["system.design.timeFactor"] = before.timeFactor;
      if (before.maneuverability != null) update["system.vehicle.maneuverability"] = before.maneuverability;
      if (before.featureIndex != null) {
        const features = foundry.utils.duplicate(this.item.system.design.features ?? []);
        if (features[before.featureIndex]) features[before.featureIndex].ts = before.featureTs;
        update["system.design.features"] = features;
      }
      if (before.size != null) update["system.design.size"] = before.size;
      if (before.weight != null) update["system.weight"] = before.weight;
      if (before.speedFeatures?.length) {
        const features = foundry.utils.duplicate(update["system.design.features"] ?? this.item.system.design.features ?? []);
        for (const entry of before.speedFeatures) if (features[entry.index]) features[entry.index].value = entry.value;
        update["system.design.features"] = features;
      }
      effects.splice(index, 1);
      records.splice(index, 1);
      update["system.state.permanentEffects"] = effects;
      update["system.state.permanentRecords"] = records;
      await this.item.update(update);
      await this._recalculate();
    }
    await postDeviceRoll(this.item, roll, game.i18n.localize("D35E.WarcraftTechRepairPermanent"), [
      effect,
      `${game.i18n.localize("D35E.DC")}: ${dc}`,
      `${game.i18n.localize("D35E.CostGP")}: ${repairCost}`,
      success ? game.i18n.localize("D35E.Success") : game.i18n.localize("D35E.Failure"),
    ]);
  }

  async _changeSupply(key, delta) {
    const supply = this.item.system.supplies[key];
    const value = Math.max(0, Math.min(Number(supply.capacity) || Infinity, Number(supply.value || 0) + delta));
    await this.item.update({ [`system.supplies.${key}.value`]: value });
    this.render(false);
  }

  async _integrateAddOn(index) {
    const actor = this.item.actor;
    const addOns = foundry.utils.duplicate(this.item.system.improvements.addOns ?? []);
    const addOn = addOns[index];
    if (!actor || !addOn) return;
    const result = calculateAddOn({
      independentMarketValue: addOn.independentMarketValue,
      deviceTs: this.item.system.design.technologyScore,
      addOnTs: addOn.technologyScore,
      functionDifficulty: addOn.functionDifficulty,
    });
    if (!addOn.materialsPaid) {
      if (!await spendGold(actor, this._ordinaryRawMaterialCost(result.marketValue))) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechCannotAffordMaterials"));
      addOn.materialsPaid = true;
    }
    const roll = await new Roll35e("1d20 + @bonus", { bonus: this._craftBonus(actor) }).roll();
    if (roll.total >= result.integrationDc) addOn.integrated = true;
    await this.item.update({ "system.improvements.addOns": addOns });
    await postDeviceRoll(this.item, roll, game.i18n.localize("D35E.WarcraftTechIntegrate"), [`${game.i18n.localize("D35E.DC")}: ${result.integrationDc}`, result.integrationTime]);
    this.render(false);
  }

  async _repairAddOn(index) {
    const actor = this.item.actor;
    const addOns = foundry.utils.duplicate(this.item.system.improvements.addOns ?? []);
    const addOn = addOns[index];
    if (!actor || !addOn?.malfunctioned) return;
    const result = calculateAddOn({
      independentMarketValue: addOn.independentMarketValue,
      deviceTs: this.item.system.design.technologyScore,
      addOnTs: addOn.technologyScore,
      functionDifficulty: addOn.functionDifficulty,
    });
    if (!await spendGold(actor, result.repairCost)) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechCannotAffordRepair"));
    const roll = await new Roll35e("1d20 + @bonus", { bonus: this._craftBonus(actor) }).roll();
    const success = roll.total >= result.repairDc;
    if (success) addOn.malfunctioned = false;
    await this.item.update({ "system.improvements.addOns": addOns });
    await postDeviceRoll(this.item, roll, game.i18n.localize("D35E.WarcraftTechRepairAddOn"), [
      addOn.name,
      `${game.i18n.localize("D35E.DC")}: ${result.repairDc}`,
      `${game.i18n.localize("D35E.CostGP")}: ${result.repairCost}`,
      success ? game.i18n.localize("D35E.Success") : game.i18n.localize("D35E.Failure"),
    ]);
    this.render(false);
  }

  async _beginUpgrade() {
    const permanent = technologyPermanentModifiers(this.item.system.state.permanentEffects);
    if (permanent.preventsUpgrade) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechFusedNoUpgrade"));
    if (this.item.system.state.destroyed) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechDestroyed"));
    const current = calculateTechnologyDesign(this._designInput());
    const previous = Number(this.item.system.improvements.previousMarketValue) || current.marketValue;
    const upgradeCost = Math.max(0, current.marketValue - previous);
    if (!upgradeCost) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechNoUpgradeDelta"));
    const actor = this.item.actor;
    if (!actor || !await spendGold(actor, this._ordinaryRawMaterialCost(upgradeCost))) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechCannotAffordMaterials"));
    await this.item.update({
      "system.state.upgrading": true,
      "system.improvements.upgradeCost": upgradeCost,
      "system.improvements.upgradeDc": Math.max(0, current.functionDifficulty + current.technologyScore - 10),
      "system.construction.progressSp": 0,
      "system.construction.materialsPaid": true,
      "system.improvements.masterwork": false,
      "system.improvements.masterworkProgressSp": 0,
      "system.improvements.masterworkMaterialsPaid": false,
      "system.improvements.masterworkRuinedMaterialsOwed": 0,
    });
    this.render(false);
  }

  async _craftMasterwork() {
    const actor = this.item.actor;
    if (!actor) return ui.notifications.warn(game.i18n.localize("D35E.ErrorItemNoOwner"));
    if (this.item.system.improvements.masterwork) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechMasterworkComplete"));
    const design = calculateTechnologyDesign(this._designInput());
    const masterwork = calculateMasterwork({ marketValue: design.marketValue, technologyScore: design.technologyScore });
    const debt = Number(this.item.system.improvements.masterworkRuinedMaterialsOwed) || 0;
    if (debt) {
      if (!await spendGold(actor, debt)) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechCannotAffordMaterials"));
      await this.item.update({ "system.improvements.masterworkRuinedMaterialsOwed": 0 });
    }
    if (!this.item.system.improvements.masterworkMaterialsPaid) {
      const feat = technologyFeatBonuses(actor, { ...this.item.system.design, vehicle: this.item.system.vehicle.enabled });
      if (!await spendGold(actor, masterwork.componentRawMaterialCost * feat.rawMaterialMultiplier)) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftTechCannotAffordMaterials"));
      await this.item.update({ "system.improvements.masterworkMaterialsPaid": true });
    }
    const roll = await new Roll35e("1d20 + @bonus", { bonus: this._craftBonus(actor) }).roll();
    const feat = technologyFeatBonuses(actor, { ...this.item.system.design, vehicle: this.item.system.vehicle.enabled });
    const effectiveRawMaterialCost = masterwork.componentRawMaterialCost * feat.rawMaterialMultiplier;
    const progress = calculateCraftProgress({
      checkTotal: roll.total,
      craftDc: masterwork.craftDc,
      currentSp: this.item.system.improvements.masterworkProgressSp,
      rawMaterialCost: effectiveRawMaterialCost,
    });
    const complete = progress.totalProgressSp >= masterwork.componentPrice * 10;
    const update = {
      "system.improvements.masterworkProgressSp": progress.totalProgressSp,
      "system.improvements.masterworkRuinedMaterialsOwed": progress.ruinedMaterialsGp,
      "system.improvements.masterwork": complete,
    };
    const constructionTarget = this.item.system.state.upgrading
      ? Number(this.item.system.improvements.upgradeCost) || 0
      : design.marketValue;
    if (complete && Number(this.item.system.construction.progressSp) >= constructionTarget * 10) {
      update["system.construction.complete"] = true;
      if (this.item.system.state.upgrading) {
        update["system.state.upgrading"] = false;
        update["system.improvements.previousMarketValue"] = design.marketValue;
        update["system.construction.materialsPaid"] = false;
      }
    }
    await this.item.update(update);
    await postDeviceRoll(this.item, roll, game.i18n.localize("D35E.WarcraftTechCraftMasterwork"), [
      `${game.i18n.localize("D35E.DC")}: ${masterwork.craftDc}`,
      `${game.i18n.localize("D35E.WarcraftTechProgress")}: ${progress.progressSp} sp`,
      progress.ruinedMaterialsGp ? game.i18n.format("D35E.WarcraftTechRuinedMaterials", { cost: progress.ruinedMaterialsGp }) : "",
      complete ? game.i18n.localize("D35E.WarcraftTechComplete") : "",
    ]);
    this.render(false);
  }

  async _maneuver() {
    const actor = this.item.actor;
    if (!actor || !this.item.system.vehicle.enabled) return;
    const check = maneuverabilityCheck({
      combat: Boolean(game.combat?.started),
      speedMph: this.item.system.vehicle.currentSpeedMph,
      rating: this.item.system.vehicle.maneuverability,
      extraSpeedChanges: this.item.system.vehicle.extraSpeedChanges,
      turnIncrements: this.item.system.vehicle.turnIncrements,
      driftWidths: this.item.system.vehicle.driftWidths,
    });
    const skill = actor.system.skills?.utd ?? {};
    const trained = Number(skill.rank ?? skill.points ?? 0) > 0;
    const proficient = hasProficiency(actor, this.item.system.operation.requiredProficiency);
    const permanent = technologyPermanentModifiers(this.item.system.state.permanentEffects);
    const featUseBonus = technologyFeatBonuses(actor, { ...this.item.system.design, vehicle: true }).use;
    const usePenalty = technologyUsePenalty({ trained, proficient }) + permanent.operationPenalty;
    const masterwork = this.item.system.improvements.masterwork ? 3 : 0;
    const materialModifier = Number(calculateTechnologyDesign(this._designInput()).materialManeuverabilityBonus) || 0;
    const roll = await new Roll35e("1d20 + @bonus + @modifier + @usePenalty + @masterwork + @material", {
      bonus: skillTotal(actor, "utd") + featUseBonus, modifier: check.modifier, usePenalty, masterwork, material: materialModifier,
    }).roll();
    await postDeviceRoll(this.item, roll, game.i18n.localize("D35E.WarcraftTechManeuver"), [
      `${game.i18n.localize("D35E.DC")}: ${check.dc}`,
      `${game.i18n.localize("D35E.Modifier")}: ${check.modifier + usePenalty + masterwork + materialModifier}`,
    ]);
  }
}
