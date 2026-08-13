'use strict';

/**
 * E2E tests for issue #1528 — weapons (and equipment) taken out of containers
 * restore carried state and optionally prompt to re-equip like the sheet equip button.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld, dismissOverlays, dismissSystemDialogs } = require('./helpers');

const WEAPONS_PACK = 'warcraftrpg2e.weapons-and-ammo';
const LONGSWORD_ID = 'zWRlna42PMJVX6un';
const ITEMS_PACK = 'warcraftrpg2e.items';
const BACKPACK_ID = 'J5B6MDXxtNAlTBAj';
const CLASS_PACK = 'warcraftrpg2e.classes';
const FIGHTER_ID = 'sgwZt7dg1ZHXQlrW';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
  await dismissSystemDialogs(page);
  await dismissOverlays(page);
});

/**
 * Fighter + Longsword + attack + backpack; longsword starts equipped.
 * Returns actorId, weaponId, attackId, bagId.
 */
async function createFighterEquippedLongswordWithBackpack(page) {
  return page.evaluate(
    async ({ WEAPONS_PACK, LONGSWORD_ID, ITEMS_PACK, BACKPACK_ID, CLASS_PACK, FIGHTER_ID }) => {
      const actor = await Actor.create({
        name: 'Container Weapon Test',
        type: 'character',
        system: { abilities: { str: { value: 16 }, dex: { value: 12 } } },
      });

      const classPack = game.packs.get(CLASS_PACK);
      const classItem = await classPack.getDocument(FIGHTER_ID);
      const classData = classItem.toObject();
      classData.system.levels = 5;
      await actor.createEmbeddedDocuments('Item', [classData]);

      const weaponPack = game.packs.get(WEAPONS_PACK);
      const longsword = await weaponPack.getDocument(LONGSWORD_ID);
      const [weapon] = await actor.createEmbeddedDocuments('Item', [longsword.toObject()]);

      const itemsPack = game.packs.get(ITEMS_PACK);
      const backpackDoc = await itemsPack.getDocument(BACKPACK_ID);
      const [bag] = await actor.createEmbeddedDocuments('Item', [backpackDoc.toObject()]);

      await actor.items.get(weapon.id).update({ 'system.equipped': true });

      let a = game.actors.get(actor.id);
      let attack = null;
      for (let i = 0; i < 30; i++) {
        a = game.actors.get(actor.id);
        attack = a.items.find((it) => it.type === 'attack' && it.system.originalWeaponId === weapon.id);
        if (attack) break;
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!attack) throw new Error('Attack item was not auto-created');

      return {
        actorId: a.id,
        weaponId: weapon.id,
        attackId: attack.id,
        bagId: bag.id,
      };
    },
    { WEAPONS_PACK, LONGSWORD_ID, ITEMS_PACK, BACKPACK_ID, CLASS_PACK, FIGHTER_ID }
  );
}

/** Matches `ItemContainerHook._reequipDialogApplicationId` (stable app / DOM id). */
function containerReequipDialogId(actorId, weaponId) {
  return `d35e-container-reequip-${actorId}-${weaponId}`;
}

/** Stow equipped longsword in bag, then move to root — opens re-equip confirm. */
async function stashThenRemoveWeaponFromContainer(page, { actorId, weaponId, bagId }) {
  await page.evaluate(
    async ({ actorId, weaponId, bagId }) => {
      const a = game.actors.get(actorId);
      await a.items.get(weaponId).update({ 'system.containerId': bagId });
      for (let i = 0; i < 40; i++) {
        const w = game.actors.get(actorId).items.get(weaponId);
        if (w.system.equipped === false) return;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error('expected weapon unequipped in container after stowing');
    },
    { actorId, weaponId, bagId }
  );

  await page.evaluate(
    async ({ actorId, weaponId }) => {
      const a = game.actors.get(actorId);
      await a.items.get(weaponId).update({ 'system.containerId': 'none' });
    },
    { actorId, weaponId }
  );
}

/** After dismiss (No / X / Escape with rejectClose: false): unequipped, carried, flag cleared. */
async function expectReequipDismissedState(page, { actorId, weaponId }) {
  const dialogId = containerReequipDialogId(actorId, weaponId);
  await page.waitForFunction(
    (id) => !document.getElementById(id),
    dialogId,
    { timeout: 5_000 }
  );
  await page.waitForTimeout(300);

  const state = await page.evaluate(({ actorId, weaponId }) => {
    const w = game.actors.get(actorId).items.get(weaponId);
    return {
      equipped: w.system.equipped,
      carried: w.system.carried,
      flag: w.getFlag('warcraftrpg2e', 'equippedBeforeContainer'),
    };
  }, { actorId, weaponId });

  expect(state.equipped).toBe(false);
  expect(state.carried).toBe(true);
  expect(state.flag).toBeUndefined();
}

test('removing equipped weapon from container prompts re-equip; Yes restores attack', async ({ page }) => {
  const { actorId, weaponId, attackId, bagId } = await createFighterEquippedLongswordWithBackpack(page);

  await page.evaluate(
    async ({ actorId, weaponId, bagId }) => {
      const a = game.actors.get(actorId);
      const weapon = a.items.get(weaponId);
      await weapon.update({ 'system.containerId': bagId });
      for (let i = 0; i < 40; i++) {
        const w = game.actors.get(actorId).items.get(weaponId);
        if (w.system.equipped === false) return;
        await new Promise((r) => setTimeout(r, 150));
      }
      throw new Error('expected weapon unequipped in container after stowing');
    },
    { actorId, weaponId, bagId }
  );

  await page.evaluate(
    async ({ actorId, weaponId }) => {
      const a = game.actors.get(actorId);
      const weapon = a.items.get(weaponId);
      await weapon.update({ 'system.containerId': 'none' });
    },
    { actorId, weaponId }
  );

  const yesButton = page.locator('button[data-action="yes"]');
  await yesButton.waitFor({ state: 'visible', timeout: 10_000 });
  await yesButton.click();

  await page.waitForFunction(
    ({ actorId, weaponId }) => {
      const w = game.actors.get(actorId).items.get(weaponId);
      return w.system.equipped === true && w.system.carried === true;
    },
    { actorId, weaponId },
    { timeout: 10_000 }
  );

  const result = await page.evaluate(async ({ actorId, attackId }) => {
    const actor = game.actors.get(actorId);
    const attack = actor.items.get(attackId);
    const before = game.messages.size;
    const useResult = await attack.use({ skipDialog: true });
    if (useResult?.roll) await useResult.roll;
    for (let i = 0; i < 20; i++) {
      if (game.messages.size > before) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const msg = game.messages.contents.at(-1);
    const attacks = msg?.flags?.warcraftrpg2e?.chatTemplateData?.attacks ?? [];
    return {
      wasRolled: useResult?.wasRolled ?? false,
      attackCount: attacks.length,
      firstAttackTotal: attacks[0]?.attack?.total ?? null,
    };
  }, { actorId, attackId });

  expect(result.wasRolled).toBe(true);
  expect(result.attackCount).toBeGreaterThan(0);
  expect(result.firstAttackTotal).toBeGreaterThanOrEqual(9);
  expect(result.firstAttackTotal).toBeLessThanOrEqual(28);
});

test('removing equipped weapon from container — No leaves unequipped and clears stash flag', async ({ page }) => {
  const { actorId, weaponId, bagId } = await createFighterEquippedLongswordWithBackpack(page);

  await stashThenRemoveWeaponFromContainer(page, { actorId, weaponId, bagId });

  const noButton = page.locator('button[data-action="no"]');
  await noButton.waitFor({ state: 'visible', timeout: 10_000 });
  await noButton.click();

  await expectReequipDismissedState(page, { actorId, weaponId });
});

test('removing equipped weapon from container — window close (X) leaves unequipped and clears stash flag', async ({
  page,
}) => {
  const { actorId, weaponId, bagId } = await createFighterEquippedLongswordWithBackpack(page);

  await stashThenRemoveWeaponFromContainer(page, { actorId, weaponId, bagId });

  await page.locator('button[data-action="yes"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    ({ aid, wid }) => {
      const id = `d35e-container-reequip-${aid}-${wid}`;
      return foundry.applications.instances.has(id);
    },
    { aid: actorId, wid: weaponId },
    { timeout: 10_000 }
  );
  // Click the real header close control on the ApplicationV2 root (same path as the X button).
  await page.evaluate(
    ({ aid, wid }) => {
      const id = `d35e-container-reequip-${aid}-${wid}`;
      const app = foundry.applications.instances.get(id);
      app?.element?.querySelector('button[data-action="close"]')?.click();
    },
    { aid: actorId, wid: weaponId }
  );

  await expectReequipDismissedState(page, { actorId, weaponId });
});

test('removing equipped weapon from container — Escape dismisses like No; clears stash flag', async ({ page }) => {
  const { actorId, weaponId, bagId } = await createFighterEquippedLongswordWithBackpack(page);

  await stashThenRemoveWeaponFromContainer(page, { actorId, weaponId, bagId });

  await page.locator('button[data-action="yes"]').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(
    ({ aid, wid }) => {
      const id = `d35e-container-reequip-${aid}-${wid}`;
      return foundry.applications.instances.has(id);
    },
    { aid: actorId, wid: weaponId },
    { timeout: 10_000 }
  );
  // DialogV2#_onKeyDown is on app.element (dialog.mjs); target that node, not document.body.
  await page.evaluate(
    ({ aid, wid }) => {
      const id = `d35e-container-reequip-${aid}-${wid}`;
      const app = foundry.applications.instances.get(id);
      const el = app?.element;
      if (!el) return;
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    },
    { aid: actorId, wid: weaponId }
  );

  await expectReequipDismissedState(page, { actorId, weaponId });
});

test('removing unequipped weapon from container does not prompt; carried restored', async ({ page }) => {
  const { actorId, weaponId, bagId } = await page.evaluate(
    async ({ WEAPONS_PACK, LONGSWORD_ID, ITEMS_PACK, BACKPACK_ID, CLASS_PACK, FIGHTER_ID }) => {
      const actor = await Actor.create({
        name: 'Unequipped Container Test',
        type: 'character',
        system: { abilities: { str: { value: 16 } } },
      });
      const classPack = game.packs.get(CLASS_PACK);
      const classItem = await classPack.getDocument(FIGHTER_ID);
      const classData = classItem.toObject();
      classData.system.levels = 5;
      await actor.createEmbeddedDocuments('Item', [classData]);

      const weaponPack = game.packs.get(WEAPONS_PACK);
      const longsword = await weaponPack.getDocument(LONGSWORD_ID);
      const [weapon] = await actor.createEmbeddedDocuments('Item', [longsword.toObject()]);

      const itemsPack = game.packs.get(ITEMS_PACK);
      const backpackDoc = await itemsPack.getDocument(BACKPACK_ID);
      const [bag] = await actor.createEmbeddedDocuments('Item', [backpackDoc.toObject()]);

      await actor.items.get(weapon.id).update({ 'system.containerId': bag.id });
      const w = game.actors.get(actor.id).items.get(weapon.id);
      if (w.system.equipped !== false) throw new Error('weapon should be unequipped in bag');

      return { actorId: actor.id, weaponId: weapon.id, bagId: bag.id };
    },
    { WEAPONS_PACK, LONGSWORD_ID, ITEMS_PACK, BACKPACK_ID, CLASS_PACK, FIGHTER_ID }
  );

  await page.evaluate(
    async ({ actorId, weaponId }) => {
      const a = game.actors.get(actorId);
      await a.items.get(weaponId).update({ 'system.containerId': 'none' });
    },
    { actorId, weaponId }
  );

  await page.waitForTimeout(800);
  const dialogVisible = await page.locator('button[data-action="yes"]').isVisible().catch(() => false);
  expect(dialogVisible).toBe(false);

  const state = await page.evaluate(({ actorId, weaponId }) => {
    const w = game.actors.get(actorId).items.get(weaponId);
    return { carried: w.system.carried, equipped: w.system.equipped };
  }, { actorId, weaponId });

  expect(state.carried).toBe(true);
  expect(state.equipped).toBe(false);
});
