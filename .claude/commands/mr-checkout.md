Check out a GitLab merge request locally and summarize it.

Usage: /mr-checkout <MR number>

Steps:
1. Run `glab mr checkout $ARGUMENTS` to check out the MR branch
2. Run `glab mr view $ARGUMENTS` to get the MR title, description, and author
3. Run `git diff master...HEAD --stat` to list changed files and line counts
4. Run `git log master...HEAD --oneline` to show commits on this branch
5. Summarize:
   - MR title and author
   - What the MR is trying to accomplish (from description + commit messages)
   - Which areas of the codebase are affected (group by module/directory)
   - Any migration-relevant changes (v12→v13 patterns, system.* paths, etc.)

If $ARGUMENTS is empty, ask the user for the MR number.
