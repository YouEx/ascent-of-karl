/**
 * Streg-ikoner til UI-krommet.
 *
 * DESIGN.md §8 forbyder emoji i krommet: emoji hører til indholdet (elementer
 * og skæbner kommer fra content/*.json og ER spillets illustrationssprog), mens
 * en knap skal have et ikon vi selv kontrollerer. Emoji renderes desuden
 * forskelligt pr. platform og kan ikke arve tekstfarven — begge dele er
 * uacceptable i krom der skal se ens ud overalt.
 *
 * Alle ikoner arver farve via `stroke: currentColor` (sat i style.css).
 */

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;

export const icons = {
  book: svg(
    `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z"/>`,
  ),
  trophy: svg(
    `<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 5H4.5v1.5A3.5 3.5 0 0 0 8 10"/><path d="M17 5h2.5v1.5A3.5 3.5 0 0 1 16 10"/><path d="M12 14v3"/><path d="M8.5 20h7"/><path d="M10 17h4l.7 3h-5.4z"/>`,
  ),
  spiral: svg(
    `<path d="M12 2.75v2"/><path d="M12 19.25v2"/><path d="M2.75 12h2"/><path d="M19.25 12h2"/><path d="m5.46 5.46 1.42 1.42"/><path d="m17.12 17.12 1.42 1.42"/><path d="m18.54 5.46-1.42 1.42"/><path d="m6.88 17.12-1.42 1.42"/><path d="M12 8.1a3.9 3.9 0 1 1-3.78 4.84 2.85 2.85 0 1 1 3.53 2.03"/>`,
  ),
  restart: svg(`<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/>`),
  close: svg(`<path d="M6 6l12 12"/><path d="M18 6L6 18"/>`),
  soundOn: svg(
    `<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>`,
  ),
  soundOff: svg(
    `<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16.5 10l4 4"/><path d="M20.5 10l-4 4"/>`,
  ),
} as const;
