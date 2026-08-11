/**
 * wt:up — rebase all worktrees (including main) onto origin/master.
 *
 * Usage:  npm run wt:up
 *
 * For each worktree:
 *   1. Stashes any uncommitted changes.
 *   2. Runs `git rebase origin/master`.
 *      - If the rebase fails, aborts it, reports the failure, and moves on.
 *   3. If changes were stashed, checks whether the stash can be re-applied
 *      cleanly before popping it.  If conflicts would occur, the stash is
 *      preserved and a warning is printed so the user can resolve manually.
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const { existsSync } = require('fs');
const { resolve } = require('path');

const REPO_ROOT = resolve(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, cwd = REPO_ROOT) {
  return execSync(cmd, { encoding: 'utf8', cwd }).trim();
}

function runInWt(cmd, wt) {
  return run(cmd, wt.path);
}

function worktreePathExists(wt) {
  return wt.isMain || existsSync(wt.path);
}

function isUsableWorktree(wt) {
  if (wt.isMain) return true;
  if (!existsSync(wt.path)) return false;

  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: wt.path,
    encoding: 'utf8',
  });
  return result.status === 0 && result.stdout.trim() === 'true';
}

/** Returns true if the worktree has any tracked or untracked changes. */
function isDirty(wt) {
  const out = runInWt('git status --porcelain', wt);
  return out.length > 0;
}

/** Stashes all changes (tracked + untracked). Returns stash ref or null. */
function stash(wt) {
  runInWt('git stash push --include-untracked -m "wt:up auto-stash"', wt);
  // Confirm a stash was actually created (nothing to stash → no entry made)
  try {
    const ref = runInWt('git stash list --format=%gd -n1', wt);
    return ref || null;
  } catch {
    return null;
  }
}

/**
 * Checks whether the top stash entry can be re-applied without conflicts.
 * Uses `git apply --check` fed the stash patch via stdin.
 * Returns true if the apply would be clean.
 */
function stashApplyWouldBeClean(wt) {
  const patchResult = spawnSync('git', ['stash', 'show', '-p', '--include-untracked'], {
    cwd: wt.path,
    encoding: 'utf8',
  });
  if (patchResult.status !== 0 || !patchResult.stdout.trim()) {
    // Empty patch — nothing to conflict
    return true;
  }
  const checkResult = spawnSync('git', ['apply', '--check'], {
    cwd: wt.path,
    encoding: 'utf8',
    input: patchResult.stdout,
  });
  return checkResult.status === 0;
}

// ── Parse worktrees ───────────────────────────────────────────────────────────

function parseWorktrees() {
  const raw = run('git worktree list --porcelain');
  const worktrees = [];
  let current = {};

  for (const line of raw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) worktrees.push(current);
      current = { path: line.slice(9) };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7).replace('refs/heads/', '');
    } else if (line === 'bare') {
      current.bare = true;
    } else if (line === 'detached') {
      current.detached = true;
    }
  }
  if (current.path) worktrees.push(current);

  const normRoot = REPO_ROOT.replace(/\\/g, '/');
  for (const wt of worktrees) {
    wt.isMain = wt.path.replace(/\\/g, '/') === normRoot;
  }

  return worktrees;
}

let worktrees = parseWorktrees();
const invalid = worktrees.filter(wt => !wt.bare && !isUsableWorktree(wt));
if (invalid.length > 0) {
  console.log('\nPruning stale worktree entries...');
  for (const wt of invalid) {
    const label = wt.branch ?? (wt.detached ? `(detached ${wt.head?.slice(0, 8)})` : '(unknown)');
    const reason = worktreePathExists(wt) ? 'Invalid' : 'Missing';
    console.log(`   ${reason}: ${label}`);
    console.log(`   ${wt.path}`);
  }
  try {
    run('git worktree prune');
    console.log('   Pruned.\n');
  } catch {
    console.warn('   Prune failed — continuing with existing paths only.\n');
  }
  worktrees = parseWorktrees();
}

const active = worktrees.filter(wt => !wt.bare && isUsableWorktree(wt));

if (active.length === 0) {
  console.log('No worktrees found.');
  process.exit(0);
}

// ── Fetch once ────────────────────────────────────────────────────────────────

console.log('\nFetching from origin...');
try {
  run('git fetch origin');
  console.log('  Done.\n');
} catch {
  console.warn('  Fetch failed — results may be stale.\n');
}

// ── Rebase each worktree ──────────────────────────────────────────────────────

const results = [];

for (const wt of active) {
  const label = wt.branch
    ? `${wt.branch}${wt.isMain ? ' [main]' : ''}`
    : wt.detached
    ? `(detached ${wt.head?.slice(0, 8)})`
    : '(unknown)';

  console.log(`── ${label}`);
  console.log(`   ${wt.path}`);

  let stashedRef = null;

  if (!isUsableWorktree(wt)) {
    const status = worktreePathExists(wt) ? 'invalid worktree' : 'missing path';
    console.warn(`   ✗ Worktree is ${status} — skipping.`);
    results.push({ label, status });
    console.log();
    continue;
  }

  // 1. Stash if dirty
  if (isDirty(wt)) {
    console.log('   Stashing uncommitted changes...');
    try {
      stashedRef = stash(wt);
      if (stashedRef) {
        console.log(`   Stashed → ${stashedRef}`);
      } else {
        console.log('   (nothing to stash after all)');
      }
    } catch (err) {
      console.warn(`   ⚠ Stash failed: ${err.message.split('\n')[0]}`);
      console.log('   Skipping this worktree.\n');
      results.push({ label, status: 'skipped', reason: 'stash failed' });
      continue;
    }
  }

  // 2. Rebase
  let rebaseFailed = false;
  try {
    const out = runInWt('git rebase origin/master', wt);
    const summary = out.split('\n').find(l => l.trim()) ?? 'up to date';
    console.log(`   ✓ ${summary}`);
  } catch (err) {
    rebaseFailed = true;
    const firstLine = err.message.split('\n').find(l => l.trim()) ?? 'unknown error';
    console.warn(`   ✗ Rebase failed: ${firstLine}`);
    try { runInWt('git rebase --abort', wt); } catch { /* already clean */ }
  }

  // 3. Re-apply stash if we created one
  if (stashedRef) {
    if (!stashApplyWouldBeClean(wt)) {
      console.warn('   ⚠ Stash would conflict after rebase — preserved as ' + stashedRef);
      console.warn('     Resolve manually: git stash pop');
      results.push({ label, status: rebaseFailed ? 'rebase failed + stash preserved' : 'stash conflict' });
    } else {
      try {
        runInWt('git stash pop', wt);
        console.log('   Stash re-applied cleanly.');
        results.push({ label, status: rebaseFailed ? 'rebase failed' : 'ok' });
      } catch (err) {
        console.warn(`   ⚠ Stash pop failed unexpectedly: ${err.message.split('\n')[0]}`);
        console.warn(`     Stash preserved as ${stashedRef} — resolve manually: git stash pop`);
        results.push({ label, status: rebaseFailed ? 'rebase failed + stash preserved' : 'stash pop failed' });
      }
    }
  } else {
    results.push({ label, status: rebaseFailed ? 'rebase failed' : 'ok' });
  }

  console.log();
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('── Summary ──────────────────────────────────────');
for (const r of results) {
  const icon = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '—' : '✗';
  console.log(`  ${icon}  ${r.label}  (${r.status})`);
}
console.log();
