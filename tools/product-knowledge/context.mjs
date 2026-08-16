#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GRAPH_PATH,
  METADATA_PATH,
  assertArtifactCurrent,
  productGraphArtifacts,
} from "./export.mjs";
import {
  CONTRACT_PATHS,
  REPO_ROOT,
  validateProductContracts,
} from "./validate.mjs";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "app",
  "are",
  "as",
  "at",
  "be",
  "before",
  "capability",
  "capabilities",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "product",
  "purpose",
  "serve",
  "serves",
  "should",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "why",
  "with",
]);

function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim();
}

function tokens(value) {
  return normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(stem);
}

function stem(token) {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function capabilitySearchText(capability) {
  return normalize(
    [
      capability.id,
      capability.name,
      capability.purpose,
      capability.playerOutcome,
      capability.currentTruth,
      capability.approvedTarget,
      ...capability.qualitativeAcceptance,
      ...capability.searchTerms,
    ].join(" "),
  );
}

function scoreCapability(query, capability) {
  const normalizedQuery = normalize(query);
  const queryTokens = tokens(query);
  const queryTokenSet = new Set(queryTokens);
  const haystack = capabilitySearchText(capability);
  const haystackTokens = new Set(tokens(haystack));
  let score = 0;
  if (normalizedQuery === normalize(capability.id)) score += 100;
  if (` ${normalizedQuery} `.includes(` ${normalize(capability.name)} `)) {
    score += 15;
  }
  for (const term of capability.searchTerms) {
    const normalizedTerm = normalize(term);
    const termTokens = tokens(term);
    if (` ${normalizedQuery} `.includes(` ${normalizedTerm} `)) {
      score += 12;
    } else if (
      termTokens.length > 1 &&
      termTokens.every((token) => queryTokenSet.has(token))
    ) {
      score += 6;
    } else if (
      termTokens.length === 1 &&
      queryTokenSet.has(termTokens[0])
    ) {
      score += 8;
    }
  }
  for (const token of queryTokens) {
    if (haystackTokens.has(token)) score += token.length >= 7 ? 5 : 3;
  }
  return score;
}

function selectCapabilities(manifest, query, explicitId, limit) {
  if (explicitId) {
    const capability = manifest.capabilities.find(
      (entry) => entry.id === explicitId,
    );
    if (!capability) throw new Error(`Unknown capability: ${explicitId}`);
    return [capability];
  }
  if (!query.trim()) return [];
  return manifest.capabilities
    .map((capability) => ({
      capability,
      score: scoreCapability(query, capability),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.capability.id.localeCompare(right.capability.id),
    )
    .slice(0, limit)
    .map((entry) => entry.capability);
}

function graphNeighborhood(graph, capabilityIds) {
  const seed = new Set(capabilityIds.map((id) => `capability:${id}`));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const firstEdges = graph.edges.filter(
    (edge) => seed.has(edge.source) || seed.has(edge.target),
  );
  const nodeIds = new Set(seed);
  for (const edge of firstEdges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  const scenarioIds = new Set(
    [...nodeIds].filter((id) => nodesById.get(id)?.type === "scenario"),
  );
  const scenarioEdges = graph.edges.filter(
    (edge) =>
      scenarioIds.has(edge.source) &&
      ["evidenced_by", "transitions_to"].includes(edge.relation),
  );
  for (const edge of scenarioEdges) {
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
  }
  const edges = [...firstEdges, ...scenarioEdges].filter(
    (edge, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.source === edge.source &&
          candidate.target === edge.target &&
          candidate.relation === edge.relation &&
          candidate.provenance === edge.provenance,
      ) === index,
  );
  return {
    nodes: [...nodeIds]
      .map((id) => nodesById.get(id))
      .filter(Boolean)
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) =>
      `${left.source}|${left.relation}|${left.target}`.localeCompare(
        `${right.source}|${right.relation}|${right.target}`,
      ),
    ),
  };
}

function ownershipFiles(neighborhood) {
  const sourceFiles = new Set(["PRODUCT.md"]);
  const contentFiles = new Set();
  const testFiles = new Set();
  for (const edge of neighborhood.edges) {
    const node = neighborhood.nodes.find(
      (candidate) => candidate.id === edge.target,
    );
    if (node?.type !== "file") continue;
    if (
      edge.relation === "verified_by" ||
      (edge.relation === "evidenced_by" && node.path.startsWith("tests/"))
    ) {
      testFiles.add(node.path);
    } else if (
      edge.relation === "specified_by" ||
      (edge.relation === "evidenced_by" && node.path.startsWith("content/"))
    ) {
      contentFiles.add(node.path);
    } else if (
      ["implemented_by", "evidenced_by", "authorised_by"].includes(
        edge.relation,
      )
    ) {
      sourceFiles.add(node.path);
    }
  }
  return {
    sourceFiles: [...sourceFiles].sort().slice(0, 30),
    contentFiles: [...contentFiles].sort().slice(0, 30),
    testFiles: [...testFiles].sort().slice(0, 30),
  };
}

function relatedCapabilities(manifest, selected) {
  const selectedIds = new Set(selected.map((entry) => entry.id));
  const ids = new Set(selected.flatMap((entry) => entry.dependencies));
  return manifest.capabilities
    .filter((entry) => ids.has(entry.id) && !selectedIds.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      purpose: entry.purpose,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function selectedScenarios(scenarios, capabilityIds) {
  const ids = new Set(capabilityIds);
  return scenarios.scenarios
    .filter((scenario) =>
      scenario.capabilities.some((capability) => ids.has(capability)),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, 10);
}

function markdown(pack) {
  const lines = [
    "# Product context",
    "",
    `**Task:** ${pack.query || "(explicit capability lookup)"}`,
    "",
    "## App purpose",
    "",
    pack.product.promise,
    "",
    `**Primary purpose:** ${pack.product.primaryPurpose}`,
    "",
    `**North star:** ${pack.product.northStar}`,
  ];

  for (const capability of pack.capabilities) {
    lines.push(
      "",
      `## ${capability.name} (\`${capability.id}\`)`,
      "",
      `**Purpose:** ${capability.purpose}`,
      "",
      `**Player outcome:** ${capability.playerOutcome}`,
      "",
      "**Qualitative acceptance:**",
      ...capability.qualitativeAcceptance.map((item) => `- ${item}`),
      "",
      `**Current truth:** ${capability.currentTruth}`,
      "",
      `**Approved target:** ${capability.approvedTarget}`,
      "",
      `**Lifecycle:** ${capability.lifecycle.current} → ${capability.lifecycle.target}`,
      "",
      `**Advancement gate:** ${capability.lifecycle.advancementGate}`,
      "",
      `**Semantic events:** ${capability.semanticEvents.map((event) => `\`${event}\``).join(", ")}`,
    );
  }

  if (pack.scenarios.length > 0) {
    lines.push("", "## Relevant scenarios");
    for (const scenario of pack.scenarios) {
      lines.push(
        "",
        `### ${scenario.id}`,
        `- Actor: ${scenario.actor}`,
        `- Trigger: ${scenario.trigger}`,
        `- Player job: ${scenario.playerJob}`,
        `- Intended outcome: ${scenario.intendedOutcome}`,
        `- Current: ${scenario.currentBehavior}`,
        `- Target: ${scenario.targetBehavior}`,
      );
    }
  }

  if (pack.relatedCapabilities.length > 0) {
    lines.push("", "## Capability dependencies");
    for (const capability of pack.relatedCapabilities) {
      lines.push(`- \`${capability.id}\`: ${capability.purpose}`);
    }
  }

  if (pack.principles.length > 0) {
    lines.push("", "## Relevant product principles");
    for (const principle of pack.principles) {
      lines.push(`- **${principle.label}:** ${principle.text}`);
    }
  }

  lines.push("", "## Owned implementation");
  for (const file of pack.sourceFiles) lines.push(`- Source: \`${file}\``);
  for (const file of pack.contentFiles) lines.push(`- Content: \`${file}\``);
  for (const file of pack.testFiles) lines.push(`- Test: \`${file}\``);

  lines.push("", "## Product-wide boundaries");
  for (const boundary of pack.product.hardBoundaries) {
    lines.push(`- ${boundary}`);
  }
  lines.push("", "## Open decisions — do not guess");
  for (const decision of pack.product.openDecisions) {
    lines.push(`- ${decision}`);
  }

  return `${lines.join("\n")}\n`;
}

export function assertContextArtifactsCurrent(
  root,
  graphText,
  metadataText,
) {
  const artifacts = productGraphArtifacts(root);
  assertArtifactCurrent(graphText, artifacts.graphText, GRAPH_PATH);
  assertArtifactCurrent(metadataText, artifacts.metadataText, METADATA_PATH);
}

export function compileProductContext({
  root = REPO_ROOT,
  query = "",
  capabilityId = null,
  maxCapabilities = 3,
} = {}) {
  const validation = validateProductContracts(root);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join("\n"));
  }
  const graphText = readFileSync(path.join(root, GRAPH_PATH), "utf8");
  const metadataText = readFileSync(path.join(root, METADATA_PATH), "utf8");
  assertContextArtifactsCurrent(root, graphText, metadataText);
  const graph = JSON.parse(graphText);
  const manifest = validation.data.capabilities;
  const scenarios = validation.data.scenarios;
  const selected = selectCapabilities(
    manifest,
    query,
    capabilityId,
    maxCapabilities,
  );
  const capabilityIds = selected.map((entry) => entry.id);
  const neighborhood = graphNeighborhood(graph, capabilityIds);
  const files = ownershipFiles(neighborhood);
  const pack = {
    query,
    capabilityIds,
    product: manifest.product,
    capabilities: selected,
    scenarios: selectedScenarios(scenarios, capabilityIds),
    relatedCapabilities: relatedCapabilities(manifest, selected),
    principles: neighborhood.nodes
      .filter((node) => node.type === "principle")
      .map((node) => ({ id: node.id, label: node.label, text: node.text }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    nodeIds: neighborhood.nodes.map((node) => node.id),
    graphEdges: neighborhood.edges,
    ...files,
  };
  pack.text = markdown(pack);
  return pack;
}

function parseArgs(argv) {
  let capabilityId = null;
  let json = false;
  const query = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--capability") {
      capabilityId = argv[++index] ?? null;
    } else if (arg === "--json") {
      json = true;
    } else {
      query.push(arg);
    }
  }
  return { capabilityId, json, query: query.join(" ").trim() };
}

function isMain() {
  return (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMain()) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const pack = compileProductContext(args);
    if (args.json) console.log(JSON.stringify(pack, null, 2));
    else console.log(pack.text);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
