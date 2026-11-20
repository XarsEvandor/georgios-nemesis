/**
 * Someone written before the folk book had biology, in a body their species does not have (a
 * female minotaur written as a bull-headed woman): Claude rewrites only the lines that describe
 * their body, to their form, and keeps everything else (name, role, voice, wants, what the table
 * knows, game numbers).
 */

import type { ClaudeRunner } from "./claude";
import { bodyFacts, bodyLine, type Body } from "./folk";
import type { NRecord } from "./store";

/** The parts of a record that may describe a body; never the name, role, memory or links. */
const BODY_PATHS = [/^look$/, /^personality$/, /^combatStyle$/, /^strength$/, /^weakness$/, /^(wants|fears|beliefs)\.\d+$/, /^dynamic\.worldview$/, /^dynamic\.tricks\.\d+\.(name|text|vsMages)$/, /^static\.(attacks|powers)\.\d+\.(name|text)$/, /^notes\./, /^art\.base$/];

/** Every text line of the record that may describe their body, by path ("static.attacks.1.text"). */
export function bodyTexts(rec: NRecord): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      if (BODY_PATHS.some((re) => re.test(path)) && v.trim()) out.push({ path, text: v });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk({ ...rec, art: rec.art?.base ?? rec.art?.prompt ? { base: rec.art.base ?? rec.art.prompt } : undefined }, "");
  return out;
}

export const RESHAPE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["changes"],
  properties: {
    changes: {
      type: "array",
      description: "Only the lines that must change for their body; each with its path exactly as given",
      items: { type: "object", additionalProperties: false, required: ["path", "text"], properties: { path: { type: "string" }, text: { type: "string" } } },
    },
  },
} as const;

export const RESHAPE_SYSTEM = `You fix a person's body in a Game Master's D&D campaign world (Ogeia, dark gothic fantasy). They were written in a body their species does not have; you are given the body they truly have. Rewrite only the lines that describe their body (head, horns, size, build, hide, how they move, what their body does in a fight), so every line fits that body. Keep everything else exactly: their name, voice, habits, wants, fears, history, tricks' effects and game sense. Keep each line's length and style. A line that already fits stays out of your answer. The picture description ("art.base") is for an image model: one concrete paragraph, no names, stating what is in the picture. Answer only with the structured output.`;

export function reshapePrompt(rec: NRecord, body: Body, note?: string): string {
  return [
    `${rec.name}, ${rec.role ?? ""}. Their true body: ${bodyLine(body)}.`,
    ...bodyFacts(body),
    note ? `The Game Master adds: ${note}` : "",
    "\nTheir lines (path: text):",
    ...bodyTexts(rec).map((t) => `${t.path}: ${t.text}`),
  ].filter(Boolean).join("\n");
}

/** Sets a value at a dotted path ("static.attacks.1.text") in a copy-friendly way (mutates `o`). */
function setPath(o: Record<string, any>, path: string, value: string): void {
  const keys = path.split(".");
  let at: any = o;
  for (const k of keys.slice(0, -1)) at = at[k];
  at[keys.at(-1)!] = value;
}

/** Claude's rewrite of their body lines; returns the record with them, their sex and form. */
export async function reshapePerson(o: { claude: ClaudeRunner; rec: NRecord; body: Body; note?: string; model?: string }): Promise<{ person: NRecord; changed: string[] }> {
  const allowed = new Set(bodyTexts(o.rec).map((t) => t.path));
  const r = (await o.claude.structured({ prompt: reshapePrompt(o.rec, o.body, o.note), system: RESHAPE_SYSTEM, schema: RESHAPE_SCHEMA, model: o.model, timeoutMs: 300_000 })) as { changes?: Array<{ path: string; text: string }> };
  const person: NRecord = structuredClone(o.rec);
  person.art = { ...(person.art ?? {}) };
  const changed: string[] = [];
  for (const c of r.changes ?? []) {
    if (!allowed.has(c.path) || !c.text?.trim()) continue;
    if (c.path === "art.base") person.art.base = c.text.trim();
    else setPath(person, c.path, c.text.trim());
    changed.push(c.path);
  }
  // Rerolls start again from the corrected description.
  if (changed.includes("art.base")) person.art.prompt = person.art.base;
  if (o.body.sex) person.sex = o.body.sex;
  if (o.body.called) person.form = o.body.called;
  else delete person.form;
  return { person, changed };
}
