# D35E — Codex Project Guide

Use this file for Codex-specific workflow. Keep `AGENTS.md` tool-agnostic and shared with other agents.

## Primary References

- Read [AGENTS.md](/E:/foundry/D35E/AGENTS.md) first for stack, commands, testing rules, worktrees, and v12 to v13 migration notes.
- Use [CLAUDE.md](/E:/foundry/D35E/CLAUDE.md) as source material for repo workflows that were originally written for Claude Code.

## Repo-Local Codex Skills

Use these repo-local skills when the task matches:

- [d35e-workflows](/E:/foundry/D35E/.codex/skills/d35e-workflows/SKILL.md): repo command workflows such as sync-test, v13-scan, query-pack, MR checkout, and MR creation
- [d35e-playwright](/E:/foundry/D35E/.codex/skills/d35e-playwright/SKILL.md): Foundry UI debugging and Playwright e2e work
- [d35e-commit](/E:/foundry/D35E/.codex/skills/d35e-commit/SKILL.md): repo commit workflow
- [d35e-write-issue](/E:/foundry/D35E/.codex/skills/d35e-write-issue/SKILL.md): observational bug issue drafting for GitLab
- `caveman:caveman`: ultra-compressed response mode for low-token, terse communication

## Agent Interaction Style

Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.
Code/commits/PRs: normal. Off: "stop caveman" / "normal mode".

## Commit Rule

When creating a commit or drafting a commit message in this repo, always use [d35e-commit](/E:/foundry/D35E/.codex/skills/d35e-commit/SKILL.md).

That means:

- inspect the actual staged or intended diff first
- choose the Conventional Commits type and scope from the changes being committed
- draft the message from the selected changes, not from the ticket title or a generic summary
- confirm with the user before running `git commit`

## Repo-Local Subagent Prompts

When using Codex subagents, mirror the Claude roles with these prompts:

- [foundry-api-researcher](/E:/foundry/D35E/.codex/agents/foundry-api-researcher.md): use before implementing anything that depends on Foundry v13 APIs
- [foundry-code-reviewer](/E:/foundry/D35E/.codex/agents/foundry-code-reviewer.md): use after implementation to review for v13 migration and D35E correctness
- [foundry-test-writer](/E:/foundry/D35E/.codex/agents/foundry-test-writer.md): use after a fix or feature to add or update Playwright coverage

## Agent Routing

Use the shared agent prompts this way:

- Use `foundry-api-researcher` before implementation when the task depends on uncertain Foundry v13 APIs, hook signatures, ApplicationV2 behavior, DataModel schemas, or canvas lifecycle details.
- Use `foundry-code-reviewer` after feature, fix, or refactor work in `module/`, `templates/`, or other Foundry-facing code.
- Use `foundry-test-writer` after a behavior change that needs new or updated Playwright coverage.

Default sequence for non-trivial Foundry work:

1. Research with `foundry-api-researcher` if the API shape is not already certain
2. Implement locally in the main thread
3. Review with `foundry-code-reviewer`
4. Add or update e2e coverage with `foundry-test-writer`

## Spawn Templates

Use these as copy-paste starting points when spawning Codex subagents.

### Foundry API Researcher

Read [foundry-api-researcher](/E:/foundry/D35E/.codex/agents/foundry-api-researcher.md), then answer this question by reading `.foundrycache/foundry/`: `[insert API question here]`. Report source files read, exact signatures or argument shapes, line references, recommended implementation pattern, and what to avoid. Do not write D35E code.

### Foundry Code Reviewer

Read [foundry-code-reviewer](/E:/foundry/D35E/.codex/agents/foundry-code-reviewer.md), then review the current changes in `[insert files or area here]`. Prioritize blocking issues, Foundry v13 API misuse, migration regressions, and D35E convention violations. Include file and line references.

### Foundry Test Writer

Read [foundry-test-writer](/E:/foundry/D35E/.codex/agents/foundry-test-writer.md), then add or update Playwright coverage for `[insert behavior here]`. Read existing tests first, use repo helpers, run the relevant e2e command if possible, and report pass or fail results plus any blockers.

## Notes

- These files are Codex-only scaffolding. They do not change Claude or Copilot behavior.
- Prefer `glab` for repo operations. Do not use GitHub-specific tooling in this repo.
