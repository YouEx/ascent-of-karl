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
}

/** Kanter vises kun for opdagede resultater — opskrifter afsløres først når de er lavet. */
export interface TimelineEdge {
  from: string;
  to: string;
  komisk: boolean;
}

export interface Timeline {
  nodes: TimelineNode[];
  edges: TimelineEdge[];
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

/**
 * Byg tidslinjen for én akt.
 * Uopdagede elementer bliver noder uden kanter (stiplede silhuetter i bogen):
 * man kan se AT noget mangler og hvor på tidslinjen — ikke hvordan man når det.
 */
export function buildTimeline(
  content: ContentBundle,
  act: number,
  discovered: ReadonlySet<string>,
): Timeline {
  const depths = computeDepths(content);
  const actElements = content.elements.filter((e) => e.act === act);
  const nodeIds = new Set(actElements.map((e) => e.id));

  const nodes: TimelineNode[] = actElements
    .map((e) => ({
      id: e.id,
      depth: depths.get(e.id) ?? 0,
      discovered: discovered.has(e.id),
      komisk: isKomisk(content, e.id),
      base: !!e.base,
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
  return { nodes, edges };
}
