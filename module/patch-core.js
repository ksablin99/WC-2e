import "./apps/vision-permission.js";
import { ActorMinionsHelper } from "./actor/helpers/actorMinionsHelper.js";


export async function PatchCore() {


  // Roll formula preprocessing (pow, floor, max, min, etc.) is handled via
  // Roll35e._preProcess set in dice.js, called from Roll35e.parse() in roll.js.
  // The old _identifyTerms / _replaceData patches are no-ops in Foundry v13+.

  // v13: Token.prototype.animateMovement no longer exists. Use the moveToken hook
  // which fires on all clients when a movement DB update is processed. We wait
  // for state === "completed" (no pending waypoints) then for the visual
  // animation to finish before measuring distance.
  Hooks.on("moveToken", async (document, movement) => {
    /**
     * @FoundryVersionSpecificCode(<14)
     * Keep the v13 movement completion check unchanged.
     */
    if (game.release.generation < 14) {
      if (document.movement?.state !== "completed") return;
      const actor = document.actor;
      if (!actor) return;
      if (document.rendered) await document.object?.movementAnimationPromise;
      ActorMinionsHelper.calculateMinionDistance(actor);
      return;
    }
    /**
     * @FoundryVersionSpecificCode(>=14)
     * V14 move workflows expose planned/constrained path state on the hook payload.
     * Skip partial path updates here and only recalculate once movement is actually committed.
     */
    if (movement?.constrained) return;
    if (movement?.pending?.waypoints?.length) return;
    const actor = document.actor;
    if (!actor) return;
    if (document.rendered) await document.object?.movementAnimationPromise;
    ActorMinionsHelper.calculateMinionDistance(actor);
  });

  Object.defineProperty(ActiveEffect.prototype, "isTemporary", {
    get: function () {
      const duration = this.duration.seconds ?? (this.duration.rounds || this.duration.turns) ?? 0;
      return duration > 0 || this.getFlag("core", "statusId") || this.getFlag("D35E", "show");
    },
  });


  const StringTerm_eval = foundry.dice.terms.StringTerm.prototype.evaluate;
  foundry.dice.terms.StringTerm.prototype.evaluate = async function (...args) {
    return this;
  };

  //patchCoreForLowLightVision()

  import("./lib/intro.js");
}

