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
import { passesVoiceGate } from "./voice/gate";

export interface ModelEnv {
  OPENAI_API_KEY: string;
  MODEL?: string;
}

/**
 * Modellen, hvis `MODEL`-varen mangler i `wrangler.toml`. Eksporteret (ikke
 * kun en streng-literal inde i `callUpstreamOpenAI`), så
 * `coordinator-do.ts` kan udlede cache-navnerummet (sikkerhedsrunde 3,
 * punkt 3, se `cache-key.ts`s `promptNamespace`) af PRÆCIS den samme
 * effektive model — ét sted, der ikke kan drive fra det andet.
 */
export const DEFAULT_MODEL = "gpt-4o-mini";

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

/**
 * Alle FASTE tekstbidder i brugerprompten (`beskriv`/`buildUserPrompt`
 * nedenfor), navngivet og udtrukket til egne konstanter i stedet for at stå
 * som anonyme literaler inde i funktionerne. Grunden er IKKE stil for
 * stilens skyld: `USER_PROMPT_TEMPLATE_FRAGMENTS` længere nede genbruger
 * PRÆCIS de samme konstanter til at udlede `PROMPT_VERSION_INPUT` (cache-
 * navnerummets grundlag — se `cache-key.ts`s `promptNamespace`), så en
 * ændring i selve skabelonen (ny sætning, ny separator, omformuleret
 * præfiks) automatisk ændrer navnerummet: der findes kun ÉT sted teksten er
 * skrevet, ikke to der kan drive fra hinanden. En hånd-skrevet kopi af
 * disse strenge i fingeraftrykket ville netop genskabe det manuelle
 * "husk at opdatere versionstallet"-løfte, sikkerhedsrunde 3 punkt 3
 * allerede fjernede for SYSTEM+model — se `Fase 2 — sikkerhedsrunde 3,
 * opfølgning` i planen for hele baggrunden.
 */
const TPL_INTRO = "Karl put these two together and nothing came of it.";
const TPL_FIRST_LABEL = "FIRST: ";
const TPL_SECOND_LABEL = "SECOND: ";
const TPL_WHY_FAILED_PREFIX = "WHY IT FAILED (";
const TPL_WHY_FAILED_SUFFIX = "): ";
const TPL_NEED_LABEL = "\nWhat Karl still lacks right now: ";
const TPL_SUMMER_PREFIX = "This is summer ";
const TPL_SUMMER_SUFFIX = " of his life.";
const TPL_LIST_SEP = ", ";
const TPL_TRAITS_SEP = " — ";
const TPL_PARTS_OPEN = " (";
const TPL_PARTS_CLOSE = ")";
const TPL_FLAVOR_PREFIX = '\n  Its entry reads: "';
const TPL_FLAVOR_SUFFIX = '"';
const TPL_MOOD_PREFIX = "\n  Karl feels about it: ";

function beskriv(t: CanonicalThing): string {
  const dele = [t.kind, t.stuff, t.scale].filter(Boolean).join(TPL_LIST_SEP);
  const traits = t.traits.length ? `${TPL_TRAITS_SEP}${t.traits.join(TPL_LIST_SEP)}` : "";
  const flavor = t.flavor ? `${TPL_FLAVOR_PREFIX}${t.flavor}${TPL_FLAVOR_SUFFIX}` : "";
  const mood = t.karlMood ? `${TPL_MOOD_PREFIX}${t.karlMood}` : "";
  return `${t.name}${TPL_PARTS_OPEN}${dele}${traits}${TPL_PARTS_CLOSE}${flavor}${mood}`;
}

function buildUserPrompt(body: CanonicalBody): string {
  const dom = DOMME[body.verdict] ?? DOMME.inert!;
  return [
    TPL_INTRO,
    ``,
    `${TPL_FIRST_LABEL}${beskriv(body.a)}`,
    `${TPL_SECOND_LABEL}${beskriv(body.b)}`,
    ``,
    `${TPL_WHY_FAILED_PREFIX}${body.verdict}${TPL_WHY_FAILED_SUFFIX}${dom}`,
    body.need ? `${TPL_NEED_LABEL}${body.need}` : ``,
    body.summer ? `${TPL_SUMMER_PREFIX}${body.summer}${TPL_SUMMER_SUFFIX}` : ``,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * PRÆCIS de samme skabelon-bidder som `beskriv`/`buildUserPrompt` ovenfor
 * bruger til at RENDERE brugerprompten, samlet i én fast, dokumenteret
 * rækkefølge — kun til fingeraftryk (`buildPromptVersionInput` nedenfor),
 * ALDRIG til selve renderingen. Fordi det er de SAMME konstanter (ikke en
 * hånd-skrevet kopi af deres tekst), kan denne liste ikke "glemme" en
 * ændring: rør man en `TPL_*`-konstant for at ændre teksten, rører man
 * automatisk også fingeraftrykket.
 *
 * Bevidst IKKE en gengivet `buildUserPrompt(body)` for én "repræsentativ"
 * opdigtet krop — det ville kun fange de grene (need/summer/traits/
 * flavor/karlMood) den ene krop tilfældigvis rammer, og kunne stiltiende
 * glemme en fremtidig ny valgfri gren, som TypeScript ikke tvinger noget
 * kald-sted til at udfylde (se planens "opfølgning"-afsnit for baggrunden).
 */
export const USER_PROMPT_TEMPLATE_FRAGMENTS: readonly string[] = [
  TPL_INTRO,
  TPL_FIRST_LABEL,
  TPL_SECOND_LABEL,
  TPL_WHY_FAILED_PREFIX,
  TPL_WHY_FAILED_SUFFIX,
  TPL_NEED_LABEL,
  TPL_SUMMER_PREFIX,
  TPL_SUMMER_SUFFIX,
  TPL_LIST_SEP,
  TPL_TRAITS_SEP,
  TPL_PARTS_OPEN,
  TPL_PARTS_CLOSE,
  TPL_FLAVOR_PREFIX,
  TPL_FLAVOR_SUFFIX,
  TPL_MOOD_PREFIX,
];

/**
 * Bygger den fulde, deterministiske prompt-kontrakt-streng: system-prompten,
 * ALLE dom-forklaringer, og brugerprompt-skabelonens faste bidder — de tre
 * ting der reelt bestemmer den genererede tekst. Ren funktion (intet
 * modul-state), så den kan testes med opdigtede input UDEN at røre de
 * rigtige `SYSTEM`/`DOMME`/`USER_PROMPT_TEMPLATE_FRAGMENTS`-konstanter.
 *
 * `domme`s nøgler slås op i STABIL (sorteret) rækkefølge, så selve
 * INDSÆTNINGSORDENEN i objektet er ligegyldig — kun nøgle+værdi-INDHOLDET
 * tæller. `\u0001` adskiller par internt og adskiller også selve
 * skabelon-bidderne — ét niveau UNDER det `\u0000`, der i `promptNamespace`
 * (se `cache-key.ts`) adskiller modellen fra selve prompt-kontrakten.
 */
export function buildPromptVersionInput(
  systemPrompt: string,
  domme: Readonly<Record<string, string>>,
  templateFragments: readonly string[],
): string {
  const dommeStabil = Object.keys(domme)
    .sort()
    .map((key) => `${key}=${domme[key]!}`)
    .join("\u0001");
  const skabelonStabil = templateFragments.join("\u0001");
  return [systemPrompt, dommeStabil, skabelonStabil].join("\u0000");
}

/**
 * DEN fulde prompt-kontrakt, der reelt bestemmer den genererede tekst:
 * system-prompten, ALLE dom-forklaringer (`DOMME`), og selve brugerprompt-
 * skabelonens faste bidder (`USER_PROMPT_TEMPLATE_FRAGMENTS`). Brugt af
 * `coordinator-do.ts` som `promptNamespace`s første argument — IKKE bare
 * `SYSTEM` alene — så en ændring i ENTEN system-prompten, ÉN dom-forklaring,
 * ELLER selve skabelonen ændrer cache-navnerummet automatisk. Se
 * `docs/deployment/live-narrator.md` afsnit 4b for den fulde dækning, og
 * planens "opfølgning"-afsnit for hvorfor den ikke dækkede DOMME/skabelonen
 * før nu.
 */
export const PROMPT_VERSION_INPUT = buildPromptVersionInput(SYSTEM, DOMME, USER_PROMPT_TEMPLATE_FRAGMENTS);

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
        model: env.MODEL ?? DEFAULT_MODEL,
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

  // TASK-007: samme stemmepolitik som grammatikkens/de bagte pars statiske
  // indhold allerede dømmes af (`tools/voice/judge.py`s `gate()`), nu også
  // håndhævet på LIVE modeltekst FØR den må caches/vises — klientens egen
  // navn-/længde-rensning (cleanModelText ovenfor) er nødvendig, men ikke
  // tilstrækkelig (se planen). `source` er bevidst altid "grammar" — se
  // `voice/scorer.ts`s `Source`-type. Reason er en KORT, generisk tag
  // ("voice"), ALDRIG den afviste tekst eller dens specifikke
  // hård-afvisnings-kategori: `coordinator-do.ts`s `responseFor()`
  // videresender `reason` ordret til klienten.
  if (!passesVoiceGate(text)) return { ok: false, status: 502, reason: "voice" };

  return { ok: true, text };
}
