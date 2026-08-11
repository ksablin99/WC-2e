/**
 * Integration tests for Roll35e using Foundry v13's actual Roll parser.
 *
 * Unlike the unit tests in test/module/, these tests import Foundry's real
 * dice engine so we can verify that formula syntax (pow, floor, %, etc.)
 * works as expected in the actual runtime environment.
 */

import { Roll35e } from '../../module/roll.js';
// Import dice.js to wire up Roll35e._preProcess (the _preProcessDiceFormula hook)
import { _preProcessDiceFormula } from '../../module/dice.js';

// ── Helper ───────────────────────────────────────────────────────────────────

function evaluate(formula, data = {}) {
  return Roll35e.safeEvaluate(formula, data);
}

// ── Basic arithmetic (sanity check that Foundry Roll works at all) ────────────

describe('Foundry v13 Roll — basic arithmetic', () => {
  it('evaluates a constant', () => {
    expect(evaluate('5').total).toBe(5);
  });

  it('evaluates addition', () => {
    expect(evaluate('3 + 4').total).toBe(7);
  });

  it('evaluates multiplication', () => {
    expect(evaluate('3 * 4').total).toBe(12);
  });

  it('evaluates division', () => {
    expect(evaluate('10 / 4').total).toBeCloseTo(2.5);
  });

  it('evaluates subtraction', () => {
    expect(evaluate('10 - 3').total).toBe(7);
  });

  it('evaluates @data reference substitution', () => {
    expect(evaluate('@level', { level: 5 }).total).toBe(5);
  });

  it('evaluates nested @data path', () => {
    expect(evaluate('@attr.mod', { attr: { mod: 3 } }).total).toBe(3);
  });
});

// ── Modulo operator (%) ───────────────────────────────────────────────────────

describe('Foundry v13 Roll — modulo operator (%)', () => {
  it('evaluates 10 % 3 = 1', () => {
    expect(evaluate('10 % 3').total).toBe(1);
  });

  it('evaluates 16 % 5 = 1', () => {
    expect(evaluate('16 % 5').total).toBe(1);
  });

  it('evaluates @str % 5 with data', () => {
    expect(evaluate('@str % 5', { str: 16 }).total).toBe(1);
  });
});

// ── Math functions via Foundry FunctionTerm / CONFIG.Dice.functions ───────────

describe('Foundry v13 Roll — native math functions', () => {
  it('evaluates floor(3.9)', () => {
    expect(evaluate('floor(3.9)').total).toBe(3);
  });

  it('evaluates ceil(3.1)', () => {
    expect(evaluate('ceil(3.1)').total).toBe(4);
  });

  it('evaluates round(3.5)', () => {
    expect(evaluate('round(3.5)').total).toBe(4);
  });

  it('evaluates max(4, 7)', () => {
    expect(evaluate('max(4, 7)').total).toBe(7);
  });

  it('evaluates min(4, 7)', () => {
    expect(evaluate('min(4, 7)').total).toBe(4);
  });

  it('evaluates pow(2, 3)', () => {
    expect(evaluate('pow(2, 3)').total).toBe(8);
  });

  it('evaluates abs(-5)', () => {
    expect(evaluate('abs(-5)').total).toBe(5);
  });

  it('evaluates sqrt(9)', () => {
    expect(evaluate('sqrt(9)').total).toBe(3);
  });

  it('evaluates floor(@level / 3) with data', () => {
    expect(evaluate('floor(@level / 3)', { level: 10 }).total).toBe(3);
  });

  it('evaluates pow(2, @exp) with data', () => {
    expect(evaluate('pow(2, @exp)', { exp: 4 }).total).toBe(16);
  });

  it('evaluates nested: floor(pow(2, 3.9))', () => {
    // pow(2, 3.9) ≈ 14.93 → floor = 14
    expect(evaluate('floor(pow(2, 3.9))').total).toBe(14);
  });

  it('evaluates max(@str, 11) with data', () => {
    expect(evaluate('max(@str, 11)', { str: 16 }).total).toBe(16);
  });
});

// ── Carry capacity formula (the real-world formula from CONFIG.D35E) ──────────

describe('Foundry v13 Roll — carry capacity formula', () => {
  // Full formula from D35E.carryingCapacityFormula
  const formula =
    '(10*@str)*(max(@str,11)-@str)/(max(11-@str,1))' +
    '+(5*pow(2,(-2)+floor(@str/5)))*(20+floor(47*pow(2,0.1*(@str%5))-47))' +
    '*(min(@str,10)-@str)/(min(10-@str,-1))';

  it('produces a non-zero result for STR 16', () => {
    expect(evaluate(formula, { str: 16 }).total).toBeGreaterThan(0);
  });

  it('produces the correct heavy load for STR 16 (230 lb)', () => {
    expect(Math.round(evaluate(formula, { str: 16 }).total)).toBe(230);
  });

  it('produces the correct heavy load for STR 10 (100 lb)', () => {
    expect(Math.round(evaluate(formula, { str: 10 }).total)).toBe(100);
  });

  it('produces the correct heavy load for STR 1 (10 lb)', () => {
    expect(Math.round(evaluate(formula, { str: 1 }).total)).toBe(10);
  });

  it('produces the correct heavy load for STR 20 (400 lb)', () => {
    expect(Math.round(evaluate(formula, { str: 20 }).total)).toBe(400);
  });

  it('produces 0 for STR 0', () => {
    expect(evaluate(formula, { str: 0 }).total).toBe(0);
  });
});

// ── Saving throw formulas ─────────────────────────────────────────────────────

describe('Foundry v13 Roll — saving throw formulas', () => {
  it('evaluates poor save: floor(@level / 3) at level 9', () => {
    expect(evaluate('floor(@level / 3)', { level: 9 }).total).toBe(3);
  });

  it('evaluates good save: 2 + floor(@level / 2) at level 8', () => {
    expect(evaluate('2 + floor(@level / 2)', { level: 8 }).total).toBe(6);
  });
});

// ── Roll35e.parse() — NaN guard ───────────────────────────────────────────────

describe('Roll35e.parse — NaN guard', () => {
  it('safeEvaluate returns err when formula contains NaN', () => {
    const roll = evaluate('NaN + 1');
    expect(roll.total).toBe(0);
    expect(roll.err).toBeDefined();
  });
});

// ── Multi-depth @data paths ───────────────────────────────────────────────────

describe('Foundry v13 Roll — multi-depth @data paths', () => {
  it('resolves @classes.bard.level', () => {
    expect(evaluate('@classes.bard.level', { classes: { bard: { level: 5 } } }).total).toBe(5);
  });

  it('resolves @abilities.str.mod', () => {
    expect(evaluate('@abilities.str.mod', { abilities: { str: { mod: 4 } } }).total).toBe(4);
  });

  it('resolves @skills.khi.rank', () => {
    expect(evaluate('@skills.khi.rank', { skills: { khi: { rank: 8 } } }).total).toBe(8);
  });
});

// ── Roll35e.safeEvaluateCondition (real Foundry replaceFormulaData + rolls) ───

describe('Foundry v13 — Roll35e.safeEvaluateCondition', () => {
  it('single-quoted @skillId matches (combat-change pack shape)', () => {
    expect(Roll35e.safeEvaluateCondition("'@skillId'==='coc'", { skillId: 'coc' })).toBe(true);
    expect(Roll35e.safeEvaluateCondition("'@skillId'==='coc'", { skillId: 'apr' })).toBe(false);
  });

  it('double-quoted @skillId matches', () => {
    expect(Roll35e.safeEvaluateCondition('"@skillId"==="coc"', { skillId: 'coc' })).toBe(true);
  });

  it('compound && with two quoted checks', () => {
    const data = { skillId: 'coc', other: 'x' };
    expect(
      Roll35e.safeEvaluateCondition("'@skillId'==='coc' && '@other'==='x'", data),
    ).toBe(true);
    expect(
      Roll35e.safeEvaluateCondition("'@skillId'==='coc' && '@other'==='y'", data),
    ).toBe(false);
  });

  it('numeric equality and strict string vs number', () => {
    expect(Roll35e.safeEvaluateCondition('@n===5', { n: 5 })).toBe(true);
    expect(Roll35e.safeEvaluateCondition("'5'===@n", { n: 5 })).toBe(false);
  });

  it('operand uses real Roll for math (floor)', () => {
    expect(Roll35e.safeEvaluateCondition('floor(@level/3)===3', { level: 9 })).toBe(true);
  });

  it('dice-only bare condition returns false (no comparison op, not a plain literal)', () => {
    expect(Roll35e.safeEvaluateCondition('1d20', {})).toBe(false);
  });

  it('empty condition is true', () => {
    expect(Roll35e.safeEvaluateCondition('', {})).toBe(true);
  });

  it('bare @item.finesseable — boolean true resolves to 1 (truthy)', () => {
    // Weapon Finesse feat uses "@item.finesseable" with no comparison operator.
    // replaceFormulaData converts boolean true → "1" → parsed as 1 (truthy).
    expect(Roll35e.safeEvaluateCondition('@item.finesseable', { item: { finesseable: true } })).toBe(true);
  });

  it('bare @item.finesseable — boolean false resolves to 0 (falsy)', () => {
    expect(Roll35e.safeEvaluateCondition('@item.finesseable', { item: { finesseable: false } })).toBe(false);
  });

  it('bare @item.finesseable — missing key resolves to null (falsy)', () => {
    expect(Roll35e.safeEvaluateCondition('@item.finesseable', { item: {} })).toBe(false);
  });

  it('bare truthy in && chain still requires all chunks to be truthy', () => {
    const data = { item: { finesseable: true }, n: 5 };
    expect(Roll35e.safeEvaluateCondition('@item.finesseable && @n===5', data)).toBe(true);
    expect(Roll35e.safeEvaluateCondition('@item.finesseable && @n===6', data)).toBe(false);
  });
});

// ── Ternary operator in formulas ──────────────────────────────────────────────
// _preProcessDiceFormula handles ternary ? : before Foundry's parser sees the
// formula (Foundry's Peggy grammar does not support ? :).


describe('_preProcessDiceFormula — ternary pre-processing', () => {
  it('transforms (expr ? a : b) to its value', () => {
    expect(_preProcessDiceFormula('(@level > 4 ? 1 : 0)', { level: 5 })).toBe('1');
    expect(_preProcessDiceFormula('(@level > 4 ? 1 : 0)', { level: 3 })).toBe('0');
  });

  it('handles adjacent ternary groups', () => {
    const f = '(@level > 4 ? 1 : 0) + (@level > 9 ? 1 : 0)';
    expect(_preProcessDiceFormula(f, { level: 10 })).toBe('1 + 1');
    expect(_preProcessDiceFormula(f, { level: 6 })).toBe('1 + 0');
    expect(_preProcessDiceFormula(f, { level: 2 })).toBe('0 + 0');
  });

  it('handles a nested ternary from the paladin mount progression formula', () => {
    const f = '(@level > 14 ? 7 : (@level > 10 ? 6 : (@level > 7 ? 5 : 4)))';
    expect(_preProcessDiceFormula(f, { level: 15 })).toBe('7');
    expect(_preProcessDiceFormula(f, { level: 11 })).toBe('6');
    expect(_preProcessDiceFormula(f, { level: 8 })).toBe('5');
    expect(_preProcessDiceFormula(f, { level: 7 })).toBe('4');
  });

  it('handles the exact nested ternary damage formula from issue 1545', () => {
    const f = '(@cl < 7 ? 1d6 : (@cl < 9 ? 1d8 : (@cl < 11 ? 1d10 : 1d12)))';
    expect(_preProcessDiceFormula(f, { cl: 6 })).toBe('1d6');
    expect(_preProcessDiceFormula(f, { cl: 8 })).toBe('1d8');
    expect(_preProcessDiceFormula(f, { cl: 10 })).toBe('1d10');
    expect(_preProcessDiceFormula(f, { cl: 11 })).toBe('1d12');
  });
});

describe('Foundry v13 Roll — ternary via _preProcessDiceFormula', () => {
  it('evaluates a simple ternary (true branch)', () => {
    expect(evaluate('(@level > 4 ? 1 : 0)', { level: 5 }).total).toBe(1);
  });

  it('evaluates a simple ternary (false branch)', () => {
    expect(evaluate('(@level > 4 ? 1 : 0)', { level: 3 }).total).toBe(0);
  });

  it('evaluates a compound ternary sum', () => {
    const formula = '(@level > 4 ? 1 : 0) + (@level > 9 ? 1 : 0)';
    expect(evaluate(formula, { level: 10 }).total).toBe(2);
    expect(evaluate(formula, { level: 6 }).total).toBe(1);
    expect(evaluate(formula, { level: 2 }).total).toBe(0);
  });

  it('evaluates a skill-check ternary bonus', () => {
    const formula = '@bardLevel + @intMod + (@khiRank >= 5 ? 2 : 0)';
    expect(evaluate(formula, { bardLevel: 4, intMod: 2, khiRank: 5 }).total).toBe(8);
    expect(evaluate(formula, { bardLevel: 4, intMod: 2, khiRank: 3 }).total).toBe(6);
  });

  it('evaluates a nested ternary from the paladin mount progression formula', () => {
    const formula = '(@level > 14 ? 7 : (@level > 10 ? 6 : (@level > 7 ? 5 : 4)))';
    expect(evaluate(formula, { level: 15 }).total).toBe(7);
    expect(evaluate(formula, { level: 11 }).total).toBe(6);
    expect(evaluate(formula, { level: 8 }).total).toBe(5);
    expect(evaluate(formula, { level: 7 }).total).toBe(4);
  });

  it('resolves ternary whose condition contains parens — issue 1679', () => {
    // (4) > 2 ? (4) : 0 — condition and true-branch wrapped in parens,
    // unreachable by the [^()]* regex alone; handled by _processFunctionArgs.
    expect(evaluate('(4) > 2 ? (4) : 0', {}).total).toBe(4);
    expect(evaluate('(1) > 2 ? (4) : 0', {}).total).toBe(0);
  });

  it('resolves ternary nested inside function args — issue 1679', () => {
    // max(0,-5 + max(5, (4) > 2 ? (4) : 0)) from the bug report.
    // The ? sits at paren depth 2 so _processFunctionArgs resolves it.
    expect(evaluate('max(0,-5 + max(5, (4) > 2 ? (4) : 0))', {}).total).toBe(0);
    expect(evaluate('max(0, 3 + max(5, (4) > 2 ? (4) : 0))', {}).total).toBe(8);
  });

  it('resolves top-level ternary with > — issue 1679', () => {
    expect(evaluate('3 > 2 ? 3 : 4', {}).total).toBe(3);
    expect(evaluate('1 > 2 ? 3 : 4', {}).total).toBe(4);
  });
});

// ── || coalesce operator ──────────────────────────────────────────────────────

describe('Foundry v13 Roll — || coalesce operator', () => {
  it('evaluates (@level || 0) when @ref is defined', () => {
    expect(evaluate('(@level || 0)', { level: 5 }).total).toBe(5);
  });

  it('evaluates (@level || 0) when @ref is missing — fallback 0', () => {
    expect(evaluate('(@level || 0)', {}).total).toBe(0);
  });

  it('evaluates full issue-1683 formula — true branch (max >= 8)', () => {
    const data = {
      classes: { fighter: { level: 5 }, warblade: { level: 3 } },
      attributes: { hd: { total: 10 } },
    };
    // fighter(5)+warblade(3-2=1)=6; max(6, floor((10-6)/2)+6)=max(6,8)=8 ≥ 8 → 1+1=2
    const formula =
      '1 + (max(((@classes.fighter.level || 0) + (@classes.warblade.level-2 || 0)),' +
      '(floor((@attributes.hd.total - ((@classes.fighter.level || 0) + ' +
      '(@classes.warblade.level-2 || 0))) / 2))+((@classes.fighter.level || 0) + ' +
      '(@classes.warblade.level-2 || 0)))>= 8 ? 1 : 0)';
    expect(evaluate(formula, data).total).toBe(2);
  });

  it('evaluates full issue-1683 formula — false branch (all class levels missing)', () => {
    const data = { attributes: { hd: { total: 3 } } };
    const formula =
      '1 + (max(((@classes.fighter.level || 0) + (@classes.warblade.level-2 || 0)),' +
      '(floor((@attributes.hd.total - ((@classes.fighter.level || 0) + ' +
      '(@classes.warblade.level-2 || 0))) / 2))+((@classes.fighter.level || 0) + ' +
      '(@classes.warblade.level-2 || 0)))>= 8 ? 1 : 0)';
    // all class levels 0; max(0,...) < 8 → 1+0=1
    expect(evaluate(formula, data).total).toBe(1);
  });
});

// ── Deeply nested max/min/ceil (attackCountFormula pattern) ──────────────────

describe('Foundry v13 Roll — deeply nested max/min/ceil', () => {
  it('evaluates max(min(5, ceil(@cl/2)), 1) — attackCountFormula', () => {
    expect(evaluate('max(min(5, ceil(@cl/2)), 1)', { cl: 10 }).total).toBe(5);
    expect(evaluate('max(min(5, ceil(@cl/2)), 1)', { cl: 2 }).total).toBe(1);
    expect(evaluate('max(min(5, ceil(@cl/2)), 1)', { cl: 0 }).total).toBe(1);
  });

  it('evaluates 10*min(150, max(1, floor(@level)))', () => {
    expect(evaluate('10*min(150, max(1, floor(@level)))', { level: 7 }).total).toBe(70);
    expect(evaluate('10*min(150, max(1, floor(@level)))', { level: 0 }).total).toBe(10);
    expect(evaluate('10*min(150, max(1, floor(@level)))', { level: 200 }).total).toBe(1500);
  });
});

// ── sizeNaturalRoll and sizeMonkDamageRoll preprocessing ─────────────────────

describe('Foundry v13 Roll — sizeNaturalRoll and sizeMonkDamageRoll', () => {
  beforeEach(() => {
    game.D35E.rollPreProcess.sizeNaturalRoll = (count, size, crit) => `${count}d6`;
    game.D35E.rollPreProcess.sizeMonkDamageRoll = (level, size, crit) => `1d${level < 12 ? 8 : 10}`;
    game.D35E.rollPreProcess.sizeRoll = (count, sides, size, crit) => `${count}d${sides}`;
  });

  afterEach(() => {
    delete game.D35E.rollPreProcess.sizeNaturalRoll;
    delete game.D35E.rollPreProcess.sizeMonkDamageRoll;
    delete game.D35E.rollPreProcess.sizeRoll;
  });

  it('sizeNaturalRoll() is preprocessed without throwing', () => {
    expect(() => evaluate('sizeNaturalRoll(1, @size, @critMult)', { size: 4, critMult: 2 })).not.toThrow();
  });

  it('sizeMonkDamageRoll() is preprocessed without throwing', () => {
    expect(() => evaluate('sizeMonkDamageRoll(@classes.monk.level, @size, @critMult)', {
      classes: { monk: { level: 10 } }, size: 4, critMult: 2,
    })).not.toThrow();
  });

  it('sizeRoll() with @data args is preprocessed without throwing', () => {
    expect(() => evaluate('sizeRoll(1, 6, @size, @critMult)', { size: 4, critMult: 2 })).not.toThrow();
  });
});
