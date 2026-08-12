# Warcraft RPG 2e for Foundry VTT

Private-use adaptation of *World of Warcraft: The Roleplaying Game, Second Edition*, built on the D35E Foundry VTT engine. Foundry VTT v14 is primary; v13 support is best-effort.

This repository is not a public Warcraft content distribution. Keep supplied rulebooks, extracted pages, and book artwork local.

## Current conversion state

- Warcraft labels for the six abilities and the revised skill list
- Faith, affiliation, affiliation rating, and Hero Point actor fields
- Warcraft living, Forsaken, undead, and construct death/recovery rules
- Parent-class path progression for all six Arcanist and Healer paths
- Warcraft repertoire preparation, shared slots, and path/domain restrictions
- Feat prerequisites, Hero Points, shouts, firearms, explosives, technology, and guided character creation
- Private compendiums for:
  - all ten core races and available racial progressions
  - nine base classes, six spellcasting paths, and ten prestige classes
  - the complete core spell and feat catalogues
  - the complete core equipment tables and four special materials
  - all 152 Monster Guide statblock columns plus reusable creature rules

Legacy D35E compendiums remain available for unchanged 3.5 rules. Situational effects that Foundry cannot determine safely remain explicitly GM-adjudicated; the detailed boundary is tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Local development

```powershell
npm install --ignore-scripts
npm run sources:repack
npm run sources:verify
npm test -- --runInBand
npm run dev:setup
npm run dev:start
```

Rebuild committed Warcraft source JSON and compiled packs without opening the private books:

```powershell
npm run warcraft:build
```

`warcraft:build` regenerates from the committed review catalogues, validates the Warcraft records, repacks every declared compendium, then verifies every LevelDB key against `source/`. To check existing packs without rebuilding them, run `npm run sources:verify`; it fails on a missing, stale, or extra key.

Build an installable release archive with the same deterministic pipeline:

```powershell
npm run build:release -- --name warcraftrpg2e-v3.2.0.zip
```

This release command uses committed catalogues and source data only. It never invokes PDF extraction.

Refreshing the extracted catalogues additionally requires the two private PDFs at their documented `docs/` paths and Python dependencies:

```powershell
python -m pip install -r scripts/warcraft-content/requirements.txt
npm run warcraft:refresh
```

The PDFs stay ignored by Git and are never included in a release archive.

The permanent Foundry system id and data-directory name are `warcraftrpg2e`.

Foundry UI/e2e tests require a local Foundry v14 installation and license. Run `npm run e2e:setup` before Playwright when that runtime is available.

## Source policy

Warcraft records use concise paraphrases and generic/system icons. Each imported record carries book/page provenance under `flags.warcraftrpg2e.source`. Source conflicts and current rulings are tracked in [`docs/ERRATA.md`](docs/ERRATA.md).

The underlying software remains governed by its existing repository license. Warcraft setting names and other Product Identity are intended only for this private adaptation; review licensing before any redistribution.
