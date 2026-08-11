export class TokenQuickActions {

  static async addTop3Attacks(app, html, data) {

    let actorId = data.actorId,
      actor = game.actors.get(actorId);
    if (data._id && canvas.tokens?.get(data._id)?.actor != null) {
      actorId = data._id;
      actor = canvas.tokens.get(actorId).actor;
    }

    if (actor == null)
        return;

    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;
    
    let quickActions = '<div class="col actions"><div class="below">'
    let ammoCounter = '<div class="col actions"><div class="below" style="bottom: -60px">'
    let items = actor.items.filter(o => (o.type === "attack" || o.type === "spell" || o.type === "full-attack" || o.type === "feat") && o.system.showInQuickbar === true).sort((a, b) => {
      return a.sort - b.sort;
    });
    items.forEach(function(item) {
      const icon = item.img;
      let title = "";
      if      (item.type === "attack") title = game.i18n.localize("D35E.AttackWith").format(item.name);
      else if (item.type === "spell")  title = game.i18n.localize("D35E.AttackWithSpell").format(item.name);
      else if (item.type === "feat")   title = game.i18n.localize("D35E.AttackWithFeat").format(item.name);
      const type = item.type;
      quickActions += `<div id="${type}-${item.id}" class="control-icon token-quick-action"><img src="${icon}" width="36" height="36" title="${title}"></div>`;
    });
    let ammo = actor.items.filter(o => o.type === "loot" && o.system.showInQuickbar === true).sort((a, b) => {
      return a.sort - b.sort;
    });

    ammo.forEach(function(item) {
      const icon = item.img;
      let title = "";
      title = `${item.name} (${item.system.quantity})`;
      const type = item.type;
      ammoCounter += `<div id="${type}-${item.id}" class="control-icon"  title="${title}"><img style="position: absolute" src="${icon}" width="36" height="36"><span style="position: relative" >${item.system.quantity}</span></div>`;
    });

    const middleCol = root.querySelector('.col.middle');
    if (middleCol) {
      middleCol.insertAdjacentHTML('afterend', quickActions + '</div></div>');
      middleCol.insertAdjacentHTML('afterend', ammoCounter + '</div></div>');
    }
    
    items.forEach(function(item) {
      const type = item.type;
      root.querySelector(`#${type}-${item.id}`)?.addEventListener("click", function(event) {
        game.D35E.rollItemMacro(item.name, {
          itemId: item.id,
          itemType: type,
          actorId: actorId
        });
      });
    });
  }
  static async addTop3Buffs(app, html, data) {

    let actorId = data.actorId,
        actor = game.actors.get(actorId);
    if (data._id && canvas.tokens?.get(data._id)?.actor != null) {
      actorId = data._id;
      actor = canvas.tokens.get(actorId).actor;
    }

    if (actor == null)
      return;

    const root = html?.nodeType === 1 ? html : html?.[0] ?? html;

    let quickActions = '<div class="col actions"><div class="above">'
    let items = actor.items.filter(o => o.type === "buff" && o.system.active === true).sort((a, b) => {
      return a.sort - b.sort;
    });
    items.forEach(function(item) {
      const icon = item.img;
      let title = item.name;
      const type = item.type;
      quickActions += `<div id="${type}-${item.id}" class="control-icon token-quick-action"><img src="${icon}" width="36" height="36" title="${title}"></div>`;
    });

    const middleCol = root.querySelector('.col.middle');
    if (middleCol) {
      middleCol.insertAdjacentHTML('afterend', quickActions + '</div></div>');
    }

    items.forEach(function(item) {
      const type = item.type;
      root.querySelector(`#${type}-${item.id}`)?.addEventListener("click", function(event) {
        game.D35E.rollItemMacro(item.name, {
          itemId: item.id,
          itemType: type,
          actorId: actorId
        });
      });
    });
  }
}
