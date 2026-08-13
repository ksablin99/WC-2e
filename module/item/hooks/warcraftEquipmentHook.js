import { Roll35e } from "../../roll.js";
import {
  adjustedReloadAction,
  compatibleAmmunition,
  compatibleGunpowder,
  compatibleGunpowders,
  explosiveRangeData,
  explosiveScatter,
  explosivePrimeDc,
  firearmState,
  gunpowderModifiers,
  gunpowderOuncesFromName,
  isWarcraftExplosive,
  isWarcraftFirearm,
  packageCountFromName,
  sourceWeaponForAttack,
  unpackSupplyUpdate,
  warcraftEquipmentRules,
} from "../helpers/warcraftEquipment.js";
import { checkMalfunction, technologyUsePenalty } from "../helpers/warcraftTechnology.js";
import { setSystemFlag } from "../../utils/system-flags.js";

function rootElement(html) {
  return html?.nodeType === 1 ? html : html?.[0] ?? html;
}

function escape(value) {
  return foundry.utils.escapeHTML?.(String(value ?? "")) ?? String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function skillTotal(actor, key) {
  const skill = actor?.system?.skills?.[key] ?? {};
  return Number(skill.mod ?? skill.total ?? skill.value ?? skill.rank ?? 0) || 0;
}

async function markCombatAction(actor, action) {
  const combatant = game.combat?.combatants?.find?.((entry) => entry.actor?.id === actor?.id);
  if (!combatant || game.combat?.combatant?.id !== combatant.id) return;
  if (/full-round/i.test(action)) return combatant.useFullAttackAction?.();
  if (/standard/i.test(action)) return combatant.useAction?.({ type: "standard" });
  if (/move/i.test(action)) return setSystemFlag(combatant, "usedMoveAction", true);
}

function rangedAttackTotal(actor) {
  const system = actor?.system ?? {};
  const size = CONFIG.D35E.sizeMods?.[system.traits?.actualSize] ?? 0;
  return (Number(system.attributes?.bab?.total) || 0)
    + (Number(system.abilities?.dex?.mod) || 0)
    + Number(size)
    - (Number(system.attributes?.energyDrain) || 0)
    + (Number(system.attributes?.attack?.general) || 0)
    + (Number(system.attributes?.attack?.ranged) || 0);
}

async function reloadFirearm(weapon, powderId = null) {
  const actor = weapon?.actor;
  if (!actor) return ui.notifications.warn(game.i18n.localize("D35E.ErrorItemNoOwner"));
  const rules = warcraftEquipmentRules(weapon);
  const state = firearmState(weapon);
  if (state.jammed) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftFirearmClearFirst"));
  if (state.loaded >= state.capacity) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftFirearmAlreadyLoaded"));
  const ammo = compatibleAmmunition(actor, weapon);
  if (!ammo) return ui.notifications.warn(game.i18n.format("D35E.WarcraftFirearmMissingAmmo", { ammunition: rules.ammunition }));
  const powder = powderId ? actor.items.get(powderId) : compatibleGunpowder(actor);
  if (!powder) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftFirearmMissingGunpowder"));
  const shotsToLoad = Math.max(1, state.capacity - state.loaded);
  const ammoUpdate = unpackSupplyUpdate(ammo, shotsToLoad, packageCountFromName(rules.ammunition));
  const powderCost = (Number(rules.gunpowderPerShotOunces) || 1) * shotsToLoad;
  const powderUpdate = unpackSupplyUpdate(powder, powderCost, gunpowderOuncesFromName(powder.name));
  if (!ammoUpdate.valid) return ui.notifications.warn(game.i18n.format("D35E.WarcraftFirearmMissingAmmo", { ammunition: rules.ammunition }));
  if (!powderUpdate.valid) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftFirearmMissingGunpowder"));
  await ammo.update(ammoUpdate.update);
  await powder.update(powderUpdate.update);
  await weapon.update({
    "flags.warcraftrpg2e.equipment.loaded": state.capacity,
    "flags.warcraftrpg2e.equipment.loadedGunpowder": powder.name,
    "flags.warcraftrpg2e.equipment.loadedGunpowderModifiers": gunpowderModifiers(powder.name),
  });
  await markCombatAction(actor, adjustedReloadAction(rules, actor.items));
  ui.notifications.info(game.i18n.format("D35E.WarcraftFirearmReloaded", {
    weapon: weapon.name,
    action: adjustedReloadAction(rules, actor.items),
    powder: powder.name,
  }));
  weapon.sheet?.render(false);
}

async function clearFirearmMalfunction(weapon) {
  await weapon.update({
    "flags.warcraftrpg2e.equipment.jammed": false,
    "flags.warcraftrpg2e.equipment.lastMalfunction": "",
  });
  await markCombatAction(weapon.actor, "full-round action");
  ui.notifications.info(game.i18n.format("D35E.WarcraftFirearmCleared", { weapon: weapon.name }));
  weapon.sheet?.render(false);
}

async function useAreaFirearm(weapon) {
  const actor = weapon.actor;
  const rules = warcraftEquipmentRules(weapon);
  const state = firearmState(weapon);
  const powder = weapon.flags?.warcraftrpg2e?.equipment?.loadedGunpowderModifiers ?? {};
  const useRoll = await new Roll35e("1d20").roll();
  const natural = Number(useRoll.terms?.[0]?.results?.[0]?.result ?? useRoll.total);
  const rating = Math.min(5, Number(rules.malfunctionRating || 0) + Number(powder.malfunction || 0));
  const malfunction = checkMalfunction({ naturalRoll: natural, malfunctionRating: rating });
  const update = {
    "flags.warcraftrpg2e.equipment.loaded": Math.max(0, state.loaded - 1),
    "flags.warcraftrpg2e.equipment.loadedGunpowder": "",
    "flags.warcraftrpg2e.equipment.loadedGunpowderModifiers": null,
  };
  if (malfunction.malfunctioned) {
    update["flags.warcraftrpg2e.equipment.jammed"] = true;
    update["flags.warcraftrpg2e.equipment.lastMalfunction"] = `Natural ${natural} (MR ${rating})`;
  }
  await weapon.update(update);
  await markCombatAction(actor, "standard action");
  const baseFormula = String(rules.damage ?? "3d6").match(/\d+d\d+/)?.[0] ?? "3d6";
  const damage = malfunction.malfunctioned ? null : await new Roll35e(`${baseFormula} + @powderDamage`, { powderDamage: Number(powder.damage) || 0 }).roll();
  const details = malfunction.malfunctioned
    ? game.i18n.format("D35E.WarcraftFirearmMalfunctionResult", { roll: natural, rating })
    : game.i18n.format("D35E.WarcraftAreaFirearmResult", { area: rules.area, save: rules.save, damage: damage.total });
  await ChatMessage.create({
    // Marker kept local to the card; scene placement and applying blast damage
    // remain deliberate GM actions after the scatter location is known.
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="D35E chat-card warcraft-firearm-card"><h3>${escape(weapon.name)}</h3><p>${escape(details)}</p></div>`,
    rolls: damage ? [useRoll, damage] : [useRoll],
  });
  weapon.sheet?.render(false);
}

function targetDistance(actor, target) {
  const token = actor?.getActiveTokens?.()[0];
  if (!token || !target || !canvas?.grid) return null;
  if (typeof canvas.grid.measurePath === "function") return Number(canvas.grid.measurePath([token.center, target.center])?.distance);
  if (typeof canvas.grid.measureDistance === "function") return Number(canvas.grid.measureDistance(token.center, target.center));
  return null;
}

function injectFirearmControls(app, html) {
  const weapon = app?.item ?? app?.object;
  if (!isWarcraftFirearm(weapon) || !weapon.actor) return;
  const root = rootElement(html);
  if (!root?.querySelector || root.querySelector(".warcraft-firearm-controls")) return;
  const state = firearmState(weapon);
  const rules = warcraftEquipmentRules(weapon);
  const powders = compatibleGunpowders(weapon.actor);
  const powderOptions = powders.map((powder) => `<option value="${powder.id}">${escape(powder.name)} (${powder.system.quantity})</option>`).join("");
  const section = document.createElement("section");
  section.className = "warcraft-firearm-controls flexrow";
  section.innerHTML = `<strong>${game.i18n.localize("D35E.WarcraftFirearm")}</strong><span class="warcraft-firearm-state">${state.jammed ? game.i18n.localize("D35E.WarcraftFirearmJammed") : `${game.i18n.localize("D35E.WarcraftFirearmLoaded")} ${state.loaded}/${state.capacity}`}</span><span>${escape(adjustedReloadAction(rules, weapon.actor.items))}${rules.reloadProvokes ? `; ${game.i18n.localize("D35E.WarcraftProvokes")}` : ""}</span><select data-warcraft-powder aria-label="${game.i18n.localize("D35E.WarcraftGunpowder")}">${powderOptions}</select><button type="button" data-warcraft-firearm-action="reload"><i class="fas fa-rotate"></i> ${game.i18n.localize("D35E.WarcraftReload")}</button><button type="button" data-warcraft-firearm-action="clear" ${state.jammed ? "" : "disabled"}><i class="fas fa-screwdriver-wrench"></i> ${game.i18n.localize("D35E.WarcraftClearJam")}</button>`;
  const content = root.querySelector(".sheet-content") ?? root.querySelector("form") ?? root;
  content.prepend(section);
  section.querySelector('[data-warcraft-firearm-action="reload"]')?.addEventListener("click", (event) => {
    event.preventDefault();
    void reloadFirearm(weapon, section.querySelector("[data-warcraft-powder]")?.value);
  });
  section.querySelector('[data-warcraft-firearm-action="clear"]')?.addEventListener("click", (event) => {
    event.preventDefault();
    void clearFirearmMalfunction(weapon);
  });
}

async function useExplosive(item, delayRounds, deployment = "thrown", malfunctionEffect = "dud") {
  const actor = item.actor;
  if (!actor) return ui.notifications.warn(game.i18n.localize("D35E.ErrorItemNoOwner"));
  if (Number(item.system.quantity || 0) < 1) return ui.notifications.warn(game.i18n.localize("D35E.WarcraftExplosiveNoneRemaining"));
  const rules = warcraftEquipmentRules(item);
  const skill = actor.system.skills?.utd ?? {};
  const trained = Number(skill.rank ?? skill.points ?? 0) > 0;
  const penalty = technologyUsePenalty({ trained, proficient: true });
  const checkRoll = await new Roll35e("1d20 + @bonus + @penalty", { bonus: skillTotal(actor, "utd"), penalty }).roll();
  const dc = explosivePrimeDc(delayRounds);
  const success = checkRoll.total >= dc;
  const malfunction = checkMalfunction({ naturalRoll: Number(checkRoll.terms?.[0]?.results?.[0]?.result), malfunctionRating: rules.malfunctionRating });
  if (Number(delayRounds) > 0) deployment = "placed";
  const target = Array.from(game.user.targets ?? [])[0] ?? null;
  const distance = deployment === "thrown" ? targetDistance(actor, target) : null;
  const range = explosiveRangeData({ distanceFeet: distance ?? rules.rangeIncrement, rangeIncrement: rules.rangeIncrement });
  if (deployment === "thrown" && Number.isFinite(distance) && range.increments > range.maximumIncrements) {
    return ui.notifications.warn(game.i18n.format("D35E.WarcraftExplosiveMaximumRange", {
      range: Number(rules.rangeIncrement || 10) * range.maximumIncrements,
    }));
  }
  let attackRoll = null;
  let hit = null;
  let scatterRoll = null;
  let scatter = null;
  if (success && !malfunction.malfunctioned && deployment === "thrown") {
    attackRoll = await new Roll35e("1d20 + @ranged + @rangePenalty", {
      ranged: rangedAttackTotal(actor),
      rangePenalty: range.penalty,
    }).roll();
    const targetAc = Number(target?.actor?.system?.attributes?.ac?.touch?.total ?? 5);
    hit = attackRoll.total >= targetAc;
    if (!hit) {
      scatterRoll = await new Roll35e("1d8").roll();
      scatter = explosiveScatter({
        distanceFeet: distance ?? rules.rangeIncrement,
        rangeIncrement: rules.rangeIncrement,
        directionRoll: scatterRoll.total,
      });
    }
  }
  const premature = malfunction.malfunctioned && malfunctionEffect === "premature";
  const damageRoll = (success && !malfunction.malfunctioned) || premature
    ? await new Roll35e(String(rules.damage).split(/\s+/)[0]).roll()
    : null;
  if (success || malfunction.malfunctioned) await actor.quickChangeItemQuantity(item.id, -1);
  await markCombatAction(actor, Number(delayRounds) > 0 ? "standard action" : "move action");
  if (success && deployment === "thrown") await markCombatAction(actor, "standard action");
  const outcome = malfunction.malfunctioned
    ? game.i18n.localize(premature ? "D35E.WarcraftExplosivePremature" : "D35E.WarcraftExplosiveDud")
    : success
      ? game.i18n.localize("D35E.WarcraftExplosivePrimed")
      : game.i18n.localize("D35E.WarcraftExplosiveFailed");
  const delay = Math.max(0, Number(delayRounds) || 0);
  const targetAc = Number(target?.actor?.system?.attributes?.ac?.touch?.total ?? 5);
  const attackDetail = attackRoll
    ? `<p><strong>${escape(game.i18n.localize("D35E.AttackRoll"))}:</strong> ${attackRoll.total} vs. ${escape(target?.name ?? game.i18n.localize("D35E.WarcraftGridIntersection"))} ${escape(game.i18n.localize("D35E.TouchAC"))} ${targetAc}; ${escape(hit ? game.i18n.localize("D35E.Hit") : game.i18n.localize("D35E.Miss"))}.</p>`
    : "";
  const scatterDetail = scatter
    ? `<p><strong>${escape(game.i18n.localize("D35E.WarcraftExplosiveScatter"))}:</strong> ${scatter.squares} ${escape(game.i18n.localize("D35E.Squares"))}, ${escape(scatter.directionLabel)} (${escape(game.i18n.localize("D35E.WarcraftDirectionRoll"))} ${scatter.direction}).</p>`
    : "";
  const deploymentDetail = `<p>${escape(deployment === "thrown" ? game.i18n.localize("D35E.WarcraftExplosiveTemplateHint") : game.i18n.localize("D35E.WarcraftExplosivePlacedHint"))}</p>`;
  const cardContent = `<div class="D35E chat-card warcraft-explosive-card"><h3>${escape(item.name)}</h3><p><strong>${outcome}</strong> (${game.i18n.localize("D35E.DC")} ${dc}; ${game.i18n.localize("D35E.WarcraftNaturalRoll")} ${checkRoll.terms?.[0]?.results?.[0]?.result ?? "?"})</p>${attackDetail}${scatterDetail}${damageRoll ? `<p><strong>${game.i18n.localize("D35E.Damage")}:</strong> ${damageRoll.total} ${escape(String(rules.damage).split(/\s+/).slice(1).join(" "))}; <strong>${game.i18n.localize("D35E.WarcraftBlastRadius")}:</strong> ${rules.blastRadius} ft.; <strong>${game.i18n.localize("D35E.Range")}:</strong> ${rules.rangeIncrement ?? "-"} ft.</p>` : ""}<p>${delay ? game.i18n.format("D35E.WarcraftExplosiveDelay", { rounds: delay }) : game.i18n.localize("D35E.WarcraftExplosiveImpact")}</p>${deploymentDetail}</div>`;
  const messageData = {
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content: cardContent,
    rolls: [checkRoll, attackRoll, scatterRoll, damageRoll].filter(Boolean),
  };
  await ChatMessage.create(messageData);
}

function openExplosiveDialog(item) {
  return new Dialog({
    title: `${game.i18n.localize("D35E.WarcraftPrimeExplosive")} — ${item.name}`,
    content: `<form><div class="form-group"><label>${game.i18n.localize("D35E.WarcraftExplosiveDelayRounds")}</label><input type="number" name="delay" value="0" min="0" max="20"/></div><div class="form-group"><label>${game.i18n.localize("D35E.WarcraftExplosiveDeployment")}</label><select name="deployment"><option value="thrown">${game.i18n.localize("D35E.WarcraftExplosiveThrown")}</option><option value="placed">${game.i18n.localize("D35E.WarcraftExplosivePlaced")}</option></select></div><div class="form-group"><label>${game.i18n.localize("D35E.WarcraftExplosiveMalfunctionChoice")}</label><select name="malfunction"><option value="dud">${game.i18n.localize("D35E.WarcraftExplosiveDud")}</option><option value="premature">${game.i18n.localize("D35E.WarcraftExplosivePremature")}</option></select></div><p class="notes">${game.i18n.localize("D35E.WarcraftExplosiveActionHint")}</p></form>`,
    buttons: {
      use: {
        label: game.i18n.localize("D35E.WarcraftPrimeAndUse"),
        callback: (html) => {
          const root = rootElement(html);
          void useExplosive(
            item,
            root.querySelector?.('[name="delay"]')?.value ?? 0,
            root.querySelector?.('[name="deployment"]')?.value ?? "thrown",
            root.querySelector?.('[name="malfunction"]')?.value ?? "dud",
          );
        },
      },
      cancel: { label: game.i18n.localize("D35E.Cancel") },
    },
    default: "use",
  }).render(true);
}

function injectExplosiveControls(app, html) {
  const item = app?.item ?? app?.object;
  if (!isWarcraftExplosive(item) || !item.actor) return;
  const root = rootElement(html);
  if (!root?.querySelector || root.querySelector('[data-warcraft-explosive-action="prime"]')) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.warcraftExplosiveAction = "prime";
  button.innerHTML = `<i class="fas fa-bomb"></i> ${game.i18n.localize("D35E.WarcraftPrimeExplosive")}`;
  button.addEventListener("click", (event) => { event.preventDefault(); openExplosiveDialog(item); });
  (root.querySelector(".sheet-content") ?? root.querySelector("form") ?? root).prepend(button);
}

export class WarcraftEquipmentHook {
  static register() {
    Hooks.on("renderItemSheet", (app, html) => {
      injectFirearmControls(app, html);
      injectExplosiveControls(app, html);
    });
    Hooks.on("D35E.ItemUse.preUseItem", (item, actor, hookValues) => {
      const weapon = sourceWeaponForAttack(item, actor);
      if (!isWarcraftFirearm(weapon)) return;
      const state = firearmState(weapon);
      if (state.jammed) {
        hookValues.customUse = true;
        ui.notifications.warn(game.i18n.localize("D35E.WarcraftFirearmJammed"));
      } else if (state.loaded < 1) {
        hookValues.customUse = true;
        ui.notifications.warn(game.i18n.localize("D35E.WarcraftFirearmUnloaded"));
      } else if (warcraftEquipmentRules(weapon).area) {
        hookValues.customUse = true;
        void useAreaFirearm(weapon);
      } else if (warcraftEquipmentRules(weapon).minimumRangeIncrements) {
        const minimum = Number(weapon.system.weaponData?.range || 0) * Number(warcraftEquipmentRules(weapon).minimumRangeIncrements);
        const tooClose = Array.from(game.user.targets ?? []).some((target) => {
          const distance = targetDistance(actor, target);
          return Number.isFinite(distance) && distance < minimum;
        });
        if (tooClose) {
          hookValues.customUse = true;
          ui.notifications.warn(game.i18n.format("D35E.WarcraftFirearmMinimumRange", { range: minimum }));
        }
      }
    });
    Hooks.on("D35E.ItemUse.preRollAllAttacks", (item, _rollData, allAttacks) => {
      const weapon = sourceWeaponForAttack(item, item.actor);
      if (!isWarcraftFirearm(weapon)) return;
      allAttacks.splice(firearmState(weapon).loaded);
    });
  }
}
