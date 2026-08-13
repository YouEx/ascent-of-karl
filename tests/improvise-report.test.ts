import { describe, expect, it } from "vitest";
import {
  DEFAULT_BALANCE_THRESHOLDS,
  buildImproviseBalanceReport,
  humanReport,
  reportDigest,
  stableReportJson,
  type ImproviseBalanceConfiguration,
} from "../tools/improvise_report";
import * as reportModule from "../tools/improvise_report";

const capped: ImproviseBalanceConfiguration = {
  id: "test-one-summer-cap-2",
  label: "1 summer, cap 2",
  summerCost: 1,
  runCap: 2,
};

describe("improvisationens balancerapport", () => {
  it("afleder hvert heltalsloft 1…det samme runs observerede no-cap-maksimum", () => {
    const buildCandidates = (
      reportModule as typeof reportModule & {
        buildCapCandidateConfigurations?: (
          observedNoCapMax: number,
        ) => ImproviseBalanceConfiguration[];
      }
    ).buildCapCandidateConfigurations;
    expect(typeof buildCandidates).toBe("function");
    if (!buildCandidates) return;
    const candidates = buildCandidates(19);
    const caps = candidates
      .filter((entry) => entry.summerCost === 1 && entry.runCap !== null)
      .map((entry) => entry.runCap);

    expect(caps).toEqual(Array.from({ length: 19 }, (_, index) => index + 1));
    expect(candidates.map((entry) => entry.id)).toContain(
      "one-summer-no-cap",
    );
  });

  it("fryser tre seed-planer og robuste grænser med guard band før målingen", () => {
    const schedules = (
      reportModule as typeof reportModule & {
        SEED_SCHEDULES?: Array<{ id: string }>;
      }
    ).SEED_SCHEDULES;
    const robust = (
      reportModule as typeof reportModule & {
        ROBUST_BALANCE_THRESHOLDS?: Record<string, number>;
        GRAY_GOO_CANONICAL_RATIO?: number;
      }
    );

    expect(schedules?.map((entry) => entry.id)).toEqual([
      "linear-7919",
      "linear-104729",
      "multiplicative-32",
    ]);
    expect(robust.ROBUST_BALANCE_THRESHOLDS).toEqual({
      maxFateRateIncreasePoints: 1.5,
      maxAllRequiredRateIncreasePoints: 4,
      minCanonicalDiscoveryRetention: 0.96,
      maxMeanPositiveCanonicalDisplacement: 0.8,
      maxImprovisedCreditedShare: 0.18,
      maxImprovisedRequiredSolveShare: 0.18,
    });
    expect(robust.GRAY_GOO_CANONICAL_RATIO).toBe(0.2);
  });

  it("replayer den eksakt samme handlingssekvens i baseline og treatment", () => {
    const traceMatchedActions = (
      reportModule as typeof reportModule & {
        traceMatchedActions?: (options: {
          seed: number;
          configuration: ImproviseBalanceConfiguration;
        }) => { plan: string[]; baseline: string[]; improvisation: string[] };
      }
    ).traceMatchedActions;
    expect(typeof traceMatchedActions).toBe("function");
    if (!traceMatchedActions) return;

    const trace = traceMatchedActions({ seed: 13, configuration: capped });
    expect(trace.plan).toHaveLength(50);
    expect(trace.baseline).toEqual(
      trace.plan.slice(0, trace.baseline.length),
    );
    expect(trace.improvisation).toEqual(
      trace.plan.slice(0, trace.improvisation.length),
    );
  });

  it("vælger aldrig no-cap eller et gray-goo-loft, selv når punktestimatet består", () => {
    const selectRecommendedConfiguration = (
      reportModule as typeof reportModule & {
        selectRecommendedConfiguration?: (
          candidates: Array<{
            configuration: ImproviseBalanceConfiguration;
            schedulePasses: boolean[];
            grayGooPasses: boolean[];
          }>,
        ) => ImproviseBalanceConfiguration | null;
      }
    ).selectRecommendedConfiguration;
    expect(typeof selectRecommendedConfiguration).toBe("function");
    if (!selectRecommendedConfiguration) return;

    const selected = selectRecommendedConfiguration([
      {
        configuration: {
          id: "one-summer-cap-3",
          label: "cap 3",
          summerCost: 1,
          runCap: 3,
        },
        schedulePasses: [true, true, true],
        grayGooPasses: [true, true, true],
      },
      {
        configuration: {
          id: "one-summer-cap-16",
          label: "cap 16",
          summerCost: 1,
          runCap: 16,
        },
        schedulePasses: [true, true, true],
        grayGooPasses: [false, false, false],
      },
      {
        configuration: {
          id: "one-summer-no-cap",
          label: "no cap",
          summerCost: 1,
          runCap: null,
        },
        schedulePasses: [true, true, true],
        grayGooPasses: [true, true, true],
      },
    ]);

    expect(selected?.runCap).toBe(3);
  });

  it("rapporterer robusthed pr. seed-plan og en maskinlæsbar selection", () => {
    const build = buildImproviseBalanceReport as unknown as (options: {
      runsPerMode: number;
      configurations: ImproviseBalanceConfiguration[];
      seedSchedules: Array<{ id: string; formula: string; seedFor(index: number): number }>;
    }) => {
      methodology: { seedSchedules?: Array<{ id: string }> };
      configurations: Array<{
        schedules?: Array<{
          scheduleId: string;
          safety: { passed: boolean };
          grayGoo: { limit: number; observedP95: number; passed: boolean };
        }>;
        robust?: { passed: boolean };
      }>;
      selection?: {
        recommended: ImproviseBalanceConfiguration | null;
        rule: string;
      };
    };
    const report = build({
      runsPerMode: 8,
      configurations: [
        { id: "one-summer-cap-1", label: "cap 1", summerCost: 1, runCap: 1 },
        { id: "one-summer-cap-2", label: "cap 2", summerCost: 1, runCap: 2 },
      ],
      seedSchedules: reportModule.SEED_SCHEDULES.slice(0, 2),
    });

    expect(report.methodology.seedSchedules?.map((entry) => entry.id)).toEqual([
      "linear-7919",
      "linear-104729",
    ]);
    expect(report.configurations[0]?.schedules).toHaveLength(2);
    for (const schedule of report.configurations[0]?.schedules ?? []) {
      expect(schedule.grayGoo.limit).toBeGreaterThanOrEqual(0);
      expect(schedule.grayGoo.observedP95).toBeGreaterThanOrEqual(0);
    }
    expect(typeof report.configurations[0]?.robust?.passed).toBe("boolean");
    expect(report.selection?.rule).toContain("every schedule");
  });

  it("printer robust verdict og den valgte konfiguration i menneskeoutputtet", () => {
    const report = buildImproviseBalanceReport({
      runsPerMode: 8,
      configurations: [
        { id: "one-summer-cap-1", label: "cap 1", summerCost: 1, runCap: 1 },
      ],
      seedSchedules: reportModule.SEED_SCHEDULES.slice(0, 1),
    });
    const output = humanReport(report);

    expect(output).toContain("ROBUST");
    expect(output).toContain("selected: one-summer-cap-1");
  });

  it("serialiserer en kompakt artefakt uden gentaget baseline pr. kandidat", () => {
    const report = buildImproviseBalanceReport({
      runsPerMode: 8,
      configurations: [
        { id: "one-summer-cap-1", label: "cap 1", summerCost: 1, runCap: 1 },
        { id: "one-summer-cap-2", label: "cap 2", summerCost: 1, runCap: 2 },
      ],
      seedSchedules: reportModule.SEED_SCHEDULES.slice(0, 2),
    });
    const artifact = JSON.parse(stableReportJson(report)) as {
      baseline?: unknown;
      configurations: Array<{
        baseline?: unknown;
        schedules: Array<{ baseline?: unknown; improvisation?: unknown }>;
      }>;
    };

    expect(artifact.baseline).toBeDefined();
    expect(artifact.configurations.every((entry) => !entry.baseline)).toBe(true);
    expect(
      artifact.configurations
        .flatMap((entry) => entry.schedules)
        .every((entry) => !entry.baseline && !entry.improvisation),
    ).toBe(true);
  });

  it("bruger de samme seeds på begge sider af hver kausal sammenligning", () => {
    const report = buildImproviseBalanceReport({
      runsPerMode: 16,
      configurations: [capped],
      seedSchedules: reportModule.SEED_SCHEDULES.slice(0, 1),
    });
    const comparison = report.configurations[0]!;

    expect(comparison.baseline.runs).toBe(16);
    expect(comparison.improvisation.runs).toBe(16);
    expect(comparison.baseline.seedDigest).toBe(
      comparison.improvisation.seedDigest,
    );
    expect(comparison.matchedPairs).toBe(16);
  });

  it("giver identisk JSON og hash for samme input", () => {
    const first = buildImproviseBalanceReport({
      runsPerMode: 24,
      configurations: [capped],
      seedSchedules: reportModule.SEED_SCHEDULES.slice(0, 1),
    });
    const second = buildImproviseBalanceReport({
      runsPerMode: 24,
      configurations: [capped],
      seedSchedules: reportModule.SEED_SCHEDULES.slice(0, 1),
    });

    expect(stableReportJson(first)).toBe(stableReportJson(second));
    expect(reportDigest(first)).toBe(reportDigest(second));
  }, 15_000);

  it("dømmer en bevidst overpowered no-cap-konfiguration ude", () => {
    const overpowered: ImproviseBalanceConfiguration = {
      id: "test-overpowered-no-cap",
      label: "Overpowered: zero-summer, no cap",
      summerCost: 0,
      runCap: null,
    };
    const report = buildImproviseBalanceReport({
      runsPerMode: 128,
      configurations: [overpowered],
      seedSchedules: reportModule.SEED_SCHEDULES.slice(0, 1),
    });
    const safety = report.configurations[0]!.safety;

    expect(
      report.configurations[0]!.improvisation.summersUsed.mean,
    ).toBeLessThan(report.configurations[0]!.baseline.summersUsed.mean);
    expect(safety.passed).toBe(false);
    expect(safety.failures.length).toBeGreaterThan(0);
    expect(
      safety.failures.some((failure) =>
        /cost|canonical|credited|required|fate/i.test(failure),
      ),
    ).toBe(true);
  }, 30_000);

  it("fryser tærsklerne som maskinlæsbar metode før resultatet", () => {
    expect(DEFAULT_BALANCE_THRESHOLDS).toEqual({
      maxFateRateIncreasePoints: 2,
      maxAllRequiredRateIncreasePoints: 5,
      minCanonicalDiscoveryRetention: 0.95,
      maxMeanPositiveCanonicalDisplacement: 1,
      maxImprovisedCreditedShare: 0.2,
      maxImprovisedRequiredSolveShare: 0.2,
    });
  });
});
