# Warcraft RPG 2e — Agent Onboarding

Warcraft RPG 2e is a private-use **Foundry VTT game system** adapting the D35E engine to the Warcraft RPG 2nd Edition rules. It is built in JavaScript.
Targeting **Foundry VTT v14** (primary). v12 is no longer supported. v13 is best-effort — use v14 APIs first, but avoid anything that breaks v13 when a compatible alternative exists.

The stable Foundry system id is `warcraftrpg2e`. Keep the internal `D35E` JavaScript namespace and stable data keys such as `dex`, `con`, and `wis` unless a rules change requires otherwise.

This repository is for personal use only. Do not publish or redistribute Warcraft book text, artwork, PDFs, or other Product Identity.

---

## Stack

- **Runtime**: Foundry VTT v14 (primary), v13 (best-effort) — Node.js-based game server
- **Language**: JavaScript (ES modules in `module/`, CommonJS in `scripts/` and `utils/`)
- **Tests**: Jest (unit — pure logic only), Playwright (e2e — required for all Foundry features)
- **Packs**: LevelDB via `classic-level` — source JSON in `source/`, compiled to `packs/`
- **Build**: webpack (release only), esbuild (test helpers)
- **Repo**: Private GitHub repository

---

## Communication Mode

Default to caveman-style communication for this repo unless the user explicitly asks for normal, detailed, or non-caveman replies.

If the user asks for `caveman`, `caveman mode`, `talk like caveman`, `less tokens`, or `be brief`, treat that as confirmation to remain in the default caveman mode.

If the user asks for more detail or to stop using caveman style, switch out of caveman mode for that turn or until changed again.

---

## Project Layout

```
module/         # System JS source — actors, items, rolls, UI sheets
templates/      # Handlebars templates for Foundry sheets and dialogs
source/         # Pack source JSON (tracked) — one file per document
packs/          # Compiled LevelDB packs (gitignored — built from source/)
icons/          # Art assets (gitignored — not in git)
scripts/        # Dev tooling (worktree management, dev/e2e setup)
utils/          # Pack build/query utilities
test/           # Jest unit tests and Playwright e2e tests
.foundrycache/  # Local Foundry source (gitignored — ground truth for APIs)
  foundry-v13/  #   v13 installation
  foundry-v14/  #   v14 installation
```

---

## Essential Commands

```bash
# Dependencies
npm install --ignore-scripts   # --ignore-scripts avoids native rebuild failures on Windows

# Unit tests (fast, no Foundry needed)
npm test
npm run test:foundry           # includes foundry-dice build step

# Build packs from source JSON
npm run sources:repack         # required after any source/ change or fresh clone

# Dev environment (Windows — live reload via junction, no copy needed)
npm run dev:setup              # one-time: creates data dir + links repo root into Foundry
npm run dev:start              # start Foundry (port from .dev-env)
npm run dev:clean              # tear down dev data dir

# Select Foundry version (13 or 14) — persists in .foundry-version
echo 14 > .foundry-version     # switch to v14 (setup auto-cleans on version change)
echo 13 > .foundry-version     # switch back to v13

# E2e tests (Playwright manages Foundry lifecycle)
npm run e2e:setup              # sync files to temp data dir
npx playwright test --reporter=list
npm run e2e:clean

# Pack utilities
npm run sources:query -- --pack feats --name dodge   # query a pack
npm run sources:unpack                               # LevelDB → JSON source
npm run sources:compact                              # compact LevelDB files
```

---

## Worktree Workflow

The project uses git worktrees to work on multiple issues in parallel.
Each worktree gets its own Foundry data dir and port — no conflicts.

```bash
npm run wt:create -- --issue 1234   # create worktree from issue metadata when supported
npm run wt:create -- --mr 456       # create worktree from MR branch
npm run wt:create -- <url>          # paste supported issue/branch URL directly
npm run wt:list                     # list worktrees with ports
npm run wt:switch                   # interactive picker
npm run wt:remove -- issue-1234-slug
npm run wt:cleanup                  # remove worktrees for closed issues/merged MRs
```

Worktrees are created as sibling directories: `../WC-2e-<slug>/`.
`node_modules/`, `icons/`, and `.foundrycache/` are junctioned from the main repo.

---

## Testing

> **Most Foundry features must be verified with e2e tests, not unit tests.**
> Unit tests cannot load Foundry APIs, documents, or sheets — anything that touches actors,
> items, sheets, dialogs, rolls, or packs requires a running Foundry instance (e2e).
> Use unit tests only for pure utility/logic code that has no Foundry dependencies.

- **Unit tests**: `test/` via Jest — fast, no Foundry instance needed; suitable for pure logic (dice math, data helpers, table lookups)
- **E2e tests**: `test/e2e/` via Playwright — full Foundry instance; **required for any feature that touches actors, items, sheets, dialogs, rolls, hooks, or packs**
- Playwright starts/stops Foundry automatically — no manual server management needed
- Always run `npm run e2e:setup` before e2e tests — syncs source to the temp data dir
- Stop Foundry before `e2e:setup` — LevelDB packs are locked while Foundry is running
- Helpers: `test/e2e/helpers.js` — `gotoGame`, `clearWorld`, `dismissOverlays`, `dismissSystemDialogs`
- Call `dismissSystemDialogs` in `beforeEach` to close migration dialogs

---

## GitHub Workflow

Use normal Git commands for local work. Use `gh` for GitHub issue or pull-request operations only when requested:

```bash
gh issue list
gh issue view 1234
gh pr list
gh pr view 456
gh pr checkout 456
```

---

## Warcraft RPG Rules — Trusted Sources

The supplied local Warcraft RPG PDFs under `docs/` are authoritative for Warcraft rules. Record PDF and printed-book page provenance for imported content. When two passages conflict, preserve both citations in an errata ledger instead of silently guessing.

Do not commit extracted book text or artwork. Book PDFs remain local/private reference material.

For unchanged D&D 3.5e mechanics, `.srd/` is the authoritative fallback — a local copy of the SRD downloaded from dndsrd.net.

```bash
npm run srd:setup       # download + unpack to .srd/ (gitignored, run once)
```

When verifying an unchanged D&D 3.5e rule, **read the relevant file under `.srd/` first**.
If `.srd/` is not present, run `npm run srd:setup` before proceeding.

Trusted online mirrors (use only if `.srd/` is unavailable):
- https://www.d20srd.org/ — primary online reference
- https://www.dndsrd.net/ — source of the local download

**Do NOT** rely on wikis, fan sites, LLM knowledge, or any other source for rules lookups.

---

## Code Conventions

- **System data paths**: use `system.*` not `data.*` (v13+ requirement)
- **Document IDs**: use `.id` not `._id`
- **No jQuery** in sheet code — use native DOM
- **Pack changes**: edit files in `source/`, run `npm run sources:repack` to rebuild `packs/`
- **Line endings**: `source/**/*.json` must stay LF — enforced via `.gitattributes`

---

## Foundry API — v12 patterns to avoid

These v12 patterns are broken in v13 and v14. All must be fixed:

| ❌ v12 | ✅ v13/v14 | Notes |
|---|---|---|
| `controls` (array) in `getSceneControlButtons` | `controls` (plain object keyed by name) | |
| `tools` (array in control group) | `tools` (plain object keyed by name) | |
| `onClick` on tool | `onChange: (event, active) => {}` | `onClick` removed in v15 |
| `item._id` | `item.id` | All Documents use `.id` |
| `token.data.actorId` | `token.document.actorId` | |
| `token.data._id` | `token.id` | |
| `data.*` update paths | `system.*` | Actor/Item system data |
| jQuery `html` in `activateListeners` | native DOM element | `html?.nodeType === 1 ? html : html?.[0] ?? html` |
| `p.entity` on packs | `p.documentName` | |
| `ui.windows` (all apps) | `foundry.applications.instances` Map | ApplicationV2 not in `ui.windows` |
| `actor.getOwnedItem(id)` | `actor.items.get(id)` | |
| `CONST.DOCUMENT_PERMISSION_LEVELS` | `CONST.DOCUMENT_OWNERSHIP_LEVELS` | |

## v13 compat — APIs to avoid in v14 code

When writing new code targeting v14, prefer APIs that also work in v13 unless there is no alternative.
Check `.foundrycache/foundry-v13/` to verify an API existed in v13 before using a v14-only pattern.

The local Foundry sources:
- v14 (primary): `.foundrycache/foundry-v14/`
- v13 (compat check): `.foundrycache/foundry-v13/`

---

## Common Pitfalls

- **Never edit `packs/` directly** — always edit `source/` and repack
- **`packs/` is gitignored** — run `npm run sources:repack` on a fresh clone before starting Foundry
- **`classic-level` native rebuild** — use `npm install --ignore-scripts` on Windows to avoid node-gyp failures
- **Port conflicts** — main dev = 30000, worktree dev = 31000–39999, e2e = 30001–30999
- **Foundry must be stopped** before running `e2e:setup` or modifying packs

## Agent Interaction Style
Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.
Code/commits/PRs: normal. Off: "stop caveman" / "normal mode".
