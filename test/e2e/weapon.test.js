/**
 * E2E weapon tests — import the Longsword from the D35E weapons compendium,
 * manipulate it on an actor, and verify the system responds correctly.
 *
 * D35E weapon flow:
 *   1. Add weapon item (type="weapon") to actor
 *   2. Call actor.createAttackFromWeapon(weapon) → creates attack item (type="attack")
 *      with actionType="mwak", damage parts, crit range, etc.
 *   3. Use the *attack* item (not the weapon) to roll — the weapon itself has no
 *      actionType and will just display a chat card.
 */

const { test, expect } = require('@playwright/test');
const { gotoGame, clearWorld } = require('./helpers');

const WEAPONS_PACK = 'warcraftrpg2e.weapons-and-ammo';
const LONGSWORD_ID = 'zWRlna42PMJVX6un';
const DAGGER_ID    = 'fOSuWwRSZLTrROch';

test.beforeEach(async ({ page }) => {
  await gotoGame(page);
  await clearWorld(page);
});

// ── Helper: create a Fighter with Longsword + derived attack item ─────────────

async function createFighterWithLongsword(page) {
  return page.evaluate(async ({ WEAPONS_PACK, LONGSWORD_ID }) => {
    // 1. Fighter with STR 16 (mod +3)
    const actor = await Actor.create({
      name: 'Sword Fighter',
      type: 'character',
      system: { abilities: { str: { value: 16 }, dex: { value: 12 } } },
    });

    // 2. Add Fighter level 5 from compendium
    const classPack = game.packs.get('warcraftrpg2e.classes');
    const classItem  = await classPack.getDocument('sgwZt7dg1ZHXQlrW');
    const classData  = classItem.toObject();
    classData.system.levels = 5;
    await actor.createEmbeddedDocuments('Item', [classData]);

    // 3. Import Longsword — items always land unequipped, so we must explicitly
    //    equip after creation; that fires D35E.ItemEquip.postEquipItem which
    //    calls createAttackFromWeapon behind the scenes.
    const weaponPack = game.packs.get(WEAPONS_PACK);
    const longsword  = await weaponPack.getDocument(LONGSWORD_ID);
    const [weapon]   = await actor.createEmbeddedDocuments('Item', [longsword.toObject()]);
    await actor.items.get(weapon.id).update({ 'system.equipped': true });

    // 4. Poll for the auto-created attack item (hook runs async, may need a tick)
    let a = game.actors.get(actor.id);
    let attack = null;
    for (let i = 0; i < 30; i++) {
      a = game.actors.get(actor.id);
      attack = a.items.find(
        i => i.type === 'attack' && i.system.originalWeaponId === weapon.id
      );
      if (attack) break;
      await new Promise(r => setTimeout(r, 200));
    }
    if (!attack) throw new Error('Attack item was not auto-created by hook');

    const w = a.items.get(weapon.id);
    return {
      actorId:    a.id,
      weaponId:   w.id,
      attackId:   attack.id,
      weaponName: w.name,
      weaponType: w.system.weaponType,
      attackName: attack.name,
      actionType: attack.system.actionType,
      attackType: attack.system.attackType,
      quantity:   w.system.quantity,
    };
  }, { WEAPONS_PACK, LONGSWORD_ID });
}

// ── 1. Import weapon from compendium ─────────────────────────────────────────

test('imports Longsword from compendium with correct data', async ({ page }) => {
  const r = await createFighterWithLongsword(page);
  expect(r.weaponName).toBe('Longsword');
  expect(r.weaponType).toBe('martial');
  expect(r.quantity).toBe(1);
});

// ── 2. createAttackFromWeapon produces a valid mwak attack item ───────────────

test('createAttackFromWeapon produces a melee attack item', async ({ page }) => {
  const r = await createFighterWithLongsword(page);
  expect(r.attackName).toBe('Longsword');
  expect(r.actionType).toBe('mwak');
  expect(r.attackType).toBe('weapon');
});

// ── 3. Rename weapon (attack item should also update via re-creation) ──────────

test('can rename a weapon on the actor', async ({ page }) => {
  const { actorId, weaponId } = await createFighterWithLongsword(page);

  const newName = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor  = game.actors.get(actorId);
    const weapon = actor.items.get(weaponId);
    await weapon.update({ name: '+1 Longsword' });
    return game.actors.get(actorId).items.get(weaponId).name;
  }, { actorId, weaponId });

  expect(newName).toBe('+1 Longsword');
});

// ── 4. Update quantity ────────────────────────────────────────────────────────

test('can update weapon quantity', async ({ page }) => {
  const { actorId, weaponId } = await createFighterWithLongsword(page);

  const qty = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor  = game.actors.get(actorId);
    const weapon = actor.items.get(weaponId);
    await weapon.update({ 'system.quantity': 3 });
    return game.actors.get(actorId).items.get(weaponId).system.quantity;
  }, { actorId, weaponId });

  expect(qty).toBe(3);
});

// ── 5. Update enhancement bonus on weapon, re-create attack ──────────────────

test('can set enhancement bonus and regenerate attack', async ({ page }) => {
  const { actorId, weaponId } = await createFighterWithLongsword(page);

  const enh = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor  = game.actors.get(actorId);
    const weapon = actor.items.get(weaponId);
    await weapon.update({ 'system.enh': 2 });
    // The update hook fires createAttackFromWeapon when equipped status changes;
    // for an enh-only change we explicitly regenerate (as the UI button does).
    const fresh = game.actors.get(actorId);
    await fresh.createAttackFromWeapon(fresh.items.get(weaponId));
    const updated = game.actors.get(actorId);
    const attack = updated.items.find(i => i.type === 'attack' && i.system.originalWeaponId === weaponId);
    return attack?.system.enh ?? null;
  }, { actorId, weaponId });

  expect(enh).toBe(2);
});

// ── 6. Delete weapon from actor ───────────────────────────────────────────────

test('can delete a weapon from the actor', async ({ page }) => {
  const { actorId, weaponId } = await createFighterWithLongsword(page);

  const weaponCount = await page.evaluate(async ({ actorId, weaponId }) => {
    const actor  = game.actors.get(actorId);
    const weapon = actor.items.get(weaponId);
    await weapon.delete();
    return game.actors.get(actorId).items.filter(i => i.type === 'weapon').length;
  }, { actorId, weaponId });

  expect(weaponCount).toBe(0);
});

// ── 7. Use attack item — verify roll result and attack bonus ──────────────────
//
// Fighter lv5, STR 16 (mod +3) → attack bonus = BAB(5) + STR(3) = +8
// Roll: 1d20 + 8, total in [9, 28]

test('using the attack item produces a roll with expected attack bonus', async ({ page }) => {
  const { actorId, attackId } = await createFighterWithLongsword(page);

  const result = await page.evaluate(async ({ actorId, attackId }) => {
    const actor  = game.actors.get(actorId);
    const attack = actor.items.get(attackId);

    const before = game.messages.size;
    const useResult = await attack.use({ skipDialog: true });

    // useAttack returns { wasRolled: true, roll: Promise } — await the roll promise
    // so the chat message is guaranteed to exist before we inspect it.
    if (useResult?.roll) await useResult.roll;

    // Belt-and-suspenders: poll up to 2s in case the message arrives slightly late
    for (let i = 0; i < 20; i++) {
      if (game.messages.size > before) break;
      await new Promise(r => setTimeout(r, 100));
    }

    // The system stores attack results in flags.warcraftrpg2e.chatTemplateData.attacks[].attack.total
    const msg = game.messages.contents.at(-1);
    const attacks = msg?.flags?.warcraftrpg2e?.chatTemplateData?.attacks ?? [];
    const firstAttackTotal = attacks[0]?.attack?.total ?? null;

    return {
      wasRolled:         useResult?.wasRolled ?? false,
      newMessages:       game.messages.size - before,
      attackCount:       attacks.length,
      firstAttackTotal,
    };
  }, { actorId, attackId });

  expect(result.wasRolled).toBe(true);
  expect(result.newMessages).toBeGreaterThan(0);
  // At least one attack in the chat message
  expect(result.attackCount).toBeGreaterThan(0);
  // Attack roll: 1d20 + 8 (BAB 5 + STR mod 3) → total in [9, 28]
  expect(result.firstAttackTotal).toBeGreaterThanOrEqual(9);
  expect(result.firstAttackTotal).toBeLessThanOrEqual(28);
});

// ── 8. Add multiple weapons from compendium ───────────────────────────────────

test('can add multiple weapons from compendium', async ({ page }) => {
  const count = await page.evaluate(async ({ WEAPONS_PACK, LONGSWORD_ID, DAGGER_ID }) => {
    const actor = await Actor.create({ name: 'Multi-Weapon Test', type: 'character' });
    const pack  = game.packs.get(WEAPONS_PACK);

    const [ls, dg] = await Promise.all([
      pack.getDocument(LONGSWORD_ID),
      pack.getDocument(DAGGER_ID),
    ]);

    await actor.createEmbeddedDocuments('Item', [ls.toObject(), dg.toObject()]);
    return game.actors.get(actor.id).items.filter(i => i.type === 'weapon').length;
  }, { WEAPONS_PACK, LONGSWORD_ID, DAGGER_ID });

  expect(count).toBe(2);
});
