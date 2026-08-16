export type SessionReadiness =
  | {
      status: "ready";
      onlineRequired: boolean;
      activePlayAllowed: true;
      archivesReadable: true;
    }
  | {
      status: "network-unavailable";
      onlineRequired: true;
      activePlayAllowed: false;
      archivesReadable: true;
      reason: "network" | "server" | "misconfigured";
    };

export interface RunCredentials {
  runId: string;
  token: string;
  csrf: string;
  expiresAt: number;
}

export interface RunSnapshot<TState = unknown> {
  schemaVersion: 1;
  revision: number;
  snapshot: TState;
  status?: "active" | "ended";
  commentaryCue?: RuntimeCommentaryCue;
}

export interface RunAttemptResult<TState = unknown, TOutcome = unknown>
  extends RunSnapshot<TState> {
  attemptId: string;
  outcome: TOutcome;
}

export type { RuntimeCommentaryResult };
import type {
  RuntimeCommentaryCue,
  RuntimeCommentaryResult,
} from "./runtime-commentary";
