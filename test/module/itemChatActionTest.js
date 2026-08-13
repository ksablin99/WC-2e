jest.mock("../../module/actor/entity.js", () => ({
  ActorPF: {
    _rollSave: jest.fn(),
    _rollSkill: jest.fn(),
    _rollAbilityCheck: jest.fn(),
    _rollPowerResistance: jest.fn(),
    _rollSpellResistance: jest.fn(),
    applyAction: jest.fn(),
  },
}));
jest.mock("../../module/helpers/chatHelper.js", () => ({
  ChatHelper: {
    getChatCardActor: jest.fn(() => null),
    getChatCardTargets: jest.fn(() => []),
  },
}));
jest.mock("../../module/actor/helpers/actorDamageHelper.js", () => ({
  ActorDamageHelper: { applyDamage: jest.fn() },
}));

import { ActorDamageHelper } from "../../module/actor/helpers/actorDamageHelper.js";
import { ItemChatAction } from "../../module/item/chat/chatAction.js";

describe("ItemChatAction", () => {
  let originalElement;

  beforeEach(() => {
    originalElement = global.Element;
    global.Element = class Element {};
    ActorDamageHelper.applyDamage.mockClear();
  });

  afterEach(() => {
    global.Element = originalElement;
    delete game.messages;
    delete game.actors;
    delete game.user;
  });

  test("applies healing without referencing an attack-only roll variable", async () => {
    const messageElement = new Element();
    messageElement.dataset = { messageId: "message-1" };

    const card = new Element();
    card.dataset = {};
    card.closest = jest.fn((selector) => selector === ".message" ? messageElement : null);

    const button = new Element();
    button.dataset = { action: "applyHealing", value: "-7" };
    button.disabled = false;
    button.classList = {
      contains: jest.fn((className) => className === "everyone" || className === "no-actor"),
    };
    button.closest = jest.fn((selector) => {
      if (selector === ".card-buttons button") return button;
      if (selector === ".chat-card") return card;
      return null;
    });

    const message = { isAuthor: false, speaker: {} };
    game.messages = { get: jest.fn(() => message) };
    game.actors = { get: jest.fn(() => null) };
    game.user = { isGM: false };

    const event = { preventDefault: jest.fn(), target: button };

    await expect(ItemChatAction._onChatCardAction(event)).resolves.toBeUndefined();
    expect(ActorDamageHelper.applyDamage).toHaveBeenCalledTimes(1);
    const args = ActorDamageHelper.applyDamage.mock.calls[0];
    expect(args[0]).toBe(event);
    expect(args[1]).toBeNull();
    expect(args[7]).toBe("-7");
    expect(args[13]).toBe(true);
    expect(button.disabled).toBe(false);
  });
});
