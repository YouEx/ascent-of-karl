/** Status for én sammenlignet fil. Alt andet end "identisk" er en afvigelse. */
export type LiveFileStatus = string;

export interface LiveFileResult {
  path: string;
  status: LiveFileStatus;
  variant?: string;
  publicUrl?: string;
  local?: string;
  live?: string;
}

export interface LiveDeploySummary {
  ok: boolean;
  checked: number;
  drifted: LiveFileResult[];
}

export interface PagesVariant {
  label: string;
  dir: string;
  indexPath: string;
}

export const VARIANTS: readonly PagesVariant[];

export function sha256(buffer: Buffer): string;

export function planFiles(
  html: string,
  contract: { modules?: Record<string, unknown> } | null | undefined,
): string[];

export function summarise(
  results: readonly LiveFileResult[],
): LiveDeploySummary;

export function verifyLiveDeploy(options?: {
  root?: string;
}): Promise<LiveDeploySummary>;
