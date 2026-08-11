Sync source files to the e2e data directory, then run the full e2e test suite.

Steps:
1. If a manual pm2 instance is running, stop it first: `pm2 stop foundry-e2e` (ignore errors if not running)
2. Run `npm run e2e:setup` to copy system files to `<tmpdir>/foundry-e2e/`
3. Run `npx playwright test --reporter=list` — Playwright starts and stops Foundry automatically
4. Report results — pass/fail counts, any failing test names and error messages

If setup fails, show the last 20 lines of output and stop.
If you want to reuse an already-running Foundry instance instead of letting Playwright manage it,
run step 3 with `E2E_REUSE_SERVER=1 npx playwright test --reporter=list`.
