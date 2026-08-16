import type {
  RunAttemptResult,
  RunCredentials,
  RunSnapshot,
  SessionReadiness,
} from "../product/session";

export interface SessionClientOptions {
  baseUrl: string;
  onlineRequired: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
  credentialsUpdated?: (credentials: RunCredentials) => void;
}

export class RunRevisionConflict<TState = unknown> extends Error {
  constructor(
    readonly revision: number,
    readonly snapshot: TState,
  ) {
    super("Run revision conflict");
  }
}

export class SessionClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  readonly onlineRequired: boolean;
  readonly baseUrl: string;
  private readonly credentialsUpdated?: (credentials: RunCredentials) => void;

  constructor(options: SessionClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.onlineRequired = options.onlineRequired;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.credentialsUpdated = options.credentialsUpdated;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async readiness(): Promise<SessionReadiness> {
    if (!this.onlineRequired) {
      return {
        status: "ready",
        onlineRequired: false,
        activePlayAllowed: true,
        archivesReadable: true,
      };
    }
    if (!this.baseUrl) {
      return {
        status: "network-unavailable",
        onlineRequired: true,
        activePlayAllowed: false,
        archivesReadable: true,
        reason: "misconfigured",
      };
    }
    try {
      const response = await this.request("/api/v1/session", {
        method: "GET",
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        return {
          status: "network-unavailable",
          onlineRequired: true,
          activePlayAllowed: false,
          archivesReadable: true,
          reason: "server",
        };
      }
      const body = (await response.json()) as Partial<SessionReadiness>;
      if (
        body.status !== "ready" ||
        body.activePlayAllowed !== true ||
        body.archivesReadable !== true
      ) {
        return {
          status: "network-unavailable",
          onlineRequired: true,
          activePlayAllowed: false,
          archivesReadable: true,
          reason: "server",
        };
      }
      return {
        status: "ready",
        onlineRequired: true,
        activePlayAllowed: true,
        archivesReadable: true,
      };
    } catch {
      return {
        status: "network-unavailable",
        onlineRequired: true,
        activePlayAllowed: false,
        archivesReadable: true,
        reason: "network",
      };
    }
  }

  async createRun(seed?: number): Promise<{
    credentials: RunCredentials;
    snapshot: RunSnapshot["snapshot"];
    revision: number;
  }> {
    const response = await this.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(seed === undefined ? {} : { seed }),
    });
    if (!response.ok) throw new Error(`Run creation failed (${response.status})`);
    const body = (await response.json()) as RunCredentials & RunSnapshot;
    return {
      credentials: {
        runId: body.runId,
        token: body.token,
        csrf: body.csrf,
        expiresAt: body.expiresAt,
      },
      snapshot: body.snapshot,
      revision: body.revision,
    };
  }

  private authHeaders(credentials: RunCredentials): Headers {
    return new Headers({
      authorization: `Bearer ${credentials.token}`,
      "x-karl-csrf": credentials.csrf,
    });
  }

  private async ensureCredentials(
    credentials: RunCredentials,
  ): Promise<RunCredentials> {
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (credentials.expiresAt - nowSeconds > 24 * 60 * 60) {
      return credentials;
    }
    const response = await this.request(
      `/api/v1/runs/${credentials.runId}/capability`,
      {
        method: "POST",
        headers: this.authHeaders(credentials),
      },
    );
    if (!response.ok) {
      throw new Error(`Run capability refresh failed (${response.status})`);
    }
    const rotated = (await response.json()) as RunCredentials;
    this.credentialsUpdated?.(rotated);
    return rotated;
  }

  async loadRun<TState>(
    credentials: RunCredentials,
  ): Promise<RunSnapshot<TState>> {
    credentials = await this.ensureCredentials(credentials);
    const response = await this.request(
      `/api/v1/runs/${credentials.runId}`,
      { method: "GET", headers: this.authHeaders(credentials) },
    );
    if (!response.ok) throw new Error(`Run load failed (${response.status})`);
    return (await response.json()) as RunSnapshot<TState>;
  }

  async attempt<TState, TOutcome>(
    credentials: RunCredentials,
    request: {
      attemptId: string;
      expectedRevision: number;
      pair: [string, string];
    },
  ): Promise<RunAttemptResult<TState, TOutcome>> {
    credentials = await this.ensureCredentials(credentials);
    const headers = this.authHeaders(credentials);
    headers.set("content-type", "application/json");
    const response = await this.request(
      `/api/v1/runs/${credentials.runId}/attempts`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ schemaVersion: 1, ...request }),
      },
    );
    const body = (await response.json()) as Record<string, unknown>;
    if (response.status === 409) {
      throw new RunRevisionConflict(
        body.revision as number,
        body.snapshot as TState,
      );
    }
    if (!response.ok) {
      throw new Error(`Run attempt failed (${response.status})`);
    }
    return body as unknown as RunAttemptResult<TState, TOutcome>;
  }

  async deleteRun(credentials: RunCredentials): Promise<void> {
    credentials = await this.ensureCredentials(credentials);
    const response = await this.request(
      `/api/v1/runs/${credentials.runId}`,
      { method: "DELETE", headers: this.authHeaders(credentials) },
    );
    if (!response.ok) throw new Error(`Run delete failed (${response.status})`);
  }
}
