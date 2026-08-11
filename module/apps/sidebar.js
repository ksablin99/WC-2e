import { CompendiumBrowser } from "../apps/compendium-browser.js";

export class SidebarPF extends Sidebar {
  constructor(...args) {
    super(...args);

    this.compendiums = {
      spells: new CompendiumBrowser({ type: "spells", entityType: "Item" }),
      items: new CompendiumBrowser({ type: "items", entityType: "Item" }),
      bestiary: new CompendiumBrowser({ type: "bestiary", entityType: "Actor" }),
    };
  }

  async _render(...args) {
    await super._render(...args);

    const el = this.element?.nodeType === 1 ? this.element : this.element?.[0] ?? this.element;
    const parent = el.querySelector("#compendium .directory-footer");
    const child = await foundry.applications.handlebars.renderTemplate("systems/warcraftrpg2e/templates/sidebar/compendiums-footer.html", {});
    parent.insertAdjacentHTML("beforeend", child);
    this.activateExtraListeners(parent);
  }

  activateExtraListeners(html) {
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
    root.querySelectorAll(".compendium-footer .compendium.spells").forEach(el => el.addEventListener("click", e => this._onBrowseCompendium(e, "spells")));
    root.querySelectorAll(".compendium-footer .compendium.items").forEach(el => el.addEventListener("click", e => this._onBrowseCompendium(e, "items")));
    root.querySelectorAll(".compendium-footer .compendium.bestiary").forEach(el => el.addEventListener("click", e => this._onBrowseCompendium(e, "bestiary")));
  }

  _onBrowseCompendium(event, type) {
    event.preventDefault();

    this.compendiums[type]._render(true);
  }
}