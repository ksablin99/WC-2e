import { getSystemFlag } from "../utils/system-flags.js";

export class ActiveEffectD35E extends ActiveEffect {
    static #buildSyncOptions(options) {
      const d35e = { ...(options?.D35E ?? {}), skipActiveEffectSync: true };
      return { ...options, D35E: d35e };
    }

    static async #resolveOriginItem(originUuid) {
      if (!originUuid || typeof originUuid !== "string") return null;
      try {
        const doc = await fromUuid(originUuid);
        if (doc?.documentName === "Item") return doc;
      } catch (e) {}
      return null;
    }

    async _onCreate(data, options, userId, context) {
      super._onCreate(data, options, userId, context);
      if (game.user.id !== userId) return;
      if (options.stopUpdates) return;
      if (options?.D35E?.skipActiveEffectSync) return;

      const parentActor = this.parent;
      if (!parentActor) return;

      const statusId = this.statuses?.size > 0 ? [...this.statuses][0] : this.getFlag("core", "statusId") ?? foundry.utils.getProperty(data, "flags.core.statusId");
      const originUuid = this.origin ?? foundry.utils.getProperty(data, "origin");

      if (statusId && parentActor.system?.attributes?.conditions?.[statusId] === false) {
        await parentActor.update(
          { [`system.attributes.conditions.${statusId}`]: true },
          ActiveEffectD35E.#buildSyncOptions(options)
        );
      }

      if (originUuid) {
        const buffItem = await ActiveEffectD35E.#resolveOriginItem(originUuid);
        if (buffItem?.parent?.id === parentActor.id && !buffItem.system.active) {
          await buffItem.update({ "system.active": true }, ActiveEffectD35E.#buildSyncOptions(options));
        }
      }
    }

    async _onDelete(options, userId, context) {
      const parentActor = this.parent;
      const statusId = this.statuses?.size > 0 ? [...this.statuses][0] : this.getFlag("core", "statusId");
      const originUuid = this.origin;

      super._onDelete(options, userId, context);
      if (game.user.id !== userId) return;
      if (options.stopUpdates) return;
      if (options?.D35E?.skipActiveEffectSync) return;
      if (!parentActor) return;

      if (statusId && parentActor.system?.attributes?.conditions?.[statusId]) {
        const stillHasStatus = parentActor.effects?.some((effect) => effect !== this && (effect.statuses?.has(statusId) || effect.getFlag("core", "statusId") === statusId));
        if (!stillHasStatus) {
          await parentActor.update(
            { [`system.attributes.conditions.${statusId}`]: false },
            ActiveEffectD35E.#buildSyncOptions(options)
          );
        }
      }

      if (originUuid) {
        const originItem = await ActiveEffectD35E.#resolveOriginItem(originUuid);
        const stillHasOrigin = parentActor.effects?.some((effect) => effect !== this && effect.origin === originUuid);
        if (originItem?.parent?.id === parentActor.id && !stillHasOrigin && originItem.system.active) {
          await originItem.update({ "system.active": false }, ActiveEffectD35E.#buildSyncOptions(options));
        }
      }
    }

    get isTemporary() {
      const duration = this?.duration?.seconds ?? (this?.duration?.rounds || this?.duration?.turns) ?? 0;
      return duration > 0 || this.statuses?.size > 0 || this.getFlag("core", "statusId") || getSystemFlag(this, "show");
    }
  }
