/**
 * E2E class tests — import each core class from the D35E compendium, add it
 * to a fresh actor at level 5, and assert BAB and saving throw totals.
 * Also verifies that class feature abilities appear on the character sheet.
 *
 * BAB progression (level 5):
 *   high → 5    med → 3    low → 2
 * Save progression (base, level 5, no ability modifier):
 *   high → 4    low → 1
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissSystemDialogs } = require('./helpers');

// ── Expected values per class ─────────────────────────────────────────────────
//
// Format: [className, packId, expectedBAB, { fort, ref, will }]
//   where save values are the base totals at level 5 (no ability modifier).
//
// BAB:  high=5, med=3, low=2
// Save: high=4, low=1
const CLASS_CASES = [
  // High BAB, fort good
  ['Fighter',   'sgwZt7dg1ZHXQlrW', 5, { fort: 4, ref: 1, will: 1 }],
  ['Barbarian', 'ynBCeSzLGXnQIREO', 5, { fort: 4, ref: 1, will: 1 }],
  ['Paladin',   'i8FlSB5c6b5TlXHc', 5, { fort: 4, ref: 1, will: 1 }],
  ['Ranger',    'u7dga44lYsIPLYvV', 5, { fort: 4, ref: 4, will: 1 }],
  // Med BAB, various saves
  ['Rogue',     'Peiv9Y6pDYt6hR5v', 3, { fort: 1, ref: 4, will: 1 }],
  ['Bard',      'WRPq41FTQocsxxBU', 3, { fort: 1, ref: 4, will: 4 }],
  ['Cleric',    'qaM4mLNombMrdL2M', 3, { fort: 4, ref: 1, will: 4 }],
  ['Druid',     '49GnJA0FkMKKYKqQ', 3, { fort: 4, ref: 1, will: 4 }],
  ['Monk',      'JzrAdWAh2ucGpgFa', 3, { fort: 4, ref: 4, will: 4 }],
  // Low BAB, will good
  ['Wizard',    'VwVlbNYqDgMBIWhQ', 2, { fort: 1, ref: 1, will: 4 }],
  ['Sorcerer',  'u0ULzrnt9daT9Ygq', 2, { fort: 1, ref: 1, will: 4 }],
];

const LEVEL = 5;
const CLASS_PACK = 'warcraftrpg2e.classes';

// ── Shared beforeEach ─────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
});

// ── Helper: fetch class from compendium and add to actor ──────────────────────

async function createActorWithClass(page, className, classId, level) {
  return page.evaluate(async ({ className, classId, packId, level }) => {
    // 1. Create a base character with neutral ability scores (10 in everything)
    const actor = await Actor.create({
      name: `Test ${className}`,
      type: 'character',
      system: {
        abilities: {
          str: { value: 10 }, dex: { value: 10 }, con: { value: 10 },
          int: { value: 10 }, wis: { value: 10 }, cha: { value: 10 },
        },
      },
    });

    // 2. Import class from compendium
    const pack = game.packs.get(packId);
    if (!pack) throw new Error(`Pack not found: ${packId}`);
    const classItem = await pack.getDocument(classId);
    if (!classItem) throw new Error(`Class not found in pack: ${classId}`);

    // 3. Add to actor with the target level, then re-fetch
    const classData = classItem.toObject();
    classData.system.levels = level;
    await actor.createEmbeddedDocuments('Item', [classData]);

    const a = game.actors.get(actor.id);
    return {
      id: a.id,
      bab:  a.system.attributes.bab.total,
      fort: a.system.attributes.savingThrows.fort.total,
      ref:  a.system.attributes.savingThrows.ref.total,
      will: a.system.attributes.savingThrows.will.total,
    };
  }, { className, classId, packId: CLASS_PACK, level });
}

// ── Generate one test per class ───────────────────────────────────────────────

for (const [className, classId, expectedBab, expectedSaves] of CLASS_CASES) {
  test(`${className} lv${LEVEL}: BAB=${expectedBab} saves fort=${expectedSaves.fort}/ref=${expectedSaves.ref}/will=${expectedSaves.will}`, async ({ page }) => {
    const result = await createActorWithClass(page, className, classId, LEVEL);

    expect(result.bab,  `${className} BAB`).toBe(expectedBab);
    expect(result.fort, `${className} Fort`).toBe(expectedSaves.fort);
    expect(result.ref,  `${className} Ref`).toBe(expectedSaves.ref);
    expect(result.will, `${className} Will`).toBe(expectedSaves.will);
  });
}

// ── Class feature progression: sheet inspection ───────────────────────────────
//
// Adds Fighter (level 5) to an actor, opens the character sheet, and verifies
// that the expected class abilities are visible as item rows in the sheet.
//
// Fighter level 5 automatic features:
//   Level 1: proficiencies (7 feats) + 1 Bonus Feat
//   Level 2: Bonus Feat
//   Level 4: Bonus Feat
//   → 10 embedded items total (1 class + 7 proficiencies + 3 bonus feats)

test('Fighter lv5: class features appear on character sheet', async ({ page }) => {
  await dismissSystemDialogs(page);

  // ── 1. Create actor with Fighter lv5 ──────────────────────────────────────
  const actorId = await page.evaluate(async ({ packId, classId, level }) => {
    const actor = await Actor.create({
      name: 'Test Fighter Sheet',
      type: 'character',
      system: {
        abilities: {
          str: { value: 10 }, dex: { value: 10 }, con: { value: 10 },
          int: { value: 10 }, wis: { value: 10 }, cha: { value: 10 },
        },
      },
    });

    const pack = game.packs.get(packId);
    const index = await pack.getIndex();
    const entry = [...index].find(e => e._id === classId);
    const classItem = await pack.getDocument(entry._id);
    const classData = classItem.toObject();
    classData.system.levels = level;
    await actor.createEmbeddedDocuments('Item', [classData]);

    // Verify data-layer: 11 embedded items (1 class + 7 proficiencies + 3 bonus feats)
    const a = game.actors.get(actor.id);
    if (a.items.size !== 11)
      throw new Error(`Expected 11 items, got ${a.items.size}: ${[...a.items].map(i => i.name).join(', ')}`);

    return actor.id;
  }, { packId: CLASS_PACK, classId: 'sgwZt7dg1ZHXQlrW', level: 5 });

  // ── 2. Open the character sheet and navigate to the Features tab ─────────
  await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    await actor.sheet.render(true);
  }, actorId);

  const sheetLocator = page.locator(`.app.sheet.item[id*="${actorId}"], .app.sheet.actor[id*="${actorId}"]`).first();
  await sheetLocator.waitFor({ state: 'visible', timeout: 10_000 });

  // Click the Features tab nav link (data-tab="feats") to make class abilities visible
  await sheetLocator.locator('nav [data-tab="feats"]').click();
  // The sheet intentionally separates the Class row from its automatically
  // granted Class Features. Use the rendered "All" section so both groups are
  // visible without assuming their numeric data-tab ids.
  const allTab = sheetLocator.locator('nav[data-group="feats"] [data-tab]')
    .filter({ hasText: /^All$/ })
    .first();
  await expect(allTab).toBeVisible();
  const allTabId = await allTab.getAttribute('data-tab');
  expect(allTabId, 'All-features section should have a tab id').toBeTruthy();
  await allTab.click();
  const classSection = sheetLocator.locator(`.feats-body > [data-group="feats"][data-tab="${allTabId}"]`);
  await expect(classSection).toBeVisible();

  // ── 3. Assert class abilities visible in the sheet ────────────────────────
  const expectedFeatures = [
    'Fighter',                         // class row
    'Tower Shield Proficiency',
    'Martial Weapon Proficiency (All)',
    'Armor Proficiency (Light)',
    'Armor Proficiency (Medium)',
    'Armor Proficiency (Heavy)',
    'Simple Weapon Proficiency',
    'Shield Proficiency',
    'Bonus Feat (Fighter)',
  ];

  for (const featureName of expectedFeatures) {
    await expect(
      classSection.locator(`.item-name:has-text("${featureName}")`).first(),
      `"${featureName}" should be visible on the Fighter sheet`
    ).toBeVisible();
  }

  // ── 4. Assert Bonus Feat appears at least 3 times (levels 1, 2, 4) ────────
  const bonusFeatRows = classSection.locator('.item-name:has-text("Bonus Feat (Fighter)")');
  const bonusFeatCount = await bonusFeatRows.count();
  expect(bonusFeatCount, 'Fighter lv5 should have at least 3 Bonus Feat rows').toBeGreaterThanOrEqual(3);
});
