import { readFileSync } from "node:fs";
import { IMPROVISE_RUN_CAP, IMPROVISE_SUMMER_COST } from "../src/core/improvise";
import { buildImproviseBalanceReport } from "./improvise_report";
import {
  checkReportArtifact,
  COMMITTED_IMPROVISE_REPORT_HASH,
} from "./improvise_report_check";

const artifact = readFileSync(
  new URL("../docs/design/improvisation-balance-results.json", import.meta.url),
  "utf8",
);
const regenerated = buildImproviseBalanceReport();
const failures = checkReportArtifact({
  artifactText: artifact,
  regenerated,
  expectedHash: COMMITTED_IMPROVISE_REPORT_HASH,
  productionCap: IMPROVISE_RUN_CAP,
  productionCost: IMPROVISE_SUMMER_COST,
});

if (failures.length > 0) {
  for (const failure of failures) console.error(`❌ ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `✅ Improvisationsrapport ${COMMITTED_IMPROVISE_REPORT_HASH} matcher artefakt, robust selection og produkt-defaults.`,
  );
}
