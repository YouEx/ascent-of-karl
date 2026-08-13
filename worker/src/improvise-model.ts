/**
 * Modellen skriver kun navnet og flavoren. Klassifikation og progression
 * tilhører den deterministiske klient og indgår bevidst ikke i skemaet.
 */

import type { CanonicalImproviseBody, CanonicalThing } from "./catalog";
import { DEFAULT_MODEL, type ModelEnv } from "./model";
import {
  IMPROVISE_OUTPUT_LIMITS,
  validateImproviseOutput,
  type ImproviseCopy,
} from "./improvise-output";

export type ImproviseUpstreamResult =
  | { ok: true; value: ImproviseCopy }
  | { ok: false; status: number; reason: string };

export const IMPROVISE_SYSTEM = `You write discovery copy for "The Ascent of Karl", a stone-age game about one man reinventing history badly.

Return only a short English name and flavor text for the thing Karl plausibly or absurdly made from the two supplied canonical parents.

VOICE:
- Warm, dry, literary humor.
- Karl is lovable and overconfident, never humiliated.
- Understatement beats punchlines.
- The result should feel specific to both parents.

HARD LIMITS:
- The name is at most three words.
- The flavor is at most ${IMPROVISE_OUTPUT_LIMITS.flavorChars} characters, one or two short sentences.
- No URLs, quotation marks, control characters, placeholders, or punctuation noise.
- Do not classify the result. Do not return kind, stuff, traits, scale, solves, flags, ageUp, ending, ids, parents, origin, or depth.
- Return exactly the JSON fields "name" and "flavor".`;

export const IMPROVISE_EXAMPLES: readonly {
  parents: string;
  output: ImproviseCopy;
}[] = [
  {
    parents: "Mud + Berries",
    output: {
      name: "Mud pie",
      flavor:
        "Mud, moulded into a cake, decorated with a berry. Karl takes a bite, then another.",
    },
  },
  {
    parents: "Grubs + Fire",
    output: {
      name: "Roasted grubs",
      flavor:
        "Crisp, nutty, and technically dinner. Karl is delighted; everyone else has become very quiet.",
    },
  },
  {
    parents: "Neighbour + Hide",
    output: {
      name: "The huddle",
      flavor:
        "Karl and the neighbour sit back to back, saying nothing. It is the warmest either has been.",
    },
  },
];

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "flavor"],
  properties: {
    name: {
      type: "string",
      maxLength: IMPROVISE_OUTPUT_LIMITS.nameChars,
      description: "English discovery name, at most three words.",
    },
    flavor: {
      type: "string",
      maxLength: IMPROVISE_OUTPUT_LIMITS.flavorChars,
      description: "One or two short English sentences in the Karl voice.",
    },
  },
} as const;

const RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "karl_improvisation_copy",
    strict: true,
    schema: RESPONSE_SCHEMA,
  },
} as const;

const MODEL_OPTIONS = {
  temperature: 0.8,
  max_tokens: 120,
} as const;

function describeParent(parent: CanonicalThing): string {
  return JSON.stringify({
    name: parent.name,
    flavor: parent.flavor ?? "",
    taxonomy: {
      kind: parent.kind ?? null,
      stuff: parent.stuff ?? null,
      traits: parent.traits,
      scale: parent.scale ?? null,
    },
  });
}

export function buildImproviseUserPrompt(body: CanonicalImproviseBody): string {
  const examples = IMPROVISE_EXAMPLES.map(
    (example, index) =>
      `EXAMPLE ${index + 1}\nPARENTS: ${example.parents}\nOUTPUT: ${JSON.stringify(example.output)}`,
  ).join("\n\n");
  return [
    examples,
    `ACT: ${body.act}`,
    `FIRST: ${describeParent(body.a)}`,
    `SECOND: ${describeParent(body.b)}`,
    "Write only the new name and flavor.",
  ].join("\n\n");
}

function buildMessages(body: CanonicalImproviseBody) {
  return [
    { role: "system", content: IMPROVISE_SYSTEM },
    { role: "user", content: buildImproviseUserPrompt(body) },
  ] as const;
}

const PROMPT_FINGERPRINT_BODY: CanonicalImproviseBody = {
  act: 314159,
  a: {
    id: "fingerprint-a",
    name: "__FIRST_NAME__",
    flavor: "__FIRST_FLAVOR__",
    kind: "material",
    stuff: "stone",
    traits: ["hard", "heavy"],
    scale: "hand",
  },
  b: {
    id: "fingerprint-b",
    name: "__SECOND_NAME__",
    flavor: "__SECOND_FLAVOR__",
    kind: "tool",
    stuff: "wood",
    traits: ["sharp", "light"],
    scale: "body",
  },
};

/**
 * Hele den faktiske modelkontrakt. Samme renderer, beskriver og message-
 * builder som runtime-kaldet bruges på en fuldt udfyldt sentinel, så en
 * ændring i literals, eksempler, feltstruktur eller serialisering ændrer
 * navnerummet automatisk.
 */
export const IMPROVISE_PROMPT_VERSION_INPUT = [
  buildMessages(PROMPT_FINGERPRINT_BODY)
    .map((message) => `${message.role}\u0001${message.content}`)
    .join("\u0002"),
  JSON.stringify(RESPONSE_FORMAT),
  JSON.stringify(MODEL_OPTIONS),
  JSON.stringify(IMPROVISE_OUTPUT_LIMITS),
].join("\u0000");

export async function callImproviseOpenAI(
  body: CanonicalImproviseBody,
  env: ModelEnv,
): Promise<ImproviseUpstreamResult> {
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.MODEL ?? DEFAULT_MODEL,
        messages: buildMessages(body),
        response_format: RESPONSE_FORMAT,
        ...MODEL_OPTIONS,
      }),
    });
  } catch {
    return { ok: false, status: 502, reason: "network" };
  }

  if (!response.ok) return { ok: false, status: 502, reason: "upstream" };

  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    return { ok: false, status: 502, reason: "bad json" };
  }

  const content = data.choices?.[0]?.message?.content;
  let parsed: unknown;
  try {
    parsed = content === undefined ? undefined : JSON.parse(content);
  } catch {
    return { ok: false, status: 502, reason: "invalid model output" };
  }

  const value = validateImproviseOutput(parsed);
  if (!value) return { ok: false, status: 502, reason: "invalid model output" };
  return { ok: true, value };
}
