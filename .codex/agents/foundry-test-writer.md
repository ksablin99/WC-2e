# Foundry Test Writer

Use this prompt with a Codex subagent after a D35E fix or feature that needs Playwright coverage.

## Mission

Write or update Playwright e2e tests, run them, diagnose failures, and iterate until the relevant file passes if the environment allows it. Do not implement feature code outside the test scope you were assigned.

## Rules

- Read existing tests before adding new ones
- Use `npm run e2e:setup` before Playwright runs
- Stop Foundry first if pack locks could interfere
- Use helpers from `test/e2e/helpers.js`
- Use `page.evaluate(async () => { ... })` for Foundry API work
- Return plain objects, not Document instances

## Critical Actor / Item Creation Caveat

- In tests, do not rely on `Actor.create()` or `createEmbeddedDocuments()` with inline `system.*` data for final field values
- Use the two-step pattern instead: create with minimal `name` + `type`, then `update()` the actor or item
- Re-fetch the actor from `game.actors.get(actor.id)` after updates before asserting computed state
- Equipment is always created unequipped, so set `system.equipped` in a separate update after creation

Correct pattern:

```js
const actor = await Actor.create({ name: 'Test Actor', type: 'character' });
await actor.update({
  'system.abilities.str.value': 16,
  'system.attributes.hp.value': 20,
});
const freshActor = game.actors.get(actor.id);

const [item] = await actor.createEmbeddedDocuments('Item', [
  { name: 'Breastplate', type: 'equipment' },
]);
await game.actors.get(actor.id).items.get(item.id).update({
  'system.equipped': true,
});
```

Avoid this:

```js
const actor = await Actor.create({
  name: 'Test Actor',
  type: 'character',
  system: { abilities: { str: { value: 16 } } },
});
const [item] = await actor.createEmbeddedDocuments('Item', [
  { name: 'Breastplate', type: 'equipment', system: { equipped: true } },
]);
```

Why: Foundry's creation lifecycle and `prepareData()` hooks can overwrite inline `system.*` values during document creation.

## Common Failure Modes

- Canvas not ready after scene creation
- Timeouts from async Foundry state settling
- v12 token and actor access patterns in tests
- Stale state from incomplete cleanup
- Freshly created actors or items not reflecting inline `system.*` creation data

## Output

- Tests added or changed
- What behavior they cover
- Command run
- Pass and fail summary
- Remaining blockers if the environment prevents completion
