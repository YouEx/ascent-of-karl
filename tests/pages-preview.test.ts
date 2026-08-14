import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH_ROOT = resolve(ROOT, ".judge", "test-scratch");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const PREVIEW_URL =
  "https://youex.github.io/ascent-of-karl/playtest/improvisation/";

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

  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><script type="module" src="./assets/index-root.js"></script>',
  );
  writeFileSync(
    join(rootAssets, "index-root.js"),
    'document.documentElement.dataset.ready="true";',
  );
  writeFileSync(
    join(root, "pages-build.json"),
    JSON.stringify({
      schema: 1,
      variant: "production-root",
      publicUrl: "https://youex.github.io/ascent-of-karl/",
      entry: "assets/index-root.js",
      improvisationEnabled: false,
      improviseUrl: "",
      narratorUrl: "",
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
  writeFileSync(
    join(previewAssets, "index-preview.js"),
    'document.documentElement.dataset.improviseEnabled="true";',
  );
  writeFileSync(
    join(preview, "pages-build.json"),
    JSON.stringify({
      schema: 1,
      variant: "improvisation-playtest",
      publicUrl: PREVIEW_URL,
      entry: "assets/index-preview.js",
      improvisationEnabled: true,
      improviseUrl: "",
      narratorUrl: "",
    }),
  );
  return root;
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
    expect(pkg.scripts["verify:pages"]).toContain(
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
      VITE_IMPROVISE_ENABLED: "false",
      VITE_IMPROVISE_URL: "",
      VITE_NARRATOR_URL: "",
    });
    expect(plan[1]?.env).toMatchObject({
      NODE_ENV: "production",
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
        schema: 1,
        variant: "improvisation-playtest",
        publicUrl: PREVIEW_URL,
        entry: "assets/index-old.js",
        improvisationEnabled: true,
        improviseUrl: "",
        narratorUrl: "",
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

  it("afviser en Worker-URL fra et fjendtligt ambient miljø", async () => {
    const { verifyPagesArtifact } = await verifierModule();
    const root = writeFixture();
    const hostile = "https://hostile.invalid/improvise?bill=someone";
    writeFileSync(
      join(root, "playtest", "improvisation", "assets", "index-preview.js"),
      `const endpoint=${JSON.stringify(hostile)};document.documentElement.dataset.improviseEnabled="true";`,
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
