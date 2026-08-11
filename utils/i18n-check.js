"use strict";

/**
 * i18n key coverage checker for D35E.
 *
 * Scans module JS and template HTML for all game.i18n.localize/format() calls
 * and Handlebars {{localize}} helpers, then compares against lang/en.json.
 *
 * Modes:
 *   --verify  (default)  Report missing keys, exit 1 if any found. Use in CI.
 *   --fill               Interactive: prompt for each missing key's translation text.
 *
 * Options:
 *   --suggest            In fill mode, show suggested text derived from key name.
 *   --verbose / -v       Show file locations for each missing key.
 *   --summary            Print stats only, no per-key output (verify mode).
 *   --system-only        Skip keys not owned by this system (COMBAT.*, TOKEN.*, etc.).
 *
 * Fill mode auto-fixes template whitespace bugs and commits all changes.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EN_JSON = path.join(ROOT, "lang", "en.json");

// Files/dirs to scan. Root JS = D35E.js (shallow, only that file).
const SCAN_DIRS = [
  { dir: ROOT, exts: [".js"], shallow: true },          // D35E.js and siblings
  { dir: path.join(ROOT, "module"), exts: [".js"] },
  { dir: path.join(ROOT, "templates"), exts: [".html", ".hbs"] },
  { dir: path.join(ROOT, "source"), exts: [".json"] },  // pack source embedded code
];

// Key prefixes this system explicitly owns.
const SYSTEM_OWNED_PREFIXES = ["D35E.", "SETTINGS.D35E", "ERROR.ls"];

// Key prefixes provided by Foundry core or other systems — not our responsibility.
// SETTINGS.* is Foundry core EXCEPT SETTINGS.D35E* (checked first via SYSTEM_OWNED_PREFIXES).
const FOUNDRY_CORE_PREFIXES = [
  "COMBAT.", "TOKEN.", "PERMISSION.", "DICE.", "LIGHT.", "DOCUMENT.",
  "FOLDER.", "SIDEBAR.", "PLAYERS.", "WORLD.", "COMPENDIUM.", "CONTROL.",
  "CONTROLS.", "DRAWING.", "NOTE.", "TILE.", "WALL.", "AMBIENT.", "SCENE.",
  "JOURNAL.", "PLAYLIST.", "ACTOR.", "ITEM.", "MACRO.", "TABLE.", "CANVAS.",
  "CHAT.", "KEYBINDINGS.", "PACKAGE.", "SETUP.", "TOUR.", "USER.", "SETTINGS.",
  "PF1.",  // from PF1 fork — not this system's keys
];
const FOUNDRY_CORE_WORDS = new Set([
  "Cancel", "Submit", "Save", "Close", "Delete", "Confirm", "Yes", "No", "Save Changes",
]);

// Regex: string that looks like an i18n key (NAMESPACE.identifier).
// Used to detect keys stored as config values or passed to name:/hint: fields.
const I18N_KEY_LIKE = /^[A-Z][A-Z0-9]*\.[A-Za-z]/;

// Pack names from system.json — these look like "warcraftrpg2e.spells", "warcraftrpg2e.feats", etc.
// They are NOT i18n keys; filter them out of the scan results.
function loadPackNames() {
  try {
    const sys = JSON.parse(fs.readFileSync(path.join(ROOT, "system.json"), "utf8"));
    return new Set((sys.packs || []).map(p => `D35E.${p.name}`));
  } catch {
    return new Set();
  }
}
const PACK_NAMES = loadPackNames();

// ─── Extraction ──────────────────────────────────────────────────────────────

function getAllFiles(dir, exts, shallow = false) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (!shallow && entry.isDirectory()) {
      files.push(...getAllFiles(full, exts));
    } else if (exts.some(e => entry.name.endsWith(e))) {
      files.push(full);
    }
  }
  return files;
}

function addKey(key, file, lineNum, allKeys, keyLocations) {
  if (PACK_NAMES.has(key)) return; // pack name, not an i18n key
  allKeys.add(key);
  if (!keyLocations[key]) keyLocations[key] = [];
  keyLocations[key].push({ file, line: lineNum });
}

function scanJsFile(file, content, allKeys, dynamicRefs, keyLocations) {
  const relFile = path.relative(ROOT, file).replace(/\\/g, "/");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;

    // ── 1. Explicit game.i18n.localize/format("key") calls ──
    const callRe = /game\.i18n\.(localize|format)\(/g;
    while ((m = callRe.exec(line)) !== null) {
      const after = line.slice(m.index + m[0].length).trimStart();
      const staticMatch = /^["']([^"']+)["']/.exec(after);
      if (staticMatch) {
        // Detect prefix-concatenation: "D35E.ls." + varName — treat as dynamic
        const afterQuote = after.slice(staticMatch[0].length).trimStart();
        if (afterQuote.startsWith("+")) {
          dynamicRefs.push({ ref: line.trim().slice(0, 80), file: relFile, line: i + 1 });
        } else {
          addKey(staticMatch[1], relFile, i + 1, allKeys, keyLocations);
        }
      } else {
        dynamicRefs.push({ ref: line.trim().slice(0, 80), file: relFile, line: i + 1 });
      }
    }

    // ── 2. Foundry registration name:/hint:/label:/title: fields ──
    // Foundry internally calls game.i18n.localize() on these values.
    const regRe = /(?:name|hint|label|title)\s*:\s*["']([^"']+)["']/g;
    while ((m = regRe.exec(line)) !== null) {
      const key = m[1];
      if (I18N_KEY_LIKE.test(key)) {
        addKey(key, relFile, i + 1, allKeys, keyLocations);
      }
    }

    // ── 3. Config object i18n key values: "foo": "D35E.SomeKey" ──
    // Only scan known config files — otherwise compendium IDs in other files
    // (e.g. treasureTables.js) flood in as false positives.
    if (path.basename(file) === "config.js") {
      const cfgRe = /:\s*["']([^"']+)["']/g;
      while ((m = cfgRe.exec(line)) !== null) {
        const key = m[1];
        if (I18N_KEY_LIKE.test(key) && isSystemOwned(key)) {
          addKey(key, relFile, i + 1, allKeys, keyLocations);
        }
      }
    }
  }
}

// ── Pack source JSON: embedded code strings may contain game.i18n.localize() ──
function scanJsonFile(file, content, allKeys, keyLocations) {
  const relFile = path.relative(ROOT, file).replace(/\\/g, "/");
  // Match both plain and JSON-escaped quotes: localize("key") or localize(\"key\")
  const re = /game\.i18n\.(?:localize|format)\(\\?["']([^"'\\]+)\\?["']/g;
  let m;
  let lineNum = 1;
  // Line numbers in JSON are approximate — find them by counting newlines up to match
  while ((m = re.exec(content)) !== null) {
    lineNum = content.slice(0, m.index).split("\n").length;
    addKey(m[1], relFile, lineNum, allKeys, keyLocations);
  }
}

function scanHtmlFile(file, content, allKeys, keyLocations, whitespaceKeys) {
  const relFile = path.relative(ROOT, file).replace(/\\/g, "/");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const re = /\{\{[-~]?\s*localize\s+["']([^"']+)["']/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const raw = m[1];
      const key = raw.trim();
      if (key !== raw) {
        // Template bug: key has leading/trailing whitespace
        whitespaceKeys.push({ raw, key, file: relFile, line: i + 1 });
      }
      allKeys.add(key);
      if (!keyLocations[key]) keyLocations[key] = [];
      keyLocations[key].push({ file: relFile, line: i + 1 });
    }
  }
}

function scanAll() {
  const allKeys = new Set();
  const dynamicRefs = [];
  const keyLocations = {};
  const whitespaceKeys = []; // template bugs: {{localize " D35E.Key"}} with space

  for (const { dir, exts, shallow } of SCAN_DIRS) {
    for (const file of getAllFiles(dir, exts, shallow)) {
      const content = fs.readFileSync(file, "utf8");
      if (file.endsWith(".json")) {
        scanJsonFile(file, content, allKeys, keyLocations);
      } else if (file.endsWith(".js")) {
        scanJsFile(file, content, allKeys, dynamicRefs, keyLocations);
      } else {
        scanHtmlFile(file, content, allKeys, keyLocations, whitespaceKeys);
      }
    }
  }

  return { allKeys, dynamicRefs, keyLocations, whitespaceKeys };
}

// ─── en.json I/O ─────────────────────────────────────────────────────────────

function loadEnJson() {
  return JSON.parse(fs.readFileSync(EN_JSON, "utf8"));
}

function saveEnJson(data) {
  // Preserve trailing newline, 2-space indent
  fs.writeFileSync(EN_JSON, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function isSystemOwned(key) {
  // Explicitly system-owned takes priority
  if (SYSTEM_OWNED_PREFIXES.some(p => key.startsWith(p))) return true;
  // Known Foundry core — skip
  if (FOUNDRY_CORE_WORDS.has(key)) return false;
  if (FOUNDRY_CORE_PREFIXES.some(p => key.startsWith(p))) return false;
  // Unknown prefix — assume system-owned (e.g. bare keys like "Heightened" in pack code)
  return true;
}

function getMissingKeys(allKeys, enData, systemOnly = false) {
  return [...allKeys]
    .filter(k => !(k in enData))
    .filter(k => !systemOnly || isSystemOwned(k))
    .sort();
}

// ─── Duplicate key detection ─────────────────────────────────────────────────

function findDuplicates(rawContent) {
  // JSON.parse silently last-wins, so we must scan the raw text.
  const re = /^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/gm;
  const byKey = {};
  let m;
  while ((m = re.exec(rawContent)) !== null) {
    const key = m[1];
    const value = m[2];
    const line = rawContent.slice(0, m.index).split("\n").length;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ value, line });
  }
  return Object.entries(byKey)
    .filter(([, arr]) => arr.length > 1)
    .map(([key, arr]) => ({ key, occurrences: arr }));
}

async function deduplicateEnJson(prompt) {
  const raw = fs.readFileSync(EN_JSON, "utf8");
  const duplicates = findDuplicates(raw);

  if (duplicates.length === 0) return false;

  console.log(`\nFound ${duplicates.length} duplicate key(s) in en.json:\n`);

  // Start from the parsed object (last-value-wins baseline); we'll overwrite as needed.
  const enData = JSON.parse(raw);
  let changed = false;

  for (const { key, occurrences } of duplicates) {
    const uniqueValues = [...new Set(occurrences.map(o => o.value))];

    if (uniqueValues.length === 1) {
      // Same value everywhere — auto-remove silently.
      console.log(`  ${key}  — ${occurrences.length}× same value "${uniqueValues[0]}", kept one`);
      changed = true;
    } else {
      // Different values — ask user.
      console.log(`\nKey:  ${key}  (${occurrences.length} occurrences, different values)`);
      occurrences.forEach((o, i) =>
        console.log(`  [${i + 1}] line ${o.line}: "${o.value}"`)
      );
      const answer = await prompt(`Keep which? [1-${occurrences.length}] or type custom value: `);
      const idx = parseInt(answer, 10) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < occurrences.length) {
        enData[key] = occurrences[idx].value;
      } else if (answer) {
        enData[key] = answer;
      }
      // else: leave JSON.parse's last-wins value, still mark as changed to re-write clean
      changed = true;
    }
  }

  if (changed) {
    saveEnJson(enData);
    console.log(`\nDeduplicated ${duplicates.length} key(s).`);
  }

  return changed;
}

// ─── Template whitespace auto-fix ────────────────────────────────────────────

function fixTemplateWhitespace(whitespaceKeys) {
  const byFile = {};
  for (const w of whitespaceKeys) {
    if (!byFile[w.file]) byFile[w.file] = [];
    byFile[w.file].push(w);
  }

  let fixedFiles = 0;
  let fixedCount = 0;

  for (const [relFile, fixes] of Object.entries(byFile)) {
    const fullPath = path.join(ROOT, relFile);
    let content = fs.readFileSync(fullPath, "utf8");
    let changed = false;

    for (const fix of fixes) {
      // Replace {{localize " D35E.Key"}} → {{localize "D35E.Key"}}
      // raw contains the whitespace-padded key; key is the trimmed version
      const escapedRaw = fix.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(
        `(\\{\\{[-~]?\\s*localize\\s+[\"'])${escapedRaw}([\"'])`,
        "g"
      );
      const next = content.replace(re, `$1${fix.key}$2`);
      if (next !== content) {
        content = next;
        fixedCount++;
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(fullPath, content, "utf8");
      fixedFiles++;
    }
  }

  return { fixedFiles, fixedCount };
}

// ─── Git commit ───────────────────────────────────────────────────────────────

function gitCommit(message) {
  try {
    execFileSync("git", ["add", "lang/en.json", "templates/"], { cwd: ROOT, stdio: "pipe" });
    execFileSync("git", ["commit", "-m", message], { cwd: ROOT, stdio: "inherit" });
  } catch (e) {
    const msg = (e.stderr ? e.stderr.toString() : e.message).trim();
    console.error(`Git commit failed: ${msg}`);
  }
}

// ─── Key name → suggested translation ────────────────────────────────────────

function suggestText(key) {
  const parts = key.split(".");
  const last = parts[parts.length - 1];
  // camelCase → words
  return last
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

// ─── Verify mode (CI) ─────────────────────────────────────────────────────────

function verifyMode({ allKeys, dynamicRefs, keyLocations, whitespaceKeys }, opts) {
  const enData = loadEnJson();
  const missingKeys = getMissingKeys(allKeys, enData, opts.systemOnly);

  const systemNote = opts.systemOnly ? " (system-owned only)" : "";
  console.log(
    `Scanned: ${allKeys.size} static key reference(s), ${dynamicRefs.length} dynamic, ${Object.keys(enData).length} in en.json.`
  );

  if (opts.verbose && dynamicRefs.length > 0) {
    console.log(`\nDynamic keys (cannot verify statically):`);
    for (const d of dynamicRefs) {
      console.log(`  ${d.file}:${d.line}  ${d.ref}`);
    }
  }

  let exitCode = 0;

  // ── Duplicate keys ──
  const raw = fs.readFileSync(EN_JSON, "utf8");
  const duplicates = findDuplicates(raw);
  if (duplicates.length > 0) {
    console.error(`\nDuplicate keys in en.json (${duplicates.length}):`);
    for (const { key, occurrences } of duplicates) {
      const uniqueValues = [...new Set(occurrences.map(o => o.value))];
      if (uniqueValues.length === 1) {
        console.error(`  ${key}  — ${occurrences.length}× same value (run --fill to clean up)`);
      } else {
        console.error(`  ${key}  — ${occurrences.length}× DIFFERENT values:`);
        occurrences.forEach(o => console.error(`      line ${o.line}: "${o.value}"`));
      }
    }
    exitCode = 1;
  }

  if (whitespaceKeys.length > 0) {
    console.error(`\nTemplate bugs — keys with whitespace (${whitespaceKeys.length}):`);
    for (const w of whitespaceKeys) {
      console.error(`  ${w.file}:${w.line}  "${w.raw}" → should be "${w.key}"`);
    }
    exitCode = 1;
  }

  if (missingKeys.length === 0) {
    console.log(`\nAll i18n keys present in en.json${systemNote}. ✓`);
    return exitCode;
  }

  if (!opts.summary) {
    console.error(`\nMissing ${missingKeys.length} key(s) in lang/en.json${systemNote}:\n`);
    for (const key of missingKeys) {
      if (opts.verbose) {
        const locs = (keyLocations[key] || []).slice(0, 3);
        const locStr = locs.map(l => `${l.file}:${l.line}`).join(", ");
        console.error(`  ${key}  (${locStr})`);
      } else {
        console.error(`  ${key}`);
      }
    }
  } else {
    console.error(`\nMissing ${missingKeys.length} key(s) in lang/en.json${systemNote} (run without --summary to list them).`);
  }

  return 1;
}

// ─── Fill mode (interactive) ──────────────────────────────────────────────────

async function fillMode({ allKeys, keyLocations, whitespaceKeys }, opts) {
  let anyChange = false;

  // Single readline instance shared across all interactive steps.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = (q) => new Promise(resolve => rl.question(q, a => resolve(a.trim())));

  // ── 1. Deduplicate en.json ──
  const dedupChanged = await deduplicateEnJson(prompt);
  if (dedupChanged) anyChange = true;

  // Re-load after potential dedup rewrite.
  const enData = loadEnJson();
  const missingKeys = getMissingKeys(allKeys, enData, opts.systemOnly);

  // ── 2. Fix template whitespace bugs ──
  if (whitespaceKeys.length > 0) {
    console.log(`\nFixing ${whitespaceKeys.length} template whitespace bug(s)...`);
    const { fixedFiles, fixedCount } = fixTemplateWhitespace(whitespaceKeys);
    console.log(`Fixed ${fixedCount} occurrence(s) in ${fixedFiles} file(s).`);
    if (fixedCount > 0) anyChange = true;
  }

  // ── 3. Fill missing translation keys ──
  if (missingKeys.length === 0) {
    console.log("\nNo missing keys — en.json is complete.");
  } else {
    console.log(`\nFound ${missingKeys.length} missing key(s). Enter translation text for each (blank = skip):\n`);

    let added = 0;
    let skipped = 0;

    for (const key of missingKeys) {
      const locs = (keyLocations[key] || []).slice(0, 2);
      const locStr = locs.map(l => `${l.file}:${l.line}`).join(", ");
      const hint = opts.suggest ? suggestText(key) : null;
      console.log(`Key:    ${key}`);
      if (locStr) console.log(`At:     ${locStr}`);
      if (hint) console.log(`Hint:   ${hint}`);

      const raw = await prompt(hint ? "Text:   (Enter = use hint) " : "Text:   ");
      const text = raw || hint || "";
      if (text) {
        enData[key] = text;
        added++;
        console.log(`        ✓ Added${!raw ? " (hint)" : ""}\n`);
      } else {
        skipped++;
        console.log("        — Skipped\n");
      }
    }

    if (added > 0) {
      saveEnJson(enData);
      console.log(`Added ${added} key(s), skipped ${skipped}.`);
      anyChange = true;
    } else {
      console.log(`No translation changes (skipped all ${skipped} key(s)).`);
    }
  }

  rl.close();

  // ── 3. Commit if anything changed ──
  if (anyChange) {
    console.log("\nCommitting changes...");
    gitCommit("i18n: updated translations");
  }
}

// ─── Lang (non-English) verify + fill ────────────────────────────────────────

function langFilePath(langCode) {
  return path.join(ROOT, "lang", `${langCode}.json`);
}

function loadLangJson(langCode) {
  const p = langFilePath(langCode);
  if (!fs.existsSync(p)) {
    console.error(`Lang file not found: lang/${langCode}.json`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveLangJson(langCode, data) {
  fs.writeFileSync(langFilePath(langCode), JSON.stringify(data, null, 2) + "\n", "utf8");
}

function verifyLang(langCode, opts) {
  const enData = loadEnJson();
  const langRaw = fs.readFileSync(langFilePath(langCode), "utf8");
  const langData = JSON.parse(langRaw);

  const enKeys = Object.keys(enData);
  const missingKeys = enKeys.filter(k => !(k in langData)).sort();
  const orphanedKeys = Object.keys(langData).filter(k => !(k in enData)).sort();
  const duplicates = findDuplicates(langRaw);

  console.log(
    `en.json: ${enKeys.length} keys  |  ${langCode}.json: ${Object.keys(langData).length} keys`
  );

  let exitCode = 0;

  if (duplicates.length > 0) {
    console.error(`\nDuplicates in ${langCode}.json (${duplicates.length}):`);
    for (const { key, occurrences } of duplicates) {
      const uniqueValues = [...new Set(occurrences.map(o => o.value))];
      if (uniqueValues.length === 1) {
        console.error(`  ${key}  — ${occurrences.length}× same value (run --fill to clean up)`);
      } else {
        console.error(`  ${key}  — ${occurrences.length}× DIFFERENT values:`);
        occurrences.forEach(o => console.error(`      line ${o.line}: "${o.value}"`));
      }
    }
    exitCode = 1;
  }

  if (orphanedKeys.length > 0) {
    const label = `Orphaned keys in ${langCode}.json (not in en.json): ${orphanedKeys.length}`;
    if (opts.verbose) {
      console.log(`\n${label}`);
      orphanedKeys.forEach(k => console.log(`  ${k}  "${langData[k]}"`));
    } else {
      console.log(`\n${label} (--verbose to list)`);
    }
  }

  if (missingKeys.length === 0) {
    console.log(`\n${langCode}.json is complete. ✓`);
    return exitCode;
  }

  if (!opts.summary) {
    console.error(`\nMissing ${missingKeys.length} key(s) in ${langCode}.json:\n`);
    for (const key of missingKeys) {
      console.error(`  ${key}  en: "${enData[key]}"`);
    }
  } else {
    console.error(`\nMissing ${missingKeys.length} key(s) in ${langCode}.json.`);
  }

  return 1;
}

async function fillLang(langCode, prompt, opts) {
  let anyChange = false;

  // ── 1. Dedup lang file ──
  const langRaw = fs.readFileSync(langFilePath(langCode), "utf8");
  const duplicates = findDuplicates(langRaw);
  if (duplicates.length > 0) {
    // Temporarily swap EN_JSON target so deduplicateEnJson operates on the lang file.
    // Instead, inline a version that works on any file.
    console.log(`\nFound ${duplicates.length} duplicate key(s) in ${langCode}.json:\n`);
    const langData = JSON.parse(langRaw);
    let dedupChanged = false;
    for (const { key, occurrences } of duplicates) {
      const uniqueValues = [...new Set(occurrences.map(o => o.value))];
      if (uniqueValues.length === 1) {
        console.log(`  ${key}  — ${occurrences.length}× same value "${uniqueValues[0]}", kept one`);
        dedupChanged = true;
      } else {
        console.log(`\nKey:  ${key}  (${occurrences.length} occurrences, different values)`);
        occurrences.forEach((o, i) => console.log(`  [${i + 1}] line ${o.line}: "${o.value}"`));
        const answer = await prompt(`Keep which? [1-${occurrences.length}] or type custom value: `);
        const idx = parseInt(answer, 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < occurrences.length) {
          langData[key] = occurrences[idx].value;
        } else if (answer) {
          langData[key] = answer;
        }
        dedupChanged = true;
      }
    }
    if (dedupChanged) {
      saveLangJson(langCode, langData);
      console.log(`\nDeduplicated ${duplicates.length} key(s).`);
      anyChange = true;
    }
  }

  // ── 2. Fill missing keys (English value as hint) ──
  const enData = loadEnJson();
  const langData = loadLangJson(langCode);
  const missingKeys = Object.keys(enData).filter(k => !(k in langData)).sort();

  if (missingKeys.length === 0) {
    console.log(`\n${langCode}.json is complete — nothing to translate.`);
  } else {
    console.log(`\nFound ${missingKeys.length} key(s) to translate into ${langCode}.`);
    console.log(`English value shown as hint. Type translation and Enter, or blank line = skip.\n`);

    let added = 0;
    let skipped = 0;

    for (const key of missingKeys) {
      const enValue = enData[key];
      console.log(`Key:     ${key}`);
      console.log(`English: ${enValue}`);

      const raw = await prompt("Translation: ");
      if (raw && raw.trim()) {
        langData[key] = raw.trim();
        added++;
        console.log(`         ✓\n`);
      } else {
        skipped++;
        console.log("         — Skipped\n");
      }
    }

    if (added > 0) {
      saveLangJson(langCode, langData);
      console.log(`Translated ${added} key(s), skipped ${skipped}.`);
      anyChange = true;
    } else {
      console.log(`No changes (skipped all ${skipped} key(s)).`);
    }
  }

  // ── 3. Commit ──
  if (anyChange) {
    console.log("\nCommitting changes...");
    try {
      execFileSync("git", ["add", `lang/${langCode}.json`], { cwd: ROOT, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", `i18n: updated ${langCode} translations`], {
        cwd: ROOT, stdio: "inherit",
      });
    } catch (e) {
      const msg = (e.stderr ? e.stderr.toString() : e.message).trim();
      console.error(`Git commit failed: ${msg}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--fill") ? "fill" : "verify";

  const langIdx = args.indexOf("--lang");
  const langCode = langIdx !== -1 ? args[langIdx + 1] : null;

  const opts = {
    verbose: args.includes("--verbose") || args.includes("-v"),
    summary: args.includes("--summary"),
    suggest: args.includes("--suggest"),
    systemOnly: args.includes("--system-only"),
  };

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`Usage: node utils/i18n-check.js [--fill] [--lang <code>] [--verbose] [--suggest] [--summary] [--system-only]

  (no flag)      Verify mode: report missing keys, exit 1 if any (use in CI).
  --fill         Interactive fill: fix template whitespace bugs, prompt for missing
                 translation keys, then commit all changes automatically.
  --lang <code>  Work with lang/<code>.json instead of en.json.
                 Verify: show keys missing from the lang file vs en.json.
                 Fill: interactively translate missing keys (blank = skip).
  --verbose      Show file locations for each missing key.
  --suggest      (fill mode) Show a suggested text derived from the key name.
  --summary      (verify mode) Print count only, not each key name.
  --system-only  Exclude Foundry core keys (COMBAT.*, TOKEN.*, etc.) —
                 system owns only D35E.* and SETTINGS.D35E*.
`);
    return;
  }

  if (langCode) {
    if (mode === "fill") {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const prompt = (q) => new Promise(resolve => rl.question(q, a => resolve(a.trim())));
      await fillLang(langCode, prompt, opts);
      rl.close();
    } else {
      const code = await verifyLang(langCode, opts);
      process.exit(code);
    }
    return;
  }

  const scanResult = scanAll();

  if (mode === "fill") {
    await fillMode(scanResult, opts);
  } else {
    const code = verifyMode(scanResult, opts);
    process.exit(code);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
