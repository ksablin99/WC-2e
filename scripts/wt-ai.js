/**
 * wt:ai — Launch an AI CLI tool in the current worktree and remember it.
 *
 * Usage:
 *   npm run wt:ai -- claude      # launch Claude Code
 *   npm run wt:ai -- copilot     # launch GitHub Copilot CLI
 *   npm run wt:ai -- codex       # launch Codex (local copilot)
 *   npm run wt:ai -- cursor      # launch Cursor agent CLI (agent binary)
 *   npm run wt:ai -- opencode    # launch OpenCode
 *   npm run wt:ai                # launch last used tool, or claude as default
 *
 * Stores the tool name in .wt-meta so wt:list and wt:here display it.
 */

'use strict';

const { spawnSync } = require('child_process');
const { existsSync, readFileSync, writeFileSync } = require('fs');
const { resolve, join } = require('path');

const REPO_ROOT = resolve(__dirname, '..');

// Parse args
const args = process.argv.slice(2);
let toolName = args[0]?.toLowerCase();

// Detect whether a binary exists in PATH
function detectBinary(cmd) {
  const check = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { shell: true });
  return check.status === 0;
}

// Validate tool name
const VALID_TOOLS = {
  claude:   { cmd: 'claude',   label: 'Claude Code' },
  copilot:  { cmd: 'copilot',  label: 'GitHub Copilot CLI' },
  codex:    { cmd: 'codex',    label: 'Codex' },
  cursor:   { cmd: 'agent',    label: 'Cursor (agent)' },
  opencode: { cmd: 'opencode', label: 'OpenCode' },
};

// If no tool specified, try to read from .wt-meta or default to claude
if (!toolName) {
  const metaPath = join(REPO_ROOT, '.wt-meta');
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      toolName = meta.aiTool ?? 'claude';
    } catch { /* ignore */ }
  }
  toolName ??= 'claude';
  console.log(`[wt:ai] No tool specified, using last session tool: ${toolName}`);
}

if (!VALID_TOOLS[toolName]) {
  console.error(`[wt:ai] Unknown tool: ${toolName}`);
  console.error(`Valid options: ${Object.keys(VALID_TOOLS).join(', ')}`);
  process.exit(1);
}

const tool = VALID_TOOLS[toolName];

// Update .wt-meta with the selected tool
const metaPath = join(REPO_ROOT, '.wt-meta');
let meta = { aiTool: toolName };
if (existsSync(metaPath)) {
  try {
    meta = { ...JSON.parse(readFileSync(metaPath, 'utf8')), aiTool: toolName };
  } catch { /* ignore */ }
}
writeFileSync(metaPath, JSON.stringify(meta, null, 2));

// Detect binary availability
if (!detectBinary(tool.cmd)) {
  console.error(`[wt:ai] ${tool.label} binary '${tool.cmd}' not found in PATH.`);
  process.exit(1);
}

console.log(`[wt:ai] Launching ${tool.label}...\n`);

// Launch the tool
spawnSync(tool.cmd, [], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  shell: true,
});
