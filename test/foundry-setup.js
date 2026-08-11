/**
 * Foundry VTT integration test setup.
 *
 * Imports Foundry v13's actual Roll class, dice infrastructure, and common
 * utility functions from the pre-compiled CJS bundle (built by
 * test/build-foundry-dice.mjs), then installs them as globals so that
 * Roll35e (which does `extends Roll`) uses the real Foundry implementation.
 */

// ── 1. Load the pre-compiled Foundry bundle ───────────────────────────────────
//    Built by `node test/build-foundry-dice.mjs` (run as pretest:foundry).
//    Contains: Roll, RollGrammar, RollParser, MersenneTwister, terms,
//              getProperty, setProperty, mergeObject, deepClone, getType.

const path = require('path');
const dice = require(path.resolve(__dirname, 'foundry-compiled/dice.cjs'));

const FoundryRoll     = dice.Roll;
const RollGrammar     = dice.RollGrammar;
const RollParser      = dice.RollParser;
const MersenneTwister = dice.MersenneTwister;
const terms           = dice.terms;

// Use Foundry's actual utility implementations (from common/utils/helpers.mjs).
const getPropertyFn = dice.getProperty;
const setPropertyFn = dice.setProperty;
const mergeObjectFn = dice.mergeObject;
const deepCloneFn   = dice.deepClone;
const getTypeFn     = dice.getType;

// ── 2. Minimal Foundry globals that the Roll class and Roll35e depend on ──────

const CONST = {
  CHAT_MESSAGE_STYLES: { OTHER: 0, IC: 1, EMOTE: 2, OOC: 3 },
};

const game = {
  i18n: {
    format: (key, data) => key,
    localize: (key) => key,
  },
  D35E: {
    logger: { error: () => {}, warn: () => {}, log: () => {} },
    rollPreProcess: {},
  },
};

const ui = {
  notifications: { warn: () => {}, error: () => {}, info: () => {} },
};

const CONFIG = { debug: { roll: false, rollParsing: false } };

const foundry = {
  utils: {
    getProperty:              getPropertyFn,
    setProperty:              setPropertyFn,
    mergeObject:              mergeObjectFn,
    deepClone:                deepCloneFn,
    getType:                  getTypeFn,
    isSubclass:               (cls, parent) => cls.prototype instanceof parent,
    getDocumentClass:         () => undefined,
    logCompatibilityWarning:  () => {},
  },
  dice: {
    Roll:            FoundryRoll,
    RollGrammar:     RollGrammar,
    RollParser:      RollParser,
    MersenneTwister: MersenneTwister,
    terms:           terms,
  },
};

// ── 3. Wire up CONFIG.Dice so Roll.parse() / FunctionTerm can work ────────────

CONFIG.Dice = {
  rolls:        [FoundryRoll],
  types:        [terms.Die, terms.FateDie],
  termTypes:    {
    DiceTerm:          terms.DiceTerm,
    FunctionTerm:      terms.FunctionTerm,
    NumericTerm:       terms.NumericTerm,
    OperatorTerm:      terms.OperatorTerm,
    ParentheticalTerm: terms.ParentheticalTerm,
    PoolTerm:          terms.PoolTerm,
    StringTerm:        terms.StringTerm,
    RollTerm:          terms.RollTerm,
  },
  terms:        { c: terms.Coin, d: terms.Die, f: terms.FateDie },
  parser:       RollParser,
  functions:    {},
  randomUniform: MersenneTwister.random,
  rollModes:    { publicroll: {}, gmroll: {}, blindroll: {}, selfroll: {} },
};

// ── 4. Install globals ────────────────────────────────────────────────────────
//    Roll35e does `extends Roll` at class-definition time, so global.Roll must
//    be set before roll.js is first evaluated.

global.CONST        = CONST;
global.game         = game;
global.ui           = ui;
global.CONFIG       = CONFIG;
global.foundry      = foundry;
global.Roll         = FoundryRoll;
global.RollTerm     = terms.RollTerm;
global.NumericTerm  = terms.NumericTerm;
global.StringTerm   = terms.StringTerm;
global.FunctionTerm = terms.FunctionTerm;
global.OperatorTerm = terms.OperatorTerm;
global.ChatMessage  = class ChatMessage {
  static create(data) { return Promise.resolve(data); }
};

// Convenience globals (legacy Foundry API surface used in some D35E code paths)
global.getProperty = getPropertyFn;
global.setProperty = setPropertyFn;
global.mergeObject = mergeObjectFn;
global.duplicate   = deepCloneFn;
