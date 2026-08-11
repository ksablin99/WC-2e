---
paths:
  - "module/**/*.js"
  - "templates/**/*.hbs"
---

# Foundry v12 → v13 Migration (in progress)

You are editing Foundry VTT system code. The v12→v13 migration is **incomplete**. Check every API call against this table before writing or accepting code. Run `/v13-scan` to see remaining patterns across the codebase.

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

## Actor / Item Creation in Tests

Foundry supports two creation modes: **full JSON import** (compendium-style, overwrites computed fields on init) and **name+type only + update** (the only reliable pattern for tests).

**Always use name+type creation followed by explicit updates in tests:**
```js
// Create minimal
const actor = await Actor.create({ name: 'Test', type: 'character' });
// Set fields via update (bypasses init overrides)
await actor.update({ 'system.abilities.str.value': 16 });
// Equipment: always created unequipped — equip separately
const [item] = await actor.createEmbeddedDocuments('Item', [{ name: 'Sword', type: 'equipment' }]);
await actor.items.get(item.id).update({ 'system.equipped': true });
```

The `equipped` field is **always** reset to `false` during `createEmbeddedDocuments`. Any `system.*` passed inline during creation may be overridden by Foundry's `prepareData()` hooks.

Always read `.foundrycache/foundry/` source before assuming how any v13 API works. Use the `foundry-api-researcher` agent for pre-implementation lookups.
