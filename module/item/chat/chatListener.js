import {ItemChatAction} from "./chatAction.js";

export class ItemChatListener {
    static chatListeners(html) {
        const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
        if (!root?.addEventListener) return;
        root.addEventListener("click", (e) => {
            const eventTarget = e.target instanceof Element ? e.target : e.target?.parentElement;
            const target = eventTarget?.closest?.(".card-buttons button");
            if (target) ItemChatAction._onChatCardAction.call(this, e);
        });
        root.addEventListener("click", (e) => {
            const eventTarget = e.target instanceof Element ? e.target : e.target?.parentElement;
            const target = eventTarget?.closest?.(".item-name");
            if (target) ItemChatAction._onChatCardToggleContent.call(this, e);
        });
    }
}
 