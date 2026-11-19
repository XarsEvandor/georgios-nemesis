# Georgios' Nemesis

A Foundry VTT module that keeps a world alive between sessions: named people with memory and motives, and factions with their courts and chains of command. GM only.

It runs on its own, and works with the other Georgios modules when they are there:

| With | What changes |
| --- | --- |
| Nothing else | Import the realms and towns straight from an Azgaar export. The board names its own towns. |
| Georgios' Map Maker | Import Map Maker's world instead: a thousand years of history, its prose, and the rulers from the GM's lore. The board links Map Maker's realm and town journals. |
| Georgios Scribbler | Each person links the entry the Scribbler keeps of them. |
| Georgios' launcher | The board's Start button starts the Nemesis companion when it is not running. |

No module needs another's code. Nemesis reads Map Maker's world files (`georgios-map-maker/data/worlds/<id>/`) and finds the other modules' journals in Foundry by their flags.

This is Phase 0, the foundations:

- Six record types (person, faction, army, town state, event, rumor) as JSON Schemas. Every write is checked against its schema, the world rules and the references between records, all or nothing.
- The import: a faction for every living realm, a ruler where the lore names one, a record for every living town, and seeds that lay what the table established over them.
- The nemesis board: one tab per faction with its court, chain of command and people of note, each person's memory of the party, and the people who stand outside every faction.

The generator, portraits, after-session step, endings and world turns come in later phases.

## How it fits together

```
Foundry: georgios-nemesis module ──HTTP──> Nemesis companion (127.0.0.1:47120)
                                              ├─ data/worlds/<id>/   records, atlas.json, seeds/
                                              └─ reads ../georgios-map-maker/data/worlds/<id>/ on import, when it is there
```

The companion listens on this PC only, accepts only its own host names, and answers browser requests only from the origins in `data/config.json` (default `http://localhost:30000` and `http://127.0.0.1:30000`). Add your Foundry address there if you reach Foundry another way:

```json
{ "origins": ["http://localhost:30000", "http://127.0.0.1:30000"] }
```

## Use

1. Install the module: copy `module/` to `<Foundry Data>/modules/georgios-nemesis/` and enable **Georgios' Nemesis** in the world.
2. Make the records (once per world; again later adds only what is missing):

   ```
   npm run import -- --world ogeia-1183 --in "<Azgaar full JSON>"
   ```

   With a Map Maker world of that id beside this repo, the import reads it (`--mapmaker <folder>` points elsewhere, `--from azgaar` skips it). Without one, the Azgaar export alone gives the realms and towns, and `--lore <file>` may add the rulers.
   Seeds go in `data/worlds/<id>/seeds/*.json` (or `--seed <file>`). Each applies once, so the GM's later edits survive. `data/` is git-ignored: seeds hold the GM's secrets.
3. Start the companion: `npm run serve`, or the board's Start button through Georgios' launcher (its `config.json` needs a `nemesis` service). Then press the crown in the Georgios' Modules toolbar group.

## Layout

| Path | What |
| --- | --- |
| `companion/src/schema.ts` | The six schemas and the validator |
| `companion/src/rules.ts` | World rules: the HP ladder, dynamic-only mages, Sphere size caps |
| `companion/src/store.ts` | Records on disk, validated writes |
| `companion/src/world.ts` | World sources: a Map Maker world, an Azgaar export; the atlas |
| `companion/src/import.ts` | Records from a world; seeds |
| `companion/src/board.ts` | The board the GM sees |
| `companion/src/service.ts`, `server.ts` | The companion and its `nemesis.*` methods |
| `companion/src/cli/` | `serve` and `import` |
| `module/` | The Foundry module (id `georgios-nemesis`) |

## Develop

```
npm install
npm test
npm run typecheck
```
