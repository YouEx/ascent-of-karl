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

/**
 * Problemknappernes ikoner. Egen mappe frem for elements/, fordi hasArt()
 * bruges til at afgøre om et ELEMENT er malet — et problem er ikke et
 * element, og id'erne kunne kollidere.
 */
const problemFiles = import.meta.glob<string>("../assets/art/problems/*.webp", {
  eager: true,
  query: "?url",
  import: "default",
});

import problemSizes from "../assets/art/problems/sizes.json";

const problemArt = new Map<string, string>();
for (const [path, url] of Object.entries(problemFiles)) {
  const id = path.slice(path.lastIndexOf("/") + 1, -".webp".length);
  problemArt.set(id, url);
}

/**
 * Problemets ikon som HTML. Referencens ikoner er malede — systemets emoji
 * står blegt og fladt ved siden af, og i ét tilfælde viste vores endda et
 * andet motiv end referencen.
 */
export function problemGlyphHTML(id: string, fallback: string, cls: string): string {
  const url = problemArt.get(id);
  if (!url) return `<i class="${cls}" aria-hidden="true">${fallback}</i>`;
  // Målene kommer fra sizes.json, skrevet af build_problem_icons.py. Filerne
  // er skåret ved 3x for skarphed på hi-dpi, men skal STÅ i referencens
  // størrelse — og de tre er ikke lige store der, så en fælles højde i CSS
  // ville presse dem til samme mål.
  const [w, h] = (problemSizes as Record<string, number[]>)[id] ?? [24, 24];
  return `<img class="${cls} ${cls}-art" src="${url}" width="${w}" height="${h}" alt="" aria-hidden="true" draggable="false">`;
}

/** Har elementet et maleri, eller falder det tilbage på emoji? */
export function hasArt(id: string): boolean {
  return art.has(id);
}

/**
 * Rå URL til elementets maleri, eller intet. Til de steder glyphHTML()s faste
 * valg mellem `<img>` og `<span>` ikke passer ind — SVG'en i bogens tidslinje
 * kan ikke rumme et `<img>`, den skal selv bygge et `<image>`.
 */
export function artUrl(id: string): string | undefined {
  return art.get(id);
}

/**
 * Brikkens ansigt som HTML. Maleriet er dekoration — navnet står ved siden af
 * og bærer betydningen — så alt-teksten er tom og billedet skjules for
 * skærmlæsere frem for at blive læst op to gange.
 */
export function glyphHTML(id: string, emoji: string, cls = "emoji"): string {
  const url = art.get(id);
  if (!url) return `<span class="${cls}">${escapeHTML(emoji)}</span>`;
  return `<img class="${cls} ${cls}-art" src="${url}" alt="" aria-hidden="true" draggable="false">`;
}

function escapeHTML(value: string): string {
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
