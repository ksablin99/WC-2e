// Mock Foundry VTT globals for Jest testing

// Mock CONST (Foundry constants)
const CONST = {
  CHAT_MESSAGE_STYLES: {
    OTHER: 0,
    IC: 1,
    EMOTE: 2,
    OOC: 3,
  },
};
global.CONST = CONST;

// Mock RollTerm base class
class RollTerm {
  constructor(options = {}) {
    this.options = options;
    this._evaluated = false;
    this.isIntermediate = false;
  }
  
  get dice() {
    return [];
  }
  
  evaluate(options = {}) {
    this._evaluated = true;
    return this;
  }
}

// Mock NumericTerm
class NumericTerm extends RollTerm {
  constructor({ number, options = {} } = {}) {
    super(options);
    this.number = number;
  }
  
  get total() {
    return this.number;
  }
}

// Mock StringTerm
class StringTerm extends RollTerm {
  constructor({ term, options = {} } = {}) {
    super(options);
    this.term = term;
  }
}

// Mock Roll class — evaluates simple arithmetic and @data.path substitutions
class Roll {
  constructor(formula, data = {}) {
    this.data = data;
    this._dice = [];
    this._total = 0;
    this._evaluated = false;
    // Mirrors Foundry v13 behaviour: parse is called during construction so
    // subclass NaN guards and preprocessors fire at the right time.
    this.terms = this.constructor.parse(formula, data);
    this.formula = formula;
  }

  static create(formula, data = {}) {
    return new this(formula, data);
  }

  static parse(formula, data = {}) {
    return [{ formula, data }];
  }

  static simplifyTerms(terms) {
    return terms;
  }

  static _splitParentheses(formula) {
    return [formula];
  }

  static _splitPools(term) {
    return [term];
  }

  static _splitOperators(term) {
    return [term];
  }

  static _classifyStringTerm(term) {
    return term;
  }

  static replaceFormulaData(formula, data = {}, { missing } = {}) {
    return String(formula).replace(/@([\w.]+)/g, (match, path) => {
      const val = path.split('.').reduce((obj, key) => obj?.[key], data);
      if (val != null) {
        if (typeof val === 'string') return val.trim();
        if (typeof val === 'boolean' || typeof val === 'number') return String(val);
        return String(val);
      }
      return missing !== undefined ? String(missing) : match;
    });
  }

  /** Evaluate the formula synchronously — mirrors what Foundry's Roll parser does:
   *  substitutes @data references and exposes Math functions (like mathProxy). */
  _evalFormula() {
    let expr = this.formula;
    // Replace @key or @key.sub with values from data
    expr = expr.replace(/@([\w.]+)/g, (_, path) => {
      const val = path.split('.').reduce((obj, key) => obj?.[key], this.data);
      return val !== undefined ? val : 0;
    });
    // Prefix bare math function names with Math. (like Foundry's CONFIG.Dice.mathProxy)
    expr = expr.replace(
      /\b(abs|acos|acosh|asin|asinh|atan|atanh|atan2|cbrt|ceil|clz32|cos|cosh|exp|expm1|floor|fround|hypot|imul|log|log1p|log2|log10|max|min|pow|random|round|sign|sin|sinh|sqrt|tan|tanh|trunc)\b(?=\s*\()/g,
      'Math.$1'
    );
    try {
      // eslint-disable-next-line no-new-func
      this._total = Function('"use strict"; return (' + expr + ')')();
    } catch (e) {
      this._total = 0;
    }
  }

  evaluateSync(options = {}) {
    this._evalFormula();
    this._evaluated = true;
    return this;
  }

  evaluate(options = {}) {
    this._evalFormula();
    this._evaluated = true;
    return Promise.resolve(this);
  }

  roll(options = {}) {
    return this.evaluate(options);
  }

  get total() {
    return this._total;
  }

  get dice() {
    return this._dice;
  }
}

// Mock foundry utilities
const foundry = {
  utils: {
    getProperty: (obj, path) => {
      return path.split('.').reduce((current, key) => {
        return current && current[key] !== undefined ? current[key] : undefined;
      }, obj);
    },
    setProperty: (obj, path, value) => {
      const keys = path.split('.');
      const last = keys.pop();
      const target = keys.reduce((current, key) => {
        if (current[key] === undefined) current[key] = {};
        return current[key];
      }, obj);
      target[last] = value;
      return true;
    },
    mergeObject: (original, other, options = {}) => {
      return { ...original, ...other };
    },
    duplicate: (obj) => JSON.parse(JSON.stringify(obj))
  }
};

// Mock game object
const game = {
  i18n: {
    format: (key, data) => key,
    localize: (key) => key
  },
  D35E: {
    logger: {
      error: () => {},
      warn: () => {},
      log: () => {}
    },
    rollPreProcess: {}
  }
};

// Mock ui object
const ui = {
  notifications: {
    warn: () => {},
    error: () => {},
    info: () => {}
  }
};

// Mock CONFIG object
const CONFIG = {
  debug: {
    roll: false
  }
};

// Mock ChatMessage
class ChatMessage {
  constructor(data = {}) { Object.assign(this, data); }
  static create(data) { return Promise.resolve(new ChatMessage(data)); }
  async update(data) { Object.assign(this, data); return this; }
}

// Set globals
global.Roll = Roll;
global.ChatMessage = ChatMessage;
global.RollTerm = RollTerm;
global.NumericTerm = NumericTerm;
global.StringTerm = StringTerm;
global.foundry = foundry;
global.game = game;
global.ui = ui;
global.CONFIG = CONFIG;
global.getProperty = foundry.utils.getProperty;
global.setProperty = foundry.utils.setProperty;
global.mergeObject = foundry.utils.mergeObject;
global.duplicate = foundry.utils.duplicate;

