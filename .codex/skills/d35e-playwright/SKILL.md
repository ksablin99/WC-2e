---
name: d35e-playwright
description: Repo-specific Playwright and Foundry UI workflow for the D35E system. Use when debugging a Foundry UI bug, reproducing browser-only behavior, writing or running Playwright e2e tests, or when the task involves actor sheets, dialogs, buttons, hooks, or any feature that must be validated in a running Foundry instance.
---

# D35E Playwright

Read [AGENTS.md](../../../AGENTS.md) for testing rules. Prefer browser reproduction before cold code reading for UI bugs.

## UI Bug Order Of Operations

1. Ensure Foundry is running with `npm run dev:start`, or find the worktree port via `npm run wt:list`
2. Reproduce the issue in the browser first
3. Inspect browser console errors
4. Only then read the source and patch the issue

Use the port from `.dev-env` or `npm run wt:list`.

## E2E Setup

1. Stop Foundry before setup if packs may be locked
2. Run `npm run e2e:setup`
3. Run the relevant Playwright tests
4. Clean up with `npm run e2e:clean` when appropriate

## Test Conventions

- Most Foundry features require e2e coverage, not unit tests
- Import and use `gotoGame`, `clearWorld`, `dismissOverlays`, and `dismissSystemDialogs`
- Call `dismissSystemDialogs` in `beforeEach`
- Use `page.evaluate(async () => { ... })` for Foundry API calls
- Return plain objects from `page.evaluate`

## Canvas Readiness

After creating an active scene, wait for the target scene and `PIXI.UPDATE_PRIORITY.OBJECTS` before doing token-linked actor updates:

```js
await page.waitForFunction(
  (id) => canvas.ready && canvas.scene?.id === id && PIXI.UPDATE_PRIORITY.OBJECTS !== undefined,
  sceneId,
  { timeout: 15_000 }
);
```

Use `canvas.scene?.id === sceneId`, not just `canvas.ready`.
