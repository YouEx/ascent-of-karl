export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutViewport {
  width: number;
  height: number;
  isMobile: boolean;
  clientWidth: number;
  scrollWidth: number;
  rects: Record<string, LayoutRect>;
  styles: Record<string, string>;
  signature: number[];
}

export interface LayoutBaseline {
  schemaVersion: number;
  sourceCommit: string;
  recordedAt?: string;
  note?: string;
  maxRectDelta: number;
  maxSignatureMeanDelta: number;
  selectors: string[];
  viewports: Record<string, LayoutViewport>;
}

/** Kaster hvis indholdet er bredere end viewportet. Porten der forhindrer at
 * et vandret overløb nogensinde bliver optaget som "forventet" igen. */
export function assertNoHorizontalOverflow(
  name: string,
  clientWidth: number,
  scrollWidth: number,
): void;

/** Gengiver baseline i filens håndskrevne format, byte for byte. */
export function serialiseBaseline(baseline: LayoutBaseline): string;
