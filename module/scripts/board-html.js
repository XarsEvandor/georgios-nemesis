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
    const met = f.archmages.length + f.chain.length + f.people.length + townsfolkCount(f);
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

/** A button to a Georgios' Map Maker journal ("realm-2", "town-119"), when Map Maker made one. */
function placeHtml(key, ctx, label) {
  const j = ctx.place?.(key);
  return j ? `<a class="gn-link gn-place" data-uuid="${esc(j.uuid)}" data-tooltip="${esc(ctx.t("OpenMapMaker"))}"><i class="fa-solid fa-map-location-dot"></i> ${esc(label ?? j.name)}</a>` : "";
}

/** What a reroll keeps of the pair it replaces (and an undo swaps back). */
const PAIR = ["final", "layout", "picked", "prompt", "notes"];

/**
 * A person's art after a reroll: the new images on top, the pair they replace kept for undo.
 * before: the art as it was before the reroll; now: the art as it is (the companion may have
 * written the corrections into it); images: the new { final, layout }.
 */
export function rerolledArt(before, now, images) {
  const art = { ...(now ?? {}), ...images, picked: images.final ? "final" : "layout" };
  if (before?.final || before?.layout) art.prev = { ...Object.fromEntries(PAIR.filter((k) => before[k] !== undefined).map((k) => [k, before[k]])), newer: false };
  return art;
}

/** Undo (or redo) a reroll: the kept pair and the shown pair change places. */
export function swappedArt(art) {
  if (!art?.prev) return art;
  const shown = Object.fromEntries(PAIR.filter((k) => art[k] !== undefined).map((k) => [k, art[k]]));
  const { newer, ...back } = art.prev;
  const rest = Object.fromEntries(Object.entries(art).filter(([k]) => !PAIR.includes(k) && k !== "prev"));
  return { ...rest, ...back, prev: { ...shown, newer: !newer } };
}

/** The portrait the GM picked (or the first there is). */
export function pickedArt(art) {
  if (!art) return undefined;
  if (art.picked && art[art.picked]) return art[art.picked];
  return art.final ?? art.layout ?? art.own;
}

function portraitHtml(p, ctx) {
  const src = pickedArt(p.art);
  const both = p.art?.final && p.art?.layout;
  const pick = (which) => `<button type="button" class="gn-pick ${(p.art.picked ?? "final") === which ? "active" : ""}" data-pick="${which}" data-person="${esc(p.id)}" data-tooltip="${esc(ctx.t(`Pick.${which}`))}"><img src="${esc(p.art[which])}" alt=""></button>`;
  if (src) return `<div class="gn-portrait-wrap"><div class="gn-portrait"><img src="${esc(src)}" alt="${esc(p.name)}"></div>${both ? `<div class="gn-picks">${pick("final")}${pick("layout")}</div>` : ""}</div>`;
  if (ctx.painting?.has(p.id)) return `<div class="gn-portrait gn-noart gn-painting" data-tooltip="${esc(ctx.t("Painting"))}"><i class="fa-solid fa-palette fa-beat-fade"></i></div>`;
  const icon = { monarch: "fa-crown", archmage: "fa-hat-wizard", general: "fa-chess-knight", captain: "fa-shield-halved", veteran: "fa-shield", soldier: "fa-person-rifle", villager: "fa-user", unranked: "fa-eye" }[p.rank] ?? "fa-user";
  return `<div class="gn-portrait gn-noart"><i class="fa-solid ${icon}"></i></div>`;
}

/** One person: who they are, their magic, and what they remember of the party. */
export function cardHtml(p, ctx) {
  const { resolve, t } = ctx;
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
  const own = [
    p.actor ? `<a class="gn-link" data-uuid="${esc(p.actor)}" data-tooltip="${esc(t("OpenActor"))}"><i class="fa-solid fa-user-shield"></i> ${esc(t("Actor"))}</a>` : "",
    p.journal ? `<a class="gn-link" data-uuid="${esc(p.journal)}" data-card="${esc(p.id)}" data-tooltip="${esc(t("OpenJournal"))}"><i class="fa-solid fa-book"></i> ${esc(t("Journal"))}</a>` : "",
    ctx.canPaint && p.actor && !ctx.painting?.has(p.id) ? `<a class="gn-link" data-paint="${esc(p.id)}" data-tooltip="${esc(t("PaintHint"))}"><i class="fa-solid fa-palette"></i> ${esc(t(p.art?.final || p.art?.layout ? "Repaint" : "Paint"))}</a>` : "",
    // On record but never written in full (a session's NPC, a seeded ruler): Claude writes the card, keeping what the table knows.
    ctx.canGenerate && !p.written && !p.plotLocked && p.rank && p.rank !== "unranked" && !ctx.writing?.has(p.id) ? `<a class="gn-link" data-writeup="${esc(p.id)}" data-tooltip="${esc(t("WriteUpHint"))}"><i class="fa-solid fa-feather-pointed"></i> ${esc(t("WriteUp"))}</a>` : "",
    p.actor ? `<a class="gn-link" data-place-actor="${esc(p.actor)}" data-tooltip="${esc(t("PlaceHint"))}"><i class="fa-solid fa-location-dot"></i> ${esc(t("PlaceOnScene"))}</a>` : "",
  ].join("");
  return `<article class="gn-card ${p.plotLocked ? "gn-plotlocked" : ""}" data-person="${esc(p.id)}">
    ${portraitHtml(p, ctx)}
    <div class="gn-card-body">
      <h4>${esc(p.name)} ${p.rank ? `<span class="gn-rank">${esc(t(`Rank.${p.rank}`))}</span>` : ""}</h4>
      ${p.role ? `<p class="gn-role">${esc(p.role)}</p>` : ""}
      ${line ? `<p class="gn-line">${line}</p>` : ""}
      ${spheres}
      ${tags ? `<p class="gn-tags">${tags}</p>` : ""}
      <div class="gn-memory"><p><strong>${esc(t("Memory"))}</strong></p>${memory}</div>
      ${details ? `<details class="gn-details"><summary>${esc(t("Details"))}</summary>${details}</details>` : ""}
      <p class="gn-links">${own}${scribblerHtml(p.scribbler, resolve, t)}</p>
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
    const k = p.home ? String(p.home.id) : "";
    groups.set(k, { home: p.home, people: [...(groups.get(k)?.people ?? []), p] });
  }
  const name = (g) => g.home?.name ?? "";
  return [...groups.values()].sort((a, b) => (name(a) ? (name(b) ? name(a).localeCompare(name(b)) : -1) : 1)).map((g) => `
    ${g.home ? `<h4 class="gn-town">${esc(g.home.name)} ${placeHtml(`town-${g.home.id}`, ctx, ctx.t("Journal"))}</h4>` : ""}
    <div class="gn-cards">${g.people.map((p) => cardHtml(p, ctx)).join("")}</div>`).join("");
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
      ${ctx.canGenerate ? `<button type="button" class="gn-generate" data-generate="${esc(f.id)}" ${ctx.busy ? "disabled" : ""}><i class="fa-solid fa-wand-sparkles"></i> ${esc(t("Generate"))}</button>` : ""}
      <h2>${esc(f.name)}</h2>
      <p class="gn-meta">${meta}</p>
      <p class="gn-links">${scribblerHtml(f.scribbler, ctx.resolve, t)}${f.state !== undefined ? placeHtml(`realm-${f.state}`, ctx) : ""}${f.capital ? placeHtml(`town-${f.capital.id}`, ctx) : ""}</p>
    </header>
    ${f.summary ? `<p class="gn-summary">${esc(f.summary)}</p>` : ""}
    ${f.gmNotes.length ? `<div class="gn-secret"><p><strong><i class="fa-solid fa-lock"></i> ${esc(t("GmNotes"))}</strong></p>${list(f.gmNotes.map(esc))}</div>` : ""}
    <h3>${esc(t("Court"))}</h3>
    ${court.length ? `<div class="gn-cards">${court.map((p) => cardHtml(p, ctx)).join("")}</div>` : `<p class="gn-hint">${esc(t("NoCourt"))}</p>`}
    ${goals ? `<h3>${esc(t("Goals"))}</h3>${goals}` : ""}
    <h3>${esc(t("Chain"))}</h3>
    ${f.chain.length ? chainHtml(f.chain, ctx) : `<p class="gn-hint">${esc(t("NoChain"))}</p>`}
    ${f.people.length ? `<h3>${esc(t("PeopleOfNote"))}</h3>${peopleHtml(f.people, ctx)}` : ""}
    ${townsfolkHtml(f.townsfolk ?? [], ctx)}
  </div>`;
}

/** The townsfolk Nemesis wrote for Map Maker's places, by town. */
function townsfolkHtml(groups, ctx) {
  if (!groups.length) return "";
  return `<h3>${esc(ctx.t("Townsfolk"))}</h3>${groups.map((g) => `
    <h4 class="gn-town">${esc(g.town.name)} ${placeHtml(`town-${g.town.id}`, ctx, ctx.t("Journal"))}</h4>
    <div class="gn-cards">${g.people.map((p) => cardHtml(p, ctx)).join("")}</div>`).join("")}`;
}

const townsfolkCount = (f) => (f.townsfolk ?? []).reduce((n, g) => n + g.people.length, 0);

/**
 * The portraits at the top of a person's card: the repaint and the layout side by side, which one
 * is on the token, and a link on each that shows that picture (only the picture) to the players.
 * Empty until the portrait is painted; Nemesis fills it in then.
 */
export function artHtml(person, t) {
  const art = person.art ?? {};
  const picked = art.picked ?? "final";
  // The picture not on the actor can be put there with one click.
  const use = (which) => `<br><a class="gn-use-art" data-person="${esc(person.id)}" data-which="${which}" data-tooltip="${esc(t("Card.UseOnActorHint"))}"><i class="fa-solid fa-user-check"></i> ${esc(t("Card.UseOnActor"))}</a>`;
  const fig = (which) => (art[which]
    ? `<figure class="gn-card-art"><img src="${esc(art[which])}" alt="${esc(person.name)}"><figcaption>${esc(t(`Card.${which}`))}${picked === which ? ` <em>${esc(t("Card.OnActor"))}</em>` : ""}<br><a class="gn-show-players"><i class="fa-solid fa-eye"></i> ${esc(t("Card.ShowPlayers"))}</a>${picked === which ? "" : use(which)}</figcaption></figure>`
    : "");
  // Painted portraits can be painted again, with the GM's corrections (the reroll box), and the
  // last reroll undone (and redone).
  const undo = art.prev?.final || art.prev?.layout
    ? ` <a class="gn-undo-art" data-person="${esc(person.id)}" data-tooltip="${esc(t(art.prev.newer ? "Card.RedoHint" : "Card.UndoHint"))}"><i class="fa-solid ${art.prev.newer ? "fa-rotate-right" : "fa-rotate-left"}"></i> ${esc(t(art.prev.newer ? "Card.Redo" : "Card.Undo"))}</a>`
    : "";
  const reroll = art.final || art.layout
    ? `<p class="gn-art-tools"><a class="gn-reroll" data-person="${esc(person.id)}" data-tooltip="${esc(t("Card.RerollHint"))}"><i class="fa-solid fa-dice"></i> ${esc(t("Card.Reroll"))}</a>${undo}</p>`
    : "";
  return `<div class="gn-art">${fig("final")}${fig("layout")}${fig("own")}${reroll}</div>`;
}

/** The GM journal page for a person record (the companion's record, not the board card). */
export function journalHtml(person, t) {
  const s = person.static ?? {};
  const d = person.dynamic ?? {};
  const n = person.notes ?? {};
  const li = (xs) => (xs?.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
  // Labels may carry their own colon ("Looks:" on the board).
  const row = (k, v) => (v ? `<p><strong>${esc(String(k).replace(/:$/, ""))}:</strong> ${esc(v)}</p>` : "");
  const item = (k, v) => (v ? `<li><strong>${esc(k)}:</strong> ${esc(v)}</li>` : "");
  const block = (title, items) => {
    const body = items.join("");
    return body ? `<h2>${esc(title)}</h2><ul>${body}</ul>` : "";
  };
  const spheres = Object.entries(d.spheres ?? {}).map(([k, v]) => `${k} ${v}`).join(", ");
  const line = { Personal: 11, Area: 13, Environment: 15, Cataclysm: 17 };
  const p = n.paradigm ?? {};
  const m = n.mind ?? {};
  const tc = n.tactics ?? {};
  const r = n.roleplay ?? {};
  // No name heading: Foundry shows the page's title (the person's name) above it.
  return [
    artHtml(person, t),
    `<p><em>${esc([person.form ? `${person.species} (${person.form})` : person.species, person.rank ? t(`Rank.${person.rank}`) : "", person.role].filter(Boolean).join(", "))}</em></p>`,
    row(t("Look"), person.look),
    row(t("Personality"), person.personality),
    person.wants?.length ? `<h2>${esc(t("Wants"))}</h2>${li(person.wants)}` : "",
    person.fears?.length ? `<h2>${esc(t("Fears"))}</h2>${li(person.fears)}` : "",
    person.beliefs?.length ? `<h2>${esc(t("Beliefs"))}</h2>${li(person.beliefs)}` : "",
    block(t("Notes.Mind"), [item(t("Notes.Priorities"), m.priorities), item(t("Notes.Decisions"), m.decisions), item(t("Notes.Knows"), m.knows), item(t("Notes.Underlings"), m.underlings)]),
    `<h2>${esc(t("InAFight"))}</h2>`,
    row(t("CombatStyle"), person.combatStyle),
    row(t("Strength"), person.strength),
    row(t("Weakness"), person.weakness),
    s.hp ? `<p>${esc(t("StatLine", { hp: Number(s.hp).toLocaleString("en"), ac: s.ac ?? "?", attacks: s.attacksPerRound ?? 0 }))}</p>` : "",
    block(t("Notes.Tactics"), [item(t("Notes.Opening"), tc.opening), item(t("Notes.Pressure"), tc.pressure), item(t("Notes.Hurt"), tc.hurt), item(t("Notes.Retreat"), tc.retreat), item(t("Notes.Combo"), tc.combo), item(t("Notes.VsMages"), tc.vsMages), item(t("Notes.Terrain"), tc.terrain), item(t("Notes.Building"), tc.building)]),
    spheres ? `<h2>${esc(t("DynamicMagic"))}</h2><p>${esc(spheres)}${d.worldview ? `. ${esc(d.worldview)}` : ""}</p>` : "",
    block(t("Notes.Paradigm"), [item(t("Notes.Belief"), p.summary), item(t("Notes.Tools"), p.tools), item(t("Notes.Signs"), p.signs), item(t("Notes.Limits"), p.limits)]),
    (d.tricks ?? []).length ? `<h3>${esc(t("Notes.Tricks"))}</h3><ul>${d.tricks.map((x) => `<li><strong>${esc(x.name)}</strong> (${esc(x.sphere)}, ${esc(x.size)}, ${line[x.size] ?? 11}+): ${esc(x.text)} <em>${esc(t("VsMages"))}</em> ${esc(x.vsMages)}</li>`).join("")}</ul>` : "",
    (n.spheres ?? []).length ? `<h3>${esc(t("Notes.Freeform"))}</h3>${n.spheres.map((u) => `<p><strong>${esc(u.sphere)} ${d.spheres?.[u.sphere] ?? ""}</strong></p>${li(u.uses)}`).join("")}` : "",
    block(t("Notes.Roleplay"), [item(t("Notes.Voice"), r.voice), item(t("Notes.Mannerisms"), r.mannerisms), ...(r.lines ?? []).map((x) => `<li><em>"${esc(x)}"</em></li>`), item(t("Notes.Threats"), r.threats), item(t("Notes.Bribes"), r.bribes), item(t("Notes.Flattery"), r.flattery), item(t("Notes.Mercy"), r.mercy), item(t("Notes.Secret"), r.secret)]),
    person.gmNotes?.length ? `<h2>${esc(t("GmNotes"))}</h2>${li(person.gmNotes)}` : "",
  ].filter(Boolean).join("\n");
}

/** Picks the world: the Map Maker world imported into this Foundry world, else the only one. */
export function pickWorld(worlds, importedIds = []) {
  return worlds.find((w) => importedIds.includes(w.id)) ?? worlds[0];
}
