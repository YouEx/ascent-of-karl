/**
 * Prompten og selve kaldet til modellen. Ordret de samme tekster som den
 * oprindelige `worker/src/index.ts` havde — kun flyttet, ikke ændret, så
 * stemmen ikke driver ved et uheld under denne omlægning.
 *
 * Denne fil rører netværket og er derfor IKKE en af de rene moduler, men
 * den kender stadig intet til Cloudflare — kun `fetch`, som findes lige så
 * vel i Node, og kan derfor mockes i tests uden en Cloudflare-testpool.
 */

import type { UpstreamResult } from "./coordinator";
import type { CanonicalBody, CanonicalThing } from "./catalog";
import { cleanModelText } from "./clean";

export interface ModelEnv {
  OPENAI_API_KEY: string;
  MODEL?: string;
}

/** Hvad hver dom betyder. Ordret de samme definitioner som skribenterne fik. */
export const DOMME: Record<string, string> = {
  plausible:
    "It really should have worked. The narrator half-apologises on Karl's behalf.",
  "near-miss":
    "One of the two genuinely belongs in a real recipe — with something else. So near.",
  clash:
    "The two are opposed in some physical way — wet against dry, heavy against light. One simply beats the other.",
  absurd:
    "There was never the faintest chance. The narrator enjoys this more than he should.",
  self: "Karl combined a thing with itself. He now has the same thing, or a slightly larger puddle of it.",
  inert: "Nothing about either thing invites anything. Two objects, sitting there.",
  locked:
    "The idea is sound but Karl is not ready for it — he lacks something first.",
};

export const SYSTEM = `You are the narrator of "The Ascent of Karl", a stone-age game about a man inventing everything from scratch, badly.

VOICE: dry, literary, affectionate contempt. You have watched Karl fail for a very long time and you have made peace with it. You are never cruel, never zany, never a stand-up comedian. Think a patient documentary narrator who has given up on his subject but not on the story. Understatement over jokes. The funniest line is usually the flattest one.

YOUR TASK: the player combined two things and nothing was created. Write ONE sentence — two at most — about this exact failure.

HARD RULES:
- Write in English.
- Name BOTH things, in plain lowercase mid-sentence ("the dry grass", "the stone axe"). No placeholders, no brackets.
- The line must be impossible to reuse for any other pair. If it would work about two different things, it is wrong. Use what these two things actually are, what they are made of, and what Karl clearly hoped would happen.
- Never invent a new element, item or discovery. Nothing was created. Do not hint that something was.
- Never address the player as "you". Karl is the subject.
- No quotation marks around your answer. No preamble. No title. One line of prose.
- Under 300 characters.

Answer with the line and nothing else.`;

function beskriv(t: CanonicalThing): string {
  const dele = [t.kind, t.stuff, t.scale].filter(Boolean).join(", ");
  const traits = t.traits.length ? ` — ${t.traits.join(", ")}` : "";
  const flavor = t.flavor ? `\n  Its entry reads: "${t.flavor}"` : "";
  const mood = t.karlMood ? `\n  Karl feels about it: ${t.karlMood}` : "";
  return `${t.name} (${dele}${traits})${flavor}${mood}`;
}

function buildUserPrompt(body: CanonicalBody): string {
  const dom = DOMME[body.verdict] ?? DOMME.inert!;
  return [
    `Karl put these two together and nothing came of it.`,
    ``,
    `FIRST: ${beskriv(body.a)}`,
    `SECOND: ${beskriv(body.b)}`,
    ``,
    `WHY IT FAILED (${body.verdict}): ${dom}`,
    body.need ? `\nWhat Karl still lacks right now: ${body.need}` : ``,
    body.summer ? `This is summer ${body.summer} of his life.` : ``,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Kalder OpenAI og renser svaret. Returnerer et diskrimineret resultat i
 * stedet for at kaste — koordinatoren skal ALDRIG have brug for et bredt
 * catch omkring dette kald, kun for at aflæse `ok`.
 */
export async function callUpstreamOpenAI(
  body: CanonicalBody,
  env: ModelEnv,
): Promise<UpstreamResult> {
  let svar: Response;
  try {
    svar = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: buildUserPrompt(body) },
        ],
        // Højt nok til at to ens domme ikke lyder ens, lavt nok til at
        // stemmen holder.
        temperature: 0.95,
        max_tokens: 120,
      }),
    });
  } catch {
    // Netværket selv fejlede (DNS, afbrudt forbindelse) — ikke en fejl i
    // modellens svar, men samme håndtering: intet at cache, en tælle-værdig
    // fiasko.
    return { ok: false, status: 502, reason: "network" };
  }

  if (!svar.ok) {
    return { ok: false, status: 502, reason: "upstream" };
  }

  let data: { choices?: { message?: { content?: string } }[] };
  try {
    data = (await svar.json()) as typeof data;
  } catch {
    return { ok: false, status: 502, reason: "bad json" };
  }

  const raw = data.choices?.[0]?.message?.content;
  const text = cleanModelText(raw, body.a.name, body.b.name);
  if (!text) return { ok: false, status: 502, reason: "empty or rejected" };
  return { ok: true, text };
}
