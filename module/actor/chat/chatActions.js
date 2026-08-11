import { Roll35e } from "../../roll.js";
import { ChatHelper } from "../../helpers/chatHelper.js";
import { ConjuredManager } from "../../conjuration/conjuredManager.js";

export class ActorChatActions {
  static async _onTargetHover(event) {
    event.preventDefault();
    const eventTarget = event.target instanceof Element ? event.target : event.target?.parentElement;
    const image = eventTarget?.closest?.("img[data-target]");
    if (!image) return;
    const tokenId = image.dataset.target;
    canvas.tokens.get(tokenId)._onHoverIn();
  }

  static async _onTargetClick(event) {
    event.preventDefault();
    const eventTarget = event.target instanceof Element ? event.target : event.target?.parentElement;
    const image = eventTarget?.closest?.("img[data-target]");
    if (!image) return;
    const tokenId = image.dataset.target;
    canvas.tokens.get(tokenId).setTarget();
  }

  static async _onTargetLeave(event) {
    event.preventDefault();
    const eventTarget = event.target instanceof Element ? event.target : event.target?.parentElement;
    const image = eventTarget?.closest?.("img[data-target]");
    if (!image) return;
    const tokenId = image.dataset.target;
    canvas.tokens.get(tokenId)._onHoverOut();
  }

  static async _onChatCardButtonAction(event) {
    event.preventDefault();

    // Delegated listener on chat log: currentTarget is the root, not the button
    const eventTarget = event.target instanceof Element ? event.target : event.target?.parentElement;
    const button = eventTarget?.closest?.("button[data-action]");
    if (!button) return;
    const card = button.closest(".chat-card");
    const action = button.dataset.action;

    // Get the Actor
    const actor = ChatHelper.getChatCardActor(card);

    button.disabled = true;
    try {
      if (action === "save") {
        const saveId = button.dataset.save;
        if (actor) await actor.rollSavingThrow(saveId, null, null, { event: event });
      } else if (action === "summon") {
        if (!canvas?.scene) {
          ui.notifications.warn("No active scene — cannot place summoned tokens.");
          return;
        }
        const monsterId = button.dataset.id;
        const monsterPack = button.dataset.pack;
        const user = button.dataset.user;
        const durationRounds = Math.max(0, parseInt(button.dataset.durationRounds ?? "", 10) || 0);
        let template = canvas.templates.get(button.dataset.measureId);
        let x = Number(template ? template.document.x : button.dataset.measureX);
        let y = Number(template ? template.document.y : button.dataset.measureY);
        if (!Number.isFinite(x)) x = 0;
        if (!Number.isFinite(y)) y = 0;
        const hasPlacedTemplate = !!(button.dataset.measureId && String(button.dataset.measureId).length);
        if (!hasPlacedTemplate && x === 0 && y === 0) {
          const casterTok = canvas.tokens?.placeables?.find((t) => t.actor?.id === actor?.id);
          const d = canvas.dimensions;
          if (casterTok) {
            x = casterTok.document.x;
            y = casterTok.document.y;
          } else if (d) {
            x = (d.rect?.x ?? 0) + (d.width ?? 0) / 2;
            y = (d.rect?.y ?? 0) + (d.height ?? 0) / 2;
          }
        }
        const summonFormula = button.dataset.formula || "1";
        const summonRoll = await new Roll35e(summonFormula, actor?.getRollData?.() ?? {}).roll();
        let totalMonster = Math.floor(Number(summonRoll.total) || 0);
        if (totalMonster < 1) totalMonster = 1;
        await ConjuredManager.spawnSummonFromChat({
          caster: actor,
          monsterId,
          monsterPack,
          userId: user,
          durationRounds,
          x,
          y,
          totalMonster,
        });

        if (template) {
          await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [button.dataset.measureId]);
        }
      }
    } catch (err) {
      ui.notifications.error(err.message || String(err));
      game.D35E?.logger?.error?.(err);
    } finally {
      button.disabled = false;
    }
  }
}
