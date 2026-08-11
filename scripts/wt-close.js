/**
 * wt:close — close the current worktree if its issue/MR is done.
 *
 * Usage:
 *   npm run wt:close              # check GitLab; prompt if done
 *   npm run wt:close -- --force   # skip GitLab check, remove unconditionally
 *   npm run wt:close -- --yes     # skip confirmation prompt
 *
 * Must be run from inside a managed worktree (one created by wt:create).
 * Removes the worktree directory, dev data dir, junctions, and local branch,
 * then prints the cd command to return to the main worktree.
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const { existsSync, lstatSync, readFileSync, rmSync } = require('fs');
const { resolve, join } = require('path');
const { platform } = require('os');
const { createInterface } = require('readline');

const REPO_ROOT = resolve(__dirname, '..');
const GITLAB_PROJECT = 'dragonshorn%2FD35E';

const args = process.argv.slice(2);
const force    = args.includes('--force');
const skipConfirm = args.includes('--yes');

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, cwd = REPO_ROOT) {
  return execSync(cmd, { encoding: 'utf8', cwd }).trim();
}

function glabApi(path) {
  try {
    return JSON.parse(run(`glab api "projects/${GITLAB_PROJECT}/${path}"`));
  } catch {
    return null;
  }
}

function confirm(question) {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); res(answer.trim().toLowerCase()); });
  });
}

function copyToClipboard(text) {
  try {
    if (platform() === 'win32') {
      spawnSync('clip', [], { input: text, shell: true });
    } else if (platform() === 'darwin') {
      spawnSync('pbcopy', [], { input: text });
    } else {
      const r = spawnSync('xclip', ['-selection', 'clipboard'], { input: text });
      if (r.status !== 0) spawnSync('xsel', ['--clipboard', '--input'], { input: text });
    }
    return true;
  } catch { return false; }
}

// ── Identify current worktree ─────────────────────────────────────────────────

const raw = run('git worktree list --porcelain');
const worktrees = [];
let cur = {};
for (const line of raw.split('\n')) {
  if (line.startsWith('worktree ')) {
    if (cur.path) worktrees.push(cur);
    cur = { path: line.slice(9) };
  } else if (line.startsWith('branch ')) {
    cur.branch = line.slice(7).replace('refs/heads/', '');
  } else if (line.startsWith('HEAD ')) {
    cur.head = line.slice(5);
  }
}
if (cur.path) worktrees.push(cur);

// The main worktree is always the first entry
const mainWt = worktrees[0];
const mainPath = mainWt.path;

// Detect which worktree we're currently in by comparing CWD
const cwd = process.cwd().replace(/\\/g, '/');
const normMain = mainPath.replace(/\\/g, '/');

// Allow running from main repo (just go home) or from a worktree
const currentWt = worktrees.find(wt => {
  const wtNorm = wt.path.replace(/\\/g, '/');
  return cwd === wtNorm || cwd.startsWith(wtNorm + '/');
});

if (!currentWt) {
  console.error('Could not identify current worktree.');
  process.exit(1);
}

if (currentWt.path.replace(/\\/g, '/') === normMain) {
  console.log('Already in the main worktree — nothing to close.');
  process.exit(0);
}

// Must have a .wt-meta file (managed worktree)
const metaPath = join(currentWt.path, '.wt-meta');
if (!existsSync(metaPath)) {
  console.error(`No .wt-meta found in ${currentWt.path}.\nThis doesn't look like a managed worktree. Use git worktree remove manually.`);
  process.exit(1);
}

let meta;
try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch {
  console.error('Could not read .wt-meta.');
  process.exit(1);
}

// ── Check GitLab status (unless --force) ─────────────────────────────────────

async function main() {
  const branch = currentWt.branch ?? '(detached)';
  let reason = null;

  if (force) {
    reason = 'forced';
  } else if (meta.issue) {
    process.stdout.write(`Checking issue #${meta.issue}... `);
    const issue = glabApi(`issues/${meta.issue}`);
    if (!issue) {
      console.log('(could not fetch)');
    } else if (issue.state === 'closed') {
      console.log(`closed ✓`);
      reason = `issue #${meta.issue} is closed`;
    } else {
      console.log(`still ${issue.state}`);
    }
  } else if (meta.mr) {
    process.stdout.write(`Checking MR !${meta.mr}... `);
    const mr = glabApi(`merge_requests/${meta.mr}`);
    if (!mr) {
      console.log('(could not fetch)');
    } else if (mr.state === 'merged' || mr.state === 'closed') {
      console.log(`${mr.state} ✓`);
      reason = `MR !${meta.mr} is ${mr.state}`;
    } else {
      console.log(`still ${mr.state}`);
    }
  } else {
    console.log('No issue/MR linked in .wt-meta.');
  }

  if (!reason) {
    console.log(`\nWorktree is still active — use --force to remove anyway.`);
    console.log(`  Branch: ${branch}`);
    console.log(`  Path:   ${currentWt.path}\n`);
    process.exit(0);
  }

  // ── Confirm ───────────────────────────────────────────────────────────────

  console.log(`\nReady to close worktree (${reason}):`);
  console.log(`  Branch: ${branch}`);
  console.log(`  Path:   ${currentWt.path}\n`);

  if (!skipConfirm) {
    const answer = await confirm('Remove this worktree? [y/N] ');
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Aborted.\n');
      process.exit(0);
    }
  }

  // ── Remove ─────────────────────────────────────────────────────────────────
  // Must cd away from the worktree before removing it — both so git can remove
  // the directory and so Windows releases the directory lock on the CWD.

  console.log('\nRemoving worktree...');
  process.chdir(mainPath);

  // Remove Foundry dev data dir
  const devEnvPath = join(currentWt.path, '.dev-env');
  if (existsSync(devEnvPath)) {
    for (const line of readFileSync(devEnvPath, 'utf8').split('\n')) {
      const [k, ...rest] = line.split('=');
      if (k?.trim() === 'DEV_DATA_DIR' && rest.length) {
        const dataDir = rest.join('=').trim();
        if (existsSync(dataDir)) {
          rmSync(dataDir, { recursive: true, force: true });
          console.log(`  Removed Foundry data dir: ${dataDir}`);
        }
        break;
      }
    }
  }

  // Remove junctions / symlinks — use lstatSync so broken junctions are still
  // detected even when the target no longer exists (existsSync follows the link).
  for (const name of ['icons', '.foundrycache', 'node_modules', 'scratch']) {
    const p = join(currentWt.path, name);
    let stat;
    try { stat = lstatSync(p); } catch { continue; }
    if (stat.isSymbolicLink()) {
      try { rmSync(p, { recursive: false }); } catch { /* already gone */ }
    } else {
      rmSync(p, { recursive: true, force: true });
    }
  }

  // Remove worktree (run from REPO_ROOT since we're currently inside it)
  try {
    run(`git worktree remove "${currentWt.path}" --force`);
    console.log('  Worktree removed.');
  } catch {
    if (existsSync(currentWt.path)) rmSync(currentWt.path, { recursive: true, force: true });
    run('git worktree prune');
    console.log('  Cleaned up manually.');
  }

  // Delete local branch
  if (currentWt.branch) {
    try {
      run(`git branch -d "${currentWt.branch}"`);
      console.log(`  Deleted branch: ${currentWt.branch}`);
    } catch {
      if (skipConfirm || force) {
        try {
          run(`git branch -D "${currentWt.branch}"`);
          console.log(`  Force-deleted branch: ${currentWt.branch}`);
        } catch {
          console.warn(`  Could not delete branch '${currentWt.branch}' — delete manually.`);
        }
      } else {
        const answer = await confirm(`  Branch '${currentWt.branch}' has unmerged commits. Force-delete? [y/N] `);
        if (answer === 'y' || answer === 'yes') {
          try {
            run(`git branch -D "${currentWt.branch}"`);
            console.log(`  Force-deleted branch: ${currentWt.branch}`);
          } catch {
            console.warn(`  Could not delete branch — delete manually: git branch -D "${currentWt.branch}"`);
          }
        } else {
          console.log(`  Kept branch — delete manually: git branch -D "${currentWt.branch}"`);
        }
      }
    }
  }

  // ── Return home ──────────────────────────────────────────────────────────

  const cdCommand = `cd "${mainPath}"`;
  const copied = copyToClipboard(cdCommand);

  console.log(`\nDone! Worktree closed.\n`);
  console.log(`  ${cdCommand}${copied ? '  ← copied to clipboard' : ''}\n`);
}

main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
