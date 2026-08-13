import { ActorPF } from "../../actor/entity.js";
import { ChatHelper } from "../../helpers/chatHelper.js";
import {ActorDamageHelper} from '../../actor/helpers/actorDamageHelper.js';

export class ItemChatAction {
  /* -------------------------------------------- */

  static async _onChatCardAction(event) {
    event.preventDefault();

    // Extract card data (button is the clicked element, not currentTarget which is the listener root)
    const eventTarget = event.target instanceof Element ? event.target : event.target?.parentElement;
    const button = eventTarget?.closest?.(".card-buttons button");
    if (!button) return;
    button.disabled = true;
    const canBeUsedByEveryone = button.classList.contains("everyone");
    const noActor = button.classList.contains("no-actor");
    const singleUse = button.classList.contains("single-use");
    const card = button.closest(".chat-card");
    if (!card) {
      button.disabled = false;
      return;
    }
    const messageEl = card.closest(".message");
    const messageId = messageEl?.dataset?.messageId ?? messageEl?.getAttribute?.("data-message-id");
    const message = messageId ? game.messages.get(messageId) : null;
    if (!message) {
      button.disabled = false;
      return;
    }
    const action = button.dataset.action;

    // Validate permission to proceed with the roll
    // const isTargetted = action === "save";
    const isTargetted = false;
    let _actor = game.actors.get(message.speaker.actor);
    let isOwnerOfToken = false;
    if (_actor) isOwnerOfToken = _actor.testUserPermission(game.user, "OWNER");
    if (!(isTargetted || game.user.isGM || message.isAuthor || isOwnerOfToken || canBeUsedByEveryone)) {
      //game.D35E.logger.log('No permission', isTargetted, game.user.isGM, isOwnerOfToken)
      button.disabled = false;
      return;
    }

    // Get the Actor from a synthetic Token
    const actor = ChatHelper.getChatCardActor(card);
    if (!actor && !noActor) {
      button.disabled = false;
      return;
    }

    // Get the Item
    let item = null;
    if (!noActor) {
      item = actor.items.get(card.dataset.itemId);
    }

    // Get the Originating Attack
    const originatingAttackId = button.dataset.originatingAttackId;


    // Get card targets
    const targets = isTargetted ? ChatHelper.getChatCardTargets(card) : [];

    // Consumable usage
    if (action === "consume") await item.rollConsumable({ event });
    // Apply damage
    else if (action === "applyDamage" || action === "applyDamageHalf") {
      //const value = button.dataset.value;
      const damage = JSON.parse(button.dataset.json || {});
      const normalDamage = JSON.parse(button.dataset.normaljson || "{}");
      const material =
        button.dataset.material && button.dataset.material !== "" ? JSON.parse(button.dataset.material) : {};
      const alignment =
        button.dataset.alignment && button.dataset.alignment !== "" ? JSON.parse(button.dataset.alignment) : {};
      const enh = parseInt(button.dataset.enh || "0");
      const roll = parseInt(button.dataset.roll || "-1337");
      const isSpell = button.dataset.spell === "true";
      const critroll = parseInt(button.dataset.critroll || "0");
      const nonLethal = button.dataset.nonlethal === "true";
      const natural20 = button.dataset.natural === "true";
      const natural20Crit = button.dataset.naturalcrit === "true";
      const fumble = button.dataset.fumble === "true";
      const fumbleCrit = button.dataset.fumblecrit === "true";
      const attackerToken = button.dataset.attackertoken;
      const attacker = button.dataset.attacker;
      const ammoId = button.dataset.ammoid;
      const touch = button.dataset.touch === "true";
      const incorporeal = button.dataset.incorporeal === "true";
      event.applyHalf = action === "applyDamageHalf";
      ActorDamageHelper.applyDamage(
        event,
        roll,
        critroll,
        natural20,
        natural20Crit,
        fumble,
        fumbleCrit,
        damage,
        normalDamage,
        material,
        alignment,
        enh,
        nonLethal,
        !damage,
        null,
        attacker,
        attackerToken,
        ammoId,
        incorporeal,
        touch
      );
    } else if (action === "applyHealing") {
      const value = button.dataset.value;
      ActorDamageHelper.applyDamage(event, null, null, null, null, null, null, value, null, null, null, null, false, true);
    }

    // Roll saving throw
    else if (action === "rollSave") {
      const type = button.dataset.value;
      const ability = button.dataset.ability;
      const target = button.dataset.target;
      const targetRollType = button.dataset.targetrollmode;
      if (type) ActorPF._rollSave(type, ability, target, {rollMode: targetRollType});
    } else if (action === "rollSkill") {
      const type = button.dataset.value;
      const target = button.dataset.target;
      const targetRollType = button.dataset.targetrollmode;
      if (type) ActorPF._rollSkill(type, {target: target, rollMode: targetRollType});
    } else if (action === "rollAbility") {
      const type = button.dataset.value;
      const target = button.dataset.target;
      const targetRollType = button.dataset.targetrollmode;
      if (type) ActorPF._rollAbilityCheck(type, {target: target, rollMode: targetRollType});
    } else if (action === "rollPR") {
      const spellPenetration = button.dataset.spellpen;
      ActorPF._rollPowerResistance(spellPenetration);
    } else if (action === "rollSR") {
      const spellPenetration = button.dataset.spellpen;
      ActorPF._rollSpellResistance(spellPenetration);
    } else if (action === "customAction") {
      const value = button.dataset.value;
      const actionValue = value;
      /*
       * Action Value syntax
       * <action> <object> on <target>, for example:
       * - Add <item name> from <compendium> on self
       * - Remove <quantity> <item name> <?type> on self
       * - Clear <buff> <temporary> on target
       * - Damage <roll> on self
       * -
       */

      await actor.applyActionOnSelf(actionValue, actor, null, "self", originatingAttackId);
      await ActorPF.applyAction(actionValue, actor);
    }

    // Re-enable the button
    if (!singleUse) button.disabled = false;
    else {
      await message.update({
        content: message.content.replace(
          button.outerHTML,
          `<button disabled class="disabled-action-button">${button.innerText}</button>`
        ),
      });
      //game.D35E.logger.log(message, button)
    }
  }

  /* -------------------------------------------- */

  /**
   * Handle toggling the visibility of chat card content when the name is clicked
   * @param {Event} event   The originating click event
   * @private
   */
  static _onChatCardToggleContent(event) {
    event.preventDefault();
    const eventTarget = event.target instanceof Element ? event.target : event.target?.parentElement;
    const header = eventTarget?.closest?.(".item-name");
    if (!header) return;
    const card = header.closest(".chat-card");
    if (!card) return;
    const content = card.querySelector(".card-content.item");
    if (content) content.style.display = content.style.display === "none" ? "block" : "none";
  }
}
