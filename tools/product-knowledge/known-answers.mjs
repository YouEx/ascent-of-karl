#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileProductContext } from "./context.mjs";
import { REPO_ROOT, validateProductContracts } from "./validate.mjs";

function missing(expected, actual) {
  const actualSet = new Set(actual);
  return expected.filter((entry) => !actualSet.has(entry));
}

export function checkKnownAnswers(root = REPO_ROOT) {
  const validation = validateProductContracts(root);
  if (validation.errors.length > 0) return validation.errors;
  const errors = [];
  for (const fixture of validation.data.knownAnswers.queries) {
    const pack = compileProductContext({
      root,
      query: fixture.question,
      maxCapabilities: 4,
    });
    for (const capability of missing(
      fixture.expectedCapabilities,
      pack.capabilityIds,
    )) {
      errors.push(`${fixture.id}: missing capability ${capability}`);
    }
    for (const node of missing(fixture.requiredNodes, pack.nodeIds)) {
      errors.push(`${fixture.id}: missing graph node ${node}`);
    }
    const sourcePool = [
      ...pack.sourceFiles,
      ...pack.contentFiles,
      ...pack.testFiles,
    ];
    for (const source of missing(fixture.requiredSources, sourcePool)) {
      errors.push(`${fixture.id}: missing source ${source}`);
    }
    const text = pack.text.toLowerCase();
    for (const term of fixture.requiredTerms) {
      if (!text.includes(term.toLowerCase())) {
        errors.push(`${fixture.id}: missing term ${JSON.stringify(term)}`);
      }
    }
  }
  return errors;
}

function isMain() {
  return (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMain()) {
  const validation = validateProductContracts();
  const errors = checkKnownAnswers();
  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Known product answers valid: ${validation.data.knownAnswers.queries.length} queries`,
    );
  }
}
