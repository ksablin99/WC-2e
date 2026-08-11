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
    expect(common.skills.ctd).toMatchObject({ ability: "int", rt: false });
    expect(common.skills.kmt).toMatchObject({ ability: "int", rt: true });
    expect(common.skills.pmc).toMatchObject({ ability: "wis", rt: true });
    expect(common.skills.utd).toMatchObject({ ability: "int", rt: false });
    expect(common.attributes.heroPoints).toEqual({ value: 0, max: 0 });
    expect(common.details).toMatchObject({ affiliation: "", affiliationRating: 0 });
  });
});
