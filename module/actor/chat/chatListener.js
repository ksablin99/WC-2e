import {ActorChatActions} from "./chatActions.js"

export class ActorChatListener {
    static chatListeners(html) {
        const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
        if (!root?.addEventListener) return;
        root.addEventListener("click", (e) => {
            const eventTarget = e.target instanceof Element ? e.target : e.target?.parentElement;
            const target = eventTarget?.closest?.("button[data-action]");
            if (target) ActorChatActions._onChatCardButtonAction.call(this, e);
        });
        root.addEventListener("mouseenter", (e) => {
            const eventTarget = e.target instanceof Element ? e.target : e.target?.parentElement;
            const target = eventTarget?.closest?.("img[data-target]");
            if (target) ActorChatActions._onTargetHover.call(this, e);
        }, true);
        root.addEventListener("mouseleave", (e) => {
            const eventTarget = e.target instanceof Element ? e.target : e.target?.parentElement;
            const target = eventTarget?.closest?.("img[data-target]");
            if (target) ActorChatActions._onTargetLeave.call(this, e);
        }, true);
        root.addEventListener("click", (e) => {
            const eventTarget = e.target instanceof Element ? e.target : e.target?.parentElement;
            const target = eventTarget?.closest?.("img[data-target]");
            if (target) ActorChatActions._onTargetClick.call(this, e);
        });
    }
}
