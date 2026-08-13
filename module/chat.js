/**
 * Optionally hide the display of chat card action buttons which cannot be performed by the user
 */
import { ActorPF } from "./actor/entity.js";
import { ItemChatAction } from "./item/chat/chatAction.js";
import { ActorDamageHelper } from "./actor/helpers/actorDamageHelper.js";
import { CHAT_MESSAGE_STYLE_KEY, CHAT_MESSAGE_STYLE_CHAT } from "./lib.js";
import { LEGACY_SYSTEM_FLAG_SCOPE, SYSTEM_FLAG_SCOPE } from "./utils/system-flags.js";

const CHAT_FLAG_SCOPE = SYSTEM_FLAG_SCOPE;
const LEGACY_CHAT_FLAG_SCOPE = LEGACY_SYSTEM_FLAG_SCOPE;

/**
 * Convert legacy chat flag payloads supplied by older callers into the active
 * system scope before ChatMessage creation. This accepts both nested and
 * flattened document-data forms while keeping new messages legacy-free.
 */
function normalizeChatFlagScopes(chatData) {
  const normalized = { ...chatData, flags: { ...(chatData.flags ?? {}) } };
  const modernFlags = normalized.flags[CHAT_FLAG_SCOPE] ?? {};
  const legacyFlags = normalized.flags[LEGACY_CHAT_FLAG_SCOPE] ?? {};
  normalized.flags[CHAT_FLAG_SCOPE] = { ...legacyFlags, ...modernFlags };
  delete normalized.flags[LEGACY_CHAT_FLAG_SCOPE];

  const legacyPrefix = `flags.${LEGACY_CHAT_FLAG_SCOPE}.`;
  for (const [path, value] of Object.entries(normalized)) {
    if (!path.startsWith(legacyPrefix)) continue;
    foundry.utils.setProperty(normalized, `flags.${CHAT_FLAG_SCOPE}.${path.slice(legacyPrefix.length)}`, value);
    delete normalized[path];
  }
  return normalized;
}

export function bindShowReveal(chatMessage, html, data) {
  const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
  if (!root?.addEventListener) return;
  root.addEventListener("click", (event) => {
    const target = event.target.closest(".reveal-roll");
    if (target) {
      event.stopPropagation();
      chatMessage.setFlag(CHAT_FLAG_SCOPE, "revealed", true);
    }
  });
  root.addEventListener("click", (event) => {
    const target = event.target.closest(".hide-roll");
    if (target) {
      event.stopPropagation();
      chatMessage.setFlag(CHAT_FLAG_SCOPE, "revealed", false);
    }
  });
}

export const displayChatActionButtons = function (message, html, data) {
  const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
  const chatCard = root?.querySelector?.(".D35E.chat-card");
  if (!chatCard) return;

  const buttons = chatCard.querySelectorAll("button[data-action]:not(.everyone)");
  buttons.forEach((btn) => {
    if (game.settings.get("warcraftrpg2e", "allowPlayersApplyActions")) btn.classList.add("everyone");
  });
  const actor = game.actors.get(data.message.speaker.actor);
  if (actor && actor.isOwner) return;
  if (game.user.isGM || data.author.id === game.user.id) return;

  buttons.forEach((btn) => {
    if (!game.settings.get("warcraftrpg2e", "allowPlayersApplyActions")) btn.disabled = true;
  });
};

/* -------------------------------------------- */

function cleanChatTemplateData(chatTemplateData) {
  if (chatTemplateData.actor) {
    chatTemplateData.actor = {
      id: chatTemplateData.actor.id,
      name: chatTemplateData.actor.name,
      img: chatTemplateData.actor.img,
    };
  }
  if (chatTemplateData.item) {
    chatTemplateData.item = {
      id: chatTemplateData.item.id,
      name: chatTemplateData.item.name,
      img: chatTemplateData.item.img,
      vsTouchAc: chatTemplateData.item?.system?.ability?.vsTouchAc,
    };
  }
  // Convert ChatAttack instances to plain objects so they survive JSON serialization
  // into flags. Class instances with Item/Actor refs cause deep-clone to bail in v14,
  // producing {} entries in the stored chatTemplateData.attacks array.
  if (Array.isArray(chatTemplateData.attacks)) {
    chatTemplateData.attacks = chatTemplateData.attacks.map(atk => ({
      hasAttack: atk.hasAttack,
      hasCritConfirm: atk.hasCritConfirm,
      hasDamage: atk.hasDamage,
      hasAltDamage: atk.hasAltDamage,
      hasSubdamage: atk.hasSubdamage,
      attack: atk.attack,
      critConfirm: atk.critConfirm,
      damage: atk.damage,
      critDamage: atk.critDamage,
      altDamage: atk.altDamage,
      subDamage: atk.subDamage,
      label: atk.label,
      cards: atk.cards,
      altCards: atk.altCards,
      special: atk.special,
      effectNotes: atk.effectNotes,
      natural20: atk.natural20,
      natural20Crit: atk.natural20Crit,
      fumble: atk.fumble,
      fumbleCrit: atk.fumbleCrit,
      spellPenetration: atk.spellPenetration,
      isSpell: atk.isSpell,
      normalDamage: atk.normalDamage,
    }));
  }
  return chatTemplateData;
}

export const createCustomChatMessage = async function (
  chatTemplate,
  chatTemplateData = {},
  chatData = {},
  { rolls = [] } = {}
) {
  let rollMode = game.settings.get("core", "rollMode");
  chatTemplateData = cleanChatTemplateData(chatTemplateData);
  chatData = normalizeChatFlagScopes(chatData);
  const suppliedSystemFlags = chatData.flags?.[CHAT_FLAG_SCOPE] ?? {};
  chatData = foundry.utils.mergeObject(
    {
      rollMode: rollMode,
      user: game.user.id,
      [CHAT_MESSAGE_STYLE_KEY]: CHAT_MESSAGE_STYLE_CHAT,
    },
    chatData
  );
  chatData.flags = {
    ...(chatData.flags ?? {}),
    "core.canPopout": chatData.flags?.["core.canPopout"] ?? true,
    [CHAT_FLAG_SCOPE]: {
      chatTemplateData: chatTemplateData,
      template: chatTemplate,
      revealed: false,
      ...suppliedSystemFlags,
    },
  };
  chatData.content = await foundry.applications.handlebars.renderTemplate(chatTemplate, chatTemplateData);
  // Handle different roll modes
  switch (chatData.rollMode) {
    case "gmroll":
      chatData["whisper"] = game.users.contents.filter((u) => u.isGM).map((u) => u.id);
      break;
    case "selfroll":
      chatData["whisper"] = [game.user.id];
      break;
    case "blindroll":
      chatData["whisper"] = game.users.contents.filter((u) => u.isGM).map((u) => u.id);
      chatData["blind"] = true;
      break;
  }

  // Dice So Nice integration
  if (chatData.roll != null && rolls.length === 0) rolls = [chatData.roll];
  if (game.dice3d) {
    let promises = [];
    for (let roll of rolls) {
      promises.push(game.dice3d.showForRoll(roll, game.user, true, chatData.whisper, chatData.blind));
    }
    await Promise.all(promises);
    chatData.sound = null;
  }

  let chat = await ChatMessage.create(chatData);
  return true;
};

export const hideRollInfo = function (app, html, data) {
  const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
  const whisper = app.whisper || [];
  const isBlind = whisper.length && app.blind;
  const isVisible = whisper.length ? whisper.includes(game.user.id) || (app.isAuthor && !isBlind) : true;
  if (!isVisible && root) {
    root.querySelectorAll?.(".dice-formula").forEach((el) => { el.textContent = "???"; });
    root.querySelectorAll?.(".dice-total").forEach((el) => { el.textContent = "?"; });
    root.querySelectorAll?.(".dice").forEach((el) => { el.textContent = ""; });
    root.querySelectorAll?.(".success").forEach((el) => el.classList.remove("success"));
    root.querySelectorAll?.(".failure").forEach((el) => el.classList.remove("failure"));
  }
};

export const hideGMSensitiveInfo = function (app, html, data) {
  if (game.user.isGM) return;

  let speaker = app.speaker,
    actor =
      speaker != null ? (speaker.actor ? game.actors.get(speaker.actor) : canvas.tokens?.get(speaker.token)?.actor) : null;
  //game.D35E.logger.log('Message | Cleaning ', actor, app, html)
  if (!actor || (actor && actor.testUserPermission(game.user, "LIMITED"))) return;

  const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
  if (!root) return;
  root.querySelectorAll?.(".gm-sensitive").forEach((el) => el.remove());

  if (game.settings.get("warcraftrpg2e", "playersNoDamageDetails")) {
    root.querySelectorAll?.(".toggle-content").forEach((el) => el.remove());
  }

  if (game.settings.get("warcraftrpg2e", "playersNoDCDetails")) {
    root.querySelectorAll?.(".dc-value").forEach((el) => { el.textContent = "?"; });
  }
};

export const enableToggles = function (app, html, data) {
  const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
  if (!root?.addEventListener) return;
  root.addEventListener("click", (event) => {
    const header = event.target.closest(".toggle-header");
    if (!header) return;
    event.preventDefault();
    const card = header.closest(".toggle-box");
    const content = card?.querySelector(".toggle-content");
    if (content) {
      const hidden = content.style.display === "none";
      content.style.display = hidden ? "" : "none";
    }
  });
};

/* -------------------------------------------- */

/**
 * This function is used to hook into the Chat Log context menu to add additional options to each message
 * These options make it easy to conveniently apply damage to controlled tokens based on the value of a Roll
 *
 * @param {HTMLElement} html    The Chat Message being rendered
 * @param {Array} options       The Array of Context Menu options
 *
 * @return {Array}              The extended options Array including new context choices
 */
export const addChatMessageContextOptions = function (html, options) {
  let canApply = (li) => {
    const msgId = li?.dataset?.messageId ?? li?.getAttribute?.("data-message-id");
    const message = game.messages.get(msgId);
    return message?.isRoll && message?.isContentVisible && canvas.tokens?.controlled.length;
  };
  options.push(
    {
      name: game.i18n.localize("D35E.ChatContextDamage"),
      icon: '<i class="fas fa-user-minus"></i>',
      condition: canApply,
      callback: (li) => applyChatCardDamage(li, 1),
    },
    {
      name: game.i18n.localize("D35E.ChatContextHealing"),
      icon: '<i class="fas fa-user-plus"></i>',
      condition: canApply,
      callback: (li) => applyChatCardDamage(li, -1),
    },
    {
      name: game.i18n.localize("D35E.ChatContextDoubleDamage"),
      icon: '<i class="fas fa-user-injured"></i>',
      condition: canApply,
      callback: (li) => applyChatCardDamage(li, 2),
    },
    {
      name: game.i18n.localize("D35E.ChatContextHalfDamage"),
      icon: '<i class="fas fa-user-shield"></i>',
      condition: canApply,
      callback: (li) => applyChatCardDamage(li, 0.5),
    }
  );
  return options;
};

/* -------------------------------------------- */

/**
 * Apply rolled dice damage to the token or tokens which are currently controlled.
 * This allows for damage to be scaled by a multiplier to account for healing, critical hits, or resistance
 *
 * @param {HTMLElement} li      The chat entry which contains the roll data
 * @param {Number} multiplier   A damage multiplier to apply to the rolled damage.
 * @return {Promise}
 */
function applyChatCardDamage(li, multiplier) {
  const msgId = li?.dataset?.messageId ?? li?.getAttribute?.("data-message-id");
  const message = game.messages.get(msgId);
  const roll = message.rolls?.[0];
  return Promise.all(
    canvas.tokens.controlled.map((t) => {
      const a = t.actor;
      ActorDamageHelper.applyDamage(
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        Math.floor(roll.total * multiplier),
        null,
        null,
        null,
        null,
        false,
        true,
        a
      );
    })
  );
}
