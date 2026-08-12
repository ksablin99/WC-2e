const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const packDir = path.join(root, "source", "warcraft-classes");
const featureBase = JSON.parse(fs.readFileSync(path.join(packDir, "warrior-bonus-feat-uyhwjrfcckzfgwo6.json"), "utf8"));
const idFor = (kind, name) => crypto.createHash("sha256").update(`warcraftrpg2e:${kind}:${name}`).digest("hex").slice(0, 16);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const PATHS = {
  Arcanist: {
    pages: [61, 62, 64], printed: [59, 60, 62], default: "mage", pool: "int", special0: true,
    paths: {
      mage: [
        ["Summon Familiar", 1, "Gain a familiar. Companion statistics and advancement use the familiar table; creation and replacement remain a controlled-companion workflow."],
        ["Call Elemental", 4, "Summon an elemental once per day as a standard action. Size scales with Mage path level; companion placement is manual."],
        ["Enhanced Counterspell", 8, "Add Mage path level to counterspell checks and use a prepared same-level, same-school spell, except against necromancy or summoning."],
        ["Arcane Adept", 12, "Choose evocation or transmutation; spells of that school gain +1 caster level and +2 save DC."],
        ["Fire and Frost", 16, "Prepare one additional cold- or fire-descriptor spell at each level; it is maximized without changing spell level."],
      ],
      necromancer: [
        ["Death Touch", 1, "Melee touch; roll 1d6 per Necromancer path level. A living target dies without a save if the total equals or exceeds its current hit points. Uses increase at path levels 9 and 18."],
        ["Death Resistance", 4, "Immune to death spells and magical death effects; this does not prevent other lethal damage, poison, or petrification."],
        ["Animate Dead", 8, "Use animate dead a number of times per day equal to half Necromancer path level; control at most 2 HD per path level across this ability and the spell."],
        ["Dark Arts", 12, "Necromancy-school spells gain +1 caster level and +2 save DC."],
        ["Create Undead", 16, "Use create undead twice per day or create greater undead once per day at Necromancer path level. Creature creation remains manual."],
      ],
      warlock: [
        ["Fel Companion", 1, "Bind an evil outsider of no more HD than Warlock path level, maximum 10 HD. Summoning, dismissal, replacement cost, death saves, XP loss, and Stamina damage are resolved manually."],
        ["Summoner", 4, "Gain Augment Summoning. From path level 6, conjuration (summoning) durations double as Extend Spell without changing spell level."],
        ["Enslave Outsider", 8, "For planar binding spells, add the better of a relevant Knowledge rank or Spellcraft rank to the trapping caster-level or Charisma check."],
        ["Demonologist", 12, "Conjuration (summoning) spells gain +1 caster level and +2 save DC."],
        ["Demon Mastery", 16, "Rebuke, command, or bolster outsiders as an evil priest using Warlock path level, 3 + Charisma modifier times per day."],
      ],
    },
  },
  Healer: {
    pages: [69, 70, 72, 73, 74], printed: [67, 68, 70, 71, 72], default: "druid", pool: "wis", special0: false,
    paths: {
      druid: [
        ["Strider and Animal Companion", 1, "Move normally through natural undergrowth, leave no trail, and gain a scaling animal companion. Companion management remains manual."],
        ["Wild Shape", 4, "Assume listed animal forms for 1 hour per Druid path level. Uses and available forms scale by path level; form replacement remains manual."],
        ["Dreamwalker", 8, "Enter the Emerald Dream once per day from a forested or wild area, functioning like plane shift."],
        ["Group Stride", 12, "Share Strider with up to 6 + Spirit modifier Small-to-Large travelling companions."],
        ["Greater Dreamwalk and Timeless Body", 16, "Bring Spirit-modifier companions into the Emerald Dream; cease aging penalties and magical aging."],
      ],
      priest: [
        ["Aegis", 1, "Before a save against a targeted spell or special effect, gain a divine save bonus starting at +2 and increasing by +1 every two Priest path levels; uses equal 1 + Spirit modifier."],
        ["Smite", 4, "Sacrifice the highest remaining generic slot before an attack to gain scaling divine damage against an opposed outsider or undead; uses equal Spirit bonus."],
        ["Compel", 8, "Use suggestion once per day at full divine caster level, gaining uses at path levels 14 and 20."],
        ["Greater Aegis", 12, "Once per day, qualifying allies within 30 feet gain a save bonus equal to half Priest path level for 1 + Spirit modifier rounds."],
        ["Greater Compulsion", 16, "Once per day use Compel on groups as mass suggestion at full divine caster level."],
      ],
      shaman: [
        ["Augur", 1, "Use augury once per day as a spell-like ability at Shaman path caster level."],
        ["Flametongue or Frostbrand", 4, "Sacrifice a prepared slot of level 1+ to give a wielded weapon flaming or frost for 1 + Spirit modifier rounds; uses increase at path levels 8 and 12."],
        ["Ghostwolf", 8, "Assume a Large wolf form for 1 hour per Shaman path level. Form replacement remains manual."],
        ["Purge", 12, "Dispel one beneficial transmutation using 1d20 + caster level (maximum +10) against DC 11 + effect caster level; only one attempt per effect."],
        ["Rebirth", 16, "Sacrifice a slot of level 5+ to resurrect a qualifying ally dead no more than 8 hours; once per day, twice at path level 20."],
      ],
    },
  },
};

for (const file of fs.readdirSync(packDir)) {
  if (!file.endsWith(".json") || file === ".index.json") continue;
  const doc = JSON.parse(fs.readFileSync(path.join(packDir, file), "utf8"));
  const isGeneratedPathFeature = doc.flags?.warcraftrpg2e?.spellcastingPath?.generated === true;
  const isSupersededPrototype = doc.name === "Healer Inspiration"
    || (doc.flags?.warcraftrpg2e?.classPath === "mage" && doc.name.startsWith("Mage Arcana:"));
  if (isGeneratedPathFeature || isSupersededPrototype) fs.unlinkSync(path.join(packDir, file));
}

function classFileFor(parent) {
  if (parent === "Arcanist") return path.join(packDir, "arcanist-vwvlbnyqdgmbiwhq.json");
  return path.join(packDir, fs.readdirSync(packDir).find((file) => {
    if (!file.startsWith("healer-") || !file.endsWith(".json")) return false;
    const doc = JSON.parse(fs.readFileSync(path.join(packDir, file), "utf8"));
    return doc.type === "class" && doc.name === "Healer";
  }));
}

for (const [parent, config] of Object.entries(PATHS)) {
  const classFile = classFileFor(parent);
  const classDoc = JSON.parse(fs.readFileSync(classFile, "utf8"));
  classDoc.system.classPaths = {
    enabled: true,
    default: config.default,
    choices: Object.keys(config.paths).map((id) => ({ id, name: id[0].toUpperCase() + id.slice(1) })),
  };
  classDoc.system.pathLevels = Object.fromEntries(Object.keys(config.paths).map((id) => [id, 0]));
  classDoc.system.currentPath = "";
  classDoc.system.usesWarcraftSlotPool = true;
  classDoc.system.warcraftPoolKey = config.pool;
  classDoc.system.warcraftParentClass = parent.toLowerCase();
  classDoc.system.hasSpecialSlot = true;
  classDoc.system.specialSlotLevel0 = config.special0;
  classDoc.system.warcraftPathBonusSlot = parent === "Arcanist";
  classDoc.system.spellcastingDescription = parent === "Arcanist"
    ? "Prepare a persistent repertoire from the general Arcanist list and any path in which you have a level. Generic slots and caster level use total Arcanist level. One bonus slot restricted to any acquired path list exists at every spell level, including level 0. Forbidden Arts penalties are applied dynamically."
    : "Prepare a persistent repertoire from the Healer and acquired path lists. Generic slots and caster level use total Healer level. A restricted domain slot exists at each castable level. Path inspirations use path level, not total Healer level.";
  classDoc.flags.warcraftrpg2e.spellcasting = {
    preparation: "persistent-repertoire",
    genericSlots: true,
    higherSlotSubstitution: true,
    pathBonusSlot: parent === "Arcanist" ? 1 : 0,
    domainSlot: parent === "Healer" ? 1 : 0,
  };
  fs.writeFileSync(classFile, `${JSON.stringify(classDoc, null, 2)}\n`);

  for (const [pathId, features] of Object.entries(config.paths)) {
    for (const [name, level, description] of features) {
      const document = JSON.parse(JSON.stringify(featureBase));
      document._id = idFor("spellcasting-path-feature", `${parent}:${pathId}:${name}`);
      document.name = `${pathId[0].toUpperCase() + pathId.slice(1)}: ${name}`;
      document.system.identifiedName = document.name;
      document.system.associations.classes = [[parent, level]];
      document.system.uniqueId = `wc-path-${document._id.slice(0, 8)}-*`;
      document.system.index.uniqueId = document.system.uniqueId;
      document.system.description.value = `<p>${description}</p>`;
      document.system.shortDescription = document.system.description.value;
      document.system.source = `World of Warcraft RPG, 2nd Edition, p. ${config.printed.join(", ")}`;
      document.system.warcraftPath = { parentClass: parent, id: pathId };
      document.flags = {
        warcraftrpg2e: {
          source: {
            book: "World of Warcraft: The Roleplaying Game, Second Edition",
            file: "docs/World_of_Warcraft_2nd_Edition.pdf",
            pdfPages: config.pages,
            printedPages: config.printed,
            section: `${pathId}: ${name}`,
            verification: "text+render",
          },
          spellcastingPath: { generated: true, parentClass: parent, path: pathId, level },
        },
      };
      fs.writeFileSync(path.join(packDir, `${slug(document.name)}-${document._id}.json`), `${JSON.stringify(document, null, 2)}\n`);
    }
  }
}

const documents = fs.readdirSync(packDir).filter((file) => file.endsWith(".json") && file !== ".index.json")
  .map((file) => ({ file, document: JSON.parse(fs.readFileSync(path.join(packDir, file), "utf8")) }))
  .sort((a, b) => a.document.name.localeCompare(b.document.name) || a.document.type.localeCompare(b.document.type));
fs.writeFileSync(path.join(packDir, ".index.json"), `${JSON.stringify(documents.map(({ file, document }) => ({ childKeyByCollection: {}, embeddedCollections: [], file, key: `!items!${document._id}` })), null, 2)}\n`);
console.log("Generated six spellcasting paths and 30 threshold feature records.");
