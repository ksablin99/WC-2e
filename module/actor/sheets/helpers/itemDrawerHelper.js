
import { LogHelper } from "../../../helpers/LogHelper.js";
import {CompendiumBrowser} from '../../../apps/compendium-browser.js';

export class ItemDrawerHelper {
  constructor(sheet) {
    this.sheet = sheet;
  }

  #filterIndexedItems(indexedItem, entityType, type, subtype) {
    //if (item.system.uniqueId) return false
    if (entityType === "spells" && indexedItem.type !== type) return false;
    if (
      entityType === "items" &&
      type.split(",").indexOf(indexedItem.type) !== -1 &&
      (indexedItem?.system?.index?.subType === subtype || subtype === "-")
    )
      return true;
    if (entityType === "feats")
      if (indexedItem.type === type && indexedItem?.system?.index?.subType === subtype && !indexedItem?.system?.index?.uniqueId)
      return true;
    if (entityType === "buffs" && indexedItem.type !== type) return false;
    if (entityType === "enhancements" && indexedItem.type !== "enhancement") return false;
    return false;
  }
  async loadDrawerData(label, entityType, type, subtype, filter) {
    const overlay = document.querySelector(`.item-add-${this.sheet.randomUuid}-overlay`);
    if (overlay && getComputedStyle(overlay).display !== "none") {
      return;
    }

    const labelEl = document.getElementById(`items-add-${this.sheet.randomUuid}-label`);
    if (labelEl) labelEl.textContent = `${game.i18n.localize("D35E.Add")} ${label}`;

    if (overlay) overlay.style.display = "";
    document.querySelectorAll(`.items-add-${this.sheet.randomUuid}-working-item`).forEach(el => el.style.display = "");
    document.querySelectorAll(`.items-add-${this.sheet.randomUuid}-list`).forEach(el => el.style.display = "none");
    sessionStorage.setItem(`D35E-last-ent-type-${this.sheet.id}`, entityType);
    sessionStorage.setItem(`D35E-last-type-${this.sheet.id}`, type);
    sessionStorage.setItem(`D35E-last-subtype-${this.sheet.id}`, subtype);
    sessionStorage.setItem(`D35E-opened-${this.sheet.id}`, true);
    sessionStorage.setItem(`D35E-label-${this.sheet.id}`, label);
    const itemList = document.getElementById(`${this.sheet.randomUuid}-itemList`);
    if (itemList) itemList.innerHTML = "";
    for (let p of game.packs.values()) {
      if (p.private && !game.user.isGM) continue;
      if ((p.entity || p.documentName) !== "Item") continue;

      for (let indexElement of (await p.getIndex()).values()) {
        if (!this.#filterIndexedItems(indexElement, entityType, type, subtype)) continue;
        const template = document.createElement("template");
        template.innerHTML =
          `<li class="item-list-item item" data-item-id="${indexElement._id}">
                             <div class="item-name non-rollable flexrow">
                             <div class="item-image non-rollable" style="background-image: url('${indexElement.img}')"></div>
                              <span class="display-item-info" data-item-id="${indexElement._id}">${indexElement.name}</span>
                              <a class="item-control"  style="flex: 0; margin: 0 4px;" title="Remove Quantity" onclick="modifyInputValue('amount-add-${indexElement._id}',-1)">
                                  <i class="fas fa-minus remove-skill"></i>
                              </a>
                              <input type="text"  class="skill-value" name='amount-add-${indexElement._id}' value="1" readonly style="border: none; flex: 0 25px; text-align: center;" placeholder="0"/>
                              <a class="item-control" title="Add Quantity" style="flex: 0 20px; margin: 0 4px;" onclick="modifyInputValue('amount-add-${indexElement._id}',1)">
                                  <i class="fas fa-plus add-skill"></i>
                              </a>
                              <a class="add-from-compendium blue-button" style="flex: 0 40px; text-align: center">Add</a> </div>
                              <div class="item-description-box" style="display: none;     border: 1px solid rgba(255,255,255,0.5);
                                border-radius: 4px;
                                padding: 4px;">
                              <div class="item-description">[empty]</div>
                              </div>
                      </li>`;
        const li = template.content.firstElementChild;
        li.querySelector(".add-from-compendium").addEventListener("mouseup", (ev) => {
          sessionStorage.setItem(`D35E-position-${this.sheet.id}`, itemList ? itemList.scrollTop : 0);
          this.sheet._addItemFromBrowser(p.metadata.id, indexElement._id, ev);
        });
        li.querySelector(".display-item-info").addEventListener("mouseup", async (ev) => {
          const desc = li.querySelector(".item-description");
          if (desc && desc.textContent === "[empty]") {
            desc.innerHTML = await (await p.getDocument(indexElement._id)).getDescription();
          }
          li.classList.toggle("slideout-bordered-item");
          const descBox = li.querySelector(".item-description-box");
          if (descBox) descBox.style.display = descBox.style.display === "none" ? "" : "none";
        });
        if (itemList && !itemList.querySelector(`li[data-item-id='${indexElement._id}']`)) {
          itemList.appendChild(li);
        }
      }
    }

    document.querySelectorAll(`.items-add-${this.sheet.randomUuid}-openCompendium`).forEach(el => {
      const clone = el.cloneNode(true);
      el.parentNode.replaceChild(clone, el);
      clone.addEventListener("mouseup", (ev) => {
        sessionStorage.setItem(`D35E-opened-${this.sheet.id}`, false);
        if (overlay) overlay.style.display = "none";
        CompendiumBrowser.browseCompendium(entityType, "Item");
      });
    });
    document.querySelectorAll(`.items-add-${this.sheet.randomUuid}-working-item`).forEach(el => el.style.display = "none");
    document.querySelectorAll(`.items-add-${this.sheet.randomUuid}-list`).forEach(el => el.style.display = "");
    if (filter) {
      const filterInput = document.getElementById(`${this.sheet.randomUuid}-itemList-filter`);
      if (filterInput) filterInput.value = filter;
      if (itemList) {
        itemList.querySelectorAll("li").forEach(li => {
          li.style.display = li.textContent.toLowerCase().indexOf(filter) > -1 ? "" : "none";
        });
      }
    }
  }
}
