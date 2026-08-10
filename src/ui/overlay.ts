/**
 * Fælles overlejrings-styring (se docs/design/ux-checklist.md).
 *
 * Bærende princip: ingen blindgyder. Enhver overlejring skal kunne lukkes ad
 * mindst to uafhængige veje, og browserens tilbage-gestus skal lukke den i
 * stedet for at forlade spillet. Alt det ligger her, så en ny overlejring
 * arver adfærden i stedet for at skulle huske den.
 */

export interface OverlayOptions {
  /** Kaldes når overlejringen skal lukkes (fjern hidden/klasse, ryd op) */
  onClose: () => void;
  /**
   * Terminal overlejring: runnet er slut, og den fremadrettede handling
   * opløser tilstanden. Undtages fra baggrundsklik/Esc/back — men ikke fra
   * fokus- og aria-krav. Kræver en begrundelse, så det er en beslutning.
   */
  terminal?: boolean;
  /** Tilgængeligt navn til skærmlæsere */
  label: string;
  /**
   * Hvor fokus skal hen, hvis det element der åbnede overlejringen er væk
   * eller blevet deaktiveret imens (fx Combine-knappen, der slås fra når
   * slots ryddes). Uden dette falder fokus ned i <body>, og en
   * tastaturbruger mister sin plads i dokumentet.
   */
  fallbackFocus?: () => HTMLElement | null;
}

interface OpenOverlay extends OverlayOptions {
  element: HTMLElement;
  restoreFocusTo: Element | null;
}

/** Stak, så indlejrede overlejringer lukker i rigtig rækkefølge */
const stack: OpenOverlay[] = [];

/** Sat mens vi selv kalder history.back(), så popstate ikke lukker to gange */
let closingViaHistory = false;

function top(): OpenOverlay | undefined {
  return stack[stack.length - 1];
}

function focusableIn(element: HTMLElement): HTMLElement[] {
  const sel =
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return Array.from(element.querySelectorAll<HTMLElement>(sel)).filter(
    (e) => !e.hasAttribute("disabled") && e.offsetParent !== null,
  );
}

export function openOverlay(element: HTMLElement, opts: OverlayOptions): void {
  const entry: OpenOverlay = {
    ...opts,
    element,
    restoreFocusTo: document.activeElement,
  };
  stack.push(entry);

  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-label", opts.label);
  document.body.classList.add("overlay-open");

  // Browserens back skal lukke overlejringen, ikke forlade spillet.
  // Terminale overlejringer får ingen history-entry: der er intet at gå
  // tilbage til, og runnet er slut.
  if (!opts.terminal) {
    history.pushState({ overlay: true }, "");
  }

  // Fokus ind i overlejringen, så tastatur og skærmlæser følger med.
  // Bemærk: det FØRSTE fokuserbare element skal ligge øverst i overlejringen.
  // Ligger det under en lang, scrollende liste, ruller browseren det ind i
  // billedet og springer forbi overskriften — derfor sidder trofæ-modalens
  // lukkeknap i dens hoved og ikke under de 15 skæbner.
  const first = focusableIn(element)[0];
  (first ?? element).focus?.();
  if (!first) element.setAttribute("tabindex", "-1");
}

/** Lukker den øverste overlejring. Returnerer false hvis der ingen er. */
export function closeTopOverlay(fromHistory = false): boolean {
  const entry = stack.pop();
  if (!entry) return false;

  entry.onClose();
  entry.element.removeAttribute("role");
  entry.element.removeAttribute("aria-modal");
  if (stack.length === 0) document.body.classList.remove("overlay-open");

  // Spol history-entryen tilbage, med mindre det var netop back der lukkede
  if (!entry.terminal && !fromHistory) {
    closingViaHistory = true;
    history.back();
  }

  restoreFocus(entry);
  return true;
}

function isFocusable(e: Element | null | undefined): e is HTMLElement {
  return (
    e instanceof HTMLElement &&
    e.isConnected &&
    !e.hasAttribute("disabled") &&
    e.offsetParent !== null
  );
}

function restoreFocus(entry: OpenOverlay): void {
  if (isFocusable(entry.restoreFocusTo)) {
    entry.restoreFocusTo.focus();
    return;
  }
  const fallback = entry.fallbackFocus?.();
  if (isFocusable(fallback)) fallback.focus();
}

export function hasOpenOverlay(): boolean {
  return stack.length > 0;
}

/** Er dette element baggrunden på den øverste overlejring? */
function isBackdrop(target: EventTarget | null): boolean {
  const entry = top();
  return !!entry && target === entry.element;
}

export function initOverlays(): void {
  // 1. Klik på baggrunden lukker
  document.addEventListener("click", (e) => {
    const entry = top();
    if (entry && !entry.terminal && isBackdrop(e.target)) closeTopOverlay();
  });

  // 2. Esc lukker
  document.addEventListener("keydown", (e) => {
    const entry = top();
    if (!entry) return;
    if (e.key === "Escape" && !entry.terminal) {
      e.preventDefault();
      closeTopOverlay();
      return;
    }
    // 3. Fokus må ikke kunne tabbe bagom overlejringen
    if (e.key === "Tab") {
      const items = focusableIn(entry.element);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !entry.element.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // 4. Browserens back / iOS' swipe fra kanten
  window.addEventListener("popstate", () => {
    if (closingViaHistory) {
      closingViaHistory = false;
      return;
    }
    const entry = top();
    if (entry && !entry.terminal) closeTopOverlay(true);
    // Ingen overlejring åben: lad browseren navigere normalt. Vi fanger
    // IKKE brugeren på siden — det er den samme blindgyde vendt om, og
    // runnet ligger gemt i localStorage, så der er intet at miste.
  });
}
