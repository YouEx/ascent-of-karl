import wordmarkDesktopUrl from "../assets/art/title-materials/wordmark-desktop.webp";
import wordmarkMobileUrl from "../assets/art/title-materials/wordmark-mobile.webp";

/**
 * Vite-resolverede titelaktiver med de native mål fra
 * tools/art/title-materials.manifest.json. UI'et må skalere ned, aldrig op.
 */
export const TITLE_WORDMARKS = {
  desktop: {
    src: wordmarkDesktopUrl,
    width: 545,
    height: 320,
  },
  mobile: {
    src: wordmarkMobileUrl,
    width: 436,
    height: 256,
  },
} as const;
