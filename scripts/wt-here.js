/**
 * wt:here — apply worktree-local terminal setup and display current context.
 *
 * Usage:
 *   npm run wt:here
 *
 * Shows:
 *   - Terminal color theme
 *   - Associated issue (if any) with link
 *   - Associated MR (if any) with state and link
 *   - Active AI tool (if set)
 */

'use strict';

const { resolve, join } = require('path');
const { existsSync, readFileSync } = require('fs');
const { execSync } = require('child_process');
const { applyTerminalColor, writeVSCodeWorkspaceSettings } = require('./lib/wt-colors');

const repoRoot = resolve(__dirname, '..');
const GITLAB_PROJECT = 'dragonshorn%2FD35E';

// ANSI colors (consistent with wt-list.js)
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

writeVSCodeWorkspaceSettings(repoRoot);
applyTerminalColor(repoRoot);

// ── Read metadata and display context ──────────────────────────────────────────

const metaPath = join(repoRoot, '.wt-meta');
if (!existsSync(metaPath)) {
  console.log(`\n${colors.green}✓${colors.reset} Terminal configured (main repo).\n`);
  process.exit(0);
}

let meta = {};
try {
  meta = JSON.parse(readFileSync(metaPath, 'utf8'));
} catch { /* ignore */ }

if (!meta.issue && !meta.mr && !meta.aiTool) {
  console.log(`\n${colors.green}✓${colors.reset} Terminal configured.\n`);
  process.exit(0);
}

// Fetch MR info if needed
let mrInfo = null;
let mrNum = meta.mr;
if (!mrNum && meta.branch) {
  try {
    const raw = execSync(`glab api "projects/${GITLAB_PROJECT}/merge_requests?source_branch=${encodeURIComponent(meta.branch)}&state=all"`, {
      encoding: 'utf8',
      cwd: repoRoot,
    });
    const mrs = JSON.parse(raw);
    if (Array.isArray(mrs) && mrs.length > 0) {
      mrInfo = mrs[0];
      mrNum = mrInfo.iid;
    }
  } catch { /* ignore */ }
}

if (mrNum && !mrInfo) {
  try {
    const raw = execSync(`glab api "projects/${GITLAB_PROJECT}/merge_requests/${mrNum}"`, {
      encoding: 'utf8',
      cwd: repoRoot,
    });
    mrInfo = JSON.parse(raw);
  } catch { /* ignore */ }
}

// Display context with consistent styling
console.log(`\n${colors.bright}${colors.cyan}───${colors.reset} ${colors.bright}Worktree Context${colors.reset} ${colors.bright}${colors.cyan}───${colors.reset}\n`);

if (meta.issue) {
  console.log(`  ${colors.blue}issue${colors.reset}   #${colors.bright}${meta.issue}${colors.reset}`);
  console.log(`  ${colors.gray}${`https://gitlab.com/dragonshorn/D35E/-/issues/${meta.issue}`.padEnd(50)}${colors.reset}\n`);
}

if (mrInfo) {
  const state = mrInfo.state || 'unknown';
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
  console.log(`  ${colors.magenta}mr${colors.reset}      !${colors.bright}${mrNum}${colors.reset} ${colors.bright}[${stateColor}${stateLabel}${colors.reset}${colors.bright} ${state}]${colors.reset}`);
  console.log(`  ${colors.gray}${(mrInfo.web_url || `https://gitlab.com/dragonshorn/D35E/-/merge_requests/${mrNum}`).padEnd(50)}${colors.reset}\n`);
}

if (meta.aiTool) {
  const toolLabels = { claude: 'Claude', copilot: 'GitHub Copilot CLI', codex: 'Codex' };
  const toolLabel = toolLabels[meta.aiTool] || meta.aiTool;
  console.log(`  ${colors.gray}ai${colors.reset}       ${colors.bright}${toolLabel}${colors.reset}\n`);
}

console.log(`${colors.bright}${colors.cyan}───────────────────────────────────────────${colors.reset}\n`);

