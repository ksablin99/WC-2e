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

test("actor refresh preserves manual unique-ID feats and prunes obsolete automatic features", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({ name: "Warcraft Feature Ownership", type: "character" });
    const createdFeats = await actor.createEmbeddedDocuments("Item", [
      {
        name: "Manual Unique-ID Feat",
        type: "feat",
        system: { featType: "feat", uniqueId: "e2e-manual-feat", userNonRemovable: false },
      },
      {
        name: "Obsolete Automatic Feature",
        type: "feat",
        system: { featType: "classFeat", uniqueId: "e2e-obsolete-auto", userNonRemovable: true },
      },
    ], { stopUpdates: true, _warcraftBypassFeatValidation: true });
    const manual = createdFeats.find((feat) => feat.name === "Manual Unique-ID Feat");
    const automatic = createdFeats.find((feat) => feat.name === "Obsolete Automatic Feature");

    const before = { manual: actor.items.has(manual.id), automatic: actor.items.has(automatic.id) };
    await actor.refresh();
    return {
      before,
      after: { manual: actor.items.has(manual.id), automatic: actor.items.has(automatic.id) },
    };
  });

  expect(result).toEqual({
    before: { manual: true, automatic: true },
    after: { manual: true, automatic: false },
  });
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
    const createdItems = await actor.createEmbeddedDocuments("Item", [
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
    const weapon = createdItems.find((item) => item.name === "Test Flintlock Pistol");
    const ammunition = createdItems.find((item) => item.name === "Pistol Balls (10)");
    const powder = createdItems.find((item) => item.name === "Gunpowder Horn (2 lb.)");
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

test("guided builder completes a non-default first-level character and persists its history", async ({ page }, testInfo) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const actorId = await page.evaluate(async () => (await Actor.create({ name: "Warcraft Recruit", type: "character" })).id);
  const sheetId = await openSheet(page, actorId);
  await page.locator(`#${sheetId} [data-warcraft-character-builder]`).click();
  const builder = page.locator("#warcraft-character-creation");
  try {
    await expect(builder).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    const browserErrors = [
      ...pageErrors.map((message) => `[pageerror] ${message}`),
      ...consoleErrors.map((message) => `[console.error] ${message}`),
    ];
    await testInfo.attach("builder-open-browser-errors", {
      body: browserErrors.length ? browserErrors.join("\n\n") : "No browser errors captured.",
      contentType: "text/plain",
    });
    throw new Error(`Character builder did not become visible within 30 seconds. Browser errors:\n${browserErrors.join("\n\n") || "(none)"}`, { cause: error });
  }
  await expect.poll(() => builder.locator('select[name="raceId"] option').count()).toBeGreaterThan(1);
  await expect.poll(() => builder.locator('select[name="classId"] option').count()).toBeGreaterThan(1);
  await expect.poll(() => builder.locator('select[name="raceId"] option:not([value=""])').count()).toBeGreaterThan(1);
  await expect.poll(() => builder.locator('select[name="classId"] option:not([value=""])').count()).toBeGreaterThan(1);

  // Use stable, non-default choices so a rerender reset cannot look like success.
  await builder.locator('select[name="raceId"]').selectOption({ label: "Orc" });
  const raceId = await builder.locator('select[name="raceId"]').inputValue();
  expect(raceId).not.toBe("");
  await expect.poll(() => page.evaluate(() => {
    const applications = [
      ...Object.values(ui.windows ?? {}),
      ...Array.from(foundry.applications.instances?.values?.() ?? []),
    ];
    return applications.find((app) => app.id === "warcraft-character-creation")?.plan?.raceId ?? null;
  })).toBe(raceId);
  await expect(builder.locator('select[name="raceId"]')).toHaveValue(raceId);
  await expect(builder.locator('select[name="classId"]')).toHaveValue("");
  await builder.locator('select[name="classId"]').selectOption({ label: "Warrior" });
  const classId = await builder.locator('select[name="classId"]').inputValue();
  expect(classId).not.toBe("");
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
  await builder.locator('input[name="gender"]').fill("Male");
  await builder.locator('input[name="deity"]').fill("The Ancestors");
  await builder.locator('input[name="affiliation"]').fill("Orgrimmar");
  await builder.locator('input[name="affiliationRating"]').fill("2");
  await builder.locator('[data-warcraft-creation-action="next"]').click({ force: true });

  await expect(builder.locator('input[name="abilities.str"]')).toHaveValue("10");
  for (const expected of ["11", "12", "13"]) {
    await builder.locator('[data-warcraft-creation-action="ability"][data-ability="str"][data-delta="1"]').click({ force: true });
    await expect(builder.locator('input[name="abilities.str"]')).toHaveValue(expected);
  }
  await expect.poll(() => page.evaluate(() => {
    const applications = [
      ...Object.values(ui.windows ?? {}),
      ...Array.from(foundry.applications.instances?.values?.() ?? []),
    ];
    return applications.find((app) => app.id === "warcraft-character-creation")?.plan?.abilities?.str ?? null;
  })).toBe(13);
  await builder.locator('[data-warcraft-creation-action="next"]').click({ force: true });

  const climb = builder.locator('input[name="skills.clm"]');
  await expect(climb).toBeVisible();
  await climb.fill("1");
  await builder.locator('[data-warcraft-creation-action="next"]').click({ force: true });

  const feat = builder.locator("#feat-list li").filter({ hasText: "Blind-Fight" }).locator('input[name="featIds"]');
  await expect(feat).toHaveCount(1);
  const featId = await feat.getAttribute("value");
  await feat.check({ force: true });
  await expect(feat).toBeChecked();
  await builder.locator('[data-warcraft-creation-action="next"]').click({ force: true });

  const equipment = builder.locator("#equipment-list li").filter({ hasText: "Backpack" }).locator('input[name="equipmentIds"]');
  await expect(equipment).toHaveCount(1);
  const equipmentId = await equipment.getAttribute("value");
  await equipment.check({ force: true });
  await expect(equipment).toBeChecked();
  await builder.locator('[data-warcraft-creation-action="next"]').click({ force: true });

  await expect(builder).toContainText("Orc");
  await expect(builder).toContainText("Warrior");
  await expect(builder).toContainText("STR 13");
  const complete = builder.locator('[data-warcraft-creation-action="complete"]');
  await expect(complete).toBeEnabled();
  await complete.click({ force: true });

  try {
    await expect(builder).toBeHidden({ timeout: 15_000 });
  } catch (error) {
    await testInfo.attach("builder-page-errors", {
      body: pageErrors.length ? pageErrors.join("\n\n") : "No page errors captured.",
      contentType: "text/plain",
    });
    throw new Error(`Character builder did not close after Create character. Page errors:\n${pageErrors.join("\n\n") || "(none)"}`, { cause: error });
  }

  await expect.poll(() => page.evaluate(({ actorId, raceId, classId, featId, equipmentId }) => {
    const actor = game.actors.get(actorId);
    const race = actor.items.find((item) => item.type === "race" && item.name === "Orc");
    const characterClass = actor.items.find((item) => item.type === "class" && item.name === "Warrior");
    const feat = actor.items.find((item) => item.type === "feat" && item.name === "Blind-Fight");
    const equipment = actor.items.find((item) => item.name === "Backpack");
    const history = actor.system.details.levelUpData?.[0];
    return {
      completed: actor.flags.warcraftrpg2e?.creation?.completed ?? false,
      identity: {
        gender: actor.system.details.gender,
        deity: actor.system.details.deity,
        affiliation: actor.system.details.affiliation,
        affiliationRating: actor.system.details.affiliationRating,
      },
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((key) => [key, actor.system.abilities[key].value])),
      climbPoints: actor.system.skills.clm.points,
      race: race ? { name: race.name, originPack: race.system.originPack, originId: race.system.originId === raceId } : null,
      characterClass: characterClass ? {
        name: characterClass.name,
        levels: characterClass.system.levels,
        originPack: characterClass.system.originPack,
        originId: characterClass.system.originId === classId,
      } : null,
      feat: feat ? { name: feat.name, originPack: feat.system.originPack, originId: feat.system.originId === featId } : null,
      equipment: equipment ? { name: equipment.name, originPack: equipment.system.originPack, originId: equipment.system.originId === equipmentId } : null,
      currency: {
        pp: actor.system.currency.pp,
        gp: actor.system.currency.gp,
        sp: actor.system.currency.sp,
        cp: actor.system.currency.cp,
      },
      history: history ? {
        count: actor.system.details.levelUpData.length,
        level: history.level,
        className: history.class,
        classMatches: history.classId === characterClass?.id,
        path: history.path ?? null,
        hp: history.hp,
        climb: history.skills?.clm ?? null,
        hasFeat: history.hasFeat,
        hasAbility: history.hasAbility,
      } : null,
    };
  }, { actorId, raceId, classId, featId, equipmentId }), { timeout: 15_000 }).toEqual({
    completed: true,
    identity: { gender: "Male", deity: "The Ancestors", affiliation: "Orgrimmar", affiliationRating: 2 },
    abilities: { str: 13, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    climbPoints: 1,
    race: { name: "Orc", originPack: "warcraftrpg2e.warcraft-races", originId: true },
    characterClass: { name: "Warrior", levels: 1, originPack: "warcraftrpg2e.warcraft-classes", originId: true },
    feat: { name: "Blind-Fight", originPack: "warcraftrpg2e.warcraft-feats", originId: true },
    equipment: { name: "Backpack", originPack: "warcraftrpg2e.warcraft-equipment", originId: true },
    currency: { pp: 0, gp: 98, sp: 0, cp: 0 },
    history: {
      count: 1,
      level: 1,
      className: "Warrior",
      classMatches: true,
      path: null,
      hp: 10,
      climb: { points: 1, rank: 1, cls: true, subskills: {} },
      hasFeat: true,
      hasAbility: false,
    },
  });

  await testInfo.attach("builder-page-errors", {
    body: pageErrors.length ? pageErrors.join("\n\n") : "No page errors captured.",
    contentType: "text/plain",
  });
  expect(pageErrors, "Character builder emitted unexpected page errors").toEqual([]);
});
