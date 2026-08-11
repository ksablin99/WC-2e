import { ItemEnhancementHelper } from "./itemEnhancementHelper.js";
import { IntelligentItemPowerConverter } from "../converters/intelligentItemPowerConverter.js";
import { Roll35e } from "../../roll.js";

const SETTING_PREFIX = "intelligentItemExtraTables";

/**
 * Parse usage type and count from a roll-table result description at runtime.
 * @returns {{ usageType: "day"|"atwill"|"continuous", usageCount: number }}
 */
function parseUsageFromDescription(description) {
  const dayMatch = (description ?? "").match(/(\d+)\/day/i);
  if (dayMatch) return { usageType: "day", usageCount: parseInt(dayMatch[1]) };
  if (/at will|usable at will/i.test(description)) return { usageType: "atwill", usageCount: 0 };
  if (/continually|continuous|always active|once per month/i.test(description)) return { usageType: "continuous", usageCount: 0 };
  return { usageType: "day", usageCount: 1 };
}

/**
 * @param {string} kind  alignment | capabilities | lesser | greater | purpose | dedicated
 */
function settingKeyForKind(kind) {
  const map = {
    alignment: `${SETTING_PREFIX}Alignment`,
    capabilities: `${SETTING_PREFIX}Capabilities`,
    lesser: `${SETTING_PREFIX}Lesser`,
    greater: `${SETTING_PREFIX}Greater`,
    purpose: `${SETTING_PREFIX}Purpose`,
    dedicated: `${SETTING_PREFIX}Dedicated`,
  };
  return map[kind] ?? null;
}

function parseUuidList(raw) {
  if (!raw || typeof raw !== "string") return [];
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function abilityMod(score) {
  const n = Number(score);
  if (Number.isNaN(n)) return 0;
  return Math.floor((n - 10) / 2);
}

function randomizeMentalScores(flags) {
  const scores = ["int", "wis", "cha"].map((ability) => ({ ability, value: Number(flags[ability]) }));
  if (scores.some((score) => !Number.isFinite(score.value))) return scores;

  const highScores = scores.filter((score) => score.value !== 10);
  const lowScores = scores.filter((score) => score.value === 10);
  const isTwoHighOneTen =
    highScores.length === 2 &&
    lowScores.length === 1 &&
    highScores[0].value === highScores[1].value;
  if (!isTwoHighOneTen) return scores;

  const lowIndex = Math.floor(Math.random() * scores.length);
  return scores.map((score, index) => ({
    ability: score.ability,
    value: index === lowIndex ? 10 : highScores[0].value,
  }));
}

export class IntelligentItemHelper {
  /**
   * Default `system.intelligent` for item sheets when the field is missing (pre-migration actors/items).
   * @returns {object}
   */
  /**
   * @param {*} powers  persisted or merged value (may be corrupted non-array)
   * @returns {object[]}
   */
  static coercePowersArray(powers) {
    return Array.isArray(powers) ? powers : [];
  }

  static defaultIntelligentShape() {
    return {
      enabled: false,
      int: 10,
      wis: 10,
      cha: 10,
      alignment: "nn",
      empathy: false,
      speech: false,
      telepathy: false,
      readLanguages: false,
      readMagic: false,
      languages: "",
      senses: {
        lowLight: false,
        lowLightMultiplier: 2,
        blindsight: 0,
        darkvision: 30,
        tremorsense: 0,
        truesight: 0,
      },
      powers: [],
      skills: [],
      specialPurpose: "",
      dedicatedPower: "",
      hasSpecialPurpose: false,
      personality: "",
      egoOverride: null,
    };
  }

  /**
   * Default RollTable from system compendium for this kind.
   * @param {string} kind
   * @returns {Promise<RollTable|null>}
   */
  static async getDefaultTable(kind) {
    const cfg = CONFIG.D35E.intelligentItemTables;
    if (!cfg?.pack || !cfg[kind]) return null;
    const pack = game.packs.get(cfg.pack);
    if (!pack) return null;
    try {
      return await pack.getDocument(cfg[kind]);
    } catch (_e) {
      return null;
    }
  }

  /**
   * Extra RollTables from world settings (document UUIDs).
   * @param {string} kind
   * @returns {Promise<RollTable[]>}
   */
  static async getExtraTables(kind) {
    const key = settingKeyForKind(kind);
    if (!key) return [];
    const raw = game.settings.get("warcraftrpg2e", key);
    const out = [];
    for (const uuid of parseUuidList(raw)) {
      try {
        const doc = await fromUuid(uuid);
        if (doc instanceof RollTable) out.push(doc);
        else console.warn(`D35E | Intelligent items: not a RollTable, skipped: ${uuid}`);
      } catch (_e) {
        console.warn(`D35E | Intelligent items: invalid RollTable UUID skipped: ${uuid}`);
      }
    }
    return out;
  }

  /**
   * Returns all results from all tables for `kind` as option objects for a select dropdown.
   * @param {string} kind  lesser | greater
   * @returns {Promise<Array<{uuid:string, label:string, egoPoints:number, itemUuid:string|null}>>}
   */
  static async getTableOptions(kind) {
    const def = await IntelligentItemHelper.getDefaultTable(kind);
    const extras = await IntelligentItemHelper.getExtraTables(kind);
    const tables = [def, ...extras].filter(Boolean);
    const options = [];
    for (const table of tables) {
      for (const result of table.results) {
        const flags = IntelligentItemHelper.getResultFlags(result);
        const label = result.description || result.name || "";
        if (!label) continue;

        // In v13, result.type is "document" (compendium merged into document).
        // Use result.documentUuid directly; fall back to legacy flags for custom tables.
        let itemUuid = null;
        if (result.type === "document" && result.documentUuid) {
          itemUuid = result.documentUuid;
        } else {
          itemUuid = flags.itemUuid ?? null;
        }

        options.push({
          uuid: result.uuid,
          label,
          egoPoints: flags.egoPoints != null ? Number(flags.egoPoints) : (kind === "greater" ? 2 : 1),
          itemUuid,
        });
      }
    }
    return options;
  }

  /**
   * @returns {Promise<RollTable|null>}
   */
  static async pickTableForKind(kind) {
    const def = await IntelligentItemHelper.getDefaultTable(kind);
    const extras = await IntelligentItemHelper.getExtraTables(kind);
    const candidates = [def, ...extras].filter(Boolean);
    if (!candidates.length) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * @param {string} kind
   * @param {object} [drawOptions]  passed to RollTable#draw
   */
  static async drawFromKind(kind, drawOptions = {}) {
    const table = await IntelligentItemHelper.pickTableForKind(kind);
    if (!table) {
      ui.notifications?.warn(game.i18n.localize("D35E.IntelligentItemNoTable"));
      return null;
    }
    return table.draw({
      rollMode: CONST.DICE_ROLL_MODES?.PUBLIC ?? "publicroll",
      displayChat: true,
      ...drawOptions,
    });
  }

  /**
   * @param {TableDraw} draw
   * @returns {TableResult|null}
   */
  static primaryResult(draw) {
    const r = draw?.results?.find((x) => x.drawn) ?? draw?.results?.[0];
    return r ?? null;
  }

  /**
   * @param {TableResult} result
   * @returns {object}
   */
  static getResultFlags(result) {
    return foundry.utils.getProperty(result, "flags.D35E") ?? {};
  }

  /**
   * Apply a capabilities row to intelligent system data (partial update object).
   * @param {object} flags  from TableResult.flags.D35E
   * @returns {object}  flat paths under system.intelligent
   */
  static capabilitiesToUpdate(flags) {
    const u = {};
    for (const score of randomizeMentalScores(flags)) {
      if (flags[score.ability] != null) u[`system.intelligent.${score.ability}`] = score.value;
    }
    if (flags.empathy != null) u["system.intelligent.empathy"] = !!flags.empathy;
    if (flags.speech != null) u["system.intelligent.speech"] = !!flags.speech;
    if (flags.telepathy != null) u["system.intelligent.telepathy"] = !!flags.telepathy;
    if (flags.readLanguages != null) u["system.intelligent.readLanguages"] = !!flags.readLanguages;
    if (flags.readMagic != null) u["system.intelligent.readMagic"] = !!flags.readMagic;
    if (flags.vision != null) u["system.intelligent.visionRange"] = Number(flags.vision);
    let senses = [];
    if (flags.vision) senses.push(`${flags.vision} ft. vision and hearing`);
    if (flags.darkvision) senses.push(`${flags.darkvision} ft. darkvision and hearing`);
    if (flags.blindsense) senses.push("blindsense");
    if (senses.length) u["system.intelligent.sensesText"] = senses.join("; ");
    return u;
  }

  /**
   * Common + Int bonus languages (SRD).
   */
  static languageCountFromInt(intScore) {
    return 1 + Math.max(0, abilityMod(intScore));
  }

  /**
   * @param {Item} item
   * @returns {number}
   */
  static getItemEnhancementBonus(item) {
    if (item.type === "weapon") {
      const v = item.system?.enh;
      return v != null ? Number(v) || 0 : 0;
    }
    if (item.type === "equipment") {
      const v = item.system?.armor?.enh;
      return v != null ? Number(v) || 0 : 0;
    }
    return 0;
  }

  /**
   * Sum enhancement equivalents from embedded enhancement items (rough SRD "special ability" ego).
   * @param {Item} item
   * @returns {number}
   */
  static getSpecialAbilityEgoPoints(item) {
    const rawItems = item.system?.enhancements?.items;
    const items = Array.isArray(rawItems) ? rawItems : [];
    let sum = 0;
    for (const raw of items) {
      try {
        const wrapped = { data: raw, system: raw?.system ?? raw };
        const sys = ItemEnhancementHelper.getEnhancementData(wrapped);
        const enh = Number(sys?.enh) || 0;
        const inc = Number(sys?.enhIncrease) || 0;
        sum += Math.max(0, enh) + Math.max(0, inc);
      } catch (_e) {
        /* skip malformed enhancement rows so computeEgo does not abort the sheet */
      }
    }
    return sum;
  }

  /**
   * @param {Item} item
   * @returns {{ total: number, breakdown: object }}
   */
  static computeEgo(item) {
    const intel = item.system?.intelligent;
    const breakdown = {};
    if (!intel?.enabled) {
      return { total: 0, breakdown };
    }

    let total = 0;
    const enh = IntelligentItemHelper.getItemEnhancementBonus(item);
    breakdown.enhancement = enh;
    total += enh;

    const spec = IntelligentItemHelper.getSpecialAbilityEgoPoints(item);
    breakdown.specialAbilities = spec;
    total += spec;

    const powers = IntelligentItemHelper.coercePowersArray(intel.powers);
    // Count by powerTier (new-style) or tier (legacy)
    breakdown.lesserPowers = powers.filter((p) => (p.powerTier ?? p.tier) === "lesser").length;
    breakdown.greaterPowers = powers.filter((p) => (p.powerTier ?? p.tier) === "greater").length;
    for (const p of powers) {
      const pts = Number(p.egoPoints);
      if (Number.isFinite(pts) && pts > 0) {
        total += pts;
      } else {
        // Fall back: guess from tier
        const tier = p.powerTier ?? p.tier;
        total += tier === "greater" ? 2 : 1;
      }
    }

    if (intel.hasSpecialPurpose && (intel.specialPurpose || intel.dedicatedPower)) {
      breakdown.specialPurpose = 4;
      total += 4;
    }

    if (intel.telepathy) {
      breakdown.telepathy = 1;
      total += 1;
    }
    if (intel.readLanguages) {
      breakdown.readLanguages = 1;
      total += 1;
    }
    if (intel.readMagic) {
      breakdown.readMagic = 1;
      total += 1;
    }

    for (const ab of ["int", "wis", "cha"]) {
      const mod = Math.max(0, abilityMod(intel[ab]));
      breakdown[`${ab}Bonus`] = mod;
      total += mod;
    }

    if (intel.egoOverride != null && intel.egoOverride !== "") {
      const o = Number(intel.egoOverride);
      if (Number.isFinite(o)) {
        breakdown.override = o;
        return { total: o, breakdown };
      }
    }

    return { total, breakdown };
  }

  /**
   * Roll lesser / greater powers without duplicates (re-roll, capped).
   * @param {Item} item
   * @param {string} tier  lesser | greater
   * @param {number} count
   * @param {number} [maxAttempts]
   */
  static async rollPowerPool(item, tier, count, maxAttempts = 40) {
    const kind = tier === "greater" ? "greater" : "lesser";
    const collected = [];
    const texts = new Set();
    let attempts = 0;
    while (collected.length < count && attempts < maxAttempts) {
      attempts += 1;
      const draw = await IntelligentItemHelper.drawFromKind(kind);
      const res = IntelligentItemHelper.primaryResult(draw);
      if (!res) break;

      const description = res.description ?? res.text ?? "";
      const uuid = res.documentUuid ?? null;
      const dedupeKey = uuid ?? description;
      if (texts.has(dedupeKey)) continue;
      texts.add(dedupeKey);

      const flags = IntelligentItemHelper.getResultFlags(res);
      const baseAttrs = {
        _id: foundry.utils.randomID(),
        tier,
        label: description.slice(0, 120) || uuid,
        text: description,
        egoPoints: flags.egoPoints ?? (tier === "greater" ? 2 : 1),
        priceModifierGp: flags.priceModifierGp ?? null,
        resultId: res.id ?? res._id,
      };

      // Document reference — spell or power item
      if (res.type === "document" && uuid) {
        try {
          const doc = await fromUuid(uuid);
          if (doc) {
            if (uuid.includes("warcraftrpg2e.spells")) {
              // Real spell: parse usage from description, build snapshot
              const { usageType, usageCount } = parseUsageFromDescription(description);
              const spellMode = usageType === "continuous" ? "atwill" : usageType;
              const power = IntelligentItemPowerConverter.toSpellPower(doc.toObject(), spellMode);
              if (spellMode === "day" && usageCount > 0) {
                power.system.uses.max = usageCount;
                power.system.uses.value = usageCount;
              }
              Object.assign(power, baseAttrs);
              collected.push(power);
              continue;
            } else {
              // Power item (skill power, alignment power, etc.) — use as-is
              const powerData = doc.toObject();
              Object.assign(powerData, baseAttrs);
              powerData.name = powerData.name ?? baseAttrs.label;
              collected.push(powerData);
              continue;
            }
          }
        } catch (err) {
          console.warn(`D35E | Intelligent item: failed to resolve document "${uuid}":`, err);
        }
      }

      // Text-only fallback
      collected.push({ ...baseAttrs });
    }
    return collected;
  }

  /**
   * Apply a capabilities table draw to the item (rolls lesser/greater counts from result flags).
   * @param {Item} item
   * @param {boolean} [replacePowers]  when true, replace existing powers; when false, append
   */
  static async applyCapabilitiesDraw(item, replacePowers = true) {
    const updates = { "system.intelligent.enabled": true };
    const cDraw = await IntelligentItemHelper.drawFromKind("capabilities");
    const cRes = IntelligentItemHelper.primaryResult(cDraw);
    if (!cRes) return;
    const cf = IntelligentItemHelper.getResultFlags(cRes);
    Object.assign(updates, IntelligentItemHelper.capabilitiesToUpdate(cf));
    const lesserN = Number(cf.lesser) || 0;
    const greaterN = Number(cf.greater) || 0;
    const lesserPowers = await IntelligentItemHelper.rollPowerPool(item, "lesser", lesserN);
    const greaterPowers = await IntelligentItemHelper.rollPowerPool(item, "greater", greaterN);
    const existing = IntelligentItemHelper.coercePowersArray(item.system?.intelligent?.powers);
    updates["system.intelligent.powers"] = replacePowers
      ? [...lesserPowers, ...greaterPowers]
      : [...existing, ...lesserPowers, ...greaterPowers];
    await item.update(updates);
  }

  /**
   * Full random intelligent profile (SRD-style sequence).
   * @param {Item} item
   */
  static async rollFullProfile(item) {
    const updates = { "system.intelligent.enabled": true };

    const aDraw = await IntelligentItemHelper.drawFromKind("alignment");
    const aRes = IntelligentItemHelper.primaryResult(aDraw);
    if (aRes) {
      const af = IntelligentItemHelper.getResultFlags(aRes);
      if (af.alignment) updates["system.intelligent.alignment"] = af.alignment;
    }

    await item.update(updates);
    await IntelligentItemHelper.applyCapabilitiesDraw(item, true);
  }

  /**
   * Roll a custom skill check for an intelligent item.
   * Skill total = ability_mod(from item mental scores) + ranks + misc.
   * @param {Actor} actor
   * @param {Item}  item
   * @param {{_id:string, name:string, ability:string, ranks:number, misc:number, total:number}} skill
   */
  static async rollItemSkill(actor, item, skill) {
    const total = skill.total ?? 0;
    const sign = total >= 0 ? `+${total}` : `${total}`;
    const formula = `1d20${total !== 0 ? sign : ""}`;
    const roll = new Roll35e(formula);
    await roll.evaluate();
    const abilityLabel = CONFIG.D35E?.abilities?.[skill.ability] ?? skill.ability.toUpperCase();
    // skill.name is a skill key (e.g. "per") — resolve display label
    const skillKey = skill.name || "";
    const skillLabel = CONFIG.D35E?.skills?.[skillKey]
      ?? actor?.system?.skills?.[skillKey]?.name
      ?? skillKey;
    const flavor = game.i18n.format("D35E.IntelligentItemSkillRollFlavor", {
      item: item.name,
      skill: skillLabel,
      ability: abilityLabel,
    });
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor,
    });
  }

  /**
   * Will save vs item ego — delegates to the standard saving throw flow.
   * @param {Actor} actor
   * @param {Item} item
   */
  static async rollPersonalityConflict(actor, item) {
    const { total: ego } = IntelligentItemHelper.computeEgo(item);
    await actor.rollSavingThrow("willnegates", null, ego, {});
  }

  /**
   * Negative levels from alignment mismatch (SRD summary for messaging).
   * @param {Item} item
   * @param {Actor} actor
   * @returns {number}
   */
  static getAlignmentMismatchLevels(item, actor) {
    const intel = item.system?.intelligent;
    if (!intel?.enabled) return 0;
    const ia = intel.alignment;
    if (!ia || ia === "nn") return 0;
    // Prefer the computed alignmentCode (set by _computeAlignment); fall back to raw text for legacy actors.
    const align = actor?.system?.details?.alignmentCode || actor?.system?.details?.alignment;
    if (!align || align === "un") return 0;
    if (align === ia) return 0;
    if (IntelligentItemHelper.alignmentActorCompatible(ia, align)) return 0;
    const ego = IntelligentItemHelper.computeEgo(item).total;
    if (ego >= 30) return 3;
    if (ego >= 20) return 2;
    return 1;
  }

  /**
   * SRD intelligent item alignment footnotes (partial-axis items).
   * Handles "any" axis wildcards for actors using the structured alignment system.
   */
  static alignmentActorCompatible(itemAlign, actorAlign) {
    if (actorAlign && (actorAlign.startsWith("any") || actorAlign.endsWith("any"))) {
      const actorLawChaos = actorAlign.startsWith("any") ? "any" : actorAlign[0];
      const actorGoodEvil = actorAlign.endsWith("any") ? "any" : actorAlign.at(-1);
      const itemLawChaos = itemAlign?.[0] ?? "";
      const itemGoodEvil = itemAlign?.[1] ?? "";
      return (
        (actorLawChaos === "any" || actorLawChaos === itemLawChaos) &&
        (actorGoodEvil === "any" || actorGoodEvil === itemGoodEvil)
      );
    }
    const groups = {
      cn: new Set(["cn", "cg", "ce"]),
      ne: new Set(["ne", "le", "ce"]),
      ln: new Set(["ln", "lg", "le"]),
      ng: new Set(["ng", "lg", "cg"]),
    };
    const g = groups[itemAlign];
    return g ? g.has(actorAlign) : false;
  }
}
