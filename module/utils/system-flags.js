export const SYSTEM_FLAG_SCOPE = "warcraftrpg2e";
export const LEGACY_SYSTEM_FLAG_SCOPE = "D35E";

function getRawFlag(document, scope, key) {
  const preparedValue = foundry.utils.getProperty(document?.flags?.[scope], key);
  if (preparedValue !== undefined) return preparedValue;
  return foundry.utils.getProperty(document?._source?.flags?.[scope], key);
}

/**
 * Read a system-owned Document flag using Foundry's active system scope.
 * Existing worlds may still contain mixed-case D35E flag data; read that data
 * directly because Foundry v14 rejects D35E as a Document#getFlag scope.
 */
export function getSystemFlag(document, key) {
  if (!document) return undefined;
  const currentValue = document.getFlag?.(SYSTEM_FLAG_SCOPE, key)
    ?? getRawFlag(document, SYSTEM_FLAG_SCOPE, key);
  if (currentValue !== undefined) return currentValue;
  return getRawFlag(document, LEGACY_SYSTEM_FLAG_SCOPE, key);
}

/** Write a system-owned flag without using the retired D35E scope. */
export function setSystemFlag(document, key, value) {
  return document?.setFlag?.(SYSTEM_FLAG_SCOPE, key, value);
}

function deletionPath(scope, key) {
  const parts = String(key).split(".");
  const leaf = parts.pop();
  return ["flags", scope, ...parts, `-=${leaf}`].join(".");
}

/**
 * Remove the modern flag, then remove any legacy fallback value with a raw
 * Document update. Foundry permits arbitrary data under flags, but its flag
 * convenience APIs reject inactive scopes before reading or writing them.
 */
export async function unsetSystemFlag(document, key) {
  if (!document) return undefined;
  let result = await document.unsetFlag?.(SYSTEM_FLAG_SCOPE, key);
  if (getRawFlag(document, LEGACY_SYSTEM_FLAG_SCOPE, key) !== undefined) {
    result = await document.update({ [deletionPath(LEGACY_SYSTEM_FLAG_SCOPE, key)]: null });
  }
  return result;
}

export function systemFlagPath(key) {
  return `flags.${SYSTEM_FLAG_SCOPE}.${key}`;
}
