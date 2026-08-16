#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  addEdge,
  addNode,
  makeEdge,
  makeNode,
  repoPath,
  scanImportGraph,
  sha256,
  slug,
} from "./relations.mjs";
import { stableJson } from "./schema.mjs";
import {
  CONTRACT_PATHS,
  REPO_ROOT,
  SCHEMA_PATHS,
  validateProductContracts,
} from "./validate.mjs";

export const GRAPH_PATH = "docs/product/generated/product-graph.json";
export const METADATA_PATH =
  "docs/product/generated/product-graph.metadata.json";

const INPUT_PATHS = Object.freeze([
  "PRODUCT.md",
  CONTRACT_PATHS.capabilities,
  CONTRACT_PATHS.scenarios,
  CONTRACT_PATHS.relations,
  SCHEMA_PATHS.capabilities,
  SCHEMA_PATHS.scenarios,
  SCHEMA_PATHS.relations,
  "tools/product-knowledge/schema.mjs",
  "tools/product-knowledge/validate.mjs",
  "tools/product-knowledge/relations.mjs",
  "tools/product-knowledge/export.mjs",
]);

function fileNodeId(file) {
  return `file:${file}`;
}

function capabilityNodeId(id) {
  return `capability:${id}`;
}

function scenarioNodeId(id) {
  return `scenario:${id}`;
}

function eventNodeId(id) {
  return `event:${id}`;
}

function lifecycleNodeId(id) {
  return `lifecycle:${id}`;
}

function addFileNode(nodeMap, root, file, role = "source") {
  const resolved = path.resolve(root, file);
  const relative = repoPath(root, resolved);
  addNode(
    nodeMap,
    makeNode(fileNodeId(relative), "file", relative, {
      path: relative,
    }),
  );
  return fileNodeId(relative);
}

function buildGraph(root, data) {
  const nodeMap = new Map();
  const edgeMap = new Map();
  const { capabilities: manifest, scenarios, relations } = data;

  addNode(
    nodeMap,
    makeNode("product:carl", "product", manifest.product.name, {
      authority: manifest.authority,
      promise: manifest.product.promise,
      primaryPurpose: manifest.product.primaryPurpose,
      northStar: manifest.product.northStar,
      completionDefinition: manifest.product.completionDefinition,
      currentArchitecture: manifest.product.currentArchitecture,
      targetArchitecture: manifest.product.targetArchitecture,
    }),
  );
  addFileNode(nodeMap, root, "PRODUCT.md", "authority");
  addEdge(
    edgeMap,
    makeEdge(
      "product:carl",
      fileNodeId("PRODUCT.md"),
      "authorised_by",
      "CONTRACT",
    ),
  );

  for (const [key, text] of Object.entries(manifest.product.crossCutting)) {
    const id = `principle:${slug(key)}`;
    addNode(nodeMap, makeNode(id, "principle", key, { text }));
    addEdge(
      edgeMap,
      makeEdge("product:carl", id, "has_principle", "CONTRACT"),
    );
  }
  manifest.product.hardBoundaries.forEach((text, index) => {
    const id = `boundary:${String(index + 1).padStart(2, "0")}-${slug(text)}`;
    addNode(nodeMap, makeNode(id, "hard-boundary", text, { text }));
    addEdge(
      edgeMap,
      makeEdge("product:carl", id, "has_boundary", "CONTRACT"),
    );
  });
  manifest.product.openDecisions.forEach((text, index) => {
    const id = `decision:${String(index + 1).padStart(2, "0")}-${slug(text)}`;
    addNode(nodeMap, makeNode(id, "open-decision", text, { text }));
    addEdge(
      edgeMap,
      makeEdge("product:carl", id, "has_open_decision", "CONTRACT"),
    );
  });

  for (const state of manifest.lifecycleStates) {
    addNode(nodeMap, makeNode(lifecycleNodeId(state), "lifecycle", state));
  }

  for (const capability of manifest.capabilities) {
    const id = capabilityNodeId(capability.id);
    addNode(
      nodeMap,
      makeNode(id, "capability", capability.name, {
        capabilityId: capability.id,
        purpose: capability.purpose,
        playerOutcome: capability.playerOutcome,
        currentTruth: capability.currentTruth,
        approvedTarget: capability.approvedTarget,
        qualitativeAcceptance: capability.qualitativeAcceptance,
        lifecycle: capability.lifecycle,
        searchTerms: capability.searchTerms,
      }),
    );
    addEdge(
      edgeMap,
      makeEdge("product:carl", id, "serves", "CONTRACT"),
    );
    addEdge(
      edgeMap,
      makeEdge(
        id,
        lifecycleNodeId(capability.lifecycle.current),
        "current_lifecycle",
        "CONTRACT",
      ),
    );
    addEdge(
      edgeMap,
      makeEdge(
        id,
        lifecycleNodeId(capability.lifecycle.target),
        "target_lifecycle",
        "CONTRACT",
        { gate: capability.lifecycle.advancementGate },
      ),
    );
    for (const dependency of capability.dependencies) {
      addEdge(
        edgeMap,
        makeEdge(id, capabilityNodeId(dependency), "depends_on", "CONTRACT"),
      );
    }
    for (const event of capability.semanticEvents) {
      const eventId = eventNodeId(event);
      addNode(nodeMap, makeNode(eventId, "semantic-event", event, { event }));
      addEdge(edgeMap, makeEdge(id, eventId, "emits", "CONTRACT"));
    }
    for (const file of capability.ownershipHints.sourceEntrypoints) {
      const fileId = addFileNode(nodeMap, root, file, "source");
      addEdge(edgeMap, makeEdge(id, fileId, "implemented_by", "CONTRACT"));
    }
    for (const file of capability.ownershipHints.contentEntrypoints) {
      const fileId = addFileNode(nodeMap, root, file, "content");
      addEdge(edgeMap, makeEdge(id, fileId, "specified_by", "CONTRACT"));
    }
    for (const file of capability.ownershipHints.testEntrypoints) {
      const fileId = addFileNode(nodeMap, root, file, "test");
      addEdge(edgeMap, makeEdge(id, fileId, "verified_by", "CONTRACT"));
    }
    addEdge(
      edgeMap,
      makeEdge(
        "principle:accessibility",
        id,
        "gates_completion",
        "CONTRACT",
      ),
    );
  }

  for (const scenario of scenarios.scenarios) {
    const id = scenarioNodeId(scenario.id);
    addNode(
      nodeMap,
      makeNode(id, "scenario", scenario.id, {
        scenarioId: scenario.id,
        actor: scenario.actor,
        trigger: scenario.trigger,
        playerJob: scenario.playerJob,
        intendedOutcome: scenario.intendedOutcome,
        primaryAction: scenario.primaryAction,
        currentBehavior: scenario.currentBehavior,
        targetBehavior: scenario.targetBehavior,
      }),
    );
    for (const capability of scenario.capabilities) {
      addEdge(
        edgeMap,
        makeEdge(
          capabilityNodeId(capability),
          id,
          "has_scenario",
          "CONTRACT",
        ),
      );
    }
    addEdge(
      edgeMap,
      makeEdge(id, eventNodeId(scenario.semanticEvent), "emits", "CONTRACT"),
    );
    for (const adjacent of scenario.adjacentScenarios.next) {
      addEdge(
        edgeMap,
        makeEdge(id, scenarioNodeId(adjacent), "transitions_to", "CONTRACT"),
      );
    }
    for (const adjacent of scenario.adjacentScenarios.previous) {
      addEdge(
        edgeMap,
        makeEdge(scenarioNodeId(adjacent), id, "transitions_to", "CONTRACT"),
      );
    }
    for (const file of scenario.evidenceSources) {
      const fileId = addFileNode(nodeMap, root, file, "evidence");
      addEdge(edgeMap, makeEdge(id, fileId, "evidenced_by", "CONTRACT"));
    }
  }

  const imports = scanImportGraph(root);
  for (const file of imports.files) addFileNode(nodeMap, root, file, "source");
  for (const edge of imports.edges) {
    addFileNode(nodeMap, root, edge.source, "source");
    addFileNode(nodeMap, root, edge.target, "source");
    addEdge(
      edgeMap,
      makeEdge(
        fileNodeId(edge.source),
        fileNodeId(edge.target),
        "imports",
        "SOURCE",
        { specifier: edge.specifier },
      ),
    );
  }

  for (const edge of relations.edges) {
    addEdge(
      edgeMap,
      makeEdge(
        edge.source,
        edge.target,
        edge.relation,
        edge.provenance,
        { rationale: edge.rationale },
      ),
    );
  }

  for (const edge of edgeMap.values()) {
    if (!nodeMap.has(edge.source)) {
      throw new Error(`edge has missing source ${edge.source}`);
    }
    if (!nodeMap.has(edge.target)) {
      throw new Error(`edge has missing target ${edge.target}`);
    }
  }

  return {
    schemaVersion: 1,
    directed: true,
    authority: "PRODUCT.md",
    nodes: [...nodeMap.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edgeMap.values()].sort((a, b) => {
      const left = `${a.source}|${a.relation}|${a.target}|${a.provenance}`;
      const right = `${b.source}|${b.relation}|${b.target}|${b.provenance}`;
      return left.localeCompare(right);
    }),
  };
}

function inputDigests(root) {
  return Object.fromEntries(
    INPUT_PATHS.map((file) => [
      file,
      sha256(readFileSync(path.join(root, file), "utf8")),
    ]),
  );
}

function buildMetadata(root, graph, graphText) {
  const provenance = {};
  for (const edge of graph.edges) {
    provenance[edge.provenance] = (provenance[edge.provenance] ?? 0) + 1;
  }
  return {
    schemaVersion: 1,
    generatorVersion: 1,
    authority: "PRODUCT.md",
    graphPath: GRAPH_PATH,
    graphSha256: sha256(graphText),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    capabilityCount: graph.nodes.filter((node) => node.type === "capability")
      .length,
    scenarioCount: graph.nodes.filter((node) => node.type === "scenario").length,
    provenanceCounts: provenance,
    inputSha256: inputDigests(root),
    semanticEnrichment: {
      authoritative: false,
      path: "graphify-out/graph.json",
      status: "manual-optional"
    }
  };
}

export function productGraphArtifacts(root = REPO_ROOT) {
  const validation = validateProductContracts(root);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors.join("\n"));
  }
  const graph = buildGraph(root, validation.data);
  const graphText = stableJson(graph);
  const metadataText = stableJson(buildMetadata(root, graph, graphText));
  return { graph, graphText, metadataText };
}

function checkFile(root, relative, expected) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) {
    throw new Error(`${relative} is missing; run npm run product:graph`);
  }
  const actual = readFileSync(absolute, "utf8");
  assertArtifactCurrent(actual, expected, relative);
}

export function assertArtifactCurrent(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} is stale; run npm run product:graph`);
  }
}

export function writeProductGraph(root = REPO_ROOT) {
  const artifacts = productGraphArtifacts(root);
  mkdirSync(path.dirname(path.join(root, GRAPH_PATH)), { recursive: true });
  writeFileSync(path.join(root, GRAPH_PATH), artifacts.graphText, "utf8");
  writeFileSync(path.join(root, METADATA_PATH), artifacts.metadataText, "utf8");
  return artifacts;
}

function isMain() {
  return (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  );
}

if (isMain()) {
  try {
    const artifacts = productGraphArtifacts();
    if (process.argv.includes("--check")) {
      checkFile(REPO_ROOT, GRAPH_PATH, artifacts.graphText);
      checkFile(REPO_ROOT, METADATA_PATH, artifacts.metadataText);
      console.log(
        `Product graph current: ${artifacts.graph.nodes.length} nodes, ` +
          `${artifacts.graph.edges.length} edges`,
      );
    } else {
      writeProductGraph();
      console.log(
        `Product graph written: ${artifacts.graph.nodes.length} nodes, ` +
          `${artifacts.graph.edges.length} edges`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
