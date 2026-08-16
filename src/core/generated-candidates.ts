import {
  buildFallbackElement,
  deriveTags,
  improvisedElementId,
} from "./improvise";
import type { ElementDef } from "./types";

export const GENERATED_OPERATIONS = [
  "cut",
  "heat",
  "soak",
  "bind",
  "work",
  "join",
  "hybrid",
] as const;
export type GeneratedOperation = (typeof GENERATED_OPERATIONS)[number];

export interface GeneratedCandidate {
  candidateKey: string;
  operation: GeneratedOperation;
  element: ElementDef;
}

function ordered(a: ElementDef, b: ElementDef): [ElementDef, ElementDef] {
  return a.id <= b.id ? [a, b] : [b, a];
}

function candidate(
  operation: GeneratedOperation,
  a: ElementDef,
  b: ElementDef,
): GeneratedCandidate {
  const [first, second] = ordered(a, b);
  const fallback = buildFallbackElement(a, b);
  const specialized = {
    cut: {
      name: `Cut ${second.name}`,
      flavor: `Karl applies ${first.name} to ${second.name}. It now has edges and expectations.`,
    },
    heat: {
      name: `Heated ${second.name}`,
      flavor: `Karl heats ${second.name} with ${first.name}. Temperature becomes the entire method.`,
    },
    soak: {
      name: `Soaked ${second.name}`,
      flavor: `Karl soaks ${second.name} with ${first.name}. It is different mostly by being wetter.`,
    },
    bind: {
      name: `Bound ${second.name}`,
      flavor: `Karl binds ${first.name} to ${second.name}. Separation is postponed.`,
    },
    work: {
      name: `Worked ${second.name}`,
      flavor: `Karl works ${second.name} with ${first.name}. Purpose appears after several bruises.`,
    },
    join: {
      name: `Joined ${first.name}`,
      flavor: `Karl joins ${first.name} and ${second.name}. More object is technically progress.`,
    },
    hybrid: {
      name: fallback.name,
      flavor: fallback.flavor ?? "Karl has made something. History remains cautious.",
    },
  } satisfies Record<GeneratedOperation, { name: string; flavor: string }>;
  return {
    candidateKey: `${operation}:${first.id}+${second.id}`,
    operation,
    element: {
      ...fallback,
      id: improvisedElementId(first.id, second.id),
      name: specialized[operation].name,
      flavor: specialized[operation].flavor,
      generatedOperation: operation,
      ...deriveTags(a, b),
    },
  };
}

function possibleOperations(
  a: ElementDef,
  b: ElementDef,
): GeneratedOperation[] {
  const operations: GeneratedOperation[] = [];
  const pair = [a, b];
  if (
    pair.some((element) => element.kind === "tool" && element.traits.includes("sharp")) &&
    pair.some((element) => element.kind === "creature")
  ) {
    operations.push("cut");
  }
  if (
    pair.some(
      (element) => element.stuff === "fire" || element.traits.includes("hot"),
    )
  ) {
    operations.push("heat");
  }
  if (pair.some((element) => element.stuff === "water")) {
    operations.push("soak");
  }
  if (
    pair.some(
      (element) =>
        element.stuff === "clay" ||
        element.stuff === "fibre" ||
        element.traits.includes("sticky"),
    )
  ) {
    operations.push("bind");
  }
  if (
    pair.some((element) => element.kind === "tool") &&
    pair.some((element) => element.kind === "material")
  ) {
    operations.push("work");
  }
  if (a.stuff === b.stuff && a.stuff !== "none") operations.push("join");
  operations.push("hybrid");
  return [...new Set(operations)].slice(0, 4);
}

export function deriveGeneratedCandidateSet(
  a: ElementDef,
  b: ElementDef,
): GeneratedCandidate[] {
  return possibleOperations(a, b).map((operation) => candidate(operation, a, b));
}
