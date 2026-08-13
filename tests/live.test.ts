import { beforeEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../src/core/engine";
import { Narrator, freshNarratorState } from "../src/narrator/narrator";
import { LiveNarrator } from "../src/narrator/live";
import { loadContent } from "../src/content";

const content = loadContent();

/**
 * Node har ingen localStorage. Klassen overlever fint uden (alle opslag er
 * pakket ind), men testene skal kunne rydde mellem sig, så cachen fra én test
 * ikke besvarer den næste.
 */
function stubStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  });
}

/**
 * Et par der med sikkerhed fejler i akt 1, og som ingen har skrevet en bagt
 * replik til. Bruges til at bevise at det skrevne lag får ordet præcis der,
 * hvor grammatikken ellers ville have taget over.
 */
const A = "baer";
const B = "ler";


/** En LiveNarrator med et opdigtet endpoint og fetch under kontrol. */
function nyLive(svar: string | undefined, status = 200): LiveNarrator {
  const fetchMock = vi.fn(async () =>
    status === 200
      ? new Response(JSON.stringify({ text: svar }), { status: 200 })
      : new Response("nej", { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return new LiveNarrator("https://example.invalid/line");
}

/** Samme, men svaret bærer en Retry-After-header — til 429/503-testene. */
function nyLiveMedRetryAfter(
  status: number,
  retryAfterSeconds: number,
): { live: LiveNarrator; fetchMock: ReturnType<typeof vi.fn> } {
  const fetchMock = vi.fn(
    async () =>
      new Response("nej", {
        status,
        headers: { "retry-after": String(retryAfterSeconds) },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { live: new LiveNarrator("https://example.invalid/line"), fetchMock };
}

describe("live-fortælleren", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubStorage();
  });

  it("er slået fra uden endpoint, så spillet kører uændret", () => {
    expect(new LiveNarrator("").enabled).toBe(false);
  });

  it("venter aldrig: get() er tom før svaret er landet", async () => {
    const live = nyLive("The clay sat there while the berries did nothing at all.");
    // Ingen await: det er præcis den tilstand fortælleren spørger i.
    void live.prefetch({
      a: content.elements.find((e) => e.id === A)!,
      b: content.elements.find((e) => e.id === B)!,
      verdict: "inert",
    });
    expect(live.get(A, B, "inert")).toBeUndefined();
  });

  it("leverer replikken når den er landet, uanset rækkefølge på parret", async () => {
    const live = nyLive("The clay sat there while the berries did nothing at all.");
    await live.prefetch({
      a: content.elements.find((e) => e.id === A)!,
      b: content.elements.find((e) => e.id === B)!,
      verdict: "inert",
    });
    expect(live.get(A, B, "inert")).toContain("clay");
    // Samme opslag den anden vej rundt — nøglen er sorteret.
    expect(live.get(B, A, "inert")).toBe(live.get(A, B, "inert"));
  });

  it("spørger kun én gang om samme par", async () => {
    const live = nyLive("The clay sat there while the berries did nothing at all.");
    const req = {
      a: content.elements.find((e) => e.id === A)!,
      b: content.elements.find((e) => e.id === B)!,
      verdict: "inert",
    };
    await live.prefetch(req);
    await live.prefetch(req);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("sender KUN kanoniske id'er over nettet — aldrig navn/kind/stuff/traits/flavor (sikkerhedsrunde 2, punkt 3)", async () => {
    const live = nyLive("The clay sat there while the berries did nothing at all.");
    await live.prefetch({
      a: content.elements.find((e) => e.id === A)!,
      b: content.elements.find((e) => e.id === B)!,
      verdict: "inert",
      needId: "varme",
      summer: 4,
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const sendt = JSON.parse(init!.body as string) as Record<string, unknown>;
    // Workeren slår selv navn/kind/stuff/traits/flavor op i sit eget indhold
    // (catalog.ts) — klienten må aldrig sende den slags, for det var netop
    // vejen ind for en forfalsket beskrivelse (prompt-injektion) og for
    // uendeligt mange unikke cache-nøgler fra opdigtede tekster.
    expect(sendt).toEqual({ aId: A, bId: B, verdict: "inert", needId: "varme", summer: 4 });
  });

  it("afviser en replik der ikke nævner begge ting", async () => {
    const live = nyLive("Nothing happened, as is so often the case.");
    await live.prefetch({
      a: content.elements.find((e) => e.id === A)!,
      b: content.elements.find((e) => e.id === B)!,
      verdict: "inert",
    });
    expect(live.get(A, B, "inert")).toBeUndefined();
  });

  it("afviser en replik med efterladte pladsholdere", async () => {
    const live = nyLive("The berries met the clay and {right} was never the answer.");
    await live.prefetch({
      a: content.elements.find((e) => e.id === A)!,
      b: content.elements.find((e) => e.id === B)!,
      verdict: "inert",
    });
    expect(live.get(A, B, "inert")).toBeUndefined();
  });

  it("giver op efter tre fejl, så et dødt endpoint ikke koster en tur pr. forsøg", async () => {
    const live = nyLive(undefined, 500);
    const req = (v: string) => ({
      a: content.elements.find((e) => e.id === A)!,
      b: content.elements.find((e) => e.id === B)!,
      verdict: v,
    });
    // 500 giver undefined uden at kaste — tælleren skal alligevel løbe.
    for (const v of ["inert", "clash", "absurd"]) await live.prefetch(req(v));
    expect(live.enabled).toBe(false);
  });

  it("429 er tavshed: intet svar, ingen tælling til afbryderen, og intet nyt forsøg før Retry-After er gået", async () => {
    vi.useFakeTimers();
    try {
      const { live, fetchMock } = nyLiveMedRetryAfter(429, 30);
      const req = () => ({
        a: content.elements.find((e) => e.id === A)!,
        b: content.elements.find((e) => e.id === B)!,
        verdict: "inert",
      });

      // Gentag cyklussen fire gange — flere end de tre fejl der ellers ville
      // slå den PERMANENTE afbryder til. Var 429 fejlagtigt talt med som en
      // almindelig fejl, ville laget være dødt efter den tredje, og et
      // forsøg efter det fjerde ro-vindue ville aldrig nå netværket igen.
      for (let i = 0; i < 4; i++) {
        const result = await live.prefetch(req());
        expect(result).toBeUndefined();
        // Endnu et forsøg STRAKS bagefter er stadig i ro-perioden og må ikke
        // ramme netværket.
        const again = await live.prefetch(req());
        expect(again).toBeUndefined();
        vi.advanceTimersByTime(31_000);
      }

      // Fire cyklusser, fire (og kun fire) rigtige netværkskald.
      expect(fetchMock).toHaveBeenCalledTimes(4);
      // Ro-perioden er forbi, og laget er stadig villigt til at spørge —
      // beviset på at 429 aldrig rørte den permanente afbryder.
      expect(live.enabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("503 (dagligt loft) er også tavshed: intet svar, ingen tælling, ro indtil nulstillingen — og fortæller normalt igen bagefter", async () => {
    vi.useFakeTimers();
    try {
      // Første kald rammer det daglige loft; andet (efter nulstillingen) er
      // en helt almindelig, vellykket samtale — præcis som et rigtigt døgnskifte.
      let calls = 0;
      const fetchMock = vi.fn(async () => {
        calls++;
        if (calls === 1) {
          return new Response("nej", { status: 503, headers: { "retry-after": "3600" } });
        }
        return new Response(
          JSON.stringify({ text: "The clay sat there while the berries did nothing at all." }),
          { status: 200 },
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const live = new LiveNarrator("https://example.invalid/line");
      const req = () => ({
        a: content.elements.find((e) => e.id === A)!,
        b: content.elements.find((e) => e.id === B)!,
        verdict: "inert",
      });

      const result = await live.prefetch(req());
      expect(result).toBeUndefined();

      // Intet nyt forsøg før nulstillingen (den UTC-tid workeren opgav) er nået.
      const again = await live.prefetch(req());
      expect(again).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(3601 * 1000);
      const efterNulstilling = await live.prefetch(req());
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // Beviset på at 503 aldrig rørte den permanente afbryder: laget taler
      // helt normalt igen, så snart nulstillingen er passeret.
      expect(efterNulstilling).toContain("clay");
      expect(live.enabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("live-laget i fortællerens kæde", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stubStorage();
  });

  it("bruger den skrevne replik når den findes, og grammatikken når den ikke gør", async () => {
    const engine = new Engine(content);
    const outcome = engine.combine(A, B);
    if (outcome.kind !== "nofuse") throw new Error("parret skal fejle");
    const verdict = outcome.verdict;

    // Uden live-laget: grammatikken taler.
    const uden = new Narrator(new Engine(content), freshNarratorState(1));
    const e2 = new Engine(content);
    const o2 = e2.combine(A, B);
    const gram = uden.react(A, B, o2);

    // Med live-laget og en landet replik: den skrevne vinder.
    const tekst =
      "The clay took the berries in without comment and gave nothing back, which is clay all over.";
    const live = nyLive(tekst);
    await live.prefetch({
      a: engine.element(A),
      b: engine.element(B),
      verdict,
    });
    const e3 = new Engine(content);
    const med = new Narrator(e3, freshNarratorState(1));
    med.attachLive(live);
    const o3 = e3.combine(A, B);
    const spoken = med.react(A, B, o3);

    expect(spoken?.text).toBe(tekst);
    expect(spoken?.text).not.toBe(gram?.text);
    expect(spoken?.id.startsWith("live:")).toBe(true);
  });
});
