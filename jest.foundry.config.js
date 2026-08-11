/**
 * Jest configuration for Foundry VTT integration tests.
 *
 * These tests import Foundry's actual Roll parser from .foundrycache/foundry-vN/
 * so they verify that our Roll35e and formula preprocessing works correctly
 * with the real Foundry dice engine — not just a hand-rolled mock.
 *
 * Run with: npm run test:foundry
 */
'use strict';

const path = require('path');
const { resolveFoundry } = require('./scripts/foundry-version');
const { mainJsPath } = resolveFoundry(__dirname);
const FOUNDRY = path.dirname(mainJsPath);

module.exports = {
  displayName: 'foundry-integration',
  testMatch: ['**/test/foundry/**/*Test.js'],
  testEnvironment: 'node',

  // Run the foundry-specific setup (real Roll globals) instead of the mock setup
  setupFilesAfterEnv: ['<rootDir>/test/foundry-setup.js'],

  // Map Foundry's internal path aliases to the actual source locations
  moduleNameMapper: {
    '^@common/(.*)$': `${FOUNDRY}/common/$1`,
    '^@client/(.*)$': `${FOUNDRY}/client/$1`,
  },

  // Transform .pegjs grammar files with our custom Peggy transform
  transform: {
    '\\.pegjs$': '<rootDir>/test/transformers/peggyTransform.cjs',
    // Babel for our own JS/MJS and Foundry's MJS source files
    '\\.[cm]?js$': 'babel-jest',
  },

  // Do NOT ignore .foundrycache or Foundry source files from transforms —
  // they use ESM syntax that Babel needs to convert for Node.js/Jest.
  transformIgnorePatterns: [
    '/node_modules/',
    // keep .foundrycache transformable (it's outside node_modules)
  ],
};
