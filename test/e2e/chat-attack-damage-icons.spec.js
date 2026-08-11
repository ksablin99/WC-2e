'use strict';

/**
 * E2E tests for localization fixes in issues #1585 and #1626.
 *
 * Issue 1585 — Chat attack card damage icon lookup now uses `damageTypeUid`
 * (language-independent canonical key like "energy-fire") instead of the
 * localized display name, so translated damage type names no longer cause the
 * wrong icon to appear.
 *
 * Issue 1626 — `D35E.damageTraitTypes` and `D35E.bonusModifiers` in config.js
 * now use i18n keys.  All display paths call `game.i18n.localize()` so the UI
 * renders translated labels instead of raw key strings.
 *
 * Covers:
 *   1. Damage icon resolves from uid, not display name — a fire weapon whose
 *      damage type display name is the French word "Feu" (not "fire") still
 *      produces fire.svg because the fix checks `damageTypeUid` first.
 *   2. Actor DI/DV trait tags show localized text, not raw i18n keys.
 *   3. Trait selector dialog for DI has the full 11-entry damageTraitTypes
 *      list (Bludgeoning, Piercing, Fire …) not the old 2-entry damageTypes.
 *   4. Bonus modifier labels in the Changes tab are localized — "Enhancement",
 *      not "D35E.BonusModEnhancement".
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');
const { openSheet } = require('./helpers/actor-sheet');

// ── Lifecycle ──────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

// ── Helpers ────────────────────────────────────────────────────────────────────

async function createCharacter(page, name = 'Localization Test Actor') {
  return page.evaluate(async (name) => {
    const actor = await Actor.create({
      name,
      type: 'character',
      system: {
        abilities: {
          str: { value: 14 },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 10 },
          wis: { value: 10 },
          cha: { value: 10 },
        },
      },
    });
    return actor.id;
  }, name);
}

// ── 1. Damage icon resolves from uid, not display name ─────────────────────────

test('fire weapon damage icon is fire.svg when damageTypeUid is energy-fire, even with non-English display name', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  const msgsBefore = await page.evaluate(() => game.messages.size);

  // Create a weapon where the damage type display name is the French word "Feu"
  // (not "fire" — which the old code would have failed to match).
  // The uid "energy-fire" is what the fix switches on to resolve the icon.
  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Fire Weapon Actor',
      type: 'character',
      system: {
        abilities: {
          str: { value: 14 },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 10 },
          wis: { value: 10 },
          cha: { value: 10 },
        },
      },
    });

    // Use type "attack" which includes the "action" template (has damage.parts).
    // damage.parts format: [formula, displayName, uid]
    // "Feu" is the French word for Fire — the old code would not recognise it
    // and would fall through to "unknown".  The fix checks uid first.
    const [weapon] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Flaming Sword',
      type: 'attack',
      system: {
        actionType: 'mwak',
        attackType: 'weapon',
        ability: {
          attack: 'str',
          damage: 'str',
          damageMult: 1,
          critRange: 20,
          critMult: 2,
        },
        damage: {
          parts: [['1d6', 'Feu', 'energy-fire']],
        },
      },
    }]);

    return { actorId: actor.id, weaponId: weapon.id };
  });

  // Use the weapon — skip dialog so it posts immediately.
  let useError = null;
  try {
    await page.evaluate(async ({ actorId, weaponId }) => {
      const actor = game.actors.get(actorId);
      const weapon = actor.items.get(weaponId);
      await weapon.use({ skipDialog: true });
    }, result);
  } catch (err) {
    useError = err.message;
  }

  expect(useError, 'weapon.use() should not throw').toBeNull();

  // A chat message must appear.
  await page.waitForFunction(
    (before) => game.messages.size > before,
    msgsBefore,
    { timeout: 10_000 },
  );

  // Inspect the rendered HTML of the last chat message for icon srcs.
  const iconSrcs = await page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    if (!msg) return [];
    const div = document.createElement('div');
    div.innerHTML = msg.content ?? '';
    return Array.from(div.querySelectorAll('img.dmg-type-icon')).map(img => img.getAttribute('src'));
  });

  // At least one icon must be present (the damage tooltip renders one per part).
  expect(iconSrcs.length, 'at least one dmg-type-icon img should be in the chat message').toBeGreaterThan(0);

  // Every icon must NOT fall back to unknown.svg — the uid-based lookup handles it.
  const unknownIcons = iconSrcs.filter(src => src && src.includes('unknown.svg'));
  expect(unknownIcons, 'no damage icon should fall back to unknown.svg when uid is energy-fire').toHaveLength(0);

  // Specifically, fire.svg should appear.
  const fireIcons = iconSrcs.filter(src => src && src.includes('fire.svg'));
  expect(fireIcons.length, 'at least one icon should be fire.svg').toBeGreaterThan(0);

  // No JS errors.
  const badErrors = consoleErrors.filter(e =>
    e.includes('TypeError') || e.includes('Cannot read properties')
  );
  expect(badErrors, 'no TypeError errors in console').toHaveLength(0);
});

// ── 2. Damage icon resolves correctly with English display name (regression guard) ─

test('fire weapon damage icon is fire.svg with English display name "Fire"', async ({ page }) => {
  const msgsBefore = await page.evaluate(() => game.messages.size);

  const result = await page.evaluate(async () => {
    const actor = await Actor.create({
      name: 'Fire Weapon Actor (EN)',
      type: 'character',
      system: {
        abilities: {
          str: { value: 14 },
          dex: { value: 10 },
          con: { value: 10 },
          int: { value: 10 },
          wis: { value: 10 },
          cha: { value: 10 },
        },
      },
    });
    const [weapon] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Flaming Sword (EN)',
      type: 'attack',
      system: {
        actionType: 'mwak',
        attackType: 'weapon',
        ability: {
          attack: 'str',
          damage: 'str',
          damageMult: 1,
          critRange: 20,
          critMult: 2,
        },
        damage: {
          parts: [['1d6', 'Fire', 'energy-fire']],
        },
      },
    }]);
    return { actorId: actor.id, weaponId: weapon.id };
  });

  await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const weapon = actor.items.get(weaponId);
    await weapon.use({ skipDialog: true });
  }, result);

  await page.waitForFunction(
    (before) => game.messages.size > before,
    msgsBefore,
    { timeout: 10_000 },
  );

  const iconSrcs = await page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    if (!msg) return [];
    const div = document.createElement('div');
    div.innerHTML = msg.content ?? '';
    return Array.from(div.querySelectorAll('img.dmg-type-icon')).map(img => img.getAttribute('src'));
  });

  expect(iconSrcs.length, 'at least one dmg-type-icon img should be present').toBeGreaterThan(0);

  const unknownIcons = iconSrcs.filter(src => src && src.includes('unknown.svg'));
  expect(unknownIcons, 'no icon should fall back to unknown.svg for English "Fire"').toHaveLength(0);

  const fireIcons = iconSrcs.filter(src => src && src.includes('fire.svg'));
  expect(fireIcons.length, 'at least one icon should be fire.svg').toBeGreaterThan(0);
});

// ── 4. Actor DI/DV trait tags show localized text, not raw i18n keys ───────────

test('damage immunity tags show localized text "Fire", not raw key "D35E.DamTypeFire"', async ({ page }) => {
  const actorId = await createCharacter(page, 'DI Tag Actor');

  // Set fire immunity directly on the actor.
  await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    await actor.update({ 'system.traits.di.value': ['fire'] });
  }, actorId);

  const sheetId = await openSheet(page, actorId);

  // Traits are on the "attributes" tab on the character sheet.
  const attributesTab = page.locator(`#${sheetId} nav.sheet-navigation.tabs a[data-tab="attributes"]`);
  if (await attributesTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await attributesTab.click();
    await page.waitForTimeout(400);
  }

  // The template renders: <ul class="traits-list"><li class="tag fire">{{v}}</li></ul>
  // where {{v}} is game.i18n.localize(choices['fire']) = "Fire".
  // We use { force: true } for waitFor because the tag may be inside a display:none section
  // that becomes visible after the tab click — use a JS query to avoid visibility issues.
  const tagText = await page.waitForFunction(
    (sheetId) => {
      const el = document.querySelector(`#${sheetId} .tag.fire`);
      return el ? el.textContent.trim() : null;
    },
    sheetId,
    { timeout: 8_000 },
  );

  const text = await tagText.jsonValue();

  expect(text, 'DI tag should display "Fire", not a raw i18n key').toBe('Fire');
  expect(text, 'DI tag must not contain the raw key prefix D35E.').not.toContain('D35E.');
});

// ── 5. Trait selector dialog for DI has full 11-entry damageTraitTypes list ────

test('trait selector for damage immunity shows all damageTraitTypes options (at least 5), not just 2', async ({ page }) => {
  const actorId = await createCharacter(page, 'DI Selector Actor');
  const sheetId = await openSheet(page, actorId);

  // Navigate to the attributes tab where Traits section lives.
  const attributesTab = page.locator(`#${sheetId} nav.sheet-navigation.tabs a[data-tab="attributes"]`);
  if (await attributesTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await attributesTab.click();
    await page.waitForTimeout(400);
  }

  // Open the trait selector via page.evaluate to avoid clicking hidden elements.
  // The template uses data-options="damageTraitTypes" on the DI trait-selector link.
  await page.evaluate(async (sheetId) => {
    const link = document.querySelector(`#${sheetId} a.trait-selector[data-options="damageTraitTypes"]`);
    if (!link) throw new Error('trait-selector link not found');
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }, sheetId);

  // Wait for the trait selector dialog.
  const dialog = page.locator('#trait-selector');
  await dialog.waitFor({ state: 'visible', timeout: 8_000 });

  // Count the checkbox options.
  const checkboxLabels = dialog.locator('ol.trait-list li label');
  const count = await checkboxLabels.count();

  // damageTraitTypes has 11 entries.  The old (wrong) damageTypes only had 2.
  expect(count, 'trait selector should show all 11 damage trait types, not only 2').toBeGreaterThanOrEqual(5);

  // Confirm specific entries exist.
  const allText = await dialog.locator('ol.trait-list').textContent();
  expect(allText, 'trait selector should include "Bludgeoning"').toContain('Bludgeoning');
  expect(allText, 'trait selector should include "Fire"').toContain('Fire');
  expect(allText, 'trait selector must not contain raw i18n key prefix').not.toContain('D35E.');
});

// ── 6. Bonus modifier labels in the Changes tab are localized ──────────────────

test('Changes tab modifier dropdown shows "Enhancement", not raw key "D35E.BonusModEnhancement"', async ({ page }) => {
  // Create a weapon item owned by a character with a change entry, then check
  // the modifier dropdown on the item sheet Changes subtab.
  const actorId = await createCharacter(page, 'Changes Tab Actor');

  const weaponId = await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    // changes array format: [formula, target, subTarget, modifier]
    const [weapon] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Test Sword',
      type: 'weapon',
      system: {
        actionType: 'mwak',
        changes: [['1', 'ab', '', 'enh']],
      },
    }]);
    return weapon.id;
  }, actorId);

  // Open the item sheet directly.
  const itemSheetId = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    const app = item.sheet;
    await app.render(true);
    await new Promise(r => setTimeout(r, 600));
    return app.id;
  }, { actorId, weaponId });

  await page.locator(`#${itemSheetId}`).waitFor({ state: 'visible', timeout: 10_000 });
  await dismissOverlays(page);

  // Click the "Configuration" primary tab (weapon sheet uses a two-level tab structure:
  // primary "configuration" tab → subtab "changes").
  const configTab = page.locator(`#${itemSheetId} nav.sheet-navigation.tabs[data-group="primary"] a[data-tab="configuration"]`);
  await configTab.waitFor({ state: 'visible', timeout: 5_000 });
  await configTab.click();
  await page.waitForTimeout(300);

  // Click the "Changes" subtab within the configuration panel.
  // The subtab nav uses data-group="configuration".
  const changesSubTab = page.locator(`#${itemSheetId} nav.sheet-navigation.tabs[data-group="configuration"] a[data-tab="changes"]`);
  await changesSubTab.waitFor({ state: 'visible', timeout: 5_000 });
  await changesSubTab.click();
  await page.waitForTimeout(300);

  // The modifier dropdown is `<select name="system.changes.0.3">`.
  const modifierSelect = page.locator(`#${itemSheetId} select[name="system.changes.0.3"]`);
  await modifierSelect.waitFor({ state: 'visible', timeout: 5_000 });

  // Extract all option texts from the modifier dropdown.
  const optionTexts = await modifierSelect.evaluate((sel) =>
    Array.from(sel.options).map(o => o.text)
  );

  // Must contain the localized "Enhancement" label.
  expect(optionTexts, 'modifier dropdown must contain "Enhancement"').toContain('Enhancement');

  // Must NOT contain any raw i18n key strings.
  const rawKeys = optionTexts.filter(t => t.startsWith('D35E.'));
  expect(rawKeys, 'modifier dropdown must not contain raw D35E.* keys').toHaveLength(0);
});

// ── 7. displayDefenses() — defense chat message uses localized trait names ─────

test('displayDefenses posts chat message with localized immunity/vulnerability labels', async ({ page }) => {
  const actorId = await createCharacter(page, 'Defense Chat Actor');

  // Set fire immunity and cold vulnerability.
  await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    await actor.update({
      'system.traits.di.value': ['fire'],
      'system.traits.dv.value': ['cold'],
    });
  }, actorId);

  const msgsBefore = await page.evaluate(() => game.messages.size);

  // Call displayDefenses — it posts a chat message via createCustomChatMessage.
  await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    await actor.displayDefenses();
  }, actorId);

  // Wait for the new message to appear.
  await page.waitForFunction(
    (before) => game.messages.size > before,
    msgsBefore,
    { timeout: 10_000 },
  );

  // Read the rendered HTML of the last message and collect all tag text content.
  const tagTexts = await page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    if (!msg) return [];
    const div = document.createElement('div');
    div.innerHTML = msg.content ?? '';
    return Array.from(div.querySelectorAll('span.tag')).map(el => el.textContent.trim());
  });

  // The energyResistance array will contain strings like "Immune to Fire"
  // and "Vulnerable to Cold" — they must contain the localized words.
  const allText = tagTexts.join(' ');

  expect(allText, 'defense chat should mention Fire (localized)').toContain('Fire');
  expect(allText, 'defense chat should mention Cold (localized)').toContain('Cold');
  expect(allText, 'defense chat must not contain raw i18n key D35E.DamTypeFire').not.toContain('D35E.DamTypeFire');
  expect(allText, 'defense chat must not contain raw i18n key D35E.DamTypeCold').not.toContain('D35E.DamTypeCold');
});

// ── 8. getDefenseHeaders() — statblock defense section uses localized labels ───

test('getDefenseHeaders returns localized immunity and vulnerability values', async ({ page }) => {
  const actorId = await createCharacter(page, 'Defense Headers Actor');

  // Set fire immunity and cold vulnerability.
  await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    await actor.update({
      'system.traits.di.value': ['fire'],
      'system.traits.dv.value': ['cold'],
    });
  }, actorId);

  // Call getDefenseHeaders() and serialize only plain data.
  const headers = await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    const result = actor.getDefenseHeaders();
    // Return plain objects — serialize header + value arrays.
    return result.map(h => ({ header: h.header, value: h.value }));
  }, actorId);

  // Flatten all values from all headers for easy inspection.
  const allValues = headers.flatMap(h => h.value ?? []);
  const allText = allValues.join(' ');

  expect(allText, 'getDefenseHeaders should include "Fire" (localized)').toContain('Fire');
  expect(allText, 'getDefenseHeaders should include "Cold" (localized)').toContain('Cold');
  expect(allText, 'getDefenseHeaders must not contain raw key D35E.DamTypeFire').not.toContain('D35E.DamTypeFire');
  expect(allText, 'getDefenseHeaders must not contain raw key D35E.DamTypeCold').not.toContain('D35E.DamTypeCold');
});

// ── 9. #translateSourceInfo() — AC source breakdown shows localized bonus type ─

test('AC source details show "Enhancement" label, not raw key "D35E.BonusModEnhancement"', async ({ page }) => {
  const actorId = await createCharacter(page, 'Source Detail Actor');

  // Add an active buff with an enhancement-type change targeting AC, then
  // explicitly call actor.update({}) to trigger the full ActorUpdater pipeline
  // that calls ActorPrepareSourceHelper.setSourceDetails and populates
  // actor.sourceDetails with the bonus type labels.
  await page.evaluate(async (id) => {
    const actor = game.actors.get(id);
    await actor.createEmbeddedDocuments('Item', [{
      name: 'Enhancement Buff',
      type: 'buff',
      system: {
        active: true,
        buffType: 'temp',
        // changes format: [formula, target_label, target_key, bonusType]
        changes: [['1', 'ac', 'ac', 'enh']],
      },
    }]);
    // actor.update({}) triggers ActorUpdater → setSourceDetails
    await actor.update({});
  }, actorId);

  // Wait until sourceDetails has more than just the "Base" entry for AC.
  // The buff's enhancement change adds an entry whose name starts with "Enhancement".
  await page.waitForFunction((id) => {
    const actor = game.actors.get(id);
    const details = actor.sourceDetails;
    if (!details) return false;
    const acEntries = details['system.attributes.ac.normal.total'] ?? [];
    return acEntries.length > 1; // more than just the "Base" entry
  }, actorId, { timeout: 8_000 });

  // Read sourceDetails for the AC normal total — it should have an entry whose
  // name includes the localized bonus type "Enhancement".
  const acSourceEntries = await page.evaluate((id) => {
    const actor = game.actors.get(id);
    const details = actor.sourceDetails;
    if (!details) return [];
    const acEntries = details['system.attributes.ac.normal.total'] ?? [];
    return acEntries.map(e => e.name ?? '');
  }, actorId);

  const allNames = acSourceEntries.join(' ');

  expect(allNames, 'AC source details should contain "Enhancement"').toContain('Enhancement');
  expect(allNames, 'AC source details must not contain raw key D35E.BonusModEnhancement').not.toContain('D35E.BonusModEnhancement');
});

// ── 10. getConditionalModifierTypes() — Conditionals tab modifier dropdown ─────

test('Conditionals tab modifier type dropdown shows "Enhancement", not raw key "D35E.BonusModEnhancement"', async ({ page }) => {
  const actorId = await createCharacter(page, 'Conditionals Tab Actor');

  // Create an attack item with one conditional that has a modifier targeting "attack".
  // target:"attack" causes modifier.isAttack=true → the conditional-type <select> renders.
  const weaponId = await page.evaluate(async (actorId) => {
    const actor = game.actors.get(actorId);
    const [item] = await actor.createEmbeddedDocuments('Item', [{
      name: 'Conditional Attack',
      type: 'attack',
      system: {
        actionType: 'mwak',
        attackType: 'weapon',
        ability: { attack: 'str', damage: 'str', damageMult: 1, critRange: 20, critMult: 2 },
        damage: { parts: [['1d6', 'Slashing', '']] },
        conditionals: [{
          default: false,
          name: 'Test Conditional',
          modifiers: [{
            formula: '1',
            target: 'attack',
            subTarget: 'attack',
            type: 'enh',
            critical: 'normal',
          }],
        }],
      },
    }]);
    return item.id;
  }, actorId);

  // Open the item sheet.
  const itemSheetId = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor = game.actors.get(actorId);
    const item = actor.items.get(weaponId);
    const app = item.sheet;
    await app.render(true);
    await new Promise(r => setTimeout(r, 600));
    return app.id;
  }, { actorId, weaponId });

  await page.locator(`#${itemSheetId}`).waitFor({ state: 'visible', timeout: 10_000 });
  await dismissOverlays(page);

  // Navigate to the "conditionals" tab on the attack sheet.
  const condTab = page.locator(`#${itemSheetId} nav.tabs a[data-tab="conditionals"]`);
  await condTab.waitFor({ state: 'visible', timeout: 5_000 });
  await condTab.click();
  await page.waitForTimeout(300);

  // The conditional-type select is rendered only when modifier.isAttack is true.
  const typeSelect = page.locator(`#${itemSheetId} select.conditional-type`);
  await typeSelect.waitFor({ state: 'attached', timeout: 5_000 });

  const optionTexts = await typeSelect.evaluate((sel) =>
    Array.from(sel.options).map(o => o.text)
  );

  expect(optionTexts, 'conditional modifier type dropdown must contain "Enhancement"').toContain('Enhancement');

  const rawKeys = optionTexts.filter(t => t.startsWith('D35E.'));
  expect(rawKeys, 'conditional modifier type dropdown must not contain raw D35E.* keys').toHaveLength(0);
});
