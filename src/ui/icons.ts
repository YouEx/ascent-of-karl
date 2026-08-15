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

const svg = (body: string, paint = "", viewBox = "0 0 24 24"): string =>
  `<svg viewBox="${viewBox}"${paint ? ` data-paint="${paint}"` : ""} aria-hidden="true" focusable="false">${body}</svg>`;

/* Solens 12 stråler ligger på en cirkel med fast inder- og yderradius. Skrevet
   ud i hånden er de 48 tal uden nogen indbyrdes lighed — den slags ciffersuppe
   komprimerer elendigt og kostede alene bundtbudgettets sidste luft. Regnet ud
   her koster de én løkke, og formlen dokumenterer samtidig geometrien. */
const rays = Array.from({ length: 12 }, (_, i) => {
  const a = (i * Math.PI) / 6 - Math.PI / 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const at = (r: number) => `${(12 + c * r).toFixed(1)} ${(12 + s * r).toFixed(1)}`;
  return `M${at(7.7)}L${at(9.9)}`;
}).join("");

/* Hulemundingens takkede krone tegnes ÉN gang og males to gange: først bred i
   klippekantens tone, så smal i mørket ovenpå (se style.css). To hånd­tegnede
   varianter af den samme takkede kontur ville koste fuld pris i bundtet, mens
   den samme streng to gange er nærmest gratis efter gzip. */
// Konturen er aftegnet fra referencens hulemund (mørkere end L<100, største
// sammenhængende klat): en bue der er 32,5 bred og 30,8 høj — forhold 1,05,
// målt til 1,0 i referencen. Buen er bevidst uregelmæssig: korte rette stykker
// (klippeknuder) skifter med bløde Q-buer, så randen læses som hugget sten og
// ikke som et blødt badge. Rene trappetrin blev prøvet og forkastet — de
// læste som murtinder.
const dome =
  "M6.3 38 6.3 29.6Q6.9 25.4 8.4 22.1L9.9 20.4Q11.2 18.3 13.4 17L15.4 16.2 16.2 13.9Q17.1 11.6 18.8 10L20.2 8.9Q21.2 8.1 22.6 8.1L24.2 8.2Q25.4 8.4 26.2 9.7L27.9 11.5Q29.2 13.2 30.3 14.6L32.4 15.8Q34.6 17.1 35.9 19.4L37 21.6Q38.3 25.2 38.8 29.6L38.8 38Z";

export const icons = {
  book: svg(
    `<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z"/>`,
  ),
  restart: svg(`<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/>`),
  close: svg(`<path d="M6 6l12 12"/><path d="M18 6L6 18"/>`),
  soundOn: svg(
    `<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11"/>`,
  ),
  soundOff: svg(
    `<path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16.5 10l4 4"/><path d="M20.5 10l-4 4"/>`,
  ),

  /* Referencens sol: en tyk spiral på ~3 vindinger med 12 udstrålende stråler.
     Spiralen er bygget som en kæde af halvcirkler med konstant tilvækst
     (1,08 pr. halvcirkel), så mellemrummet mellem vindingerne er lige så
     bredt som stregen selv — vokser tilvæksten ikke, smelter vindingerne
     sammen til en klat. Strålerne står med en lille uregelmæssighed i vinkel
     og længde, fordi referencens er hugget, ikke sat op med passer. */
  titleSpiral: svg(
    `<path d="M12.5 12A1.04 1.04 0 0 0 10.42 12A2.12 2.12 0 0 0 14.66 12A3.2 3.2 0 0 0 8.26 12A4.28 4.28 0 0 0 16.82 12A5.36 5.36 0 0 0 6.1 12A6.2 6.2 0 0 0 18.5 12"/><path stroke-width="1.35" d="${rays}"/>`,
    "carve",
  ),

  /* Referencens trofæ: udfyldt metalsilhuet — rand, konisk skål, stilk,
     udsvajet fod og sokkel — med to ÅBNE hanke, der er stregede, ikke
     fyldte. Dråben i skålen er referencens egen prægning. */
  titleTrophy: svg(
    `<path d="M8.8 7.1h6.4v1.15H8.8z"/><path d="M9.25 8.25h5.5l-.6 3.5a2.15 2.15 0 0 1-4.3 0z"/><path d="M11.25 13.55h1.5v2h-1.5z"/><path d="M10.15 15.55h3.7l1.05 1.35h-5.8z"/><path d="M8.5 16.9h7v1.15h-7z"/><path d="M12 9.4a.86.86 0 0 1 .78 1.22l-.78 1.52-.78-1.52A.86.86 0 0 1 12 9.4z" data-paint="void"/><path d="M9.2 8.95H7.05a.95.95 0 0 0-.95.95c0 1.7 1.2 3.15 2.85 3.55" data-paint="stroke"/><path d="M14.8 8.95h2.15a.95.95 0 0 1 .95.95c0 1.7-1.2 3.15-2.85 3.55" data-paint="stroke"/>`,
    "fill",
  ),

  /* Referencens velkomstmotiv: en hulemunding med takket klippekrone, to
     klippespyd til side, en jordlinje med kviste — og en lys figur inde i
     mørket. Figurens lemmer er streger med runde ender, ligesom referencens
     tykke, malede arme og ben; hoved og krop er fyldte. Sammen læses de som
     én silhuet. */
  titleCave: svg(
    // Siv, ikke pæle: referencen har tre spredte strå i hver side, der vifter
    // udad fra klippefoden. To lodrette bjælker læste som stakit.
    `<path data-part="reed" d="M4.6 38.2 3.1 25.4M6.2 38.2 6.6 27.9M5.4 38.2 8.9 29.6M40.4 38.2 41.9 25.4M38.8 38.2 38.4 27.9M39.6 38.2 36.1 29.6"/>` +
      `<path data-part="rim" d="${dome}"/>` +
      // Svælget er en blød overgang, ikke en indsat form: en radial gradient
      // fra mørkest i midten til hulekroppens tone ved munden. Et indsat,
      // mørkere dome-omrids blev prøvet først og forkastet — dets kant læste
      // som en klistermærke-ellipse inde i hulen.
      `<defs><radialGradient id="caveThroat" gradientUnits="userSpaceOnUse" cx="22.5" cy="30" r="16">` +
      `<stop offset="0" stop-color="var(--cave-depth)"/>` +
      `<stop offset=".55" stop-color="var(--cave-depth)"/>` +
      `<stop offset="1" stop-color="var(--cave-dark)"/></radialGradient></defs>` +
      // Paint sættes i style.css, ikke her: en præsentationsattribut har ingen
      // specificitet og taber til stylesheet-regelen.
      `<path data-part="cave" d="${dome}"/>` +
      // Figuren er hugget, ikke tegnet med streger: fyldt torso der smalner mod
      // hoften, og lemmer tykke nok til at læse som krop ved 69 px.
      `<g data-part="figure">` +
      `<circle cx="22.6" cy="18.6" r="2.7"/>` +
      `<path d="M20.1 21.5Q22.6 20.5 25.1 21.5L24.2 28.4Q22.6 29.1 21 28.4Z"/>` +
      `<path data-limb d="M21.1 22.4 17.2 19.3M24.1 22.4 28 19.3M21.7 28.2 20.1 34.3M23.5 28.2 25.1 34.3"/>` +
      `</g>` +
      // Jorden har småsten i referencen, ikke en ren streg.
      `<path data-part="ground" d="M3 37.4h40M7 39.3l4.6-1.4M39 39.3l-4.6-1.4M18.4 39.6l3.6-1.1"/>` +
      `<path data-part="pebble" d="M14.6 37.3q1.1-1 2.2 0M27.4 37.3q1.1-1 2.2 0M21.2 36.6q.9-.8 1.8 0"/>`,
    "scene",
    "0 0 46 42",
  ),
} as const;
