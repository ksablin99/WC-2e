/** Sentinel: operand could not be reduced to a comparable value. */
const CONDITION_OPERAND_INVALID = Symbol("CONDITION_OPERAND_INVALID");

export class Roll35e extends Roll {
    static get name() {
        return "Roll";
    }

    /**
     * Override Foundry's Roll.create which uses CONFIG.Dice.rolls[0] — that
     * would skip Roll35e.parse() and its _preProcess hook.  Always instantiate
     * as Roll35e so preprocessing (ternary, sizeRoll, NaN guard, etc.) fires.
     */
    static create(formula, data = {}, options = {}) {
        return new this(formula, data, options);
    }

    /**
     * Substitute \@keys using Foundry’s {@link Roll.replaceFormulaData} rules.
     * Intended for small condition fragments (one side of a {@code ===}).
     *
     * @param {string} fragment
     * @param {object} data
     * @returns {string}
     */
    static substituteConditionReferences(fragment, data) {
        return Roll35e.replaceFormulaData(String(fragment ?? "").trim(), data, { missing: "null" });
    }

    /**
     * Evaluate a combat-change style boolean condition without sending the full
     * expression through Foundry’s Roll grammar (which cannot resolve string
     * equalities like {@code '@skillId'==='coc'}).
     *
     * Supported shape: one or more comparisons (===, !==, >=, <=, >, <) joined
     * by {@code &&}.  Each side is substituted with {@link Roll.replaceFormulaData},
     * then either parsed as a literal (quoted string, number, true/false/null) or
     * evaluated with {@link Roll35e.safeEvaluate} when dice / math remain.
     *
     * @param {string} condition
     * @param {object} data
     * @returns {boolean}
     */
    static safeEvaluateCondition(condition, data = {}) {
        if (condition == null || String(condition).trim() === "") return true;
        const chunks = Roll35e._splitTopLevelAnd(String(condition));
        for (const chunk of chunks) {
            const cmp = Roll35e._splitComparison(chunk);
            if (!cmp) {
                // Bare operand — no comparison operator.
                // Substitute data refs, then accept only plain literals (number /
                // boolean / null / quoted string).  Dice expressions like "1d20"
                // are NOT valid bare conditions and keep returning false.
                // Handles "@item.finesseable" (boolean true → "1" → 1, truthy).
                const sub = Roll35e.substituteConditionReferences(chunk, data);
                if (Roll35e._hasUnresolvedDataRef(sub)) return false;
                const lit = Roll35e._tryParseConditionLiteral(sub);
                if (lit === undefined || !lit) return false;
                continue;
            }
            const left = Roll35e._evaluateConditionOperand(cmp.left, data);
            const right = Roll35e._evaluateConditionOperand(cmp.right, data);
            if (left === CONDITION_OPERAND_INVALID || right === CONDITION_OPERAND_INVALID) return false;
            switch (cmp.op) {
                case "===": if (!Object.is(left, right)) return false; break;
                case "!==": if (Object.is(left, right)) return false; break;
                case ">=":  if (!(left >= right)) return false; break;
                case "<=":  if (!(left <= right)) return false; break;
                case ">":   if (!(left > right)) return false; break;
                case "<":   if (!(left < right)) return false; break;
                default: return false;
            }
        }
        return true;
    }

    /**
     * @param {string} str
     * @returns {string[]}
     */
    static _splitTopLevelAnd(str) {
        const parts = [];
        let start = 0;
        let q = null;
        for (let i = 0; i < str.length; i++) {
            const c = str[i];
            if (q) {
                if (c === "\\" && q === '"') {
                    i++;
                    continue;
                }
                if (c === q) q = null;
                continue;
            }
            if (c === "'" || c === '"') {
                q = c;
                continue;
            }
            if (c === "&" && str[i + 1] === "&") {
                const piece = str.slice(start, i).trim();
                if (piece) parts.push(piece);
                start = i + 2;
                i++;
            }
        }
        const last = str.slice(start).trim();
        if (last) parts.push(last);
        return parts.length ? parts : [str.trim()];
    }

    /**
     * Split a single comparison chunk into { left, op, right }.
     * Operators tried longest-first to avoid ambiguity (e.g. >= before >).
     *
     * @param {string} str
     * @returns {{ left: string, op: string, right: string }|null}
     */
    static _splitComparison(str) {
        const OPS = ["===", "!==", ">=", "<=", ">", "<"];
        let q = null;
        for (let i = 0; i < str.length; i++) {
            const c = str[i];
            if (q) {
                if (c === "\\" && q === '"') { i++; continue; }
                if (c === q) q = null;
                continue;
            }
            if (c === "'" || c === '"') { q = c; continue; }
            for (const op of OPS) {
                if (str.slice(i, i + op.length) === op) {
                    const left = str.slice(0, i).trim();
                    const right = str.slice(i + op.length).trim();
                    if (!left || !right) return null;
                    return { left, op, right };
                }
            }
        }
        return null;
    }

    /**
     * @param {string} raw
     * @param {object} data
     * @returns {unknown|symbol}
     */
    static _evaluateConditionOperand(raw, data) {
        const sub = Roll35e.substituteConditionReferences(raw, data);
        if (Roll35e._hasUnresolvedDataRef(sub)) return CONDITION_OPERAND_INVALID;

        const lit = Roll35e._tryParseConditionLiteral(sub);
        if (lit !== undefined) return lit;

        const roll = Roll35e.safeEvaluate(sub, data, null, { suppressError: true });
        if (roll.err) return CONDITION_OPERAND_INVALID;
        return Roll35e._coerceRollConditionTotal(roll.total);
    }

    static _hasUnresolvedDataRef(s) {
        const rune = "\u1696";
        let t = String(s);
        for (let i = 0; (i = t.indexOf(rune)) !== -1; ) {
            const j = t.indexOf(rune, i + 1);
            if (j === -1) break;
            t = t.slice(0, i) + t.slice(j + 1);
        }
        return /@([a-z.0-9_-]+)/i.test(t);
    }

    /**
     * Parse a fully substituted fragment into a primitive, or {@code undefined} if not a plain literal.
     * Strips a layer of surrounding quotes (including JSON strings).
     *
     * @param {string} s
     * @returns {unknown|undefined}
     */
    static _tryParseConditionLiteral(s) {
        const t = String(s).trim();
        if (t === "") return "";

        const rune = "\u1696";
        if (t.startsWith(rune) && t.endsWith(rune) && t.length > 2) {
            try {
                return JSON.parse(t.slice(1, -1));
            } catch {
                return undefined;
            }
        }

        if (t === "true") return true;
        if (t === "false") return false;
        if (t === "null") return null;

        if (t.startsWith('"') && t.endsWith('"')) {
            try {
                return JSON.parse(t);
            } catch {
                return t.slice(1, -1).replace(/\\"/g, '"');
            }
        }

        if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
            return t.slice(1, -1).replace(/\\'/g, "'");
        }

        if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) return Number(t);

        return undefined;
    }

    /**
     * @param {unknown} total
     * @returns {unknown|symbol}
     */
    static _coerceRollConditionTotal(total) {
        if (total === null || total === undefined) return CONDITION_OPERAND_INVALID;
        if (typeof total === "boolean" || typeof total === "number") {
            if (typeof total === "number" && !Number.isFinite(total)) return CONDITION_OPERAND_INVALID;
            return total;
        }
        if (typeof total === "string") {
            const s = total.trim();
            const inner = /^"(.*)"$/.exec(s);
            if (inner) return inner[1].replace(/\\"/g, '"');
            const inner2 = /^'(.*)'$/.exec(s);
            if (inner2) return inner2[1].replace(/\\'/g, "'");
            const lit = Roll35e._tryParseConditionLiteral(s);
            if (lit !== undefined) return lit;
            return s;
        }
        return CONDITION_OPERAND_INVALID;
    }

    static safeEvaluate(formula, data = {}, context, options = {}) {
        const suppressError = options.suppressError === true;
        let roll;
        try {
            roll = this.create(formula, data).evaluateSync();
        } catch (err) {
            roll = this.create("0", data).evaluateSync();
            roll.err = err;
        }
        if (roll.warning) roll.err = Error("This formula had a value replaced with null.");
        if (roll.err) {
            if (context && !suppressError) game.D35E.logger.error(context, roll.err);
            else if (CONFIG.debug.roll) game.D35E.logger.error(roll.err);
        }
        return roll;
    }

    static parse(formula, data = {}) {
        const originalFormula = formula;
        if (formula.indexOf("NaN") >= 0) {
            throw new Error("D35E | Invalid pre-parsed formula: " + formula);
        }
        // Apply formula pre-processing for math functions (pow, floor, max, min, etc.)
        // Roll35e._preProcess is set by dice.js after import to avoid circular dependency
        if (Roll35e._preProcess) {
            try {
                formula = Roll35e._preProcess(formula, data);
            } catch (e) {
                // ignore preprocessing errors and let the parser handle it
            }
        }
        // look for sizeRoll(origCount, origSides, targetSize = "M", crit = 1) in formula and replace it with preprocessed version
        formula = formula.replace(/sizeRoll\((\d+)\s?,\s?(\d+)\s?,\s?([a-zA-Z\-0-9\@\.]+)?\s?,\s?([a-zA-Z\-0-9\@\.]+)??\)/g, (match, origCount, origSides, targetSize, crit) => {
            
            let preProcess = game.D35E.rollPreProcess.sizeRoll
            if (preProcess) {
                targetSize = this.replaceFormulaData(targetSize ?? "M", data);
                crit = this.replaceFormulaData(crit ?? 1, data);
                return preProcess(origCount, origSides, targetSize ?? "M", crit ?? 1)
            }
            return match
        })

        // look for sizeNaturalRoll(block, targetSize = "M", crit = 1) in formula and replace it with preprocessed version
        formula = formula.replace(/sizeNaturalRoll\((\d+)\s?,\s?([a-zA-Z\-0-9\@\.]+)?\s?,\s?([a-zA-Z\-0-9\@\.]+)??\)/g, (match, block, targetSize, crit) => {
            let preProcess = game.D35E.rollPreProcess.sizeNaturalRoll
            if (preProcess) {
                targetSize = this.replaceFormulaData(targetSize ?? "M", data);
                crit = this.replaceFormulaData(crit ?? 1, data);
                return preProcess(block, targetSize ?? "M", crit ?? 1)
            }
            return match
        })

        // look for sizeMonkDamageRoll(level, targetSize = "M", crit = 1) in formula and replace it with preprocessed version
        formula = formula.replace(/sizeMonkDamageRoll\((\d+)\s?,\s?([a-zA-Z\-0-9\@\.]+)?\s?,\s?([a-zA-Z\-0-9\@\.]+)??\)/g, (match, level, targetSize, crit) => {
            let preProcess = game.D35E.rollPreProcess.sizeMonkDamageRoll
            if (preProcess) {
                targetSize = this.replaceFormulaData(targetSize ?? "M", data);
                crit = this.replaceFormulaData(crit ?? 1, data);
                return preProcess(level, targetSize ?? "M", crit ?? 1)
            }
            return match
        })

        if (formula.indexOf("NaN") >= 0) {
            throw new Error("D35E | Invalid parsed formula:", originalFormula, formula);
        }

        // return result of the original parse method from super class using new formula
        return super.parse(formula, data);

    }
}


