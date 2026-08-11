---
name: d35e-commit
description: Repo-specific git commit workflow for D35E. Use whenever Codex is about to commit, draft a commit message, stage and commit changes, or summarize the current diff into a Conventional Commits-style message. This is the default commit workflow for this repo, and the message must be based on the actual staged or intended changes being committed, with explicit user confirmation before running git commit.
---

# D35E Commit

Use a Conventional Commits-style message and confirm before committing.
Base the message on the actual changes being committed, not on a generic task label.

## Process

1. Inspect `git status`
2. Inspect `git diff --staged`
3. If nothing is staged, inspect `git diff` and decide what should be staged
4. Draft a commit message in this format:

```text
<type>(<scope>): <short description>
```

5. Keep the subject imperative, lowercase after the colon, and at most 72 characters
6. Choose type and scope from the concrete files and behavior changes in the commit
7. Show the draft to the user and confirm before running `git commit`

## Types

- `feat`
- `fix`
- `refactor`
- `style`
- `test`
- `docs`
- `chore`

Add issue references in the footer when relevant.

## Commit Selection Rule

- If only part of the worktree should be committed, base the message only on that staged subset
- Do not write a broader message than the actual diff supports
- Prefer the narrowest accurate scope for the staged changes
