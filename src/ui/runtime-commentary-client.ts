import type { SpokenLine } from "../narrator/narrator";
import type { RunCredentials } from "../product/session";
import type {
  RuntimeCommentaryCue,
  RuntimeCommentaryRole,
} from "../product/runtime-commentary";

interface RuntimeCommentaryClientPort {
  commentary(
    credentials: RunCredentials,
    eventId: string,
  ): Promise<{
    schemaVersion: 1;
    eventId: string;
    text: string;
    roles: readonly RuntimeCommentaryRole[];
    audioAvailable: boolean;
  }>;
  commentaryAudio(
    credentials: RunCredentials,
    eventId: string,
  ): Promise<Response>;
}

export interface PreparedRuntimeCommentary {
  line: SpokenLine;
  audio?: Response;
}

export async function waitForRuntimePresentation(options: {
  line: SpokenLine;
  enqueue: (line: SpokenLine) => void;
  cancel: (lineId: string) => void;
  timeoutMs?: number;
}): Promise<boolean> {
  const {
    line,
    enqueue,
    cancel,
    timeoutMs = 8000,
  } = options;
  let presented = false;
  let resolvePresented!: () => void;
  const presentedPromise = new Promise<void>((resolve) => {
    resolvePresented = resolve;
  });
  line.onPresent = () => {
    if (presented) return;
    presented = true;
    resolvePresented();
  };
  enqueue(line);
  const result = await Promise.race([
    presentedPromise.then(() => true),
    new Promise<false>((resolve) =>
      setTimeout(() => resolve(false), timeoutMs),
    ),
  ]);
  if (!result) {
    cancel(line.id);
    return false;
  }
  return true;
}

function within<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("runtime commentary timeout")),
      timeoutMs,
    );
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function prepareRuntimeCommentary(options: {
  client: RuntimeCommentaryClientPort;
  credentials: RunCredentials;
  cue: RuntimeCommentaryCue;
  currentTurn: () => number;
  commentaryTimeoutMs?: number;
  audioHeaderTimeoutMs?: number;
  audioEnabled?: boolean;
}): Promise<PreparedRuntimeCommentary | null> {
  const {
    client,
    credentials,
    cue,
    currentTurn,
    commentaryTimeoutMs = 2500,
    audioHeaderTimeoutMs = 500,
    audioEnabled = true,
  } = options;
  if (currentTurn() !== cue.turn) return null;

  let commentary: Awaited<
    ReturnType<RuntimeCommentaryClientPort["commentary"]>
  >;
  try {
    commentary = await within(
      client.commentary(credentials, cue.eventId),
      commentaryTimeoutMs,
    );
  } catch {
    return null;
  }
  if (
    currentTurn() !== cue.turn ||
    commentary.eventId !== cue.eventId
  ) {
    return null;
  }

  let audio: Response | undefined;
  if (audioEnabled && commentary.audioAvailable) {
    try {
      audio = await within(
        client.commentaryAudio(credentials, cue.eventId),
        audioHeaderTimeoutMs,
      );
    } catch {
      audio = undefined;
    }
  }
  if (currentTurn() !== cue.turn) return null;

  return {
    line: {
      id: `runtime:${cue.eventId}`,
      variant: 0,
      text: commentary.text,
      roles: [...commentary.roles],
      source: "runtime-llm",
    },
    audio,
  };
}
