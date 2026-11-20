/**
 * Georgios' Nemesis records: the six record types as JSON Schemas, and a small validator for the
 * subset of JSON Schema they use. Every write the companion makes is checked here first; the same
 * schemas become Claude's tool input schemas in the generator (Phase 1).
 *
 * Records point at Map Maker's state and town ids and never copy its geography or history.
 */

export type Schema = {
  type?: "object" | "array" | "string" | "integer" | "number" | "boolean";
  enum?: readonly unknown[];
  required?: readonly string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  propertyNames?: { enum: readonly string[] };
  items?: Schema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  description?: string;
};

export const SPHERES = ["Correspondence", "Entropy", "Forces", "Life", "Matter", "Mind", "Prime", "Spirit", "Time"] as const;
/** Sizes of a dynamic-magic effect, smallest first (the magic doc's success lines 11+, 13+, 15+, 17+). */
export const SIZES = ["Personal", "Area", "Environment", "Cataclysm"] as const;
/** The rank ladder. "unranked" is for plot characters outside it (Dracula). */
export const RANKS = ["villager", "soldier", "veteran", "captain", "general", "archmage", "monarch", "unranked"] as const;
export const PERSON_STATES = ["alive", "scarred", "turned", "missing", "dead", "harvested"] as const;
export const KINDS = ["persons", "factions", "towns", "armies", "events", "rumors"] as const;
export type Kind = (typeof KINDS)[number];

const ID: Schema = { type: "string", pattern: "^[a-z0-9][a-z0-9-]{0,63}$" };
const IDS: Schema = { type: "array", items: ID, maxItems: 500 };
const TEXT: Schema = { type: "string", minLength: 1, maxLength: 4000 };
const TEXTS: Schema = { type: "array", items: TEXT, maxItems: 200 };
const TOWN: Schema = { type: "integer", minimum: 0, description: "Map Maker town (burg) id" };
const SCALE: Schema = { type: "integer", minimum: 0, maximum: 10 };
const SOURCE: Schema = { enum: ["import", "seed", "generated", "gm", "session"] };
const FLAGS: Schema = {
  type: "object", additionalProperties: false,
  properties: {
    plotLocked: { type: "boolean", description: "Claude never generates or moves this record" },
    gmOnly: { type: "boolean", description: "never shown in a player view, rumor or what-the-party-hears list" },
  },
};
const LINKS: Schema = {
  type: "object", additionalProperties: false,
  properties: {
    scribbler: { ...TEXTS, description: "names of the Georgios Scribbler entries this record links (matched by name or alias)" },
    actor: { type: "string", maxLength: 200 },
    journal: { type: "string", maxLength: 200 },
  },
};
/** Portraits: both versions are kept and the GM picks one inside Foundry. */
const ART: Schema = {
  type: "object", additionalProperties: false,
  properties: {
    final: { type: "string", maxLength: 500 },
    layout: { type: "string", maxLength: 500 },
    picked: { enum: ["final", "layout", "own"] },
    own: { type: "string", maxLength: 500, description: "an image the GM supplied" },
    token: { type: "string", maxLength: 500 },
    prompt: TEXT,
    /** The description the first portrait was painted from; rerolls rewrite it with the notes. */
    base: TEXT,
    notes: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 12, description: "the GM's corrections to the portrait, oldest first" },
    /** The other pair from the last reroll, for undo (newer: it is the reroll, after an undo). */
    prev: {
      type: "object", additionalProperties: false,
      properties: {
        final: { type: "string", maxLength: 500 },
        layout: { type: "string", maxLength: 500 },
        picked: { enum: ["final", "layout", "own"] },
        prompt: TEXT,
        notes: { type: "array", items: { type: "string", maxLength: 500 }, maxItems: 12 },
        newer: { type: "boolean" },
      },
    },
  },
};
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: "object", additionalProperties: false, properties, required });
const list = (items: Schema, maxItems = 200): Schema => ({ type: "array", items, maxItems });

const ABILITY = { enum: ["str", "dex", "con", "int", "wis", "cha"] };
const DICE: Schema = obj({ number: { type: "integer", minimum: 0, maximum: 200 }, die: { enum: [4, 6, 8, 10, 12, 20] }, bonus: { type: "integer", minimum: -20, maximum: 500 } }, ["number", "die", "bonus"]);
const SCORE: Schema = { type: "integer", minimum: 1, maximum: 40 };

/** The static kit: a stat block whose numbers come from the balance table. */
const STATIC: Schema = obj({
  hp: { type: "integer", minimum: 1 },
  ac: { type: "integer", minimum: 5, maximum: 40 },
  cr: { type: "integer", minimum: 0, maximum: 30 },
  size: { enum: ["tiny", "sm", "med", "lg", "huge", "grg"] },
  speed: obj({ walk: { type: "integer", minimum: 0 }, fly: { type: "integer", minimum: 0 }, swim: { type: "integer", minimum: 0 }, climb: { type: "integer", minimum: 0 } }, ["walk"]),
  scores: obj({ str: SCORE, dex: SCORE, con: SCORE, int: SCORE, wis: SCORE, cha: SCORE }, ["str", "dex", "con", "int", "wis", "cha"]),
  saves: { type: "array", items: ABILITY, maxItems: 6 },
  attacksPerRound: { type: "integer", minimum: 0, maximum: 8 },
  attacks: list(obj({ name: TEXT, kind: { enum: ["melee", "ranged"] }, damageType: TEXT, toHit: { type: "integer", minimum: -5, maximum: 40 }, dice: DICE, text: TEXT }, ["name", "kind", "damageType", "toHit", "dice"]), 6),
  powers: list(obj({
    name: TEXT, save: ABILITY, dc: { type: "integer", minimum: 5, maximum: 40 }, effect: TEXT, damageType: TEXT, dice: DICE,
    area: { enum: ["one", "line", "cone", "burst"] }, recharge: { type: "integer", minimum: 2, maximum: 6 }, text: TEXT,
  }, ["name", "save", "dc", "effect", "damageType", "area"]), 6),
  resistances: TEXTS,
  legendary: obj({ actions: { type: "integer", minimum: 0, maximum: 5 }, resistances: { type: "integer", minimum: 0, maximum: 5 } }, ["actions", "resistances"]),
  trickDc: { type: "integer", minimum: 5, maximum: 40 },
  notes: TEXT,
});

/** The GM's notes for running a person on the fly (written with the card; the GM may edit them). */
const NOTES: Schema = obj({
  paradigm: obj({ summary: TEXT, tools: TEXT, signs: TEXT, limits: TEXT }),
  spheres: list(obj({ sphere: { enum: SPHERES }, uses: TEXTS }, ["sphere", "uses"]), 9),
  mind: obj({ priorities: TEXT, decisions: TEXT, knows: TEXT, underlings: TEXT }),
  tactics: obj({ opening: TEXT, pressure: TEXT, hurt: TEXT, retreat: TEXT, combo: TEXT, vsMages: TEXT, terrain: TEXT, building: TEXT }),
  roleplay: obj({ voice: TEXT, mannerisms: TEXT, lines: TEXTS, threats: TEXT, bribes: TEXT, flattery: TEXT, mercy: TEXT, secret: TEXT }),
});

export const PERSON: Schema = obj({
  id: ID, name: TEXT, aliases: TEXTS, species: TEXT, look: { ...TEXT, description: "what the person looks like" },
  sex: { enum: ["female", "male", "none"], description: "one of the forms their species has" },
  form: { ...TEXT, description: "what their culture calls their form, when it is not the species' name (a minotaur cow's own word)" },
  rank: { enum: RANKS }, role: TEXT,
  faction: ID, home: TOWN, superior: ID,
  /** Townsfolk: the place and role they keep on Map Maker's maps, so a rebuilt scene finds them again. */
  post: obj({ town: TOWN, place: { type: "string", minLength: 1, maxLength: 300 }, role: TEXT, n: { type: "integer", minimum: 0, maximum: 50 }, scene: TEXT }, ["town", "place", "role"]),
  static: STATIC,
  dynamic: obj({
    spheres: { type: "object", propertyNames: { enum: SPHERES }, additionalProperties: { type: "integer", minimum: 1, maximum: 5 } },
    only: { type: "boolean", description: "uses only dynamic magic: no static spells or innate powers" },
    worldview: TEXT,
    tricks: list(obj({
      name: TEXT, sphere: { enum: SPHERES }, size: { enum: SIZES }, text: TEXT,
      vsMages: { ...TEXT, description: "how it reaches a mage through the world; direct magic does nothing to a mage" },
    }, ["name", "sphere", "size", "text", "vsMages"]), 4),
  }),
  wants: TEXTS, fears: TEXTS, beliefs: TEXTS, facts: { ...TEXTS, description: "what the table has established" },
  personality: TEXT, combatStyle: TEXT, strength: TEXT, weakness: TEXT, notes: NOTES,
  /** Where a generated person came from: the rolled seeds and the GM's note. */
  origin: obj({ seeds: { type: "object", additionalProperties: { type: "string", maxLength: 400 } }, note: TEXT, model: { type: "string", maxLength: 80 } }),
  feelings: list(obj({ toward: TEXT, feeling: TEXT }, ["toward", "feeling"])),
  relationships: list(obj({ kind: { enum: ["superior", "subordinate", "spouse", "family", "lover", "rival", "ally", "debt", "other"] }, with: TEXT, note: TEXT }, ["kind", "with"])),
  commitments: list(obj({ kind: { enum: ["order", "deal", "promise", "request", "mind", "brand"] }, text: TEXT, from: TEXT, tier: { enum: ["senses", "heart", "will"] }, expires: TEXT }, ["kind", "text"])),
  memory: list(obj({ when: TEXT, text: TEXT }, ["when", "text"]), 1000),
  knows: list(obj({ about: TEXT, text: TEXT }, ["about", "text"])),
  state: { enum: PERSON_STATES }, heirOf: ID,
  flags: FLAGS, gmNotes: TEXTS, links: LINKS, art: ART, source: SOURCE,
}, ["id", "name", "state"]);

export const GOAL: Schema = obj({ kind: { enum: ["want", "fear"] }, text: TEXT, clock: obj({ size: { type: "integer", minimum: 4, maximum: 8 }, filled: { type: "integer", minimum: 0, maximum: 8 } }, ["size", "filled"]) }, ["kind", "text"]);
const STANCE: Schema = { enum: ["allied", "friendly", "neutral", "wary", "hostile", "war"] };

export const FACTION: Schema = obj({
  id: ID, name: TEXT, kind: { enum: ["realm", "custom"] },
  state: { type: "integer", minimum: 0, description: "Map Maker state id" }, culture: TEXT, faith: TEXT, capital: TOWN,
  ruler: ID, archmages: IDS,
  goals: list(GOAL, 40),
  relations: list(obj({ with: ID, stance: STANCE, note: TEXT }, ["with", "stance"])),
  party: obj({ stance: STANCE, note: TEXT }),
  treatment: obj({ mages: TEXT, peoples: TEXT }),
  unrest: SCALE, summary: TEXT, facts: TEXTS,
  flags: FLAGS, gmNotes: TEXTS, links: LINKS, source: SOURCE,
}, ["id", "name", "kind"]);

export const TOWN_STATE: Schema = obj({
  id: ID, town: TOWN, owner: ID,
  garrison: obj({ size: { type: "integer", minimum: 0 }, note: TEXT }),
  unrest: SCALE, damage: SCALE, present: IDS, notes: TEXTS,
  flags: FLAGS, gmNotes: TEXTS, links: LINKS, source: SOURCE,
}, ["id", "town"]);

export const ARMY: Schema = obj({
  id: ID, name: TEXT, faction: ID, commander: ID,
  size: { type: "integer", minimum: 0 }, quality: { enum: ["levy", "regular", "veteran", "elite"] },
  at: obj({ town: TOWN, route: { type: "integer", minimum: 0 } }),
  loyalty: SCALE, morale: SCALE, orders: TEXT,
  flags: FLAGS, gmNotes: TEXTS, source: SOURCE,
}, ["id", "name", "faction"]);

export const EVENT: Schema = obj({
  id: ID, what: TEXT,
  when: obj({ year: { type: "integer" }, month: { type: "integer", minimum: 1, maximum: 24 }, day: { type: "integer", minimum: 1, maximum: 60 }, session: TEXT }, ["year"]),
  why: TEXT, cause: { enum: ["turn", "session", "gm", "seed", "import"] }, by: TEXT,
  visibility: { enum: ["gm", "party", "public"] }, refs: list({ type: "string", maxLength: 80 }),
  source: SOURCE,
}, ["id", "what", "when", "cause", "visibility"]);

export const RUMOR: Schema = obj({
  id: ID, text: TEXT, event: ID, towns: list(TOWN, 500), weeks: { type: "integer", minimum: 0 }, source: SOURCE,
}, ["id", "text"]);

export const SCHEMAS: Record<Kind, Schema> = { persons: PERSON, factions: FACTION, towns: TOWN_STATE, armies: ARMY, events: EVENT, rumors: RUMOR };

const typeOf = (v: unknown) => (Array.isArray(v) ? "array" : v === null ? "null" : Number.isInteger(v) ? "integer" : typeof v);

/** Checks a value against a schema; returns "path: problem" lines (empty when valid). */
export function validate(schema: Schema, value: unknown, path = "$"): string[] {
  const errs: string[] = [];
  if (schema.enum && !schema.enum.includes(value)) return [`${path}: must be one of ${schema.enum.join(", ")}`];
  const t = typeOf(value);
  if (schema.type) {
    const ok = schema.type === t || (schema.type === "number" && (t === "integer" || t === "number"));
    if (!ok) return [`${path}: must be ${schema.type === "integer" ? "a whole number" : `a ${schema.type}`}`];
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errs.push(`${path}: must not be empty`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errs.push(`${path}: longer than ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: "${value}" is not a valid id (lowercase letters, digits and hyphens)`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items!, v, `${path}[${i}]`)));
  }
  if (t === "object") {
    const o = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (o[k] === undefined) errs.push(`${path}.${k}: required`);
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      if (schema.propertyNames && !schema.propertyNames.enum.includes(k)) errs.push(`${path}: "${k}" must be one of ${schema.propertyNames.enum.join(", ")}`);
      const sub = schema.properties?.[k];
      if (sub) errs.push(...validate(sub, v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: unknown field`);
      else if (typeof schema.additionalProperties === "object") errs.push(...validate(schema.additionalProperties, v, `${path}.${k}`));
    }
  }
  return errs;
}
