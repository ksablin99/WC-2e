'use strict';

/**
 * Shared roll helpers for e2e tests.
 * Complements helpers/actor-sheet.js and helpers/skill-roll.js.
 *
 * Key difference from skill-roll helpers: these helpers cover saving throws
 * (dialog-always path), buff toggles, item use, and generic chat-wait patterns.
 */

const { dismissOverlays } = require('../helpers');

/**
 * Roll a saving throw via the dialog.
 * `rollSavingThrow` always opens a Dialog (no skipDialog path). This helper
 * fires the roll without awaiting it, waits for a saving-throw Dialog to appear
 * in Foundry's `ui.windows` registry, then submits it via the Foundry API
 * (rather than clicking the DOM button) which is more reliable in headless
 * environments where timing of DOM updates can race.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} actorId
 * @param {'fort'|'ref'|'will'} saveType
 * @returns {Promise<object|null>} flags.warcraftrpg2e.chatTemplateData from the new message
 */
async function rollSavingThrowViaDialog(page, actorId, saveType) {
  await dismissOverlays(page);

  const msgsBefore = await page.evaluate(() => game.messages.size);

  // Record which Dialog appIds already exist so we wait for a NEW one.
  const existingAppIds = await page.evaluate(() =>
    Object.values(ui.windows)
      .filter((w) => w.data?.buttons?.normal)
      .map((w) => w.appId),
  );

  // Fire the roll — do NOT await; rollSavingThrow opens a Dialog and resolves
  // only after it closes.
  page.evaluate(
    ({ actorId, saveType }) => {
      const actor = game.actors.get(actorId);
      actor.rollSavingThrow(saveType, null, null, {}).catch(() => {});
    },
    { actorId, saveType },
  ).catch((err) => console.error('[rollSavingThrowViaDialog] evaluate failed:', err));

  // Wait for a NEW Dialog to appear AND its element to be rendered.
  // Checking ui.windows alone fires when the dialog is registered, which can
  // be before dialog.element is populated.  submit() internally uses the form
  // element, so calling it before the element is ready silently fails.
  await page.waitForFunction(
    (ids) => {
      const dlg = Object.values(ui.windows).find(
        (w) => w.data?.buttons?.normal && !ids.includes(w.appId),
      );
      if (!dlg) return false;
      const root = dlg.element;
      const el = root instanceof HTMLElement ? root : root?.[0];
      return !!el;
    },
    existingAppIds,
    { timeout: 5_000 },
  );

  // Submit the dialog via the Foundry API — equivalent to clicking "Roll".
  // ui.windows holds AppV1 apps (Dialog extends AppV1); submit() calls the
  // button callback with the form element then closes the dialog.
  await page.evaluate((ids) => {
    const candidates = Object.values(ui.windows).filter(
      (w) => w.data?.buttons?.normal && !ids.includes(w.appId),
    );
    const dialog = candidates.length
      ? candidates.reduce((a, b) => (Number(a.appId) > Number(b.appId) ? a : b))
      : null;
    if (dialog) dialog.submit(dialog.data.buttons.normal);
  }, existingAppIds);

  // Wait for chat message
  await page.waitForFunction((c) => game.messages.size > c, msgsBefore, {
    timeout: 8_000,
  });

  return page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    return msg?.flags?.warcraftrpg2e?.chatTemplateData ?? null;
  });
}

/**
 * Same as {@link rollSavingThrowViaDialog} but sets the situational save bonus
 * (`st-bonus`) on the dialog before submit. Supports jQuery-wrapped or raw
 * HTMLElement dialog roots (GL#1424 regression).
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} actorId
 * @param {'fort'|'ref'|'will'} saveType
 * @param {string} stBonusText  Value for st-bonus (e.g. "10")
 * @returns {Promise<object|null>}
 */
async function rollSavingThrowViaDialogWithStBonus(page, actorId, saveType, stBonusText) {
  await dismissOverlays(page);
  const msgsBefore = await page.evaluate(() => game.messages.size);
  const existingAppIds = await page.evaluate(() =>
    Object.values(ui.windows)
      .filter((w) => w.data?.buttons?.normal)
      .map((w) => w.appId),
  );

  page
    .evaluate(
      ({ aid, st }) => {
        game.actors.get(aid).rollSavingThrow(st, null, null, {}).catch(() => {});
      },
      { aid: actorId, st: saveType },
    )
    .catch(() => {});

  // Wait until the dialog is registered AND its DOM is rendered with the input
  // field present.  Checking ui.windows alone fires too early — dialog.element
  // may still be null at that point, causing the st-bonus fill to be silently
  // skipped and the roll to proceed without the bonus.
  await page.waitForFunction(
    (ids) => {
      const dlg = Object.values(ui.windows).find(
        (w) => w.data?.buttons?.normal && !ids.includes(w.appId),
      );
      if (!dlg) return false;
      const root = dlg.element;
      const el = root instanceof HTMLElement ? root : root?.[0];
      return !!el?.querySelector?.('[name="st-bonus"]');
    },
    existingAppIds,
    { timeout: 8_000 },
  );

  await page.evaluate(
    ({ ids, bonus }) => {
      const candidates = Object.values(ui.windows).filter(
        (w) => w.data?.buttons?.normal && !ids.includes(w.appId),
      );
      const dialog = candidates.length
        ? candidates.reduce((a, b) => (Number(a.appId) > Number(b.appId) ? a : b))
        : null;
      if (!dialog) throw new Error('Saving throw dialog not found');
      const root = dialog.element;
      if (root && typeof root.find === 'function') {
        const $inp = root.find('[name="st-bonus"]');
        if ($inp.length) {
          $inp.val(String(bonus));
          $inp.trigger('input');
          $inp.trigger('change');
        }
      } else {
        const el = root instanceof HTMLElement ? root : root?.[0];
        const inp = el?.querySelector?.('[name="st-bonus"]');
        if (inp) {
          inp.value = String(bonus);
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      dialog.submit(dialog.data.buttons.normal);
    },
    { ids: existingAppIds, bonus: stBonusText },
  );

  await page.waitForFunction((c) => game.messages.size > c, msgsBefore, {
    timeout: 20_000,
  });

  return page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    return msg?.flags?.warcraftrpg2e?.chatTemplateData ?? null;
  });
}

/**
 * Poll until a new chat message appears; return its chatTemplateData.
 * Use this after triggering an action that should post to chat.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} prevCount Message count BEFORE the action was triggered.
 * @returns {Promise<object|null>} flags.warcraftrpg2e.chatTemplateData
 */
async function waitForChatRoll(page, prevCount) {
  await page.waitForFunction((c) => game.messages.size > c, prevCount, {
    timeout: 8_000,
  });
  return page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    return msg?.flags?.warcraftrpg2e?.chatTemplateData ?? null;
  });
}

/**
 * Toggle a buff (or aura) item's active state via direct item update.
 * Only valid for `type === 'buff'` and `type === 'aura'` items.
 * The actor's derived stats recompute automatically after the update.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} actorId
 * @param {string} buffId
 * @param {boolean} active
 */
async function toggleBuff(page, actorId, buffId, active) {
  await page.evaluate(
    async ({ actorId, buffId, active }) => {
      const actor = game.actors.get(actorId);
      const buff = actor.items.get(buffId);
      await buff.update({ 'system.active': active });
    },
    { actorId, buffId, active },
  );
}

/**
 * Use an item with `{ skipDialog: true }` and wait for a new chat message.
 * Works for attack, consumable, feat, and spell items.
 * For full-attack items (which return undefined from use()), this still polls
 * for a message — useful when the item posts chat via a side effect.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} actorId
 * @param {string} itemId
 * @returns {Promise<{ chatData: object|null, attackCount: number }>}
 */
async function useItemAndWaitForChat(page, actorId, itemId) {
  const msgsBefore = await page.evaluate(() => game.messages.size);

  await page.evaluate(
    async ({ actorId, itemId }) => {
      const actor = game.actors.get(actorId);
      const item = actor.items.get(itemId);
      const result = await item.use({ skipDialog: true });
      if (result?.roll) await result.roll;
    },
    { actorId, itemId },
  );

  await page.waitForFunction((c) => game.messages.size > c, msgsBefore, {
    timeout: 8_000,
  });

  return page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    const chatData = msg?.flags?.warcraftrpg2e?.chatTemplateData ?? null;
    const attacks = chatData?.attacks ?? [];
    return { chatData, attackCount: attacks.length };
  });
}

module.exports = {
  rollSavingThrowViaDialog,
  rollSavingThrowViaDialogWithStBonus,
  waitForChatRoll,
  toggleBuff,
  useItemAndWaitForChat,
};
