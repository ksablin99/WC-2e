import { WarcraftCharacterCreation } from "../../apps/warcraft-character-creation.js";

function injectCharacterBuilder(sheet, html) {
  const actor = sheet?.actor ?? sheet?.object;
  if (actor?.type !== "character" || !actor.isOwner) return;
  const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
  if (!root || root.querySelector("[data-warcraft-character-builder]")) return;
  const navigation = root.querySelector(".sheet-navigation");
  if (!navigation) return;
  const controls = document.createElement("div");
  controls.className = "warcraft-character-builder-controls flexrow";
  controls.style.flex = "0 0 32px";
  controls.style.alignItems = "center";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn blue-button warcraft-character-builder";
  button.style.margin = "2px 0";
  button.dataset.warcraftCharacterBuilder = "true";
  button.title = game.i18n.localize("D35E.WarcraftCharacterBuilderHint");
  button.innerHTML = `<i class="fa-solid fa-user-plus" aria-hidden="true"></i> ${game.i18n.localize("D35E.WarcraftCharacterBuilder")}`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    new WarcraftCharacterCreation(actor).render(true);
  });
  controls.append(button);
  navigation.before(controls);
}
export class WarcraftCharacterCreationHook {
  static register() {
    Hooks.on("renderActorSheet", injectCharacterBuilder);
    Hooks.once("init", () => {
      game.D35E.WarcraftCharacterCreation = WarcraftCharacterCreation;
    });
  }
}
