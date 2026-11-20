/**
 * The scene cast in Foundry. When the GM opens a place Georgios' Map Maker built, Nemesis recasts
 * the placeholder townsfolk Map Maker put there (tokens with Map Maker's "person" flag) from the
 * town's culture. Card, then token, then art:
 * - Everyone at once, with no Claude call: a name, species, look and manner from the companion's
 *   folk book (the same people each time the place is opened), a token by species, and a stat
 *   block from the rank ladder in place of the SRD one.
 * - The keeper of the place (or one or two main people): Claude writes them in full, they get an
 *   actor, a GM journal page and a portrait, and they stay on record, so the next visit (or a
 *   rebuilt map) finds the same person. The token HUD button makes anyone else a main person.
 * Map Maker is never changed: Nemesis reads its flags and edits only the tokens it placed. With
 * Nemesis off (or its setting off), Map Maker's placeholders stay as they are.
 */

import { esc, pickedArt, pickWorld } from "./board-html.js";
import { createInFoundry, dressTokens, folder, openCard, paint } from "./people.js";
import { track } from "./progress.js";

const MODULE_ID = "georgios-nemesis";
const MAP_MAKER = "georgios-map-maker";
const SCRIBBLER = "georgios-scribbler";
const ROOT = "Georgios' Nemesis";

/** { rpc, t, base, NotRunning } from main.js. */
let api = null;
const running = new Map();
const again = new Set();
/** Main people being written now (world|place|role|n). */
const writing = new Set();
/** Their sketches, while the full card is still being written (same keys). */
const sketches = new Map();
let toldDown = false;
let worlds = null;
let actorChain = Promise.resolve();

const active = (id) => !!game.modules.get(id)?.active;
const leadGm = () => game.user.isGM && game.users.activeGM?.id === game.user.id;
const postKey = (p) => `${p.place}|${p.role}|${p.n}`;

export function initCast(deps) {
  api = deps;
  game.settings.register(MODULE_ID, "castTownsfolk", { name: "GN.Cast.Setting", hint: "GN.Cast.SettingHint", scope: "world", config: true, type: Boolean, default: true });
  // On the GM's look at a place, after Map Maker has had its own look (it may place the townsfolk then).
  Hooks.on("canvasReady", (c) => schedule(c.scene, 1500));
  // Map Maker (re)placed the townsfolk of the place the GM is looking at.
  Hooks.on("updateScene", (scene, changes) => {
    const mm = changes.flags?.[MAP_MAKER];
    if (mm && ("people" in mm || "peopleLook" in mm) && scene.id === canvas.scene?.id) schedule(scene, 300);
  });
  Hooks.on("renderTokenHUD", addHudButton);
}

function wanted(scene) {
  return !!scene && leadGm() && active(MAP_MAKER) && game.settings.get(MODULE_ID, "castTownsfolk") && !!scene.getFlag(MAP_MAKER, "mapId") && !!scene.getFlag(MAP_MAKER, "city");
}

function schedule(scene, delay) {
  if (wanted(scene)) setTimeout(() => run(scene.id), delay);
}

function run(id) {
  if (running.has(id)) return again.add(id);
  const scene = game.scenes.get(id);
  if (!scene) return;
  const job = castScene(scene)
    .catch((e) => report(e, api.t("Cast.Failed", { scene: scene.name })))
    .finally(() => {
      running.delete(id);
      if (again.delete(id)) run(id);
    });
  running.set(id, job);
}

function report(e, what) {
  if (e instanceof api.NotRunning) {
    if (!toldDown) ui.notifications.warn(api.t("Cast.Down"));
    toldDown = true;
    return;
  }
  console.error(`${MODULE_ID} | ${what}`, e);
  ui.notifications.warn(`${what}: ${e.message}`);
}

/**
 * What a townsperson's token still is: Map Maker's placeholder ("Alys, dockworker" -> given "Alys"),
 * the person Nemesis cast it as, or renamed by the GM (someone now: never recast).
 */
function placeholderOf(tk) {
  const c = tk.getFlag(MODULE_ID, "cast");
  if (c) {
    if (c.person) return { given: String(c.orig ?? "").split(",")[0].trim() };
    const ours = tk.name === `${c.name}, ${c.label ?? c.role}`;
    return ours ? { given: String(c.orig ?? "").split(",")[0].trim() } : { renamed: true };
  }
  const m = String(tk.name ?? "").match(/^([^,]+),\s*(.+)$/);
  const role = String(tk.getFlag(MAP_MAKER, "role") ?? "").trim().toLowerCase();
  if (!m || m[2].trim().toLowerCase() !== role) return { renamed: true };
  return { given: m[1].trim() };
}

/** Names of the Scribbler's entries and their aliases (the people the table has met), when it is active. */
function scribblerNames() {
  if (!active(SCRIBBLER)) return [];
  const out = [];
  for (const j of game.journal) {
    if (j.getFlag(SCRIBBLER, "kind") !== "entity") continue;
    out.push(j.name, ...(j.getFlag(SCRIBBLER, "aliases") ?? []));
  }
  return out.filter((s) => typeof s === "string" && s.trim());
}

/** The town and place of a Map Maker place scene, from its city scene and the city's pin for it. */
function placeOf(scene) {
  const key = scene.getFlag(MAP_MAKER, "city");
  const city = game.scenes.find((s) => s.getFlag(MAP_MAKER, "city") === key && !s.getFlag(MAP_MAKER, "mapId"));
  const pin = city?.notes.find((n) => n.getFlag(MAP_MAKER, "scene") === scene.id && n.getFlag(MAP_MAKER, "place"));
  return {
    townName: city?.getFlag(MAP_MAKER, "cityName") ?? null,
    mapWorld: city?.getFlag(MAP_MAKER, "worldOf") ?? null,
    place: pin ? `${key}:${pin.getFlag(MAP_MAKER, "place")}` : `map:${scene.getFlag(MAP_MAKER, "mapId")}`,
  };
}

/** The Nemesis world for a Map Maker world (same id), else the one the board would pick. */
async function worldFor(mapWorld) {
  worlds ??= await api.rpc("nemesis.worlds");
  if (mapWorld && worlds.some((w) => w.id === mapWorld)) return mapWorld;
  return pickWorld(worlds, game.scenes.map((s) => s.getFlag(MAP_MAKER, "world")).filter(Boolean))?.id;
}

/** The shared actors of background townsfolk (one per species and rank), made once. */
function folkActors(world, culture, rows) {
  const job = actorChain.then(async () => {
    const out = new Map();
    const wants = [];
    for (const r of rows) {
      if (out.has(r.actorKey) || wants.some((w) => w.key === r.actorKey)) continue;
      const have = game.actors.find((a) => a.getFlag(MODULE_ID, "folk") === r.actorKey && a.getFlag(MODULE_ID, "world") === world);
      if (have) out.set(r.actorKey, have);
      else wants.push({ key: r.actorKey, culture, species: r.folk.species, rank: r.rank });
    }
    if (wants.length) {
      const data = await api.rpc("nemesis.folkActors", { world, wants });
      const dir = await folder("Actor", api.t("Townsfolk"), await folder("Actor", ROOT));
      for (const [key, d] of Object.entries(data)) out.set(key, await Actor.create({ ...d, folder: dir.id }));
    }
    return out;
  });
  actorChain = job.catch(() => undefined);
  return job;
}

async function castScene(scene) {
  const tokens = scene.tokens.filter((tk) => tk.getFlag(MAP_MAKER, "person"));
  if (!tokens.length) return;
  const where = placeOf(scene);
  if (!where.townName) return;
  const world = await worldFor(where.mapWorld);
  if (!world) return;
  // Map Maker's own placeholder name seeds each person, so a re-placed scene brings them back.
  const seeds = tokens.map((tk) => tk.getFlag(MODULE_ID, "cast")?.orig ?? tk.name);
  const marks = tokens.map(placeholderOf);
  // Usually instant; the corner panel shows it only when it is not (a culture's first folk book).
  let row = null;
  const slow = setTimeout(() => (row = track({ title: scene.name, detail: api.t("Progress.Casting") })), 1500);
  const slower = setTimeout(() => row?.update({ detail: api.t("Progress.FirstFolk") }), 8000);
  let res;
  try {
    res = await api.rpc("nemesis.cast", {
      world, townName: where.townName, place: where.place, scene: scene.name, known: scribblerNames(),
      people: tokens.map((tk, i) => ({ kind: tk.getFlag(MAP_MAKER, "kind"), role: tk.getFlag(MAP_MAKER, "role"), seed: seeds[i], ...marks[i] })),
    });
    row?.remove();
  } catch (e) {
    row?.fail(e.message);
    throw e;
  } finally {
    clearTimeout(slow);
    clearTimeout(slower);
  }
  const actors = await folkActors(world, res.culture, res.people.filter((r) => !r.person && !r.skip));
  const ups = [];
  const actorIdOf = (person) => String(person?.links?.actor ?? "").split(".").pop();
  for (const [i, tk] of tokens.entries()) {
    // Someone the table knows, or a token the GM renamed: left exactly as it is.
    if (res.people[i].skip) continue;
    // The person already stands here on their own token (Map Maker kept it when it placed the
    // townsfolk again): this new placeholder for the same place stays background folk.
    const pid = actorIdOf(res.people[i].person);
    if (pid && tk.actorId !== pid && scene.tokens.some((o) => o.id !== tk.id && o.actorLink && o.actorId === pid)) res.people[i] = { ...res.people[i], person: undefined, main: false };
    const r = res.people[i];
    const label = tk.getFlag(MAP_MAKER, "role") ?? r.role;
    const cast = {
      orig: seeds[i], world, culture: res.culture, town: res.town, faction: res.faction ?? null, kind: tk.getFlag(MAP_MAKER, "kind") ?? "commoner",
      name: r.folk.name, species: r.folk.species, look: r.folk.look, manner: r.folk.manner, rank: r.rank, role: r.role, label, post: r.post, main: r.main,
      person: r.person?.id ?? null,
    };
    const flagSame = JSON.stringify(tk.getFlag(MODULE_ID, "cast") ?? null) === JSON.stringify(cast);
    if (r.person) {
      // Dressed as that person below.
      if (!flagSame) ups.push({ _id: tk.id, [`flags.${MODULE_ID}.cast`]: cast });
      continue;
    }
    const actor = actors.get(r.actorKey);
    const name = `${r.folk.name}, ${label}`;
    // The unlinked token's own actor keeps a name too (Foundry copied Map Maker's placeholder there).
    const up = { _id: tk.id, name, "delta.name": name, actorId: actor?.id ?? tk.actorId, actorLink: false, "texture.src": r.folk.token, "texture.tint": "#ffffff", [`flags.${MODULE_ID}.cast`]: cast };
    if (flagSame && tk.name === name && tk.delta?.name === name && tk.actorId === up.actorId && !tk.actorLink && tk.texture.src === up["texture.src"]) continue;
    ups.push(up);
  }
  if (ups.length) await scene.updateEmbeddedDocuments("Token", ups);
  for (const r of res.people.filter((x) => x.person && !x.skip)) await dressPerson(world, res, r.person);
  for (const r of res.people.filter((x) => x.main && !x.person && !x.skip)) {
    // A failure shows on its row in the corner panel; a stopped companion is told once.
    writeKeeper(world, { town: res.town, faction: res.faction }, r).catch((e) => (e instanceof api.NotRunning ? report(e, "") : console.error(`${MODULE_ID} | ${r.role}`, e)));
  }
}

/** A person on record: their actor (made again if it was deleted) on every token cast as them. */
async function dressPerson(world, res, person) {
  let record = person;
  if (!(record.links?.actor && (await fromUuid(record.links.actor)))) {
    const full = await api.rpc("nemesis.get", { world, kind: "persons", id: person.id });
    const actor = await api.rpc("nemesis.actor", { world, id: person.id });
    const faction = res.faction ? await api.rpc("nemesis.get", { world, kind: "factions", id: res.faction }).catch(() => null) : null;
    record = await createInFoundry({ world, person: full, actor, factionName: faction?.name, sub: res.town?.name, rpc: api.rpc, t: api.t });
  }
  await dressTokens(record);
  return record;
}

/** Marks every token of a place's role, on any scene, as this person. */
async function markPost(post, personId) {
  for (const scene of game.scenes) {
    const ups = scene.tokens
      .filter((tk) => {
        const c = tk.getFlag(MODULE_ID, "cast");
        return c?.post && postKey(c.post) === postKey(post) && c.person !== personId;
      })
      .map((tk) => ({ _id: tk.id, [`flags.${MODULE_ID}.cast.person`]: personId }));
    if (ups.length) await scene.updateEmbeddedDocuments("Token", ups);
  }
}

/**
 * Claude writes one of a scene's main people; then their actor, journal, tokens and portrait. The
 * corner panel follows it: writing, then the card (click to open) while the portrait paints, then done.
 */
async function writeKeeper(world, where, r) {
  const k = `${world}|${postKey(r.post)}`;
  if (writing.has(k)) return;
  writing.add(k);
  const row = track({ title: r.folk.name, detail: api.t("Progress.Sketching", { role: r.role, town: where.town.name }) });
  const ask = { world, town: where.town.id, place: r.post.place, role: r.role, n: r.post.n, scene: r.post.scene, rank: r.rank, name: r.folk.name, species: r.folk.species };
  try {
    // First the sketch (seconds), so the GM can introduce them while the full card is written.
    let sketch;
    try {
      sketch = (await api.rpc("nemesis.sketch", ask)).sketch;
      const s = { name: r.folk.name, species: r.folk.species, role: r.role, sketch };
      sketches.set(k, s);
      row.sketch(() => showSketch(s), api.t("Progress.SketchReady"));
    } catch (e) {
      if (e instanceof api.NotRunning) throw e;
      console.warn(`${MODULE_ID} | no sketch for the ${r.role}; writing the card straight away`, e);
      row.update({ detail: api.t("Progress.Writing", { role: r.role, town: where.town.name }) });
    }
    const out = await api.rpc("nemesis.keeper", { ...ask, ...(sketch ? { sketch } : {}) });
    let record = out.person;
    if (!(record.links?.actor && (await fromUuid(record.links.actor)))) {
      const faction = where.faction ? await api.rpc("nemesis.get", { world, kind: "factions", id: where.faction }).catch(() => null) : null;
      record = await createInFoundry({ world, person: record, actor: out.actor, factionName: faction?.name, sub: where.town.name, rpc: api.rpc, t: api.t });
    }
    await markPost(r.post, record.id);
    await dressTokens(record);
    sketches.delete(k);
    const caps = await api.rpc("nemesis.capabilities").catch(() => ({}));
    const paintNow = !!caps.portraits && !pickedArt(record.art);
    row.update({ title: record.name });
    if (!paintNow) return row.done({ open: record.links?.journal, detail: api.t("Progress.Done") });
    row.ready(record.links?.journal, api.t("Progress.Painting"));
    await paint({ base: api.base(), world, record, rpc: api.rpc });
    row.done({ detail: api.t("Progress.Done") });
  } catch (e) {
    row.fail(e.message);
    e.inPanel = true;
    throw e;
  } finally {
    writing.delete(k);
  }
}

/** The sketch in a small window: enough to introduce them now. */
function showSketch(s) {
  const t = api.t;
  const p = (label, v) => (v ? `<p><strong>${esc(label)}:</strong> ${esc(v)}</p>` : "");
  const lines = s.sketch.lines?.length ? `<p><strong>${esc(t("Sketch.Lines"))}:</strong></p><ul>${s.sketch.lines.map((l) => `<li><em>"${esc(l)}"</em></li>`).join("")}</ul>` : "";
  new foundry.applications.api.DialogV2({
    window: { title: s.name, icon: "fa-solid fa-feather" },
    classes: ["gn-sketch-app"],
    position: { width: 480 },
    content: `<div class="gn-sketch"><p class="gn-sketch-who">${esc([s.species, s.role].filter(Boolean).join(", "))}</p>${p(t("Sketch.Look"), s.sketch.look)}${p(t("Sketch.Mannerisms"), s.sketch.mannerisms)}${p(t("Sketch.Voice"), s.sketch.voice)}${lines}<p class="gn-hint">${esc(t("Sketch.Hint"))}</p></div>`,
    buttons: [{ action: "close", label: t("Cast.Close"), default: true }],
  }).render({ force: true });
}

/** The Nemesis button on the token HUD: Map Maker's townsfolk, and anyone whose actor is a Nemesis person. */
function addHudButton(hud, html) {
  const tk = hud.object?.document;
  if (!game.user.isGM || !tk || !(tk.getFlag(MAP_MAKER, "person") || tk.actor?.getFlag(MODULE_ID, "person"))) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const col = root?.querySelector(".col.right") ?? root;
  if (!col || col.querySelector(".gn-hud")) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "control-icon gn-hud";
  b.dataset.tooltip = api.t("Cast.Hud");
  b.innerHTML = '<i class="fa-solid fa-chess-king"></i>';
  b.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    whoIs(tk).catch((e) => {
      if (e instanceof api.NotRunning) return report(e, "");
      console.error(`${MODULE_ID} | ${api.t("Cast.Hud")}`, e);
      // A write-up's failure already shows on its row in the corner panel.
      if (!e.inPanel) ui.notifications.warn(`${api.t("Cast.Hud")}: ${e.message}`);
    });
  });
  col.append(b);
}

async function whoIs(tk) {
  const c = tk.getFlag(MODULE_ID, "cast");
  const t = api.t;
  const DialogV2 = foundry.applications.api.DialogV2;
  // A Nemesis person's own token (placed from their actor, not one of Map Maker's): their full card.
  const personId = tk.actor?.getFlag(MODULE_ID, "person");
  const personWorld = tk.actor?.getFlag(MODULE_ID, "world");
  if (personId && personWorld && !c) return openCard({ world: personWorld, personId, rpc: api.rpc, t });
  if (!c) return ui.notifications.info(`${tk.name}: ${t("Cast.SettingHint")}`);
  const row = (label, v) => (v ? `<p><strong>${esc(label)}:</strong> ${esc(v)}</p>` : "");
  // Written up: straight to their full card. Being written: their sketch, once it is in.
  if (c.person) return openCard({ world: c.world, personId: c.person, rpc: api.rpc, t });
  const key = c.post ? `${c.world}|${postKey(c.post)}` : null;
  if (key && sketches.has(key)) return showSketch(sketches.get(key));
  if (key && writing.has(key)) return ui.notifications.info(t("Progress.Busy", { name: c.name }));
  const go = await DialogV2.confirm({
    window: { title: c.name },
    content: `<div class="gn-form">${row(t("Cast.Role"), c.label)}${row(t("Cast.Species"), c.species)}${row(t("Look").replace(/:$/, ""), c.look)}${row(t("Cast.Manner"), c.manner)}${row(t("Cast.Rank"), t(`Rank.${c.rank}`))}<p class="gn-hint">${esc(t("Cast.Background"))}</p><p class="gn-hint">${esc(t("Cast.WriteUpHint"))}</p></div>`,
    yes: { label: t("Cast.WriteUp"), icon: "fa-solid fa-wand-sparkles" },
    no: { label: t("Cast.Close") },
    rejectClose: false,
  });
  if (go) await writeKeeper(c.world, { town: c.town, faction: c.faction }, { post: c.post, role: c.role, rank: c.rank, folk: { name: c.name, species: c.species } });
}
