---
name: d35e-write-issue
description: Repo-specific bug issue drafting workflow for D35E. Use when the user asks Codex to file, write, or create a bug report. Draft issues in an observational style that describes what breaks when doing something, includes reproduction steps and raw error logs when available, and uses GitLab via glab for creation in this repo.
---

# D35E Write Issue

Write bug reports as observations, not prescriptions.

## Title Rules

- Describe what breaks when doing something
- Do not say `Fix`, `Add`, or `Update`
- Avoid naming the internal root cause in the title
- Keep it under 72 characters when practical

## Body Template

```markdown
## Steps to reproduce

1. ...

## Expected behaviour

...

## Actual behaviour

...

## Error log

[Paste raw stack trace or console errors here]

## Environment

- Foundry version / system version / other relevant context
```

## Process

1. Gather trigger, expected behavior, actual behavior, and raw errors
2. Draft the issue in observational language only
3. Detect the remote host with `git remote get-url origin`
4. In this repo, prefer `glab issue create`
5. Show the draft to the user and confirm before creating it
