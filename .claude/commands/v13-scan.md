Scan the D35E codebase for remaining v12 API patterns that need to be migrated to v13/v14.

Search only in `module/` and `templates/` — skip `node_modules`, `.foundrycache`, `source/`.

Check for each of these patterns and report all matches with file path and line number:

| Pattern to find | v13 replacement |
|---|---|
| `\._id\b` on items/actors/documents | `.id` |
| `token\.data\.` | `token.document.` |
| `\.data\.actorId` | `.document.actorId` |
| `getOwnedItem\(` | `items.get(` |
| `DOCUMENT_PERMISSION_LEVELS` | `DOCUMENT_OWNERSHIP_LEVELS` |
| `p\.entity\b` | `p.documentName` |
| `ui\.windows` | `foundry.applications.instances` |
| `new Dialog\(` | consider `foundry.applications.api.DialogV2` (v13+) |
| `jQuery\(` or `\$\(` in sheet code | native DOM |
| `data\.\*` in `update\(` calls (heuristic: `update.*\"data\.`) | `system.*` |

Output format:
- Group by pattern
- For each match: `file:line — <the matching line>`
- End with a summary count per pattern and total remaining

If no matches found for a pattern, skip it (don't list it).
Print a final line: "Remaining v12 patterns: N across M files"
