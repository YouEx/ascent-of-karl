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

  /**
   * IKKE en del af `KeyValueStore` (den grænseflade `decide()` selv kender
   * — ingen produktionskode i `coordinator.ts` bruger `list`). Tilføjet
   * KUN som et testbekvemmeligheds-spejl af den ægte
   * `DurableObjectStorage.list()` (se `cf-types.ts`), så en test kan
   * bekræfte "der blev IKKE skrevet nogen stats-/cache-post" uden at gætte
   * en nøgle først (TASK-008, `tests/worker-coordinator-stats.test.ts`).
   */
  async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? "";
    const result = new Map<string, T>();
    for (const [key, value] of this.map) {
      if (key.startsWith(prefix)) result.set(key, value as T);
    }
    return result;
  }
}
