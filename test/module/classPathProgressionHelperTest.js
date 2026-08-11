import {
  deriveDirectClassPathState,
  normalizeClassPaths,
  resolveClassPath,
  serializeClassSelectorData,
  summarizeClassLevelRows,
} from "../../module/actor/helpers/classPathProgressionHelper.js";

const arcanistSystem = (overrides = {}) => ({
  levels: 1,
  classPaths: {
    enabled: true,
    default: "mage",
    choices: [{ id: "mage", name: "Mage" }],
  },
  pathLevels: { mage: 0 },
  currentPath: "mage",
  ...overrides,
});

describe("Warcraft parent/path class progression", () => {
  it("normalizes the Arcanist Mage path configuration", () => {
    expect(normalizeClassPaths(arcanistSystem())).toEqual({
      enabled: true,
      default: "mage",
      choices: [{ id: "mage", name: "Mage" }],
    });
    expect(resolveClassPath(arcanistSystem(), "")).toBe("mage");
    expect(resolveClassPath(arcanistSystem(), "removed-path")).toBe("mage");
  });

  it("counts parent levels once and path levels separately", () => {
    const arcanist = { id: "arcanist", system: arcanistSystem({ levels: 0 }) };
    const progression = summarizeClassLevelRows(
      [
        { classId: "arcanist", path: "mage", hp: 4 },
        { classId: "arcanist", path: "mage", hp: 3 },
        { classId: "warrior", hp: 6 },
      ],
      [arcanist]
    ).get("arcanist");

    expect(progression).toMatchObject({
      levels: 2,
      hp: 7,
      pathLevels: { mage: 2 },
      currentPath: "mage",
    });
  });

  it("defaults old path-less Arcanist rows to Mage", () => {
    const arcanist = { id: "arcanist", system: arcanistSystem({ levels: 0 }) };
    const progression = summarizeClassLevelRows([{ classId: "arcanist", hp: 4 }], [arcanist]).get("arcanist");

    expect(progression.pathLevels).toEqual({ mage: 1 });
    expect(progression.currentPath).toBe("mage");
  });

  it("uses the most recently advanced path as current", () => {
    const arcanist = {
      id: "arcanist",
      system: arcanistSystem({
        levels: 0,
        classPaths: {
          enabled: true,
          default: "mage",
          choices: [
            { id: "mage", name: "Mage" },
            { id: "warlock", name: "Warlock" },
          ],
        },
      }),
    };
    const progression = summarizeClassLevelRows(
      [
        { classId: "arcanist", path: "mage" },
        { classId: "arcanist", path: "warlock" },
      ],
      [arcanist]
    ).get("arcanist");

    expect(progression.pathLevels).toEqual({ mage: 1, warlock: 1 });
    expect(progression.currentPath).toBe("warlock");
  });

  it("allocates direct class levels to Mage when stored distribution is missing", () => {
    expect(deriveDirectClassPathState(arcanistSystem({ levels: 4 }))).toMatchObject({
      pathLevels: { mage: 4 },
      currentPath: "mage",
    });
  });

  it("preserves a complete stored distribution for future multi-path classes", () => {
    const state = deriveDirectClassPathState({
      levels: 4,
      classPaths: {
        enabled: true,
        default: "mage",
        choices: [
          { id: "mage", name: "Mage" },
          { id: "warlock", name: "Warlock" },
        ],
      },
      pathLevels: { mage: 1, warlock: 3 },
      currentPath: "warlock",
    });

    expect(state.pathLevels).toEqual({ mage: 1, warlock: 3 });
    expect(state.currentPath).toBe("warlock");
  });

  it("falls back to a populated path when the stored current path is stale", () => {
    const state = deriveDirectClassPathState({
      levels: 4,
      classPaths: {
        enabled: true,
        default: "mage",
        choices: [
          { id: "mage", name: "Mage" },
          { id: "warlock", name: "Warlock" },
        ],
      },
      pathLevels: { mage: 0, warlock: 4 },
      currentPath: "removed-path",
    });

    expect(state.pathLevels).toEqual({ mage: 0, warlock: 4 });
    expect(state.currentPath).toBe("warlock");
  });

  it("leaves legacy classes path-free", () => {
    const legacy = { id: "fighter", system: { levels: 5 } };
    const progression = summarizeClassLevelRows([{ classId: "fighter", hp: 8 }], [legacy]).get("fighter");

    expect(progression).toMatchObject({ levels: 1, hp: 8, pathLevels: {}, currentPath: "" });
    expect(deriveDirectClassPathState(legacy.system).pathLevels).toEqual({});
  });

  it("serializes path names safely for the inline level-up selector", () => {
    const classes = [{ id: "mage", classPaths: { choices: [{ id: "mage", name: "Mage's </script> Path" }] } }];
    const serialized = serializeClassSelectorData(classes);

    expect(serialized).not.toContain("'");
    expect(serialized).not.toContain("<");
    expect(JSON.parse(serialized)).toEqual(classes);
  });
});
