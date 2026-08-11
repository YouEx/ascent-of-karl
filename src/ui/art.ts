/**
 * Malede brikker for de elementer, der har fået et.
 *
 * 13 af 187 elementer er malet. Resten er stadig emoji. Det er ikke en
 * halvfærdig tilstand, der skal skjules — grundelementerne er dem, spilleren
 * ser hele tiden og starter med, så de bærer mest af indtrykket. De øvrige
 * dukker op enkeltvis undervejs.
 *
 * Vite hasher og bundler filerne gennem import.meta.glob. En håndskrevet sti
 * ville overleve `vite dev` og dø i produktion, hvor filnavnene får hash.
 */

const files = import.meta.glob<string>("../assets/art/elements/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

const art = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
  const id = path.slice(path.lastIndexOf("/") + 1, -".webp".length);
  art.set(id, url);
}

/** Har elementet et maleri, eller falder det tilbage på emoji? */
export function hasArt(id: string): boolean {
  return art.has(id);
}

/**
 * Brikkens ansigt som HTML. Maleriet er dekoration — navnet står ved siden af
 * og bærer betydningen — så alt-teksten er tom og billedet skjules for
 * skærmlæsere frem for at blive læst op to gange.
 */
export function glyphHTML(id: string, emoji: string, cls = "emoji"): string {
  const url = art.get(id);
  if (!url) return `<span class="${cls}">${emoji}</span>`;
  return `<img class="${cls} ${cls}-art" src="${url}" alt="" aria-hidden="true" draggable="false">`;
}
