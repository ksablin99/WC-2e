/**
 * wt:remove — remove a git worktree and its Foundry dev data directory.
 *
 * Usage:
 *   npm run wt:remove -- <path-or-branch>
 *   npm run wt:remove -- issue-1234-some-title
 *   npm run wt:remove -- ../D35E-issue-1234-some-title
 *   npm run wt:remove -- --delete-branch          # also delete the git branch
 *
 * The argument is matched against worktree paths (suffix match is fine).
 * Run `npm run wt:list` to see available worktrees.
 */

'use strict';

const { execSync } = require('child_process');
const { existsSync, lstatSync, readFileSync, rmSync, unlinkSync } = require('fs');
const { resolve, join } = require('path');

const REPO_ROOT = resolve(__dirname, '..');
const { ensureManagedDataMarker, removeManagedDataDir } = require('./safe-managed-data-dir');

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT, ...opts }).trim();
}

// ── Parse args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2).filter(a => a !== '--delete-branch');
const deleteBranch = process.argv.includes('--delete-branch');
const query = args[0];

if (!query) {
  console.error('Usage: npm run wt:remove -- <path-or-branch-suffix> [--delete-branch]');
  console.error('       npm run wt:list   to see available worktrees');
  process.exit(1);
}

// ── Find matching worktree ────────────────────────────────────────────────────

try { run('git fetch origin'); } catch { /* best-effort */ }

const raw = run('git worktree list --porcelain');
const worktrees = [];
let current = {};

for (const line of raw.split('\n')) {
  if (line.startsWith('worktree ')) {
    if (current.path) worktrees.push(current);
    current = { path: line.slice(9) };
  } else if (line.startsWith('branch ')) {
    current.branch = line.slice(7).replace('refs/heads/', '');
  } else if (line.startsWith('HEAD ')) {
    current.head = line.slice(5);
  }
}
if (current.path) worktrees.push(current);

// Filter out the main worktree
const normRoot = REPO_ROOT.replace(/\\/g, '/');
const candidates = worktrees.filter(wt => wt.path.replace(/\\/g, '/') !== normRoot);

const normQuery = query.replace(/\\/g, '/').toLowerCase();
const match = candidates.find(wt => {
  const normPath = wt.path.replace(/\\/g, '/').toLowerCase();
  return (
    normPath === normQuery ||
    normPath.endsWith('/' + normQuery) ||
    wt.branch?.toLowerCase() === normQuery.toLowerCase()
  );
});

if (!match) {
  console.error(`[wt:remove] No worktree found matching: ${query}`);
  console.error('  Available worktrees:');
  for (const wt of candidates) {
    console.error(`    ${wt.branch ?? '(detached)'}  →  ${wt.path}`);
  }
  process.exit(1);
}

const { path: wtPath, branch } = match;
console.log(`[wt:remove] Removing worktree: ${wtPath}`);
console.log(`[wt:remove] Branch: ${branch ?? '(detached)'}`);

// ── Read and clean up Foundry dev data dir ────────────────────────────────────

const devEnvPath = join(wtPath, '.dev-env');
if (existsSync(devEnvPath)) {
  let dataDir = null;
  for (const line of readFileSync(devEnvPath, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k?.trim() === 'DEV_DATA_DIR' && rest.length) {
      dataDir = rest.join('=').trim();
      break;
    }
  }
  if (dataDir && existsSync(dataDir)) {
    ensureManagedDataMarker(dataDir, {
      repoRoot: wtPath,
      kind: 'dev',
      expectedWorldId: 'dev-world',
    });
    removeManagedDataDir(dataDir, { repoRoot: wtPath, kind: 'dev' });
    console.log(`[wt:remove] Removed Foundry data dir: ${dataDir}`);
  }
}

// ── Remove icons junction so git worktree remove doesn't choke on it ─────────
//
// The icons/ junction is not tracked by git. git worktree remove --force will
// still balk if it finds untracked content. Remove the junction first.

// Remove junctions created by wt:create. On Windows, git worktree remove --force
// follows junctions and deletes the target's contents. We must unlink junctions
// first. Use lstatSync (not existsSync) so broken junctions are still detected
// even when the target no longer exists.
for (const junctionName of ['icons', '.foundrycache', 'node_modules', 'scratch']) {
  const junctionPath = join(wtPath, junctionName);
  let stat;
  try { stat = lstatSync(junctionPath); } catch { continue; }
  if (stat.isSymbolicLink()) {
    // Junction / symlink — remove without following
    try { rmSync(junctionPath, { recursive: false }); } catch { /* already gone */ }
    console.log(`[wt:remove] Removed ${junctionName} junction.`);
  } else {
    // Real directory — safe to recurse
    rmSync(junctionPath, { recursive: true, force: true });
    console.log(`[wt:remove] Removed ${junctionName} directory.`);
  }
}

// ── Remove worktree ───────────────────────────────────────────────────────────

try {
  run(`git worktree remove "${wtPath}" --force`);
  console.log('[wt:remove] Worktree removed.');
} catch (err) {
  // If git worktree remove fails, try manual cleanup
  console.warn(`[wt:remove] git worktree remove failed (${err.message}), trying manual cleanup...`);
  if (existsSync(wtPath)) {
    rmSync(wtPath, { recursive: true, force: true });
  }
  run('git worktree prune');
  console.log('[wt:remove] Cleaned up manually and pruned worktree list.');
}

// ── Optionally delete the branch ──────────────────────────────────────────────

if (deleteBranch && branch) {
  try {
    run(`git branch -d "${branch}"`);
    console.log(`[wt:remove] Deleted branch: ${branch}`);
  } catch {
    console.warn(`[wt:remove] Could not delete branch '${branch}' cleanly (unmerged?).`);
    console.warn(`  Force delete with: git branch -D "${branch}"`);
  }
}

console.log('[wt:remove] Done.');
