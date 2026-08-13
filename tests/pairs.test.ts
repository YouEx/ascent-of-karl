import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { Narrator, freshNarratorState } from "../src/narrator/narrator";
import { loadContent } from "../src/content";
import { loadPairs, pairLineId } from "../src/narrator/pairs";
import { judgePair } from "../src/core/verdict";
import type { ComboDef } from "../src/core/types";
import baked from "../content/narrator/pairs-act-1.json";
import round3 from "../content/narrator/drafts/pairs-runde3-a.json";
import jobs from "../content/narrator/drafts/briefs/_jobs.json";

const pairs = baked as { act: number; pairs: string[]; lines: { id: string; variants: string[] }[] };
const round3Pairs = round3 as {
  pairs: { key: string; verdict: string; variants: string[] }[];
};

function lockedIsReachable(combos: ComboDef[]): boolean {
  if (combos.length === 0) return false;
  const flags = [
    ...new Set(
      combos.flatMap((combo) => [
        ...(combo.requiresFlags ?? []),
        ...(combo.blockedByFlags ?? []),
      ]),
    ),
  ];
  for (let mask = 0; mask < 2 ** flags.length; mask++) {
    const active = new Set(
      flags.filter((_, index) => Math.floor(mask / 2 ** index) % 2 === 1),
    );
    const anyAvailable = combos.some(
      (combo) =>
        (combo.requiresFlags ?? []).every((flag) => active.has(flag)) &&
        (combo.blockedByFlags ?? []).every((flag) => !active.has(flag)),
    );
    if (!anyAvailable) return true;
  }
  return false;
}

function bakedLookupReachable(verdict: string, combos: ComboDef[]): boolean {
  if (verdict === "locked") return lockedIsReachable(combos);
  return combos.length === 0;
}

describe("Bagte par-replikker: formen", () => {
  it("hvert opslag peger på en replik der findes", () => {
    const ids = new Set(pairs.lines.map((l) => l.id));
    const dangling = pairs.pairs.filter((key) => !ids.has(pairLineId(key)));
    expect(dangling).toEqual([]);
  });

  it("ingen replik ligger uden et opslag der kan nå den", () => {
    const used = new Set(pairs.pairs.map(pairLineId));
    expect(pairs.lines.filter((l) => !used.has(l.id)).map((l) => l.id)).toEqual([]);
  });

  it("nøglen er sorteret som pairKey, så rækkefølgen er ligegyldig", () => {
    const wrong = pairs.pairs.filter((k) => {
      const [pair] = k.split(":");
      const [a, b] = pair!.split("+");
      return [a, b].sort().join("+") !== pair;
    });
    expect(wrong).toEqual([]);
  });

  it("dommen i nøglen er den motoren faktisk fælder for parret", () => {
    // Bages der på en dom parret aldrig får, er replikken skrevet forgæves.
    // Målingen viser at samme par kan få flere domme i forskellige
    // spiltilstande, så det er nok at dommen optræder i frisk spil ELLER i
    // hyppighedsmålingen — men den skal optræde et sted.
    const engine = new Engine(loadContent());
    const byKey = new Map(
      (jobs as { jobs: { key: string; a: string; b: string; verdict: string }[] }).jobs.map((j) => [j.key, j]),
    );
    const impossible: string[] = [];
    for (const key of pairs.pairs) {
      const [pair, verdict] = key.split(":");
      const job = byKey.get(pair!);
      if (!job) continue;
      const fresh = judgePair(engine, engine.element(job.a), engine.element(job.b)).verdict;
      if (fresh !== verdict && job.verdict !== verdict) impossible.push(key);
    }
    expect(impossible.slice(0, 5)).toEqual([]);
  });

  it("ingen bagt fiaskereplik er blevet gjort unreachable af en opskrift", () => {
    const content = loadContent();
    const recipes = new Map<string, ComboDef[]>();
    for (const combo of content.combos) {
      const key = [...combo.pair].sort().join("+");
      recipes.set(key, [...(recipes.get(key) ?? []), combo]);
    }
    const stale = pairs.pairs.filter((lookup) => {
      const [pair, verdict] = lookup.split(":");
      return !bakedLookupReachable(verdict!, recipes.get(pair!) ?? []);
    });

    expect(stale).toEqual([]);
  });

  it("matcher motorens reachability for conditional-only og blandede opskrifter", () => {
    const conditional = {
      pair: ["a", "b"],
      result: "c",
      requiresFlags: ["open"],
    } as ComboDef;
    const unconditional = { pair: ["a", "b"], result: "d" } as ComboDef;

    expect(bakedLookupReachable("plausible", [conditional])).toBe(false);
    expect(bakedLookupReachable("locked", [conditional])).toBe(true);
    expect(bakedLookupReachable("locked", [conditional, unconditional])).toBe(false);
  });

  it("runde 3 binder alle near-miss på det aktuelle bevis, ikke en fast højre halvdel", () => {
    const risky = round3Pairs.pairs
      .filter((entry) => entry.verdict === "near-miss")
      .flatMap((entry) =>
        entry.variants
          .filter((variant) => !variant.includes("{right}") || !variant.includes("{partner}"))
          .map((variant) => `${entry.key}: ${variant}`),
      );

    expect(risky).toEqual([]);
  });
});

describe("Bagte par-replikker: motoren", () => {
  it("slår igennem foran grammatikken når parret er bagt", async () => {
    const data = await loadPairs(1);
    if (!data || data.pairs.length === 0) return; // endnu ikke bagt
    const key = data.pairs[0]!;
    const [pair, verdict] = key.split(":");
    const [a, b] = pair!.split("+");

    const engine = new Engine(loadContent());
    const narrator = new Narrator(engine, freshNarratorState(1));
    narrator.attachPairs(data);
    const outcome = engine.combine(a!, b!);
    if (outcome.kind !== "nofuse" || outcome.verdict !== verdict) return;
    const spoken = narrator.react(a!, b!, outcome, 4000);
    expect(spoken?.id).toBe(pairLineId(key));
  });

  it("uden de bagte replikker svarer grammatikken stadig — aldrig tavshed", async () => {
    const engine = new Engine(loadContent());
    const narrator = new Narrator(engine, freshNarratorState(7));
    // Ingen attachPairs: det er tilstanden mens filen hentes.
    const outcome = engine.combine("graes", "pind");
    if (outcome.kind !== "nofuse") return;
    expect(narrator.react("graes", "pind", outcome, 4000)?.text).toBeTruthy();
  });

  it("attachPairs rører ikke det delte indhold — to spil siver ikke ind i hinanden", async () => {
    const data = await loadPairs(1);
    if (!data) return;
    const content = loadContent();
    const engine = new Engine(content);
    const narrator = new Narrator(engine, freshNarratorState(3));
    const before = content.narrator.find((n) => n.act === 1)!.lines.length;
    narrator.attachPairs(data);
    narrator.attachPairs(data);
    // Puljen er urørt: replikkerne ligger hos fortælleren, ikke i indholdet.
    expect(content.narrator.find((n) => n.act === 1)!.lines.length).toBe(before);
    for (const line of data.lines) {
      expect(narrator.line(line.id).id).toBe(line.id);
    }
  });

  it("hjul+spyd følger rightOne og partner i begge inputretninger", () => {
    const seenVariants = new Map<string, Set<number>>([
      ["hjul+spyd", new Set()],
      ["spyd+hjul", new Set()],
    ]);

    for (const [a, b] of [["hjul", "spyd"], ["spyd", "hjul"]] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const engine = new Engine(loadContent());
        const state = engine.getState();
        engine.loadState({
          ...state,
          discovered: [...new Set([...state.discovered, "hjul", "spyd", "planker", "sten"])],
        });
        const narrator = new Narrator(engine, freshNarratorState(seed));
        narrator.attachPairs(pairs);
        const outcome = engine.combine(a, b);
        expect(outcome.kind).toBe("nofuse");
        if (outcome.kind !== "nofuse") continue;
        expect(outcome.verdict).toBe("near-miss");
        const spoken = narrator.react(a, b, outcome, 4000)!;
        seenVariants.get(`${a}+${b}`)!.add(spoken.variant);

        const right = engine.element(outcome.evidence.rightOne!).name.toLowerCase();
        const partner = engine.element(outcome.evidence.partner!).name.toLowerCase();
        expect(spoken.text, `${a}+${b}, seed ${seed}`).toContain(right);
        expect(spoken.text, `${a}+${b}, seed ${seed}`).toContain(partner);
      }
    }

    expect([...seenVariants.values()].map((seen) => [...seen].sort())).toEqual([[0, 1], [0, 1]]);
  });
});
