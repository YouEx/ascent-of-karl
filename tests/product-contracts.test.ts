import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema } from "../tools/product-knowledge/schema.mjs";
import {
  REPO_ROOT,
  SCHEMA_PATHS,
  parseProductCapabilitySections,
  validateProductContracts,
  validateProductData,
} from "../tools/product-knowledge/validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type ContractData = ReturnType<typeof validateProductContracts>["data"];

function capability(data: ContractData, id: string) {
  const found = data.capabilities.capabilities.find((entry) => entry.id === id);
  if (!found) throw new Error(`test fixture missing capability ${id}`);
  return found;
}

describe("product truth contracts", () => {
  it("validates the committed authority, capabilities, scenarios and relations", () => {
    expect(REPO_ROOT).toBe(ROOT);
    expect(validateProductContracts(ROOT).errors).toEqual([]);
  });

  it("rejects schema keywords the local interpreter does not implement", () => {
    expect(validateSchema("value", { type: "string", format: "email" })).toEqual(
      ["$: unsupported schema keyword format"],
    );
  });

  it("rejects an additional property rather than silently accepting drift", () => {
    const schema = JSON.parse(
      readFileSync(join(ROOT, SCHEMA_PATHS.capabilities), "utf8"),
    );
    const data = clone(validateProductContracts(ROOT).data);
    Object.assign(capability(data, "life.begin"), { accidental: true });
    expect(validateSchema(data.capabilities, schema)).toContain(
      "$.capabilities[0].accidental: additional property is not allowed",
    );
  });

  it("fails on duplicate capability ids", () => {
    const data = clone(validateProductContracts(ROOT).data);
    capability(data, "craft.combine").id = capability(data, "life.begin").id;
    expect(validateProductData(ROOT, data)).toContain(
      "duplicate capability id: life.begin",
    );
  });

  it("fails on unknown dependencies and dependency cycles", () => {
    const unknown = clone(validateProductContracts(ROOT).data);
    capability(unknown, "life.begin").dependencies = ["missing.capability"];
    expect(validateProductData(ROOT, unknown)).toContain(
      "life.begin: unknown dependency missing.capability",
    );

    const cyclic = clone(validateProductContracts(ROOT).data);
    capability(cyclic, "life.begin").dependencies = ["craft.combine"];
    expect(validateProductData(ROOT, cyclic).some((error: string) =>
      error.startsWith("capability dependency cycle:"),
    )).toBe(true);
  });

  it("fails on duplicate event ownership and missing implementation evidence", () => {
    const events = clone(validateProductContracts(ROOT).data);
    capability(events, "craft.combine").semanticEvents = ["life.started"];
    expect(validateProductData(ROOT, events)).toContain(
      "craft.combine: semantic event life.started already owned by life.begin",
    );

    const files = clone(validateProductContracts(ROOT).data);
    capability(files, "life.begin").ownershipHints.sourceEntrypoints = [
      "src/does-not-exist.ts",
    ];
    expect(validateProductData(ROOT, files)).toContain(
      "life.begin: file does not exist: src/does-not-exist.ts",
    );
  });

  it("fails if the machine contract stops matching PRODUCT.md", () => {
    const data = clone(validateProductContracts(ROOT).data);
    data.capabilities.product.authorityAnchors.push(
      "This sentence is deliberately absent.",
    );
    expect(validateProductData(ROOT, data)).toContain(
      "PRODUCT.md is missing authority anchor: This sentence is deliberately absent.",
    );
  });

  it("fails when a capability's current truth contradicts PRODUCT.md", () => {
    const data = clone(validateProductContracts(ROOT).data);
    capability(data, "life.begin").currentTruth =
      "This intentionally contradicts PRODUCT.md.";
    expect(
      validateProductData(ROOT, data).some((error) =>
        error.startsWith(
          "PRODUCT.md Begin a life: Current truth differs from capability contract",
        ),
      ),
    ).toBe(true);
  });

  it("parses numbered and unnumbered capability headings identically", () => {
    const numbered = parseProductCapabilitySections(
      "### 1. Begin a life\n\n**Purpose:** Numbered",
    );
    const unnumbered = parseProductCapabilitySections(
      "### Begin a life\n\n**Purpose:** Unnumbered",
    );
    expect(numbered.has("Begin a life")).toBe(true);
    expect(unnumbered.has("Begin a life")).toBe(true);
  });
});
