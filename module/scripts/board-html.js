/**
 * The nemesis board as HTML, from the companion's nemesis.board result. No Foundry globals here,
 * so it can be tested outside Foundry. The board is the GM's: it shows GM notes and secrets.
 */

export const OUTSIDE = "__outside";

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const num = (n) => Number(n).toLocaleString("en");
const list = (items, cls = "") => (items?.length ? `<ul class="${cls}">${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "");

/** The faction list on the left, with the people outside every faction last. */
export function navHtml(board, selected, t) {
  const rows = board.factions.map((f) => {
    const met = f.archmages.length + f.chain.length + f.people.length;
    return `<button type="button" class="gn-faction ${f.id === selected ? "active" : ""}" data-faction="${esc(f.id)}">
      <span class="gn-faction-name">${esc(f.name)}</span>
      <span class="gn-faction-meta">${esc(t("Towns", { n: f.towns }))}${met ? ` · ${esc(t("Known", { n: met + (f.ruler ? 1 : 0) }))}` : ""}</span>
    </button>`;
  });
  if (board.outside.length) {
    rows.push(`<button type="button" class="gn-faction gn-outside ${selected === OUTSIDE ? "active" : ""}" data-faction="${OUTSIDE}">
      <span class="gn-faction-name">${esc(t("Outside"))}</span>
      <span class="gn-faction-meta">${esc(t("People", { n: board.outside.length }))}</span>
    </button>`);
  }
  return `<nav class="gn-factions">${rows.join("")}</nav>`;
}

/** Buttons to the Scribbler entries a record links (resolved in Foundry by name or alias). */
function scribblerHtml(names, resolve, t) {
  const found = (names ?? []).map((n) => resolve?.(n)).filter(Boolean);
  const seen = new Set();
  return found.filter((l) => !seen.has(l.uuid) && seen.add(l.uuid)).map((l) => `<a class="gn-link" data-uuid="${esc(l.uuid)}" data-tooltip="${esc(t("OpenScribbler"))}"><i class="fa-solid fa-feather-pointed"></i> ${esc(l.name)}</a>`).join("");
}

function portraitHtml(p) {
  const src = p.art?.picked ? p.art[p.art.picked] : p.art?.final ?? p.art?.layout;
  if (src) return `<div class="gn-portrait"><img src="${esc(src)}" alt="${esc(p.name)}"></div>`;
  const icon = { monarch: "fa-crown", archmage: "fa-hat-wizard", general: "fa-chess-knight", captain: "fa-shield-halved", veteran: "fa-shield", soldier: "fa-person-rifle", villager: "fa-user", unranked: "fa-eye" }[p.rank] ?? "fa-user";
  return `<div class="gn-portrait gn-noart"><i class="fa-solid ${icon}"></i></div>`;
}

/** One person: who they are, their magic, and what they remember of the party. */
export function cardHtml(p, { resolve, t }) {
  const line = [p.species, p.home ? t("From", { town: p.home.name }) : "", p.hp ? t("Hp", { hp: num(p.hp) }) : ""].filter(Boolean).map(esc).join(" · ");
  const spheres = p.spheres.length ? `<p class="gn-spheres">${p.spheres.map((s) => `${esc(s.sphere)} ${s.rating}`).join(" · ")}${p.dynamicOnly ? ` · <em>${esc(t("DynamicOnly"))}</em>` : ""}</p>` : "";
  const tags = [
    p.state !== "alive" ? `<span class="gn-tag gn-state">${esc(t(`State.${p.state}`))}</span>` : "",
    p.plotLocked ? `<span class="gn-tag gn-plot" data-tooltip="${esc(t("PlotLockedHint"))}"><i class="fa-solid fa-lock"></i> ${esc(t("PlotLocked"))}</span>` : "",
    p.gmOnly ? `<span class="gn-tag gn-gm"><i class="fa-solid fa-eye-slash"></i> ${esc(t("GmOnly"))}</span>` : "",
  ].join("");
  const memory = p.memory.length
    ? list(p.memory.map((m) => `<span class="gn-when">${esc(m.when)}</span> ${esc(m.text)}`), "gn-memory-list")
    : `<p class="gn-hint">${esc(t("NotMet"))}</p>`;
  const details = [
    p.look ? `<p><strong>${esc(t("Look"))}</strong> ${esc(p.look)}</p>` : "",
    p.wants.length ? `<p><strong>${esc(t("Wants"))}</strong></p>${list(p.wants.map(esc))}` : "",
    p.fears.length ? `<p><strong>${esc(t("Fears"))}</strong></p>${list(p.fears.map(esc))}` : "",
    p.facts.length ? `<p><strong>${esc(t("Facts"))}</strong></p>${list(p.facts.map(esc))}` : "",
    p.feelings.length ? `<p><strong>${esc(t("Feelings"))}</strong></p>${list(p.feelings.map((f) => `${esc(f.toward)}: ${esc(f.feeling)}`))}` : "",
    p.knows.length ? `<p><strong>${esc(t("Knows"))}</strong></p>${list(p.knows.map((k) => `${esc(k.about)}: ${esc(k.text)}`))}` : "",
    p.commitments.length ? `<p><strong>${esc(t("Commitments"))}</strong></p>${list(p.commitments.map((c) => `<em>${esc(c.kind)}</em> ${esc(c.text)}`))}` : "",
    p.relationships.length ? `<p><strong>${esc(t("Relationships"))}</strong></p>${list(p.relationships.map((r) => `<em>${esc(r.kind)}</em> ${esc(r.with)}${r.note ? `: ${esc(r.note)}` : ""}`))}` : "",
    p.gmNotes.length ? `<div class="gn-secret"><p><strong><i class="fa-solid fa-lock"></i> ${esc(t("GmNotes"))}</strong></p>${list(p.gmNotes.map(esc))}</div>` : "",
  ].join("");
  return `<article class="gn-card ${p.plotLocked ? "gn-plotlocked" : ""}" data-person="${esc(p.id)}">
    ${portraitHtml(p)}
    <div class="gn-card-body">
      <h4>${esc(p.name)} ${p.rank ? `<span class="gn-rank">${esc(t(`Rank.${p.rank}`))}</span>` : ""}</h4>
      ${p.role ? `<p class="gn-role">${esc(p.role)}</p>` : ""}
      ${line ? `<p class="gn-line">${line}</p>` : ""}
      ${spheres}
      ${tags ? `<p class="gn-tags">${tags}</p>` : ""}
      <div class="gn-memory"><p><strong>${esc(t("Memory"))}</strong></p>${memory}</div>
      ${details ? `<details class="gn-details"><summary>${esc(t("Details"))}</summary>${details}</details>` : ""}
      <p class="gn-links">${scribblerHtml(p.scribbler, resolve, t)}</p>
    </div>
  </article>`;
}

function chainHtml(nodes, ctx) {
  if (!nodes.length) return "";
  return `<ul class="gn-chain">${nodes.map((n) => `<li>${cardHtml(n.person, ctx)}${chainHtml(n.under, ctx)}</li>`).join("")}</ul>`;
}

/** People grouped by home town, homeless last. */
function peopleHtml(people, ctx) {
  const groups = new Map();
  for (const p of people) {
    const k = p.home?.name ?? "";
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups].sort(([a], [b]) => (a ? (b ? a.localeCompare(b) : -1) : 1)).map(([town, ps]) => `
    ${town ? `<h4 class="gn-town">${esc(town)}</h4>` : ""}
    <div class="gn-cards">${ps.map((p) => cardHtml(p, ctx)).join("")}</div>`).join("");
}

/** The right-hand pane for one faction (or the people outside every faction). */
export function paneHtml(board, selected, ctx) {
  const { t } = ctx;
  if (selected === OUTSIDE) {
    return `<div class="gn-pane">
      <header><h2>${esc(t("Outside"))}</h2><p class="gn-meta">${esc(t("OutsideHint"))}</p></header>
      <div class="gn-cards">${board.outside.map((p) => cardHtml(p, ctx)).join("")}</div>
    </div>`;
  }
  const f = board.factions.find((x) => x.id === selected) ?? board.factions[0];
  if (!f) return `<div class="gn-pane"><p class="gn-hint">${esc(t("NoFactions"))}</p></div>`;
  const meta = [f.capital ? t("Capital", { town: f.capital.name }) : "", t("Towns", { n: f.towns }), f.culture, f.faith].filter(Boolean).map(esc).join(" · ");
  const court = [f.ruler, ...f.archmages].filter(Boolean);
  const goals = f.goals.length ? list(f.goals.map((g) => `<span class="gn-goal gn-${esc(g.kind)}">${esc(t(g.kind === "fear" ? "Fear" : "Want"))}</span> ${esc(g.text)}${g.clock ? ` <span class="gn-clock">${g.clock.filled}/${g.clock.size}</span>` : ""}`), "gn-goals") : "";
  return `<div class="gn-pane">
    <header>
      <h2>${esc(f.name)}</h2>
      <p class="gn-meta">${meta}</p>
      <p class="gn-links">${scribblerHtml(f.scribbler, ctx.resolve, t)}</p>
    </header>
    ${f.summary ? `<p class="gn-summary">${esc(f.summary)}</p>` : ""}
    ${f.gmNotes.length ? `<div class="gn-secret"><p><strong><i class="fa-solid fa-lock"></i> ${esc(t("GmNotes"))}</strong></p>${list(f.gmNotes.map(esc))}</div>` : ""}
    <h3>${esc(t("Court"))}</h3>
    ${court.length ? `<div class="gn-cards">${court.map((p) => cardHtml(p, ctx)).join("")}</div>` : `<p class="gn-hint">${esc(t("NoCourt"))}</p>`}
    ${goals ? `<h3>${esc(t("Goals"))}</h3>${goals}` : ""}
    <h3>${esc(t("Chain"))}</h3>
    ${f.chain.length ? chainHtml(f.chain, ctx) : `<p class="gn-hint">${esc(t("NoChain"))}</p>`}
    ${f.people.length ? `<h3>${esc(t("PeopleOfNote"))}</h3>${peopleHtml(f.people, ctx)}` : ""}
  </div>`;
}

/** Picks the world: the Map Maker world imported into this Foundry world, else the only one. */
export function pickWorld(worlds, importedIds = []) {
  return worlds.find((w) => importedIds.includes(w.id)) ?? worlds[0];
}
