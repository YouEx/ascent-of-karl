import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH_ROOT = resolve(ROOT, ".judge", "test-scratch");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const PREVIEW_URL =
  "https://youex.github.io/ascent-of-karl/playtest/improvisation/";
const ROOT_URL = "https://youex.github.io/ascent-of-karl/";

const scratch: string[] = [];

afterEach(() => {
  for (const path of scratch.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

async function buildModule(): Promise<{
  createPagesBuildPlan: (
    env: Record<string, string | undefined>,
  ) => Array<{
    variant: string;
    outDir: string;
    env: Record<string, string | undefined>;
  }>;
}> {
  // Konstanten holder importen dynamisk, så testen kan være RED før modulet
  // findes uden at TypeScript kræver en deklarationsfil til ren JavaScript.
  const path = "../tools/build_pages.mjs";
  return import(path);
}

async function verifierModule(): Promise<{
  verifyPagesArtifact: (options: {
    root: string;
    forbiddenStrings?: string[];
    log?: (message: string) => void;
  }) => {
    root: { entry: string };
    preview: { entry: string };
  };
}> {
  const path = "../tools/verify_pages_artifact.mjs";
  return import(path);
}

function writeFixture(): string {
  mkdirSync(SCRATCH_ROOT, { recursive: true });
  const root = mkdtempSync(join(SCRATCH_ROOT, "karl-pages-"));
  scratch.push(root);
  const rootAssets = join(root, "assets");
  const preview = join(root, "playtest", "improvisation");
  const previewAssets = join(preview, "assets");
  mkdirSync(rootAssets, { recursive: true });
  mkdirSync(previewAssets, { recursive: true });

  const rootEntry = 'import("./lazy-root.js");globalThis.rootBuild=true;';
  const rootLazy = "export default 'root lazy';";
  const previewEntry =
    'import("./lazy-preview.js");globalThis.previewBuild=true;';
  const previewLazy = "export default 'preview lazy';";

  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><script type="module" src="./assets/index-root.js"></script>',
  );
  writeFileSync(join(rootAssets, "index-root.js"), rootEntry);
  writeFileSync(join(rootAssets, "lazy-root.js"), rootLazy);
  writeFileSync(
    join(root, "pages-build.json"),
    JSON.stringify({
      schema: 2,
      variant: "production-root",
      publicUrl: ROOT_URL,
      entry: "assets/index-root.js",
      entrySha256: sha256(rootEntry),
      env: {
        mode: "production",
        VITE_IMPROVISE_ENABLED: "false",
        VITE_IMPROVISE_URL: "",
        VITE_NARRATOR_URL: "",
      },
      modules: {
        "assets/index-root.js": moduleContract(rootEntry, {
          dynamicImports: ["assets/lazy-root.js"],
        }),
        "assets/lazy-root.js": moduleContract(rootLazy),
      },
    }),
  );

  writeFileSync(
    join(preview, "index.html"),
    [
      "<!doctype html>",
      '<meta name="robots" content="noindex,nofollow">',
      '<meta name="playtest-build" content="improvisation-offline-non-production">',
      '<script type="module" src="./assets/index-preview.js"></script>',
    ].join(""),
  );
  writeFileSync(join(previewAssets, "index-preview.js"), previewEntry);
  writeFileSync(join(previewAssets, "lazy-preview.js"), previewLazy);
  writeFileSync(
    join(preview, "pages-build.json"),
    JSON.stringify({
      schema: 2,
      variant: "improvisation-playtest",
      publicUrl: PREVIEW_URL,
      entry: "assets/index-preview.js",
      entrySha256: sha256(previewEntry),
      env: {
        mode: "production",
        VITE_IMPROVISE_ENABLED: "true",
        VITE_IMPROVISE_URL: "",
        VITE_NARRATOR_URL: "",
      },
      modules: {
        "assets/index-preview.js": moduleContract(previewEntry, {
          dynamicImports: ["assets/lazy-preview.js"],
        }),
        "assets/lazy-preview.js": moduleContract(previewLazy),
      },
    }),
  );
  return root;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function moduleContract(
  text: string,
  overrides: Partial<{
    imports: string[];
    dynamicImports: string[];
    preloads: string[];
  }> = {},
): {
  sha256: string;
  imports: string[];
  dynamicImports: string[];
  preloads: string[];
} {
  return {
    sha256: sha256(text),
    imports: [],
    dynamicImports: [],
    preloads: [],
    ...overrides,
  };
}

function rewriteModuleAndHash(
  root: string,
  variant: "root" | "preview",
  module: string,
  text: string,
): void {
  const dir =
    variant === "root" ? root : join(root, "playtest", "improvisation");
  const contractPath = join(dir, "pages-build.json");
  const contract = JSON.parse(readFileSync(contractPath, "utf8")) as {
    entry: string;
    entrySha256: string;
    modules: Record<string, { sha256: string }>;
  };
  writeFileSync(join(dir, module), text);
  contract.modules[module]!.sha256 = sha256(text);
  if (contract.entry === module) contract.entrySha256 = sha256(text);
  writeFileSync(contractPath, JSON.stringify(contract));
}

describe("GitHub Pages playtest-buildkontrakt", () => {
  it("bygger og uploader ét samlet dist-artifact i den eksisterende deploy-job", () => {
    const workflow = read(".github/workflows/deploy.yml");
    const buildAt = workflow.indexOf("run: npm run build:pages");
    const uploadAt = workflow.indexOf("uses: actions/upload-pages-artifact@v3");
    const jobs = workflow.slice(workflow.indexOf("\njobs:"));

    expect(buildAt).toBeGreaterThan(-1);
    expect(uploadAt).toBeGreaterThan(buildAt);
    expect(workflow.slice(uploadAt)).toMatch(/path:\s*dist/);
    expect(jobs.match(/^  [a-z][a-z0-9_-]*:\s*$/gm)).toEqual([
      "  deploy:",
    ]);
    expect(workflow).not.toMatch(/\bmatrix:/);

    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["build:pages"]).toContain("tools/build_pages.mjs");
    expect(pkg.scripts["pages:verify"]).toContain(
      "tools/verify_pages_artifact.mjs",
    );
  });

  it("tvinger root off og begge builds helt væk fra Worker-URL'er", async () => {
    const { createPagesBuildPlan } = await buildModule();
    const hostile = "https://hostile.invalid/improvise?bill=someone";
    const plan = createPagesBuildPlan({
      VITE_IMPROVISE_ENABLED: "true",
      VITE_IMPROVISE_URL: hostile,
      VITE_NARRATOR_URL: "https://hostile.invalid/narrate",
    });

    expect(plan.map((step) => step.variant)).toEqual([
      "production-root",
      "improvisation-playtest",
    ]);
    expect(plan[0]?.outDir).toBe("dist");
    expect(plan[1]?.outDir).toBe("dist/playtest/improvisation");
    expect(plan[0]?.env).toMatchObject({
      NODE_ENV: "production",
      KARL_PAGES_VARIANT: "production-root",
      VITE_IMPROVISE_ENABLED: "false",
      VITE_IMPROVISE_URL: "",
      VITE_NARRATOR_URL: "",
    });
    expect(plan[1]?.env).toMatchObject({
      NODE_ENV: "production",
      KARL_PAGES_VARIANT: "improvisation-playtest",
      VITE_IMPROVISE_ENABLED: "true",
      VITE_IMPROVISE_URL: "",
      VITE_NARRATOR_URL: "",
    });
    expect(JSON.stringify(plan)).not.toContain(hostile);
  });

  it("har en genbrugelig bundtbudgetkontrol til både root og preview", () => {
    const budget = read("tools/bundle_budget.mjs");
    expect(budget).toContain("export function checkBundleBudget");
    expect(budget).toMatch(/--dir/);
    expect(read("tools/build_pages.mjs")).toContain("checkBundleBudget");
    expect(read("tools/build_pages.mjs")).toContain(
      "dist/playtest/improvisation",
    );
  });

  it("giver hver variant sit eget loft, så det mindste bundt ikke sejler med i det størstes luft", async () => {
    const {
      MAIN_BUNDLE_GZIP_BUDGET,
      PLAYTEST_BUNDLE_GZIP_BUDGET,
      budgetForOutDir,
    } = await import("../tools/bundle_budget.mjs");

    // Playtest-varianten har improvisationen slået til og er derfor større.
    // Deler de to varianter loft, bliver det sat af den største, og
    // produktionsroden — den offentlige første indlæsning — står ubevogtet.
    expect(MAIN_BUNDLE_GZIP_BUDGET).toBeLessThan(PLAYTEST_BUNDLE_GZIP_BUDGET);

    // Bygget mod et kunstigt artifact, ikke mod repoets `dist/`: hvad der
    // ligger dér, afhænger af hvilket build der sidst kørte, og en test, der
    // aflæser det, måler maskinen i stedet for koden.
    const { createPagesBuildPlan } = await buildModule();
    const plan = createPagesBuildPlan({
      VITE_IMPROVISE_ENABLED: "true",
      VITE_IMPROVISE_URL: "",
      VITE_NARRATOR_URL: "",
    });

    const root = mkdtempSync(join(SCRATCH_ROOT, "budget-plan-"));
    for (const step of plan) {
      const dir = join(root, step.outDir);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "pages-build.json"),
        JSON.stringify({ schema: 2, variant: step.variant }),
      );
    }

    const budgets = plan.map((step) => budgetForOutDir(step.outDir, root));
    expect(new Set(budgets).size).toBe(plan.length);
    expect(budgetForOutDir("dist", root)).toBe(MAIN_BUNDLE_GZIP_BUDGET);
    expect(budgetForOutDir("dist/playtest/improvisation", root)).toBe(
      PLAYTEST_BUNDLE_GZIP_BUDGET,
    );

    rmSync(root, { recursive: true, force: true });
  });

  it("læser varianten ud af artifactets egen kontrakt, ikke ud af stien", async () => {
    const {
      budgetForOutDir,
      isPagesArtifact,
      LOCAL_BUNDLE_GZIP_BUDGET,
      MAIN_BUNDLE_GZIP_BUDGET,
      PLAYTEST_BUNDLE_GZIP_BUDGET,
    } = await import("../tools/bundle_budget.mjs");

    const root = mkdtempSync(join(SCRATCH_ROOT, "budget-"));
    const artifact = join(root, "dist");
    mkdirSync(artifact, { recursive: true });

    // `npm run build`, `npm run preview` og `npm run judge:capture` bygger alle
    // et løst `vite build` ind i `dist/` — improvisationen slået TIL, altså det
    // store bundt, i den mappe hvor produktionsvarianten ellers ligger. Blev
    // stien troet på, ville den chunk blive målt mod produktionsloftet og melde
    // rødt, uden at produktionsvarianten havde ændret sig én byte. Netop den
    // forveksling fik i første omgang et korrekt review-fund afvist.
    expect(isPagesArtifact("dist", root)).toBe(false);
    expect(budgetForOutDir("dist", root)).toBe(LOCAL_BUNDLE_GZIP_BUDGET);
    expect(LOCAL_BUNDLE_GZIP_BUDGET).not.toBe(MAIN_BUNDLE_GZIP_BUDGET);

    // Stien konsulteres heller ikke den anden vej.
    mkdirSync(join(root, "dist-playtest-uden-kontrakt"), { recursive: true });
    expect(budgetForOutDir("dist-playtest-uden-kontrakt", root)).toBe(
      LOCAL_BUNDLE_GZIP_BUDGET,
    );

    // Med kontrakt afgør varianten — også når stien siger noget andet.
    writeFileSync(
      join(artifact, "pages-build.json"),
      JSON.stringify({ schema: 2, variant: "improvisation-playtest" }),
    );
    expect(isPagesArtifact("dist", root)).toBe(true);
    expect(budgetForOutDir("dist", root)).toBe(PLAYTEST_BUNDLE_GZIP_BUDGET);

    // En ulæselig kontrakt er ikke et gæt værd.
    writeFileSync(join(artifact, "pages-build.json"), "{ ikke json");
    expect(budgetForOutDir("dist", root)).toBe(LOCAL_BUNDLE_GZIP_BUDGET);

    rmSync(root, { recursive: true, force: true });
  });

  it("verificerer et komplet artifact og afviser mangler, stale og krydslinks", async () => {
    const { verifyPagesArtifact } = await verifierModule();
    const root = writeFixture();
    const report = verifyPagesArtifact({ root, log: () => undefined });

    expect(report.root.entry).toBe("assets/index-root.js");
    expect(report.preview.entry).toBe("assets/index-preview.js");

    rmSync(
      join(root, "playtest", "improvisation", "assets", "index-preview.js"),
    );
    expect(() =>
      verifyPagesArtifact({ root, log: () => undefined }),
    ).toThrow(/mangler|missing/i);

    const stale = writeFixture();
    writeFileSync(
      join(stale, "playtest", "improvisation", "pages-build.json"),
      JSON.stringify({
        schema: 2,
        variant: "improvisation-playtest",
        publicUrl: PREVIEW_URL,
        entry: "assets/index-old.js",
        entrySha256: "0".repeat(64),
        env: {
          mode: "production",
          VITE_IMPROVISE_ENABLED: "true",
          VITE_IMPROVISE_URL: "",
          VITE_NARRATOR_URL: "",
        },
        modules: {},
      }),
    );
    expect(() =>
      verifyPagesArtifact({ root: stale, log: () => undefined }),
    ).toThrow(/stale|entry/i);

    const crossLinked = writeFixture();
    writeFileSync(
      join(crossLinked, "playtest", "improvisation", "index.html"),
      [
        "<!doctype html>",
        '<meta name="robots" content="noindex,nofollow">',
        '<meta name="playtest-build" content="improvisation-offline-non-production">',
        '<script type="module" src="../../assets/index-root.js"></script>',
      ].join(""),
    );
    expect(() =>
      verifyPagesArtifact({ root: crossLinked, log: () => undefined }),
    ).toThrow(/krydslink|cross-link|preview/i);
  });

  it("afviser kommentar, unrelated streng og reviewerens erstattede bundle", async () => {
    const { verifyPagesArtifact } = await verifierModule();
    for (const mutate of [
      (previewBundle: string) =>
        `${previewBundle}\n// dataset.improviseEnabled="true"`,
      (previewBundle: string) =>
        `${previewBundle}\nconst unrelated="dataset.improviseEnabled=\\"true\\"";`,
      (_previewBundle: string, rootBundle: string) =>
        `${rootBundle}\n// dataset.improviseEnabled="true"`,
    ]) {
      const root = writeFixture();
      const previewPath = join(
        root,
        "playtest",
        "improvisation",
        "assets",
        "index-preview.js",
      );
      writeFileSync(
        previewPath,
        mutate(
          readFileSync(previewPath, "utf8"),
          readFileSync(join(root, "assets", "index-root.js"), "utf8"),
        ),
      );

      expect(() =>
        verifyPagesArtifact({ root, log: () => undefined }),
      ).toThrow(/hash|sha256|entry/i);
    }
  });

  it("afviser en muteret dynamisk import, der krydslinker fra preview til root", async () => {
    const { verifyPagesArtifact } = await verifierModule();
    const root = writeFixture();
    rewriteModuleAndHash(
      root,
      "preview",
      "assets/index-preview.js",
      'import("../../../assets/lazy-root.js");globalThis.previewBuild=true;',
    );

    expect(() =>
      verifyPagesArtifact({ root, log: () => undefined }),
    ).toThrow(/krydslink|cross-link|\.\.\//i);
  });

  it("afviser en manglende lazy chunk i den deklarerede modulgraph", async () => {
    const { verifyPagesArtifact } = await verifierModule();
    const root = writeFixture();
    rmSync(
      join(
        root,
        "playtest",
        "improvisation",
        "assets",
        "lazy-preview.js",
      ),
    );

    expect(() =>
      verifyPagesArtifact({ root, log: () => undefined }),
    ).toThrow(/lazy-preview|lazy|mangler|missing/i);
  });

  it("afviser en Worker-URL fra et fjendtligt ambient miljø", async () => {
    const { verifyPagesArtifact } = await verifierModule();
    const root = writeFixture();
    const hostile = "https://hostile.invalid/improvise?bill=someone";
    rewriteModuleAndHash(
      root,
      "preview",
      "assets/index-preview.js",
      `import("./lazy-preview.js");const endpoint=${JSON.stringify(hostile)};globalThis.previewBuild=true;`,
    );

    expect(() =>
      verifyPagesArtifact({
        root,
        forbiddenStrings: [hostile],
        log: () => undefined,
      }),
    ).toThrow(/forbudt|forbidden|Worker/i);
  });

  it("dokumenterer præcis preview-link uden at lukke human-gaten", () => {
    for (const path of [
      "README.md",
      "ROADMAP.md",
      "docs/playtest/README.md",
      "docs/playtest/invitation.md",
    ]) {
      expect(read(path), path).toContain(PREVIEW_URL);
    }

    for (const path of [
      "PRD.md",
      "README.md",
      "ROADMAP.md",
      "docs/playtest/README.md",
      "docs/playtest/invitation.md",
    ]) {
      const text = read(path);
      expect(text, path).toMatch(/5[–-]10/);
      expect(text, path).toMatch(
        /external playtest pending|ekstern(?:e)? (?:human-)?(?:playtest)?gate|gaten .*åben|gate.*open/i,
      );
    }
  });
});
