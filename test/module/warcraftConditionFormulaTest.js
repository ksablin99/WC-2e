import { ActorChangesHelper } from "../../module/actor/helpers/actorChangesHelper.js";

describe("Warcraft condition formula targets", () => {
  it("maps the melee-only damage target independently of all weapon damage", () => {
    const rollData = { attributes: { damage: { general: 0, melee: 0, weapon: 0, spell: 0 } } };
    expect(ActorChangesHelper.getChangeFlat("mdamage", "penalty", rollData))
      .toBe("system.attributes.damage.melee");
    expect(ActorChangesHelper.getChangeFlat("wdamage", "penalty", rollData))
      .toBe("system.attributes.damage.weapon");
  });
});
