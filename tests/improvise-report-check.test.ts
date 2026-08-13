import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { IMPROVISE_RUN_CAP, IMPROVISE_SUMMER_COST } from "../src/core/improvise";
import {
  buildImproviseBalanceReport,
  reportDigest,
  SEED_SCHEDULES,
  stableReportJson,
} from "../tools/improvise_report";
import { checkReportArtifact } from "../tools/improvise_report_check";

function reportForCheck() {
  return buildImproviseBalanceReport({
    runsPerMode: 16,
    configurations: [
      {
        id: "one-summer-cap-1",
        label: "1 summer / cap 1",
        summerCost: 1,
        runCap: 1,
      },
    ],
    seedSchedules: SEED_SCHEDULES.slice(0, 1),
  });
}

describe("improvisationens committed rapport-check", () => {
  it("afviser en stale artefakt byte-for-byte", () => {
    const report = reportForCheck();
    const failures = checkReportArtifact({
      artifactText: "{}\n",
      regenerated: report,
      expectedHash: reportDigest(report),
      productionCap: IMPROVISE_RUN_CAP,
      productionCost: IMPROVISE_SUMMER_COST,
    });

    expect(failures.some((failure) => /stale|byte/i.test(failure))).toBe(true);
  });

  it("afviser drift mellem valgt konfiguration og produkt-default", () => {
    const report = reportForCheck();
    const selected = report.selection.recommended;
    expect(selected).not.toBeNull();
    if (!selected?.runCap) return;
    const failures = checkReportArtifact({
      artifactText: stableReportJson(report),
      regenerated: report,
      expectedHash: reportDigest(report),
      productionCap: selected.runCap + 1,
      productionCost: selected.summerCost,
    });

    expect(failures.some((failure) => /production|default|drift/i.test(failure))).toBe(true);
  });

  it("består kun når bytes, hash, robust selection og defaults er enige", () => {
    const report = reportForCheck();
    const selected = report.selection.recommended;
    expect(selected?.runCap).toBe(1);
    if (!selected?.runCap) return;

    expect(
      checkReportArtifact({
        artifactText: stableReportJson(report),
        regenerated: report,
        expectedHash: reportDigest(report),
        productionCap: selected.runCap,
        productionCost: selected.summerCost,
      }),
    ).toEqual([]);
  });

  it("er wired ind i det eksisterende test-and-build-job uden nyt Actions-job", () => {
    const root = resolve(fileURLToPath(import.meta.url), "../..");
    const pkg = JSON.parse(
      readFileSync(resolve(root, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    const ci = readFileSync(
      resolve(root, ".github/workflows/ci.yml"),
      "utf8",
    );
    const jobsBlock = ci.slice(ci.indexOf("\njobs:"));
    const jobs = [...jobsBlock.matchAll(/^  ([a-z][a-z0-9-]+):$/gm)].map(
      (match) => match[1],
    );

    const script = pkg.scripts["improvise:report:check"];
    expect(typeof script).toBe("string");
    expect(script ?? "").toContain("improvise_report_check_cli.ts");
    expect(ci).toMatch(
      /test-and-build:[\s\S]*npm run improvise:report:check/,
    );
    expect(jobs).toEqual([
      "validate-content",
      "test-and-build",
      "worker-typecheck",
      "ux-audit",
    ]);
  });
});
