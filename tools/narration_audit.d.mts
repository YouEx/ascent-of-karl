export type NarrationAuditPhase = "start" | "complete";
export type NarrationAuditMode =
  | "recorded"
  | "synthesized"
  | "text-only"
  | "muted";

export interface NarrationAuditEvent {
  phase: NarrationAuditPhase;
  id: string;
  variant: number;
  text: string;
  audioMode: NarrationAuditMode;
}

export function assertNarrationParity(
  events: readonly NarrationAuditEvent[],
): void;
