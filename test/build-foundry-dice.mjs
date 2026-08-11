/**
 * Pre-build script: bundle Foundry's dice module + common utils into a
 * single CJS file that can be require()'d in Jest tests.
 *
 * Foundry version resolved via scripts/foundry-version.js (reads .foundry-version,
 * FOUNDRY_VERSION env var, or auto-discovers the highest available cache dir).
 *
 * Run with: node test/build-foundry-dice.mjs
 * Automatically invoked by the "pretest:foundry" npm script.
 *
 * Exports (available via require('foundry-compiled/dice.cjs')):
 *   dice exports:  Roll, RollGrammar, RollParser, MersenneTwister, terms
 *   utils exports: getProperty, setProperty, mergeObject, deepClone, getType
 */

import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);
const { resolveFoundry } = require('../scripts/foundry-version');
const { version, mainJsPath } = resolveFoundry(resolve(__dirname, '..'));
const FOUNDRY   = dirname(mainJsPath);

console.log(`[build-foundry-dice] Using Foundry v${version ?? 'auto'} at ${FOUNDRY}`);

const peggy = require(join(FOUNDRY, 'node_modules/peggy/lib/peg.js'));
const { generate } = peggy;

// Plugin: compile .pegjs grammar files with peggy
const peggyPlugin = {
  name: 'peggy',
  setup(build) {
    build.onLoad({ filter: /\.pegjs$/ }, (args) => {
      const source  = readFileSync(args.path, 'utf8');
      const compiled = generate(source, { output: 'source', format: 'umd' });
      // The UMD output sets module.exports when run in CJS; return it as JS.
      return { contents: compiled, loader: 'js' };
    });
  },
};

mkdirSync(resolve(__dirname, 'foundry-compiled'), { recursive: true });

// Use a virtual stdin entry that re-exports both dice infrastructure and
// the common utils we need in foundry-setup.js, so tests can use Foundry's
// real implementations instead of hand-rolled mocks.
const virtualEntry = `
export * from "@client/dice/_module.mjs";
export * as terms from "@client/dice/terms/_module.mjs";
export { getProperty, setProperty, mergeObject, deepClone, getType } from "@common/utils/helpers.mjs";
`;

await build({
  stdin: {
    contents:   virtualEntry,
    resolveDir: FOUNDRY,
    sourcefile: 'foundry-entry.mjs',
    loader:     'js',
  },
  bundle:      true,
  platform:    'node',
  format:      'cjs',
  outfile:     resolve(__dirname, 'foundry-compiled/dice.cjs'),
  plugins:     [peggyPlugin],
  alias: {
    '@common': resolve(FOUNDRY, 'common'),
    '@client': resolve(FOUNDRY, 'client'),
  },
});

console.log('✓ Foundry dice + utils compiled to test/foundry-compiled/dice.cjs');
