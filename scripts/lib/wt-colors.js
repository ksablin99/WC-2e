'use strict';

const crypto = require('crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const { basename, join } = require('path');
const { platform } = require('os');
const { spawnSync } = require('child_process');

function readWorktreeMeta(worktreePath) {
  const metaPath = join(worktreePath, '.wt-meta');
  if (!existsSync(metaPath)) return {};
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeWorktreeMeta(worktreePath, meta) {
  writeFileSync(join(worktreePath, '.wt-meta'), JSON.stringify(meta, null, 2));
}

function normalizeColorHex(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    const expanded = hex.split('').map(ch => ch + ch).join('');
    return `#${expanded.toUpperCase()}`;
  }
  return null;
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const sector = hue / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (sector >= 0 && sector < 1) [r1, g1, b1] = [chroma, x, 0];
  else if (sector < 2) [r1, g1, b1] = [x, chroma, 0];
  else if (sector < 3) [r1, g1, b1] = [0, chroma, x];
  else if (sector < 4) [r1, g1, b1] = [0, x, chroma];
  else if (sector < 5) [r1, g1, b1] = [x, 0, chroma];
  else [r1, g1, b1] = [chroma, 0, x];

  const match = light - chroma / 2;
  const toHex = value => Math.round((value + match) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`.toUpperCase();
}

function randomColorHex() {
  const hue = crypto.randomInt(0, 360);
  const saturation = crypto.randomInt(58, 82);
  const lightness = crypto.randomInt(42, 58);
  return hslToHex(hue, saturation, lightness);
}

function getWorktreeLabel(worktreePath, meta = {}) {
  if (meta.branch) return meta.branch;
  return basename(worktreePath);
}

function ensureWorktreeColor(worktreePath, meta = null) {
  const currentMeta = meta ?? readWorktreeMeta(worktreePath);
  const existing = normalizeColorHex(currentMeta.terminalColor ?? currentMeta.color);
  if (existing) {
    if (currentMeta.terminalColor !== existing) {
      currentMeta.terminalColor = existing;
      delete currentMeta.color;
      writeWorktreeMeta(worktreePath, currentMeta);
    }
    return { meta: currentMeta, color: existing };
  }

  const color = randomColorHex();
  const nextMeta = { ...currentMeta, terminalColor: color };
  delete nextMeta.color;
  writeWorktreeMeta(worktreePath, nextMeta);
  return { meta: nextMeta, color };
}

function getRgb(color) {
  const normalized = normalizeColorHex(color);
  if (!normalized) return null;
  return {
    red: parseInt(normalized.slice(1, 3), 16),
    green: parseInt(normalized.slice(3, 5), 16),
    blue: parseInt(normalized.slice(5, 7), 16),
  };
}

function mixColors(baseColor, mixColor, ratio) {
  const base = getRgb(baseColor);
  const mix = getRgb(mixColor);
  if (!base || !mix) return normalizeColorHex(baseColor);
  const blend = (a, b) => Math.round((a * (1 - ratio)) + (b * ratio));
  const toHex = value => value.toString(16).padStart(2, '0');
  return `#${toHex(blend(base.red, mix.red))}${toHex(blend(base.green, mix.green))}${toHex(blend(base.blue, mix.blue))}`.toUpperCase();
}

function getRelativeLuminance(color) {
  const rgb = getRgb(color);
  if (!rgb) return 0;
  const linearize = channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const red = linearize(rgb.red);
  const green = linearize(rgb.green);
  const blue = linearize(rgb.blue);
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function pickReadableForeground(backgroundColor) {
  return getRelativeLuminance(backgroundColor) > 0.42 ? '#111111' : '#FFFFFF';
}

function osc(code, value) {
  return `\u001b]${code};${value}\u0007`;
}

function csi(value) {
  return `\u001b[${value}`;
}

const ANSI_16_PALETTE = [
  '#000000',
  '#800000',
  '#008000',
  '#808000',
  '#000080',
  '#800080',
  '#008080',
  '#C0C0C0',
  '#808080',
  '#FF0000',
  '#00FF00',
  '#FFFF00',
  '#0000FF',
  '#FF00FF',
  '#00FFFF',
  '#FFFFFF',
];

function colorDistanceSq(a, b) {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const dr = ar - br;
  const dg = ag - bg;
  const db = ab - bb;
  return (dr * dr) + (dg * dg) + (db * db);
}

function getAnsi16Index(color) {
  const normalized = normalizeColorHex(color);
  if (!normalized) return 0;

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ANSI_16_PALETTE.length; index += 1) {
    const distance = colorDistanceSq(normalized, ANSI_16_PALETTE[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/**
 * Get all active worktree colors by scanning the repo for .wt-meta files.
 * Requires repoRoot to find worktree parent directory.
 */
function getUsedWorktreeColors(repoRoot) {
  const { execSync } = require('child_process');
  const fs = require('fs');

  const used = new Set();
  try {
    // List all git worktrees
    const raw = execSync('git worktree list --porcelain', { cwd: repoRoot, encoding: 'utf8' });
    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        const wtPath = line.slice(9);
        const metaPath = join(wtPath, '.wt-meta');
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (meta.terminalColor) {
              // Map the color to its closest ANSI_16 index for deduplication
              const index = getAnsi16Index(meta.terminalColor);
              used.add(index);
            }
          } catch { /* skip */ }
        }
      }
    }
  } catch { /* git may fail if not in a repo */ }
  return used;
}

/**
 * Allocate a color from the standard ANSI_16_PALETTE for a worktree.
 * Ensures no duplicate colors until all 16 are exhausted.
 */
function allocateWorktreeColor(repoRoot) {
  const usedIndices = getUsedWorktreeColors(repoRoot);

  // Find first unused color in palette
  for (let i = 0; i < ANSI_16_PALETTE.length; i += 1) {
    if (!usedIndices.has(i)) {
      return ANSI_16_PALETTE[i];
    }
  }

  // All 16 colors exhausted, fall back to random
  return randomColorHex();
}

function buildApplySequences(worktreePath, meta = null) {
  const { meta: currentMeta, color } = ensureWorktreeColor(worktreePath, meta);
  const title = `${getWorktreeLabel(worktreePath, currentMeta)} · D35E`;
  const sequences = [osc('0', title)];

  if (platform() === 'win32') {
    // DECAC: assign color for the active tab/window frame in Windows Terminal.
    sequences.push(csi(`2;15;${getAnsi16Index(color)},|`));
  }

  if (process.env.TERM_PROGRAM === 'iTerm.app') {
    const rgb = getRgb(color);
    sequences.push(osc('1337', `SetColors=tab=${color.slice(1)}`));
    sequences.push(osc('6;1;bg;red;brightness', String(rgb.red)));
    sequences.push(osc('6;1;bg;green;brightness', String(rgb.green)));
    sequences.push(osc('6;1;bg;blue;brightness', String(rgb.blue)));
  }

  return { meta: currentMeta, color, title, sequences };
}

function buildResetSequences(worktreePath) {
  const title = `${basename(worktreePath)} · D35E`;
  const sequences = [osc('0', title)];

  if (platform() === 'win32') {
    // Neutral-ish default when leaving a worktree-managed directory.
    sequences.push(csi('2;15;0,|'));
  }

  if (process.env.TERM_PROGRAM === 'iTerm.app') {
    sequences.push(osc('1337', 'SetColors=tab=default'));
    sequences.push('\u001b]6;1;bg;*;default\u0007');
  }

  return { title, sequences };
}

function applyTerminalColor(worktreePath, meta = null, stream = process.stdout) {
  const info = buildApplySequences(worktreePath, meta);
  stream.write(info.sequences.join(''));
  return info;
}

function resetTerminalColor(worktreePath, stream = process.stdout) {
  const info = buildResetSequences(worktreePath);
  stream.write(info.sequences.join(''));
  return info;
}

function detectShellFlavor() {
  const shell = (process.env.SHELL || '').toLowerCase();
  if (process.platform === 'win32' || process.env.PSModulePath || process.env.PSExecutionPolicyPreference) return 'pwsh';
  if (shell.endsWith('/zsh')) return 'zsh';
  if (shell.endsWith('/bash')) return 'bash';
  return 'sh';
}

function shellQuotePosix(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function shellQuotePwsh(value) {
  return `'${String(value).replace(/'/g, `''`)}'`;
}

function buildSwitchCommand(worktreePath, shellFlavor = detectShellFlavor()) {
  if (shellFlavor === 'pwsh') {
    return `cd ${shellQuotePwsh(worktreePath)}; npm run --silent wt:here`;
  }
  return `cd ${shellQuotePosix(worktreePath)} && npm run --silent wt:here`;
}

function copyToClipboard(text) {
  try {
    if (platform() === 'win32') {
      spawnSync('clip', [], { input: text, shell: true });
    } else if (platform() === 'darwin') {
      spawnSync('pbcopy', [], { input: text });
    } else {
      const xclip = spawnSync('xclip', ['-selection', 'clipboard'], { input: text });
      if (xclip.status !== 0) {
        spawnSync('xsel', ['--clipboard', '--input'], { input: text });
      }
    }
    return true;
  } catch {
    return false;
  }
}

function readJsonFile(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

const MANAGED_VSCODE_COLOR_KEYS = [
  'titleBar.activeBackground',
  'titleBar.activeForeground',
  'titleBar.inactiveBackground',
  'titleBar.inactiveForeground',
  'titleBar.border',
  'commandCenter.background',
  'commandCenter.foreground',
  'commandCenter.activeBackground',
  'commandCenter.activeForeground',
  'commandCenter.activeBorder',
  'commandCenter.border',
  'commandCenter.inactiveForeground',
  'commandCenter.inactiveBorder',
  'activityBar.background',
  'activityBar.foreground',
  'statusBar.background',
  'statusBar.foreground',
];

function omitManagedVSCodeColors(colorCustomizations = {}) {
  const next = { ...colorCustomizations };
  for (const key of MANAGED_VSCODE_COLOR_KEYS) {
    delete next[key];
  }
  return next;
}

function writeVSCodeWorkspaceSettings(worktreePath, meta = null) {
  const { meta: currentMeta, color } = ensureWorktreeColor(worktreePath, meta);
  const vscodeDir = join(worktreePath, '.vscode');
  const settingsPath = join(vscodeDir, 'settings.json');
  const settings = readJsonFile(settingsPath);
  const label = getWorktreeLabel(worktreePath, currentMeta);
  const activeForeground = pickReadableForeground(color);
  const inactiveBackground = mixColors(color, activeForeground === '#111111' ? '#FFFFFF' : '#111111', 0.25);
  const inactiveForeground = pickReadableForeground(inactiveBackground);
  const commandCenterBackground = mixColors(color, activeForeground === '#111111' ? '#FFFFFF' : '#000000', 0.18);
  const commandCenterForeground = pickReadableForeground(commandCenterBackground);
  const borderColor = mixColors(color, activeForeground === '#111111' ? '#000000' : '#FFFFFF', 0.22);
  const colorCustomizations = {
    ...omitManagedVSCodeColors(settings['workbench.colorCustomizations'] || {}),
    'titleBar.activeBackground': color,
    'titleBar.activeForeground': activeForeground,
    'titleBar.inactiveBackground': inactiveBackground,
    'titleBar.inactiveForeground': inactiveForeground,
    'titleBar.border': borderColor,
    'commandCenter.background': commandCenterBackground,
    'commandCenter.foreground': commandCenterForeground,
    'commandCenter.activeBackground': color,
    'commandCenter.activeForeground': activeForeground,
    'commandCenter.activeBorder': borderColor,
    'commandCenter.border': borderColor,
    'commandCenter.inactiveForeground': inactiveForeground,
    'commandCenter.inactiveBorder': mixColors(inactiveBackground, inactiveForeground, 0.18),
  };

  const nextSettings = {
    ...settings,
    'window.titleBarStyle': settings['window.titleBarStyle'] ?? 'custom',
    'window.title': settings['window.title'] ?? `${label} - \${activeEditorShort}\${separator}\${rootName}`,
    'workbench.colorCustomizations': colorCustomizations,
  };

  mkdirSync(vscodeDir, { recursive: true });
  const serialized = JSON.stringify(nextSettings, null, 2) + '\n';
  if (!existsSync(settingsPath) || readFileSync(settingsPath, 'utf8') !== serialized) {
    writeFileSync(settingsPath, serialized);
  }

  return { settingsPath, color, label };
}

module.exports = {
  allocateWorktreeColor,
  applyTerminalColor,
  buildApplySequences,
  buildResetSequences,
  buildSwitchCommand,
  copyToClipboard,
  detectShellFlavor,
  ensureWorktreeColor,
  getAnsi16Index,
  normalizeColorHex,
  randomColorHex,
  readWorktreeMeta,
  resetTerminalColor,
  writeVSCodeWorkspaceSettings,
  writeWorktreeMeta,
};
