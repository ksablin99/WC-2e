const { test, expect } = require("@playwright/test");
const { clearWorld, dismissOverlays, dismissSystemDialogs, gotoGame } = require("./helpers");

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
});

test("Arcanist level defaults to Mage and exposes parent/path progression", async ({ page }) => {
  const { actorId, classId, levelUpId } = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Path Progression Test",
      type: "character",
      system: {
        details: {
          levelUpProgression: true,
          level: { available: 1 },
        },
      },
    });

    const [arcanist] = await actor.createEmbeddedDocuments("Item", [
      {
        name: "Arcanist",
        type: "class",
        system: {
          levels: 1,
          classPaths: {
            enabled: true,
            default: "mage",
            choices: [{ id: "mage", name: "Mage" }],
          },
          pathLevels: { mage: 0 },
          currentPath: "mage",
        },
      },
    ]);

    const levelUpId = "_path_level_1";
    await actor.update({
      "system.details.levelUpData": [
        {
          level: 1,
          id: levelUpId,
          classId: null,
          class: null,
          classImage: null,
          path: null,
          skills: {},
          hp: 0,
          hasFeat: true,
          hasAbility: false,
        },
      ],
    });
    await actor.sheet.render(true);

    return { actorId: actor.id, classId: arcanist.id, levelUpId };
  });

  await page.evaluate(
    ({ actorId, levelUpId }) => {
      const actor = game.actors.get(actorId);
      const anchor = document.createElement("a");
      anchor.setAttribute("for", levelUpId);
      actor.sheet._onLevelDataUp({ preventDefault: () => {}, currentTarget: anchor });
    },
    { actorId, levelUpId }
  );

  const dialog = page.locator(".app.level-up-data");
  await dialog.waitFor({ state: "visible", timeout: 8_000 });
  await dismissOverlays(page);
  await dialog.locator('select[name="class"]').selectOption(classId);

  const pathSelect = dialog.locator('select[name="path"]');
  await expect(pathSelect).toBeVisible();
  await expect(pathSelect).toHaveValue("mage");
  await expect(pathSelect.locator("option:checked")).toHaveText("Mage");
  await expect(pathSelect).toHaveAttribute("required", "");

  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: "detached", timeout: 8_000 });

  const progression = await page.evaluate(
    ({ actorId, classId }) => {
      const actor = game.actors.get(actorId);
      const arcanist = actor.items.get(classId);
      return {
        rowPath: actor.system.details.levelUpData[0].path,
        levels: arcanist.system.levels,
        pathLevels: arcanist.system.pathLevels,
        currentPath: arcanist.system.currentPath,
        prepared: actor.system.classes.arcanist,
      };
    },
    { actorId, classId }
  );

  expect(progression.rowPath).toBe("mage");
  expect(progression.levels).toBe(1);
  expect(progression.pathLevels.mage).toBe(1);
  expect(progression.currentPath).toBe("mage");
  expect(progression.prepared.level).toBe(1);
  expect(progression.prepared.pathLevels.mage).toBe(1);
  expect(progression.prepared.currentPath).toBe("mage");
});

test("direct class edits repair missing path history and do not duplicate threshold features", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: "Direct Path Fallback", type: "character" });
    const [arcanist] = await actor.createEmbeddedDocuments("Item", [{
      name: "Arcanist",
      type: "class",
      system: {
        classType: "base",
        levels: 4,
        automaticFeatures: true,
        classPaths: {
          enabled: true,
          default: "mage",
          choices: [
            { id: "mage", name: "Mage" },
            { id: "necromancer", name: "Necromancer" },
            { id: "warlock", name: "Warlock" },
          ],
        },
        pathLevels: {},
        currentPath: "",
      },
    }]);

    await actor.update({ "system.details.level.value": 4 });
    await actor.update({ "system.details.level.value": 4 });
    const prepared = actor.system.classes.arcanist;
    const mageFeatures = actor.items.filter((item) => item.system?.warcraftPath?.id === "mage");
    return {
      prepared: {
        level: prepared.level,
        pathLevels: prepared.pathLevels,
        currentPath: prepared.currentPath,
      },
      featureIds: mageFeatures.map((item) => item.system.uniqueId),
      classItem: actor.items.get(arcanist.id).system,
    };
  });

  expect(result.prepared).toEqual({
    level: 4,
    pathLevels: { mage: 4, necromancer: 0, warlock: 0 },
    currentPath: "mage",
  });
  expect(new Set(result.featureIds).size).toBe(result.featureIds.length);
  expect(result.classItem.levels).toBe(4);
});
