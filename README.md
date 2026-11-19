# Georgios' Nemesis

A Foundry VTT module that keeps a [Georgios' Map Maker](../georgios-map-maker) world alive between sessions: named people with memory and motives, and factions with their courts and chains of command. GM only.

This is Phase 0, the foundations:

- Six record types (person, faction, army, town state, event, rumor) as JSON Schemas. Every write is checked against its schema, the world rules and the references between records, all or nothing.
- An import that makes a faction and a ruler for every living realm and a record for every living town of a Map Maker world, plus seeds that lay what the table established over them.
- The nemesis board in Foundry: one tab per faction with its court, chain of command and people of note, each person's memory of the party, and the people who stand outside every faction.

The generator, portraits, after-session step, endings and world turns come in later phases.

## How it fits together

```
Foundry: georgios-nemesis module ──api.rpc──> Georgios' Map Maker module ──HTTP──> Map Maker companion
                                                                                       └─ loads this repo's companion/src/plugin.ts
                                                                                          (every "nemesis.*" method)
```

- Nemesis has no companion of its own. Map Maker's companion loads `companion/src/plugin.ts` when it starts, from `../georgios-nemesis` beside its own folder, or from the paths in `GMM_PLUGINS` (separated by `;`). Restart the companion after changing this code.
- The Foundry module calls the companion through Map Maker's `api.rpc`, so it uses Map Maker's token and its Start offer.
- Records live beside the world's Map Maker files: `georgios-map-maker/data/worlds/<world>/nemesis/`. Map Maker stays the owner of geography and history; records point at its state and town ids.

## Layout

| Path | What |
| --- | --- |
| `companion/src/schema.ts` | The six schemas and the validator |
| `companion/src/rules.ts` | World rules: the HP ladder, dynamic-only mages, Sphere size caps |
| `companion/src/store.ts` | Records on disk, validated writes |
| `companion/src/import.ts` | Records from a Map Maker world; seeds |
| `companion/src/board.ts` | The board the GM sees |
| `companion/src/service.ts`, `plugin.ts` | The `nemesis.*` methods |
| `companion/src/cli/import.ts` | The import command |
| `module/` | The Foundry module (id `georgios-nemesis`) |

## Use

1. Install the module: copy `module/` to `<Foundry Data>/modules/georgios-nemesis/` and enable **Georgios' Nemesis** in the world (it needs Georgios' Map Maker).
2. Make the records (once per world; again later adds only what is missing):

   ```
   npm run import -- --in "<Azgaar full JSON>" --world ogeia-1183 --seed ../georgios-map-maker/data/worlds/ogeia-1183/nemesis-seeds/session-1.json
   ```

   Each seed applies once, so the GM's later edits survive a second run. Keep seeds in Map Maker's `data/` folder, which git ignores: they hold the GM's secrets.
3. Restart the Map Maker companion, reload Foundry, and press the crown in the Georgios' Modules toolbar group.

## Develop

```
npm install
npm test
npm run typecheck
```
