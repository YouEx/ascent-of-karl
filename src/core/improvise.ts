import type {
  ElementDef,
  ElementKind,
  ElementScale,
  ElementStuff,
  ElementTrait,
} from "./types";

export const MAX_IMPROVISED_DEPTH = 3;

/** Den eneste del et valgfrit copy-lag må ændre. */
export interface ImproviseCopy {
  name: string;
  flavor: string;
}

export const IMPROVISE_COPY_LIMITS = {
  nameChars: 48,
  nameWords: 3,
  flavorChars: 240,
} as const;

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const MARKUP_CHARS = /[<>]/;
const QUOTES = /["'`“”‘’«»]/;
const URL =
  /(?:https?:\/\/|www\.|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z]{2,}(?:\/\S*)?)/i;
const PUNCTUATION_WILDERNESS = /[!?.,;:—–-]{3,}/;
const UNSAFE_PUNCTUATION = /[{}\[\]<>\\|@#$%^*_+=~\/]/;
const SAFE_NAME = /^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u;
const SAFE_FLAVOR = /^[\p{L}\p{N}\p{Zs}.,!?;:()—–-]+$/u;
const SAVED_COPY_LIMITS = {
  name: 160,
  emoji: 32,
  flavor: 1000,
} as const;

function safeCommon(value: string): boolean {
  return (
    value === value.trim() &&
    !CONTROL_CHARS.test(value) &&
    !QUOTES.test(value) &&
    !URL.test(value) &&
    !PUNCTUATION_WILDERNESS.test(value) &&
    !UNSAFE_PUNCTUATION.test(value)
  );
}

/** Samme eksakte copy-kontrakt som browseren accepterer fra Workeren. */
export function validateImproviseCopy(
  raw: unknown,
): ImproviseCopy | undefined {
  if (!isRecord(raw) || Array.isArray(raw)) return undefined;
  const keys = Object.keys(raw).sort();
  if (keys.length !== 2 || keys[0] !== "flavor" || keys[1] !== "name") {
    return undefined;
  }
  if (typeof raw.name !== "string" || typeof raw.flavor !== "string") {
    return undefined;
  }
  const { name, flavor } = raw;
  if (
    name.length === 0 ||
    name.length > IMPROVISE_COPY_LIMITS.nameChars ||
    name.split(/\s+/).length > IMPROVISE_COPY_LIMITS.nameWords ||
    !SAFE_NAME.test(name) ||
    !safeCommon(name)
  ) {
    return undefined;
  }
  if (
    flavor.length === 0 ||
    flavor.length > IMPROVISE_COPY_LIMITS.flavorChars ||
    !SAFE_FLAVOR.test(flavor) ||
    !safeCommon(flavor)
  ) {
    return undefined;
  }
  return { name, flavor };
}

const TRAIT_ORDER: readonly ElementTrait[] = [
  "hard",
  "soft",
  "sharp",
  "blunt",
  "hot",
  "cold",
  "wet",
  "dry",
  "alive",
  "dead",
  "edible",
  "heavy",
  "light",
  "fragile",
  "sticky",
  "insulating",
  "tame",
  "weapon",
  "vessel",
  "digs",
  "healing",
  "sacred",
  "floats",
  "loud",
  "portable",
];

const SCALE_ORDER: readonly ElementScale[] = [
  "hand",
  "body",
  "camp",
  "landscape",
];

const KIND_PRIORITY: readonly ElementKind[] = [
  "abstract",
  "phenomenon",
  "material",
  "creature",
  "person",
  "food",
  "tool",
  "structure",
];

const STUFF_PRIORITY: readonly ElementStuff[] = [
  "none",
  "fire",
  "water",
  "plant",
  "flesh",
  "fibre",
  "clay",
  "bone",
  "wood",
  "stone",
  "metal",
];

function orderedParents(a: ElementDef, b: ElementDef): [ElementDef, ElementDef] {
  return a.id <= b.id ? [a, b] : [b, a];
}

export function improvisedElementId(a: string, b: string): string {
  const first = a <= b ? a : b;
  const second = first === a ? b : a;
  return `improv:${first.length}:${first}:${second.length}:${second}`;
}

function rolePair(
  a: ElementDef,
  b: ElementDef,
  predicate: (candidate: ElementDef) => boolean,
): [ElementDef, ElementDef] | null {
  if (predicate(a) && !predicate(b)) return [a, b];
  if (predicate(b) && !predicate(a)) return [b, a];
  return null;
}

function sharpCreaturePair(
  a: ElementDef,
  b: ElementDef,
): { tool: ElementDef; creature: ElementDef } | null {
  if (a.kind === "tool" && a.traits.includes("sharp") && b.kind === "creature") {
    return { tool: a, creature: b };
  }
  if (b.kind === "tool" && b.traits.includes("sharp") && a.kind === "creature") {
    return { tool: b, creature: a };
  }
  return null;
}

function toolMaterialPair(
  a: ElementDef,
  b: ElementDef,
): { tool: ElementDef; material: ElementDef } | null {
  if (a.kind === "tool" && b.kind === "material") {
    return { tool: a, material: b };
  }
  if (b.kind === "tool" && a.kind === "material") {
    return { tool: b, material: a };
  }
  return null;
}

function maxScale(a: ElementScale, b: ElementScale): ElementScale {
  return SCALE_ORDER[Math.max(SCALE_ORDER.indexOf(a), SCALE_ORDER.indexOf(b))]!;
}

function higherPriority<T extends string>(
  a: T,
  b: T,
  order: readonly T[],
): T {
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

function replaceTraits(
  target: Set<ElementTrait>,
  ...sources: readonly ElementTrait[][]
): void {
  target.clear();
  for (const source of sources) {
    for (const trait of source) target.add(trait);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAllowed<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isSafeSavedText(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= maxLength &&
    !CONTROL_CHARS.test(value) &&
    !MARKUP_CHARS.test(value)
  );
}

/**
 * Untrusted save-data bliver kun til et runtime-element, hvis hele den
 * deterministiske kontrakt holder. Content-afhængige parent/depth-kontroller
 * sker bagefter i Engine.loadState().
 */
export function sanitizeImprovisedElement(value: unknown): ElementDef | null {
  if (!isRecord(value) || value.origin !== "improvised") return null;
  if (
    typeof value.id !== "string" ||
    !isSafeSavedText(value.name, SAVED_COPY_LIMITS.name) ||
    !isSafeSavedText(value.emoji, SAVED_COPY_LIMITS.emoji, true) ||
    !Number.isInteger(value.act) ||
    (value.act as number) < 1 ||
    !Number.isInteger(value.depth) ||
    (value.depth as number) < 1 ||
    (value.depth as number) > MAX_IMPROVISED_DEPTH ||
    value.base === true
  ) {
    return null;
  }
  if (
    !Array.isArray(value.parents) ||
    value.parents.length !== 2 ||
    !value.parents.every(
      (parent) => typeof parent === "string" && parent.length > 0,
    )
  ) {
    return null;
  }
  const [rawA, rawB] = value.parents as string[];
  if (
    !rawA ||
    !rawB ||
    rawA === rawB ||
    value.id !== improvisedElementId(rawA, rawB)
  ) {
    return null;
  }
  if (
    !isAllowed(value.kind, KIND_PRIORITY) ||
    !isAllowed(value.stuff, STUFF_PRIORITY) ||
    !isAllowed(value.scale, SCALE_ORDER) ||
    !Array.isArray(value.traits) ||
    value.traits.length === 0 ||
    !value.traits.every((trait) => isAllowed(trait, TRAIT_ORDER)) ||
    (value.flavor !== undefined &&
      !isSafeSavedText(value.flavor, SAVED_COPY_LIMITS.flavor))
  ) {
    return null;
  }

  const first = rawA <= rawB ? rawA : rawB;
  const second = first === rawA ? rawB : rawA;
  const traits = new Set(value.traits as ElementTrait[]);
  return {
    id: value.id,
    origin: "improvised",
    parents: [first, second],
    name: value.name,
    emoji: value.emoji,
    act: value.act as number,
    base: false,
    depth: value.depth as number,
    terminal: value.depth === MAX_IMPROVISED_DEPTH,
    kind: value.kind,
    stuff: value.stuff,
    traits: TRAIT_ORDER.filter((trait) => traits.has(trait)),
    scale: value.scale,
    flavor: value.flavor as string | undefined,
  };
}

export function deriveTags(
  a: ElementDef,
  b: ElementDef,
): Pick<ElementDef, "kind" | "stuff" | "traits" | "scale"> {
  const traits = new Set<ElementTrait>([...a.traits, ...b.traits]);
  const cut = sharpCreaturePair(a, b);
  const fire = rolePair(a, b, (el) => el.traits.includes("hot") || el.stuff === "fire");
  const water = rolePair(a, b, (el) => el.stuff === "water");
  const clay = rolePair(a, b, (el) => el.stuff === "clay");
  const worked = toolMaterialPair(a, b);

  let kind = higherPriority(a.kind, b.kind, KIND_PRIORITY);
  let stuff = higherPriority(a.stuff, b.stuff, STUFF_PRIORITY);
  let scale = maxScale(a.scale, b.scale);

  if (cut) {
    replaceTraits(traits, cut.creature.traits);
    kind = "food";
    stuff = "flesh";
    scale = cut.creature.scale;
    traits.delete("alive");
    traits.delete("tame");
    traits.add("dead");
    traits.add("edible");
  } else if (fire) {
    const target = fire[1];
    replaceTraits(traits, target.traits);
    kind = target.kind === "food" || target.traits.includes("edible")
      ? "food"
      : target.kind;
    stuff = target.stuff;
    scale = target.scale;
    traits.delete("wet");
    traits.delete("cold");
    traits.add("hot");
    traits.add("dry");
  } else if (water) {
    const target = water[1];
    replaceTraits(traits, target.traits);
    kind = target.kind;
    stuff = target.stuff;
    scale = target.scale;
    traits.delete("dry");
    traits.delete("hot");
    traits.add("wet");
  } else if (clay) {
    const target = clay[1];
    replaceTraits(traits, target.traits, clay[0].traits);
    kind = target.kind;
    stuff = target.stuff;
    scale = target.scale;
    traits.delete("dry");
    traits.add("wet");
    traits.add("fragile");
  } else if (worked) {
    replaceTraits(traits, worked.material.traits);
    kind = "tool";
    stuff = worked.material.stuff;
  }

  return {
    kind,
    stuff,
    traits: TRAIT_ORDER.filter((trait) => traits.has(trait)),
    scale,
  };
}

export function buildFallbackElement(
  a: ElementDef,
  b: ElementDef,
): ElementDef {
  const depth = Math.max(a.depth ?? 0, b.depth ?? 0) + 1;
  if (depth > MAX_IMPROVISED_DEPTH) {
    throw new RangeError(
      `Improvisation depth ${depth} exceeds maximum ${MAX_IMPROVISED_DEPTH}`,
    );
  }

  const [first, second] = orderedParents(a, b);
  const cut = sharpCreaturePair(a, b);
  const fire = rolePair(a, b, (el) => el.traits.includes("hot") || el.stuff === "fire");
  const water = rolePair(a, b, (el) => el.stuff === "water");
  const clay = rolePair(a, b, (el) => el.stuff === "clay");
  const worked = toolMaterialPair(a, b);

  let name: string;
  let flavor: string;
  let emoji = first.emoji;

  if (cut) {
    name = `Butchered ${cut.creature.name}`;
    flavor = `Karl introduces ${cut.tool.name} to ${cut.creature.name}. The result is edible, which is more than can be said for the plan.`;
    emoji = cut.creature.emoji;
  } else if (fire) {
    name = `Fire-touched ${fire[1].name}`;
    flavor = `Karl applies ${fire[0].name} to ${fire[1].name}. It is hotter, drier, and somehow now part of the plan.`;
    emoji = fire[1].emoji;
  } else if (water) {
    name = `Soaked ${water[1].name}`;
    flavor = `Karl adds ${water[0].name} to ${water[1].name}. Wetness is achieved with historic confidence.`;
    emoji = water[1].emoji;
  } else if (clay) {
    name = `Clay-bound ${clay[1].name}`;
    flavor = `Karl presses ${clay[0].name} around ${clay[1].name}. It holds together until history looks at it sharply.`;
    emoji = clay[1].emoji;
  } else if (worked) {
    name = `${worked.material.name} worked by ${worked.tool.name}`;
    flavor = `Karl works ${worked.material.name} with ${worked.tool.name}. Purpose appears shortly after the bruising.`;
    emoji = worked.tool.emoji;
  } else if (a.stuff === b.stuff && a.stuff !== "none") {
    name = `Joined ${first.name}`;
    flavor = `Karl joins ${first.name} to ${second.name}. More of the same is still technically progress.`;
  } else {
    name = `${first.name}-${second.name} contraption`;
    flavor = `Karl combines ${first.name} with ${second.name}. The result exists, which was the full extent of the plan.`;
  }

  return {
    id: improvisedElementId(first.id, second.id),
    origin: "improvised",
    parents: [first.id, second.id],
    name,
    emoji,
    act: Math.max(a.act, b.act),
    base: false,
    depth,
    terminal: depth === MAX_IMPROVISED_DEPTH,
    ...deriveTags(a, b),
    flavor,
  };
}

/** Copy-override uden adgang til id, taxonomy, progression eller rettigheder. */
export function withImprovisedCopy(
  element: ElementDef,
  copy: ImproviseCopy,
): ElementDef {
  return {
    ...element,
    name: copy.name,
    flavor: copy.flavor,
  };
}
