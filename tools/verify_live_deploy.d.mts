/** Status for én sammenlignet fil. Alt andet end "identisk" er en afvigelse. */
export type LiveFileStatus = string;

export interface LiveFileResult {
  path: string;
  status: LiveFileStatus;
  variant?: string;
  publicUrl?: string;
  local?: string;
  live?: string;
  /** Sat når fejlen var transportlaget (netværk, 429, 5xx) — ikke bytedrift. */
  transport?: boolean;
}

export interface LiveDeploySummary {
  ok: boolean;
  checked: number;
  drifted: LiveFileResult[];
  unreachable: LiveFileResult[];
  /** Sat af verifyLiveDeploy, når Pages svarede 429 undervejs. */
  rateLimited?: boolean;
}

export interface PagesVariant {
  label: string;
  dir: string;
  indexPath: string;
  nested: readonly string[];
}

export interface PagesContract {
  schema?: unknown;
  modules?: Record<string, unknown>;
}

export const VARIANTS: readonly PagesVariant[];

export const SUPPORTED_CONTRACT_SCHEMA: number;

export function sha256(buffer: Buffer): string;

export function listVariantFiles(
  dir: string,
  nested?: readonly string[],
): string[];

export function planFiles(
  html: string,
  contract: PagesContract | null | undefined,
  walked?: readonly string[],
): string[];

export function summarise(
  results: readonly LiveFileResult[],
): LiveDeploySummary;

export function verifyLiveDeploy(options?: {
  root?: string;
  onProgress?: (progress: { variant: string; total: number }) => void;
  delays?: readonly number[];
  throttle?: Throttle;
}): Promise<LiveDeploySummary>;

export function isTransient(status: number): boolean;

/** Fælles bremse: ét 429 standser alle arbejdere, ikke kun den, der så det. */
export interface Throttle {
  readonly tripped: boolean;
  readonly trips: number;
  readonly exhausted: boolean;
  settle(): Promise<void>;
  pause(ms: number): void;
}

export function createThrottle(options?: {
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}): Throttle;

/** CDN'ets eget `Retry-After` vinder over vores stige, klippet til 60 s. */
export function retryAfterMs(
  header: string | null | undefined,
  fallback: number,
): number;

export const RETRY_DELAYS_MS: readonly number[];

export function fetchLive(
  url: URL | string,
  delays?: readonly number[],
  throttle?: Throttle,
): Promise<{ response?: Response; failure?: LiveFileResult }>;
