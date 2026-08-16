import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  IMPROVISE_RUN_CAP,
  IMPROVISE_SUMMER_COST,
} from "../src/core/improvise";
import { COMMITTED_IMPROVISE_REPORT_HASH } from "../tools/improvise_report_check";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const PLAN = "plan/feature-improvised-solutions-1.md";
const EVIDENCE =
  "docs/playtest/task-030-improvisation-agent-qa-2026-08-13/README.md";
const BALANCE = "docs/design/improvisation-balance.md";

function taskLine(plan: string, id: string): string {
  return plan.split("\n").find((line) => line.startsWith(`| ${id} |`)) ?? "";
}

function expectExactHumanGate(path: string): void {
  const text = read(path);
  expect(text, path).toMatch(/5[–-]10/);
  expect(text, path).toMatch(/engelsktalende|English-speaking/i);
  expect(text, path).toMatch(/crafting-game/i);
  expect(text, path).toMatch(/low-game[- ]experience/i);
  expect(text, path).toMatch(
    /uden forklaring|without explanation|explanation-free/i,
  );
}

describe("improvisationens dokumentationskontrakt", () => {
  it("har en terminal source-status uden at lukke human acceptance", () => {
    const plan = read(PLAN);
    expect(plan).toContain(
      "status: 'Source complete — external playtest pending'",
    );
    expect(plan).not.toMatch(/^status: 'In progress'$/m);
    expect(taskLine(plan, "TASK-029")).toMatch(
      /\| ✅ \| 2026-08-13 \|$/,
    );
    expect(taskLine(plan, "TASK-030")).toContain(
      "Agent-QA ✅ / Human ☐",
    );
    expect(taskLine(plan, "TASK-030")).toContain(
      "task-030-improvisation-agent-qa-2026-08-13/",
    );
    expect(taskLine(plan, "TASK-031")).toMatch(
      /\| ✅ \| 2026-08-14 \|$/,
    );
  });

  it("holder production-root off og kun offline-preview on indtil den præcise gate", () => {
    const deploy = read(".github/workflows/deploy.yml");
    const pagesBuild = read("tools/build_pages.mjs");
    expect(deploy).toContain("run: npm run build:pages");
    expect(deploy.indexOf("run: npm run build:pages")).toBeLessThan(
      deploy.indexOf("uses: actions/upload-pages-artifact@v3"),
    );
    expect(pagesBuild).toContain('VITE_IMPROVISE_ENABLED: enabled ? "true" : "false"');
    expect(pagesBuild).toContain('VITE_IMPROVISE_URL: ""');
    expect(pagesBuild).toContain('VITE_NARRATOR_URL: ""');
    expect(pagesBuild).toContain("dist/playtest/improvisation");

    for (const path of [
      "PRD.md",
      "README.md",
      "ROADMAP.md",
      PLAN,
      BALANCE,
      "docs/design/fortaelleren.md",
      "docs/deployment/live-narrator.md",
      EVIDENCE,
    ]) {
      expectExactHumanGate(path);
    }

    for (const path of ["PRD.md", "README.md", "ROADMAP.md", PLAN]) {
      const text = read(path);
      expect(text, path).toMatch(/production-root|offentlige root/i);
      expect(text, path).toMatch(/feature-off|featuret slukket/i);
      expect(text, path).toMatch(/playtest|preview/i);
      expect(text, path).toMatch(/Worker-URL|Worker-URL'erne/i);
    }
  });

  it("binder docs til den valgte cap, pris og reproducerbarhedshash", () => {
    expect(IMPROVISE_RUN_CAP).toBe(6);
    expect(IMPROVISE_SUMMER_COST).toBe(1);
    expect(COMMITTED_IMPROVISE_REPORT_HASH).toBe("fnv1a32:247a53b4");

    const artifact = JSON.parse(
      read("docs/design/improvisation-balance-results.json"),
    );
    expect(artifact.selection.recommended).toMatchObject({
      id: "one-summer-cap-6",
      runCap: IMPROVISE_RUN_CAP,
      summerCost: IMPROVISE_SUMMER_COST,
    });

    for (const path of ["PRD.md", BALANCE, EVIDENCE]) {
      const text = read(path);
      expect(text, path).toContain("fnv1a32:247a53b4");
      expect(text, path).toMatch(/cap 6|højst \*\*6|at most 6/i);
      expect(text, path).toMatch(/one summer|én sommer|1 summer/i);
    }
  });

  it("krydshenviser balance og agentbevis uden at gøre QA til human evidens", () => {
    expect(read(BALANCE)).toContain(
      "../playtest/task-030-improvisation-agent-qa-2026-08-13/README.md",
    );
    expect(read(EVIDENCE)).toContain(
      "../../design/improvisation-balance.md",
    );
    expect(read(EVIDENCE)).toMatch(
      /agent QA|agent-QA[\s\S]*not external-human evidence/i,
    );

    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["playtest:evidence:check"]).toContain(
      "task-030-improvisation-agent-qa-2026-08-13/verify-evidence.mjs",
    );
  });

  it("bevarer source-complete harvest som review-only uden fabrikeret output", () => {
    const plan = read(PLAN);
    expect(plan).toContain("tools/predicate_report.py");
    expect(plan).toContain("DEP-001 — resolved");
    expect(plan).toContain("DEP-002 — optional runtime");
    expect(plan).toContain("tests/improvisation-docs.test.ts");
    expect(existsSync(resolve(ROOT, "content/drafts/harvested.json"))).toBe(
      false,
    );
    const runbook = read("docs/deployment/live-narrator.md");
    expect(runbook).toContain(
      "en deployet Worker, et\nadmin-token og rigtig trafik",
    );
  });
});
