const { buildFoundryWebServerCommand, quoteShellArgument } = require('../../scripts/foundry-command');

describe('Foundry web-server command quoting', () => {
  test('quotes every Windows argument and preserves paths with spaces', () => {
    expect(buildFoundryWebServerCommand({
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      foundryPath: 'D:\\Foundry VTT\\resources\\app\\main.js',
      dataDir: 'C:\\Users\\Test User\\Foundry E2E',
      port: 32141,
    }, 'win32')).toBe(
      '"C:\\Program Files\\nodejs\\node.exe" ' +
      '"D:\\Foundry VTT\\resources\\app\\main.js" ' +
      '"--dataPath=C:\\Users\\Test User\\Foundry E2E" ' +
      '"--world=test-world" "--port=32141" "--noupdate"'
    );
  });

  test('quotes POSIX apostrophes without allowing shell interpolation', () => {
    expect(quoteShellArgument('/tmp/user\'s/$data', 'linux')).toBe(
      `'/tmp/user'"'"'s/$data'`
    );
  });

  test('rejects Windows percent expansion and control characters', () => {
    expect(() => quoteShellArgument('C:\\Users\\%USERNAME%\\data', 'win32')).toThrow(/cannot contain %/);
    expect(() => quoteShellArgument('/tmp/data\nnext', 'linux')).toThrow(/control characters/);
  });
});
