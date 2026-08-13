'use strict';

/** @type {string} */
const FEATS_PACK = 'warcraftrpg2e.feats';
/** Compendium feat used as an embedded-item template (valid `type: feat` system shape). */
const FEAT_TEMPLATE_ID = 'yhG9H9S51ysYIlvC';

async function openSkillsTab(page, sheetId) {
  await page.evaluate((id) => {
    document
      .querySelector(`#${id} nav.sheet-navigation.tabs a[data-tab="skills"]`)
      ?.click();
  }, sheetId);
  await page
    .locator(`#${sheetId} .tab.skills`)
    .waitFor({ state: 'visible', timeout: 5_000 });
}

async function clickSkillRollOnSheet(page, sheetId, skillKey) {
  await page.evaluate(
    ({ id, sk }) => {
      document
        .querySelector(
          `#${id} li.skill[data-skill="${sk}"] .skill-mod-total.rollable.skill-roll`,
        )
        ?.click();
    },
    { id: sheetId, sk: skillKey },
  );
}

async function waitForChatAfter(page, prevSize) {
  await page.waitForFunction((c) => game.messages.size > c, prevSize, {
    timeout: 5_000,
  });
}

async function getLastChatSkillTotal(page) {
  return page.evaluate(() => {
    const msg = game.messages.contents.at(-1);
    return msg?.flags?.warcraftrpg2e?.chatTemplateData?.total ?? null;
  });
}

/** Close the topmost skill-style dialog. Scope to `.dialog` so we never hit the sheet close. */
async function closeTopWindowDialog(page) {
  const dlg = page.locator('.window-app.dialog').last();
  const closer = dlg.locator('.header-button.close');
  if (await closer.count()) await closer.click({ force: true });
  await dlg.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
}

/** Stylized D35E checkbox: native input is off-screen. Uses the top dialog. */
async function setStylizedOptionalChecked(page, checked) {
  await page.evaluate((wantChecked) => {
    const dialogs = [...document.querySelectorAll('.window-app.dialog')];
    const dlg = dialogs[dialogs.length - 1];
    const cb = dlg?.querySelector('input[data-type="optional"]');
    if (!cb) return;
    cb.checked = wantChecked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  }, checked);
}

/**
 * Embed a synthetic feat whose only mechanical effect is `system.combatChanges`.
 * @param {import('@playwright/test').Page} page
 * @param {object} opts
 * @param {string} opts.actorId
 * @param {string} opts.name
 * @param {unknown[][]} opts.combatChanges
 */
async function embedSyntheticCombatFeat(page, { actorId, name, combatChanges }) {
  await page.evaluate(
    async ({ packId, templateId, id, featName, changes }) => {
      const actor = game.actors.get(id);
      const pack = game.packs.get(packId);
      const doc = await pack.getDocument(templateId);
      const o = doc.toObject();
      delete o._id;
      o.name = featName;
      o.system = foundry.utils.duplicate(o.system);
      o.system.combatChanges = changes;
      o.system.changes = [];
      await actor.createEmbeddedDocuments('Item', [o]);
      await actor.update({});
    },
    {
      packId: FEATS_PACK,
      templateId: FEAT_TEMPLATE_ID,
      id: actorId,
      featName: name,
      changes: combatChanges,
    },
  );
}

module.exports = {
  FEATS_PACK,
  FEAT_TEMPLATE_ID,
  openSkillsTab,
  clickSkillRollOnSheet,
  waitForChatAfter,
  getLastChatSkillTotal,
  closeTopWindowDialog,
  setStylizedOptionalChecked,
  embedSyntheticCombatFeat,
};
