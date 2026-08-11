import { ChatMessagePF } from "./sidebar/chat-message.js";
import { CHAT_MESSAGE_STYLE_KEY, getRollModesForSelect } from "./lib.js";

import {Roll35e} from "./roll.js"

export class DicePF {

  /**
   * A standardized helper function for managing core 5e "d20 rolls"
   *
   * Holding SHIFT, ALT, or CTRL when the attack is rolled will "fast-forward".
   * This chooses the default options of a normal attack with no bonus, Advantage, or Disadvantage respectively
   *
   * @param {Event} event           The triggering event which initiated the roll
   * @param {Array} parts           The dice roll component parts, excluding the initial d20
   * @param {Actor} actor           The Actor making the d20 roll
   * @param {Object} data           Actor or item data against which to parse the roll
   * @param {String} template       The HTML template used to render the roll dialog
   * @param {String} title          The dice roll UI window title
   * @param {Object} speaker        The ChatMessage speaker to pass when creating the chat
   * @param {Function} flavor       A callable function for determining the chat message flavor given parts and data
   * @param {Boolean} takeTwenty    Allow rolling with take twenty (and therefore also with take ten)
   * @param {Boolean} situational   Allow for an arbitrary situational bonus field
   * @param {Boolean} fastForward   Allow fast-forward advantage selection
   * @param {Number} critical       The value of d20 result which represents a critical success
   * @param {Number} fumble         The value of d20 result which represents a critical failure
   * @param {Function} onClose      Callback for actions to take when the dialog form is closed
   * @param {Object} dialogOptions  Modal dialog options
   * @param {Array} extraRolls      An array containing bonuses/penalties for extra rolls
   * @param {Boolean} autoRender    Whether to automatically render the chat messages
   */
  static async d20Roll({event, parts, data, template, title, speaker, flavor, takeTwenty=true, situational=true, dynamicBonuses=[],
                  fastForward=true, critical=20, fumble=1, treshold=null, onClose, dialogOptions, extraRolls=[], chatTemplate, chatTemplateData,
                  staticRoll=null }) {
    // Handle input arguments
    flavor = flavor || title;
    let rollMode = game.settings.get("core", "rollMode");
    let rolled = false;

    // Inner roll function
    let _roll = async (parts, setRoll, form) => {
      const formEl = form?.nodeType === 1 ? form : form?.[0] ?? form;
      const originalFlavor = flavor;
      rollMode = formEl ? formEl.querySelector('[name="rollMode"]')?.value : rollMode;
      const rolls = [];
      for (let a = 0; a < 1 + extraRolls.length; a++) {
        flavor = originalFlavor;
        let curParts = foundry.utils.duplicate(parts);
        data.bonus = formEl ? formEl.querySelector('[name="bonus"]')?.value : 0;
        if (!data.bonus && curParts.indexOf("@bonus") !== -1) curParts.pop();

        // Extra roll specifics
        if (a >= 1) {
          let extraRoll = extraRolls[a-1];
          curParts.push(extraRoll.bonus);
          flavor += ` <div class="extra-roll-label">${extraRoll.label}</div>`;
        }

        // Do set roll
        if (setRoll != null && setRoll >= 0) {
          curParts[0] = `${setRoll}`;
          flavor += ` (Take ${setRoll})`;
        }
        if (dynamicBonuses.length > 0) {
          for (let bonus of dynamicBonuses) {
            curParts.push(bonus.value);
          }
        }

        // Execute the roll
        let roll = await new Roll35e(curParts.join(" + "), data).roll();
        rolls.push(roll);

        // Convert the roll to a chat message
        if (chatTemplate) {
          // Create roll template data
          const d20 = roll.terms[0];
          const rollData = foundry.utils.mergeObject({
            user: game.user.id,
            formula: roll.formula,
            tooltip: await roll.getTooltip(),
            total: roll.total,
            isCrit: treshold ? roll.total >= treshold : d20.total >= critical,
            isFumble: d20.total <= fumble,
          }, chatTemplateData || {});
          rollData.dynamicBonuses = dynamicBonuses;
          // add basic roll result to rollData
          rollData.dynamicBonuses.unshift({
            name: "Roll",
            value: d20.total,
          })

          let tooltip = rollData.tooltip;
          let tableRows = '';
          for (let bonus of dynamicBonuses) {
            tableRows += `<tr><td><b>${bonus.name}</b></td><td><b>${bonus.value}</b></td></tr>`;
          }
          // add table container
          let table = `<div class="table-container"><table><tbody>${tableRows}</tbody></table></div>`;
          const tooltipTemp = document.createElement("div");
          tooltipTemp.innerHTML = tooltip;
          const tooltipPart = tooltipTemp.querySelector('.tooltip-part');
          if (tooltipPart) tooltipPart.insertAdjacentHTML("beforeend", table);
          tooltip = tooltipTemp.innerHTML;
          rollData.tooltip = tooltip;

          // Create chat data
          let chatData = {
            user: game.user.id,
            sound: a === 0 ? CONFIG.sounds.dice : null,
            speaker: speaker,
            content: await foundry.applications.handlebars.renderTemplate(chatTemplate, rollData),
            "flags.D35E.noRollRender": true,
          };
          // Handle different roll modes
          switch (rollMode) {
            case "gmroll":
              chatData["whisper"] = game.users.contents.filter(u => u.isGM).map(u => u.id);
              break;
            case "selfroll":
              chatData["whisper"] = [game.user.id];
              break;
            case "blindroll":
              chatData["whisper"] = game.users.contents.filter(u => u.isGM).map(u => u.id);
              chatData["blind"] = true;
              break;
          }

          // Send message — rolls array from toMessage() identifies this as a roll message
          rolled = true;
          chatData = foundry.utils.mergeObject(await roll.toMessage({flavor}, { create: false }), chatData);
          // Dice So Nice integration
          // if (game.dice3d != null) {
          //   await game.dice3d.showForRoll(roll, chatData.whisper, chatData.blind);
          //   chatData.sound = null;
          // }

          await ChatMessage.create(chatData);
        }
        else {
          rolled = true;
          await roll.toMessage({
            speaker: speaker,
            flavor: flavor,
            rollMode: rollMode,
            sound: a === 0 ? CONFIG.sounds.dice : null
          });
        }
      }
      return rolls;
    };

    // Modify the roll and handle fast-forwarding
    parts = ["1d20"].concat(parts);
    if (fastForward === true || event.shiftKey) return _roll(parts, staticRoll);
    else parts = parts.concat(["@bonus"]);

    // Render modal dialog
    template = template || "systems/warcraftrpg2e/templates/chat/roll-dialog.html";
    let dialogData = {
      formula: parts.join(" + "),
      data: data,
      rollMode: rollMode,
      rollModes: CONFIG.Dice.rollModes,
      rollModesForSelect: getRollModesForSelect()
    };
    const html = await foundry.applications.handlebars.renderTemplate(template, dialogData);

    let roll;
    return new Promise(resolve => {
      new Dialog({
        title: title,
        content: html,
        buttons: {
          normal: {
            label: "Normal",
            callback: html => roll = _roll(parts, staticRoll != null ? staticRoll : -1, html)
          },
          takeTen: {
            label: "Take 10",
            condition: takeTwenty,
            callback: html => roll = _roll(parts, 10, html)
          },
          takeTwenty: {
            label: "Take 20",
            condition: takeTwenty,
            callback: html => roll = _roll(parts, 20, html)
          }
        },
        default: "normal",
        close: html => {
          if ( onClose ) onClose(html, parts, data);
          resolve(rolled ? roll : false);
        }
      }, dialogOptions).render(true);
    });
  }

  /* -------------------------------------------- */

  /**
   * A standardized helper function for managing core 5e "d20 rolls"
   *
   * Holding SHIFT, ALT, or CTRL when the attack is rolled will "fast-forward".
   * This chooses the default options of a normal attack with no bonus, Critical, or no bonus respectively
   *
   * @param {Event} event           The triggering event which initiated the roll
   * @param {Array} parts           The dice roll component parts, excluding the initial d20
   * @param {Actor} actor           The Actor making the damage roll
   * @param {Object} data           Actor or item data against which to parse the roll
   * @param {String} template       The HTML template used to render the roll dialog
   * @param {String} title          The dice roll UI window title
   * @param {Object} speaker        The ChatMessage speaker to pass when creating the chat
   * @param {Function} flavor       A callable function for determining the chat message flavor given parts and data
   * @param {Boolean} critical      Allow critical hits to be chosen
   * @param {Function} onClose      Callback for actions to take when the dialog form is closed
   * @param {Object} dialogOptions  Modal dialog options
   */
  static async damageRoll({event={}, parts, actor, data, template, title, speaker, flavor, critical=true, onClose, dialogOptions, chatTemplate, chatTemplateData }) {
    flavor = flavor || title;
    let rollMode = game.settings.get("core", "rollMode");
    let rolled = false;

    // Inner roll function
    const _roll = async (crit, form) => {
      const formEl = form?.nodeType === 1 ? form : form?.[0] ?? form;
      data.bonus = formEl ? formEl.querySelector('[name="bonus"]')?.value : 0;

      // Detemrine critical multiplier
      data["critMult"] = crit ? data.item.ability.critMult : 1;
      // Determine damage ability
      data["ablMult"] = 0;
      if (data.item.ability.damageMult != null) {
        data["ablMult"] = data.item.ability.damageMult;
      }

      let roll = new Roll35e(parts.join("+"), data);
      if ( crit === true ) {
        let mult = data.item.ability.critMult || 2;

        // Update first damage part
        roll.alter(0, mult);
        flavor = `${flavor} (Critical)`;
      }

      roll.roll();

      // Convert the roll to a chat message
      if (chatTemplate) {
        // Create roll template data
        const rollData = foundry.utils.mergeObject({
          user: game.user.id,
          formula: roll.formula,
          tooltip: await roll.getTooltip(),
          total: roll.total,
        }, chatTemplateData || {});

        // Create chat data
        let chatData = {
          user: game.user.id,
          sound: CONFIG.sounds.dice,
          speaker: speaker,
          flavor: flavor,
          rollMode: rollMode,
          rolls: [roll],
          content: await foundry.applications.handlebars.renderTemplate(chatTemplate, rollData),
          useCustomContent: true,
        };
        // Handle different roll modes
        switch (chatData.rollMode) {
          case "gmroll":
            chatData["whisper"] = game.users.contents.filter(u => u.isGM).map(u => u.id);
            break;
          case "selfroll":
            chatData["whisper"] = [game.user.id];
            break;
          case "blindroll":
            chatData["whisper"] = game.users.contents.filter(u => u.isGM).map(u => u.id);
            chatData["blind"] = true;
        }

        rolled = true;
        ChatMessagePF.create(chatData);
      }
      else {
        rolled = true;
        roll.toMessage({
          speaker: speaker,
          flavor: flavor,
          rollMode: rollMode
        });
      }

      // Return the Roll object
      return roll;
    };

    // Modify the roll and handle fast-forwarding
    if (!event.shiftKey) return _roll(event.ctrlKey);
    else parts = parts.concat(["@bonus"]);

    // Construct dialog data
    template = template || "systems/warcraftrpg2e/templates/chat/roll-dialog.html";
    let dialogData = {
      formula: parts.join(" + "),
      data: data,
      rollMode: rollMode,
      rollModes: CONFIG.Dice.rollModes,
      rollModesForSelect: getRollModesForSelect()
    };
    const html = await foundry.applications.handlebars.renderTemplate(template, dialogData);

    // Render modal dialog
    let roll;
    return new Promise(resolve => {
      new Dialog({
        title: title,
        content: html,
        buttons: {
          normal: {
            label: critical ? "Normal" : "Roll",
            callback: html => roll = _roll(false, html)
          },
          critical: {
            condition: critical,
            label: "Critical Hit",
            callback: html => roll = _roll(true, html)
          },
        },
        default: "normal",
        close: html => {
          if (onClose) onClose(html, parts, data);
          resolve(rolled ? roll : false);
        }
      }, dialogOptions).render(true);
    });
  }

  static async messageRoll({data, msgStr}) {
    let re = /\[\[(.+)\]\]/g;
    return msgStr.replace(re, async (_, p1) => {
      const roll = await new Roll35e(p1, data).roll();
      return roll.total.toString();
    });

    return msgStr;
  }
}

export const _preProcessDiceFormula = function _preProcessDiceFormula(formula, data={}) {
  let formulaStr = String(formula);
  function _fillTemplate(templateString, templateVars){
    if (templateString.indexOf('$') !== -1)
      return new Function("return `"+templateString +"`;").call(templateVars);
    else
      return templateString;
  }
  function _replaceFormulaData(expr) {
    return expr.replace(/@([\w.]+)/g, (_, path) => {
      const val = path.split('.').reduce((o, k) => o?.[k], data);
      if (val === undefined) return "0";
      return JSON.stringify(val);
    });
  }
  function _unwrapOuterParens(expr) {
    let str = expr.trim();
    while (str.startsWith("(") && str.endsWith(")")) {
      let depth = 0;
      let balanced = true;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === "(") depth++;
        else if (ch === ")") {
          depth--;
          if (depth === 0 && i < str.length - 1) {
            balanced = false;
            break;
          }
        }
      }
      if (!balanced || depth !== 0) break;
      str = str.slice(1, -1).trim();
    }
    return str;
  }
  function _splitTernary(expr) {
    let depth = 0;
    let quote = null;
    let qIndex = -1;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (quote) {
        if (ch === "\\" && quote === '"') {
          i++;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "?" && depth === 0) {
        qIndex = i;
        break;
      }
    }
    if (qIndex === -1) return null;

    let nested = 0;
    depth = 0;
    quote = null;
    for (let i = qIndex + 1; i < expr.length; i++) {
      const ch = expr[i];
      if (quote) {
        if (ch === "\\" && quote === '"') {
          i++;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') {
        quote = ch;
        continue;
      }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "?" && depth === 0) nested++;
      else if (ch === ":" && depth === 0) {
        if (nested === 0) {
          return {
            condition: expr.slice(0, qIndex).trim(),
            whenTrue: expr.slice(qIndex + 1, i).trim(),
            whenFalse: expr.slice(i + 1).trim(),
          };
        }
        nested--;
      }
    }
    return null;
  }
  function _resolveTernary(expr) {
    const unwrapped = _unwrapOuterParens(expr);
    const ternary = _splitTernary(unwrapped);
    if (!ternary) return null;
    try {
      const cond = _replaceFormulaData(ternary.condition);
      // eslint-disable-next-line no-new-func
      const condition = new Function(
        'max','min','floor','ceil','round','abs','pow','sqrt','sign','trunc',
        '"use strict"; return (' + cond + ')'
      )(Math.max, Math.min, Math.floor, Math.ceil, Math.round,
        Math.abs, Math.pow, Math.sqrt, Math.sign, Math.trunc);
      const selected = condition ? ternary.whenTrue : ternary.whenFalse;
      return _resolveTernary(selected) ?? selected;
    } catch (_e) {
      return null;
    }
  }
  // Resolve (A || B) groups bottom-up so formulas like (@level || 0) work
  // with Foundry's Roll parser, which has no || operator.
  function _resolveOrCoalesce(str) {
    if (!str.includes('||')) return str;
    const {max, min, floor, ceil, round, abs, pow, sqrt, sign, trunc} = Math;
    let s = str, prev;
    do {
      prev = s;
      s = s.replace(/\(([^()]*\|\|[^()]*)\)/g, (match, inner) => {
        const subst = _replaceFormulaData(inner);
        try {
          // eslint-disable-next-line no-new-func
          const val = new Function(
            'max','min','floor','ceil','round','abs','pow','sqrt','sign','trunc',
            '"use strict"; return (' + subst + ')'
          )(max, min, floor, ceil, round, abs, pow, sqrt, sign, trunc);
          return String(val);
        } catch {
          return match;
        }
      });
    } while (s !== prev);
    return s;
  }
  // Split `expr` on commas that are at depth 0 (not inside nested parens).
  function _splitTopLevelCommas(expr) {
    const args = [];
    let depth = 0, start = 0;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === ',' && depth === 0) {
        args.push(expr.slice(start, i));
        start = i + 1;
      }
    }
    args.push(expr.slice(start));
    return args;
  }

  // Walk through `expr`, find every parenthesised group, split its content on
  // top-level commas (i.e. function arguments), and apply _resolveTernary to
  // each argument individually.  This handles cases where the condition or a
  // branch of the ternary itself contains parenthesised sub-expressions, e.g.:
  //   max(5, (4) > 2 ? (4) : 0)
  // The regex-based do…while below cannot reach this because `[^()]*` forbids
  // nested parens inside the matched group.
  function _processFunctionArgs(expr) {
    if (!expr.includes('?')) return expr;
    let result = '';
    let i = 0;
    while (i < expr.length) {
      if (expr[i] === '(') {
        let depth = 1, j = i + 1;
        while (j < expr.length && depth > 0) {
          if (expr[j] === '(') depth++;
          else if (expr[j] === ')') depth--;
          j++;
        }
        const inner = expr.slice(i + 1, j - 1);
        const args = _splitTopLevelCommas(inner);
        const processedArgs = args.map(arg => {
          const rec = _processFunctionArgs(arg);
          return _resolveTernary(rec) ?? rec;
        });
        result += '(' + processedArgs.join(',') + ')';
        i = j;
      } else {
        result += expr[i];
        i++;
      }
    }
    return result;
  }

  formulaStr = _fillTemplate(formulaStr, data)
  formulaStr = _resolveOrCoalesce(formulaStr)

  // Evaluate ternary (condition ? a : b) subexpressions that Foundry's Roll
  // parser cannot handle natively. We evaluate only the condition, then keep
  // the selected branch as formula text so dice expressions like 1d10 survive.
  if (formulaStr.indexOf('?') !== -1) {
    let prev;
    do {
      prev = formulaStr;
      formulaStr = formulaStr.replace(/\(([^()]*\?[^()]*)\)/g, (match, inner) => {
        return _resolveTernary(inner) ?? match;
      });
    } while (formulaStr !== prev);
    // Handle ternaries nested inside function-call arguments where the condition
    // or a branch contains its own parenthesised sub-expressions — unreachable
    // by the regex above because [^()]* forbids nested parens.
    formulaStr = _processFunctionArgs(formulaStr);
    formulaStr = _resolveTernary(formulaStr) ?? formulaStr;
  }

  // Replace parentheses with semicolons to use for splitting
  let toSplit = formulaStr.replace(/([A-z]+)?\(/g, (match, prefix) => {
    return (prefix in game.D35E.rollPreProcess || prefix in Math) ? `;${prefix};(;` : ";(;";
  }).replace(/\)/g, ";);");
  let terms = toSplit.split(";");

  // Match parenthetical groups
  let nOpen = 0,
      nOpenPreProcess = [];
  terms = terms.reduce((arr, t) => {

    // Handle cases where the prior term is a math function
    const beginPreProcessFn = (t[0] === "(") && (arr[arr.length-1] in game.D35E.rollPreProcess);
    if (beginPreProcessFn) nOpenPreProcess.push([arr.length-1, nOpen]);
    const beginMathFn = (t[0] === "(") && (arr[arr.length-1] in Math);
    if (beginMathFn && nOpenPreProcess.length > 0) nOpenPreProcess.push([arr.length-1, nOpen]);

    // Add terms to the array
    arr.push(t);

    // Increment the number of open parentheses
    if ( t === "(" ) nOpen++;
    if ( (nOpen > 0) && (t === ")") ) {
      nOpen--;
      for (let a = 0; a < nOpenPreProcess.length; a++) {
        let obj = nOpenPreProcess[a];
        // End pre process function
        if (obj[1] === nOpen) {
          const sliceLen = arr.length - obj[0];
          let fnData = arr.splice(obj[0], sliceLen),
              fn = fnData[0];
          let fnParams = fnData.slice(2, -1).reduce((cur, s) => {
            cur.push(...s.split(/\s*,\s*/));
            return cur;
          }, []).filter(s => s.trim() !== "").map(o => {
            return new Roll35e(o, data).evaluateSync().total;
          }).filter(o => o !== "" && o != null);
          if (fn in Math) {
            arr.push(Math[fn](...fnParams).toString());
          }
          else {
            arr.push(game.D35E.rollPreProcess[fn](...fnParams).toString());
          }

          nOpenPreProcess.splice(a, 1);
          a--;
        }
      }
    }
    return arr;
  }, []);

  return terms.join("");
};

// Register _preProcessDiceFormula as a static property on Roll35e so that
// Roll35e.parse() can call it without creating a circular ES module import.
// (dice.js imports Roll35e from roll.js; roll.js must NOT import from dice.js)
Roll35e._preProcess = _preProcessDiceFormula;

