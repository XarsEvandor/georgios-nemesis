/**
 * A scene keeper's picture description, written right after the sketch and before the full card,
 * so the portrait is painted while Claude writes the rest of them. It follows the sketch's look
 * (which the full card keeps too) and the same rules as the card's own art prompt.
 */

import { placeName, roleAt } from "./cast";
import type { ClaudeRunner } from "./claude";
import { bodyLine, type Body } from "./folk";
import type { Sketch } from "./sketch";

export const KEEPER_ART_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["description"],
  properties: {
    description: { type: "string", description: "A portrait prompt for an image model: one paragraph, concrete; species anatomy spelled out, build, face, clothes, what they hold, pose, setting and light. No names, no text in the image. Never a human unless the species is human" },
  },
} as const;

export const KEEPER_ART_SYSTEM = `You write the picture description a portrait painter (an image model) works from, for a person a Game Master is introducing at the table. The world is Ogeia, a dark gothic fantasy land inside Dracula's castle; nearly everyone there is not human. Keep their sex and body exactly as given (a female minotaur is a cow of her kind, not a bull-headed woman). Follow the sketch's look exactly and add only what a painter needs: build, face, clothes of their trade, what they hold, pose, the place around them and its light. Spell out the species' body (horns, scales, hide, snout, tail, eyes) so the painter does not drift to a human face. State what is in the picture; the painter cannot follow "no", "not" or "without". One concrete paragraph, no names, no text in the image. Answer only with the structured output.`;

export interface KeeperArtInput {
  species: string;
  anatomy?: string;
  /** Their form, once the folk book has biology. */
  body?: Body;
  role: string;
  scene?: string;
  town?: string;
  sketch: Pick<Sketch, "look"> & Partial<Sketch>;
}

export function keeperArtPrompt(i: KeeperArtInput): string {
  return [
    `${i.body ? bodyLine(i.body).replace(/^a /, "A ") : `A ${i.species}${i.anatomy ? ` (${i.anatomy})` : ""}`}. They are ${roleAt(i.role, placeName(i.scene, i.town))}${i.town ? ` in ${i.town}` : ""}.`,
    i.body?.limits ? `What their body rules out or needs: ${i.body.limits}` : "",
    `How they look, from the sketch the Game Master has read out:\n${i.sketch.look}`,
    i.sketch.mannerisms ? `Their habits: ${i.sketch.mannerisms}` : "",
  ].filter(Boolean).join("\n\n");
}

/** Claude's picture description; throws when it comes back empty. */
export async function writeKeeperArt(o: { claude: ClaudeRunner; input: KeeperArtInput; model?: string }): Promise<string> {
  const r = (await o.claude.structured({ prompt: keeperArtPrompt(o.input), system: KEEPER_ART_SYSTEM, schema: KEEPER_ART_SCHEMA, model: o.model, timeoutMs: 120_000 })) as { description?: unknown };
  const text = typeof r?.description === "string" ? r.description.trim() : "";
  if (!text) throw new Error("the picture description came back empty");
  return text;
}
