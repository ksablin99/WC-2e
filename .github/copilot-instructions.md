# D35E — Copilot Instructions

D35E is a Foundry VTT game system (D&D 3.5e SRD), targeting **Foundry VTT v13**.
Full project context is in **AGENTS.md** (stack, layout, commands, conventions, v12→v13 migration table).

---

## Agent Workflow Rules

Always follow this workflow — these rules apply to every feature, fix, or refactor:

1. **Before touching any Foundry API** — invoke the `foundry-api-researcher` agent to look up how v13 APIs actually work from `.foundrycache/foundry/` source. Do not guess from v12 knowledge.
2. **After implementing any feature/fix/refactor** — invoke the `foundry-code-reviewer` agent to check v13 correctness and catch migration regressions.
3. **After every fix or new feature** — invoke the `foundry-test-writer` agent to write and run e2e Playwright tests until they pass.

Use `/agent` to browse and launch agents.

---

## Skills

Project skills (from `.claude/commands/`):

| Skill | When to use |
|---|---|
| `v13-scan` | Run first when working on `module/` or `templates/` — shows all remaining v12 patterns |
| `sync-test` | Run the full e2e test suite (stops Foundry, syncs files, runs Playwright) |
| `mr-checkout` | Check out a GitLab MR and get a summary of what it changes |
| `query-pack` | Search a LevelDB pack by name, type, or field |

---

## UI Bug Debugging

When a bug involves UI (sheet won't open, button does nothing, dialog missing):
1. Run `npm run dev:start` — port is in `.dev-env` (main = 30000, worktrees via `npm run wt:list`)
2. Open `http://localhost:<port>/game`, reproduce the reported steps
3. Check browser console for JS errors — these point directly at the broken code path
4. **Then** read the source and fix

---

## CLI & Shell Rules (Copilot only)

- **Prefer PowerShell** for all CLI operations — use `powershell` tool over bash/sh equivalents
- **`glab` multiline content** — always write multiline strings (MR descriptions, issue bodies, commit messages) to a temp file first, then pass via `--description (Get-Content $tmp)` or pipe, never inline:
  ```powershell
  $tmp = New-TemporaryFile; Set-Content $tmp "line1`nline2`nline3"
  glab mr create --description (Get-Content $tmp -Raw)
  Remove-Item $tmp
  ```

---

## Critical Rules

- **Never edit `packs/` directly** — edit `source/` then run `npm run sources:repack`
- **`npm install --ignore-scripts`** on Windows — avoids node-gyp failures
- **Stop Foundry** before `npm run e2e:setup` — LevelDB packs are locked while it runs
- **`system.*` not `data.*`** for all actor/item update paths (v13 requirement)
- **`.id` not `._id`** on all Documents
- **No jQuery** in sheet code — use native DOM

## Agent Interaction Style
Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.
Code/commits/PRs: normal. Off: "stop caveman" / "normal mode".
