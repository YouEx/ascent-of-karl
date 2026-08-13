// TASK-022: src/ui/tuning.css er sløjfens ENESTE lovlige skrivemål, og den
// må kun indeholde :root-tokenoverstyringer. Denne fil beviser BÅDE den
// statiske kontrakt (filen findes, importeres sidst i style.css, indeholder
// kun én :root-blok) OG at writeTuning() selv — uanset hvilke tokens den
// får — strukturelt ALDRIG kan producere andet. TASK-027 beviser samtidig
// at .judge/ er gitignored, mens docs/design/-køerne er versionerede
// projektartefakter, ikke kørselsartefakter.
// Se plan/architecture-visual-judge-1.md REQ-004, CON-003.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — værktøjet er ren JS uden typedeklaration.
import { writeTuning } from "../tools/judge/apply.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const TUNING_PATH = join(ROOT, "src/ui/tuning.css");
const STYLE_PATH = join(ROOT, "src/ui/style.css");
const GITIGNORE_PATH = join(ROOT, ".gitignore");
const ASSET_QUEUE_PATH = join(ROOT, "docs/design/asset-queue.json");
const HUMAN_QUEUE_PATH = join(ROOT, "docs/design/human-queue.json");

// Scratch-mappe under den allerede-ignorerede .judge/ — ALDRIG i systemets /tmp.
const SCRATCH_ROOT = join(ROOT, ".judge", "test-scratch");
mkdirSync(SCRATCH_ROOT, { recursive: true });

function stripComments(css: string) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
}

/** Naiv .gitignore-linjematch: nok til denne lille, håndskrevne fil — ikke
 * en fuld glob-motor. Matcher enten en eksakt sti eller en mappe-præfiks
 * (linjer der ender på "/"). */
function isIgnoredByLine(relPath: string, line: string) {
  const pattern = line.trim();
  if (!pattern || pattern.startsWith("#")) return false;
  if (pattern.endsWith("/")) return relPath.startsWith(pattern) || relPath === pattern.slice(0, -1);
  return relPath === pattern || relPath.endsWith(`/${pattern}`);
}

describe("TASK-022: tuning.css er sløjfens eneste skrivemål (REQ-004)", () => {
  it("src/ui/tuning.css findes", () => {
    expect(existsSync(TUNING_PATH)).toBe(true);
  });

  it("tuning.css indeholder KUN én :root { … }-blok — ingen andre selektorer, at-regler eller indlejringer", () => {
    const body = stripComments(readFileSync(TUNING_PATH, "utf8"));
    expect(body).toMatch(/^:root\s*\{[^{}]*\}$/);
  });

  it("tuning.css indeholder ingen farlige konstruktioner (url(), @-regler, !important)", () => {
    const body = stripComments(readFileSync(TUNING_PATH, "utf8"));
    expect(body.toLowerCase()).not.toContain("url(");
    expect(body).not.toMatch(/@[a-z-]+/i);
    expect(body.toLowerCase()).not.toContain("!important");
  });

  it("style.css's SIDSTE @import er tuning.css", () => {
    const style = readFileSync(STYLE_PATH, "utf8");
    const imports = [...style.matchAll(/^@import\s+["']([^"']+)["'];?/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.at(-1)).toMatch(/tuning\.css$/);
  });

  describe("writeTuning() kan strukturelt ALDRIG producere andet end :root-overstyringer", () => {
    let dir: string;
    let tuningPath: string;
    let backupPath: string;

    beforeEach(() => {
      dir = mkdtempSync(join(SCRATCH_ROOT, "tuning-contract-"));
      tuningPath = join(dir, "tuning.css");
      writeFileSync(tuningPath, ":root {\n}\n");
      backupPath = join(dir, "tuning.prev.css");
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("skriver stadig kun én :root-blok efter flere tokens", () => {
      const tokens = [
        { key: "chip:color:--chronicle", region: "chip", defect: "color", severity: 4, fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "#d8ba9b" } },
        { key: "tools:spacing:--ink-01", region: "tools", defect: "spacing", severity: 2, fix: { kind: "token", token: "--ink-01", from: "8px", to: "10px" } },
      ];
      writeTuning(tokens, 1, { tuningPath, backupPath });
      const body = stripComments(readFileSync(tuningPath, "utf8"));
      expect(body).toMatch(/^:root\s*\{[^{}]*\}$/);
      expect(body).toContain("--chronicle: #d8ba9b;");
      expect(body).toContain("--ink-01: 10px;");
    });

    it("nægter (kaster) frem for at skrive en usikker to-værdi — ALDRIG en anden fil end tuning.css/backup berøres", () => {
      const malicious = [{
        key: "chip:color:--chronicle", region: "chip", defect: "color", severity: 4,
        fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "red; } body { display:none" },
      }];
      expect(() => writeTuning(malicious, 1, { tuningPath, backupPath })).toThrow();
      // tuning.css selv er urørt (stadig den oprindelige tomme :root).
      expect(readFileSync(tuningPath, "utf8")).toBe(":root {\n}\n");
    });
  });
});

describe("TASK-027: .judge/ er ignoreret, docs/design/-køerne er versionerede projektartefakter", () => {
  const gitignoreLines = readFileSync(GITIGNORE_PATH, "utf8").split("\n");

  it(".gitignore ignorerer .judge/", () => {
    expect(gitignoreLines.some((l) => l.trim() === ".judge/")).toBe(true);
  });

  it("asset-queue.json og human-queue.json findes under docs/design/ (IKKE under .judge/)", () => {
    expect(existsSync(ASSET_QUEUE_PATH)).toBe(true);
    expect(existsSync(HUMAN_QUEUE_PATH)).toBe(true);
    expect(ASSET_QUEUE_PATH).not.toContain(`${join("", ".judge")}${"/"}`);
    expect(HUMAN_QUEUE_PATH).not.toContain(`${join("", ".judge")}${"/"}`);
  });

  it("intet mønster i .gitignore matcher docs/design/asset-queue.json eller human-queue.json — køerne er ikke ved et uheld ignoreret", () => {
    const assetRel = "docs/design/asset-queue.json";
    const humanRel = "docs/design/human-queue.json";
    for (const line of gitignoreLines) {
      expect(isIgnoredByLine(assetRel, line)).toBe(false);
      expect(isIgnoredByLine(humanRel, line)).toBe(false);
    }
  });

  it("asset-queue.json og human-queue.json er gyldig JSON med et items-array (rigtig projektkø, ikke en tom stub)", () => {
    const asset = JSON.parse(readFileSync(ASSET_QUEUE_PATH, "utf8"));
    const human = JSON.parse(readFileSync(HUMAN_QUEUE_PATH, "utf8"));
    expect(Array.isArray(asset.items)).toBe(true);
    expect(Array.isArray(human.items)).toBe(true);
  });
});
