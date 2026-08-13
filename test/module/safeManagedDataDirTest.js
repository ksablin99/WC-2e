const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertSafeManagedDataDir,
  ensureManagedDataMarker,
  validateManagedDataMarker,
} = require('../../scripts/safe-managed-data-dir');

describe('isolated Foundry data path safety', () => {
  const fixtureRoot = path.join(os.tmpdir(), 'wc2e-path-safety-fixture');
  const homeDir = path.join(fixtureRoot, 'home');
  const repoRoot = path.join(homeDir, 'code', 'WC-2e');
  const localAppData = path.join(homeDir, 'AppData', 'Local');
  const safeDataDir = path.join(homeDir, 'FoundryVTT-WC2e-Test', 'e2e-data');
  const options = { repoRoot, kind: 'e2e', homeDir, localAppData, appData: null };

  test('allows the dedicated isolated test directory beneath home', () => {
    const resolved = assertSafeManagedDataDir(safeDataDir, options);
    expect(path.basename(resolved)).toBe('e2e-data');
    expect(path.basename(path.dirname(resolved))).toBe('FoundryVTT-WC2e-Test');
  });

  test.each([
    ['filesystem root', path.parse(path.resolve(safeDataDir)).root],
    ['home', homeDir],
    ['home ancestor', path.dirname(homeDir)],
    ['repository root', repoRoot],
    ['repository child', path.join(repoRoot, 'tmp-data')],
    ['normal Foundry root', path.join(localAppData, 'FoundryVTT')],
    ['normal Foundry child', path.join(localAppData, 'FoundryVTT', 'Data', 'worlds')],
  ])('rejects %s', (_label, candidate) => {
    expect(() => assertSafeManagedDataDir(candidate, options)).toThrow(/Refusing/);
  });

  test('requires an ownership marker before recursive removal is authorized', () => {
    expect(() => assertSafeManagedDataDir(safeDataDir, { ...options, requireMarker: true }))
      .toThrow(/unmarked/);
  });

  test('adopts a recognizable pre-marker e2e directory but rejects arbitrary contents', () => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wc2e-marker-adoption-'));
    const testRepo = path.join(testRoot, 'repo');
    const recognized = path.join(testRoot, 'isolated-e2e');
    const foreign = path.join(testRoot, 'foreign');
    fs.mkdirSync(path.join(recognized, 'Config'), { recursive: true });
    fs.mkdirSync(path.join(recognized, 'Data', 'worlds', 'test-world'), { recursive: true });
    fs.mkdirSync(foreign, { recursive: true });
    fs.writeFileSync(path.join(recognized, 'Config', 'options.json'), JSON.stringify({
      dataPath: recognized,
      world: 'test-world',
      hostname: 'localhost',
      upnp: false,
    }));
    fs.writeFileSync(path.join(recognized, 'Data', 'worlds', 'test-world', 'world.json'), JSON.stringify({
      id: 'test-world',
      title: 'E2E Test World',
      system: 'warcraftrpg2e',
      description: 'Minimal world for automated e2e testing.',
    }));
    fs.writeFileSync(path.join(foreign, 'personal.txt'), 'not a fixture');

    try {
      expect(ensureManagedDataMarker(recognized, {
        repoRoot: testRepo,
        kind: 'e2e',
        expectedWorldId: 'test-world',
      })).toMatch(/warcraftrpg2e-managed-data/);
      expect(() => ensureManagedDataMarker(foreign, {
        repoRoot: testRepo,
        kind: 'e2e',
        expectedWorldId: 'test-world',
      })).toThrow(/unrecognized/);
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('resolves a missing target through a symlinked parent before checking protected roots', () => {
    const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wc2e-parent-link-'));
    const normalLocalAppData = path.join(testRoot, 'normal-local-app-data');
    const normalFoundry = path.join(normalLocalAppData, 'FoundryVTT');
    const alias = path.join(testRoot, 'isolated-looking-alias');
    fs.mkdirSync(normalFoundry, { recursive: true });
    fs.symlinkSync(normalFoundry, alias, process.platform === 'win32' ? 'junction' : 'dir');

    try {
      expect(() => assertSafeManagedDataDir(path.join(alias, 'new-child'), {
        repoRoot: path.join(testRoot, 'repo'),
        kind: 'e2e',
        homeDir: path.join(testRoot, 'home'),
        localAppData: normalLocalAppData,
        appData: null,
      })).toThrow(/normal Foundry/);
    } finally {
      fs.rmSync(testRoot, { recursive: true, force: true });
    }
  });

  test('validates owner, purpose, kind, and repository identity', () => {
    const valid = {
      schema: 1,
      owner: 'warcraftrpg2e',
      purpose: 'isolated-foundry-data',
      kind: 'e2e',
      repoRoot,
    };
    expect(validateManagedDataMarker(valid, options)).toBe(true);
    expect(() => validateManagedDataMarker({ ...valid, kind: 'dev' }, options)).toThrow(/foreign/);
    expect(() => validateManagedDataMarker({ ...valid, repoRoot: path.dirname(repoRoot) }, options)).toThrow(/foreign/);
  });

  test('all recursive data-dir cleanup entrypoints require the guarded remover', () => {
    for (const relative of [
      'test/e2e/setup.js',
      'scripts/e2e-clean.js',
      'scripts/dev-setup.js',
      'scripts/dev-clean.js',
      'scripts/wt-remove.js',
      'scripts/wt-close.js',
      'scripts/wt-cleanup.js',
    ]) {
      const source = fs.readFileSync(path.resolve(__dirname, '../..', relative), 'utf8');
      expect(source).toContain('removeManagedDataDir');
      expect(source).not.toMatch(/rmSync\(DATA_DIR,\s*\{\s*recursive:\s*true/);
      expect(source).not.toMatch(/rmSync\(dataDir,\s*\{\s*recursive:\s*true/);
    }
  });
});
