import { Roll35e } from '../../module/roll.js';
// Import dice.js so Roll35e._preProcess is wired up (it's set as a side-effect)
import '../../module/dice.js';

// ─── Test strategy ────────────────────────────────────────────────────────────
// The mock Roll class in jest.setup.js mimics Foundry's behaviour:
//   - evaluateSync() does @data substitution and exposes Math functions
// Roll35e.parse() adds:
//   - _preProcessDiceFormula (D35E custom functions, template literals)
//   - sizeRoll / sizeNaturalRoll / sizeMonkDamageRoll regex replacements
//   - NaN guard
// ─────────────────────────────────────────────────────────────────────────────

describe('Roll35e', () => {

  // ── safeEvaluate ────────────────────────────────────────────────────────────

  describe('safeEvaluate', () => {
    it('evaluates a simple numeric formula', () => {
      expect(Roll35e.safeEvaluate('2 + 3').total).toBe(5);
    });

    it('evaluates arithmetic with multiplication', () => {
      expect(Roll35e.safeEvaluate('3 * 4').total).toBe(12);
    });

    it('evaluates a formula with @data substitution', () => {
      expect(Roll35e.safeEvaluate('@level * 2', { level: 5 }).total).toBe(10);
    });

    it('evaluates nested @data paths', () => {
      expect(Roll35e.safeEvaluate('@attr.mod', { attr: { mod: 3 } }).total).toBe(3);
    });

    it('returns 0 when given an unevaluatable formula', () => {
      // The mock swallows eval errors silently; just verify total = 0
      const roll = Roll35e.safeEvaluate('not_a_formula%%%');
      expect(roll.total).toBe(0);
    });

    it('returns 0 and sets .err when formula contains "NaN" (NaN guard in parse)', () => {
      // Roll35e.parse() throws if the formula string contains "NaN";
      // safeEvaluate catches that and sets .err on the fallback roll.
      const roll = Roll35e.safeEvaluate('NaN');
      expect(roll.total).toBe(0);
      expect(roll.err).toBeDefined();
    });
  });

  // ── Math functions (handled by the Roll mock, like Foundry's native parser) ─

  describe('math function evaluation via the Roll evaluator', () => {
    it('evaluates floor()', () => {
      expect(Roll35e.safeEvaluate('floor(3.9)').total).toBe(3);
    });

    it('evaluates ceil()', () => {
      expect(Roll35e.safeEvaluate('ceil(3.1)').total).toBe(4);
    });

    it('evaluates max()', () => {
      expect(Roll35e.safeEvaluate('max(4, 7)').total).toBe(7);
    });

    it('evaluates min()', () => {
      expect(Roll35e.safeEvaluate('min(4, 7)').total).toBe(4);
    });

    it('evaluates pow()', () => {
      expect(Roll35e.safeEvaluate('pow(2, 3)').total).toBe(8);
    });

    it('evaluates abs()', () => {
      expect(Roll35e.safeEvaluate('abs(-5)').total).toBe(5);
    });

    it('evaluates floor() with @data reference', () => {
      expect(Roll35e.safeEvaluate('floor(@level / 3)', { level: 10 }).total).toBe(3);
    });

    it('evaluates pow() with @data reference', () => {
      expect(Roll35e.safeEvaluate('pow(2, @exp)', { exp: 4 }).total).toBe(16);
    });

    it('evaluates nested math functions', () => {
      // floor(pow(2, 3.9)) = floor(14.929...) = 14
      expect(Roll35e.safeEvaluate('floor(pow(2, 3.9))').total).toBe(14);
    });

    it('evaluates modulo (%)', () => {
      expect(Roll35e.safeEvaluate('16 % 5').total).toBe(1);
    });
  });

  // ── Carry capacity formula (real-world integration) ────────────────────────

  describe('carry capacity formula', () => {
    // This is CONFIG.D35E.carryingCapacityFormula evaluated with str = 16
    // Expected: heavy load for STR 16 = 133 lb
    const formula = '(10*@str)*(max(@str,11)-@str)/(max(11-@str,1))' +
      '+(5*pow(2,(-2)+floor(@str/5)))*(20+floor(47*pow(2,0.1*(@str%5))-47))' +
      '*(min(@str,10)-@str)/(min(10-@str,-1))';

    it('produces a non-zero result for STR 16', () => {
      const roll = Roll35e.safeEvaluate(formula, { str: 16 });
      expect(roll.total).toBeGreaterThan(0);
    });

    it('produces the correct heavy-load value for STR 16 (230 lb)', () => {
      const roll = Roll35e.safeEvaluate(formula, { str: 16 });
      expect(Math.round(roll.total)).toBe(230);
    });

    it('produces the correct heavy-load value for STR 10 (100 lb)', () => {
      const roll = Roll35e.safeEvaluate(formula, { str: 10 });
      expect(Math.round(roll.total)).toBe(100);
    });

    it('produces the correct heavy-load value for STR 1 (10 lb)', () => {
      const roll = Roll35e.safeEvaluate(formula, { str: 1 });
      expect(Math.round(roll.total)).toBe(10);
    });

    it('produces the correct heavy-load value for STR 20 (400 lb)', () => {
      const roll = Roll35e.safeEvaluate(formula, { str: 20 });
      expect(Math.round(roll.total)).toBe(400);
    });

    it('produces 0 for STR 0 (no strength)', () => {
      // str clamped to 0 in #getCarryCapacity before calling safeEvaluate
      const roll = Roll35e.safeEvaluate(formula, { str: 0 });
      expect(roll.total).toBe(0);
    });
  });

  // ── saving throw formula (real-world integration) ──────────────────────────

  describe('saving throw formulas', () => {
    it('evaluates "floor(@level / 3)" — poor save progression', () => {
      expect(Roll35e.safeEvaluate('floor(@level / 3)', { level: 9 }).total).toBe(3);
    });

    it('evaluates "2 + floor(@level / 2)" — good save progression', () => {
      expect(Roll35e.safeEvaluate('2 + floor(@level / 2)', { level: 8 }).total).toBe(6);
    });
  });

  // ── parse — NaN guard ──────────────────────────────────────────────────────

  describe('parse NaN guard', () => {
    it('throws (caught by safeEvaluate) when formula starts with NaN', () => {
      const roll = Roll35e.safeEvaluate('NaN + 1');
      expect(roll.total).toBe(0);
      expect(roll.err).toBeDefined();
    });
  });

  // ── parse — sizeRoll preprocessing ────────────────────────────────────────

  describe('parse — sizeRoll preprocessing', () => {
    beforeEach(() => {
      game.D35E.rollPreProcess.sizeRoll = (count, sides, size, crit) => `${count}d${sides}`;
    });

    afterEach(() => {
      delete game.D35E.rollPreProcess.sizeRoll;
    });

    it('replaces sizeRoll() before evaluation', () => {
      // parse() substitutes sizeRoll(1,6,M,1) → "1d6", then evaluateSync sees "1d6"
      // Our mock can't roll dice so it gets 0, but the key thing is: no throw
      expect(() => Roll35e.safeEvaluate('sizeRoll(1, 6, M, 1)')).not.toThrow();
    });

    it('replaces sizeRoll() with @data args before evaluation', () => {
      // sizeRoll(1,6,@size,@critMult) — @size and @critMult resolved before being
      // passed into the preProcess function
      expect(() => Roll35e.safeEvaluate('sizeRoll(1, 6, @size, @critMult)', { size: 4, critMult: 2 })).not.toThrow();
    });
  });

  // ── parse — sizeNaturalRoll preprocessing ─────────────────────────────────

  describe('parse — sizeNaturalRoll preprocessing', () => {
    beforeEach(() => {
      game.D35E.rollPreProcess.sizeNaturalRoll = (count, size, crit) => `${count}d6`;
    });

    afterEach(() => {
      delete game.D35E.rollPreProcess.sizeNaturalRoll;
    });

    it('replaces sizeNaturalRoll() before evaluation', () => {
      expect(() => Roll35e.safeEvaluate('sizeNaturalRoll(1, @size, @critMult)', { size: 4, critMult: 2 })).not.toThrow();
    });
  });

  // ── parse — sizeMonkDamageRoll preprocessing ──────────────────────────────

  describe('parse — sizeMonkDamageRoll preprocessing', () => {
    beforeEach(() => {
      game.D35E.rollPreProcess.sizeMonkDamageRoll = (level, size, crit) => `1d${level < 12 ? 8 : 10}`;
    });

    afterEach(() => {
      delete game.D35E.rollPreProcess.sizeMonkDamageRoll;
    });

    it('replaces sizeMonkDamageRoll() before evaluation', () => {
      expect(() => Roll35e.safeEvaluate('sizeMonkDamageRoll(@classes.monk.level, @size, @critMult)', {
        classes: { monk: { level: 10 } }, size: 4, critMult: 2,
      })).not.toThrow();
    });
  });

  // ── multi-depth @data paths ────────────────────────────────────────────────

  describe('multi-depth @data paths', () => {
    it('resolves @classes.bard.level', () => {
      expect(Roll35e.safeEvaluate('@classes.bard.level', { classes: { bard: { level: 5 } } }).total).toBe(5);
    });

    it('resolves @abilities.str.mod', () => {
      expect(Roll35e.safeEvaluate('@abilities.str.mod', { abilities: { str: { mod: 4 } } }).total).toBe(4);
    });

    it('resolves @skills.khi.rank', () => {
      expect(Roll35e.safeEvaluate('@skills.khi.rank', { skills: { khi: { rank: 8 } } }).total).toBe(8);
    });
  });

  // ── ternary operator in formulas ──────────────────────────────────────────

  describe('ternary operator in formulas', () => {
    it('evaluates a simple ternary (true branch)', () => {
      expect(Roll35e.safeEvaluate('(@level > 4 ? 1 : 0)', { level: 5 }).total).toBe(1);
    });

    it('evaluates a simple ternary (false branch)', () => {
      expect(Roll35e.safeEvaluate('(@level > 4 ? 1 : 0)', { level: 3 }).total).toBe(0);
    });

    it('evaluates a compound ternary sum (druid animal companion formula)', () => {
      // mirrors: (@classes.druid.level > 4 ? 1 : 0) + (@classes.druid.level > 9 ? 1 : 0)
      const formula = '(@level > 4 ? 1 : 0) + (@level > 9 ? 1 : 0)';
      expect(Roll35e.safeEvaluate(formula, { level: 10 }).total).toBe(2);
      expect(Roll35e.safeEvaluate(formula, { level: 6 }).total).toBe(1);
      expect(Roll35e.safeEvaluate(formula, { level: 2 }).total).toBe(0);
    });

    it('evaluates a skill-check ternary bonus', () => {
      // mirrors: @classes.bard.level + @abilities.int.mod + (@skills.khi.rank >= 5 ? 2 : 0)
      const formula = '@bardLevel + @intMod + (@khiRank >= 5 ? 2 : 0)';
      expect(Roll35e.safeEvaluate(formula, { bardLevel: 4, intMod: 2, khiRank: 5 }).total).toBe(8);
      expect(Roll35e.safeEvaluate(formula, { bardLevel: 4, intMod: 2, khiRank: 3 }).total).toBe(6);
    });

    it('evaluates a nested ternary from the paladin mount progression formula', () => {
      const formula = '(@level > 14 ? 7 : (@level > 10 ? 6 : (@level > 7 ? 5 : 4)))';
      expect(Roll35e.safeEvaluate(formula, { level: 15 }).total).toBe(7);
      expect(Roll35e.safeEvaluate(formula, { level: 11 }).total).toBe(6);
      expect(Roll35e.safeEvaluate(formula, { level: 8 }).total).toBe(5);
      expect(Roll35e.safeEvaluate(formula, { level: 7 }).total).toBe(4);
    });

    it('evaluates the exact nested ternary damage formula from issue 1545', () => {
      const formula = '(@cl < 7 ? 1d6 : (@cl < 9 ? 1d8 : (@cl < 11 ? 1d10 : 1d12)))';
      expect(Roll35e._preProcess(formula, { cl: 6 })).toBe('1d6');
      expect(Roll35e._preProcess(formula, { cl: 8 })).toBe('1d8');
      expect(Roll35e._preProcess(formula, { cl: 10 })).toBe('1d10');
      expect(Roll35e._preProcess(formula, { cl: 11 })).toBe('1d12');
    });

    it('resolves ternary whose condition contains parens — issue 1679', () => {
      // (4) > 2 ? (4) : 0  — condition and branch both wrapped in parens,
      // unreachable by the simple [^()]* regex but handled by _processFunctionArgs.
      // Result may be "4" or "(4)" — both are valid roll formulas; check no > remains
      // and the formula evaluates correctly.
      const trueResult = Roll35e._preProcess('(4) > 2 ? (4) : 0', {});
      expect(trueResult).not.toMatch('>');
      expect(Roll35e.safeEvaluate(trueResult, {}).total).toBe(4);

      const falseResult = Roll35e._preProcess('(1) > 2 ? (4) : 0', {});
      expect(falseResult).not.toMatch('>');
      expect(Roll35e.safeEvaluate(falseResult, {}).total).toBe(0);
    });

    it('resolves ternary nested inside function args — issue 1679', () => {
      // max(0,-5 + max(5, (4) > 2 ? (4) : 0))  from the bug report.
      // The ? sits at paren depth 2, so neither the simple regex nor the
      // top-level _resolveTernary reaches it without _processFunctionArgs.
      const formula = 'max(0,-5 + max(5, (4) > 2 ? (4) : 0))';
      const result = Roll35e._preProcess(formula, {});
      // After resolution the formula must contain no comparison operators.
      expect(result).not.toMatch('>');
      expect(Roll35e.safeEvaluate(result, {}).total).toBe(0);
    });

    it('resolves top-level ternary with > operator — issue 1679', () => {
      expect(Roll35e._preProcess('1 > 2 ? 3 : 4', {})).toBe('4');
      expect(Roll35e._preProcess('3 > 2 ? 3 : 4', {})).toBe('3');
    });
  });

  // ── deeply nested max/min/ceil (attackCountFormula) ───────────────────────

  describe('deeply nested max/min/ceil formulas', () => {
    it('evaluates max(min(5, ceil(@cl/2)), 1) — attackCountFormula', () => {
      // cl=10 → ceil(5) → min(5,5)=5 → max(5,1)=5
      expect(Roll35e.safeEvaluate('max(min(5, ceil(@cl/2)), 1)', { cl: 10 }).total).toBe(5);
      // cl=2  → ceil(1) → min(5,1)=1 → max(1,1)=1
      expect(Roll35e.safeEvaluate('max(min(5, ceil(@cl/2)), 1)', { cl: 2 }).total).toBe(1);
      // cl=0  → ceil(0) → min(5,0)=0 → max(0,1)=1
      expect(Roll35e.safeEvaluate('max(min(5, ceil(@cl/2)), 1)', { cl: 0 }).total).toBe(1);
    });

    it('evaluates 10*min(150, max(1, floor(@level)))', () => {
      expect(Roll35e.safeEvaluate('10*min(150, max(1, floor(@level)))', { level: 7 }).total).toBe(70);
      expect(Roll35e.safeEvaluate('10*min(150, max(1, floor(@level)))', { level: 0 }).total).toBe(10);
      expect(Roll35e.safeEvaluate('10*min(150, max(1, floor(@level)))', { level: 200 }).total).toBe(1500);
    });
  });

  // ── safeEvaluateCondition (combat-change === / &&) ─────────────────────────

  describe('safeEvaluateCondition', () => {
    describe('empty / trivial', () => {
      it('returns true for empty string', () => {
        expect(Roll35e.safeEvaluateCondition('', {})).toBe(true);
      });

      it('returns true for whitespace-only', () => {
        expect(Roll35e.safeEvaluateCondition('   \t  ', {})).toBe(true);
      });

      it('returns true for null-like when coerced empty', () => {
        expect(Roll35e.safeEvaluateCondition(null, {})).toBe(true);
      });
    });

    describe('quoted @skillId (pack-style)', () => {
      it('is true when single-quoted @skillId matches literal', () => {
        expect(Roll35e.safeEvaluateCondition("'@skillId'==='coc'", { skillId: 'coc' })).toBe(true);
      });

      it('is false when skill id differs', () => {
        expect(Roll35e.safeEvaluateCondition("'@skillId'==='coc'", { skillId: 'apr' })).toBe(false);
      });

      it('supports double-quoted @path', () => {
        expect(Roll35e.safeEvaluateCondition('"@skillId"==="coc"', { skillId: 'coc' })).toBe(true);
      });

      it('does not split && inside quoted strings', () => {
        expect(
          Roll35e.safeEvaluateCondition("'@tag'==='a&&b'", { tag: 'a&&b' }),
        ).toBe(true);
      });
    });

    describe('compound &&', () => {
      it('requires every conjunct to hold', () => {
        const data = { skillId: 'coc', other: 'x' };
        expect(
          Roll35e.safeEvaluateCondition("'@skillId'==='coc' && '@other'==='x'", data),
        ).toBe(true);
        expect(
          Roll35e.safeEvaluateCondition("'@skillId'==='coc' && '@other'==='y'", data),
        ).toBe(false);
      });

      it('tolerates spaces around &&', () => {
        expect(
          Roll35e.safeEvaluateCondition("  '@a'==='1'  &&  '@b'==='2' ", { a: 1, b: 2 }),
        ).toBe(true);
      });
    });

    describe('numeric and strict typing', () => {
      it('compares bare numbers after substitution', () => {
        expect(Roll35e.safeEvaluateCondition('@n===5', { n: 5 })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('@n===5', { n: 4 })).toBe(false);
      });

      it('is strict: string "5" !== number 5', () => {
        expect(Roll35e.safeEvaluateCondition("'5'===@n", { n: 5 })).toBe(false);
      });

      it('allows string "5" on both sides', () => {
        expect(Roll35e.safeEvaluateCondition("'@s'==='5'", { s: '5' })).toBe(true);
      });
    });

    describe('boolean and null literals', () => {
      it('compares true and false', () => {
        expect(Roll35e.safeEvaluateCondition('true===@t', { t: true })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('false===@f', { f: false })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('true===@f', { f: false })).toBe(false);
      });

      it('compares null for missing paths (missing → null token)', () => {
        expect(Roll35e.safeEvaluateCondition('@missing===null', {})).toBe(true);
      });
    });

    describe('operands that need Roll35e.safeEvaluate', () => {
      it('evaluates math on a side', () => {
        expect(Roll35e.safeEvaluateCondition('floor(@level/3)===3', { level: 9 })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('floor(@level/3)===2', { level: 9 })).toBe(false);
      });
    });

    describe('comparison operators (> >= < <= !==)', () => {
      it('> is true when left is greater', () => {
        expect(Roll35e.safeEvaluateCondition('@n > 1', { n: 5 })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('@n > 5', { n: 5 })).toBe(false);
      });

      it('>= is true when left equals or exceeds', () => {
        expect(Roll35e.safeEvaluateCondition('@n >= 5', { n: 5 })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('@n >= 5', { n: 6 })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('@n >= 5', { n: 4 })).toBe(false);
      });

      it('< is true when left is less', () => {
        expect(Roll35e.safeEvaluateCondition('@n < 5', { n: 3 })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('@n < 5', { n: 5 })).toBe(false);
      });

      it('<= is true when left is less or equal', () => {
        expect(Roll35e.safeEvaluateCondition('@n <= 5', { n: 5 })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('@n <= 5', { n: 4 })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('@n <= 5', { n: 6 })).toBe(false);
      });

      it('!== is true when values differ', () => {
        expect(Roll35e.safeEvaluateCondition('@n !== 5', { n: 4 })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('@n !== 5', { n: 5 })).toBe(false);
      });

      it('bardic inspiration style: rank > threshold && level > threshold', () => {
        const data = { skills: { prf: { subSkills: { prf1: { rank: 13 } } } }, classes: { bard: { level: 10 } } };
        expect(Roll35e.safeEvaluateCondition(
          '@skills.prf.subSkills.prf1.rank > 12 && @classes.bard.level > 9', data,
        )).toBe(true);
        expect(Roll35e.safeEvaluateCondition(
          '@skills.prf.subSkills.prf1.rank > 12 && @classes.bard.level > 9',
          { skills: { prf: { subSkills: { prf1: { rank: 5 } } } }, classes: { bard: { level: 10 } } },
        )).toBe(false);
      });

      it('feat requirement style: rank >= threshold', () => {
        expect(Roll35e.safeEvaluateCondition('@skills.spl.rank >= 5', { skills: { spl: { rank: 5 } } })).toBe(true);
        expect(Roll35e.safeEvaluateCondition('@skills.spl.rank >= 5', { skills: { spl: { rank: 4 } } })).toBe(false);
      });
    });

    describe('bare truthy operand (no comparison operator)', () => {
      it('@item.finesseable true → condition true (Weapon Finesse use-case)', () => {
        // replaceFormulaData converts boolean → "true" in mock (→ "1" in Foundry).
        // _tryParseConditionLiteral handles both "true" and "1" as truthy.
        expect(Roll35e.safeEvaluateCondition('@item.finesseable', { item: { finesseable: true } })).toBe(true);
      });

      it('@item.finesseable false → condition false', () => {
        expect(Roll35e.safeEvaluateCondition('@item.finesseable', { item: { finesseable: false } })).toBe(false);
      });

      it('@item.finesseable missing key → condition false', () => {
        expect(Roll35e.safeEvaluateCondition('@item.finesseable', { item: {} })).toBe(false);
      });

      it('@item.finesseable explicit falsy values → condition false', () => {
        expect(Roll35e.safeEvaluateCondition('@item.finesseable', { item: { finesseable: null } })).toBe(false);
        expect(Roll35e.safeEvaluateCondition('@item.finesseable', { item: { finesseable: 0 } })).toBe(false);
      });

      it('completely missing data key leaves unresolved @ref → condition false', () => {
        // No "item" key at all — _hasUnresolvedDataRef guard should catch it.
        expect(Roll35e.safeEvaluateCondition('@item.finesseable', {})).toBe(false);
      });

      it('bare truthy in && chain works with comparison ops', () => {
        const data = { item: { finesseable: true }, n: 5 };
        expect(Roll35e.safeEvaluateCondition('@item.finesseable && @n===5', data)).toBe(true);
        expect(Roll35e.safeEvaluateCondition('@item.finesseable && @n===6', data)).toBe(false);
      });

      it('bare numeric 1 is truthy, 0 is falsy', () => {
        expect(Roll35e.safeEvaluateCondition('1', {})).toBe(true);
        expect(Roll35e.safeEvaluateCondition('0', {})).toBe(false);
      });
    });

    describe('sad paths / rejection', () => {
      it('returns false when there is no top-level operator and value is non-literal', () => {
        expect(Roll35e.safeEvaluateCondition('just text', {})).toBe(false);
      });

      it('returns false when === has no right operand', () => {
        expect(Roll35e.safeEvaluateCondition("'a'===", {})).toBe(false);
      });

      it('returns false when === has no left operand', () => {
        expect(Roll35e.safeEvaluateCondition("==='b'", {})).toBe(false);
      });

      it('returns false when a roll operand hits the NaN guard', () => {
        expect(Roll35e.safeEvaluateCondition('NaN===0', {})).toBe(false);
      });
    });

    describe('substituteConditionReferences', () => {
      it('delegates to Roll.replaceFormulaData with missing null', () => {
        expect(Roll35e.substituteConditionReferences("'@x'==='y'", { x: 'y' })).toBe("'y'==='y'");
      });
    });
  });

});
