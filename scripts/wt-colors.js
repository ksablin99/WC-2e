/**
 * wt:colors — inspect, apply, or change the saved terminal color for a worktree.
 *
 * Usage:
 *   npm run wt:colors -- --show
 *   npm run wt:colors -- --apply
 *   npm run wt:colors -- --random
 *   npm run wt:colors -- --set '#3B82F6'
 *   npm run wt:colors -- --print-hook bash|zsh|pwsh
 */

'use strict';

const { resolve } = require('path');
const {
  applyTerminalColor,
  buildResetSequences,
  ensureWorktreeColor,
  normalizeColorHex,
  randomColorHex,
  readWorktreeMeta,
  writeWorktreeMeta,
} = require('./lib/wt-colors');

const REPO_ROOT = resolve(__dirname, '..');
const args = process.argv.slice(2);

function getArg(flag) {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : null;
}

const cwdArg = getArg('--cwd');
const worktreePath = resolve(cwdArg ?? process.cwd());
const wantsApply = args.includes('--apply');
const wantsShow = args.includes('--show') || (!wantsApply && args.length === 0);
const wantsRandom = args.includes('--random');
const wantsReset = args.includes('--reset');
const setValue = getArg('--set');
const hookShell = getArg('--print-hook');

function printPwshHook() {
  console.log([
    '$global:__d35eWtColorsLastPwd = $null',
    '$global:__d35eWtColorsActive = $false',
    'function Find-D35EWorktreeScript {',
    '  param([string]$StartPath)',
    '  $dir = $StartPath',
    '  while ($dir) {',
    "    $candidate = Join-Path $dir 'scripts/wt-colors.js'",
    '    if (Test-Path $candidate) { return $candidate }',
    '    $parent = Split-Path $dir -Parent',
    '    if (-not $parent -or $parent -eq $dir) { break }',
    '    $dir = $parent',
    '  }',
    '  return $null',
    '}',
    'function Reset-D35EWorktreeColors {',
    "  $leaf = Split-Path (Get-Location).Path -Leaf",
    '  Write-Host -NoNewline "`e]0;$leaf · D35E`a"',
    "  if ($env:TERM_PROGRAM -eq 'iTerm.app') {",
    '    Write-Host -NoNewline "`e]1337;SetColors=tab=default`a`e]6;1;bg;*;default`a"',
    '  }',
    '}',
    'function Invoke-D35EWorktreeColors {',
    '  $pwdPath = (Get-Location).Path',
    '  if ($pwdPath -eq $global:__d35eWtColorsLastPwd) { return }',
    '  $global:__d35eWtColorsLastPwd = $pwdPath',
    '  $script = Find-D35EWorktreeScript $pwdPath',
    '  if ($script) {',
    '    node $script --apply --cwd $pwdPath | Out-Host',
    '    $global:__d35eWtColorsActive = $true',
    '    return',
    '  }',
    '  if ($global:__d35eWtColorsActive) {',
    '    Reset-D35EWorktreeColors',
    '    $global:__d35eWtColorsActive = $false',
    '  }',
    '}',
    'Invoke-D35EWorktreeColors',
    '$global:__d35eOriginalPrompt = $function:prompt',
    'function global:prompt {',
    '  Invoke-D35EWorktreeColors',
    '  & $global:__d35eOriginalPrompt',
    '}',
  ].join('\n'));
}

function printPosixHook(shellName) {
  console.log([
    '__d35e_wt_colors_last_pwd=""',
    '__d35e_wt_colors_active=0',
    '__d35e_find_wt_colors_script() {',
    '  local dir="$PWD"',
    '  while [ -n "$dir" ] && [ "$dir" != "/" ]; do',
    '    if [ -f "$dir/scripts/wt-colors.js" ]; then',
    '      printf "%s\\n" "$dir/scripts/wt-colors.js"',
    '      return 0',
    '    fi',
    '    dir="$(dirname "$dir")"',
    '  done',
    '  return 1',
    '}',
    '__d35e_reset_wt_colors() {',
    '  printf "\\033]0;%s · D35E\\007" "${PWD##*/}"',
    '  if [ "${TERM_PROGRAM:-}" = "iTerm.app" ]; then',
    '    printf "\\033]1337;SetColors=tab=default\\007\\033]6;1;bg;*;default\\007"',
    '  fi',
    '}',
    '__d35e_worktree_colors() {',
    '  if [ "$PWD" = "$__d35e_wt_colors_last_pwd" ]; then',
    '    return',
    '  fi',
    '  __d35e_wt_colors_last_pwd="$PWD"',
    '  local script',
    '  script="$(__d35e_find_wt_colors_script)" || script=""',
    '  if [ -n "$script" ]; then',
    '    node "$script" --apply --cwd "$PWD"',
    '    __d35e_wt_colors_active=1',
    '    return',
    '  fi',
    '  if [ "$__d35e_wt_colors_active" -eq 1 ]; then',
    '    __d35e_reset_wt_colors',
    '    __d35e_wt_colors_active=0',
    '  fi',
    '}',
    '__d35e_worktree_colors',
    shellName === 'zsh'
      ? "autoload -Uz add-zsh-hook && add-zsh-hook chpwd __d35e_worktree_colors && add-zsh-hook precmd __d35e_worktree_colors"
      : "PROMPT_COMMAND=\"__d35e_worktree_colors${PROMPT_COMMAND:+;$PROMPT_COMMAND}\"",
  ].join('\n'));
}

function usageAndExit(message = null, code = 0) {
  if (message) console.error(message);
  console.error('Usage: npm run wt:colors -- [--show|--apply|--random|--set #RRGGBB|--reset|--print-hook bash|zsh|pwsh]');
  process.exit(code);
}

if (hookShell) {
  if (!['bash', 'zsh', 'pwsh'].includes(hookShell)) {
    usageAndExit(`[wt:colors] Unsupported shell '${hookShell}'.`, 1);
  }

  if (hookShell === 'pwsh') printPwshHook();
  else printPosixHook(hookShell);
  process.exit(0);
}

if (wantsReset) {
  process.stdout.write(buildResetSequences(worktreePath).sequences.join(''));
  if (!wantsApply && !wantsShow && !wantsRandom && !setValue) process.exit(0);
}

let meta = readWorktreeMeta(worktreePath);
if (wantsRandom) {
  meta = { ...meta, terminalColor: randomColorHex() };
  writeWorktreeMeta(worktreePath, meta);
}

if (setValue) {
  const normalized = normalizeColorHex(setValue);
  if (!normalized) usageAndExit(`[wt:colors] Invalid color '${setValue}'.`, 1);
  meta = { ...meta, terminalColor: normalized };
  writeWorktreeMeta(worktreePath, meta);
}

const info = wantsApply ? applyTerminalColor(worktreePath, meta) : ensureWorktreeColor(worktreePath, meta);

if (wantsShow) {
  const label = info.meta.branch || worktreePath;
  console.error(`[wt:colors] ${label}`);
  console.error(`[wt:colors] Color: ${info.color}`);
  console.error(`[wt:colors] Apply now: node ${resolve(REPO_ROOT, 'scripts', 'wt-colors.js')} --apply --cwd "${worktreePath}"`);
}
