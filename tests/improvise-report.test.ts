import { describe, expect, it } from "vitest";
import {
  DEFAULT_BALANCE_THRESHOLDS,
  buildImproviseBalanceReport,
  reportDigest,
  stableReportJson,
  type ImproviseBalanceConfiguration,
} from "../tools/improvise_report";

const capped: ImproviseBalanceConfiguration = {
  id: "test-one-summer-cap-2",
  label: "1 summer, cap 2",
  summerCost: 1,
  runCap: 2,
};

describe("improvisationens balancerapport", () => {
  it("bruger de samme seeds på begge sider af hver kausal sammenligning", () => {
    const report = buildImproviseBalanceReport({
      runsPerMode: 16,
      configurations: [capped],
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
    });
    const second = buildImproviseBalanceReport({
      runsPerMode: 24,
      configurations: [capped],
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
    });
    const safety = report.configurations[0]!.safety;

    expect(
      report.configurations[0]!.improvisation.summersUsed.mean,
    ).toBeLessThan(report.configurations[0]!.baseline.summersUsed.mean);
    expect(safety.passed).toBe(false);
    expect(safety.failures.length).toBeGreaterThan(0);
    expect(
      safety.failures.some((failure) =>
        /canonical|credited|required|fate/i.test(failure),
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
