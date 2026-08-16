import type {
  RuntimeCommentaryModelRequest,
  RuntimeCommentaryRole,
} from "../../src/product/runtime-commentary";
import { passesVoiceGate } from "./voice/gate";

export const DEFAULT_RUNTIME_COMMENTARY_MODEL =
  "gpt-4.1-nano-2025-04-14";

export interface RuntimeCommentaryModelEnv {
  OPENAI_API_KEY: string;
  RUNTIME_COMMENTARY_MODEL?: string;
}

export type RuntimeCommentaryUpstreamResult =
  | {
      ok: true;
      value: {
        schemaVersion: 1;
        text: string;
        roles: RuntimeCommentaryRole[];
      };
    }
  | { ok: false; status: 502 | 504; reason: string };

export const RUNTIME_COMMENTARY_SYSTEM = `You write one additional narrator beat for "The Ascent of Karl".

The authored narrator has already delivered the immediate gameplay explanation.
Your line adds run-specific humour, guidance, or story continuity.

VOICE: dry, literary, affectionate contempt. Patient documentary narrator.
Understatement over jokes. Never cruel, zany, motivational, or generic.

HARD RULES:
- English only.
- One or two sentences, 20-260 characters.
- Mention Karl or at least one required term from the supplied cue.
- Make the line specific to this exact run moment and distinct from recent lines.
- Never address the player as "you".
- Never state historical facts, dates, years, sources, or educational claims.
- Never invent an item, gameplay effect, branch, ending, need, or event.
- Return only the strict JSON object requested by the schema.`;

export function runtimeCommentaryPrompt(
  body: RuntimeCommentaryModelRequest,
): string {
  return JSON.stringify({
    lifeSeed: body.seedCode,
    commentaryIndex: body.commentaryIndex,
    moment: body.cue,
    runState: body.run,
    recentNarratorLines: body.recentLines,
  });
}

function exactOutput(
  raw: unknown,
): raw is {
  schemaVersion: 1;
  text: string;
  roles: RuntimeCommentaryRole[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  const roles = value.roles;
  return (
    Object.keys(value).sort().join(",") ===
      "roles,schemaVersion,text" &&
    value.schemaVersion === 1 &&
    typeof value.text === "string" &&
    Array.isArray(roles) &&
    roles.length > 0 &&
    roles.length <= 3 &&
    roles.every((role) =>
      ["humour", "guidance", "story"].includes(String(role)),
    ) &&
    new Set(roles).size === roles.length
  );
}

function validText(
  text: string,
  requiredTerms: readonly string[],
): boolean {
  const trimmed = text.trim();
  if (
    trimmed !== text ||
    text.length < 20 ||
    text.length > 260 ||
    text.includes("\n") ||
    /\b(?:19|20|21|[0-9]{1,2})(?:st|nd|rd|th)? century\b/i.test(text) ||
    /\b[0-9]{3,4}\s*(?:bc|bce|ad|ce)\b/i.test(text) ||
    /\b(?:historically|archaeologists?|according to|evidence shows)\b/i.test(
      text,
    ) ||
    /https?:\/\//i.test(text) ||
    /\byou\b/i.test(text)
  ) {
    return false;
  }
  const sentenceMarks = text.match(/[.!?](?:\s|$)/g)?.length ?? 0;
  if (sentenceMarks > 2) return false;
  const lower = text.toLowerCase();
  const specificTerms = requiredTerms.filter(
    (term) => term.toLowerCase() !== "karl",
  );
  const terms = specificTerms.length > 0 ? specificTerms : requiredTerms;
  if (
    !terms.some((term) =>
      lower.includes(term.toLowerCase()),
    )
  ) {
    return false;
  }
  return passesVoiceGate(text);
}

export async function callRuntimeCommentaryOpenAI(
  body: RuntimeCommentaryModelRequest,
  env: RuntimeCommentaryModelEnv,
): Promise<RuntimeCommentaryUpstreamResult> {
  let response: Response;
  try {
    response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model:
            env.RUNTIME_COMMENTARY_MODEL ??
            DEFAULT_RUNTIME_COMMENTARY_MODEL,
          messages: [
            { role: "system", content: RUNTIME_COMMENTARY_SYSTEM },
            { role: "user", content: runtimeCommentaryPrompt(body) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "karl_runtime_commentary",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["schemaVersion", "text", "roles"],
                properties: {
                  schemaVersion: { const: 1 },
                  text: {
                    type: "string",
                    minLength: 20,
                    maxLength: 260,
                  },
                  roles: {
                    type: "array",
                    minItems: 1,
                    maxItems: 3,
                    uniqueItems: true,
                    items: {
                      type: "string",
                      enum: ["humour", "guidance", "story"],
                    },
                  },
                },
              },
            },
          },
          temperature: 0.9,
          max_tokens: 100,
        }),
        signal: AbortSignal.timeout(2200),
      },
    );
  } catch {
    return { ok: false, status: 504, reason: "timeout or network" };
  }
  if (!response.ok) {
    return { ok: false, status: 502, reason: "upstream" };
  }
  let parsed: unknown;
  try {
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "");
  } catch {
    return { ok: false, status: 502, reason: "invalid model output" };
  }
  if (
    !exactOutput(parsed) ||
    !validText(parsed.text, body.cue.requiredTerms)
  ) {
    return { ok: false, status: 502, reason: "invalid model output" };
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      text: parsed.text,
      roles: [...parsed.roles],
    },
  };
}
