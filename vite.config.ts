import { defineConfig } from "vitest/config";

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
  },
});
