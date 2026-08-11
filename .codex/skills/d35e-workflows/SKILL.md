---
name: d35e-workflows
description: "Repo-specific workflow router for the D35E Foundry VTT system. Use when Codex needs to execute one of the common Claude-style workflows from this repo: sync-test, v13-scan, query-pack, MR checkout, or MR creation. Also use when a user asks for one of those workflows without naming the underlying command sequence."
---

# D35E Workflows

Read [AGENTS.md](../../../AGENTS.md) for repo conventions, then use the matching workflow below.

## Sync Test

Use when the user wants a full e2e sync and run.

1. Stop any manual e2e Foundry instance if one is running: `pm2 stop foundry-e2e`
2. Run `npm run e2e:setup`
3. Run `npx playwright test --reporter=list`
4. Report pass and fail counts plus failing test names and key errors

If setup fails, report the last relevant setup output and stop.

## V13 Scan

Use when the user wants remaining v12 API patterns identified.

Search only in `module/` and `templates/`. Report matches grouped by pattern with `file:line` plus the matching line.

Check for:

- `\\._id\\b`
- `token\\.data\\.`
- `\\.data\\.actorId`
- `getOwnedItem\\(`
- `DOCUMENT_PERMISSION_LEVELS`
- `p\\.entity\\b`
- `ui\\.windows`
- `new Dialog\\(`
- `jQuery\\(` or `\\$\\(`
- `update.*\"data\\.`

End with `Remaining v12 patterns: N across M files`.

## Query Pack

Use when the user wants to inspect a compendium pack by name, type, or field.

Run:

```powershell
npm run sources:query -- <arguments>
```

Print the matching IDs or JSON and include the final match count.

## MR Checkout

Use when the user wants a GitLab MR checked out and summarized.

1. Run `glab mr checkout <mr-number>`
2. Run `glab mr view <mr-number>`
3. Run `git diff master...HEAD --stat`
4. Run `git log master...HEAD --oneline`
5. Summarize intent, changed areas, and any migration-relevant changes

## Create MR

Use when the user wants the current branch pushed and a GitLab MR opened.

1. Inspect `git status`, current branch, commit list, and diff stat against `master`
2. Warn about uncommitted changes; do not commit them automatically
3. Push the branch, using `git push -u origin HEAD` if no upstream exists
4. Detect an issue number from a branch like `issue-1234-*` or from commit messages mentioning `#1234`
5. Draft an MR title in plain English, no conventional-commit prefix
6. Draft an MR description with `## Summary` and `## Test plan`; append `Closes #<issue>` if an issue number was found
7. In PowerShell, write the description to a temp file before creating the MR. Use a pattern like:

```powershell
$desc = @"
## Summary
- bullet 1

## Test plan
- [ ] step 1

Closes #1234
"@
$tmp = [System.IO.Path]::GetTempFileName()
Set-Content -Path $tmp -Value $desc -NoNewline
glab mr create `
  --title "Plain English title here" `
  --description (Get-Content $tmp -Raw) `
  --target-branch master `
  --remove-source-branch
Remove-Item $tmp
```

8. Do not use conventional-commit prefixes in MR titles. Good: `Fix grapple roll breaking when clicking the grapple button`. Bad: `fix: grapple roll`

Always use `glab`, not `gh`.
