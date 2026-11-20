/**
 * A person's stat block as dnd5e 6.x actor data, ready for Actor.create in Foundry. Numbers are
 * set flat (to-hit, damage, DCs), so the sheet shows exactly what the balance table says and no
 * ability score or proficiency drifts it. Shapes follow dnd5e 6.0.6's own monsters.
 */

import { TRICK_DAMAGE } from "./balance";
import type { NRecord } from "./store";

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";

export interface Dice {
  number: number;
  die: number;
  bonus: number;
}

export interface StatAttack {
  name: string;
  kind: "melee" | "ranged";
  damageType: string;
  toHit: number;
  dice: Dice;
  text?: string;
}

export interface StatPower {
  name: string;
  save: Ability;
  dc: number;
  effect: string;
  damageType: string;
  dice?: Dice;
  area: "one" | "line" | "cone" | "burst";
  recharge?: number;
  text?: string;
}

export interface StatBlock {
  hp: number;
  ac: number;
  cr: number;
  size: "tiny" | "sm" | "med" | "lg" | "huge" | "grg";
  speed: { walk: number; fly?: number; swim?: number; climb?: number };
  scores: Record<Ability, number>;
  saves: Ability[];
  attacksPerRound: number;
  attacks: StatAttack[];
  powers: StatPower[];
  resistances: string[];
  legendary: { actions: number; resistances: number };
  /** DC of the saves a trick's hazard allows. */
  trickDc?: number;
}

export interface Trick {
  name: string;
  sphere: string;
  size: string;
  text: string;
  vsMages: string;
}

/** The d20 line a trick needs, by size (magic doc). */
export const SUCCESS_LINE: Record<string, number> = { Personal: 11, Area: 13, Environment: 15, Cataclysm: 17 };

export const average = (d: Dice) => Math.floor((d.number * (d.die + 1)) / 2) + d.bonus;
export const formula = (d: Dice) => `${d.number}d${d.die}${d.bonus ? ` + ${d.bonus}` : ""}`;

/** A stable 16-character id from a string (Foundry ids are 16 alphanumerics). */
export function fid(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ s.charCodeAt(i), 2246822507);
  }
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  let x = (h1 >>> 0) * 4294967296 + (h2 >>> 0);
  for (let i = 0; i < 16; i++) {
    out += abc[Math.floor(x) % 62];
    x = Math.floor(x / 62) + (h1 >>> (i % 24)) + i * 7919;
  }
  return out;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const AREA_TEMPLATE: Record<string, { type: string; size: string; width?: string } | undefined> = {
  one: undefined,
  line: { type: "line", size: "60", width: "5" },
  cone: { type: "cone", size: "30" },
  burst: { type: "radius", size: "20" },
};

function activityBase(id: string, type: string, activation: Record<string, unknown> = { type: "action", value: null, override: false, condition: "" }) {
  return {
    _id: id, type, sort: 0, name: "", img: null, flags: {},
    activation, consumption: { scaling: { allowed: false }, spellSlot: true, targets: [] as unknown[] },
    description: { chatFlavor: "" }, duration: { units: "inst", concentration: false, override: false }, effects: [],
    range: { override: false, units: "self" },
    target: { template: { contiguous: false, units: "ft", type: "" }, affects: { choice: false, type: "" }, override: false, prompt: true },
    uses: { spent: 0, recovery: [], max: "" },
    visibility: { level: {}, requireAttunement: false, requireIdentification: false, requireMagic: false },
  };
}

const part = (d: Dice, type: string) => ({ custom: { enabled: false, formula: "" }, number: d.number, denomination: d.die, bonus: d.bonus ? String(d.bonus) : "", types: [type], scaling: { number: 1 } });

function feat(key: string, name: string, html: string, activities: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    _id: fid(key), name, type: "feat", img: "icons/svg/aura.svg",
    system: { type: { value: "monster", subtype: "" }, description: { value: html, chat: "" }, uses: { spent: 0, recovery: [], max: "" }, activities, properties: [], ...extra },
    flags: {}, effects: [],
  };
}

function attackItem(personId: string, a: StatAttack) {
  const id = fid(`${personId}:attack:${a.name}`);
  const act = {
    ...activityBase(fid(`${id}:a`), "attack"),
    attack: { critical: { threshold: null }, flat: true, type: { value: a.kind, classification: "weapon" }, ability: "none", bonus: String(a.toHit) },
    damage: { critical: { bonus: "" }, includeBase: true, parts: [] },
  };
  return {
    _id: id, name: a.name, type: "weapon", img: a.kind === "ranged" ? "icons/svg/target.svg" : "icons/svg/sword.svg",
    system: {
      type: { value: "natural", baseItem: "" },
      description: { value: `<p>${esc(a.text ?? "")}</p><p>+${a.toHit} to hit, ${average(a.dice)} (${formula(a.dice)}) ${esc(a.damageType)} damage.</p>`, chat: "" },
      damage: { base: part(a.dice, a.damageType), versatile: { number: null, denomination: null, types: [], custom: { enabled: false }, scaling: { number: 1 } } },
      range: a.kind === "melee" ? { value: null, long: null, reach: 10, units: "ft" } : { value: 120, long: 240, reach: null, units: "ft" },
      equipped: true, proficient: 1, properties: [], uses: { spent: 0, recovery: [], max: "" }, quantity: 1,
      activities: { [act._id]: act },
    },
    flags: {}, effects: [],
  };
}

function powerItem(personId: string, p: StatPower) {
  const id = fid(`${personId}:power:${p.name}`);
  const tpl = AREA_TEMPLATE[p.area];
  const act = {
    ...activityBase(fid(`${id}:s`), "save"),
    range: { override: false, units: tpl ? "self" : "ft", value: tpl ? null : "60", special: "" },
    target: { template: tpl ? { contiguous: false, units: "ft", ...tpl, count: "" } : { contiguous: false, units: "ft", type: "" }, affects: { choice: false, count: tpl ? "" : "1", type: "creature", special: "" }, override: false, prompt: true },
    damage: { parts: p.dice && p.damageType !== "none" ? [part(p.dice, p.damageType)] : [], onSave: p.dice ? "half" : "none" },
    save: { ability: [p.save], dc: { calculation: "", formula: String(p.dc) } },
  };
  if (p.recharge) act.consumption.targets = [{ type: "itemUses", value: "1", target: "", scaling: {} }];
  const dmg = p.dice && p.damageType !== "none" ? ` ${average(p.dice)} (${formula(p.dice)}) ${esc(p.damageType)} damage, half on a success.` : "";
  const html = `<p>${esc(p.text ?? "")}</p><p><em>${p.save.toUpperCase()} save, DC ${p.dc}.</em>${dmg} Effect: ${esc(p.effect)}.${p.recharge ? ` Recharge ${p.recharge}-6.` : ""}</p>`;
  return feat(`${personId}:power:${p.name}`, p.name, html, { [act._id]: act }, p.recharge ? { uses: { spent: 0, recovery: [{ period: "recharge", formula: String(p.recharge), type: "recoverAll" }], max: "1" } } : {});
}

/** The damage guide line for a trick of a size, at a DC. */
export function trickGuide(size: string, dc: number | undefined): string {
  const g = TRICK_DAMAGE[size];
  if (!g || !g.dice.number) return g ? `Personal: ${g.note}.` : "";
  return `Through the world, each creature caught takes the greater of ${average(g.dice)} (${formula(g.dice)}) or ${Math.round(g.share * 100)}% of its max HP${dc ? `; DC ${dc} save (Dex to dodge, Str to hold, Con to endure) for half` : ""}. Right on the line it is at its weakest (half), on 19-20 its strongest (half again). Size: ${g.note}.`;
}

function trickItem(personId: string, t: Trick, rating: number | undefined, dc: number | undefined) {
  const id = fid(`${personId}:trick:${t.name}`);
  const line = SUCCESS_LINE[t.size] ?? 11;
  const act = { ...activityBase(fid(`${id}:u`), "utility"), roll: { prompt: false, visible: true, name: "Dynamic magic", formula: "1d20" } };
  const html = `<p>${esc(t.text)}</p><p><strong>${esc(t.sphere)}${rating ? ` ${rating}` : ""}, ${esc(t.size)}: succeeds on ${line}+.</strong> 1 to 4 fails, 5 up to the line is chaos. Each repeat in the same fight raises the line by 2.</p><p><strong>Against a mage:</strong> ${esc(t.vsMages)} Direct magic on a mage's body or mind does nothing.</p><p><em>${esc(trickGuide(t.size, dc))}</em></p>`;
  return feat(`${personId}:trick:${t.name}`, `${t.name} (${t.sphere} ${t.size})`, html, { [act._id]: act });
}

function utility(personId: string, key: string, name: string, html: string, activation: Record<string, unknown>, consume?: { target: string; value: string }) {
  const act = activityBase(fid(`${personId}:${key}:u`), "utility", activation);
  if (consume) act.consumption.targets = [{ type: "attribute", value: consume.value, target: consume.target, scaling: {} }];
  return feat(`${personId}:${key}`, name, html, { [act._id]: act });
}

const li = (label: string, text: unknown) => (text ? `<li><strong>${esc(label)}:</strong> ${esc(text)}</li>` : "");

/** The Dynamic Magic item: the rules in brief, then the person's paradigm and what each Sphere can do. */
export function dynamicHtml(person: NRecord, spheres: Record<string, number>): string {
  const n = person.notes ?? {};
  const p = n.paradigm ?? {};
  const uses = (n.spheres ?? []) as Array<{ sphere: string; uses: string[] }>;
  return [
    `<p>${esc(person.name)} works magic without paradox: ${Object.entries(spheres).map(([k, v]) => `${esc(k)} ${v}`).join(", ")}. Worldview: ${esc(person.dynamic?.worldview ?? "")}</p>`,
    "<p>Roll a d20: 1 to 4 fails, 5 up to the success line is chaos (the top of the band leans their way), the line or more succeeds. Lines: Personal 11, Area 13, Environment 15, Cataclysm 17. Each repeat of a trick in the same fight raises its line by 2. Spending a turn building adds a die (up to 5 in combat), and the table sees it coming; damage while building calls for a concentration save (DC 10 or half the damage) or the dice are lost. Magic aimed at a mage's body or mind does nothing: it must go through the world.</p>",
    p.summary || p.tools || p.signs || p.limits ? `<h3>Paradigm</h3><ul>${li("Belief", p.summary)}${li("Tools", p.tools)}${li("Signs", p.signs)}${li("Limits", p.limits)}</ul>` : "",
    uses.length ? `<h3>What else they can do</h3>${uses.map((u) => `<p><strong>${esc(u.sphere)} ${spheres[u.sphere] ?? ""}</strong></p><ul>${u.uses.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`).join("")}` : "",
  ].join("");
}

/** How they fight and talk, for the actor's biography (the GM reads it mid-fight). */
export function fightHtml(person: NRecord): string {
  const t = person.notes?.tactics;
  const r = person.notes?.roleplay;
  return [
    t ? `<h3>How they fight</h3><ul>${li("Opening", t.opening)}${li("Winning", t.pressure)}${li("Below half", t.hurt)}${li("Retreat", t.retreat)}${li("Combo", t.combo)}${li("Against mages", t.vsMages)}${li("Terrain", t.terrain)}${li("Building", t.building)}</ul>` : "",
    r ? `<h3>How they talk</h3><ul>${li("Voice", r.voice)}${li("Mannerisms", r.mannerisms)}${(r.lines ?? []).map((x: string) => `<li><em>"${esc(x)}"</em></li>`).join("")}</ul>` : "",
  ].join("");
}

/** The actor for a person. `img` and `token` are Foundry paths (portrait and token art). */
export function actorData(person: NRecord, o: { world: string; img: string; token: string }) {
  const s = person.static as StatBlock;
  const tricks = (person.dynamic?.tricks ?? []) as Trick[];
  const spheres = (person.dynamic?.spheres ?? {}) as Record<string, number>;
  const items: unknown[] = [];
  if (s.attacks.length && s.attacksPerRound > 1) {
    const names = s.attacks.map((a) => a.name).join(" or ");
    items.push(utility(person.id, "multiattack", "Multiattack", `<p>${esc(person.name)} makes ${s.attacksPerRound} attacks (${esc(names)}).${tricks.length ? " One attack can be replaced by a dynamic-magic trick." : ""}</p>`, { type: "action", value: null, override: false }));
  }
  for (const a of s.attacks) items.push(attackItem(person.id, a));
  for (const p of s.powers) items.push(powerItem(person.id, p));
  for (const t of tricks) items.push(trickItem(person.id, t, spheres[t.sphere], s.trickDc));
  if (tricks.length) {
    items.push(utility(person.id, "dynamic", "Dynamic Magic", dynamicHtml(person, spheres), { type: "special", value: null, override: false, condition: "" }));
  }
  if (s.legendary.resistances) items.push(utility(person.id, "legres", `Legendary Resistance (${s.legendary.resistances}/Day)`, "<p>When this creature fails a saving throw, it can choose to succeed instead.</p>", { type: "special", value: null, override: false, condition: "fails a saving throw" }, { target: "resources.legres.value", value: "1" }));
  if (s.legendary.actions) {
    if (s.attacks.length) items.push(utility(person.id, "leg-strike", "Legendary Action: Strike", `<p>One attack (${esc(s.attacks.map((a) => a.name).join(" or "))}).</p>`, { type: "legendary", value: 1, override: false, condition: "" }, { target: "resources.legact.value", value: "1" }));
    if (tricks.length && s.legendary.actions >= 2) items.push(utility(person.id, "leg-bend", "Legendary Action: Bend the World (Costs 2 Actions)", "<p>One dynamic-magic trick of Area size or smaller.</p>", { type: "legendary", value: 2, override: false, condition: "" }, { target: "resources.legact.value", value: "2" }));
  }
  const ab = (k: string) => ({ value: s.scores[k as Ability], proficient: s.saves.includes(k as Ability) ? 1 : 0, max: null, bonuses: { check: "", save: "" } });
  const bio = `${person.look ? `<p>${esc(person.look)}</p>` : ""}${person.facts?.length ? `<ul>${person.facts.map((f: string) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}${fightHtml(person)}`;
  return {
    name: person.name,
    type: "npc",
    img: o.img,
    system: {
      abilities: Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((k) => [k, ab(k)])),
      attributes: {
        ac: { flat: s.ac, calc: "flat" },
        hp: { value: s.hp, max: s.hp, temp: null, tempmax: null, formula: "" },
        movement: { walk: s.speed.walk, fly: s.speed.fly ?? null, swim: s.speed.swim ?? null, climb: s.speed.climb ?? null, units: "ft", hover: false },
      },
      details: { cr: s.cr, type: { value: "humanoid", custom: "", subtype: person.species ?? "" }, biography: { value: bio, public: "" }, alignment: "" },
      resources: { legact: { max: s.legendary.actions, spent: 0 }, legres: { max: s.legendary.resistances, spent: 0 } },
      traits: { size: s.size, dr: { value: s.resistances, bypasses: [], custom: "" }, di: { value: [], bypasses: [], custom: "" }, dv: { value: [], bypasses: [], custom: "" }, ci: { value: [], custom: "" }, languages: { value: ["common"], custom: "" } },
    },
    prototypeToken: {
      // Nemeses made with Generate are enemies; townsfolk and the people the table has met are neutral.
      name: person.name, actorLink: true, disposition: person.source === "generated" && !person.post ? -1 : 0, displayName: 20, displayBars: 20,
      texture: { src: o.token },
      ring: { enabled: false, colors: { ring: null, background: null }, effects: 1, subject: { scale: 1, texture: null } },
      sight: { enabled: false },
    },
    items,
    flags: { "georgios-nemesis": { world: o.world, person: person.id } },
  };
}
