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
import { createInFoundry, dressTokens, folder, paint } from "./people.js";

const MODULE_ID = "georgios-nemesis";
const MAP_MAKER = "georgios-map-maker";
const ROOT = "Georgios' Nemesis";

/** { rpc, t, base, NotRunning } from main.js. */
let api = null;
const running = new Map();
const again = new Set();
/** Main people being written now (world|place|role|n). */
const writing = new Set();
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
  const slow = setTimeout(() => ui.notifications.info(api.t("Cast.FirstFolk")), 8000);
  let res;
  try {
    res = await api.rpc("nemesis.cast", {
      world, townName: where.townName, place: where.place, scene: scene.name,
      people: tokens.map((tk, i) => ({ kind: tk.getFlag(MAP_MAKER, "kind"), role: tk.getFlag(MAP_MAKER, "role"), seed: seeds[i] })),
    });
  } finally {
    clearTimeout(slow);
  }
  const actors = await folkActors(world, res.culture, res.people.filter((r) => !r.person));
  const ups = [];
  for (const [i, tk] of tokens.entries()) {
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
  for (const r of res.people.filter((x) => x.person)) await dressPerson(world, res, r.person);
  for (const r of res.people.filter((x) => x.main && !x.person)) {
    writeKeeper(world, { town: res.town, faction: res.faction }, r).catch((e) => report(e, api.t("Cast.KeeperFailed", { role: r.role })));
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

/** Claude writes one of a scene's main people; then their actor, journal, tokens and portrait. */
async function writeKeeper(world, where, r) {
  const k = `${world}|${postKey(r.post)}`;
  if (writing.has(k)) return;
  writing.add(k);
  try {
    ui.notifications.info(api.t("Cast.Writing", { name: r.folk.name, role: r.role, town: where.town.name }));
    const out = await api.rpc("nemesis.keeper", {
      world, town: where.town.id, place: r.post.place, role: r.role, n: r.post.n, scene: r.post.scene, rank: r.rank, name: r.folk.name, species: r.folk.species,
    });
    let record = out.person;
    if (!(record.links?.actor && (await fromUuid(record.links.actor)))) {
      const faction = where.faction ? await api.rpc("nemesis.get", { world, kind: "factions", id: where.faction }).catch(() => null) : null;
      record = await createInFoundry({ world, person: record, actor: out.actor, factionName: faction?.name, sub: where.town.name, rpc: api.rpc, t: api.t });
    }
    await markPost(r.post, record.id);
    await dressTokens(record);
    const caps = await api.rpc("nemesis.capabilities").catch(() => ({}));
    const paintNow = !!caps.portraits && !pickedArt(record.art);
    ui.notifications.info(api.t(paintNow ? "Cast.Ready" : "Cast.ReadyNoArt", { name: record.name }));
    if (paintNow) {
      const next = await paint({ base: api.base(), world, record, rpc: api.rpc });
      ui.notifications.info(api.t("Cast.Painted", { name: next.name }));
    }
  } finally {
    writing.delete(k);
  }
}

/** The Nemesis button on a Map Maker townsperson's token HUD. */
function addHudButton(hud, html) {
  const tk = hud.object?.document;
  if (!game.user.isGM || !tk?.getFlag(MAP_MAKER, "person")) return;
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
    whoIs(tk).catch((e) => report(e, api.t("Cast.Hud")));
  });
  col.append(b);
}

async function whoIs(tk) {
  const c = tk.getFlag(MODULE_ID, "cast");
  const t = api.t;
  const DialogV2 = foundry.applications.api.DialogV2;
  if (!c) return ui.notifications.info(`${tk.name}: ${t("Cast.SettingHint")}`);
  const row = (label, v) => (v ? `<p><strong>${esc(label)}:</strong> ${esc(v)}</p>` : "");
  if (c.person) {
    const record = await api.rpc("nemesis.get", { world: c.world, kind: "persons", id: c.person });
    const choice = await DialogV2.wait({
      window: { title: record.name },
      content: `<div class="gn-form">${row(t("Cast.Role"), c.label)}${row(t("Cast.Species"), record.species)}<p>${esc(record.look ?? "")}</p><p class="gn-hint">${esc(t("Cast.Written", { name: record.name }))}</p></div>`,
      buttons: [
        { action: "actor", label: t("Cast.OpenActor"), icon: "fa-solid fa-user-shield" },
        { action: "journal", label: t("Cast.OpenJournal"), icon: "fa-solid fa-book", default: true },
      ],
      rejectClose: false,
    });
    const uuid = choice === "actor" ? record.links?.actor : choice === "journal" ? record.links?.journal : null;
    if (uuid) (await fromUuid(uuid))?.sheet?.render(true);
    return;
  }
  const go = await DialogV2.confirm({
    window: { title: c.name },
    content: `<div class="gn-form">${row(t("Cast.Role"), c.label)}${row(t("Cast.Species"), c.species)}${row(t("Look").replace(/:$/, ""), c.look)}${row(t("Cast.Manner"), c.manner)}${row(t("Cast.Rank"), t(`Rank.${c.rank}`))}<p class="gn-hint">${esc(t("Cast.Background"))}</p><p class="gn-hint">${esc(t("Cast.WriteUpHint"))}</p></div>`,
    yes: { label: t("Cast.WriteUp"), icon: "fa-solid fa-wand-sparkles" },
    no: { label: t("Cast.Close") },
    rejectClose: false,
  });
  if (go) await writeKeeper(c.world, { town: c.town, faction: c.faction }, { post: c.post, role: c.role, rank: c.rank, folk: { name: c.name, species: c.species } });
}
