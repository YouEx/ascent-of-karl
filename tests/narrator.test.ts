import { describe, expect, it } from "vitest";
import { Engine } from "../src/core/engine";
import { Narrator, freshNarratorState } from "../src/narrator/narrator";
import { loadContent } from "../src/content";

const content = loadContent();

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
      ["baer", "ler"], ["baer", "vand"], ["baer", "graes"], ["baer", "larver"],
      ["baer", "dyr"], ["baer", "pind"], ["larver", "vand"], ["larver", "graes"],
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
      ["baer", "ler"], ["baer", "vand"], ["baer", "graes"], ["baer", "larver"],
      ["baer", "dyr"], ["baer", "pind"], ["larver", "vand"], ["larver", "graes"],
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
      ["baer", "ler"], ["baer", "vand"], ["baer", "graes"], ["baer", "larver"],
    ] as const) {
      attempt(engine, narrator, a, b);
    }
    attempt(engine, narrator, "sten", "sten"); // opdagelse
    const line = attempt(engine, narrator, "baer", "dyr");
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
    const second = attempt(engine, narrator, "baer", "vand");
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
    attempt(engine, narrator, "baer", "vand");
    attempt(engine, narrator, "baer", "graes");
    const line = attempt(engine, narrator, "baer", "larver");
    expect(line?.id).toBe("sweep-4");
    expect(line?.text).toContain("berries");
  });

  it("meget hurtige forsøg i træk udløser fast-replikken", () => {
    const { engine, narrator } = setup();
    const pairs: Array<[string, string]> = [
      ["baer", "ler"], ["vand", "graes"], ["larver", "dyr"],
      ["baer", "graes"], ["ler", "vand"], ["dyr", "pind"],
    ];
    let last;
    for (const [a, b] of pairs) last = attempt(engine, narrator, a, b, 500);
    expect(last?.id).toBe("fast-6");
  });

  it("en meget lang pause udløser slow-replikken", () => {
    const { engine, narrator } = setup();
    attempt(engine, narrator, "baer", "ler", 1000);
    const line = attempt(engine, narrator, "baer", "vand", 60_000);
    expect(line?.id).toBe("slow-1");
  });

  it("slow har cooldown — fyrer ikke ved to lange pauser lige efter hinanden", () => {
    const { engine, narrator } = setup();
    const first = attempt(engine, narrator, "baer", "ler", 60_000);
    expect(first?.id).toBe("slow-1");
    const second = attempt(engine, narrator, "baer", "vand", 60_000);
    expect(second?.id).not.toBe("slow-1");
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
