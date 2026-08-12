const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const outputDir = path.join(root, "source", "warcraft-rules");
fs.mkdirSync(outputDir, { recursive: true });
for (const file of fs.readdirSync(outputDir)) if (file.endsWith(".json")) fs.unlinkSync(path.join(outputDir, file));
const idFor = (kind, name) => crypto.createHash("sha256").update(`warcraftrpg2e:${kind}:${name}`).digest("hex").slice(0,16);
const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");

const journals = [
  ["Character Creation","Choose one of the ten Warcraft races, then a base class. Ability labels are Strength, Agility, Stamina, Intellect, Spirit, and Charisma. Use the Warcraft skill list. Faith and affiliation are recorded on the character sheet. Racial-level and full prerequisite validation remain manual until the advancement milestone is completed."],
  ["Races and Racial Levels","The Warcraft Races compendium contains all ten race records. Static ability, size, speed, sense, and skill adjustments apply from the race item. Night elf's disputed penalty is intentionally not automated; consult the errata ledger. Forsaken use their dedicated death rule. Complete racial-level progression remains a later architecture milestone."],
  ["Classes, Paths, and Advancement","The Warcraft Classes compendium contains all nine base classes, ten prestige classes, and their table-granted features. Arcanist currently supports the Mage path and repertoire casting. Other paths, racial advancement, prerequisite enforcement, and prestige spellcasting advancement are marked manual pending their dedicated progression work."],
  ["Skills and Feats","The actor sheet exposes the 44-skill Warcraft list, including Stealth, Craft (technological device), Use Technological Device, Knowledge (military tactics), and Profession (military commander). The Warcraft Feats compendium identifies every core feat and prerequisite. Records marked manual-effect require the private rulebook; proven SRD equivalents retain their normal automation."],
  ["Combat and Conditions","Core combat remains the D&D 3.5 d20 chassis with Warcraft terminology. Warcraft death boundaries and construct destruction are system-supported. Chilled, fel damage, immunity, resistance, precision, fortification, and unusual target-dependent abilities must be checked against the item's automation status and manual note."],
  ["Magic and Spell Preparation","Warcraft casters learn spells, prepare a persistent repertoire, and spend generic slots by spell level. Rest refills slots without clearing the repertoire. The Warcraft Spells compendium contains every extracted class, path, and domain list entry. Catalogue-only spells have no fabricated action; use the private rulebook until their automation is verified."],
  ["Hero Points and Shouts","Shouts are extraordinary sonic mind-affecting abilities, normally a 30-foot radius and half character level rounds. Daily shout uses equal the number of shout feats. Hero Points must be declared before success or failure is known; the general options appear in the character sheet, while feat-specific options are shown only when the feat explicitly grants one."],
  ["Equipment, Firearms, and Explosives","The Warcraft Equipment compendium contains the core weapon, armor, gear, tool, service, mount, vehicle, building, explosive, and material tables. Structured combat items may be used normally. Records marked manual-noncombat-details preserve discoverability and source pages but require the printed price or capacity table. Firearm malfunction and explosive scatter remain manual."],
  ["Technology","Technology uses Function Difficulty, Technological Limit, Technology Scores, Complexity, Time Factor, Malfunction Rating, fuel, hardness, hit points, construction, operation, repair, and upgrades. The content catalogue includes technology feats and relevant gear, but the coupled technology subsystem remains intentionally manual until its Ultra architecture phase."],
  ["Faith and Affiliation","Actors can record faith, affiliation, and affiliation rating. These values are descriptive unless a feature explicitly consumes them. First-impression and situational social modifiers remain a GM-applied adjustment until target-aware social-roll integration is completed."],
];

const source = { book: "World of Warcraft: The Roleplaying Game, Second Edition", file: "docs/World_of_Warcraft_2nd_Edition.pdf", section: "Private-use implementation policy", verification: "implementation-summary" };
const index = [];
for (const [name, content] of journals) {
  const id = idFor("journal",name); const pageId = idFor("journal-page",name);
  const document = {
    _embedded: { pages: [{ _id: pageId, _stats: { compendiumSource:null,coreVersion:"13.351",createdTime:null,duplicateSource:null,exportSource:null,lastModifiedBy:null,modifiedTime:null,systemId:null,systemVersion:null }, category:null, flags:{warcraftrpg2e:{source}}, image:{}, name, ownership:{default:-1}, sort:0, src:null, system:{}, text:{content:`<p>${content}</p>`,format:1}, title:{level:1,show:false}, type:"text", video:{controls:true,volume:0.5} }] },
    _id:id, _stats:{compendiumSource:null,coreVersion:"13.351",createdTime:null,duplicateSource:null,exportSource:null,lastModifiedBy:null,modifiedTime:null,systemId:null,systemVersion:null}, categories:[], flags:{warcraftrpg2e:{source}}, folder:null, name, ownership:{default:0}, pages:[pageId], sort:0,
  };
  const file=`${slug(name)}-${id}.json`;
  fs.writeFileSync(path.join(outputDir,file),`${JSON.stringify(document,null,2)}\n`);
  index.push({childKeyByCollection:{pages:{[pageId]:`!journal.pages!${id}.${pageId}`}},embeddedCollections:["pages"],file,key:`!journal!${id}`});
}
fs.writeFileSync(path.join(outputDir,".index.json"),`${JSON.stringify(index,null,2)}\n`);
console.log(`Generated ${journals.length} Warcraft rules journals.`);
