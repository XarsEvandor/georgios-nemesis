import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kitFor } from "../src/balance";
import { buildBoard } from "../src/board";
import { cardProblems, type Card } from "../src/card";
import { castScene, knownNames, mainIndexes, placeName, rankOfKind, roleAt, roleKey } from "../src/cast";
import type { ClaudeRunner, StructuredRequest } from "../src/claude";
import { folkActorData, folkHp, folkProblems, pickFolk, writeCulture, type FolkCulture } from "../src/folk";
import { NemesisService } from "../src/service";
import { writeSketch } from "../src/sketch";
import { NemesisStore } from "../src/store";
import { FOLK_TOKENS } from "../src/tokens";

const names = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`);

function species(name: string, weight: number, token: string) {
  return { name, weight, token, anatomy: `${name} anatomy`, given: names(name.slice(0, 3), 24), family: names("Hol", 8), looks: ["a", "b", "c", "d", "e", "f"].map((x) => `${name} look ${x}`) };
}

const YOTUNN: FolkCulture = {
  species: [species("minotaur", 40, "monstrosity/Minotaur"), species("lizardfolk", 30, "humanoid/Lizardfolk"), species("troll", 25, "giant/Troll"), species("human", 5, "humanoid/Commoner")],
  manners: Array.from({ length: 12 }, (_, i) => `manner ${i}`),
};

function villagerCard(over: Partial<Card> = {}): Card {
  return {
    name: "Claude Picked This", species: "lizardfolk", look: "A grey-scaled lizardfolk with ink-stained claws.", role: "alchemist", personality: "Careful.",
    wants: ["a quiet shop"], fears: ["the watch"], beliefs: ["Salt keeps"], worldview: "Everything dissolves in the right water.", toughness: "average",
    spheres: [{ sphere: "Matter", rating: 2 }],
    tricks: [{ name: "Sudden Brine", sphere: "Matter", size: "Personal", text: "Her scales sweat brine.", vsMages: "Personal: it changes her, not them." }],
    attacks: [{ name: "Pestle", kind: "melee", damageType: "bludgeoning", text: "A heavy stone pestle." }],
    powers: [], resistances: [], combatStyle: "Throws flasks.", strength: "Knows every poison.", weakness: "Slow on land.",
    art: "A grey-scaled lizardfolk alchemist behind a cluttered counter, glass vials, green light.",
    notes: {
      paradigm: { summary: "Salt and water", tools: "Flasks", signs: "A brine smell", limits: "Only what dissolves" },
      spheres: [{ sphere: "Matter", uses: ["(Personal) Harden her scales", "(Personal) Turn a coin to salt"] }],
      mind: { priorities: "Shop", decisions: "Slowly", knows: "Little", underlings: "One apprentice" },
      tactics: { opening: "Flask", pressure: "Pestle", hurt: "Flees", retreat: "Back door", combo: "Brine then pestle", vsMages: "Breaks the floor jars", terrain: "Her shop", building: "Never" },
      roleplay: { voice: "Hissing", mannerisms: "Licks her eye", lines: ["Buying?", "Not that one.", "Out."], threats: "Calls the watch", bribes: "Takes them", flattery: "Likes it", mercy: "Remembers", secret: "Sells to smugglers" },
    },
    ...over,
  };
}

class FakeClaude implements ClaudeRunner {
  readonly calls: StructuredRequest[] = [];
  constructor(private readonly answers: unknown[]) {}
  async structured(req: StructuredRequest) {
    this.calls.push(req);
    return structuredClone(this.answers[Math.min(this.calls.length - 1, this.answers.length - 1)]);
  }
}

async function world(o: { folk?: boolean } = {}) {
  const data = await mkdtemp(join(tmpdir(), "nemesis-cast-"));
  const dir = join(data, "worlds", "testland");
  const s = await NemesisStore.open(dir, "testland");
  await s.putMany([
    { kind: "factions", record: { id: "march", name: "Kingdom of March", kind: "realm", state: 2, culture: "Yotunn", capital: 140, ruler: "king-dimitrios-vi" } },
    { kind: "persons", record: { id: "king-dimitrios-vi", name: "King Dimitrios VI", rank: "monarch", faction: "march", home: 140, state: "alive" } },
    { kind: "towns", record: { id: "town-119", town: 119, owner: "march" } },
  ]);
  await s.saveMeta({ title: "Testland" });
  await writeFile(join(dir, "atlas.json"), JSON.stringify({ source: "map-maker", realms: [{ id: 2, name: "Kingdom of March" }], towns: [{ id: 140, name: "Zugkatil", state: 2 }, { id: 119, name: "Narkoc", state: 2 }] }));
  await writeFile(join(dir, "lore.json"), JSON.stringify({ cultures: { Yotunn: { way: "the hard country", folk: ["minotaurs", "lizardfolk", "trolls"] } }, humans: "Humans are rare." }));
  if (o.folk !== false) await writeFile(join(dir, "folk.json"), JSON.stringify({ cultures: { Yotunn: YOTUNN } }));
  return { data, dir, s };
}

const SHOP = [
  { kind: "mage", role: "alchemist", seed: "Ursula, alchemist" },
  { kind: "commoner", role: "dockworker", seed: "Tancred, dockworker" },
  { kind: "commoner", role: "dockworker", seed: "Rosamund, dockworker" },
];

describe("folk book", () => {
  it("picks the same townsperson for the same seed, in the culture's proportions", () => {
    expect(pickFolk(YOTUNN, "narkoc:alchemist|Ursula")).toEqual(pickFolk(YOTUNN, "narkoc:alchemist|Ursula"));
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const p = pickFolk(YOTUNN, `seed-${i}`);
      counts.set(p.species, (counts.get(p.species) ?? 0) + 1);
      expect(p.token).toMatch(/^systems\/dnd5e\/tokens\/.+\.webp$/);
      expect(p.name).toMatch(/^\S+ \S+$/);
    }
    expect(counts.get("minotaur")! / 4000).toBeGreaterThan(0.35);
    expect(counts.get("human")! / 4000).toBeLessThan(0.08);
  });

  it("names what a culture's folk breaks", () => {
    expect(folkProblems(YOTUNN, { humans: true })).toEqual([]);
    const bad: FolkCulture = { species: [{ ...species("minotaur", 60, "monstrosity/Cow"), given: ["Ana", "Ana"] }, species("troll", 30, "giant/Troll")], manners: ["one"] };
    expect(folkProblems(bad, { humans: true })).toEqual([
      "give 3 to 12 species (got 2)",
      "weights must add up to 100 (got 90)",
      'minotaur: token "monstrosity/Cow" is not in the list',
      "minotaur: give at least 20 different given names (got 1)",
      'list "human" with weight about 5 (humans are about one in twenty)',
      "give at least 8 manners",
    ]);
  });

  it("asks Claude again when its folk break the rules, and tidies the answer", async () => {
    const noHumans = { ...YOTUNN, species: [species("minotaur", 50, "monstrosity/Minotaur"), species("lizardfolk", 30, "humanoid/Lizardfolk"), species("troll", 20, "giant/Troll")] };
    const claude = new FakeClaude([noHumans, { ...YOTUNN, species: YOTUNN.species.map((s) => ({ ...s, name: ` ${s.name.toUpperCase()} ` })) }]);
    const c = await writeCulture({ claude, culture: "Yotunn", lore: { cultures: { Yotunn: { way: "the hard country", folk: ["minotaurs"] } } }, townNames: ["Narkoc", "Zugkatil"] });
    expect(claude.calls).toHaveLength(2);
    expect(claude.calls[0]!.prompt).toContain("Zugkatil");
    expect(claude.calls[1]!.prompt).toContain('list "human" with weight about 5');
    expect(c.species.map((s) => s.name)).toEqual(["minotaur", "lizardfolk", "troll", "human"]);
  });

  it("gives background folk a shared, unlinked actor on the rank ladder (villager 400)", () => {
    const a = folkActorData({ world: "testland", culture: "Yotunn", species: YOTUNN.species[0]!, rank: "villager" });
    expect(a.system.attributes.hp.max).toBe(400);
    expect(a.system.attributes.ac.flat).toBe(kitFor("villager").ac);
    expect(a.prototypeToken.actorLink).toBe(false);
    expect(a.prototypeToken.texture.src).toBe("systems/dnd5e/tokens/monstrosity/Minotaur.webp");
    expect(a.flags["georgios-nemesis"].folk).toBe("yotunn-minotaur-villager");
    expect(a.items.some((i: any) => i.name === "Dynamic Magic")).toBe(false);
    expect(folkHp("soldier")).toBe(1150);
  });

  it("lists only token figures dnd5e ships (when Foundry's data folder is on this PC)", () => {
    const root = join(process.env.LOCALAPPDATA ?? "", "FoundryVTT", "Data", "systems", "dnd5e", "tokens");
    if (!existsSync(root)) return;
    expect(FOLK_TOKENS.filter((k) => !existsSync(join(root, `${k}.webp`)))).toEqual([]);
  });
});

describe("scene cast", () => {
  it("makes the keeper the place is named for its main person, or one or two keepers, else nobody", () => {
    expect(mainIndexes(SHOP, "Narkoc: Alchemist")).toEqual([0]);
    expect(mainIndexes([{ role: "patron" }, { role: "barkeep" }, { role: "cook" }], "The Drowned Ox")).toEqual([1]);
    expect(mainIndexes([{ role: "baker" }, { role: "butcher" }, { role: "cobbler" }, { role: "shopper" }], "Market street")).toEqual([]);
    expect(mainIndexes([{ role: "wizard, asleep" }], "Tower")).toEqual([0]);
    expect(roleKey("Lord of the house, asleep")).toBe("lord of the house");
    // Map Maker's scene names carry the town and the asset pack; "patron of" would read as the owner.
    expect(placeName("Chadonvel: Tavern by the gate (Mansion Furniture)", "Chadonvel")).toBe("Tavern by the gate");
    expect(placeName(undefined)).toBeUndefined();
    expect(roleAt("barkeep", "Tavern by the gate")).toBe("the barkeep of the Tavern by the gate");
    expect(roleAt("patron", "The Drowned Ox")).toBe("a patron at the Drowned Ox (not one of its keepers)");
    expect(roleAt("wizard, asleep", undefined)).toBe("the wizard, asleep");
    expect([rankOfKind("commoner"), rankOfKind("guard"), rankOfKind("knight"), rankOfKind(undefined)]).toEqual(["villager", "soldier", "veteran", "villager"]);
  });

  it("casts the same people each time and finds a written keeper by their place", () => {
    const o = { culture: "Yotunn", folk: YOTUNN, town: 119, place: "city1:alchemist", scene: "Alchemist", people: SHOP, persons: [] };
    const a = castScene(o);
    expect(castScene(o)).toEqual(a);
    expect(a.map((p) => [p.role, p.main, p.post.n, p.rank])).toEqual([["alchemist", true, 0, "soldier"], ["dockworker", false, 0, "villager"], ["dockworker", false, 1, "villager"]]);
    expect(a[0]!.actorKey).toBe(`yotunn-${a[0]!.folk.species}-soldier`);
    const keeper = { id: "ixa-hol", name: "Ixa Hol", state: "alive", post: { town: 119, place: "city1:alchemist", role: "alchemist", n: 0 } };
    const b = castScene({ ...o, persons: [keeper] });
    expect(b[0]!.person?.id).toBe("ixa-hol");
    expect(b[1]!.person).toBeUndefined();
    expect(castScene({ ...o, persons: [{ ...keeper, state: "dead" }] })[0]!.person).toBeUndefined();
  });

  it("never recasts a token the table knows or the GM renamed, and does not write it up as the keeper", () => {
    const people = [
      { kind: "commoner", role: "barkeep", seed: "Alys, barkeep", given: "Alys" },
      { kind: "commoner", role: "patron", seed: "Bob the Brave", renamed: true },
      { kind: "commoner", role: "patron", seed: "Hugh, patron", given: "Hugh" },
    ];
    const persons = [
      { id: "alice", name: "Alice", aliases: ["Alys"], state: "alive" },
      { id: "galauche-greymane", name: "Galauche Greymane", state: "alive", post: { town: 34, place: "x", role: "barkeep", n: 0 } },
      { id: "king-dimitrios-vi", name: "King Dimitrios VI", state: "alive" },
    ];
    const known = knownNames(persons, ["Drogo", "the dockworker"]);
    expect([...known].sort()).toEqual(["alice", "alys", "drogo", "galauche greymane", "king", "king dimitrios vi", "the dockworker"]);
    const cast = castScene({ culture: "Yotunn", folk: YOTUNN, town: 119, place: "tavern", scene: "Tavern", people, persons, known });
    expect(cast.map((p) => [p.skip, p.main])).toEqual([["known", false], ["renamed", false], [undefined, false]]);
  });

  it("gives no two people in a scene the same look or name while the species has more", () => {
    const one: FolkCulture = { species: [{ ...species("harpy", 100, "monstrosity/Harpy"), given: names("Ka", 24), family: ["Crag"] }], manners: YOTUNN.manners };
    const crowd = Array.from({ length: 6 }, (_, i) => ({ kind: "commoner", role: "patron", seed: `p${i}` }));
    const cast = castScene({ culture: "Luarian", folk: one, town: 1, place: "tavern", scene: "Tavern", people: crowd, persons: [] });
    expect(new Set(cast.map((p) => p.folk.look)).size).toBe(6);
    expect(new Set(cast.map((p) => p.folk.name)).size).toBe(6);
    expect(castScene({ culture: "Luarian", folk: one, town: 1, place: "tavern", scene: "Tavern", people: crowd, persons: [] })).toEqual(cast);
  });
});

const SKETCH = {
  look: " A grey-scaled lizardfolk, six feet of her, ink to the wrist. ",
  mannerisms: "Licks one eye; taps the counter twice before every price.",
  voice: "Hissing and slow, calls everyone 'warm-blood'.",
  lines: ["Buying, warm-blood?", "Not that one.", "Out.", "Fourth line"],
};

describe("sketch", () => {
  it("writes a quick sketch from the species' body and the place, tidied, and refuses one without a look", async () => {
    const claude = new FakeClaude([SKETCH]);
    const s = await writeSketch({ claude, model: "sonnet", input: { name: "Ixa Holvane", species: "lizardfolk", anatomy: "Upright reptile, pebbled scales", role: "alchemist", scene: "Narkoc: Alchemist", town: "Narkoc", faction: "Kingdom of March", culture: "Yotunn", way: "the hard country" } });
    expect(s.look).toBe("A grey-scaled lizardfolk, six feet of her, ink to the wrist.");
    expect(s.lines).toHaveLength(3);
    expect(claude.calls[0]!.model).toBe("sonnet");
    expect(claude.calls[0]!.prompt).toContain("Upright reptile, pebbled scales");
    expect(claude.calls[0]!.prompt).toContain("They are the alchemist of the Alchemist in Narkoc");
    await expect(writeSketch({ claude: new FakeClaude([{ ...SKETCH, look: " " }]), input: { name: "X", species: "troll", role: "baker" } })).rejects.toThrow(/without a look/);
  });

  it("puts both portraits at the top of the card, marks the one on the token, and stays empty without art", async () => {
    // @ts-expect-error plain JS module without types
    const { artHtml, journalHtml } = await import("../../module/scripts/board-html.js");
    const t = (k: string) => k;
    const html = artHtml({ name: "Ixa", art: { final: "f.png", layout: "l.png", picked: "layout" } }, t);
    expect(html.match(/<figure class="gn-card-art">/g)).toHaveLength(2);
    expect(html).toContain('<img src="f.png"');
    expect(html).toMatch(/Card\.layout <em>Card\.OnActor<\/em>/);
    expect(html).not.toMatch(/Card\.final <em>/);
    expect(html.match(/gn-show-players/g)).toHaveLength(2);
    expect(artHtml({ name: "Ixa" }, t)).toBe('<div class="gn-art"></div>');
    expect(journalHtml({ name: "Ixa", art: { final: "f.png" } }, t).startsWith('<div class="gn-art"><figure')).toBe(true);
  });
});

describe("write-up of someone on record", () => {
  const ALICE = {
    id: "alice", name: "Alice", aliases: ["Alys"], species: "scaled folk", look: "Scaled skin, a tail and sharp fangs", rank: "villager", role: "Fisherman of Narkoc",
    faction: "march", home: 119, facts: ["Fishes all night and heads home to eat around noon"], wants: ["To book Blake's cup trick for a birthday party"],
    relationships: [{ kind: "spouse", with: "drogo" }], commitments: [{ kind: "promise", text: "Lets the party sleep on the floor", from: "Alice" }],
    memory: [{ when: "session 1", text: "Found the party at Narkoc's docks" }], feelings: [{ toward: "the party", feeling: "Kind and amazed" }],
    state: "alive", links: { scribbler: ["Alice"] }, source: "seed",
  };

  it("writes the full card, keeping everything the table established, and the companion hands back the actor", async () => {
    const { data, s } = await world();
    await s.putMany([{ kind: "persons", record: { id: "drogo", name: "Drogo", rank: "villager", faction: "march", home: 119, state: "alive" } }, { kind: "persons", record: ALICE }]);
    const claude = new FakeClaude([villagerCard({ name: "Somebody Else", species: "lizardfolk", wants: ["A bigger boat"], role: "fisher" })]);
    const svc = new NemesisService(data, { claude, model: "opus" });
    const { person, actor } = (await svc.call("nemesis.writeup", { world: "testland", id: "alice" })) as any;
    const prompt = claude.calls[0]!.prompt;
    for (const bit of ["Write the full card of Alice, a villager of the Kingdom of March whom the table has already met.", "- Species, as the table heard it: scaled folk.", "- How they look (keep every detail; you may add more): Scaled skin, a tail and sharp fangs", "spouse of Drogo", "session 1: Found the party at Narkoc's docks", "promise: Lets the party sleep on the floor"]) expect(prompt).toContain(bit);
    expect([person.name, person.species, person.role, person.source]).toEqual(["Alice", "lizardfolk", "Fisherman of Narkoc", "seed"]);
    expect(person.wants).toEqual(["To book Blake's cup trick for a birthday party", "A bigger boat"]);
    for (const k of ["facts", "relationships", "commitments", "memory", "feelings", "links", "aliases"]) expect(person[k]).toEqual((ALICE as any)[k]);
    expect(person.static.hp).toBeGreaterThanOrEqual(300);
    expect(person.notes.roleplay.lines).toHaveLength(3);
    expect(actor.name).toBe("Alice");
    expect(actor.prototypeToken.disposition).toBe(0);
    // A painted person: the portrait is the actor's picture; the map keeps the species token.
    const store = await NemesisStore.open(join(data, "worlds", "testland"), "testland");
    await store.put("persons", { ...store.get("persons", "alice")!, art: { final: "georgios-nemesis/x/alice-final.png", picked: "final" } });
    const painted = (await svc.call("nemesis.actor", { world: "testland", id: "alice" })) as any;
    expect(painted.img).toBe("georgios-nemesis/x/alice-final.png");
    expect(painted.prototypeToken.texture.src).toBe("systems/dnd5e/tokens/humanoid/Lizardfolk.webp");
    expect((await NemesisStore.open(join(data, "worlds", "testland"), "testland")).get("persons", "alice")!.static.ac).toBe(kitFor("villager").ac);
  });

  it("keeps fixed Spheres and a set HP, and leaves plot-locked people to the GM", async () => {
    const { data, s } = await world();
    await s.putMany([
      { kind: "persons", record: { ...ALICE, relationships: [], static: undefined, dynamic: { spheres: { Life: 2 } } } },
      { kind: "persons", record: { id: "dracula", name: "Dracula", rank: "unranked", state: "alive", flags: { plotLocked: true } } },
    ]);
    const claude = new FakeClaude([villagerCard({ spheres: [{ sphere: "Matter", rating: 2 }], tricks: [{ name: "Tide Skin", sphere: "Life", size: "Personal", text: "Gills open.", vsMages: "Personal." }], notes: { ...villagerCard().notes, spheres: [{ sphere: "Life", uses: ["(Personal) Breathe water", "(Personal) Close a cut"] }] } })]);
    const svc = new NemesisService(data, { claude });
    const { person } = (await svc.call("nemesis.writeup", { world: "testland", id: "alice" })) as any;
    expect(person.dynamic.spheres).toEqual({ Life: 2 });
    expect(claude.calls[0]!.prompt).toContain("Their Spheres are fixed: Life 2. Use exactly these.");
    await expect(svc.call("nemesis.writeup", { world: "testland", id: "dracula" })).rejects.toThrow(/plot-locked/);
  });
});

describe("companion: cast and keepers", () => {
  it("sketches a keeper once with the sketch model, and the full card keeps the sketch", async () => {
    const { data } = await world();
    const claude = new FakeClaude([SKETCH, villagerCard()]);
    const svc = new NemesisService(data, { claude, model: "opus", sketchModel: "sonnet" });
    const req = { world: "testland", town: 119, place: "city1:alchemist", role: "alchemist", n: 0, scene: "Alchemist", kind: "commoner", name: "Ixa Holvane", species: "lizardfolk" };
    const [a, b] =(await Promise.all([svc.call("nemesis.sketch", req), svc.call("nemesis.sketch", req)])) as any[];
    expect([claude.calls.length, claude.calls[0]!.model, a.sketch.voice, b.existing]).toEqual([1, "sonnet", SKETCH.voice, false]);
    expect(claude.calls[0]!.prompt).toContain("lizardfolk anatomy");
    const k = (await svc.call("nemesis.keeper", req)) as any;
    expect(claude.calls).toHaveLength(2);
    expect(claude.calls[1]!.model).toBe("opus");
    expect(claude.calls[1]!.prompt).toContain(`- How they look (keep every detail; you may add more): ${SKETCH.look.trim()}`);
    expect(claude.calls[1]!.prompt).toContain(`- Voice: ${SKETCH.voice}`);
    expect([k.person.notes.roleplay.voice, k.person.notes.roleplay.mannerisms]).toEqual([SKETCH.voice, SKETCH.mannerisms]);
    // Once written, the sketch comes from the card, with no Claude call.
    const again = (await svc.call("nemesis.sketch", req)) as any;
    expect([again.existing, again.sketch.voice, claude.calls.length]).toEqual([true, SKETCH.voice, 2]);
  });

  it("casts a scene from the town's culture without Claude, and makes the folk actors", async () => {
    const { data } = await world();
    const svc = new NemesisService(data);
    const res = (await svc.call("nemesis.cast", { world: "testland", townName: "narkoc", place: "city1:alchemist", scene: "Alchemist", people: SHOP })) as any;
    expect(res.town).toEqual({ id: 119, name: "Narkoc" });
    expect([res.faction, res.culture]).toEqual(["march", "Yotunn"]);
    expect(res.people).toHaveLength(3);
    const actors = (await svc.call("nemesis.folkActors", { world: "testland", wants: res.people.map((p: any) => ({ culture: "Yotunn", species: p.folk.species, rank: p.rank })) })) as Record<string, any>;
    for (const p of res.people) expect(actors[p.actorKey]?.flags["georgios-nemesis"].folk).toBe(p.actorKey);
    await expect(svc.call("nemesis.cast", { world: "testland", townName: "Atlantis", place: "x", people: [] })).rejects.toThrow(/no town/);
  });

  it("writes a missing culture's folk with Claude once, then reuses it", async () => {
    const { data } = await world({ folk: false });
    const claude = new FakeClaude([YOTUNN]);
    const svc = new NemesisService(data, { claude });
    await svc.call("nemesis.cast", { world: "testland", town: 119, place: "p", scene: "s", people: SHOP });
    await svc.call("nemesis.cast", { world: "testland", town: 119, place: "p", scene: "s", people: SHOP });
    expect(claude.calls).toHaveLength(1);
    expect(((await svc.call("nemesis.folk", { world: "testland" })) as any).cultures.Yotunn.map((s: any) => s.name)).toEqual(["minotaur", "lizardfolk", "troll", "human"]);
    await expect(new NemesisService((await world({ folk: false })).data).call("nemesis.cast", { world: "testland", town: 119, place: "p", people: SHOP })).rejects.toThrow(/cannot reach Claude/);
  });

  it("writes a keeper once, with the name and species the table saw, no superior and no Boss AI seeds", async () => {
    const { data, dir } = await world();
    const claude = new FakeClaude([villagerCard()]);
    const svc = new NemesisService(data, { claude });
    const req = { world: "testland", town: 119, place: "city1:alchemist", role: "alchemist", n: 0, scene: "Alchemist", kind: "commoner", name: "Ixa Holvane", species: "lizardfolk" };
    const [a, b] = (await Promise.all([svc.call("nemesis.keeper", req), svc.call("nemesis.keeper", req)])) as any[];
    expect(claude.calls).toHaveLength(1);
    expect(b.person.id).toBe(a.person.id);
    expect(claude.calls[0]!.prompt).toContain("the alchemist of the Alchemist in Narkoc");
    expect(claude.calls[0]!.prompt).toContain("- Name: Ixa Holvane");
    expect(claude.calls[0]!.prompt).not.toContain("Rolled seeds");
    const p = a.person;
    expect([p.name, p.species, p.role, p.rank, p.faction, p.home, p.superior]).toEqual(["Ixa Holvane", "lizardfolk", "alchemist", "villager", "march", 119, undefined]);
    expect(p.post).toEqual({ town: 119, place: "city1:alchemist", role: "alchemist", n: 0, scene: "Alchemist" });
    expect(p.origin.seeds).toEqual({});
    expect(a.actor.system.attributes.hp.max).toBeGreaterThanOrEqual(300);
    const again = (await svc.call("nemesis.keeper", req)) as any;
    expect([again.existing, again.person.id, claude.calls.length]).toEqual([true, p.id, 1]);
    const cast = (await svc.call("nemesis.cast", { world: "testland", town: 119, place: "city1:alchemist", scene: "Alchemist", people: SHOP })) as any;
    expect(cast.people[0].person.id).toBe(p.id);
    const board = buildBoard(await NemesisStore.open(dir, "testland"), { source: "map-maker", realms: [], towns: [{ id: 119, name: "Narkoc", state: 2 }] });
    const march = board.factions.find((f) => f.id === "march")!;
    expect(march.townsfolk).toEqual([{ town: { id: 119, name: "Narkoc" }, people: [expect.objectContaining({ id: p.id, post: { role: "alchemist", scene: "Alchemist" } })] }]);
    expect(march.people.some((x) => x.id === p.id)).toBe(false);
    expect(cardProblems(villagerCard(), kitFor("villager"))).toEqual([]);
  });
});
