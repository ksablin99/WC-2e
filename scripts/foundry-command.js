'use strict';

function quotePosixArgument(value) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function quoteWindowsArgument(value) {
  // cmd.exe expands percent-delimited variables before argv parsing. Refuse
  // that unusual path instead of risking a different Foundry/data directory.
  if (value.includes('%')) throw new Error('Foundry command arguments cannot contain % on Windows');

  let result = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      result += '\\'.repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += '\\'.repeat(backslashes) + character;
    backslashes = 0;
  }
  return result + '\\'.repeat(backslashes * 2) + '"';
}

function quoteShellArgument(value, platform = process.platform) {
  const text = String(value);
  if (text.includes('\0') || /[\r\n]/.test(text)) {
    throw new Error('Foundry command arguments cannot contain control characters');
  }
  return platform === 'win32' ? quoteWindowsArgument(text) : quotePosixArgument(text);
}

function buildFoundryWebServerCommand({ nodePath, foundryPath, dataDir, port }, platform = process.platform) {
  const args = [
    nodePath,
    foundryPath,
    `--dataPath=${dataDir}`,
    '--world=test-world',
    `--port=${port}`,
    '--noupdate',
  ];
  return args.map((arg) => quoteShellArgument(arg, platform)).join(' ');
}

module.exports = { buildFoundryWebServerCommand, quoteShellArgument };
