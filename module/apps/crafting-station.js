import { CR } from "../lib.js";

export class CompendiumBrowser extends Application {
  constructor(...args) {
    super(...args);

    this.baseItem = {}
    this.selectedEnchancements = {}
    this.resultItem = {}

    this._data = {
      loaded: false,
      data: {},
      promise: null,
    };

    // Preload compendiums
    // if (game.settings.get("warcraftrpg2e", "preloadCompendiums") === true) {
      // this.loadData();
    // }
  }



  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      template: "systems/warcraftrpg2e/templates/apps/crafting-station.html",
      width: 720,
      height: window.innerHeight - 60,
      top: 30,
      left: 40,
    });
  }

  get typeName() {
    switch (this.type) {
      case "spells":
        return game.i18n.localize("D35E.Spells");
      case "items":
        return game.i18n.localize("D35E.Items");
    }
    return this.type;
  }

  get type() {
    return this.options.type;
  }

  get title() {
    return [this.typeName, "Browser"].join(" ");
  }

  get entityType() {
    return this.options.entityType;
  }

  async _fetchMetadata() {
    this.items = [];

    for (let p of game.packs.values()) {
      if (p.private && !game.user.isGM) continue;
      if ((p.entity || p.documentName) !== this.entityType) continue;

      const items = await p.getDocuments();
      for (let i of items) {
        if (!this._filterItems(i)) continue;
        this.items.push(this._mapItem(p, i));
      }
    }
    this.items.sort((a, b) => {
      if (a.item.name < b.item.name) return -1;
      if (a.item.name > b.item.name) return 1;
      return 0;
    });

    if (this.items.length === 0) {
      return;
    }

    if (this.type === "spells") this._fetchSpellFilters();
    else if (this.type === "items") this._fetchItemFilters();
    else if (this.type === "bestiary") this._fetchBestiaryFilters();
    else if (this.type === "feats") this._fetchFeatFilters();

    this.activeFilters = this.filters.reduce((cur, f) => {
      cur[f.path] = [];
      return cur;
    }, {});
  }

  _filterItems(item) {
    if (this.type === "spells" && item.type !== "spell") return false;
    if (this.type === "items" && !["weapon", "equipment", "loot", "consumable"].includes(item.type)) return false;
    if (this.type === "feats" && item.type !== "feat") return false;
    return true;
  }

  _mapItem(pack, item) {
    const result = {
      collection: pack.collection,
      item: {
        id: item.id,
        name: item.name,
        type: item.type,
        img: item.img,
        data: item.system,
      },
    };

    // Feat-specific variables
    if (this.type === "feats") {
      if (!this.extraFilters) {
        this.extraFilters = {
          "tags": [],
          "associations": {
            "class": [],
          },
        };
      }

      result.item.tags = (foundry.utils.getProperty(item.system, "tags") || []).reduce((cur, o) => {
        if (!this.extraFilters["tags"].includes(o[0])) this.extraFilters["tags"].push(o[0]);
        cur.push(o[0]);
        return cur;
      }, []);

      result.item.associations = {
        "class": (foundry.utils.getProperty(item.system, "featType") === "classFeat" ? foundry.utils.getProperty(item.system, "associations.classes") || [] : []).reduce((cur, o) => {
          if (!this.extraFilters.associations.class.includes(o[0])) this.extraFilters.associations.class.push(o[0]);
          cur.push(o[0]);
          return cur;
        }, []),
      };
    }

    // Item-specific variables
    if (this.type === "items") {
      if (!this.extraFilters) {
        this.extraFilters = {};
      }

      result.item.weaponProps = Object.entries(foundry.utils.getProperty(item.system, "properties") || []).reduce((cur, o) => {
        if (o[1]) cur.push(o[0]);
        return cur;
      }, []);
    }

    // Spell-specific variables
    if (this.type === "spells") {
      if (!this.extraFilters) {
        this.extraFilters = {
          "learnedAt.class": [],
          "learnedAt.domain": [],
          "learnedAt.subDomain": [],
          "learnedAt.elementalSchool": [],
          "learnedAt.bloodline": [],
          "system.subschool": [],
          "spellTypes": [],
        };
      }

      result.item.allSpellLevels = [];

      // Add class/domain/etc filters
      result.item.learnedAt = {
        "class": (foundry.utils.getProperty(item.system, "learnedAt.class") || []).reduce((cur, o) => {
          if (!this.extraFilters["learnedAt.class"].includes(o[0])) this.extraFilters["learnedAt.class"].push(o[0]);
          if (!result.item.allSpellLevels.includes(o[1])) result.item.allSpellLevels.push(o[1]);
          cur.push(o[0]);
          return cur;
        }, []),
        "domain": (foundry.utils.getProperty(item.system, "learnedAt.domain") || []).reduce((cur, o) => {
          if (!this.extraFilters["learnedAt.domain"].includes(o[0])) this.extraFilters["learnedAt.domain"].push(o[0]);
          if (!result.item.allSpellLevels.includes(o[1])) result.item.allSpellLevels.push(o[1]);
          cur.push(o[0]);
          return cur;
        }, []),
        "subDomain": (foundry.utils.getProperty(item.system, "learnedAt.subDomain") || []).reduce((cur, o) => {
          if (!this.extraFilters["learnedAt.subDomain"].includes(o[0])) this.extraFilters["learnedAt.subDomain"].push(o[0]);
          if (!result.item.allSpellLevels.includes(o[1])) result.item.allSpellLevels.push(o[1]);
          cur.push(o[0]);
          return cur;
        }, []),
        "elementalSchool": (foundry.utils.getProperty(item.system, "learnedAt.elementalSchool") || []).reduce((cur, o) => {
          if (!this.extraFilters["learnedAt.elementalSchool"].includes(o[0])) this.extraFilters["learnedAt.elementalSchool"].push(o[0]);
          if (!result.item.allSpellLevels.includes(o[1])) result.item.allSpellLevels.push(o[1]);
          cur.push(o[0]);
          return cur;
        }, []),
        "bloodline": (foundry.utils.getProperty(item.system, "learnedAt.bloodline") || []).reduce((cur, o) => {
          if (!this.extraFilters["learnedAt.bloodline"].includes(o[0])) this.extraFilters["learnedAt.bloodline"].push(o[0]);
          if (!result.item.allSpellLevels.includes(o[1])) result.item.allSpellLevels.push(o[1]);
          cur.push(o[0]);
          return cur;
        }, []),
        "spellLevel": {
          "class": (foundry.utils.getProperty(item.system, "learnedAt.class") || []).reduce((cur, o) => {
            cur[o[0]] = o[1];
            return cur;
          }, {}),
          "domain": (foundry.utils.getProperty(item.system, "learnedAt.domain") || []).reduce((cur, o) => {
            cur[o[0]] = o[1];
            return cur;
          }, {}),
          "subDomain": (foundry.utils.getProperty(item.system, "learnedAt.subDomain") || []).reduce((cur, o) => {
            cur[o[0]] = o[1];
            return cur;
          }, {}),
          "elementalSchool": (foundry.utils.getProperty(item.system, "learnedAt.elementalSchool") || []).reduce((cur, o) => {
            cur[o[0]] = o[1];
            return cur;
          }, {}),
          "bloodline": (foundry.utils.getProperty(item.system, "learnedAt.bloodline") || []).reduce((cur, o) => {
            cur[o[0]] = o[1];
            return cur;
          }, {}),
        },
      };

      // Add subschools
      {
        const subschool = foundry.utils.getProperty(item.system, "subschool");
        if (subschool && !this.extraFilters["system.subschool"].includes(subschool)) this.extraFilters["system.subschool"].push(subschool);
      }
      // Add spell types
      {
        const spellTypes = foundry.utils.getProperty(item.system, "types") ? foundry.utils.getProperty(item.system, "types").split(CONFIG.D35E.re.traitSeparator) : []
        result.item.spellTypes = spellTypes;
        for (let st of spellTypes) {
          if (!this.extraFilters["spellTypes"].includes(st)) this.extraFilters["spellTypes"].push(st);
        }
      }
    }

    // Bestiary-specific variables
    if (this.type === "bestiary") {
      if (!this.extraFilters) {
        this.extraFilters = {
          "system.details.cr": [],
        };
      }

      // Add CR filters
      if (item.type === "npc") {
        const cr = foundry.utils.getProperty(item.system, "details.cr");
        if (cr && !this.extraFilters["system.details.cr"].includes(cr)) this.extraFilters["system.details.cr"].push(cr);
      }
    }

    return result;
  }

  async getData() {
    if (!this._data.loaded) await this.loadData();

    return this._data.data;
  }

  async refresh() {
    await this.loadData();
    this.render(false);
  }

  _fetchSpellFilters() {
    this.filters = [
      {
        path: "data.school",
        label: game.i18n.localize("D35E.SpellSchool"),
        items: Object.entries(CONFIG.D35E.spellSchools).reduce((cur, o) => {
          cur.push({ key: o[0], name: o[1] });
          return cur;
        }, []).sort((a, b) => {
          if (a.name > b.name) return 1;
          if (a.name < b.name) return -1;
          return 0;
        }),
      },
      {
        path: "data.subschool",
        label: game.i18n.localize("D35E.SubSchool"),
        items: this.extraFilters["system.subschool"].reduce((cur, o) => {
          cur.push({ key: o, name: o });
          return cur;
        }, []).sort((a, b) => {
          if (a.name > b.name) return 1;
          if (a.name < b.name) return -1;
          return 0;
        }),
      },
      {
        path: "spellTypes",
        label: game.i18n.localize("D35E.TypePlural"),
        items: this.extraFilters["spellTypes"].reduce((cur, o) => {
          cur.push({ key: o, name: o });
          return cur;
        }, []).sort((a, b) => {
          if (a.name > b.name) return 1;
          if (a.name < b.name) return -1;
          return 0;
        }),
      },
      {
        path: "learnedAt.class",
        label: game.i18n.localize("D35E.ClassPlural"),
        items: this.extraFilters["learnedAt.class"].reduce((cur, o) => {
          cur.push({ key: o, name: o });
          return cur;
        }, []).sort((a, b) => {
          if (a.name > b.name) return 1;
          if (a.name < b.name) return -1;
          return 0;
        }),
      },
      {
        path: "learnedAt.domain",
        label: game.i18n.localize("D35E.Domain"),
        items: this.extraFilters["learnedAt.domain"].reduce((cur, o) => {
          cur.push({ key: o, name: o });
          return cur;
        }, []).sort((a, b) => {
          if (a.name > b.name) return 1;
          if (a.name < b.name) return -1;
          return 0;
        }),
      },
      {
        path: "learnedAt.subDomain",
        label: game.i18n.localize("D35E.SubDomain"),
        items: this.extraFilters["learnedAt.subDomain"].reduce((cur, o) => {
          cur.push({ key: o, name: o });
          return cur;
        }, []).sort((a, b) => {
          if (a.name > b.name) return 1;
          if (a.name < b.name) return -1;
          return 0;
        }),
      },
      // {
      //   path: "learnedAt.elementalSchool",
      //   label: game.i18n.localize("D35E.ElementalSchool"),
      //   items: this.extraFilters["learnedAt.elementalSchool"].reduce((cur, o) => {
      //     cur.push({ key: o, name: o });
      //     return cur;
      //   }, []),
      // },
      {
        path: "learnedAt.bloodline",
        label: game.i18n.localize("D35E.Bloodline"),
        items: this.extraFilters["learnedAt.bloodline"].reduce((cur, o) => {
          cur.push({ key: o, name: o });
          return cur;
        }, []).sort((a, b) => {
          if (a.name > b.name) return 1;
          if (a.name < b.name) return -1;
          return 0;
        }),
      },
      {
        path: "_spellLevel",
        label: game.i18n.localize("D35E.SpellLevel"),
        items: Object.entries(CONFIG.D35E.spellLevels).reduce((cur, o) => {
          cur.push({ key: o[0], name: o[1] });
          return cur;
        }, []),
      },
    ];
  }

  _fetchItemFilters() {
    this.filters = [
      {
        path: "type",
        label: game.i18n.localize("D35E.Type"),
        items: [
          { key: "weapon", name: game.i18n.localize("D35E.ItemTypeWeapon") },
          { key: "equipment", name: game.i18n.localize("D35E.ItemTypeEquipment") },
          { key: "consumable", name: game.i18n.localize("D35E.ItemTypeConsumable") },
          { key: "loot", name: game.i18n.localize("D35E.Misc") },
        ],
      },
      {
        path: "data.weaponType",
        label: game.i18n.localize("D35E.WeaponType"),
        items: Object.entries(CONFIG.D35E.weaponTypes).reduce((cur, o) => {
          cur.push({ key: o[0], name: o[1]._label });
          return cur;
        }, []),
      },
      {
        path: "data.weaponSubtype",
        label: game.i18n.localize("D35E.WeaponSubtype"),
        items: Object.values(CONFIG.D35E.weaponTypes).reduce((cur, o) => {
          cur = cur.concat((Object.entries(o).filter(i => !i[0].startsWith("_")).reduce((arr, i) => {
            if (!cur.filter(a => a.key === i[0]).length) {
              arr.push({ key: i[0], name: i[1] });
            }
            return arr;
          }, [])));
          return cur;
        }, []),
      },
      {
        path: "weaponProps",
        label: game.i18n.localize("D35E.WeaponProperties"),
        items: Object.entries(CONFIG.D35E.weaponProperties).reduce((cur, o) => {
          cur.push({ key: o[0], name: o[1] });
          return cur;
        }, []),
      },
      {
        path: "data.equipmentType",
        label: game.i18n.localize("D35E.EquipmentType"),
        items: Object.entries(CONFIG.D35E.equipmentTypes).reduce((cur, o) => {
          cur.push({ key: o[0], name: o[1]._label });
          return cur;
        }, []),
      },
      {
        path: "data.equipmentSubtype",
        label: game.i18n.localize("D35E.EquipmentSubtype"),
        items: Object.values(CONFIG.D35E.equipmentTypes).reduce((cur, o) => {
          cur = cur.concat((Object.entries(o).filter(i => !i[0].startsWith("_")).reduce((arr, i) => {
            if (!cur.filter(a => a.key === i[0]).length) {
              arr.push({ key: i[0], name: i[1] });
            }
            return arr;
          }, [])));
          return cur;
        }, []),
      },
      {
        path: "data.slot",
        label: game.i18n.localize("D35E.Slot"),
        items: Object.values(CONFIG.D35E.equipmentSlots).reduce((cur, o) => {
          cur = cur.concat((Object.entries(o).filter(i => !i[0].startsWith("_")).reduce((arr, i) => {
            if (!cur.filter(a => a.key === i[0]).length) {
              arr.push({ key: i[0], name: i[1] });
            }
            return arr;
          }, [])));
          return cur;
        }, []),
      },
      {
        path: "data.consumableType",
        label: game.i18n.localize("D35E.ConsumableType"),
        items: Object.entries(CONFIG.D35E.consumableTypes).reduce((cur, o) => {
          cur.push({ key: o[0], name: o[1] });
          return cur;
        }, []),
      },
      {
        path: "data.subType",
        label: game.i18n.localize("D35E.Misc"),
        items: Object.entries(CONFIG.D35E.lootTypes).reduce((cur, o) => {
          cur.push({ key: o[0], name: o[1] });
          return cur;
        }, []),
      },
    ];
  }

  _fetchBestiaryFilters() {
    this.filters = [
      {
        path: "data.details.cr",
        label: "CR",
        items: this.extraFilters["system.details.cr"].sort().reduce((cur, o) => {
          cur.push({ key: o, name: CR.fromNumber(o) });
          return cur;
        }, []),
      },
      {
        path: "data.attributes.creatureType",
        label: game.i18n.localize("D35E.CreatureType"),
        items: Object.entries(CONFIG.D35E.creatureTypes).reduce((cur, o) => {
          cur.push({ key: o[0], name: o[1] });
          return cur;
        }, []),
      },
    ];
  }

  _fetchFeatFilters() {
    this.filters = [
      {
        path: "data.featType",
        label: game.i18n.localize("D35E.Type"),
        items: Object.entries(CONFIG.D35E.featTypes).reduce((cur, o) => {
          cur.push({ key: o[0], name: o[1] });
          return cur;
        }, []),
      },
      {
        path: "tags",
        label: game.i18n.localize("D35E.Tags"),
        items: this.extraFilters.tags.reduce((cur, o) => {
          cur.push({ key: o, name: o });
          return cur;
        }, []).sort((a, b) => {
          if (a.name > b.name) return 1;
          if (a.name < b.name) return -1;
          return 0;
        }),
      },
      {
        path: "associations.class",
        label: game.i18n.localize("D35E.ClassPlural"),
        items: this.extraFilters.associations["class"].reduce((cur, o) => {
          cur.push({ key: o, name: o });
          return cur;
        }, []).sort((a, b) => {
          if (a.name > b.name) return 1;
          if (a.name < b.name) return -1;
          return 0;
        }),
      },
    ];
  }

  async _render(...args) {
    await super._render(...args);

    this.filterQuery = /.*/;
    const el = this.element?.nodeType === 1 ? this.element : this.element?.[0] ?? this.element;
    el.querySelectorAll(".filter-content").forEach(node => node.style.display = "none");
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;

    root.querySelectorAll('.entry-name').forEach(el => {
      el.addEventListener("click", ev => {
        let li = ev.currentTarget.parentElement;
        this._onEntry(li.getAttribute("data-collection"), li.getAttribute("data-entry-id"));
      });
    });

    root.querySelectorAll('.directory-item').forEach(li => {
      li.setAttribute("draggable", true);
      li.addEventListener('dragstart', this._onDragStart, false);
    });

    root.querySelectorAll('input[name="search"]').forEach(el => {
      el.addEventListener("keyup", this._onFilterResults.bind(this));
    });

    root.querySelectorAll('.filter input[type="checkbox"]').forEach(el => {
      el.addEventListener("change", this._onActivateBooleanFilter.bind(this));
    });

    root.querySelectorAll('.filter h3').forEach(el => {
      el.addEventListener("click", this._toggleFilterVisibility.bind(this));
    });

    root.querySelectorAll("button.refresh").forEach(el => {
      el.addEventListener("click", this.refresh.bind(this));
    });
  }

  /**
   * Handle opening a single compendium entry by invoking the configured entity class and its sheet
   * @private
   */
  async _onEntry(collectionKey, entryId) {
    const pack = game.packs.find(o => o.collection === collectionKey);
    const entity = await pack.getDocument(entryId);
    entity.sheet.render(true);
  }

  /**
   * Handle a new drag event from the compendium, create a placeholder token for dropping the item
   * @private
   */
  _onDragStart(event) {
    const li = this,
          packName = li.getAttribute("data-collection"),
          pack = game.packs.find(p => p.metadata.id === packName);

    // Get the pack
    if (!pack) {
      event.preventDefault();
      return false;
    }

    // Set the transfer data
    event.dataTransfer.setData("text/plain", JSON.stringify({
      type: pack.documentName,
      pack: pack.collection,
      id: li.getAttribute("data-entry-id")
    }));
  }

  _toggleFilterVisibility(event) {
    event.preventDefault();
    const title = event.currentTarget;
    const content = title.parentElement.querySelector(".filter-content");

    if (content.style.display === "none") content.style.display = "block";
    else content.style.display = "none";
  }

  _onFilterResults(event) {
    event.preventDefault();
    let input = event.currentTarget;

    // Define filtering function
    let filter = query => {
      this.filterQuery = query;
      this._filterResults();
    };

    // Filter if we are done entering keys
    let query = new RegExp(RegExp.escape(input.value), "i");
    if (this._filterTimeout) {
      clearTimeout(this._filterTimeout);
      this._filterTimeout = null;
    }
    this._filterTimeout = setTimeout(() => filter(query), 100);
  }

  _onActivateBooleanFilter(event) {
    event.preventDefault();
    let input = event.currentTarget;
    const path = input.closest(".filter").dataset.path;
    const key = input.name;
    const value = input.checked;

    if (value) {
      let index = this.activeFilters[path].indexOf(key);
      if (index < 0) this.activeFilters[path].push(key);
    }
    else {
      let index = this.activeFilters[path].indexOf(key);
      if (index >= 0) this.activeFilters[path].splice(index, 1);
    }

    this._filterResults();
  }

  _filterResults() {
    const el = this.element?.nodeType === 1 ? this.element : this.element?.[0] ?? this.element;
    el.querySelectorAll("li.directory-item").forEach(li => {
      const id = li.dataset.entryId;
      let item = this.items.find(i => i.item.id === id).item;
      li.style.display = this._passesFilters(item) ? "flex" : "none";
    });
  }

  _passesFilters(item) {
    if (!this.filterQuery.test(item.name)) return false;

    for (let [path, filter] of Object.entries(this.activeFilters)) {
      if (filter.length === 0) continue;

      // Handle special cases
      // Handle Spell Level
      {
        let result = null;
        if (this.type === "spells" && path === "_spellLevel") {
          result = false;
          let hasActiveFilter = false;
          const spellLevels = this.activeFilters[path];
          const checks = [
            { path: "learnedAt.class", type: "class" },
            { path: "learnedAt.domain", type: "domain" },
            { path: "learnedAt.subDomain", type: "subDomain" },
            { path: "learnedAt.elementalSchool", type: "elementalSchool" },
            { path: "learnedAt.bloodline", type: "bloodline" },
          ];
          for (let c of checks) {
            const f = this.activeFilters[c.path];
            if (!f || !f.length) continue;
            hasActiveFilter = true;
            for (let fi of f) {
              const p = foundry.utils.getProperty(item, `learnedAt.spellLevel.${c.type}`);
              for (let sl of spellLevels) {
                if (p[fi] === parseInt(sl)) result = true;
              }
            }
          }
          if (!hasActiveFilter) {
            for (let sl of spellLevels) {
              if (item.allSpellLevels.includes(parseInt(sl))) result = true;
            }
          }
        }
        if (result === false) return false;
        else if (result === true) continue;
      }

      // Handle the rest
      const prop = foundry.utils.getProperty(item, path);
      if (prop == null) return false;
      if (typeof prop === "number") {
        filter = filter.map(o => parseFloat(o)).filter(o => !isNaN(o));
      }
      if (prop instanceof Array) {
        if (!filter.every(o => prop.includes(o))) return false;
        continue;
      }
      if (!filter.includes(prop)) return false;
    }

    return true;
  }
}
