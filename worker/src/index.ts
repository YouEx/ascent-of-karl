/**
 * Fortællerens stemme, når den skal skrives på stedet.
 *
 * Spillet ligger på GitHub Pages og har ingen server. Denne worker er den
 * eneste grund til at have en: den holder API-nøglen, så den aldrig kommer
 * i nærheden af browseren, og den holder prompten, så replikken lyder som
 * fortælleren og ikke som en assistent.
 *
 * Udrulning:
 *   cd worker && npx wrangler deploy
 *   npx wrangler secret put OPENAI_API_KEY
 * Derefter sættes VITE_NARRATOR_URL til workerens adresse ved build.
 *
 * Uden denne worker kører spillet præcis som før. Den er en forbedring af
 * halen, ikke en afhængighed.
 */

interface Env {
  OPENAI_API_KEY: string;
  /** Kommasepareret liste. Tom = alle. */
  ALLOWED_ORIGINS?: string;
  MODEL?: string;
}

interface Ting {
  name: string;
  kind?: string;
  stuff?: string;
  scale?: string;
  traits?: string[];
  flavor?: string;
  karlMood?: string;
}

interface Body {
  a: Ting;
  b: Ting;
  verdict: string;
  need?: string;
  summer?: number;
}

/** Hvad hver dom betyder. Ordret de samme definitioner som skribenterne fik. */
const DOMME: Record<string, string> = {
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

const SYSTEM = `You are the narrator of "The Ascent of Karl", a stone-age game about a man inventing everything from scratch, badly.

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

function korsHoveder(origin: string | null, env: Env): Record<string, string> {
  const tilladt = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ok = tilladt.length === 0 || (origin !== null && tilladt.includes(origin));
  return {
    "access-control-allow-origin": ok && origin ? origin : (tilladt[0] ?? "*"),
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
  };
}

function beskriv(t: Ting): string {
  const dele = [t.kind, t.stuff, t.scale].filter(Boolean).join(", ");
  const traits = t.traits?.length ? ` — ${t.traits.join(", ")}` : "";
  const flavor = t.flavor ? `\n  Its entry reads: "${t.flavor}"` : "";
  const mood = t.karlMood ? `\n  Karl feels about it: ${t.karlMood}` : "";
  return `${t.name} (${dele}${traits})${flavor}${mood}`;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("origin");
    const kors = korsHoveder(origin, env);

    if (req.method === "OPTIONS") return new Response(null, { headers: kors });
    if (req.method !== "POST") {
      return new Response("POST only", { status: 405, headers: kors });
    }

    let body: Body;
    try {
      body = (await req.json()) as Body;
    } catch {
      return new Response("bad json", { status: 400, headers: kors });
    }
    if (!body?.a?.name || !body?.b?.name || !body?.verdict) {
      return new Response("missing fields", { status: 400, headers: kors });
    }

    const dom = DOMME[body.verdict] ?? DOMME.inert!;
    const bruger = [
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

    const svar = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.MODEL ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: bruger },
        ],
        // Højt nok til at to ens domme ikke lyder ens, lavt nok til at stemmen
        // holder.
        temperature: 0.95,
        max_tokens: 120,
      }),
    });

    if (!svar.ok) {
      return new Response("upstream", { status: 502, headers: kors });
    }

    const data = (await svar.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return new Response("empty", { status: 502, headers: kors });

    return new Response(JSON.stringify({ text }), {
      headers: {
        ...kors,
        "content-type": "application/json",
        // Samme par giver samme svar i et døgn ved kanten — billigere, og to
        // spillere der møder samme blindgyde deler kun replik en dag ad gangen.
        "cache-control": "public, max-age=86400",
      },
    });
  },
};
