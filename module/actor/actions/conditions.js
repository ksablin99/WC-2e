import {LogHelper} from "../../helpers/LogHelper.js";

export class ActorConditions {
    /**
     *
     * @param actor
     */
    constructor(actor) {
        this.actor = actor;
    }
    
    async toggleConditionStatusIcons() {
        if (this.actor._runningFunctions["toggleConditionStatusIcons"]) return;
        this.actor._runningFunctions["toggleConditionStatusIcons"] = {};
        try {
            const tokens = this.actor.token ? [this.actor.token] : this.actor.getActiveTokens().filter((o) => o != null);
            const buffTextures = this.actor.buffs.calcBuffTextures();
            const buffOrigins = new Set(Object.keys(buffTextures));
            const getEffectOrigin = (effect) => effect?.origin ?? effect?.data?.origin;
            const isD35EIconEffect = (effect) => effect?.getFlag?.("D35E", "show") !== undefined;
            const hasStatus = (effect, statusId) => effect.statuses?.has(statusId) || effect.getFlag("core", "statusId") === statusId;

            for (let t of tokens) {
                LogHelper.log("toggleConditionStatusIcons")
                const actor = t.actor ?? this.actor;
                if (!actor.testUserPermission(game.user, "OWNER")) continue;
                const fx = [...actor.effects];
                const toCreate = [];
                const toDeleteSet = new Set();

                for (const effect of fx) {
                    if (!isD35EIconEffect(effect)) continue;
                    const origin = getEffectOrigin(effect);
                    if (!origin) continue;
                    if (!buffOrigins.has(origin)) toDeleteSet.add(effect.id);
                }

                for (let [id, obj] of Object.entries(buffTextures)) {
                    const existing = fx.find((f) => getEffectOrigin(f) === id);
                    if (obj.active && !existing) {
                        toCreate.push(obj.item.getRawEffectData());
                    } else if (!obj.active && existing) {
                        toDeleteSet.add(existing.id);
                    }
                }

                for (let k of Object.keys(CONFIG.D35E.conditions)) {
                    const hasCondition = actor.system.attributes.conditions[k] === true;
                    const matchingEffects = fx.filter((e) => hasStatus(e, k));
                    const hasEffectIcon = matchingEffects.length > 0;

                    if (hasCondition && !hasEffectIcon) {
                        toCreate.push({
                            statuses: [k],
                            "flags.D35E.show": !game.settings.get("warcraftrpg2e", "hideTokenConditions"),
                            name: CONFIG.D35E.conditions[k],
                            label: CONFIG.D35E.conditions[k],
                            img: CONFIG.D35E.conditionTextures[k],
                            icon: CONFIG.D35E.conditionTextures[k],
                        });
                    } else if (!hasCondition && hasEffectIcon) {
                        for (const effect of matchingEffects) toDeleteSet.add(effect.id);
                    }

                    if (matchingEffects.length > 1) {
                        for (const effect of matchingEffects.slice(1)) toDeleteSet.add(effect.id);
                    }
                }

                const toDelete = Array.from(toDeleteSet).filter((id) => actor.effects.has(id));
                if (toDelete.length) await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete, {stopUpdates: true});
                if (toCreate.length) await actor.createEmbeddedDocuments("ActiveEffect", toCreate, {stopUpdates: true});
            }
        } finally {
            delete this.actor._runningFunctions["toggleConditionStatusIcons"];
        }
    }


}
