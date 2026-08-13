import type { ElementDef, ProblemDef } from "../core/types";
import { glyphHTML } from "./art";
import type { ImproviseCopyState } from "./improvise-client";
import {
  inventionSummaryText,
  type InventionSummary,
} from "./run-summary";

export function partitionChronicleEntries(
  elements: readonly ElementDef[],
  act: number,
): { canonical: ElementDef[]; inventions: ElementDef[] } {
  const inAct = elements.filter((element) => !element.base && element.act === act);
  return {
    canonical: inAct.filter((element) => element.origin !== "improvised"),
    inventions: inAct.filter((element) => element.origin === "improvised"),
  };
}

export function elementOriginClass(
  element: ElementDef,
  enabled: boolean,
): string {
  return enabled && element.origin === "improvised" ? "is-improvised" : "";
}

export function renderElementTileContent(
  element: ElementDef,
  enabled: boolean,
): string {
  return `${glyphHTML(element.id, element.emoji)}<span class="name">${escapeHTML(
    element.name,
  )}</span>${
    enabled && element.origin === "improvised"
      ? '<span class="invention-tag">Karl&#039;s invention</span>'
      : ""
  }`;
}

export function renderSlotContent(element: ElementDef): string {
  return `${glyphHTML(
    element.id,
    element.emoji,
    "slot-glyph",
  )}<span>${escapeHTML(element.name)}</span>`;
}

export function renderInventionSummaryHTML(
  summary: InventionSummary,
  enabled = true,
): string {
  if (!enabled || summary.total === 0) return "";
  return `<p class="ending-inventions">${escapeHTML(
    inventionSummaryText(summary),
  )}</p>`;
}

export function renderInventionsSection(
  elements: readonly ElementDef[],
  selectedId: string | null,
  enabled: boolean,
  act: number,
): string {
  if (!enabled) return "";
  const { inventions } = partitionChronicleEntries(elements, act);
  const body = inventions.length === 0
    ? `<p class="inventions-empty">Combine two things with no recipe. If Karl's idea holds together, it appears here instead of the historical timeline.</p>`
    : `<div class="invention-list">${inventions
        .map(
          (element) => `<button type="button" class="invention-chip ${
            element.id === selectedId ? "active" : ""
          }" data-invention-id="${escapeAttribute(element.id)}" aria-pressed="${
            element.id === selectedId
          }">
            ${glyphHTML(element.id, element.emoji, "invention-glyph")}
            <span><small>Karl's invention</small>${escapeHTML(element.name)}</span>
          </button>`,
        )
        .join("")}</div>`;
  return `<section class="book-inventions" aria-labelledby="book-inventions-title">
    <div class="inventions-heading">
      <h3 id="book-inventions-title">Karl's inventions</h3>
      <span>${inventions.length}</span>
    </div>
    ${body}
  </section>`;
}

export function renderInventionEntry(element: ElementDef): string {
  return `<div class="entry invention-entry">
    <div class="entry-emoji">${glyphHTML(element.id, element.emoji, "entry-glyph")}</div>
    <div class="entry-body">
      <p class="invention-label">Karl's invention</p>
      <h3>${escapeHTML(element.name)}</h3>
      <p>${escapeHTML(element.flavor ?? "")}</p>
    </div>
  </div>`;
}

export function renderInventionCard(
  element: ElementDef,
  glyph: string,
  solved?: ProblemDef,
): string {
  return `<div class="card-inner invention-card">
    <p class="card-kicker invention-label">Karl's invention</p>
    <div class="card-stage invention-stage">
      <div class="card-emoji">${glyph}</div>
    </div>
    <h2>${escapeHTML(element.name)}</h2>
    <p class="card-flavor">${escapeHTML(element.flavor ?? "")}</p>
    ${
      solved
        ? `<p class="solved-badge">✓ Problem solved: ${escapeHTML(solved.name)}</p>`
        : ""
    }
    <button id="card-close">Keep it</button>
  </div>`;
}

export function renderCopyStatus(state: ImproviseCopyState): string {
  let cls = "";
  let text = "";
  if (state.status === "loading") {
    cls = "is-loading";
    text = "Karl is finding the words. Combine works now.";
  } else if (state.status === "ready") {
    cls = "is-ready";
    text = "A sharper name is ready.";
  } else if (state.status === "fallback") {
    cls = "is-fallback";
    text = state.reason === "timeout"
      ? "Copy took too long. Karl used his own wording instead."
      : state.reason === "noncanonical"
        ? "Karl will name this one himself."
      : state.reason === "no-endpoint"
        ? "Offline wording is ready."
        : "The copy service failed. Karl's own wording is ready.";
  }
  return `<p class="improvise-status ${cls}" role="status" aria-live="polite" aria-busy="${
    state.status === "loading"
  }"${
    text ? "" : " hidden"
  }>${text}</p>`;
}

export function escapeHTML(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]!,
  );
}

function escapeAttribute(value: string): string {
  return escapeHTML(value);
}
