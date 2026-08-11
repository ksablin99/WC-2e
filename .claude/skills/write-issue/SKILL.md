---
name: write-issue
description: Write a bug report issue in the "X breaks when doing Y" style — observational, not prescriptive. Use when the user asks to file, write, or create an issue for a bug.
argument-hint: "[brief bug description]"
---

Write a bug report issue for the bug currently being discussed (or described in $ARGUMENTS).

## Style — the most important part

**Title** — a plain sentence describing what broke, not what to do about it.
- Pattern: "X breaks/crashes/is missing when doing Y"
- Good: "Item sheet crashes when the item has damage-type conditionals"
- Good: "Attack window shows no damage or conditional options after creating from a bane weapon"
- Good: "Spellbook is undefined when rendering NPC spell charges"
- Bad: "Fix item sheet crash" — no imperative, no "Fix/Add/Update"
- Bad: "Item sheet crashes due to v.data.name being undefined" — don't name the root cause
- ≤ 72 characters if possible

**Body** — written as if the reader is about to investigate, not fix.
- Describe *what* the user was doing and *what went wrong*
- Include reproduction steps if known
- Paste error logs and stack traces verbatim — these are the most useful part
- Do NOT say what the root cause is
- Do NOT say "we should", "the fix is", "change X to Y", or anything prescriptive
- Do NOT reference specific line numbers or internal implementation details
- One blank line between sections

## Process

1. Gather details from $ARGUMENTS and the current conversation:
   - What triggered the bug (user action, specific item/actor/setup)
   - What went wrong (crash, wrong behaviour, missing UI element)
   - Any error messages or stack traces
   - What the user expected to happen

2. Draft the issue using the template below.

3. Detect the repo host:
   - Run `git remote get-url origin` to check the remote URL
   - If it contains `github.com` → use `gh issue create`
   - If it contains `gitlab.com` or other GitLab host → use `glab issue create`
   - If neither tool is available or remote is unclear → just show the formatted issue

4. Show the draft to the user and ask: "Should I create this? If so, any labels to add?"
   - If yes, create it with the appropriate CLI tool
   - Suggest relevant labels based on what broke (e.g. `Bug`, `UI`, `Combat`, `Items`)
   - GitHub: `gh issue create --title "..." --body "..."`
   - GitLab: `glab issue create --title "..." --description "..."`

## Template

```
## Steps to reproduce

1. [What the user did — be specific: which actor type, which item, what they clicked]
2. ...

## Expected behaviour

[What should have happened]

## Actual behaviour

[What happened instead — plain description, no diagnosis]

## Error log

```
[Paste stack traces or console errors here exactly as reported — omit this section if none]
```

## Environment

- [Foundry version / framework version / relevant context if known]
```
