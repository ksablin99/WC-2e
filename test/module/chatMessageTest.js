jest.mock("../../module/actor/entity.js", () => ({ ActorPF: class ActorPF {} }));
jest.mock("../../module/item/chat/chatAction.js", () => ({ ItemChatAction: {} }));
jest.mock("../../module/actor/helpers/actorDamageHelper.js", () => ({ ActorDamageHelper: {} }));

import { createCustomChatMessage } from "../../module/chat.js";
import { ChatMessagePF } from "../../module/sidebar/chat-message.js";

describe("ChatMessagePF flag compatibility", () => {
  let originalCreate;

  beforeEach(() => {
    originalCreate = ChatMessage.create;
    ChatMessage.prototype.getFlag = jest.fn(function (scope, key) {
      if (scope === "D35E") throw new Error("Invalid flag scope D35E");
      return foundry.utils.getProperty(this.flags?.[scope], key);
    });
    ChatMessage.prototype.renderHTML = jest.fn(async function () {
      return this.content;
    });

    foundry.applications = {
      handlebars: {
        renderTemplate: jest.fn(async (template, data) => `${template}:${data.label ?? ""}`),
      },
    };
    game.user = { id: "user-1", isGM: false };
    game.users = { contents: [] };
    game.actors = { get: jest.fn(() => null) };
    game.settings = { get: jest.fn(() => "publicroll") };
  });

  afterEach(() => {
    ChatMessage.create = originalCreate;
    delete ChatMessage.prototype.getFlag;
    delete ChatMessage.prototype.renderHTML;
    delete foundry.applications;
    delete game.user;
    delete game.users;
    delete game.actors;
    delete game.settings;
  });

  test("ordinary chat messages render without consulting an invalid flag scope", async () => {
    const message = new ChatMessagePF({ content: "ordinary message", flags: {} });

    await expect(message.renderHTML()).resolves.toBe("ordinary message");
    expect(message.getFlag).toHaveBeenCalledWith("warcraftrpg2e", "template");
    expect(message.getFlag).not.toHaveBeenCalledWith("D35E", expect.anything());
    expect(foundry.applications.handlebars.renderTemplate).not.toHaveBeenCalled();
  });

  test("legacy D35E chat cards render through raw flag fallback", async () => {
    const message = new ChatMessagePF({
      blind: false,
      content: "stored content",
      flags: {
        D35E: {
          template: "systems/warcraftrpg2e/templates/chat/legacy.html",
          chatTemplateData: { label: "legacy", actor: { id: "actor-1" } },
          revealed: true,
        },
      },
    });

    await expect(message.renderHTML()).resolves.toBe(
      "systems/warcraftrpg2e/templates/chat/legacy.html:legacy"
    );
    expect(message.getFlag).not.toHaveBeenCalledWith("D35E", expect.anything());
    expect(foundry.applications.handlebars.renderTemplate).toHaveBeenCalledWith(
      "systems/warcraftrpg2e/templates/chat/legacy.html",
      expect.objectContaining({ revealed: true, shouldDisplayTarget: true, blind: false })
    );
  });

  test("custom chat messages write only the active system flag scope", async () => {
    ChatMessage.create = jest.fn(async (data) => data);

    await createCustomChatMessage(
      "systems/warcraftrpg2e/templates/chat/test.html",
      { label: "modern" },
      { "flags.D35E.noRollRender": true }
    );

    const created = ChatMessage.create.mock.calls[0][0];
    expect(created.flags.warcraftrpg2e).toEqual(expect.objectContaining({
      template: "systems/warcraftrpg2e/templates/chat/test.html",
      revealed: false,
      noRollRender: true,
    }));
    expect(created.flags.D35E).toBeUndefined();
    expect(created["flags.D35E.noRollRender"]).toBeUndefined();
  });
});
