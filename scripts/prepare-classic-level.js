/**
 * Make classic-level's bundled Windows prebuild visible after
 * `npm install --ignore-scripts`.
 *
 * classic-level 3 ships a working N-API binary, but the published generic
 * filename is not selected by node-gyp-build on current Node releases. The
 * repository intentionally skips install scripts, so copy that bundled
 * binary into node-gyp-build's normal Release lookup directory.
 */

'use strict';

const { copyFileSync, existsSync, mkdirSync } = require('fs');
const { join, resolve } = require('path');

const repoRoot = resolve(__dirname, '..');

try {
  require.resolve('classic-level', { paths: [repoRoot] });
  require('classic-level');
  process.exit(0);
} catch (error) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw error;
}

const packageRoot = resolve(repoRoot, 'node_modules/classic-level');
const source = join(packageRoot, 'prebuilds/win32-x64/classic-level.node');
const releaseDir = join(packageRoot, 'build/Release');
const target = join(releaseDir, 'classic-level.node');

if (!existsSync(source)) {
  throw new Error(`classic-level Windows prebuild missing: ${source}`);
}

mkdirSync(releaseDir, { recursive: true });
copyFileSync(source, target);
require('classic-level');
console.log('[prepare:classic-level] Windows prebuild ready.');
