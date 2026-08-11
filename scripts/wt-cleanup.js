/**
 * wt:cleanup — remove worktrees whose linked issue is closed or MR is merged.
 *
 * Fetches from origin and rebases the main worktree before checking, so
 * merged/deleted branches on origin are reflected in the results.
 *
 * Usage:  npm run wt:cleanup
 *         npm run wt:cleanup -- --dry-run    # show what would be removed, do nothing
 *         npm run wt:cleanup -- --yes        # skip confirmation prompt
 *
 * For each non-main worktree that has a .wt-meta file, queries GitLab to check:
 *   - issue: closed?
 *   - MR:    merged or closed?
 * If yes, offers to remove the worktree (same as wt:remove).
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const { existsSync, lstatSync, readFileSync, renameSync, rmSync } = require('fs');
const { resolve, join } = require('path');
const { createInterface } = require('readline');

const REPO_ROOT = resolve(__dirname, '..');
const GITLAB_PROJECT = 'dragonshorn%2FD35E';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipConfirm = args.includes('--yes');

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT }).trim();
}

function glabApi(path) {
  try {
    return JSON.parse(run(`glab api "projects/${GITLAB_PROJECT}/${path}"`));
  } catch {
    return null;
  }
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function canRemoveDir(dirPath) {
  const testPath = dirPath + '.__del_test__';
  try {
    renameSync(dirPath, testPath);
    renameSync(testPath, dirPath);
    return true;
  } catch {
    return false;
  }
}

// ── Parse worktrees ───────────────────────────────────────────────────────────

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

const normRoot = REPO_ROOT.replace(/\\/g, '/');
const candidates = worktrees.filter(wt => {
  if (wt.path.replace(/\\/g, '/') === normRoot) return false; // skip main
  const metaPath = join(wt.path, '.wt-meta');
  return existsSync(metaPath); // only worktrees created by wt:create
});

if (candidates.length === 0) {
  console.log('No managed worktrees found (no .wt-meta files).');
  process.exit(0);
}

// ── Check each worktree against GitLab ───────────────────────────────────────

async function main() {
  console.log('\nFetching from origin...');
  try { run('git fetch origin'); } catch { console.warn('  fetch failed — results may be stale.'); }

  // Rebase main worktree so it reflects any merged/deleted branches on origin
  const mainWt = worktrees.find(wt => wt.path.replace(/\\/g, '/') === REPO_ROOT.replace(/\\/g, '/'));
  if (mainWt && !mainWt.detached) {
    process.stdout.write(`Updating main worktree (${mainWt.branch})... `);
    try {
      run(`git rebase origin/master`);
      console.log('up to date.');
    } catch {
      try { run('git rebase --abort'); } catch { /* already clean */ }
      console.warn('rebase failed — continuing with current state.');
    }
  }

  console.log(`\nChecking ${candidates.length} worktree(s) against GitLab...\n`);

  const toRemove = [];

  for (const wt of candidates) {
    let meta;
    try { meta = JSON.parse(readFileSync(join(wt.path, '.wt-meta'), 'utf8')); } catch { continue; }

    const branch = wt.branch ?? '(detached)';
    let reason = null;

    if (meta.issue) {
      process.stdout.write(`  #${meta.issue}  ${branch} — checking issue... `);
      const issue = glabApi(`issues/${meta.issue}`);
      if (!issue) {
        console.log('(could not fetch — skipping)');
        continue;
      }
      if (issue.state === 'closed') {
        console.log(`closed ✓`);
        reason = `issue #${meta.issue} is closed`;
      } else {
        console.log(`still open (${issue.state}) — keeping`);
      }
    } else if (meta.mr) {
      process.stdout.write(`  !${meta.mr}  ${branch} — checking MR... `);
      const mr = glabApi(`merge_requests/${meta.mr}`);
      if (!mr) {
        console.log('(could not fetch — skipping)');
        continue;
      }
      if (mr.state === 'merged' || mr.state === 'closed') {
        console.log(`${mr.state} ✓`);
        reason = `MR !${meta.mr} is ${mr.state}`;
      } else {
        console.log(`still ${mr.state} — keeping`);
      }
    } else {
      console.log(`  ${branch} — no issue/MR linked, skipping`);
    }

    if (reason) {
      toRemove.push({ wt, meta, reason });
    }
  }

  if (toRemove.length === 0) {
    console.log('\nNothing to clean up.\n');
    return;
  }

  // ── Confirm and remove ──────────────────────────────────────────────────────

  console.log(`\nWorktrees to remove (${toRemove.length}):\n`);
  for (const { wt, reason } of toRemove) {
    console.log(`  ${wt.branch ?? '(detached)'}  —  ${reason}`);
    console.log(`    ${wt.path}`);
  }
  console.log();

  if (dryRun) {
    console.log('Dry run — nothing removed.\n');
    return;
  }

  if (!skipConfirm) {
    const answer = await confirm(`Remove ${toRemove.length} worktree(s)? [y/N] `);
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Aborted.\n');
      return;
    }
  }

  for (const { wt } of toRemove) {
    console.log(`\nRemoving: ${wt.path}`);

    if (!canRemoveDir(wt.path)) {
      console.warn(`  Skipped — directory is locked (Foundry or another process has files open).`);
      console.warn(`  Stop any running processes in ${wt.path} and re-run wt:cleanup.`);
      continue;
    }

    // Remove Foundry data dir
    const devEnvPath = join(wt.path, '.dev-env');
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

    // Remove junctions — use lstatSync so broken junctions are still detected
    // even when the target no longer exists (existsSync follows the link).
    for (const name of ['icons', '.foundrycache', 'node_modules', 'scratch']) {
      const p = join(wt.path, name);
      let stat;
      try { stat = lstatSync(p); } catch { continue; }
      if (stat.isSymbolicLink()) {
        try { rmSync(p, { recursive: false }); } catch { /* already gone */ }
      } else {
        rmSync(p, { recursive: true, force: true });
      }
    }

    // Remove worktree
    try {
      run(`git worktree remove "${wt.path}" --force`);
      console.log(`  Worktree removed.`);
    } catch {
      if (existsSync(wt.path)) rmSync(wt.path, { recursive: true, force: true });
      run('git worktree prune');
      console.log(`  Cleaned up manually.`);
    }

    // Delete local branch
    if (wt.branch) {
      try {
        run(`git branch -d "${wt.branch}"`);
        console.log(`  Deleted branch: ${wt.branch}`);
      } catch {
        // -d failed: branch has commits not reachable from HEAD (e.g. not yet pulled into master)
        if (skipConfirm) {
          try {
            run(`git branch -D "${wt.branch}"`);
            console.log(`  Force-deleted branch: ${wt.branch}`);
          } catch {
            console.warn(`  Could not force-delete branch '${wt.branch}'.`);
          }
        } else {
          const answer = await confirm(`  Branch '${wt.branch}' has unmerged local commits. Force-delete? [y/N] `);
          if (answer === 'y' || answer === 'yes') {
            try {
              run(`git branch -D "${wt.branch}"`);
              console.log(`  Force-deleted branch: ${wt.branch}`);
            } catch {
              console.warn(`  Could not force-delete branch '${wt.branch}'.`);
            }
          } else {
            console.log(`  Kept branch '${wt.branch}' — delete manually with: git branch -D "${wt.branch}"`);
          }
        }
      }
    }
  }

  console.log('\nDone.\n');
}

main().catch(err => {
  console.error(err.message);
  process.exitCode = 1;
});
