/**
 * The Nemesis progress panel (GM only): a small list in the bottom-left corner, above the player
 * list, of everything Nemesis is writing or painting, with how long each has run. Once a card
 * exists its row opens it (the person's GM journal page), while the portrait is still painting;
 * finished rows stay until opened or dismissed.
 */

import { progressHtml } from "./progress-html.js";

const MAX = 8;
const items = [];
let el = null;
let timer = null;
let t = (key) => key;

export function initProgress(translate) {
  t = translate;
  Hooks.on("renderPlayers", () => place());
  window.addEventListener("resize", () => place());
}

/** Starts a row; returns its handle. */
export function track({ title, detail }) {
  const item = { id: foundry.utils.randomID(), title, detail, state: "work", since: Date.now() };
  items.push(item);
  trim();
  render();
  return {
    item,
    /** New words for the row. */
    update(p) {
      Object.assign(item, p);
      render();
    },
    /** Still running, but there is something to read already (the sketch): clicking calls `action`. */
    sketch(action, detail) {
      Object.assign(item, { open: "sketch", action, detail });
      render();
    },
    /** The card is written (openable); something (the portrait) still runs. */
    ready(open, detail) {
      Object.assign(item, { state: "ready", open: open ?? item.open, action: null, detail });
      render();
    },
    done(p = {}) {
      Object.assign(item, { state: "done", ...p });
      if (p.open) item.action = null;
      render();
    },
    fail(message) {
      Object.assign(item, { state: "failed", detail: message });
      render();
    },
    remove: () => remove(item.id),
  };
}

function remove(id) {
  const k = items.findIndex((i) => i.id === id);
  if (k >= 0) items.splice(k, 1);
  render();
}

/** Keeps the panel short: finished rows go first, oldest first. */
function trim() {
  while (items.length > MAX) {
    const k = items.findIndex((i) => i.state === "done" || i.state === "failed");
    items.splice(k >= 0 ? k : 0, 1);
  }
}

function ensure() {
  if (el?.isConnected) return el;
  el = document.createElement("section");
  el.id = "gn-progress";
  el.className = "gn-progress";
  el.setAttribute("aria-live", "polite");
  el.addEventListener("click", onClick);
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") onClick(ev);
  });
  document.body.append(el);
  return el;
}

async function onClick(ev) {
  const x = ev.target.closest("[data-dismiss]");
  if (x) return remove(x.dataset.dismiss);
  const row = ev.target.closest("[data-open]");
  if (!row) return;
  ev.preventDefault();
  const item = items.find((i) => i.id === row.dataset.id);
  if (item?.action) return item.action();
  const doc = await fromUuid(row.dataset.open);
  if (!doc) return ui.notifications.warn(t("Progress.Gone"));
  doc.sheet?.render(true);
  if (item?.state === "done") remove(item.id);
}

function render() {
  if (!game.user?.isGM) return;
  const panel = ensure();
  panel.innerHTML = progressHtml(items, Date.now(), t);
  panel.hidden = !items.length;
  place();
  const running = items.some((i) => i.state === "work" || i.state === "ready");
  if (running && !timer) timer = setInterval(tick, 1000);
  if (!running && timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Only the clocks change each second. */
function tick() {
  if (!el) return;
  const now = Date.now();
  for (const span of el.querySelectorAll(".gn-progress-time")) {
    const s = Math.max(0, Math.floor((now - Number(span.dataset.since)) / 1000));
    span.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
}

/**
 * Just above Foundry's player list (it grows with the table), else a fixed spot; never wider
 * than the room left of the macro hotbar, so a small window keeps every slot clickable.
 */
function place() {
  if (!el) return;
  const r = document.getElementById("players")?.getBoundingClientRect();
  const left = r && r.height ? Math.max(8, Math.round(r.left)) : 8;
  el.style.left = `${left}px`;
  el.style.bottom = r && r.height ? `${Math.max(8, Math.round(window.innerHeight - r.top + 8))}px` : "120px";
  const bar = document.getElementById("hotbar")?.getBoundingClientRect();
  const room = bar && bar.width ? Math.round(bar.left) - left - 8 : 300;
  el.style.width = `${Math.max(200, Math.min(300, room))}px`;
}
