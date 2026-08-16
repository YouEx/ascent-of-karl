import { describe, expect, it } from "vitest";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GRAPH_PATH,
  METADATA_PATH,
  assertArtifactCurrent,
  productGraphArtifacts,
} from "../tools/product-knowledge/export.mjs";
import {
  collectCodeFiles,
  importsIn,
} from "../tools/product-knowledge/relations.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("deterministic product graph", () => {
  it("matches the committed generated artifacts byte for byte", () => {
    const artifacts = productGraphArtifacts(ROOT);
    expect(readFileSync(join(ROOT, GRAPH_PATH), "utf8")).toBe(
      artifacts.graphText,
    );
    expect(readFileSync(join(ROOT, METADATA_PATH), "utf8")).toBe(
      artifacts.metadataText,
    );
  });

  it("is deterministic across independent builds", () => {
    expect(productGraphArtifacts(ROOT).graphText).toBe(
      productGraphArtifacts(ROOT).graphText,
    );
  });

  it("has no dangling edges, absolute paths or duplicate node ids", () => {
    const { graph } = productGraphArtifacts(ROOT);
    const ids = graph.nodes.map((node: { id: string }) => node.id);
    const idSet = new Set(ids);
    expect(idSet.size).toBe(ids.length);
    expect(
      graph.edges.filter(
        (edge: { source: string; target: string }) =>
          !idSet.has(edge.source) || !idSet.has(edge.target),
      ),
    ).toEqual([]);
    expect(JSON.stringify(graph)).not.toMatch(/\/Users\/|[A-Za-z]:\\/);
  });

  it("connects every capability to product, implementation, tests and accessibility", () => {
    const { graph } = productGraphArtifacts(ROOT);
    const capabilities = graph.nodes.filter(
      (node: { type: string }) => node.type === "capability",
    );
    expect(capabilities).toHaveLength(12);
    for (const capability of capabilities) {
      const outgoing = graph.edges.filter(
        (edge: { source: string }) => edge.source === capability.id,
      );
      const incoming = graph.edges.filter(
        (edge: { target: string }) => edge.target === capability.id,
      );
      expect(
        graph.edges.some(
          (edge: { source: string; target: string; relation: string }) =>
            edge.source === "product:carl" &&
            edge.target === capability.id &&
            edge.relation === "serves",
        ),
        `${capability.id}: product edge`,
      ).toBe(true);
      expect(
        outgoing.some(
          (edge: { relation: string }) => edge.relation === "implemented_by",
        ),
        `${capability.id}: implementation`,
      ).toBe(true);
      expect(
        outgoing.some(
          (edge: { relation: string }) => edge.relation === "verified_by",
        ),
        `${capability.id}: tests`,
      ).toBe(true);
      expect(
        incoming.some(
          (edge: { source: string; relation: string }) =>
            edge.source === "principle:accessibility" &&
            edge.relation === "gates_completion",
        ),
        `${capability.id}: accessibility gate`,
      ).toBe(true);
    }
  });

  it("preserves transitions declared from either adjacent-scenario direction", () => {
    const { graph } = productGraphArtifacts(ROOT);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "scenario:attempt.no-fuse" &&
          edge.target === "scenario:attempt.invention-rejected" &&
          edge.relation === "transitions_to",
      ),
    ).toBe(true);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "scenario:need.active" &&
          edge.target === "scenario:progress.age-up-blocked" &&
          edge.relation === "transitions_to",
      ),
    ).toBe(true);
  });

  it("proves the generated-artifact drift gate can fail", () => {
    expect(() =>
      assertArtifactCurrent("old\n", "new\n", GRAPH_PATH),
    ).toThrow(`${GRAPH_PATH} is stale; run npm run product:graph`);
  });

  it("finds formatted dynamic imports through the TypeScript AST", () => {
    expect(
      importsIn(
        'const module = await import( /* deliberate formatting */ "../tools/judge/capture.mjs" );',
        "fixture.ts",
      ),
    ).toEqual(["../tools/judge/capture.mjs"]);
    const { graph } = productGraphArtifacts(ROOT);
    expect(
      graph.edges.some(
        (edge) =>
          edge.source === "file:tests/judge-registry.test.ts" &&
          edge.target === "file:tools/judge/capture.mjs" &&
          edge.relation === "imports",
      ),
    ).toBe(true);
  });

  it("does not follow directory symlinks outside the scanned repository", () => {
    const scratch = join(
      ROOT,
      ".judge",
      "test-scratch",
      "product-graph-symlink",
    );
    const scanRoot = join(scratch, "repo");
    const outside = join(scratch, "outside");
    try {
      rmSync(scratch, { recursive: true, force: true });
      mkdirSync(join(scanRoot, "src"), { recursive: true });
      mkdirSync(outside, { recursive: true });
      writeFileSync(join(scanRoot, "src", "inside.ts"), "export const ok = 1;");
      writeFileSync(join(outside, "outside.ts"), "export const secret = 1;");
      symlinkSync(outside, join(scanRoot, "src", "linked"), "dir");

      expect(
        collectCodeFiles(scanRoot).map((file) =>
          file.slice(scanRoot.length + 1),
        ),
      ).toEqual(["src/inside.ts"]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
