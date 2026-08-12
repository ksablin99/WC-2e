"use strict";

/**
 * Foundry integration coverage for the Warcraft-specific systems added in the
 * Ultra pass. These specs are intentionally authored without a local Foundry
 * run; execute them against the normal D35E Playwright world after repacking.
 */

const { test, expect } = require("@playwright/test");
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require("./helpers");
const { openSheet } = require("./helpers/actor-sheet");

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

async function openEmbeddedItemSheet(page, actorId, itemId) {
  const sheetId = await page.evaluate(async ({ actorId, itemId }) => {
    const app = game.actors.get(actorId).items.get(itemId).sheet;
    await app.render(true);
    return app.id;
  }, { actorId, itemId });
  await page.locator(`#${sheetId}`).waitFor({ state: "visible", timeout: 10_000 });
  await dismissOverlays(page);
  return sheetId;
}

test("feat document validation blocks prerequisites, duplicates, and conflicts", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Warcraft Feat Candidate",
      type: "character",
      system: { attributes: { bab: { value: 1 } } },
    });
    const blocked = await actor.createEmbeddedDocuments("Item", [{
      name: "High BAB Feat",
      type: "feat",
      flags: { warcraftrpg2e: { feat: { requirements: [{ type: "bab", value: 5, label: "Base attack bonus +5" }] } } },
    }]);
    const first = await actor.createEmbeddedDocuments("Item", [{
      name: "Singular Feat",
      type: "feat",
      flags: { warcraftrpg2e: { feat: { repeatable: false } } },
    }]);
    const duplicate = await actor.createEmbeddedDocuments("Item", [{
      name: "Singular Feat",
      type: "feat",
      flags: { warcraftrpg2e: { feat: { repeatable: false } } },
    }]);
    const conflicting = await actor.createEmbeddedDocuments("Item", [{
      name: "Opposed Training",
      type: "feat",
      flags: { warcraftrpg2e: { feat: { conflicts: ["Singular Feat"] } } },
    }]);
    return { blocked: blocked.length, first: first.length, duplicate: duplicate.length, conflicting: conflicting.length };
  });

  expect(result).toEqual({ blocked: 0, first: 1, duplicate: 0, conflicting: 0 });
});

test("Hero Point sheet control arms a declared option before the roll", async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Warcraft Hero",
      type: "character",
      system: { attributes: { heroPoints: { value: 1, max: 1 } } },
    });
    return actor.id;
  });
  const sheetId = await openSheet(page, actorId);
  await page.locator(`#${sheetId} [data-action="warcraft-hero-point"]`).click({ force: true });
  const dialog = page.locator(".app:has(.warcraft-hero-point-dialog), .application:has(.warcraft-hero-point-dialog)").last();
  await page.locator('.warcraft-hero-point-dialog select[name="option"]').selectOption("d20");
  await dialog.getByRole("button", { name: /Spend Hero Point/i }).click({ force: true });

  await expect.poll(() => page.evaluate((id) => {
    const actor = game.actors.get(id);
    return {
      value: actor.system.attributes.heroPoints.value,
      pending: actor.flags.warcraftrpg2e?.heroPoint?.pending?.option,
    };
  }, actorId)).toEqual({ value: 0, pending: "d20" });
});

test("Battle Shout spends the shared pool and creates the timed morale buff", async ({ page }) => {
  const actorId = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: "Warcraft Shouter",
      type: "character",
      system: {
        details: { level: { value: 6 } },
        attributes: { shoutUses: { value: 1, max: 1 } },
      },
    });
    await actor.createEmbeddedDocuments("Item", [{ name: "Test Class", type: "class", system: { levels: 6 } }]);
    const [shout] = await actor.createEmbeddedDocuments("Item", [{
      name: "Battle Shout",
      type: "feat",
      flags: { warcraftrpg2e: { feat: { category: "Shout", rules: { usesSharedPool: true } } } },
    }], { _warcraftBypassFeatValidation: true });
    await actor.update({ "system.attributes.shoutUses.value": 1 });
    const hookValues = { customUse: false };
    Hooks.call("D35E.ItemUse.preUseItem", shout, actor, hookValues);
    return actor.id;
  });

  await expect.poll(() => page.evaluate((id) => {
    const actor = game.actors.get(id);
    const buff = actor.items.find((item) => item.type === "buff" && item.name.startsWith("Battle Shout"));
    return buff ? {
      uses: actor.system.attributes.shoutUses.value,
      active: buff.system.active,
      duration: buff.system.timeline.total,
      change: buff.system.changes?.[0],
    } : null;
  }, actorId)).toEqual({ uses: 0, active: true, duration: 3, change: ["2", "damage", "wdamage", "morale"] });
});

test("firearm sheet reload consumes one ball and one ounce of gunpowder", async ({ page }) => {
  const ids = await page.evaluate(async () => {
    const actor = await Actor.create({ name: "Warcraft Gunner", type: "character" });
    const [weapon, ammunition, powder] = await actor.createEmbeddedDocuments("Item", [
      {
        name: "Test Flintlock Pistol",
        type: "weapon",
        flags: { warcraftrpg2e: { rules: {
          ammunition: "Pistol Balls (10)", capacity: 1, malfunctionRating: 1,
          reload: "standard action", reloadProvokes: true, gunpowderPerShotOunces: 1,
        }, equipment: { loaded: 0, jammed: false } } },
      },
      { name: "Pistol Balls (10)", type: "loot", system: { quantity: 1, price: 5, weight: 3 } },
      { name: "Gunpowder Horn (2 lb.)", type: "loot", system: { quantity: 1, price: 35, weight: 2 } },
    ]);
    return { actorId: actor.id, weaponId: weapon.id, ammunitionId: ammunition.id, powderId: powder.id };
  });
  const sheetId = await openEmbeddedItemSheet(page, ids.actorId, ids.weaponId);
  const sheet = page.locator(`#${sheetId}`);
  await expect(sheet.locator(".warcraft-firearm-state")).toContainText("0/1");
  await sheet.locator('[data-warcraft-firearm-action="reload"]').click({ force: true });

  await expect.poll(() => page.evaluate(({ actorId, weaponId, ammunitionId, powderId }) => {
    const actor = game.actors.get(actorId);
    return {
      loaded: actor.items.get(weaponId).flags.warcraftrpg2e.equipment.loaded,
      ammunition: actor.items.get(ammunitionId).system.quantity,
      powder: actor.items.get(powderId).system.quantity,
    };
  }, ids)).toEqual({ loaded: 1, ammunition: 9, powder: 31 });
});

test("technology sheet exposes design, operation, construction, and vehicle controls", async ({ page }) => {
  const ids = await page.evaluate(async () => {
    const actor = await Actor.create({ name: "Warcraft Tinker", type: "character" });
    const [device] = await actor.createEmbeddedDocuments("Item", [{
      name: "Test Steam Device",
      type: "technology",
      system: {
        design: {
          primaryFunction: "Steam-powered armor",
          functionDifficulty: 20,
          features: [
            { type: "armorBonus", ts: 6 },
            { type: "cargo", ts: 6 },
            { type: "landSpeed", ts: 3 },
            { type: "maneuverability", ts: 6 },
          ],
          timeFactor: 3,
          timeUnit: "minute",
          size: "lg",
          material: "mithril",
        },
        construction: { complete: true },
        vehicle: { enabled: true, currentSpeedMph: 20, maneuverability: 3 },
      },
    }]);
    return { actorId: actor.id, itemId: device.id };
  });
  const sheetId = await openEmbeddedItemSheet(page, ids.actorId, ids.itemId);
  const sheet = page.locator(`#${sheetId}`);
  await expect(sheet.locator("form.warcraft-technology-sheet")).toBeVisible();
  await expect(sheet.locator('select[name="system.design.material"]')).toHaveValue("mithril");
  await sheet.locator('nav.sheet-navigation a[data-tab="operation"]').click({ force: true });
  await expect(sheet.locator('select[name="system.operation.checkType"]')).toBeVisible();
  await expect(sheet.locator('[data-warcraft-tech-action="operate"]')).toBeEnabled();
  await expect(sheet.locator('[data-warcraft-tech-action="maneuver"]')).toBeEnabled();
  await sheet.locator('nav.sheet-navigation a[data-tab="construction"]').click({ force: true });
  await expect(sheet.locator('[data-warcraft-tech-action="craft"]')).toBeVisible();
  await sheet.locator('nav.sheet-navigation a[data-tab="improvements"]').click({ force: true });
  await expect(sheet.locator('[data-warcraft-tech-action="craft-masterwork"]')).toBeVisible();
  await expect(sheet.locator('[data-warcraft-tech-action="begin-upgrade"]')).toBeVisible();
});

test("new character sheet opens the guided builder and advances after race and class selection", async ({ page }) => {
  const actorId = await page.evaluate(async () => (await Actor.create({ name: "Warcraft Recruit", type: "character" })).id);
  const sheetId = await openSheet(page, actorId);
  await page.locator(`#${sheetId} [data-warcraft-character-builder]`).click({ force: true });
  const builder = page.locator("#warcraft-character-creation");
  await expect(builder).toBeVisible();
  await expect.poll(() => builder.locator('select[name="raceId"] option').count()).toBeGreaterThan(1);
  await expect.poll(() => builder.locator('select[name="classId"] option').count()).toBeGreaterThan(1);

  // Use non-default choices so a rerender reset cannot look like success.
  const raceId = await builder.locator('select[name="raceId"] option:not([value=""])').last().getAttribute("value");
  await builder.locator('select[name="raceId"]').selectOption(raceId);
  await expect.poll(() => page.evaluate(() => {
    const applications = [
      ...Object.values(ui.windows ?? {}),
      ...Array.from(foundry.applications.instances?.values?.() ?? []),
    ];
    return applications.find((app) => app.id === "warcraft-character-creation")?.plan?.raceId ?? null;
  })).toBe(raceId);
  await expect(builder.locator('select[name="raceId"]')).toHaveValue(raceId);
  await expect(builder.locator('select[name="classId"]')).toHaveValue("");
  const classId = await builder.locator('select[name="classId"] option:not([value=""])').last().getAttribute("value");
  await builder.locator('select[name="classId"]').selectOption(classId);
  await expect.poll(() => page.evaluate(() => {
    const applications = [
      ...Object.values(ui.windows ?? {}),
      ...Array.from(foundry.applications.instances?.values?.() ?? []),
    ];
    const plan = applications.find((app) => app.id === "warcraft-character-creation")?.plan;
    return plan ? { raceId: plan.raceId, classId: plan.classId } : null;
  })).toEqual({ raceId, classId });
  await expect(builder.locator('select[name="classId"]')).toHaveValue(classId);
  await expect(builder.locator('select[name="raceId"]')).toHaveValue(raceId);
  await builder.locator('[data-warcraft-creation-action="next"]').click({ force: true });
  await expect(builder.locator('input[name="abilities.str"]')).toHaveValue("10");
  await builder.locator('[data-warcraft-creation-action="ability"][data-ability="str"][data-delta="1"]').click({ force: true });
  await expect.poll(() => page.evaluate(() => {
    const applications = [
      ...Object.values(ui.windows ?? {}),
      ...Array.from(foundry.applications.instances?.values?.() ?? []),
    ];
    return applications.find((app) => app.id === "warcraft-character-creation")?.plan?.abilities?.str ?? null;
  })).toBe(11);
  await expect(builder.locator('input[name="abilities.str"]')).toHaveValue("11");
});
