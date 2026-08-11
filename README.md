# Warcraft RPG 2e for Foundry VTT

Private-use adaptation of *World of Warcraft: The Roleplaying Game, Second Edition*, built on the D35E Foundry VTT engine. Foundry VTT v14 is primary; v13 support is best-effort.

This repository is not a public Warcraft content distribution. Keep supplied rulebooks, extracted pages, and book artwork local.

## Current vertical slice

- Warcraft labels for the six abilities and the revised skill list
- Faith, affiliation, affiliation rating, and Hero Point actor fields
- Warcraft living, Forsaken, and construct death/recovery rules
- Parent-class path progression, currently Arcanist -> Mage
- Warcraft repertoire preparation with shared spell-level slots
- Private compendiums for:
  - Human and Forsaken
  - Warrior and Arcanist/Mage
  - Five starter spells and their effects
  - Ten starter equipment records
  - Five starter monsters

Legacy D35E compendiums remain available while Warcraft content is converted and verified. Complex monster abilities, firearm malfunction/reloading, Mage bonus path slots, and some spell effects are descriptive/manual in this slice.

## Local development

```powershell
npm install --ignore-scripts
npm run sources:repack
npm test -- --runInBand
npm run dev:setup
npm run dev:start
```

The permanent Foundry system id and data-directory name are `warcraftrpg2e`.

Foundry UI/e2e tests require a local Foundry v14 installation and license. Run `npm run e2e:setup` before Playwright when that runtime is available.

## Source policy

Warcraft records use concise paraphrases and generic/system icons. Each imported record carries book/page provenance under `flags.warcraftrpg2e.source`. Source conflicts and current rulings are tracked in [`docs/ERRATA.md`](docs/ERRATA.md).

The underlying software remains governed by its existing repository license. Warcraft setting names and other Product Identity are intended only for this private adaptation; review licensing before any redistribution.
