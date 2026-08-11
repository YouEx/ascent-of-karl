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
  restart: svg(`<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/>`),
  close: svg(`<path d="M6 6l12 12"/><path d="M18 6L6 18"/>`),
  soundOn: svg(
    `<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>`,
  ),
  soundOff: svg(
    `<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16.5 10l4 4"/><path d="M20.5 10l-4 4"/>`,
  ),
  gear: svg(
    `<circle cx="12" cy="12" r="3.4"/><path d="M21.29 10.60 L21.29 13.40 L18.98 13.78 L18.19 15.67 L19.57 17.58 L17.58 19.57 L15.67 18.19 L13.78 18.98 L13.40 21.29 L10.60 21.29 L10.22 18.98 L8.33 18.19 L6.42 19.57 L4.43 17.58 L5.81 15.67 L5.02 13.78 L2.71 13.40 L2.71 10.60 L5.02 10.22 L5.81 8.33 L4.43 6.42 L6.42 4.43 L8.33 5.81 L10.22 5.02 L10.60 2.71 L13.40 2.71 L13.78 5.02 L15.67 5.81 L17.58 4.43 L19.57 6.42 L18.19 8.33 L18.98 10.22 Z"/>`,
  ),
  tap: svg(
    `<path d="M9 11V5.5a1.8 1.8 0 0 1 3.6 0V13"/><path d="M12.6 11.5a1.6 1.6 0 0 1 3.2 0v1"/><path d="M15.8 12.2a1.6 1.6 0 0 1 3.2 0V16a5 5 0 0 1-5 5h-1.6a4.5 4.5 0 0 1-3.4-1.6L5.4 15a1.7 1.7 0 0 1 2.4-2.3L9 14"/><path d="M5.5 5.2 4 3.7M9.4 2.6 9 .8M2.6 9.4.8 9"/>`,
  ),
} as const;
