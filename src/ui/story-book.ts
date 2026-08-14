/**
 * Bogens højre side: én side pr. afsluttet kombination.
 *
 * Delt i to, fordi de to ansvar fejler på hver sin måde. `PageTurn` ejer KUN
 * generationen — hvilket sideskift der stadig er det nyeste — og kan derfor
 * testes uden DOM. `StoryBook` ejer kun optegningen. Uden generationen ville
 * en hurtig spiller se en gammel timer skrive sit forældede resultat oven i
 * det nye, længe efter at han var gået videre.
 */

import { glyphHTML } from "./art";
import { escapeHTML } from "./improvise-view";
import type { StoryPagePayload } from "./story-page";

/**
 * Skal matche `story-page-turn`-animationen i style.css (--dur-celebrate).
 * Bladet vendes halvvejs: teksten skiftes ved midtpunktet, hvor papiret står
 * på kant og dækker siden, så spilleren aldrig ser skiftet ske.
 */
export const PAGE_TURN_MS = 420;

export class PageTurn {
  private midpoint: ReturnType<typeof setTimeout> | undefined;
  private ending: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;

  constructor(private readonly durationMs: number = PAGE_TURN_MS) {}

  /**
   * Starter et sideskift og annullerer ethvert igangværende. `immediate`
   * dækker reduceret bevægelse og frosne dommerkørsler: samme slutresultat,
   * ingen timere.
   */
  start(atMidpoint: () => void, immediate = false, atEnd?: () => void): void {
    this.cancel();
    const generation = ++this.generation;

    if (immediate) {
      atMidpoint();
      atEnd?.();
      return;
    }

    this.midpoint = setTimeout(() => {
      if (generation !== this.generation) return;
      atMidpoint();
    }, this.durationMs / 2);

    this.ending = setTimeout(() => {
      if (generation !== this.generation) return;
      atEnd?.();
    }, this.durationMs);
  }

  cancel(): void {
    this.generation++;
    if (this.midpoint) clearTimeout(this.midpoint);
    if (this.ending) clearTimeout(this.ending);
    this.midpoint = undefined;
    this.ending = undefined;
  }
}

/** Sidens indhold som HTML. Ren funktion — ingen DOM, kun streng. */
export function storyPageHTML(payload: StoryPagePayload): string {
  const glyph = payload.elementId
    ? glyphHTML(payload.elementId, payload.emoji ?? "", "story-glyph")
    : "";

  return [
    `<div class="story-entry story-entry-${payload.kind}">`,
    `<p class="story-pair">${escapeHTML(payload.pairLabel)}</p>`,
    `<p class="story-kicker">${escapeHTML(payload.kicker)}</p>`,
    `<h2 class="story-title">${glyph}<span>${escapeHTML(payload.title)}</span></h2>`,
    payload.body ? `<p class="story-body">${escapeHTML(payload.body)}</p>` : "",
    payload.note
      ? `<p class="story-note"><span class="story-note-label">Note</span>${escapeHTML(payload.note)}</p>`
      : "",
    payload.solved
      ? `<p class="story-solved">Problem solved: ${escapeHTML(payload.solved)}</p>`
      : "",
    `</div>`,
  ].join("");
}

export class StoryBook {
  private readonly turn: PageTurn;

  constructor(
    private readonly root: HTMLElement,
    private readonly outcome: HTMLElement,
    private readonly immediate: () => boolean = () => false,
    durationMs: number = PAGE_TURN_MS,
  ) {
    this.turn = new PageTurn(durationMs);
  }

  /** Sætter siden uden sideskift. Bruges til åbningssiden og til genindlæsning. */
  render(payload: StoryPagePayload): void {
    this.turn.cancel();
    this.root.classList.remove("is-turning");
    this.outcome.innerHTML = storyPageHTML(payload);
  }

  /** Ét sideskift pr. afsluttet forsøg. Nyeste resultat vinder altid. */
  present(payload: StoryPagePayload): void {
    if (this.immediate()) {
      this.render(payload);
      return;
    }

    this.beginTurn();
    this.turn.start(
      () => {
        this.outcome.innerHTML = storyPageHTML(payload);
      },
      false,
      () => {
        this.root.classList.remove("is-turning");
      },
    );
  }

  /**
   * En klasse der allerede står der genstarter ikke sin animation. Fjern,
   * fremtving reflow, sæt igen — ellers står bladet stille ved forsøg to.
   */
  private beginTurn(): void {
    if (this.root.classList.contains("is-turning")) {
      this.root.classList.remove("is-turning");
      void this.root.offsetWidth;
    }
    this.root.classList.add("is-turning");
  }
}
