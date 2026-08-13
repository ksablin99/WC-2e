/**
 * Formula Creator — a popup dialog for editing roll formula fields.
 *
 * Usage (in activateListeners):
 *   import { injectFormulaCreatorButtons } from "../../apps/formula-creator.js";
 *   injectFormulaCreatorButtons(root, this);
 *
 * Template attributes:
 *   data-formula-creator                 — marks an <input> as having a creator button
 *   data-formula-context="actor,item"    — (default) actor rollData + full item rollData at @item
 *   data-formula-context="actor,item-level" — actor rollData + only @item.level (buff timeline/damagePool)
 *   data-formula-context="actor"         — actor rollData only, no item context
 *   data-formula-extras='{"critMult":2}' — JSON object of extra rollData fields merged in after the
 *                                          base context, letting you supply runtime-only variables
 *                                          (e.g. @critMult, @powerAttackBonus) with a useful preview
 *                                          default so the Test button produces meaningful output.
 *
 * Real rollData mirrors what the engine produces at runtime:
 *   Most item formulas (chatAttack, Changes):
 *     base  = actor.getRollData()           → actor.system + {size, uuid}
 *     @item = item.getRollData()            → item.system + {level, enhancement, custom, uuid}
 *
 *   Buff timeline / damagePool formulas (entity.js _updateCalculate*):
 *     base      = actor.getRollData()
 *     @item     = { level: item.system.level }   ← only level, nothing else
 */
import { Roll35e } from "../roll.js";

/** Tracks open dialogs by input name — one dialog per field at a time. */
const _openDialogs = new Map();

/**
 * Known descriptions for important rollData paths, keyed by the @ reference string.
 * Values are i18n keys resolved via game.i18n.localize().
 */
const FIELD_DESCRIPTIONS = {
  "@abilities.str.mod": "D35E.FC.DescStrMod",
  "@abilities.str.total": "D35E.FC.DescStrTotal",
  "@abilities.dex.mod": "D35E.FC.DescDexMod",
  "@abilities.dex.total": "D35E.FC.DescDexTotal",
  "@abilities.con.mod": "D35E.FC.DescConMod",
  "@abilities.con.total": "D35E.FC.DescConTotal",
  "@abilities.int.mod": "D35E.FC.DescIntMod",
  "@abilities.int.total": "D35E.FC.DescIntTotal",
  "@abilities.wis.mod": "D35E.FC.DescWisMod",
  "@abilities.wis.total": "D35E.FC.DescWisTotal",
  "@abilities.cha.mod": "D35E.FC.DescChaMod",
  "@abilities.cha.total": "D35E.FC.DescChaTotal",
  "@attributes.bab.total": "D35E.FC.DescBAB",
  "@attributes.hp.value": "D35E.FC.DescHP",
  "@attributes.hp.max": "D35E.FC.DescHPMax",
  "@attributes.savingThrows.fort.total": "D35E.FC.DescFort",
  "@attributes.savingThrows.ref.total": "D35E.FC.DescReflex",
  "@attributes.savingThrows.will.total": "D35E.FC.DescWill",
  "@attributes.speed.land.total": "D35E.FC.DescSpeed",
  "@attributes.ac.normal.total": "D35E.FC.DescAC",
  "@attributes.ac.touch.total": "D35E.FC.DescACTouch",
  "@attributes.ac.flatFooted.total": "D35E.FC.DescACFlatFooted",
  "@attributes.cmd.total": "D35E.FC.DescCMD",
  "@attributes.cmb.total": "D35E.FC.DescCMB",
  "@size": "D35E.FC.DescSize",
  "@item.level": "D35E.FC.DescItemLevel",
  "@item.enhancement": "D35E.FC.DescItemEnhancement",
  "@cl": "D35E.FC.DescCL",
  "@sl": "D35E.FC.DescSL",
  "@ablMod": "D35E.FC.DescAblMod",
  "@critMult": "D35E.FC.DescCritMult",
};

/**
 * Build the rollData that formula fields see at runtime, matching the engine
 * as closely as possible for the given context.
 *
 * @param {Application} sheet    - Owning sheet (ActorSheetPF or ItemSheetPF)
 * @param {string}      context  - Value of data-formula-context attribute
 * @param {object}      extras   - Parsed value of data-formula-extras (extra key→default pairs)
 * @returns {object}
 */
export function buildFormulaRollData(sheet, context = "actor,item", extras = {}) {
  const actor = sheet.actor ?? sheet.item?.actor ?? null;
  const item = sheet.item ?? null;

  // Base is always the actor rollData (actor.system + {size, uuid}).
  // We duplicate so downstream code can't accidentally mutate the cache.
  const rollData = actor ? foundry.utils.duplicate(actor.getRollData()) : {};

  if (item) {
    if (context === "actor,item-level") {
      // Buff timeline / damagePool: only @item.level is available.
      rollData.item = { level: item.system.level ?? 0 };
    } else if (context !== "actor") {
      // Default "actor,item": full item rollData at @item.
      rollData.item = item.getRollData();
    }
  }

  // Merge extras last — they represent runtime-only variables (e.g. @critMult,
  // @powerAttackBonus) that the engine injects during roll resolution but that
  // aren't part of the static actor/item rollData.  The values supplied here are
  // preview defaults so the Test button produces meaningful output.
  if (extras && typeof extras === "object") Object.assign(rollData, extras);

  return rollData;
}

/**
 * Inject a wand button INSIDE every [data-formula-creator] input in root.
 * The button is absolutely positioned at the trailing edge of the input via
 * a thin wrapper span so that no existing flex layout is disturbed.
 *
 * @param {HTMLElement} root   - The sheet's root DOM element
 * @param {Application} sheet  - The owning sheet (ActorSheetPF or ItemSheetPF)
 */
export function injectFormulaCreatorButtons(root, sheet) {
  root.querySelectorAll("input[data-formula-creator]").forEach(input => {
    // Prevent double-injection within a single render cycle.
    if (input.dataset.formulaCreatorInjected) return;
    input.dataset.formulaCreatorInjected = "1";

    // Wrap input in a thin relative container so the button can sit inside it.
    const wrapper = document.createElement("span");
    wrapper.className = "fc-field-wrapper";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "formula-creator-btn";
    btn.title = game.i18n.localize("D35E.FC.ButtonTitle");
    btn.setAttribute("tabindex", "-1");
    btn.innerHTML = `<i class="fas fa-wand-magic-sparkles"></i>`;
    wrapper.appendChild(btn);

    // Use the input's name attribute as the stable key.
    // All [data-formula-creator] inputs have a name (system.* path).
    const inputId = input.name || input.id || crypto.randomUUID();
    const context = input.dataset.formulaContext ?? "actor,item";
    let extras = {};
    if (input.dataset.formulaExtras) {
      try { extras = JSON.parse(input.dataset.formulaExtras); }
      catch (e) { console.warn("D35E | formula-creator: invalid data-formula-extras JSON on", input, e); }
    }

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Reuse an already-open dialog for this field.
      const existing = _openDialogs.get(inputId);
      if (existing && !existing._fcClosed) {
        existing.bringToTop?.();
        return;
      }

      // Derive a human-readable label from the nearest <label> element.
      const label =
        input.closest(".form-group")?.querySelector("label")?.textContent?.trim()
        ?? input.closest("li")?.querySelector("label")?.textContent?.trim()
        ?? inputId;

      const rollData = buildFormulaRollData(sheet, context, extras);

      const dialog = new FormulaCreatorDialog({
        formula: input.value,
        rollData,
        label,
        onApply: (newFormula) => {
          // Re-query the live input in case the sheet re-rendered.
          const liveRoot = sheet.element?.nodeType === 1
            ? sheet.element
            : sheet.element?.[0] ?? sheet.element;
          // CSS.escape is for identifiers, not attribute values in quotes.
          // Inside [name="..."] only " needs escaping, not dots.
          const safeName = inputId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          const liveInput = liveRoot?.querySelector(`input[name="${safeName}"]`);
          if (liveInput) {
            liveInput.value = newFormula;
            liveInput.dispatchEvent(new Event("change", { bubbles: true }));
          }
        },
        onClose: () => _openDialogs.delete(inputId),
      });

      _openDialogs.set(inputId, dialog);
      dialog.render(true);
    });
  });
}

/* ============================================================ */

export class FormulaCreatorDialog extends Application {
  constructor({ formula, rollData, label, onApply, onClose } = {}, options = {}) {
    super(options);
    this._formula = formula ?? "";
    this._rollData = rollData ?? {};
    this._label = label ?? "Formula";
    this._onApply = onApply ?? (() => { });
    this._onClose = onClose ?? (() => { });
    this._testResult = null;
    this._testError = null;
    this._testHint = game.i18n.localize("D35E.FC.TestHint");
    this._fcClosed = false;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["D35E", "formula-creator"],
      title: "D35E.FC.WindowTitle",
      template: "systems/warcraftrpg2e/templates/apps/formula-creator.html",
      width: 700,
      height: 620,
      resizable: true,
    });
  }

  getData() {
    return {
      formula: this._formula,
      label: this._label,
      testResult: this._testResult,
      testError: this._testError,
      testHint: this._testHint,
      hasResult: !!this._testResult || !!this._testError,
      toolbarGroups: this._getToolbarGroups(),
      sections: this._buildRollDataSections(),
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;

    // Keep internal formula state in sync as the user types.
    const formulaEditor = root.querySelector(".fc-formula-editor");
    if (formulaEditor) {
      formulaEditor.addEventListener("input", (e) => {
        this._formula = e.currentTarget.value;
        this._testResult = null;
        this._testError = null;
        root.querySelector(".fc-test-result")?.classList.add("hidden");
        root.querySelector(".fc-test-error")?.classList.add("hidden");
        root.querySelector(".fc-test-hint")?.classList.remove("hidden");
      });
    }

    root.querySelector(".fc-test-btn")?.addEventListener("click", () => this._onTestFormula(root));
    root.querySelector(".fc-apply-btn")?.addEventListener("click", () => { this._onApply(this._formula); this.close(); });
    root.querySelector(".fc-cancel-btn")?.addEventListener("click", () => this.close());

    // Insert reference / snippet on any [data-insert-ref] button (tree + toolbar dropdowns).
    root.querySelectorAll("[data-insert-ref]").forEach(btn => {
      btn.addEventListener("click", () => {
        const offset = parseInt(btn.dataset.cursorOffset ?? "0", 10);
        this._insertRef(root, btn.dataset.insertRef, offset);
        // Close any open toolbar dropdown.
        btn.closest(".fc-toolbar-group")?.classList.remove("is-open");
      });
    });

    // Toolbar dropdown toggle — clicking the label button opens/closes the panel.
    root.querySelectorAll(".fc-toolbar-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const group = btn.closest(".fc-toolbar-group");
        const isOpen = group.classList.contains("is-open");
        root.querySelectorAll(".fc-toolbar-group.is-open").forEach(g => g.classList.remove("is-open"));
        if (!isOpen) group.classList.add("is-open");
      });
    });

    // Close all dropdowns when clicking anywhere outside the toolbar.
    this._onDocumentClick = () => {
      root.querySelectorAll(".fc-toolbar-group.is-open").forEach(g => g.classList.remove("is-open"));
    };
    document.addEventListener("click", this._onDocumentClick);

    // Live search / filter over the reference tree
    const searchInput = root.querySelector(".fc-search");
    if (searchInput) {
      searchInput.addEventListener("input", () => this._onSearch(root, searchInput.value.trim().toLowerCase()));
    }
  }

  async close(options = {}) {
    if (this._onDocumentClick) {
      document.removeEventListener("click", this._onDocumentClick);
      this._onDocumentClick = null;
    }
    if (!this._fcClosed) {
      this._fcClosed = true;
      this._onClose();
    }
    return super.close(options);
  }

  /* -------------------------------------------------- */
  /*  Private helpers                                   */
  /* -------------------------------------------------- */

  _onSearch(root, term) {
    const allLeaves = root.querySelectorAll(".fc-reference .fc-leaf");
    if (!term) {
      // Restore: show everything, collapse L2 groups back to their defaults
      allLeaves.forEach(li => li.classList.remove("fc-hidden"));
      root.querySelectorAll(".fc-l2").forEach(d => { d.removeAttribute("open"); d.classList.remove("fc-hidden"); });
      root.querySelectorAll(".fc-l1[data-default-open]").forEach(d => { d.setAttribute("open", ""); d.classList.remove("fc-hidden"); });
      root.querySelectorAll(".fc-l1:not([data-default-open])").forEach(d => { d.removeAttribute("open"); d.classList.remove("fc-hidden"); });
      return;
    }

    allLeaves.forEach(li => {
      const ref = (li.dataset.ref ?? "").toLowerCase();
      const desc = (li.dataset.desc ?? "").toLowerCase();
      const matches = ref.includes(term) || desc.includes(term);
      li.classList.toggle("fc-hidden", !matches);
    });

    // Expand/collapse/hide sections based on whether they have any visible leaves
    root.querySelectorAll(".fc-l2").forEach(details => {
      const hasVisible = details.querySelector(".fc-leaf:not(.fc-hidden)");
      details.classList.toggle("fc-hidden", !hasVisible);
      if (hasVisible) details.setAttribute("open", "");
    });
    root.querySelectorAll(".fc-l1").forEach(details => {
      const hasVisible = details.querySelector(".fc-leaf:not(.fc-hidden)");
      details.classList.toggle("fc-hidden", !hasVisible);
      if (hasVisible) details.setAttribute("open", "");
    });
  }

  /**
   * Insert `ref` into the formula editor at the current cursor position.
   * @param {HTMLElement} root
   * @param {string}      ref           - Text to insert (e.g. "@abilities.str.mod" or "floor()")
   * @param {number}      cursorOffset  - Chars from end of inserted text to place cursor (default 0 = after insertion)
   */
  _insertRef(root, ref, cursorOffset = 0) {
    const editor = root.querySelector(".fc-formula-editor");
    if (!editor) return;

    // Close any open toolbar dropdowns.
    root.querySelectorAll(".fc-toolbar-group.is-open").forEach(g => g.classList.remove("is-open"));

    const pos = editor.selectionStart ?? this._formula.length;
    const before = this._formula.slice(0, pos);
    const after = this._formula.slice(pos);
    const sep = before.length && !before.endsWith(" ") ? " " : "";

    this._formula = `${before}${sep}${ref}${after}`;
    editor.value = this._formula;

    const insertedEnd = pos + sep.length + ref.length;
    const newPos = cursorOffset > 0 ? insertedEnd - cursorOffset : insertedEnd;
    editor.setSelectionRange(newPos, newPos);
    editor.focus();
  }

  async _onTestFormula(root) {
    const resultEl = root?.querySelector(".fc-test-result");
    const errorEl = root?.querySelector(".fc-test-error");
    const hintEl = root?.querySelector(".fc-test-hint");

    // Sync from editor in case state is stale.
    const editor = root?.querySelector(".fc-formula-editor");
    if (editor) this._formula = editor.value;

    if (!this._formula.trim()) {
      if (errorEl) { errorEl.textContent = game.i18n.localize("D35E.FC.FormulaEmpty"); errorEl.classList.remove("hidden"); }
      if (resultEl) resultEl.classList.add("hidden");
      if (hintEl) hintEl.classList.add("hidden");
      return;
    }

    try {
      // Use Roll35e so D35E formula preprocessing (sizeRoll, ternaries, etc.) fires.
      const roll = new Roll35e(this._formula, this._rollData);
      await roll.evaluate();
      this._testResult = String(roll.total);
      this._testError = null;
      if (resultEl) { resultEl.textContent = `${this._testResult}`; resultEl.classList.remove("hidden"); }
      if (errorEl) errorEl.classList.add("hidden");
      if (hintEl) hintEl.classList.add("hidden");
    } catch (e) {
      this._testResult = null;
      this._testError = e.message;
      if (errorEl) { errorEl.textContent = `${e.message}`; errorEl.classList.remove("hidden"); }
      if (resultEl) resultEl.classList.add("hidden");
      if (hintEl) hintEl.classList.add("hidden");
    }
  }

  /**
   * Build the data for the editor toolbar.
   * Returns three groups: Fields (roll data refs), Math (function snippets), Dice (dice expressions).
   */
  _getToolbarGroups() {
    const rd = this._rollData;
    const val = (v) => (v !== undefined ? String(v) : undefined);

    const fieldsGroup = {
      id: "fields", label: game.i18n.localize("D35E.FC.GroupFields"),
      sections: [
        {
          title: game.i18n.localize("D35E.FC.TitleAbilities"),
          items: [
            { label: game.i18n.localize("D35E.FC.FieldStrMod"), ref: "@abilities.str.mod", displayValue: val(rd?.abilities?.str?.mod) },
            { label: game.i18n.localize("D35E.FC.FieldDexMod"), ref: "@abilities.dex.mod", displayValue: val(rd?.abilities?.dex?.mod) },
            { label: game.i18n.localize("D35E.FC.FieldConMod"), ref: "@abilities.con.mod", displayValue: val(rd?.abilities?.con?.mod) },
            { label: game.i18n.localize("D35E.FC.FieldIntMod"), ref: "@abilities.int.mod", displayValue: val(rd?.abilities?.int?.mod) },
            { label: game.i18n.localize("D35E.FC.FieldWisMod"), ref: "@abilities.wis.mod", displayValue: val(rd?.abilities?.wis?.mod) },
            { label: game.i18n.localize("D35E.FC.FieldChaMod"), ref: "@abilities.cha.mod", displayValue: val(rd?.abilities?.cha?.mod) },
          ],
        },
        {
          title: game.i18n.localize("D35E.FC.TitleSaves"),
          items: [
            { label: game.i18n.localize("D35E.FC.FieldFort"), ref: "@attributes.savingThrows.fort.total", displayValue: val(rd?.attributes?.savingThrows?.fort?.total) },
            { label: game.i18n.localize("D35E.FC.FieldRef"), ref: "@attributes.savingThrows.ref.total", displayValue: val(rd?.attributes?.savingThrows?.ref?.total) },
            { label: game.i18n.localize("D35E.FC.FieldWill"), ref: "@attributes.savingThrows.will.total", displayValue: val(rd?.attributes?.savingThrows?.will?.total) },
          ],
        },
        {
          title: game.i18n.localize("D35E.FC.TitleAttributes"),
          items: [
            { label: game.i18n.localize("D35E.FC.FieldBAB"), ref: "@attributes.bab.total", displayValue: val(rd?.attributes?.bab?.total) },
            { label: game.i18n.localize("D35E.FC.FieldHP"), ref: "@attributes.hp.value", displayValue: val(rd?.attributes?.hp?.value) },
            { label: game.i18n.localize("D35E.FC.FieldHPMax"), ref: "@attributes.hp.max", displayValue: val(rd?.attributes?.hp?.max) },
            { label: game.i18n.localize("D35E.FC.FieldSpeed"), ref: "@attributes.speed.land.total", displayValue: val(rd?.attributes?.speed?.land?.total) },
            { label: game.i18n.localize("D35E.FC.FieldSize"), ref: "@size", displayValue: val(rd?.size) },
          ],
        },
        ...(rd?.item !== undefined ? (() => {
          const items = [
            ...(rd.item?.level !== undefined ? [{ label: game.i18n.localize("D35E.FC.FieldItemLevel"), ref: "@item.level", displayValue: val(rd.item.level) }] : []),
            ...(rd.item?.enhancement !== undefined ? [{ label: game.i18n.localize("D35E.FC.FieldEnhancement"), ref: "@item.enhancement", displayValue: val(rd.item.enhancement) }] : []),
          ];
          return items.length ? [{ title: game.i18n.localize("D35E.FC.TitleItem"), items }] : [];
        })() : []),
        ...(rd?.cl !== undefined || rd?.sl !== undefined || rd?.ablMod !== undefined || rd?.critMult !== undefined ? (() => {
          const items = [
            ...(rd.cl !== undefined ? [{ label: game.i18n.localize("D35E.FC.FieldCL"), ref: "@cl", displayValue: val(rd.cl) }] : []),
            ...(rd.sl !== undefined ? [{ label: game.i18n.localize("D35E.FC.FieldSL"), ref: "@sl", displayValue: val(rd.sl) }] : []),
            ...(rd.ablMod !== undefined ? [{ label: game.i18n.localize("D35E.FC.FieldAblMod"), ref: "@ablMod", displayValue: val(rd.ablMod) }] : []),
            ...(rd.critMult !== undefined ? [{ label: game.i18n.localize("D35E.FC.FieldCritMult"), ref: "@critMult", displayValue: val(rd.critMult) }] : []),
          ];
          return items.length ? [{ title: game.i18n.localize("D35E.FC.TitleRuntimeExtras"), items }] : []
        })() : []),
      ],
    };

    const mathGroup = {
      id: "math", label: game.i18n.localize("D35E.FC.GroupMath"),
      sections: [{
        title: game.i18n.localize("D35E.FC.TitleFunctions"),
        items: [
          { label: "floor(x)", ref: "floor()", cursorOffset: 1 },
          { label: "ceil(x)", ref: "ceil()", cursorOffset: 1 },
          { label: "round(x)", ref: "round()", cursorOffset: 1 },
          { label: "abs(x)", ref: "abs()", cursorOffset: 1 },
          { label: "max(a, b)", ref: "max(, )", cursorOffset: 3 },
          { label: "min(a, b)", ref: "min(, )", cursorOffset: 3 },
        ],
      }],
    };

    const diceGroup = {
      id: "dice", label: game.i18n.localize("D35E.FC.GroupDice"),
      sections: [{
        title: "",
        items: [
          { label: "1d4", ref: "1d4" },
          { label: "1d6", ref: "1d6" },
          { label: "1d8", ref: "1d8" },
          { label: "1d10", ref: "1d10" },
          { label: "1d12", ref: "1d12" },
          { label: "1d20", ref: "1d20" },
          { label: "1d100", ref: "1d100" },
          { label: "sizeRoll(1, 6, @size)", ref: "sizeRoll(1, 6, @size)" },
        ],
      }],
    };

    return [fieldsGroup, mathGroup, diceGroup];
  }

  /**
   * Recursively walk the entire rollData tree and build a 3-level section structure:
   *
   *   Section  (L1 — top-level key, e.g. "abilities")
   *     └─ Group  (L2 — second-level key, e.g. "str")
   *          └─ Leaf  (@full.dot.path = value)
   *
   * Scalar values at L1 (e.g. @size = 0) appear as direct vars on the section.
   */
  _buildRollDataSections() {
    const SKIP_KEYS = new Set(["uuid", "flags", "img", "icon", "description", "notes"]);
    const SECTION_ORDER = ["abilities", "attributes", "skills", "item", "traits", "details"];
    const DEFAULT_OPEN = new Set(["abilities", "item"]);

    // Phase 1 — collect all scalar leaves
    const leaves = [];
    const walk = (obj, path, depth) => {
      if (depth > 8 || !obj || typeof obj !== "object" || Array.isArray(obj)) return;
      for (const [key, val] of Object.entries(obj)) {
        if (key.startsWith("_") || SKIP_KEYS.has(key)) continue;
        if (val == null || typeof val === "function") continue;
        if (Array.isArray(val)) continue;
        if (typeof val === "object") {
          walk(val, [...path, key], depth + 1);
        } else {
          if (typeof val === "string" && val.length > 60) continue;
          leaves.push({ path: [...path, key], value: val });
        }
      }
    };
    walk(this._rollData, [], 0);

    // Phase 2 — group: L1 → L2 → [leaves]
    const l1Map = new Map();
    for (const { path, value } of leaves) {
      const l1 = path[0];
      const l2 = path.length > 1 ? path[1] : null;
      const ref = `@${path.join(".")}`;
      const l2key = l2 ?? "__root__";
      if (!l1Map.has(l1)) l1Map.set(l1, new Map());
      if (!l1Map.get(l1).has(l2key)) l1Map.get(l1).set(l2key, []);
      l1Map.get(l1).get(l2key).push({
        ref,
        value,
        desc: FIELD_DESCRIPTIONS[ref] ? game.i18n.localize(FIELD_DESCRIPTIONS[ref]) : undefined,
      });
    }

    // Phase 3 — assemble section objects
    const buildSection = (l1key) => {
      const l2map = l1Map.get(l1key);
      const groups = [];
      let directVars = [];
      let totalCount = 0;
      for (const [l2key, vars] of l2map) {
        vars.sort((a, b) => a.ref.localeCompare(b.ref));
        totalCount += vars.length;
        if (l2key === "__root__") { directVars = vars; }
        else { groups.push({ key: l2key, vars, count: vars.length }); }
      }
      groups.sort((a, b) => a.key.localeCompare(b.key));
      return {
        id: l1key, label: this._sectionLabel(l1key),
        defaultOpen: DEFAULT_OPEN.has(l1key),
        count: totalCount, groups, vars: directVars,
      };
    };

    const sections = [];
    const used = new Set();
    for (const key of SECTION_ORDER) {
      if (!l1Map.has(key)) continue;
      sections.push(buildSection(key));
      used.add(key);
    }
    for (const key of [...l1Map.keys()].filter(k => !used.has(k)).sort()) {
      sections.push(buildSection(key));
    }
    return sections;
  }

  _sectionLabel(key) {
    const MAP = {
      abilities: "D35E.FC.SectionAbilities",
      attributes: "D35E.FC.SectionAttributes",
      skills: "D35E.FC.SectionSkills",
      item: "D35E.FC.SectionItem",
      traits: "D35E.FC.SectionTraits",
      details: "D35E.FC.SectionDetails",
      currency: "D35E.FC.SectionCurrency",
      counters: "D35E.FC.SectionCounters",
      resources: "D35E.FC.SectionResources",
    };
    const i18nKey = MAP[key];
    if (i18nKey) return game.i18n.localize(i18nKey);
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
}
