/**
 * Værktøjet i tools/verify_live_deploy.mjs findes, fordi PRD'en engang
 * dokumenterede "deploy før rekruttering" ved at skrive de dengang aktuelle
 * asset-hashes ind i prosaen. To commits senere var de forældede, og noten
 * påstod noget usandt om live. Testene her holder på det, der gjorde værktøjet
 * bedre end noten: at det er fail-closed. En 404, et netværksbrud eller en tom
 * kørsel må aldrig kunne læses som "live svarer til main".
 *
 * Kun de rene funktioner testes her — selve sammenligningen kræver netværk og
 * hører til i den manuelle kørsel før en rekrutteringsrunde.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  createThrottle,
  fetchLive,
  verifyLiveDeploy,
  isTransient,
  retryAfterMs,
  listVariantFiles,
  planFiles,
  summarise,
  SUPPORTED_CONTRACT_SCHEMA,
  VARIANTS,
} from "../tools/verify_live_deploy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRATCH_ROOT = join(HERE, "..", ".judge", "test-scratch");
mkdirSync(SCRATCH_ROOT, { recursive: true });

async function buildModule(): Promise<{
  createPagesBuildPlan: (
    env: Record<string, string | undefined>,
  ) => Array<{ variant: string; outDir: string }>;
}> {
  // @ts-expect-error — buildværktøjet er ren JavaScript uden typedeklaration.
  return import("../tools/build_pages.mjs");
}

const contract = {
  schema: SUPPORTED_CONTRACT_SCHEMA,
  modules: {
    "assets/index-AAA.js": { sha256: "a" },
    "assets/pairs-act-1-BBB.js": { sha256: "b" },
  },
};

const walked = [
  "assets/index-AAA.js",
  "assets/index-CCC.css",
  "assets/pairs-act-1-BBB.js",
  "audio/manifest.json",
  "audio/narrator-001.mp3",
  "index.html",
  "karl.webp",
];

const temporaryDirs: string[] = [];

function fixtureDir(files: Record<string, string>) {
  const root = mkdtempSync(join(SCRATCH_ROOT, "karl-live-"));
  temporaryDirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

afterEach(() => {
  while (temporaryDirs.length > 0) {
    rmSync(temporaryDirs.pop()!, { recursive: true, force: true });
  }
});

describe("planFiles — hvad sammenlignes mod live", () => {
  it("lægger index.html, moduler og CSS forrest, så bundtdrift meldes først", () => {
    const html =
      '<link rel="stylesheet" href="/assets/index-CCC.css">' +
      '<script type="module" src="/assets/index-AAA.js"></script>';

    expect(planFiles(html, contract, walked).slice(0, 4)).toEqual([
      "index.html",
      "assets/index-AAA.js",
      "assets/pairs-act-1-BBB.js",
      "assets/index-CCC.css",
    ]);
  });

  it("sammenligner HELE artifactet, ikke kun de hashede assets", () => {
    // Regression: første udgave sammenlignede 8 af 2.936 filer. Alt under
    // stabile navne — frem for alt lyden — var usynligt, og det var netop en
    // lydrettelse, værktøjet blev skrevet efter.
    const files = planFiles("<html></html>", contract, walked);

    expect(new Set(files)).toEqual(new Set(walked));
    expect(files).toContain("audio/manifest.json");
    expect(files).toContain("audio/narrator-001.mp3");
    expect(files).toContain("karl.webp");
  });

  it("tager CSS med, selv når den kun optræder i en url() i HTML'en", () => {
    const html = '<style>@import url("./assets/sent-DDD.css");</style>';

    expect(planFiles(html, contract)).toContain("assets/sent-DDD.css");
  });

  it("dublerer ikke en fil, der både står i kontrakten og i HTML'en", () => {
    const html = '<script type="module" src="/assets/index-AAA.js"></script>';
    const files = planFiles(html, contract, walked);

    expect(files.filter((path) => path === "assets/index-AAA.js")).toHaveLength(1);
  });

  it("kaster ved skemadrift i stedet for at tjekke ingenting", () => {
    // Fail-closed: en omdøbt kontrakt må ikke kunne læses som "intet at
    // tjekke" og alligevel ende i et ✅.
    expect(() => planFiles("<html></html>", { schema: 3, modules: contract.modules })).toThrow(
      /skema/,
    );
    expect(() => planFiles("<html></html>", {})).toThrow(/skema/);
    expect(() => planFiles("<html></html>", { schema: SUPPORTED_CONTRACT_SCHEMA })).toThrow(
      /ingen moduler/,
    );
  });

  it("kaster, når kontrakten navngiver en fil, artifactet ikke indeholder", () => {
    expect(() =>
      planFiles("<html></html>", contract, ["index.html", "assets/index-AAA.js"]),
    ).toThrow(/assets\/pairs-act-1-BBB\.js/);
  });
});

describe("listVariantFiles — gennemgangen af artifactet", () => {
  it("finder filer i alle undermapper", () => {
    const root = fixtureDir({
      "index.html": "<html>",
      "assets/index-AAA.js": "js",
      "audio/en/narrator-001.mp3": "lyd",
    });

    expect(listVariantFiles(root)).toEqual([
      "assets/index-AAA.js",
      "audio/en/narrator-001.mp3",
      "index.html",
    ]);
  });

  it("tæller ikke en indlejret variant med i rodens gennemgang", () => {
    const root = fixtureDir({
      "index.html": "<html>",
      "playtest/improvisation/index.html": "<html>",
    });

    expect(listVariantFiles(root, ["playtest"])).toEqual(["index.html"]);
  });
});

describe("VARIANTS — pinnet mod buildplanen", () => {
  it("verificerer præcis de varianter, buildet producerer", async () => {
    // Samme driftklasse som NARRATOR_SOURCES: to lister over det samme, i to
    // filer. En tredje variant i planen skal tvinge en ændring her, ikke
    // stiltiende slippe uverificeret live.
    const { createPagesBuildPlan } = await buildModule();
    const plan = createPagesBuildPlan({
      VITE_IMPROVISE_ENABLED: "true",
      VITE_IMPROVISE_URL: "",
      VITE_NARRATOR_URL: "",
    });

    expect(VARIANTS.map((variant) => variant.dir).sort()).toEqual(
      plan.map((step) => step.outDir.replace(/^dist\/?/, "") || ".").sort(),
    );
    expect(VARIANTS).toHaveLength(plan.length);
  });
});

describe("summarise — fail-closed", () => {
  it("er kun ok, når hver eneste fil er bekræftet identisk", () => {
    expect(
      summarise([
        { path: "index.html", status: "identisk" },
        { path: "assets/index-AAA.js", status: "identisk" },
      ]).ok,
    ).toBe(true);
  });

  it("er ikke ok ved byte-afvigelse", () => {
    const summary = summarise([
      { path: "index.html", status: "identisk" },
      { path: "assets/index-AAA.js", status: "afviger" },
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.drifted).toHaveLength(1);
  });

  it.each(["HTTP 404", "netværksfejl: ECONNRESET", "mangler lokalt"])(
    "læser ikke %s som en bekræftelse",
    (status) => {
      expect(summarise([{ path: "index.html", status }]).ok).toBe(false);
    },
  );

  it("er ikke ok, når intet blev sammenlignet — tomhed er ikke bevis", () => {
    expect(summarise([]).ok).toBe(false);
  });
});

describe("transportfejl — værktøjet må ikke råbe ulv", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("regner 429 og 5xx som manglende svar, men ikke 404", () => {
    expect(isTransient(503)).toBe(true);
    expect(isTransient(429)).toBe(true);
    expect(isTransient(404)).toBe(false);
    expect(isTransient(200)).toBe(false);
  });

  it("prøver igen efter en 503 og accepterer svaret bagefter", async () => {
    // Målt under en rigtig kørsel: ved 2.936 hentninger rammer man CDN'ets
    // tilfældige 503'ere. Uden genforsøg ville værktøjet melde bytedrift og
    // sende operatøren ud i et unødigt gen-deploy.
    const statuses = [503, 503, 200];
    let calls = 0;
    globalThis.fetch = (async () => {
      const status = statuses[calls++] ?? 200;
      return new Response("", { status });
    }) as typeof fetch;

    const { response, failure } = await fetchLive("https://example.test/a", [0, 0]);

    expect(calls).toBe(3);
    expect(failure).toBeUndefined();
    expect(response?.status).toBe(200);
  });

  it("giver op fail-closed, når svaret bliver ved med at udeblive", async () => {
    globalThis.fetch = (async () => new Response("", { status: 503 })) as typeof fetch;

    const { response, failure } = await fetchLive("https://example.test/a", [0, 0]);

    expect(response).toBeUndefined();
    expect(failure?.transport).toBe(true);
    expect(failure?.status).toBe("HTTP 503");
  });

  it("prøver ikke igen på 404 — det ER et svar", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("", { status: 404 });
    }) as typeof fetch;

    const { response } = await fetchLive("https://example.test/a", [0, 0]);

    expect(calls).toBe(1);
    expect(response?.status).toBe(404);
  });

  it("standser ALLE arbejdere på et 429, ikke kun den, der så det", async () => {
    // Målt mod den rigtige udgivelse: to fulde gennemgange i træk ved 24
    // samtidige gav HTTP 429 på først 869 og dernæst alle 2.936 filer. Med
    // genforsøg pr. arbejder hjælper det ikke — mens den ene venter, banker de
    // 23 andre videre, og grænsen får aldrig luft. Bremsen skal være fælles.
    const waits: number[] = [];
    const throttle = createThrottle({
      now: () => 0,
      wait: async (ms: number) => {
        waits.push(ms);
      },
    });

    expect(throttle.tripped).toBe(false);

    globalThis.fetch = (async () =>
      new Response("", { status: 429 })) as typeof fetch;
    const limited = await fetchLive("https://example.test/a", [10], throttle);

    expect(limited.failure?.status).toBe("HTTP 429");
    expect(throttle.tripped).toBe(true);

    // En anden arbejder, der end ikke har set et 429, skal nu vente.
    globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
    waits.length = 0;
    await fetchLive("https://example.test/b", [10], throttle);

    expect(waits.length).toBeGreaterThan(0);
  });

  it("adlyder CDN'ets eget Retry-After frem for vores egen stige", async () => {
    // 2 sekunder fra serveren slår vores 1 sekund; en tom header ændrer intet;
    // og en fjendtlig header kan ikke hænge kørslen længere end et minut.
    expect(retryAfterMs("2", 1_000)).toBe(2_000);
    expect(retryAfterMs(null, 1_000)).toBe(1_000);
    expect(retryAfterMs("0", 1_000)).toBe(1_000);
    expect(retryAfterMs("99999", 1_000)).toBe(60_000);
    expect(retryAfterMs("noget vrøvl", 1_000)).toBe(1_000);
  });

  it("pauser efter det længste af flere 429-svar", async () => {
    // To arbejdere ser hver sit 429. Den korte pause må ikke kunne forkorte
    // den lange — ellers giver den ene arbejder grænsen luft, som den anden
    // straks tager igen.
    const waited: number[] = [];
    const throttle = createThrottle({
      now: () => 0,
      wait: async (ms: number) => {
        waited.push(ms);
      },
    });

    throttle.pause(5_000);
    throttle.pause(1_000);
    await throttle.settle();

    expect(waited).toEqual([5_000]);
  });

  it("skiller uhentelige filer fra ægte bytedrift i opsummeringen", () => {
    const summary = summarise([
      { path: "a", status: "identisk" },
      { path: "b", status: "afviger" },
      { path: "c", status: "HTTP 503", transport: true },
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.drifted).toHaveLength(2);
    expect(summary.unreachable.map((entry) => entry.path)).toEqual(["c"]);
  });
});

/**
 * En afkortet kørsel må aldrig kunne ende som et ✅.
 *
 * Kredsløbsafbryderen findes, fordi en gennemgang bag gentagne
 * `Retry-After: 60` blev målt til 310 sekunder for til sidst at sige præcis
 * det samme som efter de første ti. Men "hold op med at spørge" er kun
 * forsvarligt, hvis de filer, der aldrig blev forsøgt, tælles som ikke-svar.
 * Ellers ville værktøjet blive HURTIGERE til at melde grønt, jo hårdere det
 * blev afvist — det stik modsatte af fail-closed.
 */
describe("hastighedsgrænse — afkortet kørsel er aldrig grøn", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function artifact() {
    const contract = (publicUrl: string) =>
      JSON.stringify({
        schema: 2,
        publicUrl,
        modules: { "assets/index.js": {} },
      });
    return fixtureDir({
      "index.html": '<script src="/assets/index.js"></script>',
      "assets/index.js": "console.log(1);",
      "audio/a.mp3": "a",
      "audio/b.mp3": "b",
      "audio/c.mp3": "c",
      "pages-build.json": contract("https://example.test/karl/"),
      "playtest/improvisation/index.html":
        '<script src="/assets/index.js"></script>',
      "playtest/improvisation/assets/index.js": "console.log(1);",
      "playtest/improvisation/audio/a.mp3": "a",
      "playtest/improvisation/pages-build.json": contract(
        "https://example.test/karl/playtest/improvisation/",
      ),
    });
  }

  it("melder rødt og markerer de ikke-forsøgte filer, når Pages bremser hele vejen", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("", { status: 429 });
    }) as typeof fetch;

    const summary = await verifyLiveDeploy({
      root: artifact(),
      delays: [0],
    });

    expect(summary.ok).toBe(false);
    expect(summary.rateLimited).toBe(true);
    // Hver eneste fil står som uhentet — ingen af dem som "identisk".
    expect(summary.unreachable).toHaveLength(summary.checked);
    const unattempted = summary.drifted.filter((entry) =>
      String(entry.status).includes("ikke forsøgt"),
    );
    expect(unattempted.length).toBeGreaterThan(0);
    // Og de ikke-forsøgte er talt MED, ikke bortset fra.
    expect(summary.checked).toBe(10);
    // Kørslen blev afkortet: færre opslag end en fuld stige ville kræve.
    expect(calls).toBeLessThan(summary.checked * 2);
  });

  it("kører hele vejen igennem og melder grønt, når intet bremser", async () => {
    // Modprøven: uden den beviser testen ovenfor kun, at rødt er muligt — og
    // en kredsløbsafbryder, der altid slår fra, ville bestå den alene.
    const root = artifact();
    globalThis.fetch = (async (url: URL | string) => {
      const path = String(url).replace("https://example.test/karl/", "");
      const absolute = join(root, path);
      return existsSync(absolute)
        ? new Response(readFileSync(absolute, "utf8"), { status: 200 })
        : new Response("", { status: 404 });
    }) as typeof fetch;

    const summary = await verifyLiveDeploy({ root, delays: [0] });

    expect(summary.rateLimited).toBe(false);
    expect(summary.ok).toBe(true);
    expect(summary.checked).toBe(10);
    expect(summary.drifted).toEqual([]);
  });
});
