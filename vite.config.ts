import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  // Relative stier, så builds virker under en underssti (GitHub Pages)
  base: "./",
  test: {
    // Vitest stubber som udgangspunkt CSS-importer til tom streng. Uden denne
    // linje ville tests/design-tokens.test.ts læse tokens.css som "" og BESTÅ
    // ved at måle ingenting — den værste slags grøn test. Testen har derfor
    // også en eksplicit "filen er faktisk læst"-kontrol, så fejlen ikke kan
    // liste sig ind igen ad en anden vej.
    css: true,
    // TASK-030: tests/visual.test.ts kører en rigtig browser-optagelse
    // (bygning + vite preview + Playwright) og en rigtig Python-scoring —
    // sekunder, ikke millisekunder. Den må ALDRIG køre i npm test's hurtige
    // sti; et separat spor (npm run test:visual, se
    // vitest.visual.config.ts) inkluderer kun den langsomme fil.
    exclude: [...defaultExclude, "tests/visual.test.ts"],
  },
});
