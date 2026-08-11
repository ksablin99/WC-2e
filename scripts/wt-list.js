/**
 * wt:list — list all git worktrees for this repo.
 *
 * Usage:  npm run wt:list
 *
 * Shows each worktree's path, branch, dev port, and linked issue/MR with PR state if any.
 * When finding an MR by branch, stores it in .wt-meta for faster future lookups.
 */

'use strict';

const { execSync } = require('child_process');
const { existsSync, readFileSync, writeFileSync } = require('fs');
const { resolve, join } = require('path');

const REPO_ROOT = resolve(__dirname, '..');
const GITLAB_PROJECT = 'dragonshorn%2FD35E';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT }).trim();
}

function glabApi(path) {
  try {
    const raw = run(`glab api "projects/${GITLAB_PROJECT}/${path}"`);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Parse `git worktree list --porcelain` ────────────────────────────────────

try { run('git fetch origin'); } catch { /* best-effort */ }

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

// ── Enrich with metadata ──────────────────────────────────────────────────────

for (const wt of worktrees) {
  // Read .wt-meta written by wt:create
  const metaPath = join(wt.path, '.wt-meta');
  if (existsSync(metaPath)) {
    try {
      wt.meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch { /* ignore */ }
  }

  // Read dev port from .dev-env
  const devEnvPath = join(wt.path, '.dev-env');
  if (existsSync(devEnvPath)) {
    const envLines = readFileSync(devEnvPath, 'utf8').split('\n');
    for (const line of envLines) {
      const [k, ...rest] = line.split('=');
      if (k?.trim() === 'DEV_PORT' && rest.length) {
        wt.devPort = rest.join('=').trim();
        break;
      }
    }
  }
  wt.devPort ??= wt.meta?.devPort ?? '—';
  wt.isMain = wt.path.replace(/\\/g, '/') === REPO_ROOT.replace(/\\/g, '/');
}

// ── Print ─────────────────────────────────────────────────────────────────────

console.log(`\n${colors.bright}Git worktrees (${worktrees.length}):${colors.reset}\n`);

for (const wt of worktrees) {
  const label = wt.isMain ? ` ${colors.green}[main]${colors.reset}` : '';
  const branch = wt.branch 
    ? `${colors.cyan}${wt.branch}${colors.reset}${label}`
    : (wt.detached 
      ? `${colors.dim}(detached ${wt.head?.slice(0, 8)})${colors.reset}${label}`
      : `${colors.dim}(bare)${colors.reset}${label}`);
  
  // Build issue/MR info with PR state
  let issue  = '';
  let mrInfo = '';
  
  if (wt.meta?.issue) {
    issue = `  ${colors.blue}issue #${wt.meta.issue}${colors.reset}`;
  }
  
  // First try .wt-meta.mr, then search by branch name
  let mr = null;
  let mrNum = wt.meta?.mr;
  
  if (mrNum) {
    mr = glabApi(`merge_requests/${mrNum}`);
  } else if (wt.meta?.branch) {
    // Search for MRs matching this branch
    const mrs = glabApi(`merge_requests?source_branch=${encodeURIComponent(wt.meta.branch)}&state=all`);
    if (Array.isArray(mrs) && mrs.length > 0) {
      mr = mrs[0];
      mrNum = mr.iid;
      
      // Store MR in .wt-meta for next time
      try {
        if (wt.meta) {
          wt.meta.mr = mrNum;
          const metaPath = join(wt.path, '.wt-meta');
          writeFileSync(metaPath, JSON.stringify(wt.meta, null, 2));
        }
      } catch { /* ignore write errors */ }
    }
  }
  
  if (mr) {
    const state = mr.state || 'unknown';
    let stateLabel = '?';
    let stateColor = colors.dim;
    if (state === 'merged') {
      stateLabel = '✓';
      stateColor = colors.green;
    } else if (state === 'opened') {
      stateLabel = '●';
      stateColor = colors.yellow;
    } else if (state === 'closed') {
      stateLabel = '✗';
      stateColor = colors.red;
    }
    mrInfo = `  ${colors.magenta}MR !${mrNum}${colors.reset} ${colors.bright}[${stateColor}${stateLabel}${colors.reset}${colors.bright} ${state}]${colors.reset}`;
  }
  
  const aiTool = wt.meta?.aiTool ? `  ${colors.gray}ai:${wt.meta.aiTool}${colors.reset}` : '';
  const port   = `  ${colors.dim}port${colors.reset} ${colors.bright}${wt.devPort}${colors.reset}`;

  console.log(`  ${branch}${issue}${mrInfo}${aiTool}${port}`);
  console.log(`    ${colors.dim}${wt.path}${colors.reset}`);

  const devEnvPath = join(wt.path, '.dev-env');
  const setupDone = existsSync(devEnvPath);
  if (!wt.isMain) {
    const setupStatus = setupDone 
      ? `${colors.green}done${colors.reset}`
      : `${colors.red}not run${colors.reset} — cd there and run npm run dev:setup`;
    console.log(`    dev:setup: ${setupStatus}`);
  }
  console.log();
}
