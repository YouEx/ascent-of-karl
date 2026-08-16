import { describe, expect, it } from "vitest";
import { loadContent } from "../src/content";
import { Engine } from "../src/core/engine";
import {
  deriveGeneratedCandidateSet,
} from "../src/core/generated-candidates";
import {
  applyGeneratedPresentation,
  validateGeneratedGameplayProposal,
} from "../src/core/generated-validator";

const content = loadContent();

function engineWith(ids: string[]) {
  const engine = new Engine(content);
  engine.loadState({
    ...engine.getState(),
    discovered: [...new Set([...engine.getState().discovered, ...ids])],
  });
  return engine;
}

describe("bounded generated gameplay", () => {
  it("derives at most four stable candidates from authoritative parents", () => {
    const engine = engineWith(["baer", "ler"]);
    const candidates = deriveGeneratedCandidateSet(
      engine.element("baer"),
      engine.element("ler"),
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(4);
    expect(candidates.map((entry) => entry.candidateKey)).toEqual(
      deriveGeneratedCandidateSet(
        engine.element("baer"),
        engine.element("ler"),
      ).map((entry) => entry.candidateKey),
    );
    for (const candidate of candidates) {
      expect(candidate.element).not.toHaveProperty("note");
      expect(candidate.element).not.toHaveProperty("sourceUrl");
      expect(candidate.element).not.toHaveProperty("ending");
      expect(candidate.element).not.toHaveProperty("setsFlags");
    }
  });

  it("rejects extra fields, unknown candidates, and invalid presentation", () => {
    const engine = engineWith(["baer", "ler"]);
    const a = engine.element("baer");
    const b = engine.element("ler");
    expect(
      validateGeneratedGameplayProposal(
        {
          schemaVersion: 1,
          candidateKey: "missing",
          presentationKey: "plain",
        },
        a,
        b,
      ),
    ).toEqual({ ok: false, reason: "candidateKey was not offered" });
    expect(
      validateGeneratedGameplayProposal(
        {
          schemaVersion: 1,
          candidateKey: deriveGeneratedCandidateSet(a, b)[0]!.candidateKey,
          presentationKey: "plain",
          ending: "king-karl",
        },
        a,
        b,
      ),
    ).toEqual({ ok: false, reason: "proposal has unexpected fields" });
  });

  it("does not consume a turn for invalid model protocol", () => {
    const engine = engineWith(["baer", "ler"]);
    const before = engine.getState();
    expect(() =>
      engine.attemptGenerated("baer", "ler", {
        schemaVersion: 1,
        candidateKey: "not-offered",
        presentationKey: "plain",
      }),
    ).toThrow("Invalid generated gameplay proposal");
    expect(engine.getState()).toEqual(before);
  });

  it("uses a valid selected candidate but keeps deterministic rights", () => {
    const engine = engineWith(["baer", "ler"]);
    const candidate = deriveGeneratedCandidateSet(
      engine.element("baer"),
      engine.element("ler"),
    )[0]!;
    const outcome = engine.attemptGenerated("baer", "ler", {
      schemaVersion: 1,
      candidateKey: candidate.candidateKey,
      presentationKey: "dry-pride",
    });
    expect(outcome.kind).toBe("improvised");
    if (outcome.kind !== "improvised") return;
    expect(outcome.element.name.startsWith("Karl's ")).toBe(true);
    expect(outcome.element.generatedOperation).toBe(candidate.operation);
    expect(outcome.element.origin).toBe("improvised");
    expect(outcome.element).not.toHaveProperty("note");
  });

  it("presentation changes copy only", () => {
    const engine = engineWith(["baer", "ler"]);
    const candidate = deriveGeneratedCandidateSet(
      engine.element("baer"),
      engine.element("ler"),
    )[0]!;
    const plain = applyGeneratedPresentation(candidate, "plain");
    const regret = applyGeneratedPresentation(candidate, "quiet-regret");
    expect(regret.name).not.toBe(plain.name);
    expect({
      ...regret,
      name: plain.name,
    }).toEqual(plain);
  });
});
