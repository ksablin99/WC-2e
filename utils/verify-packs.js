"use strict";

const fs = require("fs");
const path = require("path");
const { normalizePackName, readSystemPacks, verifySourceAndPackSync } = require("./pack-db");
const { createLogger } = require("./cli-log");

const log = createLogger("verify-packs");

/**
 * Verify every declared compendium against its source JSON.
 *
 * @param {object} [options]
 * @param {string} [options.repoRoot] repository root containing source/ and packs/
 * @param {Array<object>} [options.declarations] system pack declarations
 * @returns {Promise<{ok: boolean, packs: Array<object>, failures: string[]}>}
 */
async function verifyDeclaredPacks({ repoRoot = process.cwd(), declarations = readSystemPacks() } = {}) {
  const packs = [];
  const failures = [];
  const seen = new Set();

  for (const declaration of declarations) {
    const packName = normalizePackName(declaration.path);
    if (!packName) {
      failures.push(`Invalid empty pack path: ${JSON.stringify(declaration.path)}`);
      continue;
    }
    if (seen.has(packName)) {
      failures.push(`Duplicate pack path: ${packName}`);
      continue;
    }
    seen.add(packName);

    const sourcePath = path.join(repoRoot, "source", packName);
    const packPath = path.join(repoRoot, "packs", packName);
    if (!fs.existsSync(sourcePath)) {
      failures.push(`${packName}: missing source directory ${sourcePath}`);
      continue;
    }
    if (!fs.existsSync(packPath)) {
      failures.push(`${packName}: missing compiled pack ${packPath}; run npm run sources:repack`);
      continue;
    }

    try {
      const verification = await verifySourceAndPackSync(sourcePath, packPath);
      const result = {
        name: packName,
        ok: verification.ok,
        sourceCount: verification.sourceCount,
        packCount: verification.packCount,
        mismatches: verification.mismatches,
      };
      packs.push(result);
      if (!verification.ok) {
        const details = verification.mismatches.slice(0, 20).join("\n  ");
        const omitted = Math.max(0, verification.mismatches.length - 20);
        failures.push(
          `${packName}: source/pack drift (${verification.sourceCount} source keys, ` +
            `${verification.packCount} compiled keys)\n  ${details}` +
            (omitted ? `\n  ... ${omitted} more mismatch(es)` : "")
        );
      }
    } catch (error) {
      failures.push(`${packName}: verification failed: ${error.message || String(error)}`);
    }
  }

  return { ok: failures.length === 0, packs, failures };
}

async function run() {
  const result = await verifyDeclaredPacks();
  if (!result.ok) {
    log.error(`Source/pack verification failed (${result.failures.length}):\n- ${result.failures.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }

  const sourceCount = result.packs.reduce((total, pack) => total + pack.sourceCount, 0);
  log.success(`Verified ${result.packs.length} packs (${sourceCount} LevelDB keys) against source JSON.`);
}

if (require.main === module) {
  run().catch((error) => {
    log.error(error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = { verifyDeclaredPacks };
