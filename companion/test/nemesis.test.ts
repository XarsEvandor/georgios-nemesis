import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBoard } from "../src/board";
import { applySeed, factionId, parseRuler, seedItems, slug, worldRecords, type Seed } from "../src/import";
import { HP_BANDS, personRules, sizeCap } from "../src/rules";
import { PERSON, validate } from "../src/schema";
import { NemesisError, NemesisStore } from "../src/store";
import { NemesisServer } from "../src/server";
import { atlasOf, azgaarCultures, azgaarWorld, type World } from "../src/world";


/** A small world in Map Maker's aged shape: two realms, an invader, four towns. */
function world(): World {
  return {
    name: "Testland", startYear: 183, year: 1183, eraShort: "NE", seed: 1,
    states: [
      { id: 0, name: "Neutrals", form: "", fullName: "Neutrals", culture: 0, religion: 0, capital: 0, color: "", founded: 0, origin: "old", alive: true, cells: 0 },
      { id: 2, name: "March", form: "Kingdom", fullName: "Kingdom of March", culture: 1, religion: 1, capital: 140, color: "", founded: 183, origin: "old", alive: true, cells: 10 },
      { id: 49, name: "Dunstley", form: "Free City", fullName: "Free City of Durten", culture: 4, religion: 4, capital: 324, color: "", founded: 900, origin: "rebellion", alive: true, cells: 2 },
      { id: 52, name: "Institute of Research and Science", form: "", fullName: "Institute of Research and Science", culture: 1, religion: -1, capital: 256, color: "", founded: 1150, origin: "invasion", alive: true, cells: 3 },
      { id: 9, name: "Gone", form: "Kingdom", fullName: "Kingdom of Gone", culture: 1, religion: 1, capital: 5, color: "", founded: 183, ended: 400, origin: "old", alive: false, cells: 0 },
    ],
    burgs: [
      { id: 0, name: "", alive: false },
      { id: 119, name: "Narkoc", state: 2, alive: true },
      { id: 140, name: "Zugkatil", state: 2, alive: true },
      { id: 324, name: "Durten", state: 49, alive: true },
      { id: 256, name: "Marnovet", state: 52, alive: true },
      { id: 5, name: "Ruin", state: 9, alive: false },
    ] as any,
    religions: [{ i: 1, name: "Yotunn Faith", type: "Folk" }, { i: 4, name: "Kentian Beliefs", type: "Folk" }],
    regions: [], routes: [], markers: [], events: [], cells: {} as any,
  } as unknown as World;
}
const cultures = [{ i: 1, name: "Yotunn" }, { i: 4, name: "Kentian" }];
const lore = { rulers: { "2": { ruler: "King Dimitrios VI" }, "49": { ruler: "a council of guild masters led by First Magistrate Aurel Vessane" } } };
const prose = { overview: "", ages: [], fallen: {}, towns: {}, realms: { "2": { history: "", today: "King Dimitrios VI rules from Zugkatil." } } } as any;

const seed: Seed = {
  id: "session-1",
  persons: [
    { id: "king-dimitrios-vi", wants: ["A greater kingdom"] },
    { id: "grand-magus", name: "Grand Magus", rank: "archmage", faction: "march", superior: "king-dimitrios-vi", static: { hp: 20_000 }, dynamic: { spheres: { Time: 5, Forces: 5, Correspondence: 4 }, only: true }, state: "alive" },
    { id: "alice", name: "Alice", species: "scaled folk", rank: "villager", faction: "march", home: 119, relationships: [{ kind: "spouse", with: "drogo" }], memory: [{ when: "session 1", text: "Found the party at the docks" }], state: "alive" },
    { id: "dracula", name: "Dracula", rank: "unranked", flags: { plotLocked: true }, gmNotes: ["secret"], state: "alive" },
  ],
  factions: [{ id: "march", archmages: ["grand-magus"], goals: [{ kind: "fear", text: "Navarg" }] }],
  towns: [{ id: "town-119", present: ["alice"], notes: ["Has a Healer"] }],
};

async function freshStore(): Promise<NemesisStore> {
  const dir = await mkdtemp(join(tmpdir(), "nemesis-"));
  const s = await NemesisStore.open(dir, "testland");
  await s.addMissing(worldRecords({ aged: world(), cultures, prose, lore }));
  return s;
}

describe("schema", () => {
  const ok = { id: "alice", name: "Alice", state: "alive" };
  it("accepts a minimal person and names each problem", () => {
    expect(validate(PERSON, ok)).toEqual([]);
    expect(validate(PERSON, { ...ok, id: "Alice!" })[0]).toMatch(/\$\.id: .*not a valid id/);
    expect(validate(PERSON, { ...ok, colour: "red" })).toEqual(["$.colour: unknown field"]);
    expect(validate(PERSON, { ...ok, state: "asleep" })[0]).toMatch(/\$\.state: must be one of alive/);
    expect(validate(PERSON, { id: "x", state: "alive" })).toEqual(["$.name: required"]);
    expect(validate(PERSON, { ...ok, dynamic: { spheres: { Time: 6, Cooking: 2 } } })).toEqual([
      "$.dynamic.spheres.Time: must be at most 5",
      '$.dynamic.spheres: "Cooking" must be one of Correspondence, Entropy, Forces, Life, Matter, Mind, Prime, Spirit, Time',
    ]);
    expect(validate(PERSON, { ...ok, home: 1.5 })).toEqual(["$.home: must be a whole number"]);
  });
});

describe("world rules", () => {
  it("keeps HP inside the GM's ladder (villager 400, a huge boss about 30 rounds of today's damage)", () => {
    expect(HP_BANDS.villager).toEqual([300, 600]);
    expect(HP_BANDS.archmage).toEqual([15_000, 20_000]);
    expect(personRules({ rank: "villager", static: { hp: 400 } })).toEqual([]);
    expect(personRules({ rank: "villager", static: { hp: 45 } })[0]).toMatch(/a villager has 300 to 600 HP, not 45/);
    expect(personRules({ rank: "unranked", static: { hp: 9_999_999 } })).toEqual([]);
  });
  it("gives a dynamic-only mage no static powers and caps tricks by Sphere rating", () => {
    expect(personRules({ dynamic: { only: true }, static: { powers: [{ name: "Fireball" }] } })[0]).toMatch(/only dynamic magic/);
    expect(sizeCap(2)).toBe("Personal");
    expect(sizeCap(5)).toBe("Cataclysm");
    const mage = { dynamic: { spheres: { Time: 5, Correspondence: 4 }, tricks: [{ name: "Age the walls", sphere: "Time", size: "Cataclysm" }, { name: "Be everywhere", sphere: "Correspondence", size: "Cataclysm" }, { name: "Burn", sphere: "Forces", size: "Area" }] } };
    expect(personRules(mage)).toEqual([
      "$.dynamic.tricks[1]: Correspondence 4 reaches Environment effects, not Cataclysm",
      '$.dynamic.tricks[2]: "Burn" uses Forces, which this person does not have',
    ]);
  });
});

describe("import", () => {
  it("names factions after the realm and rulers after lore.json", () => {
    expect(slug("King Dimitrios VI")).toBe("king-dimitrios-vi");
    expect(factionId({ form: "Kingdom", fullName: "Kingdom of March" })).toBe("march");
    expect(factionId({ form: "Free City", fullName: "Free City of Durten" })).toBe("durten");
    expect(factionId({ form: "", fullName: "Institute of Research and Science" })).toBe("institute-of-research-and-science");
    expect(parseRuler("King Osric Hale")).toEqual({ name: "King Osric Hale" });
    expect(parseRuler("Lord Aubert de Chadonvel, called the Grey Lord")).toEqual({ name: "Lord Aubert de Chadonvel", more: "Lord Aubert de Chadonvel, called the Grey Lord" });
    expect(parseRuler("a council of guild masters led by First Magistrate Aurel Vessane").name).toBe("First Magistrate Aurel Vessane");
  });

  it("makes a record per living realm and town, pointing at Map Maker ids", () => {
    const items = worldRecords({ aged: world(), cultures, prose, lore });
    const of = (k: string) => items.filter((i) => i.kind === k).map((i) => i.record);
    expect(of("factions").map((f) => f.id)).toEqual(["march", "durten", "institute-of-research-and-science"]);
    const march = of("factions")[0]!;
    expect(march).toMatchObject({ name: "Kingdom of March", state: 2, culture: "Yotunn", faith: "Yotunn Faith", capital: 140, ruler: "king-dimitrios-vi", summary: "King Dimitrios VI rules from Zugkatil." });
    const irs = of("factions")[2]!;
    expect(irs.culture).toBeUndefined(); // an invader is not one of the peoples
    expect(irs.ruler).toBeUndefined(); // its leaders are unknown
    expect(of("persons").map((p) => p.id)).toEqual(["king-dimitrios-vi", "first-magistrate-aurel-vessane"]);
    expect(of("persons")[0]).toMatchObject({ rank: "monarch", faction: "march", home: 140 });
    expect(of("towns").map((t) => [t.id, t.owner])).toEqual([["town-119", "march"], ["town-140", "march"], ["town-324", "durten"], ["town-256", "institute-of-research-and-science"]]);
  });

  it("lays a seed over the records once, keeping what it does not mention", async () => {
    const s = await freshStore();
    expect(await applySeed(s, seed)).toBe(true);
    const king = s.get("persons", "king-dimitrios-vi")!;
    expect(king).toMatchObject({ name: "King Dimitrios VI", rank: "monarch", wants: ["A greater kingdom"], source: "import" });
    expect(s.get("factions", "march")).toMatchObject({ ruler: "king-dimitrios-vi", archmages: ["grand-magus"], culture: "Yotunn" });
    // The GM edits the king; a second run of the seed must not undo it.
    await s.put("persons", { ...king, wants: ["Navarg's crown"] });
    expect(await applySeed(s, seed)).toBe(false);
    expect(s.get("persons", "king-dimitrios-vi")!.wants).toEqual(["Navarg's crown"]);
    // A reload sees the same thing.
    const again = await NemesisStore.open(s.dir, "testland");
    expect(again.meta.seeds).toEqual(["session-1"]);
    expect(again.get("persons", "grand-magus")!.dynamic.spheres.Time).toBe(5);
  });

  it("writes nothing when one record of a batch breaks a rule or a reference", async () => {
    const s = await freshStore();
    const bad: Seed = { id: "bad", persons: [{ id: "ok", name: "Fine", state: "alive" }, { id: "spy", name: "Spy", faction: "nowhere", rank: "villager", static: { hp: 10 }, state: "alive" }] };
    await expect(s.putMany(seedItems(s, bad))).rejects.toThrow(NemesisError);
    await expect(s.putMany(seedItems(s, bad))).rejects.toThrow(/no faction "nowhere".*|a villager has 300 to 600 HP/);
    expect(s.get("persons", "ok")).toBeUndefined();
    const onDisk = JSON.parse(await readFile(join(s.dir, "persons.json"), "utf8"));
    expect(Object.keys(onDisk)).toEqual(["king-dimitrios-vi", "first-magistrate-aurel-vessane"]);
  });
});

describe("board", () => {
  it("shows March with its king and archmage, its people, and the plot characters outside", async () => {
    const s = await freshStore();
    await applySeed(s, seed);
    await s.put("persons", { id: "captain-vorn", name: "Captain Vorn", rank: "captain", faction: "march", superior: "grand-magus", static: { hp: 5_000 }, state: "alive" });
    const b = buildBoard(s, atlasOf(world(), { source: "map-maker", mapMakerWorld: "testland" }));
    const march = b.factions[0]!;
    expect(march.name).toBe("Kingdom of March");
    expect(march.ruler?.name).toBe("King Dimitrios VI");
    expect(march.archmages.map((m) => [m.name, m.hp, m.dynamicOnly, m.spheres.map((x) => `${x.sphere} ${x.rating}`)])).toEqual([["Grand Magus", 20_000, true, ["Forces 5", "Time 5", "Correspondence 4"]]]);
    expect(march.archmages[0]!.superior).toEqual({ id: "king-dimitrios-vi", name: "King Dimitrios VI" });
    expect(march.chain.map((n) => n.person.name)).toEqual(["Captain Vorn"]);
    expect(march.people.map((p) => [p.name, p.home?.name, p.memory.length])).toEqual([["Alice", "Narkoc", 1]]);
    expect(march.capital).toEqual({ id: 140, name: "Zugkatil" });
    expect(march.towns).toBe(2);
    expect(b.outside.map((p) => [p.name, p.plotLocked, p.gmNotes])).toEqual([["Dracula", true, ["secret"]]]);
  });
});

describe("Foundry board HTML", () => {
  it("draws March's court and the people outside, escaped, with Scribbler links once each", async () => {
    // @ts-expect-error plain JS module without types
    const { navHtml, paneHtml, pickWorld, OUTSIDE } = await import("../../module/scripts/board-html.js");
    const s = await freshStore();
    await applySeed(s, seed);
    await s.put("persons", { ...s.get("persons", "alice")!, facts: ["Says <script>alert(1)</script> a lot"], links: { scribbler: ["Alice", "alice"] } });
    const b = buildBoard(s, atlasOf(world(), { source: "map-maker", mapMakerWorld: "testland" }));
    const t = (key: string, data?: Record<string, unknown>) => (data ? `${key}(${Object.values(data).join(",")})` : key);
    const resolve = (name: string) => (name.toLowerCase() === "alice" ? { uuid: "JournalEntry.abc", name: "Alice" } : undefined);
    const nav = navHtml(b, "march", t);
    expect(nav).toContain('class="gn-faction active" data-faction="march"');
    expect(nav).toContain("Known(3)"); // king, archmage, Alice
    expect(nav).toContain(`data-faction="${OUTSIDE}"`);
    // Alone, the board names its own towns; with Map Maker it links Map Maker's journals.
    const alone = paneHtml(b, "march", { t, resolve });
    expect(alone).not.toContain("gn-place");
    expect(alone).toContain('<h4 class="gn-town">Narkoc </h4>');
    const journals: Record<string, { uuid: string; name: string }> = { "realm-2": { uuid: "JournalEntry.r2", name: "Kingdom of March" }, "town-119": { uuid: "JournalEntry.t119", name: "Narkoc" } };
    const pane = paneHtml(b, "march", { t, resolve, place: (key: string) => journals[key] });
    expect(pane).toContain('data-uuid="JournalEntry.r2"');
    expect(pane).toMatch(/<h4 class="gn-town">Narkoc <a class="gn-link gn-place" data-uuid="JournalEntry\.t119"[^>]*><i class="fa-solid fa-map-location-dot"><\/i> Journal<\/a><\/h4>/);
    expect(pane).not.toContain("town-140"); // Zugkatil has no Map Maker journal here, so no link
    expect(pane).toContain("<h2>Kingdom of March</h2>");
    expect(pane).toContain("Capital(Zugkatil) · Towns(2) · Yotunn · Yotunn Faith");
    expect(pane).toMatch(/King Dimitrios VI <span class="gn-rank">Rank\.monarch<\/span>/);
    expect(pane).toMatch(/Grand Magus <span class="gn-rank">Rank\.archmage<\/span>/);
    expect(pane).toContain("Forces 5 · Time 5 · Correspondence 4 · <em>DynamicOnly</em>");
    expect(pane).toContain("Hp(20,000)");
    expect(pane).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(pane).not.toContain("<script>");
    expect(pane.match(/data-uuid="JournalEntry\.abc"/g)).toHaveLength(1);
    const outside = paneHtml(b, OUTSIDE, { t, resolve });
    expect(outside).toContain("Dracula");
    expect(outside).toContain("GmNotes");
    expect(pickWorld([{ id: "a" }, { id: "ogeia-1183" }], ["ogeia-1183"])).toEqual({ id: "ogeia-1183" });
    expect(pickWorld([{ id: "a" }], [])).toEqual({ id: "a" });
  });

  it("has an English string for every key the module's scripts use", async () => {
    const dir = new URL("../../module/", import.meta.url);
    const lang = JSON.parse(await readFile(new URL("lang/en.json", dir), "utf8")).GN;
    const has = (path: string) => path.split(".").reduce((o: any, k) => o?.[k], lang) !== undefined;
    const used = new Set<string>();
    for (const f of ["scripts/main.js", "scripts/board-html.js", "scripts/launcher.js", "scripts/people.js"]) {
      const src = await readFile(new URL(f, dir), "utf8");
      for (const m of src.matchAll(/\bt\("([A-Za-z.]+)"/g)) used.add(m[1]!);
      for (const m of src.matchAll(/\bL\("([A-Za-z]+)"/g)) used.add(`Launcher.${m[1]}`);
      for (const m of src.matchAll(/"GN\.([A-Za-z.]+)"/g)) used.add(m[1]!);
      for (const m of src.matchAll(/t\(`(Rank|State)\.\$\{/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(40);
    expect([...used].filter((k) => !has(k))).toEqual([]);
    for (const k of ["villager", "monarch", "unranked"]) expect(has(`Rank.${k}`)).toBe(true);
    for (const k of ["alive", "missing", "harvested"]) expect(has(`State.${k}`)).toBe(true);
  });
});


describe("companion server", () => {
  async function serve() {
    const data = await mkdtemp(join(tmpdir(), "nemesis-data-"));
    const dir = join(data, "worlds", "testland");
    const s = await NemesisStore.open(dir, "testland");
    await s.addMissing(worldRecords({ aged: world(), cultures, prose, lore }));
    await applySeed(s, seed);
    await s.saveMeta({ title: "Testland, 1183 NE" });
    await writeFile(join(dir, "atlas.json"), JSON.stringify(atlasOf(world(), { source: "map-maker", mapMakerWorld: "testland" })));
    const server = new NemesisServer({ dataDir: data, port: 0 });
    await server.start();
    const base = `http://127.0.0.1:${server.port}`;
    const rpc = async (method: string, params: unknown = {}, headers: Record<string, string> = { origin: "http://localhost:30000" }) => {
      const res = await fetch(`${base}/rpc`, { method: "POST", headers, body: JSON.stringify({ id: 7, method, params }) });
      return { status: res.status, cors: res.headers.get("access-control-allow-origin"), body: (await res.json()) as any };
    };
    return { server, base, rpc };
  }

  it("answers the GM's Foundry tab and local programs, and no one else", async () => {
    const { server, base, rpc } = await serve();
    try {
      expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true, name: "georgios-nemesis", version: "0.1.0" });
      const ok = await rpc("ping");
      expect([ok.status, ok.cors, ok.body]).toEqual([200, "http://localhost:30000", { id: 7, result: { ok: true, name: "georgios-nemesis", version: "0.1.0" } }]);
      expect((await rpc("ping", {}, {})).status).toBe(200); // a local program sends no Origin
      const foreign = await rpc("ping", {}, { origin: "https://evil.example" });
      expect([foreign.status, foreign.body.error.message]).toEqual([403, "origin https://evil.example is not in georgios-nemesis/data/config.json"]);
      // A page that rebinds its own name to 127.0.0.1 still sends its own Host (fetch cannot fake one, raw HTTP can).
      const rebind = await new Promise<number>((done, fail) => {
        const r = request({ host: "127.0.0.1", port: server.port, path: "/rpc", method: "POST", headers: { host: "evil.example" } }, (res) => done(res.statusCode ?? 0));
        r.on("error", fail);
        r.end("{}");
      });
      expect(rebind).toBe(403);
      const pre = await fetch(`${base}/rpc`, { method: "OPTIONS", headers: { origin: "http://localhost:30000" } });
      expect([pre.status, pre.headers.get("access-control-allow-private-network")]).toEqual([204, "true"]);
    } finally {
      await server.stop();
    }
  });

  it("serves the board with its source and checks GM edits", async () => {
    const { server, rpc } = await serve();
    try {
      expect((await rpc("nemesis.worlds")).body.result).toEqual([{ id: "testland", title: "Testland, 1183 NE", source: "map-maker", counts: { persons: 5, factions: 3, towns: 4, armies: 0, events: 0, rumors: 0 } }]);
      const board = (await rpc("nemesis.board", { world: "testland" })).body.result;
      expect(board.world).toEqual({ id: "testland", title: "Testland, 1183 NE", source: "map-maker", mapMaker: { world: "testland" } });
      expect([board.factions[0].ruler.name, board.factions[0].archmages[0].name, board.factions[0].state]).toEqual(["King Dimitrios VI", "Grand Magus", 2]);
      expect((await rpc("nemesis.put", { world: "testland", kind: "persons", record: { id: "alice", name: "Alice", rank: "villager", static: { hp: 40 }, state: "alive" } })).body.error.message).toMatch(/a villager has 300 to 600 HP, not 40/);
      expect((await rpc("nemesis.put", { world: "testland", kind: "persons", record: { id: "alice", name: "Alice", rank: "villager", static: { hp: 400 }, faction: "march", state: "alive" } })).body.result).toEqual({ ok: true });
      expect((await rpc("nemesis.get", { world: "testland", kind: "persons", id: "alice" })).body.result).toMatchObject({ static: { hp: 400 }, source: "gm" });
      expect((await rpc("nemesis.board", { world: "../etc" })).body.error.message).toBe("bad world id");
      expect((await rpc("nemesis.board", { world: "elsewhere" })).body.error.message).toMatch(/no Nemesis records for world "elsewhere"/);
      expect((await rpc("nemesis.list", { world: "testland", kind: "secrets" })).body.error.message).toMatch(/kind must be one of/);
      expect((await rpc("maps.list")).body.error.message).toBe("unknown method maps.list");
    } finally {
      await server.stop();
    }
  });
});

describe("standalone world from Azgaar", () => {
  const az = {
    info: { mapName: "Ogeia" },
    pack: {
      cells: [{ religion: 0 }, { religion: 1 }, { religion: 4 }],
      cultures: [{ i: 0, name: "Wildlands" }, { i: 1, name: "Yotunn" }, { i: 2, name: "Gone", removed: true }],
      religions: [{ i: 0, name: "No religion" }, { i: 1, name: "Yotunn Faith" }, { i: 4, name: "Kentian Beliefs" }],
      states: [{ i: 0, name: "Neutrals" }, { i: 2, name: "March", form: "Kingdom", fullName: "Kingdom of March", culture: 1, capital: 140 }, { i: 5, name: "Old", removed: true }],
      burgs: [0, { i: 140, name: "Zugkatil", cell: 1, state: 2 }, { i: 119, name: "Narkoc", cell: 2, state: 2 }, { i: 9, name: "Razed", removed: true }],
    },
  };

  it("reads realms, towns, faiths and culture names from the export alone", () => {
    expect(azgaarCultures(az)).toEqual([{ i: 0, name: "Wildlands" }, { i: 1, name: "Yotunn" }]);
    expect(() => azgaarCultures({})).toThrow(/not an Azgaar full JSON export/);
    const { world: w, title } = azgaarWorld(az);
    expect(title).toBe("Ogeia");
    expect(w.states.find((s) => s.id === 2)).toEqual({ id: 2, name: "March", form: "Kingdom", fullName: "Kingdom of March", culture: 1, religion: 1, capital: 140, origin: "old", alive: true });
    expect(w.burgs.map((b) => b.name)).toEqual(["Zugkatil", "Narkoc"]);
    const items = worldRecords({ aged: w, cultures: azgaarCultures(az) });
    expect(items.find((i) => i.record.id === "march")!.record).toMatchObject({ culture: "Yotunn", faith: "Yotunn Faith", capital: 140 });
    expect(items.filter((i) => i.kind === "persons")).toEqual([]); // no lore, no rulers
    expect(atlasOf(w, { source: "azgaar", title })).toEqual({ source: "azgaar", title: "Ogeia", realms: [{ id: 2, name: "Kingdom of March" }], towns: [{ id: 140, name: "Zugkatil", state: 2 }, { id: 119, name: "Narkoc", state: 2 }] });
  });
});
