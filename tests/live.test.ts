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
