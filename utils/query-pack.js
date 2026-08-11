"use strict";

const path = require("path");
const fs = require("fs");
const { ClassicLevel } = require("classic-level");
const { createLogger } = require("./cli-log");

const log = createLogger("query-pack");

function printHelp() {
  console.log(`Usage:
  node utils/query-pack.js --pack <pack-path-or-name> [options]

Options:
  --pack <value>         Pack path, pack name, or ./packs/* path from system.json (required)
  --name <value>         Case-insensitive partial match on document name
  --type <value>         Exact match on document type (case-insensitive)
  --field <k=v>          Field filter using dot-path, repeatable (example: --field system.school=abj)
  --full                 Print full document JSON for each match
  --help                 Show this help message

Examples:
  node utils/query-pack.js --pack feats --name dodge
  node utils/query-pack.js --pack ./packs/spells --type spell --field system.level=1 --full
`);
}

function parseArgs(argv) {
  const args = {
    fields: [],
    full: false
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--help" || token === "-h") {
      args.help = true;
    } else if (token === "--full") {
      args.full = true;
    } else if (token === "--pack") {
      args.pack = argv[++i];
    } else if (token === "--name") {
      args.name = argv[++i];
    } else if (token === "--type") {
      args.type = argv[++i];
    } else if (token === "--field") {
      args.fields.push(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  return args;
}

function resolvePackPath(packArg) {
  const cwd = process.cwd();

  if (packArg.includes("/") || packArg.includes("\\")) {
    const explicitPath = path.resolve(cwd, packArg);
    if (fs.existsSync(explicitPath)) return explicitPath;
  }

  const directPackDir = path.resolve(cwd, "packs", packArg);
  if (fs.existsSync(directPackDir)) return directPackDir;

  const systemPath = path.resolve(cwd, "system.json");
  if (fs.existsSync(systemPath)) {
    const system = JSON.parse(fs.readFileSync(systemPath, "utf8"));
    const byName = (system.packs || []).find((p) => p.name === packArg);
    if (byName?.path) {
      const normalized = byName.path.replace(/^\.\//, "");
      const candidate = path.resolve(cwd, normalized);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  throw new Error(`Could not resolve pack "${packArg}"`);
}

function getByPath(obj, pathExpr) {
  const parts = pathExpr.split(".");
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function parseFieldFilter(expr) {
  const eqIdx = expr.indexOf("=");
  if (eqIdx < 1) {
    throw new Error(`Invalid --field "${expr}". Expected key=value`);
  }
  return {
    path: expr.slice(0, eqIdx).trim(),
    expected: expr.slice(eqIdx + 1).trim()
  };
}

function matchesFieldValue(actual, expectedRaw) {
  if (actual === undefined) return false;
  const normalized = String(expectedRaw).trim();

  if (normalized === "true") return actual === true || String(actual).toLowerCase() === "true";
  if (normalized === "false") return actual === false || String(actual).toLowerCase() === "false";
  if (normalized !== "" && !Number.isNaN(Number(normalized))) return Number(actual) === Number(normalized);

  return String(actual).toLowerCase() === normalized.toLowerCase();
}

function parseDocument(rawValue) {
  if (rawValue == null) return null;
  if (typeof rawValue === "object") return rawValue;
  if (typeof rawValue === "string") {
    try {
      return JSON.parse(rawValue);
    } catch (_err) {
      return null;
    }
  }
  return null;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.pack) {
    throw new Error("Missing required --pack argument");
  }

  const fieldFilters = args.fields.map(parseFieldFilter);
  const requestedType = args.type ? String(args.type).toLowerCase() : null;
  const requestedName = args.name ? String(args.name).toLowerCase() : null;
  const packPath = resolvePackPath(args.pack);

  const db = new ClassicLevel(packPath, { valueEncoding: "utf8" });
  const matches = [];

  try {
    for await (const [key, value] of db.iterator()) {
      const doc = parseDocument(value);
      if (!doc || typeof doc !== "object") continue;

      if (requestedName) {
        const docName = String(doc.name || "").toLowerCase();
        if (!docName.includes(requestedName)) continue;
      }

      if (requestedType) {
        const docType = String(doc.type || "").toLowerCase();
        if (docType !== requestedType) continue;
      }

      let fieldsOk = true;
      for (const filter of fieldFilters) {
        const actual = getByPath(doc, filter.path);
        if (!matchesFieldValue(actual, filter.expected)) {
          fieldsOk = false;
          break;
        }
      }
      if (!fieldsOk) continue;

      const id = doc.id || doc._id || key;
      matches.push({ id, doc });
    }
  } finally {
    await db.close();
  }

  if (args.full) {
    for (const entry of matches) {
      console.log(JSON.stringify(entry.doc, null, 2));
    }
  } else {
    for (const entry of matches) {
      console.log(entry.id);
    }
  }

  // Logs into to error out to allow reading from stdout for the found items
  log.error(`Matched ${matches.length} document(s) in ${packPath}`);
}

run().catch((err) => {
  log.error(err.message || String(err));
  process.exitCode = 1;
});
