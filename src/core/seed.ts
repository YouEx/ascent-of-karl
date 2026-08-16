import type { ContentBundle, LifeVariationDef } from "./types";

export interface LifePlan {
  seedVersion: 1;
  seed: number;
  seedCode: string;
  contentRevision: string;
  openingId: string;
  startingElementIds: string[];
  sidequestIds: string[];
  challengeIds: string[];
}

export interface LegacyLifePlan {
  seedVersion: 0;
  seed: number;
  seedCode: string;
  contentRevision: string;
  openingId: "legacy-all-base";
  startingElementIds: string[];
  sidequestIds: string[];
  challengeIds: string[];
}

export type StoredLifePlan = LifePlan | LegacyLifePlan;

export function hash32(...parts: readonly (string | number)[]): number {
  let hash = 2166136261;
  for (const part of parts) {
    const text = String(part);
    for (let index = 0; index < text.length; index++) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0x9e3779b9;
  }
  return hash >>> 0;
}

export function hash01(...parts: readonly (string | number)[]): number {
  return hash32(...parts) / 4294967296;
}

function seedHex(seed: number): string {
  return (seed >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

export function encodeSeed(seed: number, contentRevision: string): string {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error("Life seed must be an unsigned 32-bit integer");
  }
  if (!/^[0-9a-f]{16}$/i.test(contentRevision)) {
    throw new Error("Content revision must be 16 hexadecimal characters");
  }
  return `K1.${contentRevision.toUpperCase()}.${seedHex(seed)}`;
}

export function decodeSeed(code: string): {
  seed: number;
  contentRevision: string;
} {
  const match = /^K1\.([0-9A-F]{16})\.([0-9A-F]{8})$/.exec(code);
  if (!match) throw new Error("Invalid Karl life seed");
  return {
    contentRevision: match[1]!.toLowerCase(),
    seed: Number.parseInt(match[2]!, 16) >>> 0,
  };
}

export function randomSeed(
  randomValues: (array: Uint32Array) => Uint32Array = (array) =>
    crypto.getRandomValues(array),
): number {
  return randomValues(new Uint32Array(1))[0]!;
}

function rankedIds(
  seed: number,
  namespace: string,
  ids: readonly string[],
  count: number,
): string[] {
  if (!Number.isInteger(count) || count < 0 || count > ids.length) {
    throw new Error(`${namespace}: invalid selection count ${count}`);
  }
  return [...ids]
    .sort((left, right) => {
      const score =
        hash32(seed, namespace, left) - hash32(seed, namespace, right);
      return score || left.localeCompare(right);
    })
    .slice(0, count)
    .sort();
}

export function deriveLifePlan(
  variation: LifeVariationDef,
  contentRevision: string,
  seed: number,
): LifePlan {
  if (variation.openings.length === 0) {
    throw new Error("Life variation needs at least one opening");
  }
  const opening = [...variation.openings].sort((left, right) => {
    const score =
      hash32(seed, "opening", left.id) - hash32(seed, "opening", right.id);
    return score || left.id.localeCompare(right.id);
  })[0]!;
  return {
    seedVersion: 1,
    seed: seed >>> 0,
    seedCode: encodeSeed(seed, contentRevision),
    contentRevision,
    openingId: opening.id,
    startingElementIds: [...opening.elementIds],
    sidequestIds: rankedIds(
      seed,
      "sidequest",
      variation.sidequestIds,
      variation.sidequestsPerLife,
    ),
    challengeIds: rankedIds(
      seed,
      "challenge",
      variation.challengeIds,
      variation.challengesPerLife,
    ),
  };
}

export function legacyLifePlan(
  content: ContentBundle,
  seed: number,
): LegacyLifePlan {
  const firstAct = Math.min(...content.acts.map((act) => act.act));
  return {
    seedVersion: 0,
    seed: seed >>> 0,
    seedCode: `LEGACY.${seedHex(seed)}`,
    contentRevision:
      content.completionManifest?.contentRevision ?? "0000000000000000",
    openingId: "legacy-all-base",
    startingElementIds: content.elements
      .filter((element) => element.base && element.act === firstAct)
      .map((element) => element.id)
      .sort(),
    sidequestIds: content.lifeVariation?.sidequestIds.slice().sort() ?? [],
    challengeIds:
      content.lifeVariation?.challengeIds.slice().sort() ??
      content.challenges.map((entry) => entry.id).sort(),
  };
}
