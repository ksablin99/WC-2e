import {
  HERO_POINT_OPTIONS,
  WARCRAFT_SHOUTS,
  buildHeroPointSpendUpdate,
  cancelPendingHeroPoint,
  clearPendingHeroPoint,
  heroPointState,
  heroPendingMatches,
  shoutResolution,
} from "../helpers/warcraftHeroPoints.js";
import { Roll35e } from "../../roll.js";

const SHAKEN_BUFF_ID = "IVYGgFAO2BUGsnf3";
const PANICKED_BUFF_ID = "6tWiK0o4LsGlJ6JL";
const COMMON_BUFF_PACK = "warcraftrpg2e.commonbuffs";

function rootElement(html) {
  return html?.nodeType === 1 ? html : html?.[0] ?? html;
}

function actorFromRollData(rollData) {
  const uuid = rollData?.uuid;
  const fromUuid = uuid ? globalThis.fromUuidSync?.(uuid) : null;
  if (fromUuid) return fromUuid;
  const id = String(uuid ?? "").split(".").pop();
  return game.actors?.get(id) ?? null;
}

async function postHeroDeclaration(actor, option) {
  const label = HERO_POINT_OPTIONS[option]?.label ?? option;
  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${game.i18n.localize("D35E.HeroPoints")}:</strong> ${label}</p><p>${game.i18n.localize("D35E.WarcraftHeroManualAdjudication")}</p>`,
  });
}

async function applyImmediateOption(actor, option) {
  if (option === "avoidDeath") {
    await actor.update({
      "system.attributes.hp.value": -1,
      "system.attributes.conditions.dead": false,
      "system.attributes.conditions.dying": false,
      "system.attributes.conditions.stable": true,
    });
    return postHeroDeclaration(actor, option);
  }
  return postHeroDeclaration(actor, option);
}

function availableOptions(actor) {
  const hasIntimidatingShout = Array.from(actor?.items ?? []).some(
    (item) => item?.type === "feat" && item?.name === "Intimidating Shout"
  );
  const hasShout = Array.from(actor?.items ?? []).some(
    (item) => item?.type === "feat" && item?.flags?.warcraftrpg2e?.feat?.category === "Shout"
  );
  return Object.entries(HERO_POINT_OPTIONS).filter(([key]) => {
    if (key === "intimidatingShout") return hasIntimidatingShout;
    if (key === "extraShout") return hasShout;
    return true;
  });
}

async function openHeroPointDialog(actor) {
  const state = heroPointState(actor);
  if (state.pending) {
    return new Dialog({
      title: game.i18n.localize("D35E.WarcraftHeroPendingTitle"),
      content: `<p>${game.i18n.format("D35E.WarcraftHeroPending", { option: HERO_POINT_OPTIONS[state.pending.option]?.label ?? state.pending.option })}</p>`,
      buttons: {
        keep: { label: game.i18n.localize("D35E.Keep") },
        cancel: {
          label: game.i18n.localize("D35E.WarcraftHeroCancelRefund"),
          callback: async () => {
            await cancelPendingHeroPoint(actor);
            actor.sheet?.render(false);
          },
        },
      },
      default: "keep",
    }).render(true);
  }
  if (state.value < 1) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftHeroNone"));
  const options = availableOptions(actor)
    .map(([key, data]) => `<option value="${key}">${data.label}</option>`)
    .join("");
  const content = `<form class="warcraft-hero-point-dialog"><div class="form-group"><label for="warcraft-hero-choice">${game.i18n.localize("D35E.WarcraftHeroChoose")}</label><select id="warcraft-hero-choice" name="option">${options}</select></div><p class="notes">${game.i18n.localize("D35E.WarcraftHeroBeforeRoll")}</p></form>`;
  return new Dialog({
    title: `${game.i18n.localize("D35E.HeroPoints")} — ${actor.name}`,
    content,
    buttons: {
      spend: {
        label: game.i18n.localize("D35E.WarcraftHeroSpend"),
        callback: async (html) => {
          const root = rootElement(html);
          const option = root.querySelector?.('[name="option"]')?.value;
          const result = buildHeroPointSpendUpdate(actor, option);
          if (!result.valid) return ui.notifications.warn(result.reason);
          await actor.update(result.update);
          if (HERO_POINT_OPTIONS[option]?.immediate) await applyImmediateOption(actor, option);
          else ui.notifications.info(game.i18n.format("D35E.WarcraftHeroArmed", { option: HERO_POINT_OPTIONS[option].label }));
          actor.sheet?.render(false);
        },
      },
      cancel: { label: game.i18n.localize("D35E.Cancel") },
    },
    default: "spend",
  }).render(true);
}

function injectHeroPointControls(sheet, html) {
  const actor = sheet?.actor ?? sheet?.object;
  if (!actor || actor.type !== "character" || !sheet.isEditable) return;
  const root = rootElement(html);
  if (!root?.querySelector || root.querySelector('[data-action="warcraft-hero-point"]')) return;
  const valueInput = root.querySelector('input[name="system.attributes.heroPoints.value"]');
  const row = valueInput?.closest(".flexrow") ?? valueInput?.parentElement;
  if (!row) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.action = "warcraft-hero-point";
  button.className = "warcraft-resource-action";
  button.title = game.i18n.localize("D35E.WarcraftHeroSpend");
  button.setAttribute("aria-label", button.title);
  button.innerHTML = '<i class="fas fa-star" aria-hidden="true"></i>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    void openHeroPointDialog(actor);
  });
  row.append(button);
  const pending = heroPointState(actor).pending;
  if (pending) {
    const badge = document.createElement("span");
    badge.className = "warcraft-resource-pending";
    badge.textContent = game.i18n.localize("D35E.WarcraftHeroPendingShort");
    badge.title = HERO_POINT_OPTIONS[pending.option]?.label ?? pending.option;
    row.append(badge);
  }
}

function escape(value) {
  const text = String(value ?? "");
  return foundry.utils.escapeHTML?.(text) ?? text.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function tokenDistance(source, target) {
  if (!source || !target || !globalThis.canvas?.grid) return null;
  if (typeof canvas.grid.measurePath === "function") return Number(canvas.grid.measurePath([source.center, target.center])?.distance);
  if (typeof canvas.grid.measureDistance === "function") return Number(canvas.grid.measureDistance(source.center, target.center));
  return null;
}

function shoutTargets(actor, rules, { doubled = false } = {}) {
  const source = actor?.getActiveTokens?.()[0];
  if (!source || !canvas?.tokens?.placeables) return rules.targets === "allies" ? [{ actor, token: null }] : [];
  const sourceDisposition = source.document?.disposition ?? source.disposition;
  const radius = rules.adjacent
    ? Number(canvas?.dimensions?.distance ?? canvas?.scene?.grid?.distance ?? 5)
    : Number(rules.radius || 30) * (doubled ? 2 : 1);
  const candidates = canvas.tokens.placeables
    .map((token) => ({ actor: token.actor, token, distance: tokenDistance(source, token) }))
    .filter(({ actor: targetActor, token, distance }) => {
      if (!targetActor || !Number.isFinite(distance) || distance > radius) return false;
      const disposition = token.document?.disposition ?? token.disposition;
      if (rules.targets === "allies") return targetActor.uuid === actor.uuid || disposition === sourceDisposition;
      return targetActor.uuid !== actor.uuid && disposition !== sourceDisposition;
    });
  return Array.from(new Map(candidates.map((entry) => [entry.actor.uuid, entry])).values());
}

async function timedBuffData({ name, durationRounds, change = null, condition = null, challenge = null }) {
  let data = null;
  const templateId = condition === "shaken" ? SHAKEN_BUFF_ID : condition === "panicked" ? PANICKED_BUFF_ID : null;
  if (templateId) {
    const template = await game.packs.get(COMMON_BUFF_PACK)?.getDocument(templateId);
    data = template?.toObject() ?? null;
  }
  data ??= { name, type: "buff", img: "icons/svg/sound.svg", system: {} };
  delete data._id;
  data.name = name;
  foundry.utils.setProperty(data, "system.active", false);
  foundry.utils.setProperty(data, "system.buffType", "temp");
  foundry.utils.setProperty(data, "system.timeline.enabled", true);
  foundry.utils.setProperty(data, "system.timeline.elapsed", 0);
  foundry.utils.setProperty(data, "system.timeline.total", durationRounds);
  foundry.utils.setProperty(data, "system.timeline.formula", String(durationRounds));
  foundry.utils.setProperty(data, "system.timeline.deleteOnExpiry", true);
  foundry.utils.setProperty(data, "system.timeline.tickOnEnd", false);
  if (change) foundry.utils.setProperty(data, "system.changes", [Array.from(change)]);
  if (condition === "panicked") {
    foundry.utils.setProperty(data, "system.changes", [
      ["-2", "savingThrows", "allSavingThrows", "untyped"],
      ["-2", "skills", "skills", "untyped"],
      ["-2", "abilityChecks", "allChecks", "untyped"],
    ]);
  }
  if (challenge) foundry.utils.setProperty(data, "flags.warcraftrpg2e.shout.challenge", challenge);
  return data;
}

async function applyTimedBuff(targetActor, options) {
  if (!targetActor?.isOwner && !game.user?.isGM) return false;
  const data = await timedBuffData(options);
  const [created] = await targetActor.createEmbeddedDocuments("Item", [data]);
  if (created) await created.update({ "system.active": true });
  return Boolean(created);
}

async function resolveShout(item, actor, { extraShout = false, heroIntimidating = false } = {}) {
  const resolution = shoutResolution(actor, item.name, { heroPoint: heroIntimidating });
  if (!resolution) return;
  if (extraShout) {
    if (typeof resolution.durationRounds === "number") resolution.durationRounds *= 2;
    if (resolution.radius) resolution.radius *= 2;
  }
  const targets = shoutTargets(actor, resolution, { doubled: false });
  const outcomes = [];
  for (const target of targets) {
    let failedSave = true;
    let saveRoll = null;
    if (resolution.save) {
      const total = Number(target.actor.system?.attributes?.savingThrows?.will?.total) || 0;
      saveRoll = await new Roll35e("1d20 + @bonus", { bonus: total }).roll();
      failedSave = saveRoll.total < resolution.saveDc;
    }
    let applied = false;
    if (failedSave) {
      let durationRounds = resolution.durationRounds;
      if (typeof durationRounds === "string") durationRounds = (await new Roll35e(durationRounds).roll()).total;
      applied = await applyTimedBuff(target.actor, {
        name: `${item.name} (${actor.name})`,
        durationRounds,
        change: resolution.change,
        condition: resolution.condition,
        challenge: resolution.restriction ? {
          shouterActorUuid: actor.uuid,
          shouterTokenId: actor.getActiveTokens?.()[0]?.id ?? "",
          sourceItemUuid: item.uuid,
        } : null,
      });
    }
    outcomes.push({ name: target.actor.name, saveRoll, failedSave, applied });
  }
  const rows = outcomes.map((outcome) => {
    const save = outcome.saveRoll
      ? `${game.i18n.localize("D35E.WarcraftShoutWillSave")} ${outcome.saveRoll.total} ${outcome.failedSave ? game.i18n.localize("D35E.Failure") : game.i18n.localize("D35E.Success")}`
      : game.i18n.localize("D35E.WarcraftShoutAffected");
    const manual = outcome.failedSave && !outcome.applied ? `; ${game.i18n.localize("D35E.WarcraftShoutManualApply")}` : "";
    return `<li><strong>${escape(outcome.name)}</strong>: ${escape(save + manual)}</li>`;
  }).join("");
  const radius = resolution.adjacent
    ? game.i18n.localize("D35E.WarcraftShoutAdjacent")
    : game.i18n.format("D35E.WarcraftShoutRadius", { radius: resolution.radius ?? 30 });
  await ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="D35E chat-card warcraft-shout-card"><h3>${escape(item.name)}</h3><p>${escape(radius)}; ${escape(game.i18n.format("D35E.WarcraftShoutDuration", { rounds: resolution.durationRounds }))}${resolution.saveDc ? `; ${escape(game.i18n.format("D35E.WarcraftShoutSaveDc", { dc: resolution.saveDc }))}` : ""}</p>${rows ? `<ul>${rows}</ul>` : `<p>${escape(game.i18n.localize("D35E.WarcraftShoutNoTargets"))}</p>`}</div>`,
    rolls: outcomes.flatMap((outcome) => outcome.saveRoll ? [outcome.saveRoll] : []),
  });
}

async function consumeShoutUse(item, actor, { extraShout = false, heroIntimidating = false } = {}) {
  const rules = item?.flags?.warcraftrpg2e?.feat?.rules;
  if (item?.type !== "feat" || item?.flags?.warcraftrpg2e?.feat?.category !== "Shout" || !rules?.usesSharedPool) return;
  const uses = actor?.system?.attributes?.shoutUses;
  const combatKey = game.combat?.started ? `${game.combat.id}:${game.combat.round}` : null;
  const update = {};
  if (!extraShout) update["system.attributes.shoutUses.value"] = Math.max(0, Number(uses.value) - 1);
  if (combatKey) update["flags.warcraftrpg2e.shout.lastUse"] = combatKey;
  await actor.update(update);
  if (extraShout) {
    await clearPendingHeroPoint(actor);
    await postHeroDeclaration(actor, "extraShout");
  } else if (heroIntimidating) {
    await clearPendingHeroPoint(actor);
    await postHeroDeclaration(actor, "intimidatingShout");
  }
  await resolveShout(item, actor, { extraShout, heroIntimidating });
}

function challengeBlocksAttack(item, actor) {
  if (!actor || item?.system?.actionType !== "mwak") return false;
  const challenges = Array.from(actor.items ?? []).filter((buff) =>
    buff?.type === "buff" && buff.system?.active && buff.flags?.warcraftrpg2e?.shout?.challenge
  );
  if (!challenges.length || !game.user?.targets?.size) return false;
  return challenges.some((buff) => {
    const shouterUuid = buff.flags.warcraftrpg2e.shout.challenge.shouterActorUuid;
    return Array.from(game.user.targets).some((target) => target.actor?.uuid !== shouterUuid);
  });
}

export class WarcraftHeroPointHook {
  static register() {
    Hooks.on("renderActorSheet", injectHeroPointControls);
    Hooks.on("D35E.preRollSkill", (_name, hookData, rollData, userId) => {
      if (userId !== game.userId) return;
      const actor = actorFromRollData(rollData);
      if (!actor || !heroPendingMatches(actor, "d20")) return;
      hookData.skillSourceDetails.push({ value: 20, name: game.i18n.localize("D35E.HeroPoints") });
      void clearPendingHeroPoint(actor);
    });
    Hooks.on("D35E.ItemUse.preUseItem", (item, actor, hookValues) => {
      if (challengeBlocksAttack(item, actor)) {
        hookValues.customUse = true;
        ui.notifications.warn(game.i18n.localize("D35E.WarcraftShoutChallengeBlocks"));
        return;
      }
      const rules = item?.flags?.warcraftrpg2e?.feat?.rules;
      if (item?.type !== "feat" || item?.flags?.warcraftrpg2e?.feat?.category !== "Shout" || !rules?.usesSharedPool || !WARCRAFT_SHOUTS[item.name]) return;
      const extraShout = heroPendingMatches(actor, "extraShout");
      const heroIntimidating = item.name === "Intimidating Shout" && heroPendingMatches(actor, "intimidatingShout");
      const uses = actor?.system?.attributes?.shoutUses;
      if ((!uses || Number(uses.value) < 1) && !extraShout) {
        hookValues.customUse = true;
        ui.notifications.warn(game.i18n.localize("D35E.WarcraftShoutNoUses"));
        return;
      }
      const combatKey = game.combat?.started ? `${game.combat.id}:${game.combat.round}` : null;
      if (combatKey && actor?.flags?.warcraftrpg2e?.shout?.lastUse === combatKey) {
        hookValues.customUse = true;
        ui.notifications.warn(game.i18n.localize("D35E.WarcraftShoutOncePerRound"));
        return;
      }
      hookValues.customUse = true;
      void consumeShoutUse(item, actor, { extraShout, heroIntimidating });
    });
  }
}
