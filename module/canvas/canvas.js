/**
 * Measure the distance between two pixel coordinates
 * See BaseGrid.measureDistance for more details
 */
export const measureDistances = function (segments, options = {}) {
  if (!options.gridSpaces) return BaseGrid.prototype.measureDistances.call(this, segments, options);

  // Track the total number of diagonals
  let nDiagonal = 0;
  const rule = this.parent.diagonalRule;
  const d = canvas.dimensions;

  // Iterate over measured segments
  return segments.map((s) => {
    let r = s.ray;

    // Determine the total distance traveled
    let nx = Math.abs(Math.ceil(r.dx / d.size));
    let ny = Math.abs(Math.ceil(r.dy / d.size));

    // Determine the number of straight and diagonal moves
    let nd = Math.min(nx, ny);
    let ns = Math.abs(ny - nx);
    nDiagonal += nd;

    // Alternative DMG Movement
    if (rule === "5105") {
      let nd10 = Math.floor(nDiagonal / 2) - Math.floor((nDiagonal - nd) / 2);
      let spaces = nd10 * 2 + (nd - nd10) + ns;
      return spaces * canvas.dimensions.distance;
    }

    // Standard PHB Movement
    else return (ns + nd) * canvas.scene.grid.distance;
  });
};

export const measureDistance = function (
  p0,
  p1,
  { ray = null, diagonalRule = "5105", state = { diagonals: 0, cells: 0 } } = {}
) {
  // TODO: Optionally adjust start and end point to closest grid
  ray ??= new foundry.canvas.geometry.Ray(p0, p1);
  const gs = canvas.dimensions.size,
    nx = Math.ceil(Math.abs(ray.dx / gs)),
    ny = Math.ceil(Math.abs(ray.dy / gs));

  // Get the number of straight and diagonal moves
  const nDiagonal = Math.min(nx, ny),
    nStraight = Math.abs(ny - nx);

  state.diagonals += nDiagonal;

  let cells = 0;
  // Standard Pathfinder diagonals: double distance for every odd.
  if (diagonalRule === "5105") {
    const nd10 = Math.floor(state.diagonals / 2) - Math.floor((state.diagonals - nDiagonal) / 2);
    cells = nd10 * 2 + (nDiagonal - nd10) + nStraight;
  }
  // Equal distance diagonals
  else cells = nStraight + nDiagonal;

  state.cells += cells;
  return cells * canvas.dimensions.distance;
};

/* -------------------------------------------- */

/**
 * Hijack Token health bar rendering to include temporary and temp-max health in the bar display
 * TODO: This should probably be replaced with a formal Token class extension
 */
const _TokenGetBarAttribute = foundry.canvas.placeables.Token.prototype.getBarAttribute;
foundry.canvas.placeables.Token.prototype.getBarAttribute = function (barName, { alternative = null } = {}) {
  let data;
  try {
    data = _TokenGetBarAttribute.call(this, barName, { alternative: alternative });
  } catch (e) {
    data = null;
  }
  if (data != null && data.attribute === "attributes.hp") {
    data.value += parseInt(data["temp"] || 0);
  }
  return data;
};

/**
 * Condition/ status effects section
 */
export const getConditions = function () {
  var core = [...CONFIG.statusEffects],
    sys = Object.keys(CONFIG.D35E.conditions)
      .filter((c) => c !== "wildshaped" && c !== "polymorphed")
      .map((c) => {
        return { id: c, name: CONFIG.D35E.conditions[c], img: CONFIG.D35E.conditionTextures[c] };
      });
  if (game.settings.get("warcraftrpg2e", "coreEffects")) sys.push(...core);
  else sys = [core[0]].concat(sys);
  const seen = new Set();
  return sys.filter((effect) => {
    if (seen.has(effect.id)) return false;
    seen.add(effect.id);
    return true;
  });
};

const _TokenHUD_getStatusEffectChoices = foundry.applications.hud.TokenHUD.prototype._getStatusEffectChoices;
foundry.applications.hud.TokenHUD.prototype._getStatusEffectChoices = function () {
  let core = _TokenHUD_getStatusEffectChoices.call(this);
  const actor = this.object?.actor;
  if (!actor?.buffs) return core;
  const buffTextures = actor.buffs.calcBuffTextures();
  const buffs = {};
  for (const buff of Object.values(buffTextures)) {
    if (!buff.icon) continue;
    const choiceId = `d35e-buff-${buff.id}`;
    buffs[choiceId] = {
      id: choiceId,
      title: buff.label,
      src: buff.icon,
      isActive: buff.active,
      isOverlay: false,
      cssClass: buff.active ? "active" : "",
    };
  }
  return Object.assign({}, core, buffs);
};

// Patch toggleStatusEffect to handle D35E buff IDs (d35e-buff-{itemId})
const _ActorToggleStatusEffect = Actor.prototype.toggleStatusEffect;
Actor.prototype.toggleStatusEffect = async function (statusId, options = {}) {
  if (statusId?.startsWith("d35e-buff-")) {
    const itemId = statusId.slice("d35e-buff-".length);
    const item = this.items.get(itemId);
    if (item) await item.update({ "system.active": !item.system.active });
    return;
  }
  return _ActorToggleStatusEffect.call(this, statusId, options);
};
