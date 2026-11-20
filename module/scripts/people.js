/**
 * People in Foundry: the actor and the GM journal page for a person the companion made, and their
 * portrait. Card first (the record), then a token by species (in the actor data), then the
 * portrait, painted in the background; both the repaint and the layout are kept and the GM picks.
 */

import { artHtml, journalHtml, pickedArt } from "./board-html.js";

const MODULE_ID = "georgios-nemesis";
const ROOT = "Georgios' Nemesis";
const tr = (key, data) => (data ? game.i18n.format(`GN.${key}`, data) : game.i18n.localize(`GN.${key}`));

/** Foundry's image popout class (v13+ and older). */
const Popout = () => foundry.applications?.apps?.ImagePopout ?? globalThis.ImagePopout;

/**
 * Puts the person's portraits at the top of their card (the GM journal page), in place of what was
 * there; the rest of the page, GM edits included, stays as it is.
 */
export async function refreshCardArt(record) {
  const journal = record.links?.journal ? await fromUuid(record.links.journal) : null;
  const page = journal?.pages.contents[0];
  if (!page || page.type !== "text") return;
  const doc = new DOMParser().parseFromString(`<body>${page.text.content ?? ""}</body>`, "text/html");
  const fresh = artHtml(record, tr);
  const old = doc.body.querySelector(".gn-art");
  if (old) old.outerHTML = fresh;
  else doc.body.insertAdjacentHTML("afterbegin", fresh);
  const next = doc.body.innerHTML;
  if (next !== page.text.content) await page.update({ "text.content": next });
}

/** Shows only the picture on the players' screens: no name, nothing from the card. */
async function showPlayers(src) {
  const pop = new (Popout())({ src, window: { title: tr("Card.PortraitTitle") }, shareable: true, showTitle: false });
  // Foundry tells the GM it was shown.
  if (typeof pop.shareImage === "function") await pop.shareImage({ title: "", showTitle: false });
  else {
    game.socket.emit("shareImage", { image: src, title: "", showTitle: false });
    ui.notifications.info(tr("Card.Shown"));
  }
}

/** The world a person's card (GM journal) belongs to, from the journal's flags. */
export function cardWorld(personId) {
  return game.journal.find((j) => j.getFlag(MODULE_ID, "person") === personId)?.getFlag(MODULE_ID, "world");
}

/**
 * Clicks on a card's portraits, wherever the card is open: the link shows that picture to the
 * players; the picture itself opens large for the GM; Reroll opens the reroll box (onReroll).
 */
export function initCardArt({ onReroll } = {}) {
  document.addEventListener("click", (ev) => {
    const again = ev.target.closest?.(".gn-art .gn-reroll");
    if (again && game.user.isGM) {
      ev.preventDefault();
      ev.stopPropagation();
      onReroll?.(again.dataset.person);
      return;
    }
    const link = ev.target.closest?.(".gn-card-art .gn-show-players");
    const img = link ? null : ev.target.closest?.(".gn-card-art img");
    if ((!link && !img) || !game.user.isGM) return;
    ev.preventDefault();
    ev.stopPropagation();
    const src = (link ? link.closest(".gn-card-art")?.querySelector("img") : img)?.getAttribute("src");
    if (!src) return;
    if (link) showPlayers(src).catch((e) => ui.notifications.error(e.message));
    // Large for the GM; its own "show" button still keeps the name off the players' screens.
    else new (Popout())({ src, window: { title: img.getAttribute("alt") || tr("Card.PortraitTitle") }, showTitle: false }).render({ force: true });
  }, true);
}

export async function folder(type, name, parent = null) {
  const found = game.folders.find((f) => f.type === type && f.name === name && (f.folder?.id ?? null) === (parent?.id ?? null));
  return found ?? Folder.create({ name, type, folder: parent?.id ?? null, flags: { [MODULE_ID]: { root: !parent } } });
}

/** Foundry's file picker class (v13+ and older). */
const FP = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

async function upload(blob, dir, name) {
  const parts = dir.split("/");
  for (let i = 1; i <= parts.length; i++) {
    try {
      await FP().createDirectory("data", parts.slice(0, i).join("/"));
    } catch {
      /* exists */
    }
  }
  const res = await FP().upload("data", dir, new File([blob], name, { type: blob.type || "image/png" }), {}, { notify: false });
  if (!res?.path) throw new Error("upload to Foundry failed");
  return res.path;
}

/**
 * Makes the actor and the journal for a freshly generated person and links them on the record.
 * Returns the record with its links.
 */
export async function createInFoundry({ world, person, actor, factionName, sub, rpc, t }) {
  const actorRoot = await folder("Actor", ROOT);
  let actorFolder = await folder("Actor", factionName ?? t("Outside"), actorRoot);
  if (sub) actorFolder = await folder("Actor", sub, actorFolder);
  const made = await Actor.create({ ...actor, folder: actorFolder.id });
  const journal = await makeJournal({ world, person, factionName, sub, t });
  const record = { ...person, links: { ...(person.links ?? {}), actor: made.uuid, journal: journal.uuid } };
  await rpc("nemesis.put", { world, kind: "persons", record });
  return record;
}

/** The GM journal page for a person (GM only): their full card. */
async function makeJournal({ world, person, factionName, sub, t }) {
  const journalRoot = await folder("JournalEntry", ROOT);
  let journalFolder = await folder("JournalEntry", factionName ?? t("Outside"), journalRoot);
  if (sub) journalFolder = await folder("JournalEntry", sub, journalFolder);
  return JournalEntry.create({
    name: person.name,
    folder: journalFolder.id,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    pages: [{ name: person.name, type: "text", text: { content: journalHtml(person, t), format: 1 } }],
    flags: { [MODULE_ID]: { world, person: person.id } },
  });
}

/**
 * Opens a person's full card (their GM journal page), making it again if it was deleted.
 * Returns the journal.
 */
export async function openCard({ world, personId, rpc, t }) {
  const record = await rpc("nemesis.get", { world, kind: "persons", id: personId });
  let journal = record.links?.journal ? await fromUuid(record.links.journal) : null;
  if (!journal) {
    const faction = record.faction ? await rpc("nemesis.get", { world, kind: "factions", id: record.faction }).catch(() => null) : null;
    // Townsfolk are filed under their town; Map Maker names its places "<town>: <place>".
    const sub = record.post ? record.post.scene?.split(":")[0]?.trim() : undefined;
    journal = await makeJournal({ world, person: record, factionName: faction?.name, sub, t });
    await rpc("nemesis.put", { world, kind: "persons", record: { ...record, links: { ...(record.links ?? {}), journal: journal.uuid } } });
  }
  // Cards written before portraits sat in them get theirs now.
  await refreshCardArt({ ...record, links: { ...(record.links ?? {}), journal: journal.uuid } });
  journal.sheet?.render(true);
  return journal;
}

/** Fetches a portrait from the companion and uploads it into Foundry's data folder. */
async function bring(base, world, personId, which) {
  const res = await fetch(`${base}/art/${encodeURIComponent(world)}/${encodeURIComponent(personId)}/${which}.png?v=${Date.now()}`);
  if (!res.ok) throw new Error(`portrait ${which}: the companion answered ${res.status}`);
  return upload(await res.blob(), `${MODULE_ID}/${world}`, `${personId}-${which}-${Date.now()}.png`);
}

/**
 * Puts the picked portrait on the actor (its sheet picture) and in their card. Tokens keep the
 * species token (the GM's call: portraits are for the card and the players, not the map).
 */
export async function applyArt(record) {
  const src = pickedArt(record.art);
  const actor = record.links?.actor ? await fromUuid(record.links.actor) : null;
  if (!actor || !src) return;
  if (actor.img !== src) await actor.update({ img: src });
  await dressTokens(record);
  await refreshCardArt(record);
}

/**
 * Every token Nemesis cast as this person, on any scene (Map Maker's townsfolk): their actor,
 * their name with their role, and the species token their actor carries.
 */
export async function dressTokens(record) {
  const actor = record.links?.actor ? await fromUuid(record.links.actor) : null;
  if (!actor) return 0;
  const img = actor.prototypeToken?.texture?.src;
  let n = 0;
  for (const scene of game.scenes) {
    const ups = scene.tokens
      .filter((tk) => tk.getFlag(MODULE_ID, "cast")?.person === record.id)
      .map((tk) => {
        const cast = tk.getFlag(MODULE_ID, "cast");
        const up = { _id: tk.id, name: `${record.name}, ${cast.label ?? cast.role}`, actorId: actor.id, actorLink: true };
        if (img) Object.assign(up, { "texture.src": img, "texture.tint": "#ffffff", "ring.subject.texture": null });
        return up;
      })
      .filter((up) => {
        const tk = scene.tokens.get(up._id);
        return tk.name !== up.name || tk.actorId !== up.actorId || !tk.actorLink || (up["texture.src"] && (tk.texture.src !== up["texture.src"] || tk._source.ring?.subject?.texture));
      });
    if (ups.length) {
      await scene.updateEmbeddedDocuments("Token", ups);
      n += ups.length;
    }
  }
  return n;
}

/**
 * Paints a person: starts the companion's job, waits for it, brings both images into Foundry,
 * records them (picked: the repaint, until the GM picks otherwise) and dresses the actor.
 * notes: the GM's corrections for this reroll (the companion keeps them for later ones);
 * forget: drop the earlier corrections.
 */
export async function paint({ base, world, record, rpc, onState, notes, forget }) {
  const { job } = await rpc("nemesis.portrait", { world, id: record.id, ...(notes ? { notes } : {}), ...(forget ? { forget: true } : {}) });
  onState?.("running");
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await rpc("nemesis.job", { id: job });
    if (st.state === "failed") throw new Error(st.error ?? "the portrait failed");
    if (st.state !== "done") {
      onState?.(st.state, st.last);
      continue;
    }
    const images = {};
    if (st.files?.final) images.final = await bring(base, world, record.id, "final");
    if (st.files?.layout) images.layout = await bring(base, world, record.id, "layout");
    // Onto the record as it is now: the companion may have written the corrections and the new
    // description into its art meanwhile.
    const fresh = await rpc("nemesis.get", { world, kind: "persons", id: record.id });
    const art = { ...(fresh.art ?? {}), ...images };
    art.picked = art.final ? "final" : "layout";
    const next = { ...fresh, art };
    await rpc("nemesis.put", { world, kind: "persons", record: next });
    await applyArt(next);
    return next;
  }
}

/**
 * Once per world: people whose tokens became their portrait (before 2026-11-20 Nemesis cut the
 * portrait into the token) get their species token back, on the actor and on every scene. Needs
 * the companion (it knows each species' token); tried again on the next load if it is not running.
 */
export async function restoreSpeciesTokens(rpc, isDown = () => false) {
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
  if ((game.settings.get(MODULE_ID, "tokenLook") ?? 1) >= 2) return;
  let done = true;
  for (const actor of game.actors.filter((a) => a.getFlag(MODULE_ID, "person") && a.getFlag(MODULE_ID, "world"))) {
    let species;
    try {
      species = (await rpc("nemesis.actor", { world: actor.getFlag(MODULE_ID, "world"), id: actor.getFlag(MODULE_ID, "person") }))?.prototypeToken?.texture?.src;
    } catch (e) {
      // The companion is not running: all of it again on the next load. No person on record for this
      // actor (deleted, or made against other records): left as it is.
      if (isDown(e)) {
        done = false;
        break;
      }
      console.warn(`${MODULE_ID} | ${actor.name}: no person on record, token left as it is (${e.message})`);
      continue;
    }
    if (!species) continue;
    if (actor.prototypeToken.texture.src !== species || actor._source.prototypeToken?.ring?.subject?.texture) {
      await actor.update({ "prototypeToken.texture.src": species, "prototypeToken.ring.subject.texture": null });
    }
    for (const scene of game.scenes) {
      const ups = scene.tokens
        .filter((tk) => tk.actorId === actor.id && tk.actorLink && (tk.texture.src !== species || tk._source.ring?.subject?.texture))
        .map((tk) => ({ _id: tk.id, "texture.src": species, "ring.subject.texture": null }));
      if (ups.length) await scene.updateEmbeddedDocuments("Token", ups);
    }
  }
  if (done) await game.settings.set(MODULE_ID, "tokenLook", 2);
}

/**
 * Puts a person's token on the scene the GM is looking at, in the middle of the view (snapped to
 * the grid). If they are there already, the view goes to them instead.
 */
export async function placeOnScene(actorUuid, t) {
  const actor = await fromUuid(actorUuid);
  const scene = canvas?.scene;
  if (!actor || !scene) return ui.notifications.warn(t("PlaceNoScene"));
  const have = scene.tokens.find((tk) => tk.actorId === actor.id);
  if (have) {
    await canvas.animatePan({ x: have.x + (have.width * scene.grid.size) / 2, y: have.y + (have.height * scene.grid.size) / 2 });
    have.object?.control({ releaseOthers: true });
    return ui.notifications.info(t("PlaceAlready", { name: actor.name }));
  }
  const c = canvas.stage.pivot;
  const half = scene.grid.size / 2;
  const at = canvas.grid.getSnappedPoint?.({ x: c.x - half, y: c.y - half }, { mode: CONST.GRID_SNAPPING_MODES.TOP_LEFT_VERTEX }) ?? { x: c.x - half, y: c.y - half };
  const doc = await actor.getTokenDocument({ x: at.x, y: at.y });
  await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
  ui.notifications.info(t("Placed", { name: actor.name, scene: scene.name }));
}

/** The GM picks the repaint or the layout for a person. */
export async function pick({ world, personId, which, rpc }) {
  const record = await rpc("nemesis.get", { world, kind: "persons", id: personId });
  if (!record.art?.[which]) return record;
  const next = { ...record, art: { ...record.art, picked: which } };
  await rpc("nemesis.put", { world, kind: "persons", record: next });
  await applyArt(next);
  return next;
}
