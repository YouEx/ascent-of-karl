import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertContextArtifactsCurrent,
  compileProductContext,
} from "../tools/product-knowledge/context.mjs";
import { checkKnownAnswers } from "../tools/product-knowledge/known-answers.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("purpose-first agent product context", () => {
  it("returns the explicit capability without heuristic ambiguity", () => {
    const pack = compileProductContext({ capabilityId: "sandbox.invention" });
    expect(pack.capabilityIds).toEqual(["sandbox.invention"]);
    expect(pack.text).toContain("## Invention (`sandbox.invention`)");
    expect(pack.text).toContain("**Current truth:**");
    expect(pack.text).toContain("**Approved target:**");
    expect(pack.text).toContain("**Advancement gate:**");
  });

  it("maps natural language to a bounded capability set", () => {
    const pack = compileProductContext({
      query: "How can AI inventions solve needs without becoming historical canon?",
    });
    expect(pack.capabilityIds).toContain("sandbox.invention");
    expect(pack.capabilityIds.length).toBeLessThanOrEqual(3);
    expect(pack.nodeIds).toContain("principle:generated-gameplay");
    expect(pack.nodeIds).toContain("principle:history");
  });

  it("matches short search terms on token boundaries, not inside unrelated words", () => {
    const pack = compileProductContext({
      query:
        "How should narrator guidance, combining, and browser saves be maintained?",
    });
    expect(pack.capabilityIds).toContain("narrator.react");
    expect(pack.capabilityIds).toContain("craft.combine");
    expect(pack.capabilityIds).toContain("platform.cross-device");
    expect(pack.capabilityIds).not.toContain("sandbox.invention");
  });

  it("keeps file output bounded and correctly categorised", () => {
    const pack = compileProductContext({ capabilityId: "sandbox.invention" });
    expect(pack.sourceFiles.length).toBeLessThanOrEqual(30);
    expect(pack.contentFiles.length).toBeLessThanOrEqual(30);
    expect(pack.testFiles.length).toBeLessThanOrEqual(30);
    expect(pack.sourceFiles).not.toContain("tests/improvise-engine.test.ts");
    expect(pack.testFiles).toContain("tests/improvise-engine.test.ts");
    expect(pack.contentFiles).toContain("content/taxonomy.json");
  });

  it("always includes app purpose, boundaries and unresolved decisions", () => {
    const pack = compileProductContext({ capabilityId: "life.begin" });
    expect(pack.text).toContain("## App purpose");
    expect(pack.text).toContain("## Relevant product principles");
    expect(pack.text).toContain("Equivalent information and action channels");
    expect(pack.text).toContain("## Product-wide boundaries");
    expect(pack.text).toContain(
      "Implementation may proceed across approved targets",
    );
    expect(pack.text).toContain("## Open decisions — do not guess");
    expect(pack.text).toContain("Monetisation model.");
  });

  it("refuses to compile against stale graph or metadata artifacts", () => {
    const graph = readFileSync(
      join(ROOT, "docs/product/generated/product-graph.json"),
      "utf8",
    );
    const metadata = readFileSync(
      join(ROOT, "docs/product/generated/product-graph.metadata.json"),
      "utf8",
    );
    expect(() =>
      assertContextArtifactsCurrent(ROOT, `${graph}\n`, metadata),
    ).toThrow("product-graph.json is stale");
    expect(() =>
      assertContextArtifactsCurrent(ROOT, graph, `${metadata}\n`),
    ).toThrow("product-graph.metadata.json is stale");
  });

  it("answers all versioned load-bearing questions", () => {
    expect(checkKnownAnswers()).toEqual([]);
  });
});
