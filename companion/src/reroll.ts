/**
 * A portrait painted again with the GM's corrections. A fast model rewrites the picture description
 * from the first one Nemesis painted from and every correction since (the later one wins when two
 * disagree), in the plain statements of what is there that the painter follows. The corrections
 * stay on the record, so every later batch keeps them until the GM drops them.
 */

import type { ClaudeRunner } from "./claude";

/** How many corrections a person keeps (the oldest go first), and how long each may be. */
export const MAX_NOTES = 12;
export const NOTE_LENGTH = 500;

export const REVISE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description"],
  properties: {
    description: { type: "string", description: "The new picture description, one paragraph" },
  },
} as const;

export const REVISE_SYSTEM = `You rewrite the picture description a portrait painter works from, after the Game Master looked at the portraits it gave and wrote corrections. The painter is an image model: it draws what the words name and cannot follow "no", "not" or "without", so state what is in the picture ("a scaled lizard face with a long snout and slit pupils", never "no human face"). Apply every correction; when two disagree, the later one wins. Keep everything the corrections do not touch: species, body, clothes, setting, light, framing. For a creature that is not human, keep naming its body plainly (snout, horns, scales, hide, tail, eyes), since the painter otherwise drifts to a human face. Keep the length and style of the description you get. The world is Ogeia, dark gothic fantasy. Answer only with the structured output.`;

export interface ReviseInput {
  /** The description Nemesis first painted from. */
  base: string;
  species?: string;
  look?: string;
  /** The GM's corrections, oldest first. */
  notes: string[];
}

export function revisePrompt(i: ReviseInput): string {
  return [
    `The description the painter worked from:\n${i.base}`,
    i.species ? `Species: ${i.species}.` : "",
    i.look ? `How the person looks, from their card: ${i.look}` : "",
    `The Game Master's corrections, oldest first:\n${i.notes.map((n, k) => `${k + 1}. ${n}`).join("\n")}`,
  ].filter(Boolean).join("\n\n");
}

/** The GM's new correction added to the ones on record (or in place of them), trimmed and capped. */
export function nextNotes(old: unknown, note: unknown, forget: boolean): string[] {
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, NOTE_LENGTH) : "");
  const kept = forget || !Array.isArray(old) ? [] : old.map(clean).filter(Boolean);
  const fresh = clean(note);
  return [...kept, ...(fresh ? [fresh] : [])].slice(-MAX_NOTES);
}

/** Claude's new description; throws when it comes back empty. */
export async function revisePortrait(o: { claude: ClaudeRunner; input: ReviseInput; model?: string }): Promise<string> {
  const r = (await o.claude.structured({ prompt: revisePrompt(o.input), system: REVISE_SYSTEM, schema: REVISE_SCHEMA, model: o.model, timeoutMs: 90_000 })) as { description?: unknown };
  const text = typeof r?.description === "string" ? r.description.trim() : "";
  if (!text) throw new Error("the corrected description came back empty");
  return text;
}
