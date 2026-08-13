const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

describe("Warcraft RPG 2e system schema", () => {
  const system = readJson("system.json");
  const template = readJson("template.json");
  const english = readJson("lang/en.json");

  test("uses the permanent Foundry system identity", () => {
    expect(system.id).toBe("warcraftrpg2e");
    expect(system.name).toBe("warcraftrpg2e");
    expect(system.title).toBe("Warcraft RPG 2e");
    expect(system.packs.every((pack) => pack.system === system.id)).toBe(true);
  });

  test("keeps stable ability keys while exposing Warcraft labels", () => {
    expect(english["D35E.AbilityDex"]).toBe("Agility");
    expect(english["D35E.AbilityCon"]).toBe("Stamina");
    expect(english["D35E.AbilityInt"]).toBe("Intellect");
    expect(english["D35E.AbilityWis"]).toBe("Spirit");
  });

  test("defines Warcraft skills and character resources", () => {
    const common = template.Actor.templates.common;
    const expectedSkills = [
      "apr", "blc", "blf", "clm", "coc", "crf", "ctd", "dsc", "dip", "dev", "dis", "esc",
      "fog", "gif", "han", "hea", "hid", "int", "jmp", "kar", "klo", "kmt", "kna", "kno",
      "kpl", "kre", "lis", "opl", "prf", "pro", "pmc", "rid", "src", "sen", "slt", "spk",
      "spl", "spt", "sur", "swm", "tmb", "umd", "uro", "utd",
    ];
    expect(Object.keys(common.skills).sort()).toEqual(expectedSkills.sort());
    expect(common.skills.ctd).toMatchObject({ ability: "int", rt: false });
    expect(common.skills.kmt).toMatchObject({ ability: "int", rt: true });
    expect(common.skills.pmc).toMatchObject({ ability: "wis", rt: true });
    expect(common.skills.utd).toMatchObject({ ability: "int", rt: false });
    expect(common.skills.hid).toMatchObject({ ability: "dex", rt: false, acp: true });
    expect(common.skills).not.toHaveProperty("mos");
    expect(common.attributes.heroPoints).toEqual({ value: 0, max: 0 });
    expect(common.attributes.shoutUses).toEqual({ value: 0, max: 0 });
    expect(common.details).toMatchObject({ affiliation: "", affiliationRating: 0 });
    expect(common.customCurrency).toEqual({});
  });

  test("initializes custom currencies at their actor-schema path", () => {
    const updater = fs.readFileSync(path.join(root, "module/actor/update/actorUpdater.js"), "utf8");
    expect(updater).toMatch(/system\.customCurrency\.\$\{currency\[0\]\}/);
    expect(updater).not.toMatch(/attributes\.customCurrency/);
  });

  test("writes derived actor flags into the permanent system namespace", () => {
    const updater = fs.readFileSync(path.join(root, "module/actor/update/actorUpdater.js"), "utf8");
    expect(updater).toMatch(/flags\.warcraftrpg2e\.\$\{flagKey\}/);
    expect(updater).not.toMatch(/linkData\([^\n]+flags\.D35E\.\$\{flagKey\}/);
  });

  test("defines the Warcraft technological-device item model", () => {
    const technology = template.Item.technology;
    expect(template.Item.types).toContain("technology");
    expect(technology.design).toMatchObject({ functionDifficulty: 10, technologyScore: 1, timeFactor: 1, size: "med", material: "none", collaboratorLevels: "" });
    expect(technology.operation).toMatchObject({ dc: 11, checkType: "utd", attackBonus: 0 });
    expect(technology.malfunction).toMatchObject({ rating: 1, random: false });
    expect(technology.state).toMatchObject({ malfunctioned: false, permanentEffects: [], destroyed: false, upgrading: false });
    expect(technology.vehicle).toEqual({
      enabled: false,
      currentSpeedMph: 0,
      maneuverability: 1,
      extraSpeedChanges: 0,
      turnIncrements: 0,
      driftWidths: 0,
    });
  });

  test("keeps the configured skill list synchronized with the actor schema", () => {
    const configSource = fs.readFileSync(path.join(root, "module/config.js"), "utf8");
    const skillBlock = configSource.match(/D35E\.skills = \{([\s\S]*?)\n\};/)[1];
    const configuredSkills = [...skillBlock.matchAll(/^\s+"([^"]+)":/gm)].map((match) => match[1]).sort();
    expect(configuredSkills).toEqual(Object.keys(template.Actor.templates.common.skills).sort());
  });

  test("uses Warcraft ability terminology in user-facing derived-stat sources", () => {
    const files = [
      "module/actor/helpers/actorPrepareSourceHelper.js",
      "module/actor/update/actorUpdater.js",
      "templates/internal/shapechange-description.html",
      "templates/onboarding.html",
    ];
    const combined = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
    expect(combined).not.toMatch(/Lose Dex|No Constitution|No Dexterity|0 Dex|1 Wis|without Constitution/);
  });

  test("keeps Warcraft ability formulas on the stable D35E keys", () => {
    const configSource = fs.readFileSync(path.join(root, "module/config.js"), "utf8");
    expect(configSource).toMatch(/D35E\.savingThrowMods\s*=\s*\{[\s\S]*?["']fort["']:\s*["']con["'][\s\S]*?["']ref["']:\s*["']dex["'][\s\S]*?["']will["']:\s*["']wis["']/);

    const updater = fs.readFileSync(path.join(root, "module/actor/update/actorUpdater.js"), "utf8");
    expect(updater).toMatch(/Reset initiative[\s\S]*?system\.attributes\.init\.total/);
    expect(updater).toMatch(/Add dex mod to initiative[\s\S]*?modDiffs\[["']dex["']\]/);
    expect(updater).toMatch(/skl\.ability[\s\S]*?systemData\.abilities\[skl\.ability\]\.mod/);

    expect(template.Actor.templates.common.skills.hid.ability).toBe("dex");
    expect(template.Actor.templates.common.skills.coc.ability).toBe("con");
    expect(template.Actor.templates.common.skills.kar.ability).toBe("int");
    expect(template.Actor.templates.common.skills.hea.ability).toBe("wis");
  });

  test("stores Warcraft path, pooled-slot, prerequisite, and spell-policy state", () => {
    const actorSpells = template.Actor.templates.common.attributes.spells;
    const classSchema = template.Item.class;
    const spellSchema = template.Item.spell;
    expect(actorSpells.warcraftPools).toEqual({});
    expect(actorSpells.spellbooks.primary).toMatchObject({
      usesWarcraftSlotPool: false,
      warcraftPoolKey: "",
      warcraftPathBonusSlot: false,
      specialSlotLevel0: false,
    });
    expect(classSchema).toMatchObject({
      pathLevels: {},
      currentPath: "",
      warcraftSpellcastingAdvancement: {},
      warcraftPrerequisites: [],
    });
    expect(spellSchema.warcraftManualPolicy).toEqual({ mode: "", reason: "" });
  });
});
