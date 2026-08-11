/**
 * `?raw` er Vites egen måde at læse en fil som streng. Det er valgt frem for
 * `node:fs`, fordi repoet bevidst ikke har `@types/node` — en testfil skal ikke
 * kunne trække en hel typepakke ind i et projekt der klarer sig uden.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}
