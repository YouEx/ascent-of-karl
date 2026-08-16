#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateSchema } from "./schema.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../..");

export const CONTRACT_PATHS = Object.freeze({
  capabilities: "docs/product/capabilities.json",
  scenarios: "docs/product/scenarios.json",
  relations: "docs/product/product-graph-relations.json",
  knownAnswers: "docs/product/context-known-answers.json",
});

export const SCHEMA_PATHS = Object.freeze({
  capabilities: "docs/product/schema/capabilities.schema.json",
  scenarios: "docs/product/schema/scenarios.schema.json",
  relations: "docs/product/schema/relations.schema.json",
  knownAnswers: "docs/product/schema/known-answers.schema.json",
});

const EXPECTED_LIFECYCLE = Object.freeze([
  "proposed",
  "approved-target",
  "implementing",
  "playtest",
  "production",
  "retired",
]);

function readJson(root, relative) {
  return JSON.parse(readFileSync(path.join(root, relative), "utf8"));
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function kebab(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function checkFiles(root, files, owner, errors) {
  for (const file of files) {
    const resolved = path.resolve(root, file);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      errors.push(`${owner}: path escapes repository: ${file}`);
      continue;
    }
    if (!existsSync(resolved)) errors.push(`${owner}: file does not exist: ${file}`);
  }
}

function checkDependencyCycles(capabilities, errors) {
  const byId = new Map(capabilities.map((capability) => [capability.id, capability]));
  const visiting = new Set();
  const visited = new Set();

  function visit(id, trail) {
    if (visiting.has(id)) {
      errors.push(`capability dependency cycle: ${[...trail, id].join(" -> ")}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const capability = byId.get(id);
    for (const dependency of capability?.dependencies ?? []) {
      visit(dependency, [...trail, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const id of byId.keys()) visit(id, []);
}

function normalizeMarkdownText(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function parseProductCapabilitySections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = new Map();
  let current = null;
  for (const line of lines) {
    const heading = /^### (?:\d+\. )?(.+)$/.exec(line);
    if (heading) {
      current = { name: heading[1], lines: [] };
      sections.set(current.name, current);
      continue;
    }
    if (current && /^## /.test(line)) current = null;
    else if (current) current.lines.push(line);
  }
  return sections;
}

function productField(section, label) {
  const prefix = `**${label}:**`;
  const index = section.lines.findIndex((line) => line.startsWith(prefix));
  if (index === -1) return null;
  const value = [section.lines[index].slice(prefix.length).trim()];
  for (let line = index + 1; line < section.lines.length; line++) {
    const next = section.lines[line];
    if (!next.trim() || next.startsWith("**") || next.startsWith("- ")) break;
    value.push(next.trim());
  }
  return normalizeMarkdownText(value.join(" "));
}

function productListField(section, label) {
  const prefix = `**${label}:**`;
  const index = section.lines.findIndex((line) => line.startsWith(prefix));
  if (index === -1) return null;
  const values = [];
  for (let line = index + 1; line < section.lines.length; line++) {
    const next = section.lines[line];
    if (!next.trim()) continue;
    if (!next.startsWith("- ")) break;
    values.push(normalizeMarkdownText(next.slice(2)));
  }
  return values;
}

function validateAuthority(root, manifest, errors) {
  const product = readFileSync(path.join(root, manifest.authority), "utf8");
  const normalizedProduct = product
    .replace(/^>\s?/gm, "")
    .replace(/\s+/g, " ");
  for (const anchor of manifest.product.authorityAnchors) {
    if (!normalizedProduct.includes(anchor.replace(/\s+/g, " "))) {
      errors.push(`PRODUCT.md is missing authority anchor: ${anchor}`);
    }
  }
  const sections = parseProductCapabilitySections(product);
  for (const capability of manifest.capabilities) {
    const section = sections.get(capability.name);
    if (!section) {
      errors.push(
        `PRODUCT.md is missing capability heading for ${capability.name}`,
      );
      continue;
    }
    const expectedFields = [
      ["Purpose", capability.purpose],
      ["Player outcome", capability.playerOutcome],
      ["Current truth", capability.currentTruth],
      ["Approved target", capability.approvedTarget],
      [
        "Lifecycle",
        `${capability.lifecycle.current} → ${capability.lifecycle.target}`,
      ],
      ["Advancement gate", capability.lifecycle.advancementGate],
    ];
    for (const [label, expected] of expectedFields) {
      const actual = productField(section, label);
      if (actual === null) {
        errors.push(
          `PRODUCT.md ${capability.name}: missing **${label}:** field`,
        );
      } else if (actual !== normalizeMarkdownText(expected)) {
        errors.push(
          `PRODUCT.md ${capability.name}: ${label} differs from capability contract ` +
            `(doc=${JSON.stringify(actual)}, contract=${JSON.stringify(normalizeMarkdownText(expected))})`,
        );
      }
    }
    const acceptance = productListField(section, "Qualitative acceptance");
    if (acceptance === null) {
      errors.push(
        `PRODUCT.md ${capability.name}: missing **Qualitative acceptance:** field`,
      );
    } else if (
      JSON.stringify(acceptance) !==
      JSON.stringify(capability.qualitativeAcceptance.map(normalizeMarkdownText))
    ) {
      errors.push(
        `PRODUCT.md ${capability.name}: Qualitative acceptance differs from capability contract`,
      );
    }
  }
}

function validateCrossContracts(root, data, errors) {
  const { capabilities: manifest, scenarios, relations, knownAnswers } = data;
  const capabilities = manifest.capabilities;
  const capabilityIds = new Set(capabilities.map((entry) => entry.id));
  const scenarioIds = new Set(scenarios.scenarios.map((entry) => entry.id));
  const allEvents = new Map();

  for (const duplicate of duplicates(capabilities.map((entry) => entry.id))) {
    errors.push(`duplicate capability id: ${duplicate}`);
  }
  for (const duplicate of duplicates(scenarios.scenarios.map((entry) => entry.id))) {
    errors.push(`duplicate scenario id: ${duplicate}`);
  }
  if (
    JSON.stringify(manifest.lifecycleStates) !==
    JSON.stringify(EXPECTED_LIFECYCLE)
  ) {
    errors.push(
      `lifecycleStates must equal ${JSON.stringify(EXPECTED_LIFECYCLE)}`,
    );
  }

  for (const capability of capabilities) {
    for (const dependency of capability.dependencies) {
      if (!capabilityIds.has(dependency)) {
        errors.push(`${capability.id}: unknown dependency ${dependency}`);
      }
      if (dependency === capability.id) {
        errors.push(`${capability.id}: capability cannot depend on itself`);
      }
    }
    for (const event of capability.semanticEvents) {
      const existing = allEvents.get(event);
      if (existing) {
        errors.push(
          `${capability.id}: semantic event ${event} already owned by ${existing}`,
        );
      } else {
        allEvents.set(event, capability.id);
      }
    }
    checkFiles(
      root,
      [
        ...capability.ownershipHints.sourceEntrypoints,
        ...capability.ownershipHints.contentEntrypoints,
        ...capability.ownershipHints.testEntrypoints,
      ],
      capability.id,
      errors,
    );
  }
  checkDependencyCycles(capabilities, errors);

  const coveredCapabilities = new Set();
  for (const scenario of scenarios.scenarios) {
    for (const capabilityId of scenario.capabilities) {
      if (!capabilityIds.has(capabilityId)) {
        errors.push(`${scenario.id}: unknown capability ${capabilityId}`);
      } else {
        coveredCapabilities.add(capabilityId);
      }
    }
    for (const adjacent of [
      ...scenario.adjacentScenarios.previous,
      ...scenario.adjacentScenarios.next,
    ]) {
      if (!scenarioIds.has(adjacent)) {
        errors.push(`${scenario.id}: unknown adjacent scenario ${adjacent}`);
      }
    }
    const eventOwners = scenario.capabilities.filter((capabilityId) =>
      manifest.capabilities
        .find((entry) => entry.id === capabilityId)
        ?.semanticEvents.includes(scenario.semanticEvent),
    );
    if (eventOwners.length === 0) {
      errors.push(
        `${scenario.id}: semantic event ${scenario.semanticEvent} is not owned by a linked capability`,
      );
    }
    checkFiles(root, scenario.evidenceSources, scenario.id, errors);
  }
  for (const capabilityId of capabilityIds) {
    if (!coveredCapabilities.has(capabilityId)) {
      errors.push(`${capabilityId}: no ambiguous-state scenario references capability`);
    }
  }

  const allowedNodeIds = new Set([
    "product:carl",
    ...capabilities.map((entry) => `capability:${entry.id}`),
    ...scenarios.scenarios.map((entry) => `scenario:${entry.id}`),
    ...Object.keys(manifest.product.crossCutting).map(
      (key) => `principle:${kebab(key)}`,
    ),
  ]);
  const relationSignatures = new Set();
  for (const edge of relations.edges) {
    if (!allowedNodeIds.has(edge.source)) {
      errors.push(`curated relation has unknown source ${edge.source}`);
    }
    if (!allowedNodeIds.has(edge.target)) {
      errors.push(`curated relation has unknown target ${edge.target}`);
    }
    if (edge.source === edge.target) {
      errors.push(`curated relation is a self-loop: ${edge.source}`);
    }
    const signature = `${edge.source}|${edge.relation}|${edge.target}`;
    if (relationSignatures.has(signature)) {
      errors.push(`duplicate curated relation ${signature}`);
    }
    relationSignatures.add(signature);
  }

  validateAuthority(root, manifest, errors);

  if (knownAnswers) {
    const knownIds = new Set();
    for (const query of knownAnswers.queries) {
      if (knownIds.has(query.id)) errors.push(`duplicate known-answer id: ${query.id}`);
      knownIds.add(query.id);
      for (const capabilityId of query.expectedCapabilities) {
        if (!capabilityIds.has(capabilityId)) {
          errors.push(`${query.id}: unknown expected capability ${capabilityId}`);
        }
      }
      checkFiles(root, query.requiredSources, query.id, errors);
    }
  }
}

export function validateProductContracts(root = REPO_ROOT) {
  const data = {};
  for (const name of ["capabilities", "scenarios", "relations"]) {
    data[name] = readJson(root, CONTRACT_PATHS[name]);
  }

  if (existsSync(path.join(root, CONTRACT_PATHS.knownAnswers))) {
    data.knownAnswers = readJson(root, CONTRACT_PATHS.knownAnswers);
  }
  return { errors: validateProductData(root, data), data };
}

export function validateProductData(root, data) {
  const errors = [];
  for (const name of ["capabilities", "scenarios", "relations"]) {
    const schema = readJson(root, SCHEMA_PATHS[name]);
    errors.push(
      ...validateSchema(data[name], schema).map(
        (error) => `${CONTRACT_PATHS[name]} ${error}`,
      ),
    );
  }
  if (data.knownAnswers) {
    const schema = readJson(root, SCHEMA_PATHS.knownAnswers);
    errors.push(
      ...validateSchema(data.knownAnswers, schema).map(
        (error) => `${CONTRACT_PATHS.knownAnswers} ${error}`,
      ),
    );
  }
  if (errors.length === 0) validateCrossContracts(root, data, errors);
  return errors;
}

function isMain() {
  return (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMain()) {
  const result = validateProductContracts();
  if (result.errors.length > 0) {
    console.error(result.errors.map((error) => `- ${error}`).join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Product contracts valid: ${result.data.capabilities.capabilities.length} capabilities, ` +
        `${result.data.scenarios.scenarios.length} scenarios, ` +
        `${result.data.relations.edges.length} curated relations`,
    );
  }
}
