import { WarcraftCharacterCreation } from "../../apps/warcraft-character-creation.js";

function injectCharacterBuilder(sheet, html) {
  const actor = sheet?.actor ?? sheet?.object;
  if (actor?.type !== "character" || !actor.isOwner) return;
  const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
  if (!root || root.querySelector("[data-warcraft-character-builder]")) return;
  const target = root.querySelector(".charlevel .experience") ?? root.querySelector(".charlevel") ?? root.querySelector(".header-details");
  if (!target) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn blue-button warcraft-character-builder";
  button.dataset.warcraftCharacterBuilder = "true";
  button.title = game.i18n.localize("D35E.WarcraftCharacterBuilderHint");
  button.innerHTML = `<i class="fa-solid fa-user-plus" aria-hidden="true"></i> ${game.i18n.localize("D35E.WarcraftCharacterBuilder")}`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    new WarcraftCharacterCreation(actor).render(true);
  });
  target.append(button);
}
export class WarcraftCharacterCreationHook {
  static register() {
    Hooks.on("renderActorSheet", injectCharacterBuilder);
    if (game?.D35E) game.D35E.WarcraftCharacterCreation = WarcraftCharacterCreation;
  }
}
