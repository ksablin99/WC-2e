import { ItemSheetComponent } from "./itemSheetComponent.js";
import { IntelligentItemHelper } from "../../helpers/intelligentItemHelper.js";

export class IntelligentItemPowersSheetComponent extends ItemSheetComponent {
  static getSkillPowerBonuses(item) {
    const rawPowers = foundry.utils.getProperty(item.system, "intelligent.powers") || [];
    const bonuses = {};
    for (const power of rawPowers) {
      for (const change of power.system?.changes ?? []) {
        const target = change[2] ?? "";
        if (!target.startsWith("skill.")) continue;
        const skillKey = target.slice(6);
        if (!skillKey) continue;
        const val = Number(change[0]) || 0;
        bonuses[skillKey] = (bonuses[skillKey] ?? 0) + val;
      }
    }
    return bonuses;
  }

  static getSkillLabel(skillKey, actor = null) {
    const [baseKey, subKey] = String(skillKey).split(".");
    const baseLabel = CONFIG.D35E.skills[baseKey] ?? actor?.system?.skills?.[baseKey]?.name ?? baseKey;
    if (!subKey) return game.i18n.localize(baseLabel);
    const subName = actor?.system?.skills?.[baseKey]?.subSkills?.[subKey]?.name ?? subKey;
    return `${game.i18n.localize(baseLabel)} (${subName})`;
  }

  static getDefaultSkillAbility(skillKey, actor = null) {
    const [baseKey, subKey] = String(skillKey).split(".");
    if (subKey) return actor?.system?.skills?.[baseKey]?.subSkills?.[subKey]?.ability ?? actor?.system?.skills?.[baseKey]?.ability ?? "int";
    return actor?.system?.skills?.[baseKey]?.ability ?? "int";
  }

  static getPreparedSkills(item) {
    const rawSkills = foundry.utils.getProperty(item.system, "intelligent.skills") || [];
    const intScore = item.system?.intelligent?.int ?? 10;
    const wisScore = item.system?.intelligent?.wis ?? 10;
    const chaScore = item.system?.intelligent?.cha ?? 10;
    const abilityMods = {
      int: Math.floor((intScore - 10) / 2),
      wis: Math.floor((wisScore - 10) / 2),
      cha: Math.floor((chaScore - 10) / 2),
    };
    const actor = item.actor;
    const powerChangesBonus = IntelligentItemPowersSheetComponent.getSkillPowerBonuses(item);
    const rows = rawSkills.map((s) => {
      const ability = s.ability || IntelligentItemPowersSheetComponent.getDefaultSkillAbility(s.name, actor);
      const mod = abilityMods[ability] ?? 0;
      const powerBonus = powerChangesBonus[s.name] ?? 0;
      return {
        _id: s._id,
        name: s.name || "",
        label: s.name ? IntelligentItemPowersSheetComponent.getSkillLabel(s.name, actor) : "",
        ability,
        abilityMod: mod,
        ranks: s.ranks ?? 0,
        misc: s.misc ?? 0,
        powerBonus,
        total: mod + (s.ranks ?? 0) + (s.misc ?? 0) + powerBonus,
        derived: false,
      };
    });

    const manualSkillKeys = new Set(rawSkills.map((s) => s.name).filter(Boolean));
    for (const [skillKey, powerBonus] of Object.entries(powerChangesBonus)) {
      if (manualSkillKeys.has(skillKey)) continue;
      const ability = IntelligentItemPowersSheetComponent.getDefaultSkillAbility(skillKey, actor);
      const mod = abilityMods[ability] ?? 0;
      rows.push({
        _id: `power-${skillKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
        name: skillKey,
        label: IntelligentItemPowersSheetComponent.getSkillLabel(skillKey, actor),
        ability,
        abilityMod: mod,
        ranks: 0,
        misc: 0,
        powerBonus,
        total: mod + powerBonus,
        derived: true,
      });
    }
    return rows;
  }

  prepareSheetData(sheetData) {
    if (!["weapon", "equipment"].includes(this.sheet.item.type)) return;

    // Powers list
    const rawPowers = foundry.utils.getProperty(this.sheet.item.system, "intelligent.powers") || [];
    sheetData.intelligentPowersList = rawPowers.map((p) => {
      const isCharged = p.system?.uses?.per && p.system.uses.per !== "" && !p.system?.atWill;
      return {
        _id: p._id,
        name: p.name || game.i18n.localize("D35E.Unknown"),
        img: p.img || "icons/svg/item-bag.svg",
        powerType: p.powerType || "feat",
        isSpell: (p.powerType || "feat") === "spell",
        cl: p.system?.baseCl ?? "",
        egoPoints: p.egoPoints ?? 0,
        isCharged,
        atWill: !!p.system?.atWill,
        usesValue: p.system?.uses?.value ?? 0,
        usesMax: p.system?.uses?.max ?? 0,
        usesPer: p.system?.uses?.per ?? "",
      };
    });

    sheetData.intelligentSkills = IntelligentItemPowersSheetComponent.getPreparedSkills(this.sheet.item);
    sheetData.intelligentAbilityOptions = {
      int: game.i18n.localize("D35E.AbilityInt"),
      wis: game.i18n.localize("D35E.AbilityWis"),
      cha: game.i18n.localize("D35E.AbilityCha"),
    };

    // Skill name dropdown: actor skills if embedded, else system skill list
    const actor = this.sheet.item.actor;
    if (actor) {
      const actorSkills = actor.system?.skills ?? {};
      sheetData.intelligentSkillOptions = Object.entries(actorSkills).reduce((acc, [key, skl]) => {
        if (skl?.subSkills) {
          for (const [subKey, sub] of Object.entries(skl.subSkills)) {
            const subId = `${key}.${subKey}`;
            acc[subId] = `${CONFIG.D35E.skills[key] ?? key} (${sub.name ?? subKey})`;
          }
        }
        const label = CONFIG.D35E.skills[key] ?? skl.name ?? key;
        acc[key] = label;
        return acc;
      }, {});
    } else {
      sheetData.intelligentSkillOptions = Object.entries(CONFIG.D35E.skills).reduce((acc, [key, label]) => {
        acc[key] = label;
        return acc;
      }, {});
    }
  }

  activateListeners(html) {
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
    root
      .querySelectorAll('div[data-tab="intelligent"]')
      .forEach((el) => el.addEventListener("drop", this.#onDrop.bind(this)));

    // Power listeners
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-power-delete')
      .forEach((el) => el.addEventListener("click", this.#onPowerDelete.bind(this)));
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-power-edit')
      .forEach((el) => el.addEventListener("click", this.#onPowerEdit.bind(this)));
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-power-use')
      .forEach((el) => el.addEventListener("click", this.#onPowerUse.bind(this)));
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-power-ego')
      .forEach((el) => el.addEventListener("change", this.#onEgoChange.bind(this)));
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-power-cl')
      .forEach((el) => el.addEventListener("change", this.#onClChange.bind(this)));
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-power-uses')
      .forEach((el) => el.addEventListener("change", this.#onUsesChange.bind(this)));

    // Skill listeners
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-skill-delete')
      .forEach((el) => el.addEventListener("click", this.#onSkillDelete.bind(this)));
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-skill-roll')
      .forEach((el) => el.addEventListener("click", this.#onSkillRoll.bind(this)));
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-skill-name')
      .forEach((el) => el.addEventListener("change", this.#onSkillFieldChange.bind(this, "name")));
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-skill-ability')
      .forEach((el) => el.addEventListener("change", this.#onSkillFieldChange.bind(this, "ability")));
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-skill-ranks')
      .forEach((el) => el.addEventListener("change", this.#onSkillFieldChange.bind(this, "ranks")));
    root
      .querySelectorAll('div[data-tab="intelligent"] .intel-skill-misc')
      .forEach((el) => el.addEventListener("change", this.#onSkillFieldChange.bind(this, "misc")));
  }

  // ----------------------------------------
  // Drop handler
  // ----------------------------------------

  async #onDrop(event) {
    event.preventDefault();
    let droppedData;
    try {
      droppedData = JSON.parse(event.dataTransfer.getData("text/plain"));
      if (droppedData.type !== "Item") return;
    } catch {
      return;
    }

    let itemDoc;
    if (droppedData.uuid) {
      itemDoc = await fromUuid(droppedData.uuid);
    } else if (droppedData.pack && droppedData._id) {
      const pack = game.packs.find((p) => p.metadata.id === droppedData.pack);
      itemDoc = await pack?.getDocument(droppedData._id);
    }
    if (!itemDoc) return;

    const type = itemDoc.type;
    if (type === "spell") {
      this.#showSpellUsageDialog(itemDoc);
    } else if (type === "feat" || type === "ability") {
      await this.sheet.item.intelligentPowers.addPowerFromFeat(itemDoc.toObject());
    } else {
      ui.notifications.warn(game.i18n.localize("D35E.IntelligentItemPowerDropInvalid"));
    }
  }

  #showSpellUsageDialog(itemDoc) {
    new Dialog({
      title: game.i18n.format("D35E.IntelligentItemAddSpellPower", { name: itemDoc.name }),
      content: `<p>${game.i18n.format("D35E.IntelligentItemAddSpellPowerHint", { name: itemDoc.name })}</p>`,
      buttons: {
        atwill: {
          icon: '<i class="fas fa-infinity"></i>',
          label: game.i18n.localize("D35E.IntelligentItemAtWill"),
          callback: () => this.sheet.item.intelligentPowers.addPowerFromSpell(itemDoc.toObject(), "atwill"),
        },
        day: {
          icon: '<i class="fas fa-sun"></i>',
          label: game.i18n.localize("D35E.IntelligentItemPerDay"),
          callback: () => this.sheet.item.intelligentPowers.addPowerFromSpell(itemDoc.toObject(), "day"),
        },
        charges: {
          icon: '<i class="fas fa-battery-half"></i>',
          label: game.i18n.localize("D35E.IntelligentItemCharges"),
          callback: () => this.sheet.item.intelligentPowers.addPowerFromSpell(itemDoc.toObject(), "charges"),
        },
      },
      default: "day",
    }).render(true);
  }

  // ----------------------------------------
  // Power event handlers
  // ----------------------------------------

  async #onPowerDelete(event) {
    event.preventDefault();
    const li = event.currentTarget.closest("[data-power-id]");
    const powerId = li?.dataset.powerId;
    if (!powerId) return;

    if (game.keyboard.isModifierActive("Shift")) {
      await this.sheet.item.intelligentPowers.deletePower(powerId);
    } else {
      const btn = event.currentTarget;
      btn.disabled = true;
      Dialog.confirm({
        title: game.i18n.localize("D35E.DeleteItem"),
        content: `<p>${game.i18n.localize("D35E.DeleteItemConfirmation")}</p>`,
        yes: async () => {
          await this.sheet.item.intelligentPowers.deletePower(powerId);
          btn.disabled = false;
        },
        no: () => (btn.disabled = false),
      });
    }
  }

  #onPowerEdit(event) {
    event.preventDefault();
    const li = event.currentTarget.closest("[data-power-id]");
    const powerId = li?.dataset.powerId;
    if (!powerId) return;
    const item = this.sheet.item.intelligentPowers.getPowerItem(powerId);
    item?.sheet?.render(true);
  }

  async #onPowerUse(event) {
    event.preventDefault();
    const li = event.currentTarget.closest("[data-power-id]");
    const powerId = li?.dataset.powerId;
    if (!powerId) return;
    await this.sheet.item.intelligentPowers.usePower(powerId);
  }

  async #onEgoChange(event) {
    event.preventDefault();
    const li = event.currentTarget.closest("[data-power-id]");
    const powerId = li?.dataset.powerId;
    if (!powerId) return;
    const value = Number(event.currentTarget.value) || 0;
    await this.sheet.item.intelligentPowers.updatePower(powerId, { egoPoints: value });
  }

  async #onClChange(event) {
    event.preventDefault();
    const li = event.currentTarget.closest("[data-power-id]");
    const powerId = li?.dataset.powerId;
    if (!powerId) return;
    const value = Number(event.currentTarget.value) || 1;
    await this.sheet.item.intelligentPowers.updatePower(powerId, { system: { baseCl: String(value) } });
  }

  async #onUsesChange(event) {
    event.preventDefault();
    const li = event.currentTarget.closest("[data-power-id]");
    const powerId = li?.dataset.powerId;
    if (!powerId) return;
    const value = Number(event.currentTarget.value) || 0;
    await this.sheet.item.intelligentPowers.updatePower(powerId, { system: { uses: { value } } });
  }

  // ----------------------------------------
  // Skill event handlers
  // ----------------------------------------

  async #onSkillDelete(event) {
    event.preventDefault();
    const li = event.currentTarget.closest("[data-skill-id]");
    const skillId = li?.dataset.skillId;
    if (!skillId) return;

    if (game.keyboard.isModifierActive("Shift")) {
      await this.sheet.item.intelligentPowers.deleteSkill(skillId);
    } else {
      const btn = event.currentTarget;
      btn.disabled = true;
      Dialog.confirm({
        title: game.i18n.localize("D35E.DeleteItem"),
        content: `<p>${game.i18n.localize("D35E.DeleteItemConfirmation")}</p>`,
        yes: async () => {
          await this.sheet.item.intelligentPowers.deleteSkill(skillId);
          btn.disabled = false;
        },
        no: () => (btn.disabled = false),
      });
    }
  }

  async #onSkillRoll(event) {
    event.preventDefault();
    const li = event.currentTarget.closest("[data-skill-id]");
    const skillId = li?.dataset.skillId;
    if (!skillId) return;
    const actor = this.sheet.item.actor;
    if (!actor) return;
    const item = this.sheet.item;
    // Recompute from live data (sheet data may be stale)
    const raw = IntelligentItemPowersSheetComponent.getPreparedSkills(item).find((s) => s._id === skillId);
    if (!raw) return;
    await IntelligentItemHelper.rollItemSkill(actor, item, raw);
  }

  async #onSkillFieldChange(field, event) {
    event.preventDefault();
    const li = event.currentTarget.closest("[data-skill-id]");
    const skillId = li?.dataset.skillId;
    if (!skillId) return;
    let value = event.currentTarget.value;
    if (field === "ranks" || field === "misc") value = Number(value) || 0;
    await this.sheet.item.intelligentPowers.updateSkill(skillId, { [field]: value });
  }
}

