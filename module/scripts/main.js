/**
 * Georgios' Nemesis: Foundry VTT module (GM only).
 * A Nemesis button in the Georgios' Modules toolbar group opens the board: one tab per faction,
 * its court and chain of command, and each person's memory of the party. The records live in
 * the companion Georgios' Map Maker runs, which loads this repo's companion plugin; this module
 * asks it through Map Maker's api.rpc, so it uses the same token and the same Start offer.
 */

import { OUTSIDE, esc, navHtml, paneHtml, pickWorld } from "./board-html.js";

const MODULE_ID = "georgios-nemesis";
const MAP_MAKER = "georgios-map-maker";
const SCRIBBLER = "georgios-scribbler";

const t = (key, data) => (data ? game.i18n.format(`GN.${key}`, data) : game.i18n.localize(`GN.${key}`));

function rpc(method, params = {}) {
  const api = game.modules.get(MAP_MAKER)?.api;
  if (!api?.rpc) throw new Error(t("NeedsMapMaker"));
  return api.rpc(method, params);
}

/** Scribbler entity journals by name and alias, so records link the entry the Scribbler keeps. */
function scribblerIndex() {
  const index = new Map();
  if (!game.modules.get(SCRIBBLER)?.active) return index;
  for (const j of game.journal) {
    if (j.getFlag(SCRIBBLER, "kind") !== "entity") continue;
    for (const n of [j.name, ...(j.getFlag(SCRIBBLER, "aliases") ?? [])]) {
      const k = String(n ?? "").trim().toLowerCase();
      if (k && !index.has(k)) index.set(k, { uuid: j.uuid, name: j.name });
    }
  }
  return index;
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
    this.error = null;
    this.selected = null;
    this.loading = true;
    this.load();
  }

  async load() {
    this.loading = true;
    this.error = null;
    try {
      const worlds = await rpc("nemesis.worlds");
      const imported = game.scenes.map((s) => s.getFlag(MAP_MAKER, "world")).filter(Boolean);
      const world = pickWorld(worlds, imported);
      if (!world) throw new Error(t("NoWorlds"));
      this.board = await rpc("nemesis.board", { world: world.id });
      if (!this.selected || (this.selected !== OUTSIDE && !this.board.factions.some((f) => f.id === this.selected))) this.selected = this.board.factions[0]?.id ?? OUTSIDE;
    } catch (e) {
      this.error = /unknown method nemesis\./.test(e.message) ? t("NoPlugin") : e.message;
    }
    this.loading = false;
    this.render();
  }

  async _renderHTML() {
    if (this.loading && !this.board) return `<p class="gn-hint gn-pad">${esc(t("Loading"))}</p>`;
    if (this.error) return `<div class="gn-pad"><p class="gn-error">${esc(this.error)}</p><button type="button" data-action="reload">${esc(t("Refresh"))}</button></div>`;
    const index = scribblerIndex();
    const ctx = { t, resolve: (name) => index.get(String(name).trim().toLowerCase()) };
    return `<section class="gn-board">
      <div class="gn-side">
        <p class="gn-world">${esc(this.board.world.title ?? this.board.world.id)}</p>
        ${navHtml(this.board, this.selected, t)}
        <button type="button" class="gn-refresh" data-action="reload"><i class="fa-solid fa-rotate"></i> ${esc(t("Refresh"))}</button>
      </div>
      ${paneHtml(this.board, this.selected, ctx)}
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
    content.querySelectorAll(".gn-link[data-uuid]").forEach((el) => el.addEventListener("click", async () => (await fromUuid(el.dataset.uuid))?.sheet?.render(true)));
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

// The shared "Georgios' Modules" toolbar group (Map Maker makes it; fixed orders keep buttons in place).
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
