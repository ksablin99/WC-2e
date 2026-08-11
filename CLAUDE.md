# D35E — Claude Code Project Guide

D35E is a Foundry VTT game system implementing D&D 3.5e SRD rules.
Currently targeting **Foundry VTT v14**. v12 is no longer supported. v13 is best-effort — target v14 first, but avoid APIs that break v13.

> Project conventions, commands, stack, and migration notes are in **AGENTS.md** (imported below).
> This file covers Claude Code-specific workflow only.

@AGENTS.md

---

## Agent Interaction Style
Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.
Code/commits/PRs: normal. Off: "stop caveman" / "normal mode".

---

## First-time setup

Copy your Foundry `license.json` to the repo root — gitignored, picked up automatically:

```bash
cp /path/to/your/FoundryVTT/Config/license.json ./license.json
```

Fallback order: `E2E_LICENSE_JSON` env var → `E2E_LICENSE_PATH` env var → platform default (`%LOCALAPPDATA%/FoundryVTT`).

---

## Debugging UI Bugs

<important if="bug involves UI — sheets not opening, buttons not working, dialogs missing">
When a bug involves a UI interaction (sheet won't open, button does nothing, dialog missing),
**reproduce it in the browser first** before reading code:

1. Ensure Foundry is running — `npm run dev:start` (port from `.dev-env`) or check `npm run wt:list` for the worktree's port
2. Use the `/playwright` skill to navigate to `http://localhost:<port>/game`
3. Reproduce the reported steps — open the relevant actor/item, click the thing that fails
4. Check browser console messages for JS errors — these usually point directly at the broken code path
5. **Then** read the source and fix

This order matters: console errors from a live reproduction are far faster than reading cold.

**Finding your port**: main repo dev = 30000; worktrees = run `npm run wt:list` to see each worktree's port.

If you cannot reproduce headlessly (interaction requires clicks you can't drive),
launch Playwright in **headed mode** and let the user reproduce it manually:
```bash
PWHEADED=1 npx playwright test --headed
```
Or keep the dev instance running and open `http://localhost:<port>/game` in the user's browser.
Once the user triggers the bug, collect console messages via the `/playwright` skill and proceed from the error.
</important>

---

## Slash Commands

Common workflows are in `.claude/commands/` — use them instead of re-prompting:

| Command | Purpose |
|---|---|
| `/sync-test` | Stop Foundry → sync → restart → run e2e tests |
| `/create-mr` | Push current branch and open a GitLab MR targeting master |
| `/mr-checkout` | Check out an MR with glab and summarize it |
| `/v13-scan` | Scan codebase for remaining v12 API patterns (still useful for v13 compat) |
| `/query-pack` | Query a LevelDB pack by name, type, or field |

---

## Agents

| Agent | When to invoke |
|---|---|
| `foundry-code-reviewer` | **After every feature/fix/refactor** — checks v14 correctness against source cache |
| `foundry-api-researcher` | **Before implementing** anything that touches Foundry APIs — researches how v14 APIs actually work |
| `foundry-test-writer` | **After every feature/fix** — writes e2e Playwright tests, runs them, iterates until passing |

Invoke with: `use the foundry-api-researcher agent to look up how X works`

---

## Tools & Resources

| Tool | Purpose |
|---|---|
| `.foundrycache/foundry-v14/` | Local Foundry v14 source — **ground truth for all API questions** |
| `.foundrycache/foundry-v14/client/` | Client-side source |
| `.foundrycache/foundry-v14/common/` | Document schemas & utilities |
| `.foundrycache/foundry-v13/` | v13 source — consult when checking v13 compat |
| `/playwright` skill | Live Foundry browser automation — port from `npm run wt:list` or `.dev-env` |
| https://foundryvtt.com/api/ | Official v14 API docs |
| https://foundryvtt.wiki/ | Community wiki |
| https://docs.legaciesofthedragon.com/ | D35E project docs |

<important if="using any Foundry API">
Always read `.foundrycache/foundry-v14/` source before assuming how a v14 API works.
Use the `foundry-api-researcher` agent for pre-implementation lookups.
When choosing APIs: prefer v14 patterns; avoid anything removed in v14 that also existed in v13 differently — check `.foundrycache/foundry-v13/` to confirm v13 compat.
</important>

---

## Test Infrastructure

- **Framework**: Playwright (`test/e2e/`)
- **Config**: `playwright.config.js` — `reuseExistingServer: false` by default
- **Data dir**: `<tmpdir>/foundry-e2e-<hash>/` (hash of REPO_ROOT — unique per worktree, written by `e2e:setup`, path in `.e2e-env`)
- **Auth**: GM session stored at `<tmpdir>/foundry-e2e/.auth.json`
- **Helpers** (`test/e2e/helpers.js`): `gotoGame`, `clearWorld`, `dismissOverlays`, `dismissSystemDialogs`
- Call `dismissSystemDialogs` in `beforeEach` — closes migration dialogs and welcome screens

---

## Foundry API Migrations

### v12 → v13/v14

<important if="writing or reviewing any Foundry API code">
Target v14 APIs. v13 is best-effort — avoid APIs that exist only in v14 when a v13-compatible equivalent works just as well.
Run `/v13-scan` to see remaining v12 patterns. Check the migration table in AGENTS.md.
</important>
