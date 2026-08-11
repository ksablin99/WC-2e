"use strict";

/**
 * pack-system.js — cross-platform release zip builder.
 *
 * Copies runtime files into a staging directory, disables hooks debug,
 * and produces the Foundry VTT system zip.
 *
 * Usage:
 *   node utils/pack-system.js [--name MySystem.zip]
 */

const { execSync } = require("child_process");
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("fs");
const { dirname, join, resolve, basename } = require("path");
const { tmpdir } = require("os");
const { randomBytes } = require("crypto");
const { createLogger } = require("./cli-log");

// ── Config ─────────────────────────────────────────────────────────────────────

const log = createLogger("pack-system");
const REPO_ROOT = resolve(__dirname, "..");
const SYSTEM_ID = "warcraftrpg2e";

const RUNTIME_PATHS = [
  "system.json",
  "template.json",
  "D35E.js",
  "D35E.css",
  "semver.js",
  "assets",
  "module",
  "templates",
  "lang",
  "packs",
  "fonts",
  "ui",
  "icons",
];

const OPTIONAL_PATHS = ["LICENSE.txt", "OGL.txt"];

const JUNK_NAMES = new Set([".git", ".gitignore", ".gitattributes", ".DS_Store"]);

// ── Args ───────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { name: `${SYSTEM_ID}.zip` };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--name") {
      args.name = argv[++i] || `${SYSTEM_ID}.zip`;
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      args.help = true;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(`Usage: node utils/pack-system.js [--name output.zip]

Options:
  --name <file>   Output zip filename (default: ${SYSTEM_ID}.zip)
  --help, -h      Show this help`);
  process.exit(0);
}

let outputName = args.name;
if (!outputName.endsWith(".zip")) outputName += ".zip";
if (outputName.includes("/") || outputName.includes("\\") || outputName.includes("..")) {
  log.error("use a zip filename in the repo root, not a path");
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function copyRecursive(src, dest) {
  const st = statSync(src);
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src)) {
      copyRecursive(join(src, entry), join(dest, entry));
    }
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

function rmRecursive(dir) {
  if (!existsSync(dir)) return;
  rmSync(dir, { recursive: true, force: true });
}

function stripJunk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (JUNK_NAMES.has(entry)) {
      rmRecursive(join(dir, entry));
    } else {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) stripJunk(p);
    }
  }
}

// ── Zip ────────────────────────────────────────────────────────────────────────

function zipDir(sourceDir, outputPath) {
  if (process.platform === "win32") {
    execSync(
      `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '${sourceDir}' -DestinationPath '${outputPath}' -Force"`,
      { stdio: "inherit" }
    );
  } else {
    const parent = dirname(sourceDir);
    const name = basename(sourceDir);
    execSync(`zip -qr "${outputPath}" "${name}"`, { cwd: parent, stdio: "inherit" });
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  if (!existsSync(join(REPO_ROOT, "system.json"))) {
    log.error("run this script from the main repo directory");
    process.exit(1);
  }
  if (!existsSync(join(REPO_ROOT, "module"))) {
    log.error("module/ missing; run from the main repo directory");
    process.exit(1);
  }
  if (!existsSync(join(REPO_ROOT, "templates"))) {
    log.error("templates/ missing; run from the main repo directory");
    process.exit(1);
  }

  const outputPath = join(REPO_ROOT, outputName);
  const stagingDir = join(tmpdir(), `d35e-pack-${randomBytes(4).toString("hex")}`);
  const destRoot = join(stagingDir, SYSTEM_ID);
  mkdirSync(destRoot, { recursive: true });

  try {
    for (const p of RUNTIME_PATHS) {
      const src = join(REPO_ROOT, p);
      if (!existsSync(src)) {
        log.error(`required path missing: ${p}`);
        process.exit(1);
      }
      copyRecursive(src, join(destRoot, p));
      log.info(`copied ${p}`);
    }

    for (const p of OPTIONAL_PATHS) {
      const src = join(REPO_ROOT, p);
      if (existsSync(src)) {
        copyRecursive(src, join(destRoot, p));
        log.info(`copied ${p} (optional)`);
      }
    }

    stripJunk(destRoot);

    if (!existsSync(join(destRoot, "packs"))) {
      log.error("packs/ missing; run npm run sources:repack first");
      process.exit(1);
    }

    const d35ePath = join(destRoot, "D35E.js");
    let content = readFileSync(d35ePath, "utf8");
    if (content.includes("CONFIG.debug.hooks = true;")) {
      content = content.replace(
        "CONFIG.debug.hooks = true;",
        "// CONFIG.debug.hooks = true; // disabled in release build"
      );
      writeFileSync(d35ePath, content, "utf8");
      log.info("disabled hooks debug in D35E.js");
    } else {
      log.warn("hooks debug line not found in D35E.js — already patched?");
    }

    rmRecursive(outputPath);
    execSync(`node -c "${d35ePath}"`, { stdio: "pipe" });

    zipDir(destRoot, outputPath);
    log.success(`built ${outputName}`);
  } finally {
    rmRecursive(stagingDir);
  }
}

main();
