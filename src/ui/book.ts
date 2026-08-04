import type { Engine } from "../core/engine";
import { buildTimeline } from "../core/timeline";
import type { TimelineNode } from "../core/timeline";

/**
 * Bogen: leksikon over menneskets historie med forgrenet tidslinje
 * (docs/design/bogen.md). Opdagede poster vises med "illustration" (emoji
 * indtil Step 4), uopdagede som stiplede silhuetter — blanke sider.
 */

const COL_W = 108;
const ROW_H = 72;
const RADIUS = 24;

/** Karls stemning som badge — bliver senere brief til illustratoren */
const MOOD_LABELS: Record<string, string> = {
  stolt: "😌 Karl er umådeligt stolt",
  ked: "😢 Karl er komisk ked af det",
  flov: "😳 Karl lader som ingenting",
  fornaermet: "😤 Karl er dybt fornærmet",
  forvirret: "🤨 Karl forstår det ikke helt",
};

export class BookView {
  private selectedAct: number;
  private selectedNode: string | null = null;

  constructor(
    private engine: Engine,
    private container: HTMLElement,
  ) {
    this.selectedAct = engine.currentAct().act;
    container.innerHTML = `
      <div id="book-tabs"></div>
      <div id="book-body">
        <div id="timeline-wrap"></div>
        <aside id="book-entry"></aside>
      </div>`;
  }

  /** Kaldes efter hver opdagelse og efter age-up. */
  render(): void {
    const currentAct = this.engine.currentAct().act;
    if (this.selectedAct > currentAct) this.selectedAct = currentAct;
    this.renderTabs(currentAct);
    this.renderTimeline();
    this.renderEntry();
  }

  private renderTabs(currentAct: number): void {
    const tabs = this.container.querySelector("#book-tabs")!;
    tabs.innerHTML = "";
    for (const act of this.engine.content.acts) {
      if (act.act > currentAct) continue;
      const btn = document.createElement("button");
      btn.className = `book-tab ${act.act === this.selectedAct ? "active" : ""}`;
      btn.textContent = `Akt ${act.act} · ${act.name}`;
      btn.addEventListener("click", () => {
        this.selectedAct = act.act;
        this.selectedNode = null;
        this.render();
      });
      tabs.appendChild(btn);
    }
  }

  private renderTimeline(): void {
    const wrap = this.container.querySelector<HTMLElement>("#timeline-wrap")!;
    const discovered = new Set(this.engine.getState().discovered);
    const { nodes, edges } = buildTimeline(this.engine.content, this.selectedAct, discovered);

    // Kolonner pr. dybde; hovedspor øverst, komiske grene nederst i kolonnen
    const byDepth = new Map<number, TimelineNode[]>();
    for (const n of nodes) {
      const col = byDepth.get(n.depth) ?? [];
      col.push(n);
      byDepth.set(n.depth, col);
    }
    const pos = new Map<string, { x: number; y: number }>();
    let maxRows = 1;
    for (const [depth, col] of byDepth) {
      col.sort((a, b) => Number(a.komisk) - Number(b.komisk) || a.id.localeCompare(b.id));
      maxRows = Math.max(maxRows, col.length);
      col.forEach((n, i) => {
        pos.set(n.id, { x: 56 + depth * COL_W, y: 48 + i * ROW_H });
      });
    }
    const width = 112 + (Math.max(...[...byDepth.keys()], 0) + 0) * COL_W;
    const height = 40 + maxRows * ROW_H;

    const svgEdges = edges
      .map((e) => {
        const a = pos.get(e.from);
        const b = pos.get(e.to);
        if (!a || !b) return "";
        const midX = (a.x + b.x) / 2;
        return `<path class="edge ${e.komisk ? "komisk" : ""}"
          d="M ${a.x + RADIUS} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x - RADIUS} ${b.y}" />`;
      })
      .join("");

    const svgNodes = nodes
      .map((n) => {
        const p = pos.get(n.id)!;
        const sel = n.id === this.selectedNode ? "selected" : "";
        if (!n.discovered) {
          // Blank side: stiplet silhuet — retning uden spoilers
          return `<g class="node silhouette ${sel}" data-id="${n.id}" transform="translate(${p.x},${p.y})">
            <circle r="${RADIUS}" />
            <text class="glyph">?</text>
          </g>`;
        }
        const def = this.engine.element(n.id);
        return `<g class="node discovered ${n.komisk ? "komisk" : ""} ${sel}" data-id="${n.id}" transform="translate(${p.x},${p.y})">
          <circle r="${RADIUS}" />
          <text class="glyph">${def.emoji}</text>
          <text class="label" y="${RADIUS + 13}">${def.name}</text>
        </g>`;
      })
      .join("");

    wrap.innerHTML = `<svg id="timeline" viewBox="0 0 ${width} ${height}"
      width="${width}" height="${height}" role="img"
      aria-label="Tidslinje over opdagelser i akten">${svgEdges}${svgNodes}</svg>`;

    for (const g of wrap.querySelectorAll<SVGGElement>(".node")) {
      g.addEventListener("click", () => {
        this.selectedNode = g.dataset.id ?? null;
        this.renderTimeline();
        this.renderEntry();
      });
    }
  }

  private renderEntry(): void {
    const entry = this.container.querySelector<HTMLElement>("#book-entry")!;
    if (!this.selectedNode) {
      entry.innerHTML = `<p class="entry-hint">Menneskehedens leksikon.<br>
        Vælg en post på tidslinjen — eller udfyld en blank side ved at opdage noget nyt.</p>`;
      return;
    }
    const discovered = this.engine.isDiscovered(this.selectedNode);
    if (!discovered) {
      entry.innerHTML = `<div class="entry blank">
        <div class="entry-emoji">📄</div>
        <h3>En blank side</h3>
        <p>Historien mangler noget her. Karl har bare ikke opdaget det endnu.</p>
      </div>`;
      return;
    }
    const def = this.engine.element(this.selectedNode);
    const mood = def.karlMood ? MOOD_LABELS[def.karlMood] : undefined;
    entry.innerHTML = `<div class="entry">
      <div class="entry-emoji">${def.emoji}</div>
      <h3>${def.name}</h3>
      <p>${def.flavor ?? ""}</p>
      ${def.note ? `<p class="note">📜 ${def.note}</p>` : ""}
      ${mood ? `<p class="mood">${mood}</p>` : ""}
    </div>`;
  }
}
