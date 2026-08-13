/**
 * Minimale ambient-typer for de Node-indbyggede moduler, testene rører ved
 * disk (scratch-mapper under .judge/test-scratch/, aldrig systemets /tmp).
 * Samme filosofi som raw.d.ts: repoet installerer bevidst ikke `@types/node`
 * — en testfil skal ikke kunne trække en hel typepakke ind i et projekt der
 * klarer sig uden. Denne fil dækker KUN de funktioner, der reelt bruges.
 */
declare module "node:fs" {
  interface Stats {
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }

  export const constants: {
    O_NOFOLLOW?: number;
    O_RDONLY: number;
  };

  export function appendFileSync(path: string, data: string): void;
  export function closeSync(fd: number): void;
  export function existsSync(path: string): boolean;
  export function fstatSync(fd: number): Stats;
  export function lstatSync(path: string): Stats;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function openSync(path: string, flags: number): number;
  export function readFileSync(path: string, encoding: string): string;
  export function readSync(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
  ): number;
  export function readdirSync(path: string): string[];
  export function renameSync(oldPath: string, newPath: string): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function statSync(path: string): Stats;
  export function symlinkSync(target: string, path: string, type?: "dir" | "file"): void;
  export function writeFileSync(path: string, data: string): void;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function resolve(...parts: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}

declare module "node:child_process" {
  interface Output {
    toString(encoding?: string): string;
  }

  interface TextStream {
    setEncoding(encoding: string): void;
    on(event: "data", listener: (chunk: string) => void): void;
  }

  interface ChildProcess {
    killed: boolean;
    exitCode: number | null;
    signalCode: string | null;
    stdout: TextStream;
    stderr: TextStream;
    on(event: "close", listener: (code: number | null) => void): void;
  }

  export function execFileSync(
    file: string,
    args?: readonly string[],
    options?: {
      cwd?: string;
      stdio?: "pipe" | "inherit";
      timeout?: number;
    },
  ): Output;

  export function spawn(
    file: string,
    args?: readonly string[],
    options?: {
      cwd?: string;
      stdio?: "ignore" | "pipe" | "inherit";
    },
  ): ChildProcess;
}

declare module "node:http" {
  interface IncomingMessage {
    url?: string;
    headers: Record<string, string | string[] | undefined>;
  }

  interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(data?: string): void;
  }

  interface Server {
    listen(port: number, host: string, listener: () => void): void;
    address(): { port: number } | string | null;
    close(listener: (error?: Error) => void): void;
  }

  export function createServer(
    listener: (request: IncomingMessage, response: ServerResponse) => void,
  ): Server;
}

declare const process: {
  execPath: string;
  kill(pid: number, signal?: number | string): boolean;
};
