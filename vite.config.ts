import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OutputChunk } from "rollup";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import type { Plugin, ResolvedConfig } from "vite";
import { defaultExclude, defineConfig } from "vitest/config";

const PAGES_VARIANTS = {
  "production-root": "https://youex.github.io/ascent-of-karl/",
  "improvisation-playtest":
    "https://youex.github.io/ascent-of-karl/playtest/improvisation/",
} as const;

interface ViteChunkMetadata {
  importedAssets?: Set<string>;
  importedCss?: Set<string>;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * Buildkontrakten skrives af Vite selv fra den resolverede compile-time env
 * og Rollups endelige outputgraf. Verifieren skal derfor aldrig gætte mode ud
 * fra en streng, som tilfældigvis findes i det minificerede hovedbundt.
 */
function pagesBuildContract(): Plugin {
  let config: ResolvedConfig | undefined;

  return {
    name: "karl-pages-build-contract",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    writeBundle(outputOptions, bundle) {
      const variant = process.env.KARL_PAGES_VARIANT;
      if (!variant) return;
      if (!(variant in PAGES_VARIANTS)) {
        throw new Error(`Ukendt KARL_PAGES_VARIANT: ${variant}`);
      }
      if (!config || !outputOptions.dir) {
        throw new Error("Pages-buildkontrakten mangler resolveret config/outDir");
      }

      const outDir = resolve(outputOptions.dir);
      const chunks = Object.values(bundle).filter(
        (output): output is OutputChunk => output.type === "chunk",
      );
      const entries = chunks.filter((chunk) => chunk.isEntry);
      if (entries.length !== 1) {
        throw new Error(
          `Pages-buildkontrakten forventede ét entry-chunk, fandt ${entries.length}`,
        );
      }

      const hashFile = (fileName: string): string =>
        createHash("sha256")
          .update(readFileSync(resolve(outDir, fileName)))
          .digest("hex");
      const modules = Object.fromEntries(
        chunks
          .sort((left, right) => left.fileName.localeCompare(right.fileName))
          .map((chunk) => {
            const metadata = (
              chunk as OutputChunk & { viteMetadata?: ViteChunkMetadata }
            ).viteMetadata;
            return [
              chunk.fileName,
              {
                sha256: hashFile(chunk.fileName),
                imports: sortedUnique(chunk.imports),
                dynamicImports: sortedUnique(chunk.dynamicImports),
                preloads: sortedUnique([
                  ...chunk.implicitlyLoadedBefore,
                  ...chunk.referencedFiles,
                  ...(metadata?.importedAssets ?? []),
                  ...(metadata?.importedCss ?? []),
                ]),
              },
            ];
          }),
      );
      const entry = entries[0]!;
      const contract = {
        schema: 2,
        variant,
        publicUrl:
          PAGES_VARIANTS[variant as keyof typeof PAGES_VARIANTS],
        entry: entry.fileName,
        entrySha256: modules[entry.fileName]!.sha256,
        env: {
          mode: config.mode,
          VITE_IMPROVISE_ENABLED:
            config.env.VITE_IMPROVISE_ENABLED ?? "",
          VITE_IMPROVISE_URL: config.env.VITE_IMPROVISE_URL ?? "",
          VITE_NARRATOR_URL: config.env.VITE_NARRATOR_URL ?? "",
        },
        modules,
      };
      writeFileSync(
        resolve(outDir, "pages-build.json"),
        `${JSON.stringify(contract, null, 2)}\n`,
      );
    },
  };
}

export default defineConfig({
  // Relative stier, så builds virker under en underssti (GitHub Pages)
  base: "./",
  plugins: [svelte(), pagesBuildContract()],
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
