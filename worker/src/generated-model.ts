import {
  PRESENTATION_KEYS,
  validateGeneratedGameplayProposal,
  type GeneratedGameplayProposal,
} from "../../src/core/generated-validator";
import type { CanonicalGeneratedBody } from "./generated-catalog";
import { DEFAULT_MODEL, type ModelEnv } from "./model";

export type GeneratedUpstreamResult =
  | { ok: true; value: GeneratedGameplayProposal }
  | { ok: false; status: number; reason: string };

export const GENERATED_SYSTEM = `You select one bounded gameplay candidate for "The Ascent of Karl".

The server has already derived every allowed candidate and owns all taxonomy,
progression effects, ids, history and safety. Choose exactly one offered
candidateKey and one presentationKey.

Never invent a new key. Never add prose, taxonomy, flags, solves, historical
claims, branches, endings, identifiers, or extra fields.

Return exactly:
{"schemaVersion":1,"candidateKey":"one offered key","presentationKey":"plain|dry-pride|quiet-regret"}`;

export function generatedPrompt(body: CanonicalGeneratedBody): string {
  return JSON.stringify({
    act: body.act,
    parents: [
      { id: body.a.id, name: body.a.name },
      { id: body.b.id, name: body.b.name },
    ],
    candidates: body.candidates.map((candidate) => ({
      candidateKey: candidate.candidateKey,
      operation: candidate.operation,
      result: {
        name: candidate.element.name,
        kind: candidate.element.kind,
        stuff: candidate.element.stuff,
        traits: candidate.element.traits,
        scale: candidate.element.scale,
      },
    })),
    presentationKeys: PRESENTATION_KEYS,
  });
}

export const GENERATED_PROMPT_VERSION_INPUT = [
  GENERATED_SYSTEM,
  generatedPrompt({
    act: 1,
    a: {
      id: "a",
      name: "A",
      emoji: "",
      act: 1,
      base: true,
      kind: "material",
      stuff: "stone",
      traits: ["hard"],
      scale: "hand",
    },
    b: {
      id: "b",
      name: "B",
      emoji: "",
      act: 1,
      base: true,
      kind: "material",
      stuff: "wood",
      traits: ["light"],
      scale: "hand",
    },
    candidates: [],
  }),
].join("\u0000");

export async function callGeneratedOpenAI(
  body: CanonicalGeneratedBody,
  env: ModelEnv,
): Promise<GeneratedUpstreamResult> {
  const candidateKeys = body.candidates.map((candidate) => candidate.candidateKey);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + env.OPENAI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.MODEL ?? DEFAULT_MODEL,
        messages: [
          { role: "system", content: GENERATED_SYSTEM },
          { role: "user", content: generatedPrompt(body) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "karl_generated_gameplay_selection",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["schemaVersion", "candidateKey", "presentationKey"],
              properties: {
                schemaVersion: { const: 1 },
                candidateKey: { type: "string", enum: candidateKeys },
                presentationKey: {
                  type: "string",
                  enum: PRESENTATION_KEYS,
                },
              },
            },
          },
        },
        temperature: 0.2,
        max_tokens: 80,
      }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    return { ok: false, status: 504, reason: "timeout or network" };
  }
  if (!response.ok) return { ok: false, status: 502, reason: "upstream" };
  let parsed: unknown;
  try {
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "");
  } catch {
    return { ok: false, status: 502, reason: "invalid model output" };
  }
  const validation = validateGeneratedGameplayProposal(parsed, body.a, body.b);
  if (!validation.ok) {
    return { ok: false, status: 502, reason: "invalid model output" };
  }
  return { ok: true, value: validation.proposal };
}
