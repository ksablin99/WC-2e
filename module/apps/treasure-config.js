/**
 * A simple form to configure NPC treasure percentages.
 */
export default class ActorTreasureConfig extends DocumentSheet {

    /** @override */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ["D35E"],
            id: "actor-treasure-config",
            template: "systems/warcraftrpg2e/templates/apps/treasure-config.html",
            width: 320,
            height: "auto"
        });
    }

    /** @override */
    get title() {
        return `${game.i18n.localize("D35E.TreasureConfig")}: ${this.object.name}`;
    }

    /** @override */
    getData(options) {
        const treasure = this.object.system.details?.treasure ?? {};
        return {
            coins: treasure.coins ?? 100,
            goods: treasure.goods ?? 100,
            items: treasure.items ?? 100
        };
    }

    /** @override */
    activateListeners(html) {
        super.activateListeners(html);
        const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
        root.querySelectorAll(".treasure-preset").forEach(btn => {
            btn.addEventListener("click", () => {
                root.querySelector("[name='system.details.treasure.coins']").value = btn.dataset.coins;
                root.querySelector("[name='system.details.treasure.goods']").value = btn.dataset.goods;
                root.querySelector("[name='system.details.treasure.items']").value = btn.dataset.items;
            });
        });
    }
}
