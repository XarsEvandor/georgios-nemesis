/**
 * People in Foundry: the actor and the GM journal page for a person the companion made, and their
 * portrait. Card first (the record), then a token by species (in the actor data), then the
 * portrait, painted in the background; both the repaint and the layout are kept and the GM picks.
 */

import { journalHtml, pickedArt } from "./board-html.js";

const MODULE_ID = "georgios-nemesis";
const ROOT = "Georgios' Nemesis";

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
  const journalRoot = await folder("JournalEntry", ROOT);
  let journalFolder = await folder("JournalEntry", factionName ?? t("Outside"), journalRoot);
  if (sub) journalFolder = await folder("JournalEntry", sub, journalFolder);
  const journal = await JournalEntry.create({
    name: person.name,
    folder: journalFolder.id,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
    pages: [{ name: person.name, type: "text", text: { content: journalHtml(person, t), format: 1 } }],
    flags: { [MODULE_ID]: { world, person: person.id } },
  });
  const record = { ...person, links: { ...(person.links ?? {}), actor: made.uuid, journal: journal.uuid } };
  await rpc("nemesis.put", { world, kind: "persons", record });
  return record;
}

/** Fetches a portrait from the companion and uploads it into Foundry's data folder. */
async function bring(base, world, personId, which) {
  const res = await fetch(`${base}/art/${encodeURIComponent(world)}/${encodeURIComponent(personId)}/${which}.png?v=${Date.now()}`);
  if (!res.ok) throw new Error(`portrait ${which}: the companion answered ${res.status}`);
  return upload(await res.blob(), `${MODULE_ID}/${world}`, `${personId}-${which}-${Date.now()}.png`);
}

/** Puts the picked portrait on the actor and its token (with a ring). */
export async function applyArt(record) {
  const src = pickedArt(record.art);
  const actor = record.links?.actor ? await fromUuid(record.links.actor) : null;
  if (!actor || !src) return;
  await actor.update({
    img: src,
    "prototypeToken.texture.src": src,
    "prototypeToken.ring.enabled": true,
    "prototypeToken.ring.subject.texture": src,
  });
  for (const tok of actor.getActiveTokens?.(false, true) ?? []) await tok.update({ "texture.src": src, "ring.enabled": true, "ring.subject.texture": src });
  await dressTokens(record);
}

/**
 * Every token Nemesis cast as this person, on any scene (Map Maker's townsfolk): their actor,
 * their name with their role, and their picked portrait.
 */
export async function dressTokens(record) {
  const actor = record.links?.actor ? await fromUuid(record.links.actor) : null;
  if (!actor) return 0;
  const src = pickedArt(record.art);
  let n = 0;
  for (const scene of game.scenes) {
    const ups = scene.tokens
      .filter((tk) => tk.getFlag(MODULE_ID, "cast")?.person === record.id)
      .map((tk) => {
        const cast = tk.getFlag(MODULE_ID, "cast");
        const up = { _id: tk.id, name: `${record.name}, ${cast.label ?? cast.role}`, actorId: actor.id, actorLink: true };
        const img = src ?? actor.prototypeToken?.texture?.src;
        if (img) Object.assign(up, { "texture.src": img, "texture.tint": "#ffffff", "ring.enabled": true, "ring.subject.texture": img });
        return up;
      })
      .filter((up) => {
        const tk = scene.tokens.get(up._id);
        return tk.name !== up.name || tk.actorId !== up.actorId || !tk.actorLink || (up["texture.src"] && tk.texture.src !== up["texture.src"]);
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
 */
export async function paint({ base, world, record, rpc, onState }) {
  const { job } = await rpc("nemesis.portrait", { world, id: record.id });
  onState?.("running");
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const st = await rpc("nemesis.job", { id: job });
    if (st.state === "failed") throw new Error(st.error ?? "the portrait failed");
    if (st.state !== "done") {
      onState?.(st.state, st.last);
      continue;
    }
    const art = { ...(record.art ?? {}) };
    if (st.files?.final) art.final = await bring(base, world, record.id, "final");
    if (st.files?.layout) art.layout = await bring(base, world, record.id, "layout");
    art.picked = art.final ? "final" : "layout";
    const fresh = await rpc("nemesis.get", { world, kind: "persons", id: record.id });
    const next = { ...fresh, art };
    await rpc("nemesis.put", { world, kind: "persons", record: next });
    await applyArt(next);
    return next;
  }
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
