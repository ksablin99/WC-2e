export class D35ECombatTracker extends foundry.applications.sidebar.tabs.CombatTracker {

    static PARTS = {
        header:  { template: "templates/sidebar/tabs/combat/header.hbs" },
        tracker: { template: "systems/warcraftrpg2e/templates/sidebar/parts/combat-tracker.html", scrollable: [""] },
        footer:  { template: "templates/sidebar/tabs/combat/footer.hbs" }
    };

    static DEFAULT_OPTIONS = {
        actions: {
            toggleCombatAction: D35ECombatTracker._onToggleCombatAction,
        }
    };

    /**
     * GM-only handler: toggle an individual combatant action flag.
     * @param {PointerEvent} event
     * @param {HTMLElement} target
     */
    static async _onToggleCombatAction(event, target) {
        if (!game.user.isGM) return;
        const li = target.closest("[data-combatant-id]");
        if (!li) return;
        const combatant = this.viewed?.combatants.get(li.dataset.combatantId);
        if (!combatant) return;

        const actionKey = target.dataset.actionKey;
        switch (actionKey) {
            case "usedMoveAction":
            case "usedAttackAction":
            case "usedSwiftAction": {
                const current = combatant.getFlag("D35E", actionKey) ?? false;
                await combatant.setFlag("D35E", actionKey, !current);
                break;
            }
            case "usedAllAao": {
                const used = combatant.getFlag("D35E", "usedAaoCount") ?? 0;
                const max  = combatant.getFlag("D35E", "aaoCount") ?? 1;
                if (used >= max) {
                    await combatant.setFlag("D35E", "usedAaoCount", 0);
                } else {
                    await combatant.setFlag("D35E", "usedAaoCount", max);
                }
                break;
            }
        }
    }

    /** @override */
    async _prepareTurnContext(combat, combatant, index) {
        const turn = await super._prepareTurnContext(combat, combatant, index);
        const isActor = !!combatant.actor;
        turn.isActor = isActor;
        const advancedTracking = game.settings.get("warcraftrpg2e", "advanced-combat-tracking");
        turn.advancedCombatTracking = advancedTracking;
        if (isActor && advancedTracking) {
            turn.usedMoveAction = combatant.usedMoveAction;
            turn.usedAttackAction = combatant.usedAttackAction;
            turn.usedSwiftAction = combatant.usedSwiftAction;
            turn.usedAllAao = combatant.usedAllAao;
            const aaoMax  = combatant.getFlag("D35E", "aaoCount") ?? 1;
            const aaoUsed = combatant.getFlag("D35E", "usedAaoCount") ?? 0;
            turn.aaoLeft = Math.max(0, aaoMax - aaoUsed);
            turn.aaoMax  = aaoMax;
        } else if (!isActor) {
            turn.actorImage = combatant.flags?.D35E?.actorImg ?? "";
            turn.actorName = combatant.flags?.D35E?.actorName ?? "";
            turn.linkedActorId = combatant.flags?.D35E?.actor ?? null;
        }
        return turn;
    }

    /** @override */
    async _prepareTrackerContext(context, options) {
        await super._prepareTrackerContext(context, options);
        context.turns ??= [];
        // Ensure initiativeIcon is available even on isolated partial re-renders
        context.initiativeIcon ??= CONFIG.Combat.initiativeIcon;

        const combat = this.viewed;
        if (!combat) {
            context.nextTurnBuffs = [];
            return;
        }

        let previousActorTurnId = "final";
        let activeActorTurnId = "";
        let finalActorTurnId = "";
        const actorTurns = [];
        const buffTurns = [];

        for (const turn of context.turns) {
            if (turn.isActor) {
                if (turn.active) activeActorTurnId = turn.id;
                previousActorTurnId = turn.id;
                finalActorTurnId = turn.id;
                actorTurns.push(turn);
            } else if (turn.linkedActorId) {
                turn.previousActorTurn = previousActorTurnId;
                const linkedActor = game.actors.get(turn.linkedActorId);
                if (linkedActor?.testUserPermission(game.user, "OWNER")) {
                    buffTurns.push(turn);
                }
            }
        }

        context.turns = actorTurns;
        context.nextTurnBuffs = buffTurns.filter(b =>
            b.previousActorTurn === activeActorTurnId ||
            (finalActorTurnId === activeActorTurnId && b.previousActorTurn === "final")
        );
    }
}
