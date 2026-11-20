/**
 * The corner panel's HTML: one row per thing Nemesis is writing or painting. No Foundry globals,
 * so it can be tested outside Foundry. A row whose card exists carries data-open (the card's
 * uuid): clicking it opens the card, even while the portrait is still being painted.
 */

import { esc } from "./board-html.js";

/** m:ss since a time. */
export function elapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const ICONS = {
  work: "fa-solid fa-spinner fa-spin",
  ready: "fa-solid fa-palette fa-beat-fade",
  done: "fa-solid fa-circle-check",
  failed: "fa-solid fa-triangle-exclamation",
};

/**
 * items: [{ id, title, detail?, state: "work" | "ready" | "done" | "failed", since, open? }]
 * ready = the card is written (openable) and the portrait is still being painted.
 */
export function progressHtml(items, now, t) {
  if (!items?.length) return "";
  return `<ol class="gn-progress-list">${items.map((i) => rowHtml(i, now, t)).join("")}</ol>`;
}

function rowHtml(i, now, t) {
  const running = i.state === "work" || i.state === "ready";
  const tip = i.open === "sketch" ? t("Progress.ReadSketch") : t("Progress.Open");
  const open = i.open ? ` data-open="${esc(i.open)}" role="button" tabindex="0" data-tooltip="${esc(tip)}"` : "";
  const time = running ? `<span class="gn-progress-time" data-since="${Number(i.since) || 0}">${elapsed(now - i.since)}</span>` : "";
  const dismiss = running ? "" : `<button type="button" class="gn-progress-x" data-dismiss="${esc(i.id)}" data-tooltip="${esc(t("Progress.Dismiss"))}"><i class="fa-solid fa-xmark"></i></button>`;
  return `<li class="gn-progress-item gn-${esc(i.state)}${i.open ? " gn-openable" : ""}" data-id="${esc(i.id)}"${open}>
    <i class="gn-progress-icon ${ICONS[i.state] ?? ICONS.work}"></i>
    <span class="gn-progress-text"><strong>${esc(i.title)}</strong>${i.detail ? `<span>${esc(i.detail)}</span>` : ""}</span>
    ${time}${dismiss}
  </li>`;
}
