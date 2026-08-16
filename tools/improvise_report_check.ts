import {
  reportDigest,
  stableReportJson,
  type ImproviseBalanceReport,
} from "./improvise_report";

/** Opdateres kun sammen med den byte-identiske committed artefakt. */
export const COMMITTED_IMPROVISE_REPORT_HASH = "fnv1a32:247a53b4";

export function checkReportArtifact(_options: {
  artifactText: string;
  regenerated: ImproviseBalanceReport;
  expectedHash: string;
  productionCap: number;
  productionCost: number;
}): string[] {
  const failures: string[] = [];
  const regeneratedText = stableReportJson(_options.regenerated);
  if (_options.artifactText !== regeneratedText) {
    failures.push("committed report artifact is stale: byte comparison failed");
  }
  const actualHash = reportDigest(_options.regenerated);
  if (actualHash !== _options.expectedHash) {
    failures.push(
      `committed report hash drift: expected ${_options.expectedHash}, got ${actualHash}`,
    );
  }
  const selected = _options.regenerated.selection.recommended;
  if (!selected || selected.runCap === null) {
    failures.push("robust report selected no production-safe finite cap");
    return failures;
  }
  const selectedComparison = _options.regenerated.configurations.find(
    (comparison) => comparison.configuration.id === selected.id,
  );
  if (!selectedComparison?.robust.passed) {
    failures.push("selected configuration does not pass robust criteria");
  }
  if (
    selected.runCap !== _options.productionCap ||
    selected.summerCost !== _options.productionCost
  ) {
    failures.push(
      `production default drift: report selected cost ${selected.summerCost}, cap ${selected.runCap}; production has cost ${_options.productionCost}, cap ${_options.productionCap}`,
    );
  }
  return failures;
}
