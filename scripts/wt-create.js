/**
 * wt:create — create a git worktree for an issue, MR, or branch name.
 *
 * Usage:
 *   npm run wt:create -- --issue 1234          # fetch issue title, create branch + worktree
 *   npm run wt:create -- --mr 456              # fetch MR source branch, create worktree
 *   npm run wt:create -- --branch my-feature   # create worktree on a new/existing branch
 *   npm run wt:create -- --branch my-feature --from origin/some-ref
 *
 * Options:
 *   --issue N        GitLab issue IID
 *   --mr N           GitLab MR IID
 *   --branch NAME    Explicit branch name (new or existing)
 *   --from REF       Base ref for new branch (default: origin/master)
 *   --no-setup       Skip npm install + dev:setup in the new worktree
 *
 * Worktrees are created as siblings of the main repo:
 *   E:/foundry/D35E  →  E:/foundry/D35E-<slug>
 *
 * Each worktree gets a unique dev port (31000–39999) derived from its path.
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const { existsSync, writeFileSync, mkdirSync, symlinkSync, rmSync, readFileSync } = require('fs');
const { resolve, join, dirname, basename } = require('path');
const { platform, tmpdir } = require('os');
const crypto = require('crypto');
const { applyTerminalColor, buildSwitchCommand, copyToClipboard, allocateWorktreeColor } = require('./lib/wt-colors');

const REPO_ROOT = resolve(__dirname, '..');
const GITLAB_PROJECT = 'dragonshorn%2FD35E';

// ── Parse args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

// Extract a number from either a bare number ("1234") or a GitLab URL
// e.g. https://gitlab.com/dragonshorn/D35E/-/issues/1234
//      https://gitlab.com/dragonshorn/D35E/-/merge_requests/456
function parseRef(value) {
  if (!value) return null;
  const urlMatch = value.match(/\/(\d+)\/?(?:[?#].*)?$/);
  return urlMatch ? urlMatch[1] : value;
}

// Also accept a bare URL as the first positional arg (no --issue/--mr flag needed)
// e.g.  npm run wt:create -- https://gitlab.com/.../issues/1234
function inferFromUrl(url) {
  if (!url || url.startsWith('--')) return {};
  if (/\/(issues|work_items)\/\d+/.test(url))  return { issue: url };
  if (/\/merge_requests\/\d+/.test(url))        return { mr: url };
  return {};
}

const positional = args.find(a => !a.startsWith('--') && args.indexOf(a) === args.findIndex(x => x === a));
const inferred   = inferFromUrl(positional);

const issueN    = parseRef(getArg('--issue') ?? inferred.issue ?? null);
const mrN       = parseRef(getArg('--mr')    ?? inferred.mr    ?? null);
const branchArg = getArg('--branch');
const fromRef   = getArg('--from') ?? 'origin/master';
const noSetup   = args.includes('--no-setup');

// --ai [claude|copilot|agent]  — optional tool name, defaults to "claude"
const AI_TOOLS = {
  claude:  { cmd: 'claude',   args: [] },
  copilot: { cmd: 'copilot',  args: [] },
  agent:   { cmd: 'gh',       args: ['copilot', 'agent'] },
};
const aiIdx = args.indexOf('--ai');
let aiTool = null;
if (aiIdx !== -1) {
  const next = args[aiIdx + 1];
  const name = (next && !next.startsWith('--')) ? next : 'claude';
  if (!AI_TOOLS[name]) {
    console.error(`[wt:create] Unknown --ai tool '${name}'. Valid options: ${Object.keys(AI_TOOLS).join(', ')}`);
    process.exit(1);
  }
  aiTool = { name, ...AI_TOOLS[name] };
}

if (!issueN && !mrN && !branchArg) {
  console.error('Usage:');
  console.error('  npm run wt:create -- --issue 1234 [--ai [claude|copilot|agent]]');
  console.error('  npm run wt:create -- --mr 456 [--ai [claude|copilot|agent]]');
  console.error('  npm run wt:create -- --branch my-feature [--from origin/master] [--ai [claude|copilot|agent]]');
  console.error('  npm run wt:create -- https://gitlab.com/dragonshorn/D35E/-/work_items/1234');
  console.error('  npm run wt:create -- https://gitlab.com/dragonshorn/D35E/-/merge_requests/456');
  console.error('');
  console.error('  --ai [claude|copilot|agent]   launch an AI CLI in the worktree after setup (default: claude)');
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT, ...opts }).trim();
}

function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function glabApi(path) {
  const raw = run(`glab api "projects/${GITLAB_PROJECT}/${path}"`);
  return JSON.parse(raw);
}

function deriveWorktreeIds(worktreePath) {
  const hash = crypto.createHash('sha1').update(worktreePath).digest('hex').slice(0, 8);
  const port    = 31000 + (parseInt(hash, 16) % 9000);
  const dataDir = join(tmpdir(), `foundry-dev-${hash}`);
  return { port, dataDir, hash };
}

// ── Resolve branch + slug ─────────────────────────────────────────────────────

let branchName, worktreeSlug, isExistingBranch = false;

if (issueN) {
  console.log(`[wt:create] Fetching issue #${issueN} from GitLab...`);
  const issue = glabApi(`issues/${issueN}`);
  const slug = slugify(issue.title);
  branchName = `issue-${issueN}-${slug}`;
  worktreeSlug = branchName;
  console.log(`[wt:create] Issue: ${issue.title}`);
  console.log(`[wt:create] Branch: ${branchName}`);
} else if (mrN) {
  console.log(`[wt:create] Fetching MR !${mrN} from GitLab...`);
  const mr = glabApi(`merge_requests/${mrN}`);
  branchName = mr.source_branch;
  worktreeSlug = `mr-${mrN}-${slugify(mr.title)}`;
  isExistingBranch = true;
  console.log(`[wt:create] MR: ${mr.title}`);
  console.log(`[wt:create] Branch: ${branchName}`);
} else {
  branchName = branchArg;
  worktreeSlug = slugify(branchArg);
  // Check if branch exists locally or remotely
  const localBranches = run('git branch --list').split('\n').map(b => b.replace(/^\*?\s+/, ''));
  const remoteBranches = run('git branch -r --list').split('\n').map(b => b.trim());
  if (localBranches.includes(branchName) || remoteBranches.some(b => b.endsWith('/' + branchName))) {
    isExistingBranch = true;
  }
}

// ── Determine worktree path ───────────────────────────────────────────────────

const parentDir = dirname(REPO_ROOT);
const repoBasename = basename(REPO_ROOT);
const worktreePath = join(parentDir, `${repoBasename}-${worktreeSlug}`);

if (existsSync(worktreePath)) {
  console.error(`[wt:create] Path already exists: ${worktreePath}`);
  console.error('  Remove it first with: npm run wt:remove');
  process.exit(1);
}

const { port: devPort, dataDir: devDataDir } = deriveWorktreeIds(worktreePath);

// ── Create the branch and worktree ────────────────────────────────────────────

// Also check if branch already exists locally (e.g. previously created for this issue)
if (!isExistingBranch) {
  const localBranches = run('git branch --list').split('\n').map(b => b.replace(/^\*?\s+/, '').trim()).filter(Boolean);
  if (localBranches.includes(branchName)) {
    console.log(`[wt:create] Branch '${branchName}' already exists locally — using it.`);
    isExistingBranch = true;
  }
}

if (isExistingBranch) {
  // Fetch first to ensure we have the latest
  if (mrN) {
    console.log(`[wt:create] Fetching branch from origin...`);
    try { run(`git fetch origin "${branchName}:${branchName}"`); } catch { /* may not be on remote yet */ }
  }
  console.log(`[wt:create] Creating worktree on existing branch '${branchName}'...`);
  run(`git worktree add "${worktreePath}" "${branchName}"`);
} else {
  // Fetch the base ref first
  console.log(`[wt:create] Fetching ${fromRef}...`);
  try { run(`git fetch origin`); } catch { /* best-effort */ }
  console.log(`[wt:create] Creating worktree with new branch '${branchName}' from ${fromRef}...`);
  run(`git worktree add -b "${branchName}" "${worktreePath}" "${fromRef}"`);
}

console.log(`[wt:create] Worktree created at: ${worktreePath}`);

// ── Write .wt-meta (tracks issue/MR for wt:list) ─────────────────────────────

const meta = {
  issue: issueN ?? null,
  mr: mrN ?? null,
  branch: branchName,
  devPort,
  devDataDir,
  terminalColor: allocateWorktreeColor(REPO_ROOT),
  createdAt: new Date().toISOString(),
};
writeFileSync(join(worktreePath, '.wt-meta'), JSON.stringify(meta, null, 2));

// ── Write .foundry-version ───────────────────────────────────────────────────

writeFileSync(join(worktreePath, '.foundry-version'), '14\n');

// ── Link read-only gitignored assets from main repo ──────────────────────────
//
// icons/        — 4000+ static image files, never modified at runtime
// .foundrycache — Foundry source cache; dev-setup.js walks up to find it,
//                 but worktrees are siblings of the main repo so the walk-up
//                 won't reach it. A junction here fixes that transparently.

function linkFromMain(name, { optional = false } = {}) {
  const target = join(worktreePath, name);
  const source = join(REPO_ROOT, name);
  if (existsSync(target)) return; // already there (e.g. tracked file)
  if (!existsSync(source)) {
    if (!optional) console.warn(`[wt:create] WARNING: ${name} not found in main repo.`);
    return;
  }
  const linkType = platform() === 'win32' ? 'junction' : 'dir';
  symlinkSync(source, target, linkType);
  console.log(`[wt:create] Linked ${name}/ → ${source}`);
}

linkFromMain('icons');
linkFromMain('.foundrycache', { optional: true });
linkFromMain('scratch', { optional: true });

// ── node_modules: junction if package.json is identical, else npm install ─────
//
// Junctioning avoids reinstalling native modules (which can fail on Windows).
// It is safe only when package.json hasn't changed on this branch.
// If it has changed, or if main repo has no node_modules, run a real install.

if (!noSetup) {
  const mainNodeModules = join(REPO_ROOT, 'node_modules');
  const wtNodeModules   = join(worktreePath, 'node_modules');
  const mainPkg = join(REPO_ROOT, 'package.json');
  const wtPkg   = join(worktreePath, 'package.json');

  function depsOnly(pkgPath) {
    try {
      const p = JSON.parse(readFileSync(pkgPath, 'utf8'));
      return JSON.stringify({ dependencies: p.dependencies ?? {}, devDependencies: p.devDependencies ?? {} });
    } catch { return null; }
  }
  const pkgIdentical =
    existsSync(mainPkg) &&
    existsSync(wtPkg) &&
    depsOnly(mainPkg) === depsOnly(wtPkg);

  if (pkgIdentical && existsSync(mainNodeModules) && !existsSync(wtNodeModules)) {
    const linkType = platform() === 'win32' ? 'junction' : 'dir';
    symlinkSync(mainNodeModules, wtNodeModules, linkType);
    console.log('[wt:create] Linked node_modules/ → main repo (package.json is identical).');
  } else if (!existsSync(wtNodeModules)) {
    if (!existsSync(mainNodeModules)) {
      console.log('[wt:create] Main repo has no node_modules — running npm install...');
    } else {
      console.log('[wt:create] package.json differs from main repo — running npm install...');
    }
    // --ignore-scripts skips node-gyp-build postinstall (classic-level uses
    // prebuilt binaries at runtime anyway, so the rebuild is not needed).
    const npmInstall = spawnSync('npm', ['install', '--ignore-scripts'], {
      cwd: worktreePath,
      stdio: 'inherit',
      shell: true,
    });
    if (npmInstall.status !== 0) {
      console.warn('[wt:create] npm install failed. Fix it manually: cd worktree && npm install --ignore-scripts');
    }
  } else {
    console.log('[wt:create] node_modules/ already exists — skipping.');
  }

  // packs/ is gitignored — build from source/ (which IS tracked per branch).
  console.log('\n[wt:create] Building packs from source (npm run sources:repack)...');
  const repack = spawnSync('npm', ['run', 'sources:repack'], {
    cwd: worktreePath,
    stdio: 'inherit',
    shell: true,
  });
  if (repack.status !== 0) {
    console.warn('[wt:create] sources:repack failed — packs may be missing. Run manually: npm run sources:repack');
  }

  console.log(`\n[wt:create] Running dev:setup (port ${devPort})...`);
  const devSetup = spawnSync('npm', ['run', 'dev:setup'], {
    cwd: worktreePath,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DEV_PORT: String(devPort), DEV_DATA_DIR: devDataDir },
  });
  if (devSetup.status !== 0) {
    console.warn('[wt:create] dev:setup failed — you may need to run it manually.');
  }
}

// ── Done ──────────────────────────────────────────────────────────────────────

const switchCommand = buildSwitchCommand(worktreePath);
const copied = copyToClipboard(switchCommand);

console.log(`
[wt:create] Done!

  Path:    ${worktreePath}
  Branch:  ${branchName}
  Port:    ${devPort}
  DataDir: ${devDataDir}
  Color:   ${meta.terminalColor}

Next steps:
  ${switchCommand}${copied ? '  ← copied to clipboard' : ''}
  npm run dev:start         # start Foundry on port ${devPort}
  claude                    # open Claude Code in this worktree
`);

// ── Launch AI CLI in the worktree ─────────────────────────────────────────────

if (aiTool) {
  console.log(`[wt:create] Launching ${aiTool.name} in the worktree...\n`);
  applyTerminalColor(worktreePath, meta);
  spawnSync(aiTool.cmd, aiTool.args, {
    cwd: worktreePath,
    stdio: 'inherit',
    shell: true,
  });
}
