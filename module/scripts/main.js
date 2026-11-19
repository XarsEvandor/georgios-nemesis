/**
 * Georgios' Nemesis: Foundry VTT module (GM only).
 * A Nemesis button in the Georgios' Modules toolbar group opens the board: one tab per faction,
 * its court and chain of command, and each person's memory of the party. Generate makes a new
 * person of a faction: Claude writes the card, the companion checks it and gives the stat block,
 * and this module makes the actor, the GM journal page and, in the background, the portrait.
 * The records live in the Nemesis companion on the GM's PC (127.0.0.1:47120 by default).
 *
 * It runs on its own. With Georgios' Map Maker active it links Map Maker's realm and town journals;
 * with Georgios Scribbler active it links the Scribbler's entries. Neither is required.
 */

import { OUTSIDE, esc, navHtml, paneHtml, pickWorld } from "./board-html.js";
import { initCast } from "./cast.js";
import { offerStart, startCompanion } from "./launcher.js";
import { createInFoundry, paint, pick } from "./people.js";

const MODULE_ID = "georgios-nemesis";
const MAP_MAKER = "georgios-map-maker";
const SCRIBBLER = "georgios-scribbler";

const t = (key, data) => (data ? game.i18n.format(`GN.${key}`, data) : game.i18n.localize(`GN.${key}`));
const active = (id) => !!game.modules.get(id)?.active;

/** The companion's address: http(s) only, no trailing slash. */
function companionBase() {
  const u = new URL(game.settings.get(MODULE_ID, "companionUrl") || "http://127.0.0.1:47120");
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(t("BadUrl"));
  return `${u.protocol}//${u.host}`;
}

class NotRunning extends Error {}

async function rpc(method, params = {}) {
  let res;
  try {
    res = await fetch(`${companionBase()}/rpc`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: Date.now(), method, params }) });
  } catch (e) {
    if (e instanceof TypeError) throw new NotRunning(t("NotRunning"));
    throw e;
  }
  const body = await res.json().catch(() => ({ error: { message: t("Answered", { status: res.status }) } }));
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

/** Entity journals of Georgios Scribbler, by name and alias (only when that module is active). */
function scribblerIndex() {
  const index = new Map();
  if (!active(SCRIBBLER)) return index;
  for (const j of game.journal) {
    if (j.getFlag(SCRIBBLER, "kind") !== "entity") continue;
    for (const n of [j.name, ...(j.getFlag(SCRIBBLER, "aliases") ?? [])]) {
      const k = String(n ?? "").trim().toLowerCase();
      if (k && !index.has(k)) index.set(k, { uuid: j.uuid, name: j.name });
    }
  }
  return index;
}

/** Map Maker's journals of this world, by key ("realm-2", "town-119"), when Map Maker is active. */
function mapMakerIndex(world) {
  const index = new Map();
  if (!world || !active(MAP_MAKER)) return index;
  for (const j of game.journal) {
    if (j.getFlag(MAP_MAKER, "world") !== world) continue;
    const key = j.getFlag(MAP_MAKER, "key");
    if (key) index.set(key, { uuid: j.uuid, name: j.name });
  }
  return index;
}

/** Everyone in a faction's court and chain, for the "answers to" choice. */
function leaders(f) {
  const out = [f.ruler, ...f.archmages].filter(Boolean);
  const walk = (nodes) => nodes.forEach((n) => (out.push(n.person), walk(n.under)));
  walk(f.chain);
  return out;
}

class NemesisBoard extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "gn-board",
    classes: ["gn-board-app"],
    window: { title: "Georgios' Nemesis", resizable: true, icon: "fa-solid fa-chess-king" },
    position: { width: 1000, height: 760 },
  };

  constructor(options) {
    super(options);
    this.board = null;
    this.caps = { generate: false, portraits: false, ranks: [] };
    this.error = null;
    this.down = false;
    this.selected = null;
    this.loading = true;
    this.status = null;
    this.busy = false;
    this.painting = new Set();
    this.load();
  }

  get world() {
    return this.board?.world.id;
  }

  async load() {
    this.loading = true;
    this.error = null;
    this.down = false;
    try {
      const worlds = await rpc("nemesis.worlds");
      const imported = active(MAP_MAKER) ? game.scenes.map((s) => s.getFlag(MAP_MAKER, "world")).filter(Boolean) : [];
      const world = pickWorld(worlds, imported);
      if (!world) throw new Error(t("NoWorlds"));
      this.board = await rpc("nemesis.board", { world: world.id });
      this.caps = await rpc("nemesis.capabilities").catch(() => this.caps);
      if (!this.selected || (this.selected !== OUTSIDE && !this.board.factions.some((f) => f.id === this.selected))) this.selected = this.board.factions[0]?.id ?? OUTSIDE;
    } catch (e) {
      this.error = e.message;
      this.down = e instanceof NotRunning;
      if (this.down) offerStart().then((up) => up && this.load());
    }
    this.loading = false;
    this.render();
  }

  setStatus(text) {
    this.status = text;
    this.render();
  }

  async generate(factionId) {
    const f = this.board.factions.find((x) => x.id === factionId);
    if (!f) return;
    const ranks = (this.caps.ranks ?? []).map((r) => `<option value="${r}" ${r === "captain" ? "selected" : ""}>${esc(t(`Rank.${r}`))}</option>`).join("");
    const sups = leaders(f).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.role ? `, ${esc(p.role)}` : ""}</option>`).join("");
    const DialogV2 = foundry.applications.api.DialogV2;
    const form = await DialogV2.prompt({
      window: { title: t("GenerateTitle", { faction: f.name }) },
      content: `<div class="gn-form">
        <label>${esc(t("Rank.label"))} <select name="rank">${ranks}</select></label>
        ${sups ? `<label>${esc(t("AnswersTo"))} <select name="superior">${sups}</select></label>` : ""}
        <label>${esc(t("Note"))} <textarea name="note" rows="3" placeholder="${esc(t("NoteHint"))}"></textarea></label>
      </div>`,
      ok: { label: t("Generate"), icon: "fa-solid fa-wand-sparkles", callback: (_e, button) => Object.fromEntries(new FormData(button.form)) },
      rejectClose: false,
    });
    if (!form?.rank) return;
    this.busy = true;
    this.setStatus(t("Writing", { rank: t(`Rank.${form.rank}`), faction: f.name }));
    try {
      const { person, actor } = await rpc("nemesis.generate", { world: this.world, faction: f.id, rank: form.rank, superior: form.superior || undefined, note: form.note?.trim() || undefined });
      this.setStatus(t("Making", { name: person.name }));
      const record = await createInFoundry({ world: this.world, person, actor, factionName: f.name, rpc, t });
      ui.notifications.info(t("Made", { name: person.name }));
      this.busy = false;
      this.status = null;
      await this.load();
      if (this.caps.portraits) this.paint(record);
    } catch (e) {
      this.busy = false;
      this.setStatus(null);
      ui.notifications.error(`${t("GenerateFailed")}: ${e.message}`, { permanent: true });
    }
  }

  async paint(record) {
    if (this.painting.has(record.id)) return;
    this.painting.add(record.id);
    this.render();
    try {
      await paint({ base: companionBase(), world: this.world, record, rpc });
      ui.notifications.info(t("Painted", { name: record.name }));
    } catch (e) {
      ui.notifications.error(`${t("PaintFailed", { name: record.name })}: ${e.message}`);
    } finally {
      this.painting.delete(record.id);
      await this.load();
    }
  }

  async _renderHTML() {
    if (this.loading && !this.board) return `<p class="gn-hint gn-pad">${esc(t("Loading"))}</p>`;
    if (this.error) {
      return `<div class="gn-pad"><p class="gn-error">${esc(this.error)}</p>
        ${this.down ? `<button type="button" data-action="start"><i class="fa-solid fa-play"></i> ${esc(t("StartCompanion"))}</button>` : ""}
        <button type="button" data-action="reload"><i class="fa-solid fa-rotate"></i> ${esc(t("Refresh"))}</button></div>`;
    }
    const scribbler = scribblerIndex();
    const places = mapMakerIndex(this.board.world.mapMaker?.world);
    const ctx = {
      t, resolve: (name) => scribbler.get(String(name).trim().toLowerCase()), place: (key) => places.get(key),
      canGenerate: this.caps.generate, canPaint: this.caps.portraits, busy: this.busy, painting: this.painting,
    };
    return `<section class="gn-board">
      <div class="gn-side">
        <p class="gn-world">${esc(this.board.world.title ?? this.board.world.id)}</p>
        ${navHtml(this.board, this.selected, t)}
        <button type="button" class="gn-refresh" data-action="reload"><i class="fa-solid fa-rotate"></i> ${esc(t("Refresh"))}</button>
      </div>
      <div class="gn-main">
        ${this.status ? `<p class="gn-status"><i class="fa-solid fa-spinner fa-spin"></i> ${esc(this.status)}</p>` : ""}
        ${paneHtml(this.board, this.selected, ctx)}
      </div>
    </section>`;
  }

  _replaceHTML(result, content) {
    const pane = content.querySelector(".gn-pane");
    const keep = pane && this._lastSelected === this.selected ? pane.scrollTop : 0;
    content.innerHTML = result;
    this._lastSelected = this.selected;
    const fresh = content.querySelector(".gn-pane");
    if (fresh) fresh.scrollTop = keep;
    content.querySelectorAll("[data-faction]").forEach((el) => el.addEventListener("click", () => {
      this.selected = el.dataset.faction;
      this.render();
    }));
    content.querySelectorAll("[data-action='reload']").forEach((el) => el.addEventListener("click", () => this.load()));
    content.querySelectorAll("[data-action='start']").forEach((el) => el.addEventListener("click", async () => (await startCompanion()) && this.load()));
    content.querySelectorAll(".gn-link[data-uuid]").forEach((el) => el.addEventListener("click", async () => (await fromUuid(el.dataset.uuid))?.sheet?.render(true)));
    content.querySelectorAll("[data-generate]").forEach((el) => el.addEventListener("click", () => this.generate(el.dataset.generate)));
    content.querySelectorAll("[data-paint]").forEach((el) => el.addEventListener("click", async () => {
      const record = await rpc("nemesis.get", { world: this.world, kind: "persons", id: el.dataset.paint });
      this.paint(record);
    }));
    content.querySelectorAll("[data-pick]").forEach((el) => el.addEventListener("click", async () => {
      await pick({ world: this.world, personId: el.dataset.person, which: el.dataset.pick, rpc });
      this.load();
    }));
  }
}

let board = null;
function openBoard() {
  if (!game.user.isGM) return ui.notifications.warn(t("GmOnlyBoard"));
  if (board?.rendered) {
    board.bringToFront?.();
    return board.load();
  }
  board = new NemesisBoard();
  board.render({ force: true });
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "companionUrl", { name: "GN.CompanionUrl", hint: "GN.CompanionUrlHint", scope: "client", config: true, type: String, default: "http://127.0.0.1:47120" });
  game.settings.register(MODULE_ID, "launcherUrl", { name: "GN.LauncherUrl", hint: "GN.LauncherUrlHint", scope: "client", config: true, type: String, default: "http://127.0.0.1:47100" });
  // Map Maker's townsfolk, recast when the GM opens one of its places (only when Map Maker is active).
  initCast({ rpc, t, base: companionBase, NotRunning });
});

// The "Georgios' Modules" toolbar group, shared with the other Georgios modules: whichever loads
// first makes it, and fixed orders keep the buttons in place either way.
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const group = (controls.georgios ??= {
    name: "georgios", title: "Georgios' Modules", icon: "fa-solid fa-dragon", visible: true, tools: {},
    order: Math.max(0, ...Object.values(controls).map((c) => c.order ?? 0)) + 1,
  });
  group.tools.georgiosNemesis = { name: "georgiosNemesis", title: "GN.Open", icon: "fa-solid fa-chess-king", order: 5, button: true, visible: true, onChange: () => openBoard() };
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { openBoard, rpc };
});
