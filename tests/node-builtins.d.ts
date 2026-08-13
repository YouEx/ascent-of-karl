/**
 * Minimale ambient-typer for de Node-indbyggede moduler, testene rører ved
 * disk (scratch-mapper under .judge/test-scratch/, aldrig systemets /tmp).
 * Samme filosofi som raw.d.ts: repoet installerer bevidst ikke `@types/node`
 * — en testfil skal ikke kunne trække en hel typepakke ind i et projekt der
 * klarer sig uden. Denne fil dækker KUN de funktioner, der reelt bruges.
 */
declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function mkdtempSync(prefix: string): string;
  export function readFileSync(path: string, encoding: string): string;
  export function readdirSync(path: string): string[];
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
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
  interface TextStream {
    setEncoding(encoding: string): void;
    on(event: "data", listener: (chunk: string) => void): void;
  }

  interface ChildProcess {
    stderr: TextStream;
    on(event: "close", listener: (code: number | null) => void): void;
  }

  export function spawn(
    command: string,
    args: string[],
    options?: { cwd?: string },
  ): ChildProcess;
}
