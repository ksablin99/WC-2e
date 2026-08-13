# Warcraft RPG 2e Foundry conversion roadmap

Last updated: 2026-08-13
Current released baseline: 3.3.0
Current phase: Full local Foundry v14 regression validation complete; fresh/update installation and human visual validation remain

## Status rules

- `[x]` means implemented and covered by the available offline validation.
- `[ ]` means unfinished, intentionally deferred, or dependent on a real Foundry v14 instance.
- **Manual by design** means the record is complete, sourced, and tells the GM what to adjudicate. It is not missing content.
- Warcraft PDFs under `docs/` are authoritative; the local SRD is used only for unchanged D&D 3.5 mechanics.
- Keep internal compatibility keys such as `dex`, `con`, and `wis`; present them as Agility, Stamina, and Spirit.
- Prefer correct manual adjudication to automation that lacks enough target, scene, or rules context.
- Do not put Warcraft book artwork, PDFs, or wholesale book prose into a distributable release.
- Bestiary remains the final content phase. No intermediate smoke-test slices are used.

## Model routing

- **Sol High:** extraction, routine implementation, catalogue population, metadata, links, deterministic tests, UI polish, journals, and pack rebuilds.
- **Sol Ultra:** architecture, migrations, ambiguous rules, cross-subsystem state, progression/casting state, complex combat and death interactions, and completion audits.
- **Mixed:** High for bulk work; Ultra for the architecture or edge cases named by the task.

| Phase | Bulk mode | Ultra responsibility |
| --- | --- | --- |
| 1. Core rules | Mixed | Death/healing, migration, immunity and damage interactions |
| 2. Races | Mixed | Racial levels, healing exceptions, active mechanics |
| 3. Classes | Mixed | Path state, prerequisites, prestige and level-up integration |
| 4. Magic | Mixed | Repertoire, slots, pooling, eligibility, complex spell state |
| 5. Feats/resources | Mixed | Prerequisite engine and combat-flow Hero Point options |
| 6. Equipment/combat | Mixed | Malfunction, explosives, action economy and combat audit |
| 7. Technology | Sol Ultra | Data model, formulas, crafting, use and vehicles |
| 8. Creation/UX | Mixed | Cross-system guided creation and validation |
| 9. Compendiums | Sol High | Optional final completeness audit |
| 10. Reliability | Mixed | Migrations, cross-system regressions, release audit |
| 11. Bestiary, last | Mixed | Pipeline/reusable rules first, then bulk conversion |

## Phase 1 - Core rules and actor model

**Recommended mode:** Mixed; Ultra for health, migration, and immunity interactions.

- [x] Display Strength, Agility, Stamina, Intellect, Spirit, and Charisma while preserving stable internal keys.
- [x] Replace the playable skill list with Warcraft skills, including Stealth, Craft (technological device), Use Technological Device, Knowledge (military tactics), and Profession (military commander).
- [x] Migrate legacy Hide and Move Silently data safely into Stealth and preserve migration reporting.
- [x] Implement Warcraft living-character disabled, dying, dead, stabilization, recovery, and Heal DC rules.
- [x] Implement Forsaken inverted healing, no natural recovery, no Stamina, Concentration exception, and fixed destruction boundary.
- [x] Implement construct absent abilities, bonus HP, destruction at 0, no natural recovery, and reusable immunity profile.
- [x] Recalculate conditions after HP, Stamina, race, creature-profile, or death-rule changes.
- [x] Add faith, affiliation, rating, language, senses, movement, size, reach, and creature-profile presentation.
- [x] Add Chilled, fel damage, technological damage, descriptor handling, precision/fortification, immunity, resistance, and vulnerability support.
- [ ] Exhaustive target-aware affiliation modifiers. **Deferred:** campaign- and target-dependent; current fields and manual rule are usable.
- [ ] Live Foundry v14 actor-sheet, damage, healing, recovery, and migration validation.

## Phase 2 - Races and racial progression

**Recommended mode:** Mixed; Ultra for progression and exception state.

- [x] Import all ten races: Ironforge dwarf, high elf, night elf, gnome, goblin, human, orc, tauren, jungle troll, and Forsaken.
- [x] Encode ability changes, size, speed, reach, senses, languages, proficiencies, skills, saves, favored classes, resistances, vulnerabilities, and healing exceptions.
- [x] Import every printed racial-level progression and all level-granted features.
- [x] Support racial levels in advancement history without level adjustment or duplicate HD, XP, BAB, saves, HP, or features.
- [x] Validate racial-level prerequisites and direct-created/legacy actor fallback state.
- [x] Integrate racial-level planning into guided creation and actual grants into level-up workflow.
- [x] Mark active or situational racial powers as executable where reliable and sourced manual rules otherwise.
- [ ] Live Foundry v14 coverage for every race/racial-level combination.

## Phase 3 - Classes, paths, prestige, and advancement

**Recommended mode:** Mixed; Ultra for path, prerequisite, and spellcasting progression state.

- [x] Import all nine base classes and their complete progression tables.
- [x] Import Mage, Necromancer, Warlock, Druid, Priest, and Shaman paths.
- [x] Track shared parent-class level, per-path level, current path, path switching, and path-specific thresholds.
- [x] Share compatible slots and caster level without double-counting HD, BAB, saves, or class levels.
- [x] Import all ten prestige classes, their feature tables, typed prerequisites, and spellcasting advancement targets.
- [x] Validate class, path, race, feat, skill, spellcasting, and prestige prerequisites during advancement/import.
- [x] Grant features deterministically without duplicates and repair incomplete legacy/direct-created path state.
- [x] Add common executable class features and sourced manual boundaries for companions, turning, inspirations, auras, and situational effects.
- [ ] Exhaustive live level 1-20 matrix across every multiclass, path-switch, racial-level, and prestige combination.

## Phase 4 - Magic and spell content

**Recommended mode:** Mixed; Ultra for repertoire, slots, eligibility, and cross-actor spell state.

- [x] Implement learned spells and persistent prepared repertoires for Warcraft casters.
- [x] Enforce preparation capacity from casting ability and Spellcraft ranks.
- [x] Implement generic per-level pools, higher-slot substitution, level-0 path slots, restricted path bonus slots, and rest recovery without clearing repertoire choices.
- [x] Implement compatible multiclass pooling while keeping preparation and path eligibility separate.
- [x] Import the complete 342-spell core catalogue with 504 source-checked class/path/domain assignments.
- [x] Preserve all level-0 lists and every printed level 1-9 list distribution.
- [x] Link all nine domains to one spell at each level 1-9 and encode their granted powers/access rules.
- [x] Extract 337 structured Warcraft spell headers safely, including four page/column-boundary headers; classify five SRD-compatible list-only fallbacks explicitly.
- [x] Provide usable in-system rules text for all 342 spells: 249 inherit complete matching SRD mechanics, 88 Warcraft-only records contain verified paraphrased rules with explicit manual boundaries, and five retain purpose-built implementations. No catalogue/reference-only placeholders remain.
- [x] Support ordinary attacks, saves, spell resistance, damage/healing, durations, buffs, and templates where data is reliable.
- [x] Document complex dispel/counterspell, summon/control, polymorph/form, Mana Shield/Burn, and persistent-effect boundaries instead of inventing behavior.
- [ ] Exhaustive automation for every summon, form, companion, and cross-actor persistent spell. **Deferred:** low reliability without richer scene/target context.
- [ ] Live Foundry v14 learn-prepare-cast-expend-rest regression suite.

## Phase 5 - Feats, Hero Points, and shouts

**Recommended mode:** Mixed; Ultra for prerequisites and combat-flow overrides.

- [x] Import all 141 core feats, including shout, technology, racial, class, path, metamagic, item-creation, and repeatable categories.
- [x] Parse and enforce ability, BAB, skill, race, class, path, spellcasting, and feat prerequisites.
- [x] Prevent invalid duplicate, conflict, and mutually exclusive selection; retain repeatable feat behavior.
- [x] Implement the shared Shout Uses pool, rest recovery, range, duration, targets, saves, and timed effects.
- [x] Implement the printed Hero Point extra-shout option with doubled applicable range/duration.
- [x] Add Hero Point resource/recovery and supported +20 check, attack, save, AC, save-DC, stabilization, double-damage, called-shot, and out-of-turn action flows.
- [x] Provide usable in-system rules text for all 141 feats, including 53 verified Warcraft-only feat records with explicit Foundry/GM handling. No handbook-only placeholders remain.
- [x] Keep narrative alteration and trigger/adjudication-dependent feat outcomes manual by design.
- [ ] Live Foundry v14 combat-lifecycle validation for Hero Point and shout dialogs/effects.

## Phase 6 - Equipment, materials, and combat support

**Recommended mode:** Mixed; Ultra for malfunction, explosives, and action economy.

- [x] Import 270 printed equipment entries plus four structured materials: arcanite, dragonhide, mithril, and thorium.
- [x] Encode price, weight, proficiency, handedness, reach, range, damage, criticals, armor, maximum Agility, armor check penalty, speed, spell failure, hardness, HP, and material effects.
- [x] Implement firearm ammunition, powder, reload actions, full-attack interaction, malfunction ratings, jam/misfire handling, and repair metadata.
- [x] Implement explosive priming, UTD checks, fuse timing, touch attacks, range penalties, scatter, dud/premature outcomes, and damage chat.
- [x] Preserve standard D&D 3.5 full attacks, iterative/natural attacks, critical/precision behavior, charge, reach, AoO, grapple, cover, concealment, and Warcraft exceptions.
- [x] Validate printed table prices, normalized currency, crafting values, and special salvage records where supplied.
- [ ] Automatic ammunition recovery and campaign-specific regional availability. **Deferred:** table/GM policy, not a universal core rule.
- [ ] Live Foundry v14 firearm, explosive, and combat interaction pass.

## Phase 7 - Technology subsystem

**Recommended mode:** Sol Ultra.

- [x] Add a technology item model and sheet for Function Difficulty, Technological Limit, Technology Scores, Complexity, Time Factor, Malfunction Rating, fuel/ammunition, hardness, HP, and value/cost formulas.
- [x] Implement design, collaboration, construction time/cost, Craft checks, Use Technological Device checks, upgrades, repair, supply/fuel, racial materials, knacks, and masterwork rules.
- [x] Integrate Tinker progression and technology feats.
- [x] Implement operation, damage, and permanent-malfunction handling.
- [x] Represent vehicle statistics, movement, maneuverability, fuel, durability, and crew metadata.
- [ ] Full tactical vehicle crew/combat engine. **Deferred:** represented data is usable; source/schema does not justify a separate combat simulator for the minimum conversion.
- [ ] Live Foundry v14 technology sheet and workflow validation.

## Phase 8 - Character creation and user experience

**Recommended mode:** Mixed; Ultra for cross-system guided state.

- [x] Add a six-step guided builder for race/racial-level planning, class/path, point buy, skills, feats, spells, equipment, faith, and affiliation.
- [x] Validate selections and provide a final creation summary without silently granting planned racial levels.
- [x] Present paths, racial levels, Hero Points, shouts, spell repertoire, eligibility feedback, and technology consistently on relevant sheets/dialogs.
- [x] Add clear validation/error feedback and preserve ordinary D35E controls needed by the inherited engine.
- [x] Validate representative live Foundry v14 character-builder selection, point-buy, final creation, and ability-roll flows in the isolated local test environment.
- [ ] Complete visual/accessibility audit of every player, NPC, loot, minion, and item sheet in live Foundry v14.
- [ ] Live creation of every supported race/class/path combination and live advancement verification.

## Phase 9 - Compendiums and rules reference

**Recommended mode:** Sol High.

- [x] Final compendium folder structure, stable IDs, document types, searchable metadata, and provenance.
- [x] Links between classes, paths, features, spells, domains, feats, equipment, materials, creature rules, and bestiary references where a concrete target exists.
- [x] Duplicate-ID, broken-reference, provenance, asset-policy, catalogue-completeness, and source-to-pack validators.
- [x] Ten concise rules journals covering creation, races, classes, skills/feats, combat, magic, Hero Points/shouts, equipment, technology, faith, and affiliation.
- [x] Use redistributable system/core icons only; book artwork remains excluded.

## Phase 10 - Migrations, reliability, and release readiness

**Recommended mode:** Mixed; Ultra for migration safety and final audit.

- [x] Add compatibility migrations for labels/formulas, Stealth, race/racial levels, class paths/history, spellbooks/repertoire, resources, creature rules, and relevant new schema defaults.
- [x] Keep migrations additive/fallback-safe and report changes through existing system migration flow.
- [x] Add formula, schema, catalogue, provenance, duplicate-ID, reference, source-pack synchronization, and errata validation.
- [x] Add Jest coverage for pure logic and offline content/build contracts.
- [x] Add Playwright specifications for Foundry-facing creation, progression, races, spellcasting, resources, equipment, technology, death rules, and bestiary behavior.
- [x] Make release builds deterministic: generate, validate, repack, verify, test, restore pinned redistributable D35E icons, and inspect the install archive.
- [x] Set up a licensed Foundry v14 runtime with an isolated, guarded test-data root that does not touch the user's normal Foundry worlds, systems, or configuration.
- [x] Pass 59 targeted Foundry v14 Playwright regressions covering creation, point-buy, ability rolls, death rules, Harvest Golem, racial progression, repertoire, firearms, technology, Hero Points, and shouts.
- [x] Complete the full 762-test Foundry v14 Playwright suite and repair runtime/API/UI regressions: 753 applicable tests passed, 9 v13-only cases skipped as expected, and 0 failed in the isolated local test environment.
- [ ] Test fresh installation and update installation in a real Foundry v14 instance.
- [x] Publish v3.3.0 after the complete local Foundry v14 validation pass.

## Phase 11 - Complete bestiary conversion (final implementation phase)

**Recommended mode:** Mixed; Ultra for pipeline/reusable rules, High for bulk records.

- [x] Build a repeatable Monster Guide extraction, generation, and validation pipeline.
- [x] Convert all 152 actor/statblock entries in source order with stable IDs and page provenance.
- [x] Validate HP, HD pools, AC, saves, BAB, grapple, initiative, attacks, damage, criticals, skills, senses, speed, CR, advancement, embedded IDs, and index references.
- [x] Represent mixed Hit Die pools independently while preserving exact printed HP and derived totals.
- [x] Create separate attack, full-attack, feat, special-attack, special-quality, spell, and SLA records.
- [x] Implement reusable creature types/profiles, construct and undead rules, corrupted/elite/fel templates, common defenses, natural/full attacks, ranged touch attacks, and critical multipliers.
- [x] Populate all five printed spellcasters with Warcraft repertoire spellbooks, exact caster level/DC/slots, and sourced spell preferences.
- [x] Populate all 24 SLA users with executable spell clones where the core spell exists and charged, sourced manual records where a supplement-only power is unavailable.
- [x] Add concise tactics, environment, organization, treasure, advancement, and construction details where the source supplies them.
- [x] Automate reliable common mechanics and mark unique situational/target-dependent abilities manual by design with source references.
- [x] Record source contradictions (including Onyxia/Nefarian caster-level discrepancies) in the errata ledger.
- [x] Exclude book artwork and wholesale prose from the distributable data.
- [ ] Exhaustive automation for every unique monster power and tactical AI. **Deferred:** source-aware manual records are the safe supported boundary.
- [ ] Live Foundry v14 import, sheet, attack, full-attack, spell/SLA, condition, and token regression pass.

## Remaining completion gates

These are the only gates preventing a fully verified release:

- [x] Complete the full authored Foundry v14 Playwright suite without regressions (753 applicable passed, 9 v13-only skipped, 0 failed).
- [ ] Perform fresh-install and update-install checks from the GitHub manifest.
- [ ] Perform a brief human visual/usability pass in Foundry.
- [x] Publish and verify the user-authorized v3.3.0 GitHub release.

## Deferred or optional scope

- Community-as-character rules.
- Exhaustive automatic affiliation situational math.
- Aging, height, and weight generators.
- Automatic narrative Hero Point outcomes.
- Full vehicle combat simulator.
- Exhaustive monster tactical AI or automation that requires guessing target context.
- Book spell/feat icons unless redistribution permission is confirmed or releases remain private.

## Phase log

| Date | Phase | Change | Validation | Release |
| --- | --- | --- | --- | --- |
| 2026-08-12 | Foundation | Warcraft identity, release pipeline, initial rule frameworks, and detailed Harvest Golem reference. | 209 Jest tests; GitHub Linux release build; manifest/ZIP checked. | 3.1.2 |
| 2026-08-12 | Sol High bulk pass | Ten races, nine base classes, ten prestige classes, initial spell/feat/equipment catalogues, four materials, ten journals, provenance and deterministic generators. | 228 Jest tests; 7 Warcraft packs/966 top-level records; 46 packs rebuilt. | Not released |
| 2026-08-12 | Sol Ultra implementation | Completed core death/healing/migrations, racial levels, six paths, prestige prerequisites/advancement, repertoire/slot lifecycle, feat/Hero/shout systems, firearms/explosives, technology, guided creation, and final 152-entry bestiary with monster magic. Corrected spell extraction to 342 spells/504 assignments including all cantrips. | 353/353 Jest tests; 8 Warcraft packs/1,239 top-level records; all 47 packs rebuilt and 22,164 LevelDB keys byte-verified; localization, syntax, JSON, and release archive (4,643 entries, no PDFs/source/tests) passed. Foundry v14 e2e deferred by user/environment. | Not released |
| 2026-08-13 | Foundry v14 remediation and rules-text completion | Restored builder, point-buy, actor-roll, progression, spellcasting, combat, equipment, and bestiary runtime paths; completed usable rules text for all 141 feats and 342 spells with explicit automation boundaries. | 420/420 Jest tests plus 66/66 Foundry-v14 dice integration tests; full Foundry v14 suite: 753 applicable passed, 9 v13-only skipped, 0 failed; all 47 packs/22,164 LevelDB keys synchronized; zero feat/spell handbook-only placeholders. | 3.3.0 |
