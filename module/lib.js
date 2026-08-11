/**
 * Creates a tag from a string.
 * For example, if you input the string "Wizard of Oz 2", you will get "wizardOfOz2"
 */

import { Roll35e } from "./roll.js";

export const isEqual = function (obj1, obj2) {
  var props1 = Object.getOwnPropertyNames(obj1);
  var props2 = Object.getOwnPropertyNames(obj2);
  if (props1.length != props2.length) {
    return false;
  }
  for (var i = 0; i < props1.length; i++) {
    let val1 = obj1[props1[i]];
    let val2 = obj2[props1[i]];
    let isObjects = isObject(val1) && isObject(val2);
    if ((isObjects && !isEqual(val1, val2)) || (!isObjects && val1 !== val2)) {
      return false;
    }
  }
  return true;
};
export const isObject = function (object) {
  return object != null && typeof object === "object";
};

export const createTag = function (str) {
  if (str.length === 0) str = "tag";
  return str
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .split(/\s+/)
    .map((s, a) => {
      s = s.toLowerCase();
      if (a > 0) s = s.substring(0, 1).toUpperCase() + s.substring(1);
      return s;
    })
    .join("");
};

export const uuidv4 = function () {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

/**
 * Alters a roll in string form.
 */
export const alterRoll = function (str, add, multiply) {
  // const rgx = new RegExp(Die.rgx.die, "g");
  const rgx = /^([0-9]+)d([0-9]+)/;
  if (str.match(/^([0-9]+)d([0-9]+)/)) {
    return str.replace(rgx, (match, nd, d, mods) => {
      nd = nd * (multiply || 1) + (add || 0);
      mods = mods || "";
      return (nd == null || Number.isNaN(nd) ? "" : nd) + "d" + d + mods;
    });
  }
  return str;
};

/**
 * Creates tabs for a sheet object
 */
export const createTabs = function (html, tabGroups, existingTabs = null) {
  const root = html?.nodeType === 1 ? html : html?.[0] ?? html;

  // Create recursive activation/callback function
  const _recursiveActivate = function (rtabs, tabName = null) {
    if (tabName == null) this._initialTab[rtabs.group] = rtabs.active;
    else {
      rtabs.activate(tabName);
      this._initialTab[rtabs.group] = tabName;
    }

    // Scroll to previous position
    let scrollElems = root.querySelectorAll(`.scroll-${rtabs.group}`);
    if (scrollElems.length === 0) scrollElems = root.querySelectorAll(`.tab[data-group="${rtabs.group}"]`);
    for (let o of scrollElems) {
      o.scrollTop = this._scrollTab[rtabs.group];
    }

    // Recursively activate tabs
    for (let subTab of rtabs.subTabs) {
      _recursiveActivate.call(this, subTab, subTab.active);
    }
  };

  // Create all tabs
  const _func = function (group, children, tabs = null) {
    if (root.querySelectorAll(`nav[data-group="${group}"]`).length === 0) return null;

    if (this._initialTab == null) this._initialTab = {};
    if (this._scrollTab == null) this._scrollTab = {};

    const nav = root.querySelector(`.tabs[data-group="${group}"]`);
    const validTabNames = nav
      ? [...nav.querySelectorAll("[data-tab]")].map((item) => item.dataset.tab)
      : [];

    if (this._initialTab[group] !== undefined && !validTabNames.includes(this._initialTab[group])) {
      delete this._initialTab[group];
    }

    const subHtml = root.querySelectorAll(`.${group}-body > div[data-group="${group}"]`);
    const activeSubHtml = [...subHtml].filter(el => el.classList.contains("active"));
    const initial =
      this._initialTab[group] !== undefined
        ? this._initialTab[group]
        : activeSubHtml.length > 0
          ? activeSubHtml[0].dataset.tab
          : validTabNames[0] ?? "";

    // Set up data for scroll position and active tab
    if (this._scrollTab[group] === undefined) this._scrollTab[group] = 0;
    if (this._initialTab[group] === undefined) this._initialTab[group] = initial;

    // Set up scrolling callback
    let scrollElems = root.querySelectorAll(`.scroll-${group}`);
    if (scrollElems.length === 0) scrollElems = root.querySelectorAll(`.tab[data-group="${group}"]`);
    scrollElems.forEach(el => el.addEventListener("scroll", (ev) => (this._scrollTab[group] = ev.currentTarget.scrollTop)));

    if (!tabs) {
      // Create tabs object
      tabs = new foundry.applications.ux.Tabs({
        navSelector: `.tabs[data-group="${group}"]`,
        contentSelector: `.${group}-body`,
        initial: this._initialTab[group] || validTabNames[0] || "",
        callback: (_, tabs) => {
          _recursiveActivate.call(this, tabs);
        },
      });

      // Recursively create tabs
      tabs.group = group;
      tabs.subTabs = [];
      for (let [childKey, subChildren] of Object.entries(children)) {
        const newTabs = _func.call(this, childKey, subChildren);
        if (newTabs != null) tabs.subTabs.push(newTabs);
      }

      tabs.bind(root);
    }
    _recursiveActivate.call(this, tabs, this._initialTab[group]);
    return tabs;
  };

  for (const groupKey of Object.keys(tabGroups)) {
    _func.call(this, groupKey, tabGroups[groupKey]);
  }
};

/**
 * @param {String} version - A version string to unpack. Must be something like '0.5.1'.
 * @returns {Object} An object containing the keys 'release', 'major', and 'minor', which are numbers.
 */
export const unpackVersion = function (version) {
  if (version.match(/^([0-9]+)\.([0-9]+)(?:\.([0-9]+))?$/)) {
    return {
      release: parseInt(RegExp.$1),
      major: parseInt(RegExp.$2),
      minor: parseInt(RegExp.$3) || null,
    };
  }
};

/**
 * @param {String} version - The minimum core version to compare to. Must be something like '0.5.1'.
 * @returns {Boolean} Whether the current core version is at least the given version.
 */
export const isMinimumCoreVersion = function (version) {
  if (version.indexOf(".") === -1) {
    version = version + ".0.0";
  }
  const coreVersion = unpackVersion(game.version);
  const compareVersion = unpackVersion(version);

  for (const versionType of ["release", "major", "minor"]) {
    const curValue = coreVersion[versionType];
    const compareValue = compareVersion[versionType];

    if (curValue == null) {
      if (compareValue == null) continue;
      return false;
    }
    if (compareValue == null) {
      if (curValue == null) continue;
      return true;
    }

    if (curValue > compareValue) return true;
    if (curValue < compareValue) return false;
  }

  return true;
};

/**
 * ChatMessage style constants for Foundry v13+.
 * ROLL no longer exists as a style — roll messages are identified by ChatMessage#rolls array.
 *
 * We intentionally use OTHER (not IC) for system-generated roll/item cards in v14+.
 * In v14, messages with style IC or EMOTE automatically trigger a canvas chat bubble
 * over the speaking token (_preCreate sets chatBubble=true → sayBubble renders the full
 * card HTML above the token).  Roll cards are system UI, not in-character speech.
 *
 * In v13 IC was the conventional style for roll cards (no bubble side-effect existed),
 * so we preserve that behaviour there to avoid any visual regression.
 */
export const CHAT_MESSAGE_STYLE_KEY = "style";
export const CHAT_MESSAGE_STYLE_OTHER = CONST.CHAT_MESSAGE_STYLES.OTHER;
export const CHAT_MESSAGE_STYLE_CHAT = CONST.CHAT_MESSAGE_STYLES.OTHER;

/**
 * Returns the system data model template for the given document type ("Item" or "Actor").
 */
export function getSystemTemplate(documentType) {
  return game.model[documentType];
}

/**
 * Roll modes for dropdowns. Returns array of { value, label } with label localized.
 */
export function getRollModesForSelect() {
  return Object.entries(CONFIG.Dice.rollModes).map(([value, config]) => ({
    value,
    label: typeof config === "object" ? game.i18n.localize(config.label) : game.i18n.localize(String(config)),
  }));
}

export const degtorad = function (degrees) {
  return (degrees * Math.PI) / 180;
};

export const radtodeg = function (radians) {
  return (radians / 180) * Math.PI;
};

export const linkData = function (expanded, flattened, key, value) {
  if (key.startsWith("data.")) {
    key = key.replace("data.", "system.");
  }
  foundry.utils.setProperty(expanded, key, value);
  flattened[key] = value;
};

export const getItemOwner = function (item) {
  if (item.actor) return item.actor;
  if (item.id) {
    return game.actors.contents.filter((o) => {
      return o.items.filter((i) => i.id === item.id).length > 0;
    })[0];
  }
  return null;
};

export const CR = {
  fromString(value) {
    if (value === "1/6") return 0.166;
    if (value === "1/3") return 0.33;
    if (value === "1/8") return 0.125;
    if (value === "1/4") return 0.25;
    if (value === "1/3") return 0.3375;
    if (value === "1/2") return 0.5;
    return parseInt(value);
  },

  fromNumber(value) {
    if (value === 0.166) return "1/6";
    if (value === 0.125) return "1/8";
    if (value === 0.33) return "1/3";
    if (value === 0.25) return "1/4";
    if (value === 0.3375) return "1/3";
    if (value === 0.5) return "1/2";
    return value.toString();
  },
};

export const sizeInt = function (targetSize = "M") {
  if (typeof targetSize === "string")
    targetSize = Object.values(CONFIG.D35E.sizeChart).indexOf(targetSize.toUpperCase());
  else if (typeof targetSize === "number")
    targetSize = Math.max(
      0,
      Math.min(
        Object.values(CONFIG.D35E.sizeChart).length - 1,
        Object.values(CONFIG.D35E.sizeChart).indexOf("M") + targetSize
      )
    );
  return `${targetSize}`;
};

export const applyCritToFormula = function (crit, formula) {
  if (crit !== 1 && formula.match(/^([0-9]+)d([0-9]+)(.*)/)) {
    const count = parseInt(RegExp.$1);
    const sides = parseInt(RegExp.$2);
    formula = `${count * crit}d${sides}${RegExp.$3}`;
  }
  return formula;
};

export const sizeDie = function (origCount, origSides, targetSize = "M", crit = 1) {

  if (typeof targetSize === "string") {
    if (targetSize.length > 1) {
      targetSize = CONFIG.D35E.sizeChart[targetSize.toLowerCase()]
      // replace targetsize with the one letter value
      targetSize = targetSize ? targetSize : "M";
    }
    targetSize = Object.values(CONFIG.D35E.sizeChart).
      indexOf(targetSize.toUpperCase());
  }
  else if (typeof targetSize === "number")
    targetSize = Math.max(
      0,
      Math.min(
        Object.values(CONFIG.D35E.sizeChart).length - 1,
        Object.values(CONFIG.D35E.sizeChart).indexOf("M") + targetSize
      )
    );
  let sizeDieMap = foundry.utils.duplicate(CONFIG.D35E.sizeDie);

  const mediumDie = `${origCount}d${origSides}`;
  const mediumDieMax = origCount * origSides;
  if (sizeDieMap.indexOf(mediumDie) === -1) {
    sizeDieMap = sizeDieMap.map((d) => {
      if (d.match(/^([0-9]+)d([0-9]+)$/)) {
        const dieCount = parseInt(RegExp.$1),
          dieSides = parseInt(RegExp.$2),
          dieMaxValue = dieCount * dieSides;

        if (dieMaxValue === mediumDieMax) return mediumDie;
      }

      return d;
    });
  }

  // Pick an index from the chart
  let index = sizeDieMap.indexOf(mediumDie),
    formula = mediumDie;
  if (index >= 0) {
    const d6Index = sizeDieMap.indexOf("1d6");
    let d8Index = sizeDieMap.indexOf("1d8");
    if (d8Index === -1) d8Index = sizeDieMap.indexOf("2d4");
    let curSize = 4;

    // When decreasing in size (e.g. from medium to small)
    while (curSize > targetSize) {
      if (curSize <= 4 || index <= d8Index) {
        index--;
        curSize--;
      } else {
        index -= 2;
        curSize--;
      }
    }
    // When increasing in size (e.g. from medium to large)
    while (curSize < targetSize) {
      if (curSize <= 3 || index <= d6Index) {
        index++;
        curSize++;
      } else {
        index += 2;
        curSize++;
      }
    }

    // Alter crit
    index = Math.max(0, Math.min(sizeDieMap.length - 1, index));
    formula = sizeDieMap[index];
  }

  formula = applyCritToFormula(crit, formula);
  if (index === -1) {
    ui.notifications.warn(game.i18n.localize("D35E.WarningNoSizeDie").format(mediumDie, formula));
  }

  return formula;
};

export const sizeDieValues = function (origCount, origSides, targetSize = "M", crit = 1) {

  if (typeof targetSize === "string") {
    if (targetSize.length > 1) {
      targetSize = CONFIG.D35E.sizeChart[targetSize.toLowerCase()]
      // replace targetsize with the one letter value
      targetSize = targetSize ? targetSize : "M";
    }
    targetSize = Object.values(CONFIG.D35E.sizeChart).
      indexOf(targetSize.toUpperCase());
  }
  else if (typeof targetSize === "number")
    targetSize = Math.max(
      0,
      Math.min(
        Object.values(CONFIG.D35E.sizeChart).length - 1,
        Object.values(CONFIG.D35E.sizeChart).indexOf("M") + targetSize
      )
    );
  let sizeDieMap = foundry.utils.duplicate(CONFIG.D35E.sizeDie);

  const mediumDie = `${origCount}d${origSides}`;
  const mediumDieMax = origCount * origSides;
  if (sizeDieMap.indexOf(mediumDie) === -1) {
    sizeDieMap = sizeDieMap.map((d) => {
      if (d.match(/^([0-9]+)d([0-9]+)$/)) {
        const dieCount = parseInt(RegExp.$1),
          dieSides = parseInt(RegExp.$2),
          dieMaxValue = dieCount * dieSides;

        if (dieMaxValue === mediumDieMax) return mediumDie;
      }

      return d;
    });
  }

  // Pick an index from the chart
  let index = sizeDieMap.indexOf(mediumDie),
    formula = mediumDie;
  if (index >= 0) {
    const d6Index = sizeDieMap.indexOf("1d6");
    let d8Index = sizeDieMap.indexOf("1d8");
    if (d8Index === -1) d8Index = sizeDieMap.indexOf("2d4");
    let curSize = 4;

    // When decreasing in size (e.g. from medium to small)
    while (curSize > targetSize) {
      if (curSize <= 4 || index <= d8Index) {
        index--;
        curSize--;
      } else {
        index -= 2;
        curSize--;
      }
    }
    // When increasing in size (e.g. from medium to large)
    while (curSize < targetSize) {
      if (curSize <= 3 || index <= d6Index) {
        index++;
        curSize++;
      } else {
        index += 2;
        curSize++;
      }
    }

    // Alter crit
    index = Math.max(0, Math.min(sizeDieMap.length - 1, index));
    formula = sizeDieMap[index];
  }

  // get the values of the die using regex (XdY)
  let diceCount = 0;
  let dice = 0;
  if (formula.match(/^([0-9]+)d([0-9]+)(.*)/)) {
    diceCount = parseInt(RegExp.$1);
    dice = parseInt(RegExp.$2);
  }
  return [diceCount, dice];
};

export const sizeMonkDamageDie = function (level, targetSize = "M", crit = 1) {
  if (typeof targetSize === "number") {
    targetSize = Math.max(
      0,
      Math.min(
        Object.values(CONFIG.D35E.sizeChart).length - 1,
        Object.values(CONFIG.D35E.sizeChart).indexOf("M") + targetSize
      )
    );
    targetSize = Object.values(CONFIG.D35E.sizeChart)[targetSize];
  }
  let monkLevelDamageDies = {
    S: [
      [1, 4],
      [1, 4],
      [1, 4],
      [1, 4],
      [1, 6],
      [1, 6],
      [1, 6],
      [1, 6],
      [1, 8],
      [1, 8],
      [1, 8],
      [1, 8],
      [1, 10],
      [1, 10],
      [1, 10],
      [1, 10],
      [2, 6],
      [2, 6],
      [2, 6],
      [2, 6],
      [2, 8],
    ],
    M: [
      [1, 6],
      [1, 6],
      [1, 6],
      [1, 6],
      [1, 8],
      [1, 8],
      [1, 8],
      [1, 8],
      [1, 10],
      [1, 10],
      [1, 10],
      [1, 10],
      [2, 6],
      [2, 6],
      [2, 6],
      [2, 6],
      [2, 8],
      [2, 8],
      [2, 8],
      [2, 8],
      [2, 10],
    ],
    L: [
      [1, 8],
      [1, 8],
      [1, 8],
      [1, 8],
      [2, 6],
      [2, 6],
      [2, 6],
      [2, 6],
      [2, 8],
      [2, 8],
      [2, 8],
      [2, 8],
      [3, 6],
      [3, 6],
      [3, 6],
      [3, 6],
      [3, 8],
      [3, 8],
      [3, 8],
      [3, 8],
      [4, 8],
    ],
  };
  if (monkLevelDamageDies[targetSize]) {
    let diceCount = monkLevelDamageDies[targetSize][Math.max(Math.min(level, 20), 1)][0];
    let dice = monkLevelDamageDies[targetSize][Math.max(Math.min(level, 20), 1)][1];
    return applyCritToFormula(crit, `${diceCount}d${dice}`);
  }
  return sizeDie(
    monkLevelDamageDies["M"][Math.max(Math.min(level, 20), 1)][0],
    monkLevelDamageDies["M"][Math.max(Math.min(level, 20), 1)][1],
    targetSize,
    crit
  );
};

export const sizeNaturalDie = function (block, targetSize = "M", crit = 1) {
  if (typeof targetSize === "string")
    targetSize = Object.values(CONFIG.D35E.sizeChart).indexOf(targetSize.toUpperCase());
  else if (typeof targetSize === "number")
    targetSize = Math.max(
      0,
      Math.min(
        Object.values(CONFIG.D35E.sizeChart).length - 1,
        Object.values(CONFIG.D35E.sizeChart).indexOf("M") + targetSize
      )
    );
  let naturalDamageSizes = [
    ["0", "1", "1", "1d3", "1d4", "1d6", "1d8", "2d6", "2d8"],
    ["1", "1d2", "1d3", "1d4", "1d6", "1d8", "2d6", "2d8", "4d6"],
    ["0", "1", "1d2", "1d3", "1d4", "1d6", "1d8", "2d6", "2d8"],
    ["0", "1", "1d2", "1d4", "1d6", "1d8", "2d6", "2d8", "4d6"],
  ];
  let formula = naturalDamageSizes[block][targetSize + 1];
  if (crit !== 1 && formula.match(/^([0-9]+)d([0-9]+)(.*)/)) {
    const count = parseInt(RegExp.$1);
    const sides = parseInt(RegExp.$2);
    formula = `${count * crit}d${sides}${RegExp.$3}`;
  }
  return formula;
};

export const normalDie = function (origCount, origSides, crit = 1) {
  let formula = `${origCount}d${origSides}`;

  if (crit !== 1 && formula.match(/^([0-9]+)d([0-9]+)(.*)/)) {
    const count = parseInt(RegExp.$1);
    const sides = parseInt(RegExp.$2);
    formula = `${count * crit}d${sides}${RegExp.$3}`;
  }

  return formula;
};

export const shuffle = function (array) {
  var currentIndex = array.length,
    randomIndex;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
  }

  return array;
};

export const getOriginalNameIfExists = function (object) {
  if (typeof Babele !== "undefined") {
    if (object.translated) return object.originalName;
    if (object.getFlag !== undefined && object.getFlag("babele", "translated"))
      return object.getFlag("babele", "originalName");
    return object.name;
  }
  return object.name;
};

/**
 * Returns the result of a roll of die, which changes based on different sizes.
 * @param {number} origCount - The original number of die to roll.
 * @param {number} origSides - The original number of sides per die to roll.
 * @param {string|number} [targetSize="M"] - The target size to change the die to.
 *   Can be a string of values "F", "D", "T", "S", "M", "L", "H", "G" or "C" for the different sizes.
 *   Can also be a number in the range of -4 to 4, where 0 is Medium.
 * @returns {number} The result of the new Roll35e.
 */
export const sizeRoll = function (origCount, origSides, targetSize = "M", crit = 1) {
  return new Roll35e(sizeDie(origCount, origSides, targetSize, crit)).evaluateSync().total;
};

export const sizeNaturalRoll = function (block, targetSize = "M", crit = 1) {
  return new Roll35e(sizeNaturalDie(block, targetSize, crit)).evaluateSync().total;
};

export const sizeMonkDamageRoll = function (level, targetSize = "M", crit = 1) {
  return new Roll35e(sizeMonkDamageDie(level, targetSize, crit)).evaluateSync().total;
};

export const getActorFromId = function (id) {
  const speaker = ChatMessage.getSpeaker();
  let actor = null;
  if (id) {
    actor = canvas.tokens?.get(id)?.actor;
    if (!actor) actor = game.actors.get(id);
  }
  if (speaker.token && !actor) actor = canvas.tokens?.get(speaker.token)?.actor;
  if (!actor) actor = game.actors.get(speaker.actor);
  return actor;
};

/*savy.js — native DOM version (saves/restores form element state via sessionStorage) */
export function savy(elements, order, fn, prefix = "pref") {
  const sv = "savy-" + prefix + "-";
  const elems = elements instanceof NodeList || Array.isArray(elements) ? elements : [elements];
  if (order === "load") {
    for (const el of elems) {
      const name = el.getAttribute("name");
      if (el.type === "radio") {
        if (sessionStorage.getItem(sv + name)) {
          el.checked = sessionStorage.getItem(sv + name) === name;
        }
        el.addEventListener("change", () => sessionStorage.setItem(sv + name, name));
      } else if (el.type === "checkbox") {
        if (sessionStorage.getItem(sv + name)) {
          el.checked = sessionStorage.getItem(sv + name) === "1";
        }
        el.addEventListener("change", () => sessionStorage.setItem(sv + name, el.checked ? "1" : "0"));
      } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
        if (sessionStorage.getItem(sv + name)) {
          el.value = sessionStorage.getItem(sv + name);
        }
        el.addEventListener("focus", () => {
          const interval = setInterval(() => {
            sessionStorage.setItem(sv + name, el.value);
            if (document.activeElement !== el) clearInterval(interval);
          }, 500);
        });
      } else if (el.tagName === "SELECT") {
        if (el.multiple) {
          if (sessionStorage.getItem(sv + name)) {
            const vals = sessionStorage.getItem(sv + name).split(",");
            for (const opt of el.options) opt.selected = vals.includes(opt.value);
          } else {
            sessionStorage.setItem(sv + name, Array.from(el.selectedOptions).map(o => o.value).join(","));
          }
          el.addEventListener("change", () => sessionStorage.setItem(sv + name, Array.from(el.selectedOptions).map(o => o.value).join(",")));
        } else {
          if (sessionStorage.getItem(sv + name)) {
            el.value = sessionStorage.getItem(sv + name);
          } else {
            sessionStorage.setItem(sv + name, el.value);
          }
          el.addEventListener("change", () => sessionStorage.setItem(sv + name, el.value));
        }
      }
    }
    if (typeof fn === "function") fn();
  } else if (order === "destroy") {
    for (const el of elems) {
      if (sessionStorage.getItem(sv + el.id)) {
        sessionStorage.removeItem(sv + el.id);
      }
    }
    if (typeof fn === "function") fn();
  }
}
