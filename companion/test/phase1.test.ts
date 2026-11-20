import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { actorData, average, type StatBlock } from "../src/actor";
import { parseArtgenLine, type ArtRunner } from "../src/art";
import { buildStatBlock, diceFor, kitFor, KITS, sizeOf } from "../src/balance";
import { cardProblems, type Card } from "../src/card";
import type { ClaudeRunner, StructuredRequest } from "../src/claude";
import { buildPrompt, generatePerson, rng, rollTables } from "../src/generate";
import { PortraitQueue } from "../src/portraits";
import { NemesisServer } from "../src/server";
import { NemesisStore } from "../src/store";
import { speciesToken } from "../src/tokens";

function card(over: Partial<Card> = {}): Card {
  return {
    name: "Vorga Ironhorn", aliases: ["the Tidewall"], species: "minotaur", look: "A broad minotaur with salt-crusted horns and a harbour-chain across his chest.",
    role: "Captain of the Zugkatil harbour watch", personality: "Patient, then sudden.", wants: ["Dinargart's harbour"], fears: ["the Institute's walkers"], beliefs: ["The Lord gave March its law"],
    worldview: "Iron remembers the shape it was given.", toughness: "hardy",
    spheres: [{ sphere: "Matter", rating: 3 }, { sphere: "Forces", rating: 2 }],
    tricks: [
      { name: "Chain Tide", sphere: "Matter", size: "Area", text: "Harbour chains rise and lash.", vsMages: "The chains wrap the deck under them and drag them down." },
      { name: "Iron Skin", sphere: "Matter", size: "Personal", text: "His hide takes the grain of iron.", vsMages: "Personal: it changes him, not them." },
      { name: "Gale Shove", sphere: "Forces", size: "Personal", text: "A burst of wind at his back.", vsMages: "The wind throws the gangplank they stand on." },
    ],
    attacks: [{ name: "Gore", kind: "melee", damageType: "piercing", text: "Horns lowered." }, { name: "Chain Flail", kind: "melee", damageType: "bludgeoning", text: "A length of anchor chain." }],
    powers: [{ name: "Bellow", save: "wis", effect: "frighten", damageType: "thunder", area: "cone", text: "A roar that shakes the planks." }],
    resistances: ["cold"],
    combatStyle: "Holds the line, then charges.", strength: "Immovable.", weakness: "Hates open water; he cannot swim.",
    art: "A broad minotaur with salt-crusted horns, iron harbour chain across a scarred chest, standing on a wet stone quay at dusk, lantern light.",
    notes: {
      paradigm: { summary: "Iron keeps the shape it was given; he reminds it.", tools: "Hammer taps on chain links, harbour cant", signs: "A ringing like a struck bell, rust flaking upwards", limits: "Cannot touch what was never forged or worked" },
      spheres: [
        { sphere: "Matter", uses: ["(Area) Weld a gate shut", "(Personal) Turn his chain into a spear"] },
        { sphere: "Forces", uses: ["(Personal) Snuff every lantern on him", "(Personal) A gust to knock an arrow aside"] },
      ],
      mind: { priorities: "The harbour, then his crew, then himself", decisions: "Slowly, by the book", knows: "Heard the party survived the Grand Magus", underlings: "Fair but hard; the dockers like him" },
      tactics: { opening: "Chain Tide on the gangplank, then Gore", pressure: "Pins one mage with chains and gores", hurt: "Iron Skin, then Bellow to scatter them", retreat: "Never leaves the quay; surrenders to save his crew", combo: "Chain Tide drags a target into Gore range", vsMages: "Drags the planks out from under them", terrain: "Narrow quays and gangplanks", building: "Two turns for a Chain Tide over the whole pier when cornered" },
      roleplay: { voice: "Low, slow, harbour cant", mannerisms: "Taps his horns; counts ships aloud", lines: ["State your cargo.", "The tide takes what I give it.", "Enough. Spare my dockers."], threats: "Laughs once, then answers with the chain", bribes: "Takes coin for the harbour fund, never for himself", flattery: "Shrugs it off", mercy: "Owes a debt and pays it", secret: "He lets smugglers through for his sister" },
    },
    ...over,
  };
}

class FakeClaude implements ClaudeRunner {
  readonly calls: StructuredRequest[] = [];
  constructor(private readonly answers: Card[]) {}
  async structured(req: StructuredRequest) {
    this.calls.push(req);
    return this.answers[Math.min(this.calls.length - 1, this.answers.length - 1)];
  }
}

async function world() {
  const data = await mkdtemp(join(tmpdir(), "nemesis-p1-"));
  const dir = join(data, "worlds", "testland");
  const s = await NemesisStore.open(dir, "testland");
  await s.putMany([
    { kind: "factions", record: { id: "march", name: "Kingdom of March", kind: "realm", state: 2, culture: "Yotunn", faith: "Yotunn Faith", capital: 140, ruler: "king-dimitrios-vi", summary: "King Dimitrios VI rules from Zugkatil." } },
    { kind: "persons", record: { id: "king-dimitrios-vi", name: "King Dimitrios VI", rank: "monarch", faction: "march", home: 140, state: "alive" } },
  ]);
  await s.saveMeta({ title: "Testland" });
  const atlas = { source: "map-maker" as const, realms: [{ id: 2, name: "Kingdom of March" }], towns: [{ id: 140, name: "Zugkatil", state: 2 }, { id: 119, name: "Narkoc", state: 2 }] };
  await writeFile(join(dir, "atlas.json"), JSON.stringify(atlas));
  const lore = { cultures: { Yotunn: { way: "the hard country", folk: ["minotaurs", "lizardfolk", "trolls"] } }, humans: "Humans are rare, about one in twenty." };
  await writeFile(join(dir, "lore.json"), JSON.stringify(lore));
  return { data, dir, s, atlas, lore };
}

describe("balance", () => {
  it("has a kit for every rank inside the GM's HP ladder, and dice that hit their averages", () => {
    for (const rank of Object.keys(KITS) as Array<keyof typeof KITS>) {
      const k = kitFor(rank);
      expect(k.hp[0]).toBeLessThan(k.hp[1]);
      expect(k.spheres.max).toBeLessThanOrEqual(5);
    }
    for (const target of [20, 26.7, 60, 110]) expect(Math.abs(average(diceFor(target)) - target)).toBeLessThanOrEqual(1.5);
    expect(diceFor(0)).toEqual({ number: 0, die: 10, bonus: 0 });
    expect([sizeOf("hill giant"), sizeOf("minotaur"), sizeOf("goblin"), sizeOf("drow")]).toEqual(["huge", "lg", "sm", "med"]);
  });

  it("builds a captain's stat block from the table, with HP in the hardy third", () => {
    const kit = kitFor("captain");
    const s = buildStatBlock(card(), kit, rng(7));
    const third = (kit.hp[1] - kit.hp[0]) / 3;
    expect(s.hp).toBeGreaterThanOrEqual(kit.hp[0] + 2 * third - 10);
    expect(s.hp).toBeLessThanOrEqual(kit.hp[1]);
    expect([s.ac, s.cr, s.size, s.attacksPerRound]).toEqual([kit.ac, kit.cr, "lg", kit.attacksPerRound]);
    expect(s.attacks.map((a) => a.toHit)).toEqual([kit.toHit, kit.toHit]);
    expect(Math.abs(average(s.attacks[0]!.dice) * kit.attacksPerRound - kit.damagePerRound)).toBeLessThanOrEqual(4);
    expect(s.powers[0]).toMatchObject({ name: "Bellow", dc: kit.dc, save: "wis", recharge: kit.recharge });
    expect(s.legendary).toEqual(kit.legendary);
    expect(s.scores.str).toBe(kit.scores.prime);
  });
});

describe("card rules", () => {
  const kit = kitFor("captain");
  it("accepts a card that fits and names what breaks", () => {
    expect(cardProblems(card(), kit)).toEqual([]);
    const bad = card({
      spheres: [{ sphere: "Matter", rating: 5 }],
      tricks: [{ name: "Sea Swallow", sphere: "Time", size: "Cataclysm", text: "x", vsMages: "" }],
      powers: [card().powers[0]!, card().powers[0]!, card().powers[0]!],
    });
    expect(cardProblems(bad, kit)).toEqual([
      "spheres: a captain has 2 to 3 Spheres, not 1",
      "spheres: Matter 5 is outside 1 to 3 for a captain",
      "tricks: a captain has 3 to 4 tricks, not 1",
      'tricks: "Sea Swallow" uses Time, which is not among their Spheres',
      'tricks: "Sea Swallow" must say how it reaches a mage through the world',
      "powers: a captain has at most 2 innate powers, not 3",
      "notes.spheres: Forces is not among their Spheres",
    ]);
    const tooBig = card({ tricks: [...card().tricks.slice(1), { name: "Harbour Heave", sphere: "Matter", size: "Environment", text: "x", vsMages: "the quay buckles" }] });
    expect(cardProblems(tooBig, kit)).toEqual(['tricks: "Harbour Heave" is Environment, but Matter 3 reaches Area at most']);
  });
});

describe("generator", () => {
  it("rolls seeds and writes a prompt with the faction, the peoples and the kit", async () => {
    const { s, lore } = await world();
    const tables = { "First Name": [{ text: "Vorga" }, { text: "Ulm", weight: 0 }], Title: [{ text: "the Tidewall" }] };
    const seeds = rollTables(tables, rng(1));
    expect(seeds).toEqual({ "First Name": "Vorga", Title: "the Tidewall" });
    const prompt = buildPrompt({ req: { faction: "march", rank: "captain", note: "guards the harbour" }, faction: s.get("factions", "march")!, superior: s.get("persons", "king-dimitrios-vi"), homeName: "Narkoc", seeds, lore, names: ["King Dimitrios VI"] });
    for (const bit of ["Write a captain of the Kingdom of March.", "a Yotunn realm", "its folk are minotaurs; lizardfolk; trolls", "Home town: Narkoc.", "They answer to King Dimitrios VI", "4,000 to 7,000 HP", "- First Name: Vorga", "## The GM asks\nguards the harbour", "do not reuse): King Dimitrios VI"]) expect(prompt).toContain(bit);
  });

  it("saves a person that passes every check, and builds the actor", async () => {
    const { s, atlas, lore } = await world();
    const claude = new FakeClaude([card()]);
    const g = await generatePerson({ store: s, claude, atlas, lore, req: { faction: "march", rank: "captain", home: 119, seed: 3 }, model: "opus" });
    expect(g.tries).toBe(1);
    expect(claude.calls[0]!.schema).toHaveProperty("properties.tricks");
    const p = s.get("persons", "vorga-ironhorn")!;
    expect(p).toMatchObject({ name: "Vorga Ironhorn", rank: "captain", faction: "march", home: 119, superior: "king-dimitrios-vi", source: "generated", dynamic: { spheres: { Matter: 3, Forces: 2 } }, art: { prompt: card().art } });
    const actor = actorData(p, { world: "testland", img: speciesToken(p.species, p.rank), token: speciesToken(p.species, p.rank) });
    expect(actor.img).toBe("systems/dnd5e/tokens/monstrosity/Minotaur.webp");
    expect(actor.system.attributes.hp.max).toBe((p.static as StatBlock).hp);
    const kit = kitFor("captain");
    expect(actor.system.resources).toEqual({ legact: { max: kit.legendary.actions, spent: 0 }, legres: { max: kit.legendary.resistances, spent: 0 } });
    const names = (actor.items as Array<{ name: string }>).map((i) => i.name);
    expect(names).toEqual(["Multiattack", "Gore", "Chain Flail", "Bellow", "Chain Tide (Matter Area)", "Iron Skin (Matter Personal)", "Gale Shove (Forces Personal)", "Dynamic Magic", "Legendary Resistance (1/Day)", "Legendary Action: Strike"]); // a captain has 1 legendary action: no 2-action Bend the World
    const gore = (actor.items as any[])[1];
    const act = Object.values(gore.system.activities)[0] as any;
    expect([act.type, act.attack.flat, act.attack.bonus, act.attack.ability]).toEqual(["attack", true, String(kitFor("captain").toHit), "none"]);
    const bellow = Object.values((actor.items as any[])[3].system.activities)[0] as any;
    expect([bellow.save.ability, bellow.save.dc.formula, bellow.target.template.type]).toEqual([["wis"], String(kitFor("captain").dc), "cone"]);
    const trick = Object.values((actor.items as any[])[4].system.activities)[0] as any;
    expect(trick.roll.formula).toBe("1d20");
    expect((actor.items as any[])[4].system.description.value).toContain("succeeds on 13+");
    expect((actor.items as any[])[4].system.description.value).toContain(`the greater of 33 (6d10) or 10% of its max HP; DC ${kit.dc} save`);
    expect((actor.items as any[])[5].system.description.value).toContain("Personal: changes the caster");
    expect(new Set((actor.items as any[]).map((i) => i._id)).size).toBe(actor.items.length); // stable, unique ids
  });

  it("sends the problems back and accepts the corrected card", async () => {
    const { s, atlas } = await world();
    const broken = card({ tricks: [...card().tricks.slice(1), { name: "Harbour Heave", sphere: "Matter", size: "Environment", text: "x", vsMages: "the quay buckles" }] });
    const claude = new FakeClaude([broken, card()]);
    const g = await generatePerson({ store: s, claude, atlas, req: { faction: "march", rank: "captain" } });
    expect(g.tries).toBe(2);
    expect(claude.calls[1]!.prompt).toContain('- tricks: "Harbour Heave" is Environment, but Matter 3 reaches Area at most');
  });

  it("gives up after three bad cards and saves nothing", async () => {
    const { s, atlas } = await world();
    const claude = new FakeClaude([card({ spheres: [{ sphere: "Matter", rating: 5 }] })]);
    await expect(generatePerson({ store: s, claude, atlas, req: { faction: "march", rank: "captain" } })).rejects.toThrow(/broke the rules 3 times/);
    expect(s.list("persons").map((p) => p.id)).toEqual(["king-dimitrios-vi"]);
  });

  it("gives a second person with the same name their own id", async () => {
    const { s, atlas } = await world();
    await generatePerson({ store: s, claude: new FakeClaude([card()]), atlas, req: { faction: "march", rank: "captain" } });
    const g = await generatePerson({ store: s, claude: new FakeClaude([card()]), atlas, req: { faction: "march", rank: "captain" } });
    expect(g.person.id).toBe("vorga-ironhorn-2");
  });
});

describe("tokens and portraits", () => {
  it("finds a token by species, and by rank for humans", () => {
    expect(speciesToken("frog-folk smuggler")).toBe("systems/dnd5e/tokens/humanoid/Froglin.webp");
    expect(speciesToken("vampire spawn")).toBe("systems/dnd5e/tokens/undead/VampireSpawn.webp");
    expect(speciesToken("scaled folk")).toBe("systems/dnd5e/tokens/humanoid/Lizardfolk.webp");
    expect(speciesToken("human", "captain")).toBe("systems/dnd5e/tokens/humanoid/Knight.webp");
  });

  it("reads artgen's output lines", () => {
    expect(parseArtgenLine("seed 42: C:\\artgen\\output\\nemesis-x_layout_00001_.png  (95s)")).toEqual({ path: "C:\\artgen\\output\\nemesis-x_layout_00001_.png", layout: true });
    expect(parseArtgenLine("seed 42: C:\\artgen\\output\\nemesis-x_00001_.png  (101s)")).toEqual({ path: "C:\\artgen\\output\\nemesis-x_00001_.png", layout: false });
    expect(parseArtgenLine("Engine: hybrid  prompting: caption")).toBeUndefined();
  });

  it("paints in the background, keeps both versions, and serves them to Foundry", async () => {
    const { data, dir, s, atlas } = await world();
    await generatePerson({ store: s, claude: new FakeClaude([card()]), atlas, req: { faction: "march", rank: "captain" } });
    const out = await mkdtemp(join(tmpdir(), "artgen-out-"));
    const art: ArtRunner = {
      available: () => true,
      portrait: async (req, onLine) => {
        onLine?.(`drawing ${req.name}`);
        await writeFile(join(out, "f.png"), "FINAL");
        await writeFile(join(out, "l.png"), "LAYOUT");
        return { final: join(out, "f.png"), layout: join(out, "l.png") };
      },
    };
    const portraits = new PortraitQueue({ art, worldDir: (w) => join(data, "worlds", w) });
    const server = new NemesisServer({ dataDir: data, port: 0, deps: { portraits } });
    await server.start();
    const rpc = async (method: string, params: unknown) => (await (await fetch(`http://127.0.0.1:${server.port}/rpc`, { method: "POST", body: JSON.stringify({ id: 1, method, params }) })).json()) as any;
    try {
      expect((await rpc("nemesis.capabilities", {})).result).toMatchObject({ generate: false, portraits: true });
      expect((await rpc("nemesis.generate", { world: "testland", faction: "march", rank: "captain" })).error.message).toMatch(/cannot reach Claude/);
      const { job } = (await rpc("nemesis.portrait", { world: "testland", id: "vorga-ironhorn" })).result;
      let st: any;
      for (let i = 0; i < 50; i++) {
        st = (await rpc("nemesis.job", { id: job })).result;
        if (st.state === "done" || st.state === "failed") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(st).toMatchObject({ state: "done", person: "vorga-ironhorn", files: { final: "art/vorga-ironhorn/final.png", layout: "art/vorga-ironhorn/layout.png" } });
      expect(await readFile(join(dir, "art", "vorga-ironhorn", "layout.png"), "utf8")).toBe("LAYOUT");
      const img = await fetch(`http://127.0.0.1:${server.port}/art/testland/vorga-ironhorn/final.png`, { headers: { origin: "http://localhost:30000" } });
      expect([img.status, img.headers.get("content-type"), await img.text()]).toEqual([200, "image/png", "FINAL"]);
      expect((await fetch(`http://127.0.0.1:${server.port}/art/testland/nobody/final.png`)).status).toBe(404);
      const actor = (await rpc("nemesis.actor", { world: "testland", id: "vorga-ironhorn" })).result;
      expect(actor.prototypeToken.texture.src).toBe("systems/dnd5e/tokens/monstrosity/Minotaur.webp");
    } finally {
      await server.stop();
    }
  });
});

describe("Foundry pages for a generated person", () => {
  it("writes the GM journal page and shows the portrait picker on the board", async () => {
    // @ts-expect-error plain JS module without types
    const { journalHtml, cardHtml, pickedArt } = await import("../../module/scripts/board-html.js");
    const { s, atlas } = await world();
    const { person } = await generatePerson({ store: s, claude: new FakeClaude([card()]), atlas, req: { faction: "march", rank: "captain" } });
    const t = (key: string, data?: Record<string, unknown>) => (data ? `${key}(${Object.values(data).join(",")})` : key);
    const page = journalHtml(person, t);
    for (const bit of ["minotaur, Rank.captain, Captain of the Zugkatil harbour watch", "Hates open water", "Matter 3, Forces 2", "<strong>Chain Tide</strong> (Matter, Area, 13+)", "The chains wrap the deck under them"]) expect(page).toContain(bit);
    // Foundry shows the page title (the name) itself; labels that carry a colon get no second one.
    expect(page).not.toContain("<h1>");
    expect(journalHtml(person, (k: string) => (k === "Look" ? "Looks:" : k))).toContain("<strong>Looks:</strong>");
    expect(pickedArt({ final: "f.png", layout: "l.png", picked: "layout" })).toBe("l.png");
    expect(pickedArt({ final: "f.png", layout: "l.png" })).toBe("f.png");
    expect(pickedArt({ own: "mine.png" })).toBe("mine.png");
    const boardCard = { ...(buildBoardCard(person)), art: { final: "f.png", layout: "l.png", picked: "layout" }, actor: "Actor.x1" };
    const html = cardHtml(boardCard, { t, canPaint: true, painting: new Set() });
    expect(html).toContain('<img src="l.png" alt="Vorga Ironhorn">');
    expect(html).toMatch(/class="gn-pick " data-pick="final"/);
    expect(html).toMatch(/class="gn-pick active" data-pick="layout"/);
    expect(html).toContain('data-paint="vorga-ironhorn"');
    expect(html).toContain('data-uuid="Actor.x1"');
    const busy = cardHtml({ ...buildBoardCard(person), actor: "Actor.x1" }, { t, canPaint: true, painting: new Set(["vorga-ironhorn"]) });
    expect(busy).toContain("gn-painting");
    expect(busy).not.toContain("data-paint=");
  });
});

/** The board's card for a person record, the way board.ts makes it. */
function buildBoardCard(p: any) {
  return { id: p.id, name: p.name, aliases: [], species: p.species, rank: p.rank, role: p.role, state: p.state, spheres: [], dynamicOnly: false, wants: [], fears: [], facts: [], memory: [], feelings: [], knows: [], relationships: [], commitments: [], gmNotes: [], plotLocked: false, gmOnly: false, scribbler: [] };
}

describe("GM notes", () => {
  it("checks the notes cover every Sphere and give three lines", () => {
    const kit = kitFor("captain");
    const c = card();
    expect(cardProblems({ ...c, notes: { ...c.notes, spheres: [c.notes.spheres[0]!] } }, kit)).toEqual(["notes.spheres: give two to four uses for Forces"]);
    expect(cardProblems({ ...c, notes: { ...c.notes, spheres: [...c.notes.spheres, { sphere: "Time", uses: ["a", "b"] }] } }, kit)).toEqual(["notes.spheres: Time is not among their Spheres"]);
    expect(cardProblems({ ...c, notes: { ...c.notes, roleplay: { ...c.notes.roleplay, lines: ["one"] } } }, kit)).toEqual(["notes.roleplay.lines: give three lines in their voice"]);
  });

  it("puts the notes on the record, the actor and the GM journal", async () => {
    // @ts-expect-error plain JS module without types
    const { journalHtml } = await import("../../module/scripts/board-html.js");
    const { s, atlas } = await world();
    const { person } = await generatePerson({ store: s, claude: new FakeClaude([card()]), atlas, req: { faction: "march", rank: "captain" } });
    expect(s.get("persons", person.id)!.notes.tactics.combo).toBe("Chain Tide drags a target into Gore range");
    const actor = actorData(person, { world: "testland", img: "x", token: "x" });
    const dyn = (actor.items as any[]).find((i) => i.name === "Dynamic Magic").system.description.value;
    for (const bit of ["<h3>Paradigm</h3>", "Iron keeps the shape it was given", "<strong>Matter 3</strong>", "(Area) Weld a gate shut", "raises its line by 2"]) expect(dyn).toContain(bit);
    const bio = actor.system.details.biography.value;
    for (const bit of ["<h3>How they fight</h3>", "<strong>Opening:</strong> Chain Tide on the gangplank, then Gore", "<strong>Below half:</strong>", "<em>\"Enough. Spare my dockers.\"</em>"]) expect(bio).toContain(bit);
    const t = (key: string) => key;
    const page = journalHtml(person, t);
    for (const bit of ["<h2>Notes.Mind</h2>", "<strong>Notes.Priorities:</strong> The harbour, then his crew, then himself", "<h2>Notes.Tactics</h2>", "<h2>Notes.Paradigm</h2>", "<h3>Notes.Freeform</h3>", "(Personal) Snuff every lantern on him", "<h2>Notes.Roleplay</h2>", "<strong>Notes.Secret:</strong> He lets smugglers through for his sister"]) expect(page).toContain(bit);
  });
});
