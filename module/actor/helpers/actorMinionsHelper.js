import {LogHelper} from "../../helpers/LogHelper.js";

export class ActorMinionsHelper {
    static #measureTokenDistanceFeet(originToken, targetToken) {
        if (!originToken || !targetToken || !canvas?.grid) return null;
        /**
         * @FoundryVersionSpecificCode(<14)
         * Keep the v13 grid distance API unchanged.
         */
        if (game.release.generation < 14) {
            if (typeof canvas.grid.measureDistance === "function") {
                return canvas.grid.measureDistance(originToken, targetToken);
            }
            return null;
        }
        /**
         * @FoundryVersionSpecificCode(>=14)
         * V14 moved grid distance measurement to `measurePath`.
         */
        if (typeof canvas.grid.measurePath === "function") {
            return canvas.grid.measurePath([originToken.center, targetToken.center]).distance;
        }
        return null;
    }

    /**
     * Calculated distance between master and minion, and updates the 
     * master and minion actor data with the distance value.
     * @param {*} master 
     * @returns 
     */
    static async calculateMinionDistance(master) {
        if (master == null) return;
        if (!master.testUserPermission(game.user, "OWNER")) return;
        if (master.type === "npc") {
            let myToken = master.getActiveTokens()[0];
            let masterId = master.system?.master?.id;
            let characterMaster = game.actors.get(masterId);
            if (!characterMaster || !characterMaster.getActiveTokens().length) return;
            let masterToken = characterMaster.getActiveTokens()[0];
            if (!!myToken && !!masterToken) {
                const measuredDistance = this.#measureTokenDistanceFeet(myToken, masterToken);
                if (measuredDistance == null) return;
                let distance = Math.floor(measuredDistance / 5.0) * 5;
                const key = master.name.toLowerCase().replace(/ /g, '').replace(/,/g, '');
                master.update({ 'system.master.distance': distance }, {stopUpdates: true, skipToken: true});
                characterMaster.update({ [`system.attributes.minionDistance.${key}`]: distance }, {stopUpdates: true, skipToken: true, skipMinions: true});
            }
        } else if (master.type === "character") {
            let myToken = master.getActiveTokens()[0];
            let minionDistances = {};
            let hasAnyMinion = false;
            game.actors.forEach(minion => {
                if (minion.system?.master?.id === master.id) {
                    hasAnyMinion = true;
                    let minionToken = minion.getActiveTokens()[0];
                    if (!!myToken && !!minionToken) {
                        const measuredDistance = this.#measureTokenDistanceFeet(myToken, minionToken);
                        if (measuredDistance == null) return;
                        let distance = Math.floor(measuredDistance / 5.0) * 5;
                        const key = minion.name.toLowerCase().replace(/ /g, '').replace(/,/g, '');
                        minionDistances[key] = distance;
                        minion.update({ 'system.master.distance': distance }, {stopUpdates: true, skipToken: true});
                    }
                }
            });
            if (hasAnyMinion)
                master.update({ system: { attributes: { minionDistance: minionDistances } } }, {stopUpdates: true, skipToken: true, skipMinions: true});
        }
    }

    static async updateMinions(master, options) {
        if (options.skipMinions) return;
        for (const minion of game.actors) {
            if (minion.system?.master?.id === master.id) {
                let masterData = {
                    system: {
                        master: {
                            img: master.img,
                            name: master.name,
                            data: master.getRollData(),
                        }
                    }
                };

                // Updating minion "Familiar class"
                const classes = minion.items.filter(obj => {
                    return obj.type === "class";
                });

                const minionClass = classes.find(o => foundry.utils.getProperty(o.system, "classType") === "minion");
                if (!!minionClass) {
                    let updateObject = {}
                    updateObject["_id"] = minionClass.id;
                    updateObject["system.levels"] = master.getRollData().attributes.minionClassLevels[minionClass.system.minionGroup] || 0;
                    LogHelper.log('Minion class', minionClass, updateObject, master.getRollData(), )
                    await minion.updateEmbeddedDocuments('Item', [updateObject], {stopUpdates: true, massUpdate: true})
                }
                minion.update(masterData, {stopUpdates: true});
            }
        }
    }
}
