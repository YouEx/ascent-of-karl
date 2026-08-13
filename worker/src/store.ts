/**
 * Den mindste fælles grænseflade for et nøgle/værdi-lager.
 *
 * Både Durable Objects' rigtige `storage` (get/put) og
 * `InMemoryStore` herunder opfylder den — koordinatoren (`coordinator.ts`)
 * kender kun denne grænseflade og ved aldrig, om den taler med Cloudflare
 * eller med en test.
 */
export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

/** Til tests og lokal udvikling — ingen Cloudflare-runtime nødvendig. */
export class InMemoryStore implements KeyValueStore {
  private map = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put<T = unknown>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }
}
