import {
  normalizeClassPaths,
  resolveClassPath,
  serializeClassSelectorData,
  summarizeClassLevelRows,
} from "../actor/helpers/classPathProgressionHelper.js";
import {
  effectiveWarcraftHitDie,
  filterEligibleProgressionClasses,
  racialClassRequirement,
  validateRacialProgressionRows,
} from "../actor/helpers/racialProgressionHelper.js";
import {
  evaluateWarcraftPrerequisites,
  getWarcraftItemPrerequisites,
} from "../item/helpers/warcraftPrerequisiteHelper.js";

export class LevelUpDataDialog extends FormApplication {
  constructor(...args) {
    super(...args);
    //game.D35E.logger.log('Level Up Windows data', this.object.data)
    this.actor = this.object;
    this.levelUpId = this.options.id;
    this.levelUpData = this.actor.system.details.levelUpData.find((a) => a.id === this.levelUpId);
    //game.D35E.logger.log('ludid',this.levelUpId,this.levelUpData, this.options.skillset)
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "level-up-data",
      classes: ["D35E", "entry", "level-up-data"],
      title: "Level Data",
      template: "systems/warcraftrpg2e/templates/apps/level-up-data.html",
      width: 840,
      height: "auto",
      closeOnSubmit: false,
      submitOnClose: false,
    });
  }

  get attribute() {
    return this.options.name;
  }

  getData() {
    let skillset = {};
    Object.keys(this.options.skillset.all.skills).forEach((s) => {
      skillset[s] = {
        points: (this.levelUpData.skills[s] !== undefined ? this.levelUpData.skills[s].points : 0) || 0,
        name: this.options.skillset.all.skills[s].name,
        label: this.options.skillset.all.skills[s].label,
        arbitrary: this.options.skillset.all.skills[s].arbitrary,
        custom: this.options.skillset.all.skills[s].custom || this.options.skillset.all.skills[s].worldCustom,
        baseRank:
        (this.options.skillset.all.skills[s].points -
          (this.levelUpData.skills[s] !== undefined
            ? this.levelUpData.skills[s].cls
              ? this.levelUpData.skills[s].points
              : this.levelUpData.skills[s].points / 2
            : 0)) || 0,
        rt: this.options.skillset.all.skills[s].rt,
        cs: this.options.skillset.all.skills[s].cs,
        subSkills: {},
      };

      Object.keys(this.options.skillset.all.skills[s]?.subSkills || []).forEach((sb) => {
        skillset[s].subSkills[sb] = {
          points:
              (this.levelUpData.skills[s] !== undefined && this.levelUpData.skills[s].subskills[sb] !== undefined
              ? this.levelUpData.skills[s].subskills[sb].points
              : 0) || 0,
          name: this.options.skillset.all.skills[s].subSkills[sb].name,
          label: this.options.skillset.all.skills[s].subSkills[sb].label,
          arbitrary: this.options.skillset.all.skills[s].subSkills[sb].arbitrary,
          custom:
            this.options.skillset.all.skills[s].subSkills[sb].custom || this.options.skillset.all.skills[s].worldCustom,
          baseRank:
          (this.options.skillset.all.skills[s].subSkills[sb].points -
            (this.levelUpData.skills[s] !== undefined && this.levelUpData.skills[s].subskills[sb] !== undefined
              ? this.levelUpData.skills[s].subskills[sb].cls
                ? this.levelUpData.skills[s].subskills[sb].points
                : this.levelUpData.skills[s].subskills[sb].points / 2
              : 0)) || 0,
          rt: this.options.skillset.all.skills[s].rt,
          cs: this.options.skillset.all.skills[s].cs,
        };
      });
    });
    const allClasses = this.actor.items.filter((o) => o.type === "class");
    let classes = filterEligibleProgressionClasses(
      this.actor,
      allClasses,
      this.actor.system.details.levelUpData.filter((row) => row.id !== this.levelUpId)
    )
      .filter((item) => {
        const requirements = getWarcraftItemPrerequisites(item.system);
        if (!requirements.length || Number(item.system?.levels) > 0) return true;
        return evaluateWarcraftPrerequisites(requirements, this.actor).automatedMet;
      })
      .sort((a, b) => {
        return a.sort - b.sort;
      });
    // Keep the row's current selection visible while editing a completed
    // maximum racial level. Validation still prevents adding a fourth row.
    const currentSelection = allClasses.find((item) => item.id === this.levelUpData.classId);
    if (currentSelection && !classes.some((item) => item.id === currentSelection.id)) {
      classes.push(currentSelection);
      classes.sort((a, b) => a.sort - b.sort);
    }
    const serializedClasses = classes.map((_class) => ({
      id: _class.id,
      classSkills: _class.system.classSkills,
      classPaths: normalizeClassPaths(_class.system),
    }));
    const selectedClass = classes.find((_class) => _class.id === this.levelUpData.classId);
    const selectedClassPaths = normalizeClassPaths(selectedClass?.system);
    const selectedPath = resolveClassPath(selectedClass?.system, this.levelUpData.path);
    const currentRowIndex = this.actor.system.details.levelUpData.findIndex((row) => row.id === this.levelUpId);
    const classById = new Map(allClasses.map((item) => [item.id, item]));
    const forsakenRacialLevels = this.actor.system.details.levelUpData
      .slice(0, Math.max(0, currentRowIndex))
      .reduce((sum, row) => {
        const item = classById.get(row.classId);
        return sum + Number(item?.system?.classType === "racial" && racialClassRequirement(item) === "Forsaken");
      }, 0);
    const classChoices = classes.map((_class) => ({
      id: _class.id,
      name: _class.name,
      img: _class.img,
      sort: _class.sort,
      system: _class.system,
      warcraftHitDie: effectiveWarcraftHitDie(_class.system.hd, { forsakenRacialLevels }),
    }));
    let data = {
      actor: this.actor,
      classes: classChoices,
      classesJson: serializeClassSelectorData(serializedClasses),
      classPathSelection: {
        ...selectedClassPaths,
        value: selectedPath,
      },
      level: this.actor.system.details.levelUpData.findIndex((a) => a.id === this.levelUpId) + 1,
      totalLevel: this.actor.system.details.level.available,
      skillset: skillset,
      maxSkillRank: this.actor.system.details.level.available + 3,
      levelUpData: this.levelUpData,
      bonusSkillPoints: this.actor.system?.counters?.bonusSkillPoints?.value || 0,
      config: CONFIG.D35E,
    };
    return data;
  }

  activateListeners(html) {
    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
    root.querySelector('button[type="submit"]').addEventListener("click", this._submitAndClose.bind(this));
    root.querySelectorAll("textarea").forEach(el => el.addEventListener("change", this._onEntryChange.bind(this)));
  }

  async _onEntryChange(event) {
    const a = event.currentTarget;
  }

  async _updateObject(event, formData) {
    const updateData = {};
    let classId = formData["class"];
    let hp = parseInt(formData["hp"] || 0);
    //game.D35E.logger.log('formData',formData)
    if (classId) {
      let _class = this.actor.items.find((cls) => cls.id === classId);
      if (!_class) return this.object.update(updateData);
      const requirements = getWarcraftItemPrerequisites(_class.system);
      if (requirements.length && Number(_class.system?.levels) === 0) {
        const validation = evaluateWarcraftPrerequisites(requirements, this.actor);
        if (!validation.automatedMet) {
          ui.notifications.error(
            `Cannot enter ${_class.name}: ${validation.automatedUnmet.map((entry) => entry.label).join("; ")}`
          );
          return;
        }
        if (validation.manual.length) {
          ui.notifications.warn(
            `${_class.name} needs GM verification: ${validation.manual.map((entry) => entry.label).join("; ")}`
          );
        }
      }
      const selectedPath = resolveClassPath(_class.system, formData["path"]);
      let levelUpData = foundry.utils.duplicate(this.actor.system.details.levelUpData);
      levelUpData.forEach((a) => {
        if (a.id === this.levelUpId) {
          a.class = _class.name;
          a.classImage = _class.img;
          a.classId = _class.id;
          a.path = selectedPath || null;
          a.hp = hp;
          Object.keys(formData).forEach((s) => {
            let key = s.split(".");
            if (key[0] === "skills" && key.length === 3) {
              if (a.skills[key[1]] === undefined) {
                a.skills[key[1]] = { rank: 0, cls: _class.system.classSkills[key[1]] };
              }
              a.skills[key[1]].cls = _class.system.classSkills[key[1]];
              a.skills[key[1]].points = parseInt(formData[s]);
            }
            if (key[0] === "skills" && key.length === 5) {
              if (a.skills[key[1]] === undefined) {
                a.skills[key[1]] = { subskills: {} };
              }
              if (a.skills[key[1]].subskills[key[3]] === undefined) {
                a.skills[key[1]].subskills[key[3]] = { rank: 0, cls: _class.system.classSkills[key[1]] };
              }
              a.skills[key[1]].subskills[key[3]].cls = _class.system.classSkills[key[1]];
              a.skills[key[1]].subskills[key[3]].points = parseInt(formData[s]);
            }
          });
        }
      });
      //game.D35E.logger.log(`Updating Level Data | ${classId} | ${this.levelUpId}`)
      updateData[`system.details.levelUpData`] = levelUpData;

      const classes = this.actor.items
        .filter((o) => o.type === "class")
        .sort((a, b) => {
          return a.sort - b.sort;
        });
      const racialValidation = validateRacialProgressionRows(this.actor, classes, levelUpData);
      if (!racialValidation.valid) {
        const error = racialValidation.errors[0];
        const message = error.code === "race-mismatch"
          ? game.i18n.format("D35E.RacialLevelRaceMismatch", { required: error.required, actual: error.actual || "—" })
          : game.i18n.format("D35E.RacialLevelMaximum", { maximum: error.maximum });
        ui.notifications.error(message);
        return;
      }

      // Iterate over all levl ups
      levelUpData.forEach((lud) => {
        if (lud.classId === null || lud.classId === "") return;
        let _class = this.actor.items.find((cls) => cls.id === lud.classId);
        if (_class === undefined) return;
        Object.keys(lud.skills).forEach((s) => {
          if (lud.skills[s])
            updateData[`system.skills.${s}.points`] =
              (lud.skills[s].points || 0) * (lud.skills[s].cls ? 1 : 0.5) +
              (updateData[`system.skills.${s}.points`] || 0);
          if (lud.skills[s].subskills) {
            Object.keys(lud.skills[s].subskills).forEach((sb) => {
              if (lud.skills[s].subskills && lud.skills[s].subskills[sb])
                updateData[`system.skills.${s}.subSkills.${sb}.points`] =
                  lud.skills[s].subskills[sb].points * (lud.skills[s].subskills[sb].cls ? 1 : 0.5) +
                  (updateData[`system.skills.${s}.subSkills.${sb}.points`] || 0);
            });
          }
        });
      });
      const classProgression = summarizeClassLevelRows(levelUpData, classes);
      Object.keys(levelUpData[0].skills).forEach((s) => {
        if (this.object.system.skills[s])
          updateData[`system.skills.${s}.points`] = Math.floor(updateData[`system.skills.${s}.points`] || 0);
        if (levelUpData[0].skills[s].subskills) {
          Object.keys(levelUpData[0].skills[s].subskills).forEach((sb) => {
            if (this.object.system.skills[s].subskills && this.object.system.skills[s].subskills[sb])
              updateData[`system.skills.${s}.subSkills.${sb}.points`] = Math.floor(
                updateData[`system.skills.${s}.subSkills.${sb}.points`] || 0
              );
          });
        }
      });
      for (var __class of classes) {
        const progression = classProgression.get(__class.id);
        const itemUpdateData = {
          _id: __class.id,
          "system.levels": progression?.levels || 0,
          "system.hp": progression?.hp || 0,
        };
        if (progression?.classPaths.enabled) {
          itemUpdateData["system.pathLevels"] = progression.pathLevels;
          itemUpdateData["system.currentPath"] = progression.currentPath;
        }
        await this.object.updateEmbeddedDocuments("Item", [itemUpdateData], { stopUpdates: true });
      }
    }
    return this.object.update(updateData);
  }

  async _submitAndClose(event) {
    event.preventDefault();
    await this._onSubmit(event);
    this.close();
  }
}
