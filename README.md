# Georgios' Nemesis

A Foundry VTT module that keeps a world alive between sessions: named people with memory and motives, and factions with their courts and chains of command. GM only.

It runs on its own, and works with the other Georgios modules when they are there:

| With | What changes |
| --- | --- |
| Nothing else | Import the realms and towns straight from an Azgaar export. The board names its own towns. |
| Georgios' Map Maker | Import Map Maker's world instead: a thousand years of history, its prose, and the rulers from the GM's lore. The board links Map Maker's realm and town journals. Map Maker's placeholder townsfolk are recast from the town's culture when you open one of its places. |
| Georgios Scribbler | Each person links the entry the Scribbler keeps of them. |
| Georgios' launcher | The board's Start button starts the Nemesis companion when it is not running. |

No module needs another's code. Nemesis reads Map Maker's world files (`georgios-map-maker/data/worlds/<id>/`) and finds the other modules' journals in Foundry by their flags.

What it does so far:

- **Records.** Six record types (person, faction, army, town state, event, rumor) as JSON Schemas. Every write is checked against its schema, the world rules and the references between records, all or nothing.
- **Import.** A faction for every living realm, a ruler where the lore names one, a record for every living town, and seeds that lay what the table established over them.
- **The board.** One tab per faction with its court, chain of command and people of note, each person's memory of the party, and the people who stand outside every faction.
- **The generator.** Generate on a faction's tab makes a new person of a rank you pick: roll-table seeds (if `data/tables/*.json` holds any), Claude writes the card (species from the culture's folk, looks, wants, Spheres and tricks), the companion checks it and sends any broken rule back to Claude, and the balance table (`companion/src/balance.ts`) gives the numbers. Foundry gets a dnd5e actor with a token by species and a GM journal page.
- **Portraits.** With [artgen](../artgen) beside this repo, each new person is painted in the background. Both the repaint and the layout are kept; pick one on the board, and the actor and its ringed token follow.
- **The scene cast** (with Map Maker). When the GM opens a place Map Maker built, its placeholder townsfolk are recast: card, then token, then art. Everyone gets a name, species, look, manner, a token by species and a stat block from the rank ladder from the world's folk book, with no Claude call, and the same people come back on every visit. The keeper of the place (the keeper the place is named for, else one or two keepers) is written by Claude in full, kept on record by place and role, and painted. The Nemesis button on a townsperson's token HUD writes up anyone else. Turn it off in the module settings to keep Map Maker's placeholders.
- **The folk book** (`data/worlds/<id>/folk.json`). Claude writes each culture's townsfolk once from the GM's lore: species and their shares (humans about one in twenty), a token figure each, anatomy, a namebook and looks, and the culture's manners. The companion writes a missing culture by itself the first time it is needed; `npm run folk -- --world <id>` does it ahead of time (`--rebuild`, `--culture <name>` to redo one). Edit the file freely.

After-session, endings and world turns come in later phases.

## How it fits together

```
Foundry: georgios-nemesis module ──HTTP──> Nemesis companion (127.0.0.1:47120)
                                              ├─ data/worlds/<id>/   records, atlas.json, seeds/
                                              └─ reads ../georgios-map-maker/data/worlds/<id>/ on import, when it is there
```

The companion listens on this PC only, accepts only its own host names, and answers browser requests only from the origins in `data/config.json` (default `http://localhost:30000` and `http://127.0.0.1:30000`). Every key is optional:

```json
{
  "origins": ["http://localhost:30000", "http://127.0.0.1:30000"],
  "model": "opus",
  "artgen": "../artgen",
  "launcher": "http://127.0.0.1:47100"
}
```

Claude runs through your Claude Code (the binary bundled with the VS Code extension, or `NEMESIS_CLAUDE`) on your subscription, with no tools and none of your Claude Code settings. Without Claude Code the board still works; Generate is off. Without artgen, people keep their species token.

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
| `companion/src/balance.ts` | The balance table: what each rank brings to a fight |
| `companion/src/card.ts`, `generate.ts` | What Claude writes, the prompt, the checks and retries |
| `companion/src/actor.ts`, `tokens.ts` | dnd5e actor data; a first token by species; the townsfolk token library |
| `companion/src/folk.ts`, `cast.ts` | The folk book; the scene cast (who is a main person, the same people each visit) |
| `companion/src/claude.ts`, `art.ts`, `portraits.ts` | Claude Code and artgen runners; the portrait queue |
| `companion/src/service.ts`, `server.ts` | The companion and its `nemesis.*` methods |
| `companion/src/cli/` | `serve`, `import` and `folk` |
| `module/` | The Foundry module (id `georgios-nemesis`) |

## Develop

```
npm install
npm test
npm run typecheck
```
