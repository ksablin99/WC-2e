import { AuraMeasureDistance } from "./aura-measure-distance.js";

const AuraDebug = false;

export const AURAS = {};

function getAuraShape(source, radius) {
  const gs = canvas.dimensions.size;
  const gd = gs / canvas.dimensions.distance;
  return new PIXI.Circle(source.center.x, source.center.y, radius * gd + (source.width / 2) * gs);
}

function getActor(source) {
  if (source.document.actorLink) {
    return game.actors.get(source.document.actorId) || { auras: [] };
  } else {
    return source.actor || { auras: [] };
  }
}

function getActorKey(source) {
  if (source.document.actorLink) {
    return `actor-${source.document.actorId}`;
  }
  return `token-${source.id}`;
}

function isCorrectAlliance(source, target, auraTarget) {
  switch (auraTarget) {
    case "enemy":
      return source.document.disposition !== target.document.disposition;
    case "ally":
      return source.document.disposition === target.document.disposition;
    default:
      return true;
  }
}

export async function CollateAuras(sceneID, checkAuras, removeAuras, source) {
  if (!game.user.isGM) return;
  if (sceneID !== canvas?.id)
    return ui.notifications.warn(
      "Collate Auras called on a non viewed scene, auras will be updated when you return to that scene"
    );

  if (AURAS.runningUpdate) {
    if (sceneID === AURAS.currentSceneId) {
      AURAS.queued = true;
    }
    return;
  }
  AURAS.runningUpdate = true;
  AURAS.currentSceneId = sceneID;

  let perfStart;
  let perfEnd;
  if (AuraDebug) perfStart = performance.now();

  const actorsAurasToAdd = new Map();
  const actorsAurasToRemove = new Map();
  const actorsAurasAlreadyPresent = new Map();
  const actorsAurasAlreadyPresentIds = new Map();
  const actorModifiedAuras = new Map();
  const actorTokenMap = new Map();
  const actorTokensMap = new Map();

  try {
    for (const token of canvas.tokens.placeables) {
      if (!token.actor) continue;

      const actorKey = getActorKey(token);
      if (!actorsAurasAlreadyPresent.has(actorKey)) {
        actorsAurasAlreadyPresent.set(actorKey, new Set());
        actorsAurasAlreadyPresentIds.set(actorKey, new Set());
        actorModifiedAuras.set(actorKey, new Set());
        actorTokenMap.set(actorKey, token);
      }
      if (!actorTokensMap.has(actorKey)) actorTokensMap.set(actorKey, []);
      actorTokensMap.get(actorKey).push(token);

      for (const aura of getActor(token).auras) {
        actorsAurasAlreadyPresent.get(actorKey).add(aura.system.sourceAuraId ?? aura.id);
        actorsAurasAlreadyPresentIds.get(actorKey).add(aura.id);
      }
    }

    for (const sourceToken of canvas.tokens.placeables) {
      if (!sourceToken.actor) continue;
      const sourceActorKey = getActorKey(sourceToken);
      const sourceActor = getActor(sourceToken);

      for (const aura of sourceActor.auras) {
        if (aura.system.sourceTokenId) continue;

        for (const targetToken of canvas.tokens.placeables) {
          if (!targetToken.actor) continue;
          if (targetToken.id === sourceToken.id) continue;
          if (targetToken.actor.id === sourceToken.actor.id) continue;

          const targetActorKey = getActorKey(targetToken);
          const inAura = await AuraMeasureDistance.inAura(
            targetToken,
            sourceToken,
            true,
            0,
            aura.system.range || 5,
            getAuraShape(sourceToken, aura.system.range || 5)
          );

          if (!inAura || !isCorrectAlliance(sourceToken, targetToken, aura.system.auraTarget)) continue;

          if (
            !actorsAurasAlreadyPresent.get(targetActorKey)?.has(aura.id) &&
            !actorModifiedAuras.get(targetActorKey)?.has(aura.id)
          ) {
            if (!actorsAurasToAdd.has(targetActorKey)) actorsAurasToAdd.set(targetActorKey, []);

            const auraToAdd = aura.toObject(false);
            auraToAdd.system.sourceTokenId = sourceToken.id;
            auraToAdd.system.sourceActorId = sourceToken.actor.id;
            auraToAdd.system.sourceAuraId = aura.id;
            auraToAdd.system.sourceActorName = sourceToken.actor.name;
            delete auraToAdd.id;

            actorsAurasToAdd.get(targetActorKey).push(auraToAdd);
          }

          actorModifiedAuras.get(targetActorKey)?.add(aura.id);
          actorModifiedAuras.get(sourceActorKey)?.add(aura.id);
        }
      }
    }

    for (const [actorKey, actorTokens] of actorTokensMap.entries()) {
      const actorToken = actorTokenMap.get(actorKey);
      const actor = getActor(actorToken);

      for (const aura of actor.auras) {
        if (!aura.system.sourceTokenId) continue;

        let sourceOfAuraToken = canvas.tokens.get(aura.system.sourceTokenId);
        if (!sourceOfAuraToken && aura.system.sourceActorId) {
          sourceOfAuraToken = canvas.tokens.placeables.find((t) => t.actor?.id === aura.system.sourceActorId);
        }

        if (!sourceOfAuraToken) {
          if (!actorsAurasToRemove.has(actorKey)) actorsAurasToRemove.set(actorKey, new Set());
          actorsAurasToRemove.get(actorKey).add(aura.id);
          actorModifiedAuras.get(actorKey)?.add(aura.id);
          continue;
        }

        const sourceActorKey = getActorKey(sourceOfAuraToken);
        const sourceStillHasAura = actorsAurasAlreadyPresentIds.get(sourceActorKey)?.has(aura.system.sourceAuraId);
        let anyTokenInAura = false;

        for (const actorTokenCandidate of actorTokens) {
          if (actorTokenCandidate.id === sourceOfAuraToken.id) continue;
          if (actorTokenCandidate.actor?.id === sourceOfAuraToken.actor?.id) continue;

          const inAura = await AuraMeasureDistance.inAura(
            actorTokenCandidate,
            sourceOfAuraToken,
            true,
            0,
            aura.system.range || 5,
            getAuraShape(sourceOfAuraToken, aura.system.range || 5)
          );

          if (inAura && isCorrectAlliance(sourceOfAuraToken, actorTokenCandidate, aura.system.auraTarget)) {
            anyTokenInAura = true;
            break;
          }
        }

        if (!anyTokenInAura || !sourceStillHasAura) {
          if (!actorsAurasToRemove.has(actorKey)) actorsAurasToRemove.set(actorKey, new Set());
          actorsAurasToRemove.get(actorKey).add(aura.id);
          actorModifiedAuras.get(actorKey)?.add(aura.id);
        }
      }
    }

    const updatePromises = [];
    for (const [actorKey, token] of actorTokenMap.entries()) {
      const actor = getActor(token);
      const aurasToAdd = actorsAurasToAdd.get(actorKey);
      const aurasToRemove = actorsAurasToRemove.get(actorKey);

      updatePromises.push((async () => {
        if (aurasToAdd?.length) {
          await actor.createEmbeddedDocuments("Item", aurasToAdd, { stopAuraUpdate: true });
        }
        if (aurasToRemove?.size) {
          const validIdsToRemove = Array.from(aurasToRemove).filter((id) => actor.items.has(id));
          if (validIdsToRemove.length) {
            await actor.deleteEmbeddedDocuments("Item", validIdsToRemove, { stopAuraUpdate: true });
          }
        }
      })());
    }

    await Promise.all(updatePromises);

    if (AuraDebug) {
      perfEnd = performance.now();
      game.D35E.logger.log(`Active Auras Main Function took ${perfEnd - perfStart} ms, FPS:${Math.round(canvas.app.ticker.FPS)}`);
    }
  } finally {
    AURAS.runningUpdate = false;
    AURAS.currentSceneId = null;
    if (AURAS.queued) {
      ui.notifications.warn("Running queued Aura update, last aura update pass took too long.");
      AURAS.queued = false;
      void CollateAuras(sceneID, checkAuras, removeAuras, source);
    }
  }
}
