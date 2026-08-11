import { _preProcessDiceFormula } from '../../module/dice.js';

// ─── What _preProcessDiceFormula actually does ────────────────────────────────
// It is a PRE-processor for Foundry's Roll parser. Its job is limited:
//   1. Resolve template literals (${ ... }) before parsing
//   2. Evaluate custom game.D35E.rollPreProcess functions (e.g. sizeRoll)
//   3. Evaluate Math functions that are nested *inside* a D35E rollPreProcess call
//
// Top-level Math function calls (floor, pow, max, min …) are deliberately left
// unchanged — Foundry's native Roll parser handles them via FunctionTerm/mathProxy.
// ─────────────────────────────────────────────────────────────────────────────

describe('_preProcessDiceFormula', () => {

  // ── Passthrough behaviour (no custom D35E functions present) ──────────────

  describe('plain formulas — passed through unchanged', () => {
    it('leaves simple arithmetic unchanged', () => {
      expect(_preProcessDiceFormula('1 + 2')).toBe('1 + 2');
    });

    it('leaves @data references unchanged (Foundry replaceFormulaData handles them)', () => {
      expect(_preProcessDiceFormula('@level * 2', { level: 5 })).toBe('@level * 2');
    });

    // Top-level Math functions are intentionally NOT pre-processed here —
    // Foundry's own Roll parser evaluates them via CONFIG.Dice.mathProxy.
    it('leaves top-level floor() unchanged', () => {
      expect(_preProcessDiceFormula('floor(3.7)')).toBe('floor(3.7)');
    });

    it('leaves top-level pow() unchanged', () => {
      expect(_preProcessDiceFormula('pow(2, 3)')).toBe('pow(2, 3)');
    });

    it('leaves top-level max() unchanged', () => {
      expect(_preProcessDiceFormula('max(4, 7)')).toBe('max(4, 7)');
    });
  });

  // ── Template literal substitution ─────────────────────────────────────────

  describe('template literal substitution', () => {
    it('evaluates ${} expressions when formula contains a dollar sign', () => {
      // _fillTemplate uses new Function to resolve ${} in the formula
      const result = _preProcessDiceFormula('${this.value + 1}', { value: 4 });
      expect(result).toBe('5');
    });

    it('leaves formulas without $ unchanged even if data is supplied', () => {
      expect(_preProcessDiceFormula('3 + 4', { value: 4 })).toBe('3 + 4');
    });
  });

  // ── Custom game.D35E.rollPreProcess functions ─────────────────────────────

  describe('custom D35E rollPreProcess functions', () => {
    beforeEach(() => {
      // Register a simple custom function
      game.D35E.rollPreProcess.double = (x) => x * 2;
    });

    afterEach(() => {
      delete game.D35E.rollPreProcess.double;
    });

    it('evaluates a custom function with a literal argument', () => {
      expect(_preProcessDiceFormula('double(5)')).toBe('10');
    });

    it('evaluates a custom function with a @data argument', () => {
      // The argument "@level" is evaluated via Roll35e → data substitution → 7
      expect(_preProcessDiceFormula('double(@level)', { level: 7 })).toBe('14');
    });

    it('evaluates a custom function with arithmetic in its argument', () => {
      expect(_preProcessDiceFormula('double(3 + 2)')).toBe('10');
    });

    it('handles multiple arguments by splitting on comma', () => {
      game.D35E.rollPreProcess.add = (a, b) => a + b;
      expect(_preProcessDiceFormula('add(3, 5)')).toBe('8');
      delete game.D35E.rollPreProcess.add;
    });

    it('leaves the rest of the formula intact around the function call', () => {
      // "double(3) + 1" → "6 + 1"
      const result = _preProcessDiceFormula('double(3) + 1');
      expect(result).toBe('6 + 1');
    });
  });

  // ── Math functions nested inside a D35E rollPreProcess function ───────────

  describe('Math functions nested inside D35E rollPreProcess calls', () => {
    beforeEach(() => {
      // A passthrough that just returns its argument — lets us test that Math
      // functions are evaluated when they appear inside a D35E preprocess call.
      game.D35E.rollPreProcess.wrap = (x) => x;
    });

    afterEach(() => {
      delete game.D35E.rollPreProcess.wrap;
    });

    it('evaluates floor() nested inside a D35E function', () => {
      expect(_preProcessDiceFormula('wrap(floor(3.7))')).toBe('3');
    });

    it('evaluates pow() nested inside a D35E function', () => {
      expect(_preProcessDiceFormula('wrap(pow(2, 3))')).toBe('8');
    });

    it('evaluates max() nested inside a D35E function', () => {
      expect(_preProcessDiceFormula('wrap(max(4, 9))')).toBe('9');
    });

    it('evaluates min() nested inside a D35E function', () => {
      expect(_preProcessDiceFormula('wrap(min(4, 9))')).toBe('4');
    });
  });

  // ── sizeRoll — the primary real-world D35E custom function ────────────────

  // ── ternary / > operator (issue 1679) ────────────────────────────────────

  describe('ternary operator with > in condition', () => {
    it('resolves top-level ternary with > (true branch)', () => {
      expect(_preProcessDiceFormula('3 > 2 ? 3 : 4')).toBe('3');
    });

    it('resolves top-level ternary with > (false branch)', () => {
      expect(_preProcessDiceFormula('1 > 2 ? 3 : 4')).toBe('4');
    });

    it('resolves ternary whose condition contains parens — issue 1679', () => {
      // (4) > 2 ? (4) : 0 — condition and true-branch wrapped in parens,
      // unreachable by the [^()]* regex alone; handled by _processFunctionArgs.
      const trueResult = _preProcessDiceFormula('(4) > 2 ? (4) : 0');
      expect(trueResult).not.toMatch('>');
      expect(Number(trueResult.replace(/[()]/g, ''))).toBe(4);

      const falseResult = _preProcessDiceFormula('(1) > 2 ? (4) : 0');
      expect(falseResult).not.toMatch('>');
      expect(Number(falseResult)).toBe(0);
    });

    it('resolves ternary nested inside function args — issue 1679', () => {
      // max(0,-5 + max(5, (4) > 2 ? (4) : 0)) from the bug report.
      // The ? sits at paren depth 2 so neither the simple regex nor
      // top-level _resolveTernary reaches it without _processFunctionArgs.
      const result = _preProcessDiceFormula('max(0,-5 + max(5, (4) > 2 ? (4) : 0))');
      expect(result).not.toMatch('>');
    });
  });

  // ── || coalesce operator ──────────────────────────────────────────────────

  describe('|| coalesce operator', () => {
    it('resolves (value || 0) when @ref is defined', () => {
      expect(_preProcessDiceFormula('(@level || 0)', { level: 5 })).toBe('5');
    });

    it('resolves (value || 0) when @ref is missing — returns fallback', () => {
      expect(_preProcessDiceFormula('(@level || 0)', {})).toBe('0');
    });

    it('resolves || inside ternary condition with Math functions — issue 1683', () => {
      const data = {
        classes: { fighter: { level: 5 }, warblade: { level: 3 } },
        attributes: { hd: { total: 10 } },
      };
      // fighter(5)+warblade(3-2=1)=6; max(6, floor((10-6)/2)+6)=max(6,8)=8 ≥ 8 → true → 1
      const formula =
        '1 + (max(((@classes.fighter.level || 0) + (@classes.warblade.level-2 || 0)),' +
        '(floor((@attributes.hd.total - ((@classes.fighter.level || 0) + ' +
        '(@classes.warblade.level-2 || 0))) / 2))+((@classes.fighter.level || 0) + ' +
        '(@classes.warblade.level-2 || 0)))>= 8 ? 1 : 0)';
      const result = _preProcessDiceFormula(formula, data);
      expect(result).not.toContain('||');
      expect(result).not.toContain('?');
      // outer parens are preserved: "1 + (1)"
      expect(result.replace(/\s|\(|\)/g, '')).toBe('1+1');
    });

    it('resolves || — false branch when all class levels missing', () => {
      const data = { attributes: { hd: { total: 3 } } };
      const formula =
        '1 + (max(((@classes.fighter.level || 0) + (@classes.warblade.level-2 || 0)),' +
        '(floor((@attributes.hd.total - ((@classes.fighter.level || 0) + ' +
        '(@classes.warblade.level-2 || 0))) / 2))+((@classes.fighter.level || 0) + ' +
        '(@classes.warblade.level-2 || 0)))>= 8 ? 1 : 0)';
      // all class levels 0; max(0, ...) < 8 → false → 0
      const result = _preProcessDiceFormula(formula, data);
      expect(result).not.toContain('||');
      expect(result).not.toContain('?');
      expect(result.replace(/\s|\(|\)/g, '')).toBe('1+0');
    });
  });

  describe('sizeRoll integration', () => {
    beforeEach(() => {
      // Minimal stub: returns a fixed dice string like "1d6"
      game.D35E.rollPreProcess.sizeRoll = (count, sides, size, crit) =>
        `${count}d${sides}`;
    });

    afterEach(() => {
      delete game.D35E.rollPreProcess.sizeRoll;
    });

    it('replaces sizeRoll() with the result of the rollPreProcess function', () => {
      expect(_preProcessDiceFormula('sizeRoll(1, 6, M, 1)')).toBe('1d6');
    });

    it('leaves surrounding formula intact', () => {
      expect(_preProcessDiceFormula('sizeRoll(1, 6, M, 1) + 2')).toBe('1d6 + 2');
    });
  });

});
