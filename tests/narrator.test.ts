import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { freshChallengeState } from "../src/core/challenge";
import { Narrator, freshNarratorState } from "../src/narrator/narrator";
import { loadContent } from "../src/content";

const content = loadContent();

/**
 * Fylder op med opfundne elementer, så Karl er over skæbne-grænsen.
 * Skæbner er gated på antal opfindelser (se Engine.endingsUnlocked); tests der
 * vil ramme en slutning skal derfor have et liv bag sig først.
 */
function withInventions(discovered: string[]): string[] {
  const endingResults = new Set(
    content.combos.filter((c) => c.ending).map((c) => c.result),
  );
  const padding = content.elements
    .filter(
      (e) =>
        !e.base && !discovered.includes(e.id) && !endingResults.has(e.id),
    )
    .map((e) => e.id)
    .slice(0, content.config.endingsUnlockAt);
  return [...discovered, ...padding];
}


function setup() {
  const engine = new Engine(content);
  const narrator = new Narrator(engine);
  return { engine, narrator };
}

/** Kør et forsøg og lad fortælleren reagere. */
function attempt(
  engine: Engine,
  narrator: Narrator,
  a: string,
  b: string,
  elapsedMs?: number,
) {
  const outcome = engine.combine(a, b);
  return narrator.react(a, b, outcome, elapsedMs);
}

describe("Narrator: prioritering", () => {
  it("story-beats vinder over alt andet", () => {
    const { engine, narrator } = setup();
    const line = attempt(engine, narrator, "sten", "sten");
    expect(line?.id).toBe("story-gnister");
  });

  it("gate-replikken afspilles ved nægtet age-up", () => {
    const { engine, narrator } = setup();
    engine.combine("sten", "sten");
    engine.combine("gnister", "graes");
    engine.combine("sten", "pind");
    engine.combine("stenoekse", "sten");
    engine.combine("malm", "ild");
    const line = attempt(engine, narrator, "kobber", "malm");
    expect(line?.id).toBe("gate-act-1");
  });

  it("age-up-replikken afspilles ved epokeskift", () => {
    const { engine, narrator } = setup();
    for (const [a, b] of [
      ["sten", "sten"], ["gnister", "graes"], ["sten", "pind"],
      ["stenoekse", "pind"], ["spyd", "dyr"], ["ild", "koed"],
      ["stenoekse", "sten"], ["malm", "ild"],
    ] as const) {
      engine.combine(a, b);
    }
    const line = attempt(engine, narrator, "kobber", "malm");
    expect(line?.id).toBe("ageup-act-1");
  });
});

describe("Narrator: adfærd", () => {
  it("sten-spam eskalerer ved 3/5/8", () => {
    const { engine, narrator } = setup();
    const seen: string[] = [];
    // sten+baer er en fiasko der tæller som sten-brug
    for (let i = 0; i < 8; i++) {
      const line = attempt(engine, narrator, "sten", "baer");
      if (line) seen.push(line.id);
    }
    expect(seen).toContain("spam-3");
    expect(seen).toContain("spam-5");
    expect(seen).toContain("spam-8");
  });

  it("gentagne identiske kombinationer bemærkes", () => {
    const { engine, narrator } = setup();
    attempt(engine, narrator, "baer", "ler");
    attempt(engine, narrator, "baer", "ler");
    const third = attempt(engine, narrator, "baer", "ler");
    expect(third?.id).toBe("repeat-3");
  });

  it("ingen replik gentages to gange i træk over en lang fiasko-række", () => {
    const { engine, narrator } = setup();
    const pairs: Array<[string, string]> = [
      ["baer", "ler"], ["baer", "pind"], ["baer", "graes"], ["baer", "larver"],
      ["dyr", "pind"], ["baer", "pind"], ["larver", "vand"], ["larver", "graes"],
      ["larver", "dyr"], ["larver", "pind"], ["vand", "graes"], ["vand", "dyr"],
      ["vand", "pind"], ["graes", "dyr"], ["graes", "pind"], ["graes", "ler"],
    ];
    let last: string | undefined;
    for (const [a, b] of pairs) {
      const line = attempt(engine, narrator, a, b);
      if (line) {
        expect(line.id).not.toBe(last);
        last = line.id;
      }
    }
  });
});

describe("Narrator: hint-eskalering", () => {
  it("eskalerer til stadig tydeligere vink for første uløste problem", () => {
    const { engine, narrator } = setup();
    const seen: string[] = [];
    const pairs: Array<[string, string]> = [
      ["baer", "ler"], ["baer", "pind"], ["baer", "graes"], ["baer", "larver"],
      ["dyr", "ler"], ["baer", "pind"], ["larver", "vand"], ["larver", "graes"],
      ["larver", "dyr"], ["larver", "pind"], ["vand", "graes"], ["vand", "dyr"],
      ["vand", "pind"], ["graes", "dyr"], ["graes", "ler"], ["ler", "pind"],
    ];
    for (const [a, b] of pairs) {
      const line = attempt(engine, narrator, a, b);
      if (line) seen.push(line.id);
    }
    // kulde er første uløste problem — hint 1 og 2 bør være nået
    expect(seen).toContain("hint-kulde-1");
    expect(seen).toContain("hint-kulde-2");
    const i1 = seen.indexOf("hint-kulde-1");
    const i2 = seen.indexOf("hint-kulde-2");
    expect(i1).toBeLessThan(i2);
  });

  it("en opdagelse nulstiller hint-tælleren", () => {
    const { engine, narrator } = setup();
    for (const [a, b] of [
      ["baer", "ler"], ["baer", "pind"], ["baer", "graes"], ["baer", "larver"],
    ] as const) {
      attempt(engine, narrator, a, b);
    }
    attempt(engine, narrator, "sten", "sten"); // opdagelse
    const line = attempt(engine, narrator, "dyr", "pind");
    expect(line?.id).not.toBe("hint-kulde-1");
  });
});

describe("Narrator: flag-hukommelse", () => {
  it("refererer larve-valget senere — og kun én gang", () => {
    const { engine, narrator } = setup();
    attempt(engine, narrator, "sten", "sten");
    attempt(engine, narrator, "gnister", "graes");
    attempt(engine, narrator, "larver", "ild"); // sætter flag "larver"
    const first = attempt(engine, narrator, "baer", "ler");
    expect(first?.id).toBe("mem-larver");
    const second = attempt(engine, narrator, "baer", "pind");
    expect(second?.id).not.toBe("mem-larver");
  });

  it("uden flag afspilles hukommelses-replikken aldrig", () => {
    const { engine, narrator } = setup();
    const line = attempt(engine, narrator, "baer", "ler");
    expect(line?.id).not.toBe("mem-larver");
  });
});

describe("Narrator: varianter og playthrough-seed", () => {
  it("samme seed giver samme variantvalg (deterministisk pr. save)", () => {
    const run = (seed: number) => {
      const engine = new Engine(content);
      const narrator = new Narrator(engine, freshNarratorState(seed));
      return attempt(engine, narrator, "sten", "sten")?.text;
    };
    expect(run(42)).toBe(run(42));
  });

  it("forskellige seeds giver variation i replikkerne", () => {
    const texts = new Set<string>();
    for (let seed = 1; seed <= 10; seed++) {
      const engine = new Engine(content);
      const narrator = new Narrator(engine, freshNarratorState(seed));
      texts.add(attempt(engine, narrator, "sten", "sten")!.text);
    }
    expect(texts.size).toBeGreaterThan(1);
  });

  it("samme replik bruger aldrig samme variant to gange i træk", () => {
    const { engine, narrator } = setup();
    engine.combine("sten", "sten");
    // repeat-3 rammes ved 3, 4, 5... aldrig med samme variant to gange i træk
    const texts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const line = attempt(engine, narrator, "baer", "ler");
      if (line?.id === "repeat-3") texts.push(line.text);
    }
    for (let i = 1; i < texts.length; i++) {
      expect(texts[i]).not.toBe(texts[i - 1]);
    }
  });
});

describe("Narrator: nye adfærds-triggere", () => {
  it("samme element mod alt muligt udløser sweep med elementnavnet indsat", () => {
    const { engine, narrator } = setup();
    attempt(engine, narrator, "baer", "ler");
    attempt(engine, narrator, "baer", "pind");
    attempt(engine, narrator, "baer", "graes");
    const line = attempt(engine, narrator, "baer", "fugl");
    expect(line?.id).toBe("sweep-4");
    expect(line?.text).toContain("berries");
  });

  it("meget hurtige forsøg i træk udløser fast-replikken", () => {
    const { engine, narrator } = setup();
    const pairs: Array<[string, string]> = [
      ["baer", "ler"], ["vand", "graes"], ["larver", "dyr"],
      ["baer", "graes"], ["ler", "pind"], ["dyr", "pind"],
    ];
    let last;
    for (const [a, b] of pairs) last = attempt(engine, narrator, a, b, 500);
    expect(last?.id).toBe("fast-6");
  });

  it("en meget lang pause udløser slow-replikken", () => {
    const { engine, narrator } = setup();
    attempt(engine, narrator, "baer", "ler", 1000);
    const line = attempt(engine, narrator, "baer", "pind", 60_000);
    expect(line?.id).toBe("slow-1");
  });

  it("slow fyrer HØJST ÉN gang pr. run, uanset hvor mange pauser der er", () => {
    // Målt til 2,8 gange pr. run før: sjov én gang, docerende tre.
    const { engine, narrator } = setup();
    const first = attempt(engine, narrator, "baer", "ler", 60_000);
    expect(first?.id).toBe("slow-1");
    for (const [a, b] of [
      ["baer", "pind"], ["ler", "pind"], ["dyr", "pind"], ["fugl", "pind"],
      ["stamme", "pind"], ["graes", "pind"], ["vand", "pind"],
    ] as const) {
      expect(attempt(engine, narrator, a, b, 60_000)?.id).not.toBe("slow-1");
    }
  });

  it("engangs-reglen overlever save/load", () => {
    const { engine, narrator } = setup();
    attempt(engine, narrator, "baer", "ler", 60_000);
    const revived = new Narrator(engine, JSON.parse(JSON.stringify(narrator.getState())));
    expect(attempt(engine, revived, "baer", "pind", 60_000)?.id).not.toBe("slow-1");
  });
});

describe("Narrator: variant-index til lydfiler", () => {
  it("SpokenLine.variant peger på den valgte variant-tekst", () => {
    const { engine, narrator } = setup();
    const line = attempt(engine, narrator, "sten", "sten")!;
    const def = narrator.line(line.id);
    expect(def.variants[line.variant]).toBe(line.text);
  });
});

describe("Narrator: slutninger og aldring", () => {
  const baseState = {
    act: 1,
    flags: [],
    solvedProblems: [],
    attempts: 0,
    ended: null,
    challenges: freshChallengeState(),
    seed: 1,
  };

  it("slutningens replik overtrumfer alt andet", () => {
    const { engine, narrator } = setup();
    engine.loadState({
      ...baseState,
      discovered: withInventions(["mudderkage", "grottebryg"]),
    });
    const line = attempt(engine, narrator, "mudderkage", "grottebryg");
    expect(line?.id).toBe("ending-gourmet");
    expect(line?.text).toContain("THE END");
  });

  it("aldrings-advarsel når 10 somre er tilbage", () => {
    const { engine, narrator } = setup();
    const limit = content.config.turnLimit;
    engine.loadState({ ...baseState, discovered: ["baer", "ler"], attempts: limit - 11 });
    const line = attempt(engine, narrator, "baer", "ler");
    expect(line?.id).toBe("aging-10");
  });
});

describe("Narrator: resume", () => {
  it("giver en velkommen-tilbage-replik", () => {
    const { narrator } = setup();
    const line = narrator.resume();
    expect(line?.id).toBe("resume-1");
    expect(line?.text.length).toBeGreaterThan(0);
  });
});

describe("Narrator: save/load", () => {
  it("tællere og no-repeat-tilstand overlever en rundtur", () => {
    const { engine, narrator } = setup();
    attempt(engine, narrator, "baer", "ler");
    attempt(engine, narrator, "baer", "ler");
    const restored = new Narrator(engine, narrator.getState());
    const outcome = engine.combine("baer", "ler");
    const line = restored.react("baer", "ler", outcome);
    expect(line?.id).toBe("repeat-3");
  });
});

describe("Narrator: en opdagelse møder aldrig tavshed", () => {
  it("kommenterer også kombinationer uden håndskrevet replik", () => {
    const { engine, narrator } = setup();
    // nabo + fugl -> fjer har ingen narratorLine; før faldt den lydløst igennem
    const combo = content.combos.find(
      (c) => c.result === "fjer" && !c.narratorLine,
    );
    expect(combo, "forudsætning: fjer har ingen håndskrevet replik").toBeTruthy();

    const line = attempt(engine, narrator, "nabo", "fugl");
    expect(line, "fortælleren tav ved en opdagelse").toBeTruthy();
    expect(line!.text.length).toBeGreaterThan(10);
  });

  it("bruger ingen pladsholdere — puljen skal kunne indtales", () => {
    // Lyd-pipelinen springer varianter med {} over. Ville opdagelses-puljen
    // bruge {element}, ville fortælleren være tavs i spillets vigtigste
    // øjeblik. Kortet viser navnet; replikken behøver ikke gentage det.
    const act1 = content.narrator.find((n) => n.act === 1)!;
    for (const id of act1.discoveryFallback ?? []) {
      const def = act1.lines.find((l) => l.id === id)!;
      for (const v of def.variants) expect(v).not.toContain("{");
    }
  });

  it("gentager ikke samme opdagelses-replik to gange i træk", () => {
    const { engine, narrator } = setup();
    const ids: string[] = [];
    for (const [a, b] of [
      ["nabo", "fugl"], ["sten", "vand"], ["ler", "vand"], ["pind", "pind"],
    ] as const) {
      const line = attempt(engine, narrator, a, b);
      if (line) ids.push(line.id);
    }
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
  });
});

describe("Narrator: spam-tælleren nulstilles", () => {
  it("nævner ikke stenen når spilleren er gået videre til noget andet", () => {
    const { engine, narrator } = setup();
    // Tre mislykkede forsøg med sten bringer tælleren til spam-tærsklen
    attempt(engine, narrator, "sten", "graes");
    attempt(engine, narrator, "sten", "ler");
    attempt(engine, narrator, "sten", "larver");

    // Herefter noget helt uden sten: replikken må ikke handle om sten
    const line = attempt(engine, narrator, "pind", "graes");
    expect(line?.id).not.toMatch(/^spam-/);
    if (line) expect(line.text.toLowerCase()).not.toContain("stone");
  });

  it("fyrer stadig når stenen faktisk bruges tre gange i træk", () => {
    const { engine, narrator } = setup();
    attempt(engine, narrator, "sten", "graes");
    attempt(engine, narrator, "sten", "ler");
    const line = attempt(engine, narrator, "sten", "larver");
    expect(line?.id).toBe("spam-3");
  });
});

/** Kør et forsøg og hent fortællerens ANDEN takt (træk eller trods). */
function followUp(engine: Engine, narrator: Narrator, a: string, b: string) {
  const outcome = engine.combine(a, b);
  narrator.react(a, b, outcome);
  return narrator.followUp(outcome);
}

describe("Narrator: trækket mod næste skridt", () => {
  it("peger på aktens første uløste obligatoriske problem", () => {
    const { narrator } = setup();
    expect(narrator.currentPull()?.id).toBe("kulde");
  });

  it("åbner spillet med et træk, så historien har en retning fra takt ét", () => {
    const { narrator } = setup();
    expect(narrator.openingPull()?.id).toBe("pull-kulde");
  });

  it("rykker til næste problem når det aktuelle er løst", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    engine.combine("sten", "sten");
    const line = followUp(engine, narrator, "gnister", "graes"); // løser kulde
    expect(engine.isSolved("kulde")).toBe(true);
    expect(line?.id).toBe("pull-vaerktoej");
  });

  it("gentager ikke samme træk på hver opdagelse", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    // Opdagelser der ikke løser kulde: trækket må ikke lyde igen med det samme
    const first = followUp(engine, narrator, "sten", "sten");
    expect(first?.id).not.toBe("pull-kulde");
  });

  it("tier ved age-up og slutninger, hvor historien har sin egen store takt", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    const outcome = engine.combine("sten", "sten");
    const ageUp = { ...outcome, ageUp: true } as typeof outcome;
    expect(narrator.followUp(ageUp)).toBeUndefined();
  });

  it("siger intet efter en fiasko — trækket hører til historiens takter", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    const outcome = engine.combine("sten", "graes"); // blindgyde
    expect(outcome.kind).toBe("nothing");
    expect(narrator.followUp(outcome)).toBeUndefined();
  });
});

describe("Narrator: trods", () => {
  it("bemærker at spilleren opfandt noget andet end det, der blev bedt om", () => {
    const { engine, narrator } = setup();
    narrator.openingPull(); // beder om varme
    const line = followUp(engine, narrator, "sten", "pind"); // laver værktøj i stedet
    expect(line?.id).toBe("defiance-1");
  });

  it("giver det komiske spor sit eget svar — det er dét, man trodser med", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    const line = followUp(engine, narrator, "nabo", "nabo"); // brydekamp, spor: komisk
    expect(line?.id).toBe("defiance-comic");
  });

  it("tæller ikke fiaskoer som trods — at fejle er at prøve", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    for (let i = 0; i < 5; i++) narrator.followUp(engine.combine("sten", "graes"));
    const line = followUp(engine, narrator, "sten", "pind");
    expect(line?.id).toBe("defiance-1");
  });

  it("siger intet hvis han ikke har bedt om noget endnu", () => {
    const { engine, narrator } = setup();
    const line = followUp(engine, narrator, "sten", "pind");
    expect(line?.id).not.toMatch(/^defiance/);
  });

  it("regner det ikke som trods når spilleren adlyder", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    engine.combine("sten", "sten");
    const line = followUp(engine, narrator, "gnister", "graes"); // løser kulde
    expect(line?.id).not.toMatch(/^defiance/);
  });

  it("eskalerer tonen når trodsen fortsætter", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    const seen: string[] = [];
    for (const [a, b] of [
      ["sten", "pind"],
      ["ler", "vand"],
      ["sten", "vand"],
      ["pind", "pind"],
      ["graes", "graes"],
      ["stamme", "vand"],
      ["baer", "vand"],
    ] as const) {
      const line = followUp(engine, narrator, a, b);
      if (line?.id.startsWith("defiance")) seen.push(line.id);
    }
    expect(seen[0]).toBe("defiance-1");
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(seen.length);
    // Stigen skal gås trin for trin. Uden dette ville ["defiance-1",
    // "defiance-4"] også bestå — og det var netop fejlen: et trin, der blev
    // tiet ihjel af afkølingen, var tabt for resten af spillet.
    const tiers = seen
      .filter((id) => id !== "defiance-comic")
      .map((id) => Number(id.replace("defiance-", "")));
    const ladder = Object.keys(
      content.narrator.find((n) => n.act === 1)!.defiance!,
    )
      .map(Number)
      .sort((x, y) => x - y);
    expect(tiers).toEqual(ladder.slice(0, tiers.length));
  });

  it("en trods, der ties ihjel af afkølingen, brænder ikke sit trin", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    expect(followUp(engine, narrator, "sten", "pind")?.id).toBe("defiance-1");
    // Straks efter: stadig trods, men inden for afkølingen — han tier.
    expect(followUp(engine, narrator, "ler", "vand")?.id ?? "").not.toMatch(/^defiance/);
    // Når han taler igen, skal det være NÆSTE trin — ikke et hop forbi det.
    const seen: string[] = [];
    for (const [a, b] of [
      ["sten", "vand"],
      ["mudder", "graes"],
      ["stamme", "pind"],
      ["pind", "pind"],
    ] as const) {
      const line = followUp(engine, narrator, a, b);
      if (line?.id.startsWith("defiance")) seen.push(line.id);
    }
    expect(seen[0]).toBe("defiance-2");
  });

  it("mister ikke et eneste trin, uanset hvor tæt trodsen kommer", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    const seen: string[] = [];
    for (const [a, b] of [
      ["sten", "pind"],
      ["ler", "vand"],
      ["sten", "vand"],
      ["mudder", "graes"],
      ["stamme", "pind"],
      ["pind", "pind"],
      ["stamme", "vand"],
      ["baer", "sten"],
      ["sten", "mudder"],
      ["bautasten", "bautasten"],
      ["hulemaleri", "bautasten"],
    ] as const) {
      const line = followUp(engine, narrator, a, b);
      if (line?.id.startsWith("defiance-") && line.id !== "defiance-comic") seen.push(line.id);
    }
    const ladder = Object.values(
      content.narrator.find((n) => n.act === 1)!.defiance!,
    );
    // Hele stigen skal være hørt. Det var netop det, fejlen kostede: trin 4 —
    // hans sidste, opgivende replik — kunne forsvinde uden at være sagt.
    expect(seen).toEqual(ladder);
  });
});

describe("Narrator: genoptagelse må ikke gentage trækket", () => {
  it("tier ved genindlæsning når trækket ikke har flyttet sig", () => {
    const { engine, narrator } = setup();
    expect(narrator.openingPull()?.id).toBe("pull-kulde");
    for (const [a, b] of [
      ["sten", "graes"],
      ["ler", "ler"],
    ] as const) {
      attempt(engine, narrator, a, b);
    }
    const saved = narrator.getState();

    const resumed = new Narrator(engine);
    resumed.loadState(saved);
    // Spilleren har allerede hørt replikken; chippen i UI'et står markeret.
    expect(resumed.openingPull()).toBeUndefined();
    expect(resumed.getState().lastPullAttempt).toBe(saved.lastPullAttempt);
  });

  it("siger trækket ved genindlæsning hvis historien er rykket imens", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    const saved = { ...narrator.getState(), pulledProblem: null };

    const resumed = new Narrator(engine);
    resumed.loadState(saved);
    expect(resumed.openingPull()?.id).toBe("pull-kulde");
  });

  it("overlever et gemt spil fra før trods-stigen fandtes", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    const legacy = narrator.getState() as Partial<ReturnType<Narrator["getState"]>>;
    delete legacy.spokenDefianceTiers;

    const resumed = new Narrator(engine);
    resumed.loadState(legacy as ReturnType<Narrator["getState"]>);
    expect(resumed.getState().spokenDefianceTiers).toEqual([]);
    expect(followUp(engine, resumed, "sten", "pind")?.id).toBe("defiance-1");
  });
});

describe("Narrator: det komiske spor må ikke tabes til en timer", () => {
  it("kommenterer den komiske omvej selv kort efter en tør bemærkning", () => {
    const { engine, narrator } = setup();
    narrator.openingPull();
    expect(followUp(engine, narrator, "sten", "pind")?.id).toBe("defiance-1");
    // Kun ét forsøg senere: den normale afkøling ville have tiet her
    const comic = followUp(engine, narrator, "nabo", "nabo");
    expect(comic?.id).toBe("defiance-comic");
  });
});

describe("Narrator: hans eget råd", () => {
  /**
   * Hændelsen der udløste mekanikken: fortælleren sendte spilleren efter
   * sten+græs, som ikke er en opskrift — vejen er sten+sten og derefter
   * gnister+græs — og svarede så "Nothing. Brought to you by nothing."
   * Han hånede spilleren for at adlyde ham.
   */
  it("hvert forslag peger på en opskrift der findes", () => {
    const pairs = new Set(content.combos.map((c) => [...c.pair].sort().join("+")));
    const suggested = content.narrator.flatMap((n) =>
      n.lines.flatMap((l) =>
        (l.suggests ?? []).map((p) => ({ line: l.id, key: [...p].sort().join("+") })),
      ),
    );
    expect(suggested.length).toBeGreaterThan(0);
    expect(suggested.filter((s) => !pairs.has(s.key))).toEqual([]);
  });

  it("en akt der foreslår noget, har også en undskyldning klar", () => {
    for (const n of content.narrator) {
      if (n.lines.some((l) => l.suggests?.length)) {
        expect(n.obeyedFailure?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  /** Kør tomme forsøg til fortælleren begynder at hinte. */
  function untilAdvice(engine: Engine, narrator: Narrator, max = 40) {
    const heard: string[] = [];
    for (let i = 0; i < max && narrator.suggestions().length === 0; i++) {
      const line = attempt(engine, narrator, "sten", "graes");
      if (line) heard.push(line.id);
    }
    return heard;
  }

  it("bogfører kun forslag han faktisk har sagt højt", () => {
    const { engine, narrator } = setup();
    expect(narrator.suggestions()).toHaveLength(0);
    const heard = untilAdvice(engine, narrator);
    expect(narrator.suggestions().length, `hørte: ${heard.join(", ")}`).toBeGreaterThan(0);
    for (const s of narrator.suggestions()) {
      expect(content.combos.some((c) => [...c.pair].sort().join("+") === s.key)).toBe(true);
    }
  });

  it("husker højst to forslag ad gangen", () => {
    const { engine, narrator } = setup();
    untilAdvice(engine, narrator);
    // Karl dør af alderdom, hvis man bliver ved — hold sig inden for livet.
    for (let i = 0; i < 30 && !engine.getState().ended; i++) {
      attempt(engine, narrator, "sten", "graes");
      expect(narrator.suggestions().length).toBeLessThanOrEqual(2);
    }
  });

  /*
   * Med ærligt indhold KAN et forslag ikke fejle længere — validatoren slår
   * hvert par op i combos.json. Grenen efterprøves derfor med indsat tilstand:
   * den er et sikkerhedsnet, ikke en vej spilleren kan gå i dag.
   */
  it("tager skylden når spilleren gør præcis det, han bad om", () => {
    const { engine, narrator } = setup();
    narrator.loadState({
      ...narrator.getState(),
      recentSuggestions: [
        { key: "graes+sten", a: "sten", b: "graes", lineId: "hint-kulde-2", attempt: 0 },
      ],
    });
    expect(attempt(engine, narrator, "sten", "graes")?.id).toBe("obeyed-failure");
  });

  it("undskylder højst én gang for det samme råd", () => {
    const { engine, narrator } = setup();
    narrator.loadState({
      ...narrator.getState(),
      recentSuggestions: [
        { key: "graes+sten", a: "sten", b: "graes", lineId: "hint-kulde-2", attempt: 0 },
      ],
    });
    expect(attempt(engine, narrator, "sten", "graes")?.id).toBe("obeyed-failure");
    expect(narrator.suggestions()).toHaveLength(0);
    expect(attempt(engine, narrator, "sten", "graes")?.id).not.toBe("obeyed-failure");
  });

  it("gamle råd er ikke længere hans ansvar", () => {
    const { engine, narrator } = setup();
    narrator.loadState({
      ...narrator.getState(),
      attempts: 50,
      recentSuggestions: [
        { key: "graes+sten", a: "sten", b: "graes", lineId: "hint-kulde-2", attempt: 0 },
      ],
    });
    expect(attempt(engine, narrator, "sten", "graes")?.id).not.toBe("obeyed-failure");
  });
});
