/** Compendium buff used to track summon spell duration. Expires by setting active=false, which fires the deactivate action that sets the banished condition. */
export const SUMMON_DURATION_BUFF_PACK = "warcraftrpg2e.commonbuffs";
export const SUMMON_DURATION_BUFF_ID = "z9x8y7w6v5u4t3s2";

/**
 * @param {Actor} actor
 * @param {number} durationRounds
 */
export async function applySummonDurationBuffFromTemplate(actor, durationRounds, { visual = false } = {}) {
  if (!actor || !durationRounds || durationRounds <= 0) return;
  const pack = game.packs.get(SUMMON_DURATION_BUFF_PACK);
  if (!pack) {
    game.D35E?.logger?.warn?.("warcraftrpg2e.commonbuffs pack missing; cannot apply summon duration buff.");
    return;
  }
  const tpl = await pack.getDocument(SUMMON_DURATION_BUFF_ID);
  if (!tpl) {
    game.D35E?.logger?.warn?.("Summon duration buff not found in compendium.");
    return;
  }
  const data = tpl.toObject();
  delete data._id;
  foundry.utils.setProperty(data, "system.timeline.total", durationRounds);
  foundry.utils.setProperty(data, "system.timeline.elapsed", 0);
  foundry.utils.setProperty(data, "system.active", false);
  if (visual) foundry.utils.setProperty(data, "system.deactivateActions", []);
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  if (created) {
    // Activate through the normal update path so _onUpdate fires: runs activate
    // actions, resets timeline.elapsed, and registers the buff with the combat
    // initiative tracker via addBuffsToCombat.
    await created.update({ "system.active": true });
  }
}
