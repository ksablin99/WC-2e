Query a D35E LevelDB pack for documents matching name, type, or field filters.

Usage: /query-pack <args>

Where <args> are passed directly to `npm run sources:query --`. Examples:
  /query-pack -- --pack feats --name dodge
  /query-pack -- --pack bestiary --name aboleth --full
  /query-pack -- --pack spells --type spell --field system.level=3
  /query-pack -- --pack ./packs/class-abilities --field system.school=abj --full

Steps:
1. Run `npm run sources:query -- $ARGUMENTS` in the repo root
2. Print the output — each line is a document ID (or full JSON if --full was passed)
3. The final stderr line shows the match count and pack path

Pack name resolution order:
  1. Literal path (if it contains / or \)
  2. `packs/<name>` directory relative to repo root
  3. `name` field in system.json packs array

Flags:
  --pack <name|path>   Pack to query (required)
  --name <substr>      Case-insensitive partial match on document name
  --type <type>        Exact match on document type (case-insensitive)
  --field <key=value>  Dot-path field filter, repeatable
  --full               Print full JSON instead of just IDs
