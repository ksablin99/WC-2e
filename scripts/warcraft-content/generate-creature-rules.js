const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const packDir = path.join(root, "source", "warcraft-creature-rules");
fs.mkdirSync(packDir, { recursive: true });

function id(seed) {
  return crypto.createHash("sha256").update(`warcraftrpg2e:bestiary:${seed}`).digest("hex").slice(0, 16);
}

function slug(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const typeRules = [
  ["Aberration", "d8 Hit Dice; three-quarter base attack; good Will saves. Darkvision 60 feet unless noted otherwise."],
  ["Animal", "d8 Hit Dice; three-quarter base attack; good Fortitude and Reflex saves. Low-light vision."],
  ["Construct", "d10 Hit Dice; three-quarter base attack; no good saves. No Stamina score. Darkvision 60 feet and low-light vision. Immune to mind-affecting effects, poison, sleep, paralysis, stunning, disease, death and necromancy effects, critical hits, nonlethal damage, ability damage or drain, fatigue, exhaustion, and energy drain. Immune to Fortitude-save effects unless they affect objects or are harmless. Cannot heal naturally, but suitable repair and fast healing can work. Destroyed at 0 hit points; cannot be raised or resurrected; does not eat, sleep, or breathe. Size grants bonus hit points."],
  ["Dragon", "d12 Hit Dice; full base attack; all good saves. Darkvision 120 feet, low-light vision, immunity to magic sleep and paralysis, and the listed elemental subtype rules."],
  ["Elemental", "d8 Hit Dice; three-quarter base attack; good save varies by element. Darkvision 60 feet. Immune to poison, sleep, paralysis, stunning, critical hits, flanking, and resurrection; does not eat, sleep, or breathe."],
  ["Fey", "d6 Hit Dice; half base attack; good Reflex and Will saves. Low-light vision."],
  ["Giant", "d8 Hit Dice; three-quarter base attack; good Fortitude saves. Low-light vision."],
  ["Humanoid", "d8 Hit Dice; three-quarter base attack; one good save chosen by creature type. Proficiencies follow the creature entry."],
  ["Magical Beast", "d10 Hit Dice; full base attack; good Fortitude and Reflex saves. Darkvision 60 feet and low-light vision."],
  ["Monstrous Humanoid", "d8 Hit Dice; full base attack; good Reflex and Will saves. Darkvision 60 feet."],
  ["Ooze", "d10 Hit Dice; three-quarter base attack; no good saves. Mindless; blindsight as listed. Immune to mind-affecting effects, poison, sleep, paralysis, polymorph, stunning, and critical hits."],
  ["Outsider", "d8 Hit Dice; full base attack; all good saves. Darkvision 60 feet. Cannot normally be raised or resurrected except by effects that explicitly restore outsiders."],
  ["Plant", "d8 Hit Dice; three-quarter base attack; good Fortitude saves. Low-light vision. Immune to mind-affecting effects, poison, sleep, paralysis, polymorph, stunning, and critical hits."],
  ["Undead", "d12 Hit Dice; half base attack; good Will saves. No Stamina score. Darkvision 60 feet. Immune to mind-affecting effects, poison, sleep, paralysis, stunning, disease, death effects, critical hits, nonlethal damage, ability damage or drain, fatigue, exhaustion, and energy drain. Uses Charisma where a Stamina-based rule requires a score; destroyed at 0 hit points unless an entry states otherwise."],
  ["Vermin", "d8 Hit Dice; three-quarter base attack; good Fortitude saves. Mindless vermin are immune to mind-affecting effects and commonly have darkvision 60 feet."],
];

const templateRules = [
  ["Corrupted Creature Template", "Acquired template. Apply the source creature's retained statistics plus corruption changes, subtype, fel damage, immunities, challenge adjustment, and other modifications listed on Monster Guide printed pages 19-20.", [19, 20]],
  ["Crypt Fiend Template", "Acquired nerubian undead template. Recalculate type, Hit Dice, defenses, abilities, attacks, qualities, and challenge rating from the template on printed pages 22-24.", [22, 23, 24]],
  ["Elite Creature Template", "Elite multiplier template. Apply maximum hit points, enhanced attacks and defenses, villain-style durability, challenge adjustment, and the source multipliers on printed pages 66-67.", [66, 67]],
  ["Ghost Template", "Acquired incorporeal undead template. Apply manifestation, incorporeality, rejuvenation, special attacks, abilities, and challenge adjustment from printed pages 74-76.", [74, 75, 76]],
  ["Lich Template", "Acquired undead spellcaster template. Apply undead traits, natural armor, touch attack, fear, paralyzing touch, spellcasting retention, phylactery, and challenge adjustment from printed pages 95-97.", [95, 96, 97]],
  ["Mechanized Animal Template", "Construct replacement for an animal. Apply construct type, hardness, malfunction, technological controls, ability changes, and challenge adjustment from printed pages 103-104.", [103, 104]],
  ["Risen Template", "Acquired corporeal undead template. Apply d12 Hit Dice, undead type, retained or altered attacks, unholy toughness, abilities, good saves, and challenge rating equal to Hit Dice plus two, per printed pages 114-115.", [114, 115]],
  ["Skeletal Creature Template", "Acquired corporeal undead template. Apply undead type, natural armor, claw attacks where applicable, abilities, damage reduction, and challenge adjustment from printed pages 125-126.", [125, 126]],
  ["Withered Creature Template", "Acquired undead template. Apply withered ability changes, undead traits, special qualities, and challenge adjustment from printed pages 143-144.", [143, 144]],
  ["Zombie Template", "Acquired corporeal undead template. Apply d12 Hit Dice, undead type, natural armor, slam attack, single-action limitation, abilities, and challenge adjustment from printed pages 148-150.", [148, 149, 150]],
];

const subtypeRules = [
  ["Air", "Usually marks elementals and outsiders tied to the air realm. Such creatures normally have a fly speed and perfect maneuverability unless their entry says otherwise.", [185]],
  ["Aquatic", "Always has a swim speed and moves through water without Swim checks. It normally breathes water and cannot breathe air unless it also has the amphibious quality.", [186]],
  ["Augmented Humanoid", "The creature changed from humanoid to another type. It normally uses the traits of its current type while retaining the features, such as Hit Die and base progressions, of its original humanoid type.", [186]],
  ["Chaotic", "Alignment-dependent effects treat the creature as chaotic as well as using its actual alignment. Its natural and wielded weapons count as chaotic for overcoming damage reduction.", [186, 187]],
  ["Cold", "Immune to cold and vulnerable to fire; fire damage is increased by one-half even when a saving throw applies or succeeds.", [187]],
  ["Demon", "Also has the evil subtype. Unless its entry overrides them, a demon is immune to death effects and poison, has resistance 10 to acid, cold, electricity, and fire, telepathy 100 feet, darkvision 60 feet, and can see through magical darkness. Its travel spell-like abilities are restricted to the Twisting Nether as described by the shared demon rules.", [188]],
  ["Earth", "Usually marks elementals and outsiders tied to earth. Such creatures normally have a burrow speed, often through solid rock, unless their entry says otherwise.", [188]],
  ["Evil", "Alignment-dependent effects treat the creature as evil as well as using its actual alignment. Its natural and wielded weapons count as evil for overcoming damage reduction.", [189]],
  ["Extraplanar", "Applies while a creature is away from its native plane. Azeroth is the assumed encounter plane in the catalogue; the subtype changes as the creature travels and never applies in the Twisting Nether.", [189]],
  ["Fire", "Immune to fire and vulnerable to cold; cold damage is increased by one-half even when a saving throw applies or succeeds.", [190]],
  ["Incorporeal", "Has no physical body. Nonmagical attacks cannot harm it; corporeal magical sources normally have a 50% failure chance except for force, positive or negative energy, ghost touch, and other stated exceptions. It uses a Charisma-based deflection bonus, can pass through objects under the printed limits, moves silently, cannot fall or make physical trip or grapple attacks, and follows the full incorporeal combat rules.", [191, 192]],
  ["Lawful", "Alignment-dependent effects treat the creature as lawful as well as using its actual alignment. Its natural and wielded weapons count as lawful for overcoming damage reduction.", [186, 187]],
  ["Mechanical", "Marks a technological construct. It can be modified like a technological device; a helpless mechanical creature can normally be disabled after at least 1 full round with Disable Device or Use Technological Device at DC 15 + half its Hit Dice, subject to GM adjudication.", [192]],
  ["Native", "Applies to an outsider with mortal ancestry or a strong tie to Azeroth. It can be raised, reincarnated, or resurrected normally and must eat and sleep as well as breathe.", [193]],
  ["Swarm", "Acts as one creature occupying a 10-foot area with reach 0. It shares one pool of statistics, moves through occupied spaces, is immune to critical hits and flanking, cannot be tripped, grappled, or bull rushed, and is damaged according to component size. It deals automatic swarm damage in occupied spaces, does not threaten, applies distraction, is generally immune to fixed-target effects, and takes half again as much damage from area effects. Use the printed component-size, wind, and damage table details.", [197, 198]],
  ["Water", "Usually marks elementals and outsiders tied to water. It normally has a swim speed, moves through water without Swim checks, breathes water, and can usually breathe air.", [200]],
  ["Dark Iron Dwarf", "Racial identity subtype. Apply no extra shared modifier beyond the creature's printed statistics and any linked Dark Iron racial abilities.", [185, 200]],
  ["Dwarf", "Racial identity subtype. Apply no extra shared modifier beyond the creature's printed statistics and any linked dwarf racial abilities.", [185, 200]],
  ["Gnoll", "Racial identity subtype. Apply no extra shared modifier beyond the creature's printed statistics and racial entry.", [185, 200]],
  ["Human", "Racial identity subtype. Apply no extra shared modifier beyond the creature's printed statistics and any linked human racial abilities.", [185, 200]],
  ["Kobold", "Racial identity subtype. Apply no extra shared modifier beyond the creature's printed statistics and racial entry.", [185, 200]],
  ["Leper Gnome", "Racial identity subtype. Apply no extra shared modifier beyond the creature's printed statistics and racial entry.", [185, 200]],
  ["Makrura", "Racial identity subtype. Apply no extra shared modifier beyond the creature's printed statistics and racial entry.", [185, 200]],
  ["Naga", "Racial identity subtype. Apply no extra shared modifier beyond the creature's printed statistics and racial entry.", [185, 200]],
  ["Orc", "Racial identity subtype. Apply no extra shared modifier beyond the creature's printed statistics and any linked orc racial abilities.", [185, 200]],
  ["Trogg", "Racial identity subtype. Apply no extra shared modifier beyond the creature's printed statistics and racial entry.", [185, 200]],
  ["Troll", "Racial identity subtype. Apply no extra shared modifier beyond the creature's printed statistics and any linked troll racial abilities.", [185, 200]],
  ["Zombie", "Marks a creature produced by the zombie template. Use the linked Zombie Template record for shared single-action, ability, defense, and undead changes; the actor retains its printed exceptions.", [148, 149, 150]],
];

const capabilityRules = [
  ["Natural Attacks", "A natural weapon is armed, threatens normally, and does not gain iterative attacks from high base attack bonus. The printed Attack line identifies the primary weapon; remaining natural weapons are secondary, normally at -5 (-2 with Multiattack). Primary damage uses full Strength and secondary damage normally uses half Strength. The actor's linked Full Attack record is authoritative for number, order, and exceptions.", [193]],
  ["Full Attacks", "A full attack uses every attack and count linked from the creature's printed Full Attack line. Natural attacks do not gain BAB iteratives; manufactured-weapon iteratives and primary or secondary natural-weapon penalties are already reflected in the printed bonuses. Do not recalculate away explicit source exceptions.", [193]],
  ["Monster Spellcasting", "A monster casting spells follows character spellcasting except for the printed creature exceptions: body movement may supply somatic components, material components are still needed, spellcasting alone grants no other class features, healer domain powers require actual healer levels, an arcanist path grants its restricted extra slot, and explicitly equivalent class casting stacks with levels in that class.", [196, 197]],
  ["Spell-Like Abilities", "A spell-like ability has no components, normally takes a standard action, provokes, can be disrupted or used defensively with Concentration, is suppressed by anti-magic, and is subject to spell resistance when the duplicated spell is. It cannot counterspell or be counterspelled. Use the listed caster level, or Hit Dice if none is listed; the usual save DC is 10 + duplicated spell level + Charisma modifier.", [196]],
  ["Summoning Creatures", "Roll the listed success chance. A successful summon normally lasts 1 hour; a summoned creature cannot use its own summon ability for 1 hour and grants no experience when defeated. Use the listed equivalent spell level for Concentration and dispelling. The summoner's feature names the eligible creature and any exception.", [197]],
];

function makeDocument(name, text, kind, pages) {
  return {
    _embedded: {},
    _id: id(`${kind}:${name}`),
    effects: [],
    flags: {
      warcraftrpg2e: {
        source: {
          book: "World of Warcraft: Monster Guide",
          file: "docs/WoW - Monster Guide [2007] {WW17212}.pdf",
          printedPages: pages,
          pdfPages: pages.map((page) => page + 1),
          section: name,
          verification: "text+render",
        },
        creatureRule: { kind, reusable: true },
      },
    },
    folder: null,
    img: "icons/svg/aura.svg",
    name: `${name} Traits`.replace(" Template Traits", " Template"),
    ownership: { default: 0 },
    sort: 0,
    system: {
      abilityType: "nat",
      description: { value: `<p>${text}</p><p>This reusable record defines shared conversion behavior. Individual actors carry exact printed exceptions and totals.</p>` },
      featType: "trait",
      source: `World of Warcraft: Monster Guide, pp. ${pages.join("-")}`,
      uniqueId: `wc-creature-rule-${slug(name)}`,
    },
    type: "feat",
  };
}

const typePage = 185;
const documents = [
  ...typeRules.map(([name, text]) => makeDocument(name, text, "type", [typePage, 200])),
  ...subtypeRules.map(([name, text, pages]) => makeDocument(`${name} Subtype`, text, "subtype", pages)),
  ...capabilityRules.map(([name, text, pages]) => makeDocument(name, text, "capability", pages)),
  ...templateRules.map(([name, text, pages]) => makeDocument(name, text, "template", pages)),
];

for (const file of fs.readdirSync(packDir).filter((file) => file.endsWith(".json") && file !== ".index.json")) fs.unlinkSync(path.join(packDir, file));
for (const document of documents) fs.writeFileSync(path.join(packDir, `${slug(document.name)}-${document._id}.json`), `${JSON.stringify(document, null, 2)}\n`, "utf8");
const index = documents.map((document) => ({
  childKeyByCollection: {}, embeddedCollections: [], file: `${slug(document.name)}-${document._id}.json`, key: `!items!${document._id}`,
})).sort((a, b) => a.file.localeCompare(b.file));
fs.writeFileSync(path.join(packDir, ".index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Generated ${documents.length} reusable creature type, subtype, capability, and template records.`);
