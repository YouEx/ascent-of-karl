/** Gzip-loft for produktionsroden (improvisationen slået fra). */
export const MAIN_BUNDLE_GZIP_BUDGET: number;

/** Gzip-loft for playtest-varianten (improvisationen slået til, større bundt). */
export const PLAYTEST_BUNDLE_GZIP_BUDGET: number;

/** Røgalarmsloft for et løst `vite build` — en variant, der ikke udgives. */
export const LOCAL_BUNDLE_GZIP_BUDGET: number;

/** Loftet hører til varianten, ikke til kaldstedet. */
export function budgetForOutDir(outDir?: string, root?: string): number;

export function checkBundleBudget(options?: {
  root?: string;
  outDir?: string;
  log?: (message: string) => void;
  budget?: number;
}): void;

/** Er mappen bygget af build:pages, eller er det et løst `vite build`? */
export function isPagesArtifact(outDir?: string, root?: string): boolean;
