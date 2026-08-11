/**
 * wt:switch — interactively select a worktree and copy its cd command to the clipboard.
 *
 * Usage:  npm run wt:switch
 *
 * Shows a numbered list of worktrees. Pick one, and the script copies
 *   cd "<path>"
 * to your clipboard so you can paste it in any terminal.
 */

'use strict';

const { execSync } = require('child_process');
const { existsSync, readFileSync } = require('fs');
const { resolve, join } = require('path');
const { createInterface } = require('readline');
const { buildSwitchCommand, copyToClipboard, ensureWorktreeColor } = require('./lib/wt-colors');

const REPO_ROOT = resolve(__dirname, '..');

// ── Parse worktrees ───────────────────────────────────────────────────────────

try { execSync('git fetch origin', { cwd: REPO_ROOT }); } catch { /* best-effort */ }

const raw = execSync('git worktree list --porcelain', { encoding: 'utf8', cwd: REPO_ROOT });
const worktrees = [];
let current = {};

for (const line of raw.trim().split('\n')) {
  if (line.startsWith('worktree ')) {
    if (current.path) worktrees.push(current);
    current = { path: line.slice(9) };
  } else if (line.startsWith('branch ')) {
    current.branch = line.slice(7).replace('refs/heads/', '');
  } else if (line === 'detached') {
    current.detached = true;
  }
}
if (current.path) worktrees.push(current);

const normRoot = REPO_ROOT.replace(/\\/g, '/');
for (const wt of worktrees) {
  wt.isMain = wt.path.replace(/\\/g, '/') === normRoot;
  const metaPath = join(wt.path, '.wt-meta');
  if (existsSync(metaPath)) {
    try { wt.meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch { /* ignore */ }
  }
  const devEnvPath = join(wt.path, '.dev-env');
  if (existsSync(devEnvPath)) {
    for (const line of readFileSync(devEnvPath, 'utf8').split('\n')) {
      const [k, ...rest] = line.split('=');
      if (k?.trim() === 'DEV_PORT' && rest.length) { wt.devPort = rest.join('=').trim(); break; }
    }
  }
  wt.devPort ??= wt.meta?.devPort ?? '—';
  if (existsSync(metaPath)) {
    const colorInfo = ensureWorktreeColor(wt.path, wt.meta);
    wt.meta = colorInfo.meta;
    wt.color = colorInfo.color;
  }
}

if (worktrees.length === 0) {
  console.error('No worktrees found.');
  process.exit(1);
}

// ── Print list ────────────────────────────────────────────────────────────────

console.error('\nWorktrees:\n');
worktrees.forEach((wt, i) => {
  const label   = wt.isMain ? ' [main]' : '';
  const branch  = wt.branch ?? '(detached)';
  const issue   = wt.meta?.issue ? `  #${wt.meta.issue}` : '';
  const mr      = wt.meta?.mr    ? `  !${wt.meta.mr}` : '';
  const port    = `  port ${wt.devPort}`;
  const color   = wt.color ? `  ${wt.color}` : '';
  console.error(`  ${i + 1}) ${branch}${label}${issue}${mr}${port}${color}`);
  console.error(`     ${wt.path}`);
});
console.error();

// ── Prompt ────────────────────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stderr });

rl.question(`Select worktree (1-${worktrees.length}): `, (answer) => {
  rl.close();

  const n = parseInt(answer, 10);
  if (isNaN(n) || n < 1 || n > worktrees.length) {
    console.error('Invalid selection.');
    process.exit(1);
  }

  const chosen = worktrees[n - 1];
  const switchCmd = buildSwitchCommand(chosen.path);

  if (copyToClipboard(switchCmd)) {
    console.error(`\nCopied to clipboard: ${switchCmd}`);
    console.error('Paste it in your terminal.\n');
  } else {
    console.error('\nRun this in your terminal:\n');
    console.log(switchCmd);
  }
});
