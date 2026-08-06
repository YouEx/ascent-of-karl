import type { ContentBundle } from "./types";

/**
 * Den forgrenede tidslinje i bogen (docs/design/bogen.md).
 * Udledes automatisk af content — skribenter vedligeholder ingen separat graf.
 * Ren og deterministisk: ingen DOM, ingen tilstand.
 */

export interface TimelineNode {
  id: string;
  /** Kolonne på tidslinjen: 0 = base-elementer, ellers 1 + max(inputs) */
  depth: number;
  discovered: boolean;
  /** Ligger på en komisk sidegren (alle veje hertil er komiske) */
  komisk: boolean;
  base: boolean;
  /** Uopdaget, men kan nås med ÉN kombination af det spilleren allerede har */
  frontier: boolean;
}

/** Kanter vises kun for opdagede resultater — opskrifter afsløres først når de er lavet. */
export interface TimelineEdge {
  from: string;
  to: string;
  komisk: boolean;
}

export interface Timeline {
  /** Kun opdagede + frontier-noder — resten ville være en mur af spørgsmålstegn */
  nodes: TimelineNode[];
  edges: TimelineEdge[];
  /** Elementer i akten der ligger længere ude og derfor ikke vises */
  hidden: number;
  /** Opdagede / mulige i alt (til tælleren) */
  found: number;
  total: number;
}

/** Dybde pr. element: korteste "opskriftsafstand" fra base-elementerne, flags ignoreret. */
export function computeDepths(content: ContentBundle): Map<string, number> {
  const depths = new Map<string, number>();
  for (const el of content.elements) {
    if (el.base) depths.set(el.id, 0);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const combo of content.combos) {
      const [a, b] = combo.pair;
      const da = depths.get(a);
      const db = depths.get(b);
      if (da === undefined || db === undefined) continue;
      const candidate = 1 + Math.max(da, db);
      const current = depths.get(combo.result);
      if (current === undefined || candidate < current) {
        depths.set(combo.result, candidate);
        changed = true;
      }
    }
  }
  return depths;
}

/** Et element er komisk hvis samtlige kombinationer der skaber det er tagget komiske. */
function isKomisk(content: ContentBundle, elementId: string): boolean {
  const producers = content.combos.filter((c) => c.result === elementId);
  return producers.length > 0 && producers.every((c) => c.spor === "komisk");
}

/** Kan opskriften laves lige nu med de opdagede elementer og de aktive flags? */
function recipeAvailable(
  combo: { pair: [string, string]; requiresFlags?: string[]; blockedByFlags?: string[] },
  discovered: ReadonlySet<string>,
  flags: ReadonlySet<string>,
): boolean {
  if (!discovered.has(combo.pair[0]) || !discovered.has(combo.pair[1])) return false;
  if (combo.requiresFlags?.some((f) => !flags.has(f))) return false;
  if (combo.blockedByFlags?.some((f) => flags.has(f))) return false;
  return true;
}

/**
 * Byg tidslinjen for én akt (docs/design/ui-mobile.md).
 *
 * Progressive disclosure: vi viser opdagede noder plus "frontier" — de
 * uopdagede der kan nås med ÉN kombination af det spilleren allerede har.
 * Alt længere ude tælles kun (`hidden`). Uden det bliver bogen en mur af
 * spørgsmålstegn, så snart akten vokser, og retningen drukner i støj.
 */
export function buildTimeline(
  content: ContentBundle,
  act: number,
  discovered: ReadonlySet<string>,
  flags: ReadonlySet<string> = new Set(),
): Timeline {
  const depths = computeDepths(content);
  const actElements = content.elements.filter((e) => e.act === act);

  const frontierIds = new Set<string>();
  for (const combo of content.combos) {
    if (discovered.has(combo.result)) continue;
    if (recipeAvailable(combo, discovered, flags)) frontierIds.add(combo.result);
  }

  const visible = actElements.filter(
    (e) => discovered.has(e.id) || frontierIds.has(e.id),
  );
  const nodeIds = new Set(visible.map((e) => e.id));

  const nodes: TimelineNode[] = visible
    .map((e) => ({
      id: e.id,
      depth: depths.get(e.id) ?? 0,
      discovered: discovered.has(e.id),
      komisk: isKomisk(content, e.id),
      base: !!e.base,
      frontier: !discovered.has(e.id),
    }))
    .sort((x, y) => x.depth - y.depth || x.id.localeCompare(y.id));

  const edges: TimelineEdge[] = [];
  const seen = new Set<string>();
  for (const combo of content.combos) {
    if (!discovered.has(combo.result) || !nodeIds.has(combo.result)) continue;
    for (const input of new Set(combo.pair)) {
      // Kanter fra tidligere akters elementer tegnes ikke (v1) — bogen viser én akt ad gangen.
      if (!nodeIds.has(input)) continue;
      const key = `${input}->${combo.result}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: input, to: combo.result, komisk: combo.spor === "komisk" });
    }
  }

  const discoverable = actElements.filter((e) => !e.base);
  const found = discoverable.filter((e) => discovered.has(e.id)).length;
  return {
    nodes,
    edges,
    hidden: actElements.length - visible.length,
    found,
    total: discoverable.length,
  };
}
