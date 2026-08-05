import type { Engine } from "../core/engine";
import { buildTimeline } from "../core/timeline";
import type { TimelineNode } from "../core/timeline";

/**
 * Bogen: leksikonet er den primære flade — det åbne opslag viser den valgte
 * (eller nyeste) opdagelse, med en chip-række til at bladre. Tidslinjen er
 * sammenklappet som udgangspunkt (docs/design/bogen.md).
 */

const COL_W = 108;
const ROW_H = 72;
const RADIUS = 24;

const TIMELINE_OPEN_KEY = "kolde-karl-timeline-open";

/** Karls stemning som badge — bliver senere brief til illustratoren */
const MOOD_LABELS: Record<string, string> = {
  stolt: "😌 Karl is immensely proud",
  ked: "😢 Karl is comically sad",
  flov: "😳 Karl pretends nothing happened",
  fornaermet: "😤 Karl is deeply offended",
  forvirret: "🤨 Karl doesn't quite get it",
};

export class BookView {
  private selectedAct: number;
  private selectedNode: string | null = null;
  private timelineOpen: boolean;

  constructor(
    private engine: Engine,
    private container: HTMLElement,
  ) {
    this.selectedAct = engine.currentAct().act;
    this.timelineOpen = localStorage.getItem(TIMELINE_OPEN_KEY) === "1";
    container.innerHTML = `
      <div id="book-tabs"></div>
      <div id="book-entry"></div>
      <div id="book-chips"></div>
      <button id="timeline-toggle" aria-expanded="false"></button>
      <div id="timeline-wrap" hidden></div>`;
    container
      .querySelector("#timeline-toggle")!
      .addEventListener("click", () => {
        this.timelineOpen = !this.timelineOpen;
        localStorage.setItem(TIMELINE_OPEN_KEY, this.timelineOpen ? "1" : "0");
        this.render();
      });
  }

  /** Kaldes efter hver opdagelse (med den nye opdagelses id) og efter age-up. */
  render(selectId?: string): void {
    const currentAct = this.engine.currentAct().act;
    if (this.selectedAct > currentAct) this.selectedAct = currentAct;
    if (selectId) {
      this.selectedNode = selectId;
      this.selectedAct = this.engine.element(selectId).act;
    }
    if (!this.selectedNode) {
      // Åbn bogen på nyeste opdagelse i akten, hvis der er en
      const discoveredInAct = this.engine
        .availableElements()
        .filter((e) => !e.base && e.act === this.selectedAct);
      this.selectedNode = discoveredInAct.at(-1)?.id ?? null;
    }
    this.renderTabs(currentAct);
    this.renderEntry();
    this.renderChips();
    this.renderTimelineSection();
  }

  private renderTabs(currentAct: number): void {
    const tabs = this.container.querySelector("#book-tabs")!;
    tabs.innerHTML = "";
    for (const act of this.engine.content.acts) {
      if (act.act > currentAct) continue;
      const btn = document.createElement("button");
      btn.className = `book-tab ${act.act === this.selectedAct ? "active" : ""}`;
      btn.textContent = `Act ${act.act} · ${act.name}`;
      btn.addEventListener("click", () => {
        this.selectedAct = act.act;
        this.selectedNode = null;
        this.render();
      });
      tabs.appendChild(btn);
    }
  }

  /** Chip-række: bladr mellem aktens opdagede poster */
  private renderChips(): void {
    const chips = this.container.querySelector<HTMLElement>("#book-chips")!;
    chips.innerHTML = "";
    const discovered = this.engine
      .availableElements()
      .filter((e) => !e.base && e.act === this.selectedAct);
    for (const def of discovered) {
      const btn = document.createElement("button");
      btn.className = `chip ${def.id === this.selectedNode ? "active" : ""}`;
      btn.title = def.name;
      btn.textContent = def.emoji;
      btn.addEventListener("click", () => {
        this.selectedNode = def.id;
        this.render();
      });
      chips.appendChild(btn);
    }
  }

  private renderEntry(): void {
    const entry = this.container.querySelector<HTMLElement>("#book-entry")!;
    if (!this.selectedNode) {
      entry.innerHTML = `<div class="entry blank">
        <div class="entry-emoji">📖</div>
        <h3>The Chronicle of Mankind</h3>
        <p>Blank pages, waiting to be filled. Combine something below and history will write itself. Badly, probably, but it will.</p>
      </div>`;
      return;
    }
    if (!this.engine.isDiscovered(this.selectedNode)) {
      entry.innerHTML = `<div class="entry blank">
        <div class="entry-emoji">📄</div>
        <h3>A blank page</h3>
        <p>History is missing something here. Karl simply hasn't discovered it yet.</p>
      </div>`;
      return;
    }
    const def = this.engine.element(this.selectedNode);
    const mood = def.karlMood ? MOOD_LABELS[def.karlMood] : undefined;
    entry.innerHTML = `<div class="entry">
      <div class="entry-emoji">${def.emoji}</div>
      <div class="entry-body">
        <h3>${def.name}</h3>
        <p>${def.flavor ?? ""}</p>
        ${def.note ? `<p class="note">📜 ${def.note}</p>` : ""}
        ${mood ? `<p class="mood">${mood}</p>` : ""}
      </div>
    </div>`;
  }

  private renderTimelineSection(): void {
    const toggle = this.container.querySelector<HTMLButtonElement>("#timeline-toggle")!;
    const wrap = this.container.querySelector<HTMLElement>("#timeline-wrap")!;
    const state = this.engine.getState();
    const discoveredSet = new Set(state.discovered);
    const { found, total } = buildTimeline(
      this.engine.content, this.selectedAct, discoveredSet, new Set(state.flags),
    );

    toggle.textContent = `${this.timelineOpen ? "▾" : "▸"} Timeline — ${found}/${total} discovered`;
    toggle.setAttribute("aria-expanded", String(this.timelineOpen));
    wrap.hidden = !this.timelineOpen;
    if (this.timelineOpen) this.renderTimeline(wrap, discoveredSet, new Set(state.flags));
  }

  private renderTimeline(
    wrap: HTMLElement,
    discovered: ReadonlySet<string>,
    flags: ReadonlySet<string>,
  ): void {
    const { nodes, edges, hidden } = buildTimeline(
      this.engine.content, this.selectedAct, discovered, flags,
    );
    if (nodes.length === 0) {
      wrap.innerHTML = `<p class="timeline-empty">Nothing charted yet. Combine something.</p>`;
      return;
    }

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
    const width = 112 + Math.max(...[...byDepth.keys()], 0) * COL_W;
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
          // Frontier: stiplet silhuet inden for rækkevidde — retning uden spoilers
          return `<g class="node silhouette ${sel}" data-id="${n.id}" transform="translate(${p.x},${p.y})">
            <circle r="${RADIUS}" />
            <text class="glyph">?</text>
            <text class="label" y="${RADIUS + 13}">within reach</text>
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

    const hint = hidden > 0
      ? `<p class="timeline-hidden">Dotted circles are one combination away. ${hidden} more discoveries lie further out.</p>`
      : "";
    wrap.innerHTML = `<svg id="timeline" viewBox="0 0 ${width} ${height}"
      width="${width}" height="${height}" role="img"
      aria-label="Timeline of discoveries in this act">${svgEdges}${svgNodes}</svg>${hint}`;

    for (const g of wrap.querySelectorAll<SVGGElement>(".node")) {
      g.addEventListener("click", () => {
        this.selectedNode = g.dataset.id ?? null;
        this.render();
      });
    }
  }
}
