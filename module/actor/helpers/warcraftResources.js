/**
 * Return the number of distinct shout feats on an actor.
 *
 * Shout uses are a shared Warcraft resource: the daily maximum equals the
 * number of shout feats possessed.  Identity de-duplication prevents a copied
 * compendium item from granting an accidental extra use of the same feat.
 */
export function countDistinctShoutFeats(items = []) {
  const identities = new Set();
  for (const item of items || []) {
    if (item?.type !== "feat") continue;
    const category = item?.flags?.warcraftrpg2e?.feat?.category;
    if (String(category || "").toLowerCase() !== "shout") continue;
    const identity = item?.system?.uniqueId || item?.name || item?._id || item?.id;
    if (identity) identities.add(String(identity).toLowerCase());
  }
  return identities.size;
}

export function countMightyLungsBonusUses(items = []) {
  return Array.from(items ?? []).filter((item) => item?.type === "feat" && item?.name === "Mighty Lungs").length * 2;
}

export function deriveShoutUses(items = [], currentValue = 0) {
  const max = countDistinctShoutFeats(items) + countMightyLungsBonusUses(items);
  const numericValue = Number.isFinite(Number(currentValue)) ? Number(currentValue) : 0;
  return { value: Math.max(0, Math.min(numericValue, max)), max };
}
