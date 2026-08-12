const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));

function loadPack(packName) {
  const directory = path.join(root, "source", packName);
  const index = readJson(`source/${packName}/.index.json`);
  return {
    index,
    documents: index.map((entry) => readJson(`source/${packName}/${entry.file}`)),
  };
}

const meaningful = (value) => Boolean(String(value || "").trim()) && !/^(?:-|—|–|none)$/i.test(String(value).trim());
const number = (value) => Number(String(value || "").match(/[+\-]?\d+/)?.[0] || 0);

function topLevelEntries(value) {
  const entries = [];
  let current = "";
  let depth = 0;
  for (const character of String(value || "")) {
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    if ((character === "," || character === ";") && depth === 0) {
      if (current.trim()) entries.push(current.trim());
      current = "";
    } else current += character;
  }
  if (current.trim()) entries.push(current.trim());
  return entries.filter((entry) => /[+\-]\d+/.test(entry));
}

function printedCore(record) {
  const fields = record.fields;
  const hitDiceText = fields["Hit Dice"];
  const hitDice = hitDiceText.match(/\(([\d,]+)\s*hp\)/i);
  const hdTotal = [...hitDiceText.matchAll(/(\d+)d\d+/gi)].reduce((total, match) => total + Number(match[1]), 0);
  const ac = fields["Armor Class"].match(/^\s*(\d+).*?touch\s+([+\-]?\d+).*?flat-?\s*footed\s+([+\-]?\d+)/i);
  const bab = fields["Base Attack/Grapple"].match(/([+\-]?\d+)\s*\/\s*(?:([+\-]?\d+)|-)/);
  const saves = fields.Saves.match(/Fort\s+([+\-]?\d+).*?Ref\s+([+\-]?\d+).*?Will\s+([+\-]?\d+)/i);
  return {
    hp: Number(hitDice[1].replace(/,/g, "")),
    hd: hdTotal,
    ac: [Number(ac[1]), Number(ac[2]), Number(ac[3])],
    bab: Number(bab[1]),
    grapple: bab[2] == null ? 0 : Number(bab[2]),
    saves: [Number(saves[1]), Number(saves[2]), Number(saves[3])],
    initiative: number(fields.Initiative),
  };
}

describe("complete Warcraft Monster Guide catalogue", () => {
  const catalogue = readJson("scripts/warcraft-content/warcraft-monster-statblocks.json");
  const monsterMagic = readJson("scripts/warcraft-content/warcraft-monster-magic.json");
  const pageMap = readJson("scripts/warcraft-content/warcraft-monster-page-map.json");
  const bestiary = loadPack("warcraft-bestiary");
  const rules = loadPack("warcraft-creature-rules");

  test("covers every reviewed statblock column exactly once", () => {
    const expectedNames = Object.values(pageMap).flat().map((entry) => entry.name).sort();
    expect(catalogue).toHaveLength(152);
    expect(catalogue.map((record) => record.name).sort()).toEqual(expectedNames);
    expect(new Set(catalogue.map((record) => record.name)).size).toBe(catalogue.length);
    expect(catalogue.filter((record) => record.name.startsWith("Unresolved entry"))).toEqual([]);
    expect(bestiary.documents.map((actor) => actor.name).sort()).toEqual(expectedNames);
  });

  test("carries exact printed core numbers into every actor", () => {
    const actors = new Map(bestiary.documents.map((actor) => [actor.name, actor]));
    for (const record of catalogue) {
      const actor = actors.get(record.name);
      const printed = printedCore(record);
      expect(actor.flags.warcraftrpg2e.bestiary.completeStatblock).toBe(true);
      expect(actor.flags.warcraftrpg2e.source).toMatchObject({
        pdfPages: record.pdfPages,
        printedPages: record.printedPages,
      });
      expect(actor.system.attributes.hp).toMatchObject({ value: printed.hp, max: printed.hp });
      expect(actor.system.attributes.hd.total).toBe(printed.hd);
      expect([
        actor.system.attributes.ac.normal.total,
        actor.system.attributes.ac.touch.total,
        actor.system.attributes.ac.flatFooted.total,
      ]).toEqual(printed.ac);
      expect(actor.system.attributes.bab.base).toBe(printed.bab);
      expect(actor.system.attributes.cmb.total).toBe(printed.grapple);
      expect([
        actor.system.attributes.savingThrows.fort.total,
        actor.system.attributes.savingThrows.ref.total,
        actor.system.attributes.savingThrows.will.total,
      ]).toEqual(printed.saves);
      expect(actor.system.attributes.init.total).toBe(printed.initiative);
    }
  });

  test.each([
    {
      name: "Lady Onyxia",
      pools: [[30, 12, "30d12"], [6, 6, "6d6"]],
      hp: 550,
      bab: 33,
      saves: [28, 19, 27],
    },
    {
      name: "Nefarian",
      pools: [[30, 12, "30d12"], [15, 6, "15d6"]],
      hp: 797,
      bab: 37,
      saves: [36, 24, 29],
    },
    {
      name: "General Drakkisath",
      pools: [[9, 8, "9d8"], [3, 8, "3d8"], [12, 10, "12d10"]],
      hp: 976,
      bab: 19,
      saves: [24, 16, 19],
    },
  ])("keeps $name's mixed Hit Dice as separate pools without changing printed totals", ({ name, pools, hp, bab, saves }) => {
    const actor = bestiary.documents.find((entry) => entry.name === name);
    const hdItems = actor._embedded.items.filter(
      (item) => item.type === "class" && item.system.classType === "racial",
    );

    expect(hdItems.map((item) => [
      item.system.levels,
      item.system.hd,
      item.flags.warcraftrpg2e.bestiary.hdPool.expression,
    ])).toEqual(pools);
    expect(hdItems[0].system.changes).toEqual(expect.arrayContaining([
      [String(hp), "misc", "mhp", "replace"],
      [String(bab), "misc", "babattack", "base-replace"],
    ]));
    expect(hdItems.slice(1).every((item) => item.system.changes.length === 0)).toBe(true);

    expect(actor.system.attributes.hd.total).toBe(pools.reduce((total, [levels]) => total + levels, 0));
    expect(actor.system.attributes.hp).toMatchObject({ value: hp, max: hp });
    expect(actor.system.attributes.bab.base).toBe(bab);
    expect([
      actor.system.attributes.savingThrows.fort.total,
      actor.system.attributes.savingThrows.ref.total,
      actor.system.attributes.savingThrows.will.total,
    ]).toEqual(saves);
  });

  test("rejects neighbouring labels, prose, or PDF residue in extracted statblock fields", () => {
    const contamination = /64\.69\.87\.237|\b(?:Hit Dice|Initiative|Speed|Armor Class|Base Attack\/Grapple|Full Attack|Space\/Reach|Special Attacks|Special Qualities|Saves|Abilities|Skills|Feats|Environment|Area|Organization|Challenge Rating|Treasure|Alignment|Advancement|Level Adjustment|Villain Points):/i;
    const initiative = /^[+\-]?\d+(?:\s*\([^)]*\))?$/;
    const abilityLine = /Str\s*(?:\d+|-)(?:\s*\([^)]*\))?\s*,?\s*Agy\s*(?:\d+|-)\s*,?\s*Sta\s*(?:\d+|-)\s*,?\s*Int\s*(?:\d+|-)\s*,?\s*Spt\s*(?:\d+|-)\s*,?\s*Cha\s*(?:\d+|-)/i;
    for (const record of catalogue) {
      expect(Object.values(record.fields).join(" ")).not.toMatch(contamination);
      expect(record.fields.Initiative).toMatch(initiative);
      expect(record.fields.Abilities.replace(/\s+-\s+/g, " - ")).toMatch(abilityLine);
    }
  });

  test("provides usable attacks and linked full attacks whenever printed", () => {
    const records = new Map(catalogue.map((record) => [record.name, record]));
    for (const actor of bestiary.documents) {
      const fields = records.get(actor.name).fields;
      const embedded = actor._embedded.items;
      const itemIds = new Set(embedded.map((item) => item._id));
      if (meaningful(fields.Attack)) expect(embedded.some((item) => item.type === "attack")).toBe(true);
      if (!meaningful(fields["Full Attack"])) continue;

      const fullAttacks = embedded.filter((item) => item.type === "full-attack");
      expect(fullAttacks.length).toBeGreaterThan(0);
      for (const fullAttack of fullAttacks) {
        const links = Object.values(fullAttack.system.attacks).filter((slot) => slot.id);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
          expect(itemIds.has(link.id)).toBe(true);
          expect(link.count).toBeGreaterThan(0);
        }
      }
    }
  });

  test("preserves repeated attacks, mutually exclusive routines, and typed extra damage", () => {
    const actors = new Map(bestiary.documents.map((actor) => [actor.name, actor]));
    const routinesFor = (name) => actors.get(name)._embedded.items
      .filter((item) => item.type === "full-attack")
      .map((item) => Object.values(item.system.attacks).filter((slot) => slot.id).map((slot) => slot.count));

    expect(routinesFor("Dire Ape")).toEqual([[2, 1]]);
    expect(routinesFor("Hydra")).toEqual([[3]]);
    expect(routinesFor("Archaedas")).toEqual([[1], [2], [1]]);
    expect(routinesFor("Mechanostrider")).toEqual([[1, 2], [1]]);
    expect(routinesFor("Nerubian Worker Crypt Fiend")).toEqual([[1, 2], [1, 2], [1], [1]]);

    const carrionBite = actors.get("Carrion Grub")._embedded.items.find((item) => item.type === "attack" && item.name === "Bite");
    expect(carrionBite.system.damage.parts).toEqual([
      ["1d8+6", "Piercing or Bludgeoning", "damage-piercing-bludgeoning"],
      ["2d6", "Acid", "energy-acid"],
    ]);
    const kazzakClaw = actors.get("Lord Kazzak")._embedded.items.find((item) => item.type === "attack" && item.name === "Claw");
    expect(kazzakClaw.system.damage.parts).toContainEqual(["1d6", "Fel", "damage-untyped-energy"]);
    const felOrcGreataxe = actors.get("Fel Orc")._embedded.items.find((item) => item.type === "attack" && item.name === "Greataxe");
    expect(felOrcGreataxe.system.ability).toMatchObject({ critRange: 20, critMult: 3 });
    const koboldPick = actors.get("Kobold")._embedded.items.find((item) => item.type === "attack" && item.name === "Heavy Pick");
    expect(koboldPick.system.ability).toMatchObject({ critRange: 20, critMult: 4 });
    const quilboarAttacks = actors.get("Quilboar")._embedded.items.filter((item) => item.type === "attack").map((item) => item.name);
    expect(quilboarAttacks).toEqual(expect.arrayContaining(["Shortspear", "Quills", "Javelin"]));
    expect(routinesFor("Quilboar")).toEqual([[1], [1], [1]]);
    for (const [actorName, attackName] of [["Carrion Grub", "Spit"], ["Felstalker", "Ray"], ["Fel Ravager", "Ray"]]) {
      const touchAttack = actors.get(actorName)._embedded.items.find((item) => item.type === "attack" && item.name === attackName);
      expect(touchAttack.system).toMatchObject({ actionType: "rsak", ability: { vsTouchAc: true } });
    }
  });

  test("represents every printed skill total as a usable base, specialized, or custom skill", () => {
    const records = new Map(catalogue.map((record) => [record.name, record]));
    for (const actor of bestiary.documents.filter((entry) => entry.name !== "Harvest Golem")) {
      const printedEntries = topLevelEntries(records.get(actor.name).fields.Skills);
      const represented = [];
      for (const skill of Object.values(actor.system.skills || {})) {
        if (skill.notes?.startsWith("Printed total ")) represented.push(skill);
        for (const subSkill of Object.values(skill.subSkills || {})) represented.push(subSkill);
      }
      expect(represented).toHaveLength(printedEntries.length);
      for (const skill of represented) {
        expect(skill.mod).toBe(Number(skill.notes.match(/Printed total ([+\-]?\d+)/)[1]));
      }
    }

    const balnazzar = bestiary.documents.find((actor) => actor.name === "Balnazzar");
    expect(balnazzar.system.skills.kmt.mod).toBe(32);
    expect(balnazzar.system.skills.pmc.mod).toBe(21);
    expect(Object.values(balnazzar.system.skills.crf.subSkills)).toContainEqual(expect.objectContaining({ name: "weaponsmithing", mod: 10 }));
    const kelThuzad = bestiary.documents.find((actor) => actor.name === "Kel'Thuzad");
    expect(Object.values(kelThuzad.system.skills)).toContainEqual(expect.objectContaining({
      custom: true,
      name: "Knowledge (dungeoneering)",
      mod: 51,
    }));
  });

  test("separates listed powers, qualities, and feats into embedded records", () => {
    const records = new Map(catalogue.map((record) => [record.name, record]));
    for (const actor of bestiary.documents.filter((entry) => entry.name !== "Harvest Golem")) {
      const categories = actor._embedded.items
        .map((item) => item.flags?.warcraftrpg2e?.bestiary?.category)
        .filter(Boolean);
      const fields = records.get(actor.name).fields;
      if (meaningful(fields["Special Attacks"])) expect(categories).toContain("Special Attack");
      if (meaningful(fields["Special Qualities"])) expect(categories).toContain("Special Quality");
      if (meaningful(fields.Feats)) expect(categories).toContain("Feat");
      expect(categories).toContain("Creature Type");
    }
  });

  test("links every generated actor to reusable creature type and subtype rules", () => {
    const ruleIds = new Set(rules.documents.map((rule) => rule._id));
    expect(rules.documents.filter((rule) => rule.flags.warcraftrpg2e.creatureRule.kind === "type")).toHaveLength(15);
    expect(rules.documents.filter((rule) => rule.flags.warcraftrpg2e.creatureRule.kind === "subtype")).toHaveLength(28);
    expect(rules.documents.filter((rule) => rule.flags.warcraftrpg2e.creatureRule.kind === "capability")).toHaveLength(5);
    expect(rules.documents.filter((rule) => rule.flags.warcraftrpg2e.creatureRule.kind === "template")).toHaveLength(10);

    for (const actor of bestiary.documents.filter((entry) => entry.name !== "Harvest Golem")) {
      const typeFeature = actor._embedded.items.find(
        (item) => item.flags?.warcraftrpg2e?.bestiary?.category === "Creature Type",
      );
      expect(typeFeature.flags.warcraftrpg2e.reference.pack).toBe("warcraftrpg2e.warcraft-creature-rules");
      expect(ruleIds.has(typeFeature.flags.warcraftrpg2e.reference.id)).toBe(true);
      for (const subtypeFeature of actor._embedded.items.filter(
        (item) => item.flags?.warcraftrpg2e?.bestiary?.category === "Creature Subtype",
      )) {
        expect(subtypeFeature.flags.warcraftrpg2e.reference.pack).toBe("warcraftrpg2e.warcraft-creature-rules");
        expect(ruleIds.has(subtypeFeature.flags.warcraftrpg2e.reference.id)).toBe(true);
      }
    }
  });

  test("turns shared references into clickable rules while labeling manual boundaries", () => {
    let linked = 0;
    let manual = 0;
    for (const actor of bestiary.documents.filter((entry) => entry.name !== "Harvest Golem")) {
      for (const item of actor._embedded.items.filter((entry) => entry.type === "feat")) {
        const automation = item.flags?.warcraftrpg2e?.bestiary?.automation;
        if (item.flags?.warcraftrpg2e?.reference) {
          const reference = item.flags.warcraftrpg2e.reference;
          expect(automation).toBe("linked-reference");
          expect(item.system.description.value).toContain(
            `@UUID[Compendium.${reference.pack}.Item.${reference.id}]`,
          );
          linked += 1;
        } else if (automation === "manual") {
          expect(item.system.description.value).toMatch(/remains GM-adjudicated/i);
          manual += 1;
        }
      }
    }
    expect(linked).toBeGreaterThan(150);
    expect(manual).toBeGreaterThan(100);
  });

  test("encodes common printed passive defenses as actor mechanics", () => {
    const actors = new Map(bestiary.documents.map((actor) => [actor.name, actor]));
    const primaryHd = (name) => actors.get(name)._embedded.items.find(
      (item) => item.type === "class" && item.flags?.warcraftrpg2e?.bestiary?.hdPool?.index === 0,
    );

    const coreHound = actors.get("Core Hound");
    expect(coreHound.system.traits).toMatchObject({ regen: 10, regenTotal: 10 });
    expect(primaryHd("Core Hound").system.damageReduction).toContainEqual(["15", "magic", false]);

    const dreadlord = actors.get("Dreadlord");
    expect(dreadlord.system.attributes.sr).toEqual({ formula: "27", total: 27 });
    expect(dreadlord.system.traits).toMatchObject({ fastHealing: 5, fastHealingTotal: 5 });
    expect(primaryHd("Dreadlord").system.resistances).toEqual(expect.arrayContaining([
      ["15", "energy-acid", false, false, false],
      ["15", "energy-cold", false, false, false],
      ["20", "energy-fire", false, false, false],
      ["15", "energy-electric", false, false, false],
    ]));

    expect(primaryHd("Bronze Whelp").system.resistances).toEqual(expect.arrayContaining([
      ["", "energy-electric", true, false, false],
      ["", "energy-cold", false, true, false],
    ]));
    expect(primaryHd("Red Whelp").system.resistances).toEqual(expect.arrayContaining([
      ["", "energy-fire", true, false, false],
      ["", "energy-cold", false, true, false],
    ]));
  });

  test("assigns generic undead their distinct destroyed-at-zero profile", () => {
    const undead = bestiary.documents.filter((actor) => actor.system.attributes.creatureType === "undead");
    expect(undead.length).toBeGreaterThan(10);
    for (const actor of undead) {
      expect(actor.system.attributes.deathRule).toBe("warcraft-undead");
      expect(actor.system.attributes.hp.min).toBe(0);
    }
  });

  test("turns every printed spell-like list into executable or explicitly manual charged items", () => {
    const actors = new Map(bestiary.documents.map((actor) => [actor.name, actor]));
    const declared = catalogue.filter((record) => /spell-like abilities/i.test(
      `${record.fields["Special Attacks"] || ""} ${record.fields["Special Qualities"] || ""}`,
    ));
    expect(declared).toHaveLength(24);

    for (const record of declared) {
      const config = monsterMagic[record.name];
      const actor = actors.get(record.name);
      const slaItems = actor._embedded.items.filter(
        (item) => item.flags?.warcraftrpg2e?.monsterMagic?.kind === "sla",
      );
      expect(config.slas.length).toBeGreaterThan(0);
      expect(slaItems).toHaveLength(config.slas.length);
      expect(actor.system.attributes.spells.spellbooks.spelllike.cl.base).toBe(
        config.slaCasterLevel || actor.system.attributes.hd.total,
      );

      for (const item of slaItems) {
        const rule = item.flags.warcraftrpg2e.monsterMagic;
        expect(rule.casterLevel).toBeGreaterThan(0);
        if (rule.automation === "spell-clone") {
          expect(item.type).toBe("spell");
          expect(item.system.spellbook).toBe("spelllike");
          expect(item.system.components).toMatchObject({
            divineFocus: 0, focus: false, material: false, somatic: false, verbal: false,
          });
          expect(item.flags.warcraftrpg2e.reference.pack).toMatch(/^warcraftrpg2e\.(?:warcraft-spells|spells)$/);
          if (rule.frequency === "day") {
            expect(item.system.specialPrepared).toBe(true);
            expect(item.system.preparation).toMatchObject({
              preparedAmount: rule.uses,
              maxAmount: rule.uses,
            });
          } else {
            expect(item.system.atWill).toBe(true);
          }
        } else {
          expect(rule.automation).toBe("manual-missing-spell");
          expect(item.type).toBe("feat");
          expect(item.system.description.value).toMatch(/no substitute effect has been invented/i);
        }
      }
    }

    const doomguard = actors.get("Doomguard");
    expect(doomguard.flags.warcraftrpg2e.bestiary.magic).toEqual({
      slaExecutable: 6,
      slaManual: 3,
      regularSpells: 0,
    });
    expect(doomguard._embedded.items.find((item) => item.name === "Blasphemy (Sp)").system).toMatchObject({
      atWill: true,
      baseCl: "18",
      save: { dc: "23" },
    });
  });

  test("builds exact repertoire spellbooks for every printed monster spellcaster", () => {
    const actors = new Map(bestiary.documents.map((actor) => [actor.name, actor]));
    const spellcasters = catalogue.filter((record) => /\bspells\b/i.test(
      `${record.fields["Special Attacks"] || ""} ${record.fields["Special Qualities"] || ""}`,
    ));
    expect(spellcasters.map((record) => record.name).sort()).toEqual(
      ["Balnazzar", "Dreadlord", "Kel'Thuzad", "Lady Onyxia", "Nefarian"].sort(),
    );

    for (const record of spellcasters) {
      const casting = monsterMagic[record.name].spellcasting;
      const actor = actors.get(record.name);
      const book = actor.system.attributes.spells.spellbooks.primary;
      const pool = actor.system.attributes.spells.warcraftPools["monster-primary"];
      const spells = actor._embedded.items.filter(
        (item) => item.flags?.warcraftrpg2e?.monsterMagic?.kind === "spell",
      );
      expect(book).toMatchObject({
        ability: casting.ability,
        autoSetup: false,
        autoSpellLevels: false,
        preparationMode: "repertoire",
        repertoireLimitOverride: casting.preparedLimit,
        usesWarcraftSlotPool: true,
        warcraftPoolKey: "monster-primary",
        cl: { base: casting.casterLevel },
      });
      expect(spells.length).toBeGreaterThan(100);
      expect(actor.flags.warcraftrpg2e.bestiary.magic.regularSpells).toBe(spells.length);
      for (let level = 0; level <= 9; level += 1) {
        expect(book.spells[`spell${level}`]).toMatchObject({
          base: casting.slots[level], max: casting.slots[level], value: casting.slots[level],
        });
        expect(pool.spells[`spell${level}`]).toEqual({
          max: casting.slots[level], value: casting.slots[level],
        });
      }
      for (const spell of spells) {
        expect(spell.type).toBe("spell");
        expect(spell.system).toMatchObject({ spellbook: "primary", specialPrepared: false });
        expect(spell.system.preparation.mode).toBe("repertoire");
        expect(spell.flags.warcraftrpg2e.reference.pack).toBe("warcraftrpg2e.warcraft-spells");
      }
      expect(actor._embedded.items).toContainEqual(expect.objectContaining({
        name: "Spellcasting Summary",
        flags: expect.objectContaining({
          warcraftrpg2e: expect.objectContaining({
            monsterMagic: expect.objectContaining({ kind: "spellcasting-summary" }),
          }),
        }),
      }));
    }

    const dreadlord = actors.get("Dreadlord");
    expect(dreadlord.system.attributes.spells.spellbooks.primary).toMatchObject({
      baseDCFormula: "18 + @sl",
      repertoireLimitOverride: 18,
    });
    expect(dreadlord._embedded.items.find((item) => item.name === "Invisibility"))
      .toMatchObject({ system: { level: 2, preparation: { prepared: true } } });

    const onyxiaSpells = actors.get("Lady Onyxia")._embedded.items.filter(
      (item) => item.flags?.warcraftrpg2e?.monsterMagic?.kind === "spell",
    );
    expect(onyxiaSpells.every((item) => item.system.preparation.prepared === false)).toBe(true);

    const kelThuzad = actors.get("Kel'Thuzad");
    expect(kelThuzad._embedded.items.find((item) => item.name === "Frost Nova"))
      .toMatchObject({ system: { level: 3, preparation: { prepared: true } } });
    expect(kelThuzad._embedded.items.find((item) => item.name === "Spellcasting Summary").system.description.value)
      .toMatch(/Epic slots \(manual\).*10: 4.*14: 3/i);
  });

  test("indexes every embedded item and excludes copied narrative prose or book art", () => {
    const forbidden = /64\.69\.87\.237|starter slice|require manual resolution|imported automatically/i;
    for (const { entry, document } of bestiary.index.map((entry, index) => ({ entry, document: bestiary.documents[index] }))) {
      const embeddedIds = document._embedded.items.map((item) => item._id).sort();
      expect(document.items.slice().sort()).toEqual(embeddedIds);
      expect(Object.keys(entry.childKeyByCollection.items).sort()).toEqual(embeddedIds);
      expect(JSON.stringify(document)).not.toMatch(forbidden);
      expect(document.img).toMatch(/^icons\/svg\//);
      for (const item of document._embedded.items) expect(item.img).toMatch(/^icons\/svg\//);
    }
  });
});
