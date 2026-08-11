import { Item35E } from "../entity.js";
import {EnhancementSheetComponent} from "./components/enhancementSheetComponent.js";
import {ItemSheetPF} from "./base.js";
import {LinkedItemsSheetComponent} from "./components/linkedItemsSheetComponent.js";
import {ItemEquipHook} from "../hooks/itemEquipHook.js";
import { IntelligentItemPowersSheetComponent } from "./components/intelligentItemPowersSheetComponent.js";

export class EquipmentSheet35E extends ItemSheetPF {
    constructor(...args) {
        super(...args);

        this.sheetComponents.push(new EnhancementSheetComponent(this));
        this.sheetComponents.push(new LinkedItemsSheetComponent(this));
        this.sheetComponents.push(new IntelligentItemPowersSheetComponent(this));
    }

    async getData() {
        let sheetData = await super.getData();
        sheetData.hasCombatChanges = true;
        // Prepare categories for equipment
        sheetData.equipmentCategories = {types: {}, subTypes: {}};
        for (let [k, v] of Object.entries(CONFIG.D35E.equipmentTypes)) {
            if (typeof v === "object") sheetData.equipmentCategories.types[k] = v._label;
        }
        const type = this.item.system.equipmentType;
        if (foundry.utils.hasProperty(CONFIG.D35E.equipmentTypes, type)) {
            for (let [k, v] of Object.entries(CONFIG.D35E.equipmentTypes[type])) {
                // Add static targets
                if (!k.startsWith("_")) sheetData.equipmentCategories.subTypes[k] = v;
            }
        }

        // Prepare slots for equipment
        sheetData.equipmentSlots = CONFIG.D35E.equipmentSlots[type];

        // Whether the equipment should show armor data
        sheetData.showArmorData = ["armor", "shield"].includes(type);

        // Whether the current equipment type has multiple slots
        sheetData.hasMultipleSlots = Object.keys(sheetData.equipmentSlots).length > 1;

        // Compute slot positions when item is equipped and has multiple possible positions
        const slotKey = ItemEquipHook.getEffectiveSlot(this.item);
        sheetData.currentSlotSource = this.item.getFlag("D35E", "slotSource") ?? "";
        if (slotKey && this.item.parent && this.item.system.equipped) {
            const actor = this.item.parent;
            const defaultCapacity = CONFIG.D35E.defaultSlotCapacities?.[slotKey] ?? 1;

            // Gather active providers from items' changes — same eligibility as actorUpdater changeObjects.
            // Each entry is { id, name } so slotSource values use the stable item ID while labels show the name.
            const providers = [];
            for (const providerItem of actor.items) {
                if (providerItem.type === "buff" && !providerItem.system?.active) continue;
                if (providerItem.type === "aura" && !providerItem.system?.active) continue;
                if ((providerItem.type === "equipment" || providerItem.type === "weapon") &&
                    (!providerItem.system?.equipped || providerItem.system?.melded || providerItem.broken)) continue;
                for (const ch of (providerItem.system?.changes ?? [])) {
                    if (ch[2] === `slot.${slotKey}`) {
                        const extra = parseInt(ch[0]) || 0;
                        for (let i = 0; i < extra; i++) providers.push({ id: providerItem.id, name: providerItem.name });
                    }
                }
            }

            if (defaultCapacity > 1 || providers.length > 0) {
                const slotLabel = game.i18n.localize(`D35E.EquipSlot${slotKey.charAt(0).toUpperCase()}${slotKey.slice(1)}`);
                const positions = [];

                // Helper: does another equipped item of the same slot type map to this position?
                const isOccupied = (posValue, posIndex, posProvider) => {
                    return actor.items.some(it => {
                        if (it.id === this.item.id) return false;
                        if (it.type !== "equipment" || !it.system.equipped) return false;
                        if (ItemEquipHook.getEffectiveSlot(it) !== slotKey) return false;
                        const src = it.getFlag("D35E", "slotSource") ?? "";
                        if (posProvider === null) {
                            // Default position — match explicit index or floating-to-first
                            if (posIndex === 0) return !src || src === "" || src === ":0";
                            return src === `:${posIndex}`;
                        } else {
                            if (posIndex === 0) return src === posProvider || src === `${posProvider}:0`;
                            return src === posValue;
                        }
                    });
                };

                // Default position(s)
                for (let i = 0; i < defaultCapacity; i++) {
                    const posValue = i === 0 ? "" : `:${i}`;
                    const posLabel = defaultCapacity > 1 ? `${slotLabel} ${i + 1}` : game.i18n.localize("D35E.SlotPositionDefault");
                    positions.push({ value: posValue, label: posLabel, occupied: isOccupied(posValue, i, null) });
                }

                // Provider position(s)
                for (let pi = 0; pi < providers.length; pi++) {
                    const provider = providers[pi];
                    const providerIdx = providers.slice(0, pi).filter(p => p.id === provider.id).length;
                    const posValue = providerIdx === 0 ? provider.id : `${provider.id}:${providerIdx}`;
                    const posLabel = providerIdx === 0 ? provider.name : `${provider.name} ${providerIdx + 1}`;
                    positions.push({ value: posValue, label: posLabel, occupied: isOccupied(posValue, providerIdx, provider.id) });
                }

                sheetData.slotPositions = positions;
            }
        }

        return sheetData;
    }

    activateListeners(html) {
        super.activateListeners(html);
        const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
        if (!this.options.editable) return;

        root.querySelector(".slot-source-select")?.addEventListener("change", async (event) => {
            await this.item.setFlag("D35E", "slotSource", event.target.value);
        });
    }
}
