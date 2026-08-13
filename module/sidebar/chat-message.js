import { getSystemFlag } from "../utils/system-flags.js";

export class ChatMessagePF extends ChatMessage {
  async update(data, context) {
    return super.update(data, context);
  }

  async renderHTML(options = {}) {
    const template = getSystemFlag(this, "template");
    if (template) {
      const storedTemplateData = getSystemFlag(this, "chatTemplateData") ?? {};
      const chatTemplateData = foundry.utils.deepClone
        ? foundry.utils.deepClone(storedTemplateData)
        : foundry.utils.duplicate(storedTemplateData);
      chatTemplateData.revealed = getSystemFlag(this, "revealed") || false;
      chatTemplateData.shouldDisplayTarget = chatTemplateData.revealed || game.user.isGM;
      chatTemplateData.isGM = game.user.isGM;
      const actorId = chatTemplateData?.actor?.id ?? chatTemplateData?.actor?._id;
      chatTemplateData.ownerOrGM = game.actors.get(actorId)?.isOwner || game.user.isGM;
      chatTemplateData.ownerOrGMAndNotBlind = chatTemplateData.ownerOrGM && (!this.blind || game.user.isGM);
      chatTemplateData.blind = this.blind;
      this.content = await foundry.applications.handlebars.renderTemplate(template, chatTemplateData);
    }
    return super.renderHTML(options);
  }
}
