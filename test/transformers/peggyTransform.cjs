/**
 * Jest transform for Peggy (.pegjs) grammar files.
 * Compiles the grammar to a UMD-wrapped parser using the peggy package
 * bundled with Foundry VTT.
 */
'use strict';

const path = require('path');
const { resolveFoundry } = require('../../scripts/foundry-version');
const { mainJsPath } = resolveFoundry(path.resolve(__dirname, '../..'));
const peggy = require(path.join(path.dirname(mainJsPath), 'node_modules/peggy'));

module.exports = {
  process(sourceText) {
    const source = peggy.generate(sourceText, {
      output: 'source',
      format: 'umd',
    });
    // The UMD wrapper sets module.exports when running in a CJS context,
    // so we just return the source as-is.
    return { code: source };
  },
};
