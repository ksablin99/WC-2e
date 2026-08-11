---
applyTo: "module/**/*.js,templates/**/*.hbs"
---

# Foundry v12 → v13 Migration (in progress)

You are editing Foundry VTT system code. The v12→v13 migration is **incomplete**.
Check every API call against this table before writing or accepting code.
Run the `v13-scan` skill to see remaining patterns across the codebase.

| ❌ v12 | ✅ v13 | Notes |
|---|---|---|
| `controls` (array) in `getSceneControlButtons` | `controls` (plain object keyed by name) | Guard with `!Array.isArray(controls)` |
| `tools` (array in control group) | `tools` (plain object keyed by name) | |
| `onClick` on tool | `onChange: (event, active) => {}` | `onClick` removed in v15 |
| `item._id` | `item.id` | All Documents use `.id` |
| `token.data.actorId` | `token.document.actorId` | |
| `token.data._id` | `token.id` | |
| `data.*` update paths | `system.*` | Actor/Item system data |
| jQuery `html` in `activateListeners` | native DOM element | `html?.nodeType === 1 ? html : html?.[0] ?? html` |
| `p.entity` on packs | `p.documentName` | |
| `ui.windows` (all apps) | `foundry.applications.instances` Map | ApplicationV2 not in `ui.windows` |
| `actor.getOwnedItem(id)` | `actor.items.get(id)` | |
| `CONST.DOCUMENT_PERMISSION_LEVELS` | `CONST.DOCUMENT_OWNERSHIP_LEVELS` | |

Always read `.foundrycache/foundry/` source before assuming how any v13 API works.
Use the `foundry-api-researcher` agent for pre-implementation lookups.
