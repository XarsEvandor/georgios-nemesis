/**
 * The sketch: what the GM needs to introduce a person at once (how they look, their habits, how
 * they talk, a line or two), written by a fast model in seconds while the full card is still being
 * written. The full card is then told to keep it, so nothing said at the table is contradicted.
 */

import { placeName, roleAt } from "./cast";
import type { ClaudeRunner } from "./claude";
import { bodyFacts, bodyLine, type Body } from "./folk";

export interface Sketch {
  look: string;
  mannerisms: string;
  voice: string;
  lines: string[];
}

const str = (description: string) => ({ type: "string", description });

export const SKETCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["look", "mannerisms", "voice", "lines"],
  properties: {
    look: str("Two or three sentences the GM reads aloud: their body as their species has it (horns, scales, hide, eyes, build), clothes of their trade, one striking detail"),
    mannerisms: str("Two habits the players will notice at once"),
    voice: str("How they talk: pace, pitch, accent, pet words"),
    lines: { type: "array", items: { type: "string" }, description: "Two things they might say first, in their own voice" },
  },
} as const;

export const SKETCH_SYSTEM = `You sketch a person a Game Master is about to introduce at the table. The world is Ogeia, a dark gothic fantasy land inside Dracula's castle; its people call Dracula "the Lord". Nearly everyone there is not human, and any mythical creature may live there. Keep their sex and body exactly as given (a female minotaur is a cow of her kind, not a bull-headed woman), and let what their body rules out or needs shape how they work and move. Be concrete and brief: the GM reads this aloud within seconds. Invent nothing about the wider world (no new realms, wars, gods or history). Answer only with the structured output.`;

export interface SketchInput {
  name: string;
  species: string;
  /** The species' body, from the folk book. */
  anatomy?: string;
  /** Their form (sex, the culture's word, that form's body and limits), once the folk book has biology. */
  body?: Body;
  role: string;
  scene?: string;
  town?: string;
  faction?: string;
  culture?: string;
  way?: string;
}

export function sketchPrompt(i: SketchInput): string {
  return [
    i.body ? `${i.name}, ${bodyLine(i.body)}.` : `${i.name}, a ${i.species}${i.anatomy ? ` (${i.anatomy})` : ""}.`,
    ...(i.body ? bodyFacts(i.body) : []),
    `They are ${roleAt(i.role, placeName(i.scene, i.town))}${i.town ? ` in ${i.town}` : ""}${i.faction ? `, in the ${i.faction}` : ""}.`,
    i.culture ? `Their people live the ${i.culture} way${i.way ? ` (${i.way})` : ""}.` : "",
  ].filter(Boolean).join("\n");
}

/** Claude's sketch, tidied; throws when it comes back without a look or a voice. */
export async function writeSketch(o: { claude: ClaudeRunner; input: SketchInput; model?: string }): Promise<Sketch> {
  const s = (await o.claude.structured({ prompt: sketchPrompt(o.input), system: SKETCH_SYSTEM, schema: SKETCH_SCHEMA, model: o.model, timeoutMs: 60_000 })) as Partial<Sketch>;
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const out: Sketch = {
    look: text(s.look),
    mannerisms: text(s.mannerisms),
    voice: text(s.voice),
    lines: (Array.isArray(s.lines) ? s.lines : []).map(text).filter(Boolean).slice(0, 3),
  };
  if (!out.look || !out.voice) throw new Error("the sketch came back without a look or a voice");
  return out;
}
