/**
 * wt:home — print (and copy) the cd command to return to the main worktree.
 *
 * Usage:  npm run wt:home
 *
 * Prints the path of the main worktree and copies "cd <path>" to the clipboard.
 * Useful when you're inside a worktree and want to get back quickly.
 */

'use strict';

const { execSync } = require('child_process');
const { resolve } = require('path');
const { buildSwitchCommand, copyToClipboard } = require('./lib/wt-colors');

const REPO_ROOT = resolve(__dirname, '..');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', cwd: REPO_ROOT }).trim();
}

// Find the main worktree (first entry in `git worktree list`)
const raw = run('git worktree list --porcelain');
const lines = raw.split('\n');
const mainPath = lines.find(l => l.startsWith('worktree '))?.slice(9);

if (!mainPath) {
  console.error('Could not determine main worktree path.');
  process.exit(1);
}

const cdCommand = buildSwitchCommand(mainPath);
const copied = copyToClipboard(cdCommand);

console.log(`\nMain worktree: ${mainPath}\n`);
console.log(`  ${cdCommand}${copied ? '  ← copied to clipboard' : ''}\n`);
