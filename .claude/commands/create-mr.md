Push the current branch and create a GitLab merge request targeting master.

> This repo is on **GitLab** — use `glab`, not `gh`. If `glab` is not installed or authenticated,
> tell the user to run `glab auth login` and stop.

---

## Steps

### 1. Gather context (run in parallel where possible)

```bash
git status
git branch --show-current
git log master...HEAD --oneline
git diff master...HEAD --stat
```

Warn the user if there are uncommitted changes — do not commit them.

### 2. Push the branch

```bash
# Check for upstream
git rev-parse --abbrev-ref @{u}
```

- If that fails (no upstream): `git push -u origin HEAD`
- If upstream exists: `git push`

### 3. Detect issue number

Extract from the branch name if it matches `issue-<number>-*`
(e.g. `issue-1234-some-slug` → #1234). Also scan commit messages for `#<number>`.

### 4. Draft the MR title and description

- **Title**: ≤70 chars, plain English — no conventional-commit prefix.
  - Good: `Fix grapple roll breaking when clicking the grapple button`
  - Bad: `fix: grapple roll`
- **Description**:
  ```
  ## Summary
  <1-3 bullet points describing what changed and why>

  ## Test plan
  <bulleted checklist of how to verify the change works>
  ```
- If an issue number was found, append: `Closes #<number>`

### 5. Create the MR

**Choose the approach that matches your shell:**

#### bash / Git Bash (Linux, macOS, WSL, Git Bash on Windows)

```bash
glab mr create \
  --title "TITLE HERE" \
  --description "$(cat <<'EOF'
## Summary
- bullet 1
- bullet 2

## Test plan
- [ ] step 1

Closes #1234
EOF
)" \
  --target-branch master \
  --remove-source-branch
```

#### PowerShell (Windows native shell)

Write the description to a temp file, then pass it:

```powershell
$desc = @"
## Summary
- bullet 1
- bullet 2

## Test plan
- [ ] step 1

Closes #1234
"@
$tmp = [System.IO.Path]::GetTempFileName()
Set-Content -Path $tmp -Value $desc -NoNewline
glab mr create `
  --title "TITLE HERE" `
  --description (Get-Content $tmp -Raw) `
  --target-branch master `
  --remove-source-branch
Remove-Item $tmp
```

#### cmd.exe (fallback)

Use a temp file:

```cmd
(
echo ## Summary
echo - bullet 1
echo.
echo ## Test plan
echo - [ ] step 1
echo.
echo Closes #1234
) > "%TEMP%\mr-desc.txt"
glab mr create --title "TITLE HERE" --description-file "%TEMP%\mr-desc.txt" --target-branch master --remove-source-branch
del "%TEMP%\mr-desc.txt"
```

> Note: `--description-file` is supported in glab ≥ 1.40. If it fails, fall back to the PowerShell approach.

### 6. Print the MR URL

Print the URL returned by `glab` so the user can open it.

---

## Notes

- Always target `master` — this repo has no `main` branch.
- `--remove-source-branch` is the standard convention — include it unless the user says otherwise.
- If the branch is already `master`, stop and tell the user to work on a feature branch.
