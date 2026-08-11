---
name: commit
description: Draft and create a Conventional Commits-style git commit for the current changes. Use when the user asks to commit, write a commit message, or stage and commit changes.
---

Review the git state and create a commit following the Conventional Commits specification.

## Process

1. Run `git status` and `git diff --staged` to see what is staged. If nothing is staged, also run `git diff` to see unstaged changes — then stage appropriate files before committing.
2. Analyse the changes: what is the intent, what area changed, what type of change is it?
3. Draft the commit message using the format below.
4. Present the drafted message to the user and confirm before running `git commit`.

## Format

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Restructuring without behaviour change |
| `style` | Formatting, whitespace — no logic change |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Build scripts, tooling, dependency bumps, config |

### Rules

- **Subject line**: imperative mood ("add" not "added"), lowercase after the colon, no trailing period, ≤72 characters
- **Scope**: short noun for the area changed — optional but encouraged (e.g. `auth`, `api`, `ui`, `db`)
- **Body**: wrap at 72 chars; explain *why*, not *what* — only include if the subject alone is insufficient
- **Breaking changes**: add `BREAKING CHANGE: <description>` in the footer with a migration path
- **Issue refs**: add `Closes #123` or `Refs #456` in the footer when applicable

### Examples

```
feat(auth): add magic link login flow

fix(api): return 404 when resource not found instead of 500

refactor(db): extract query builder into separate class

chore: upgrade composer dependencies to latest patch versions
```
