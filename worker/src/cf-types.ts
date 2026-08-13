/**
 * Håndskrevne, minimale typer for de Cloudflare-specifikke grænseflader
 * denne worker bruger — i stedet for at tilføje `@cloudflare/workers-types`
 * som ny afhængighed for et par grænseflader, brugt to steder
 * (`coordinator-do.ts`, `index.ts`).
 *
 * Wrangler håndhæver intet ved kompilering ud fra disse typer — den kalder
 * blot `new Coordinator(state, env)` og forventer en `fetch`-metode. Typerne
 * her er alene til vores egen sikkerhed, ikke en kontrakt Cloudflare selv
 * kender til.
 */

export interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  /** Sikkerhedsrunde 2, punkt 4: oprydning kræver at kunne slette en post. */
  delete(key: string): Promise<boolean>;
  /** Alle poster under et præfiks — sådan finder oprydningen sine kandidater. */
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
  /** Hvornår næste alarm er sat til at ringe, eller `null` hvis ingen er sat. */
  getAlarm(): Promise<number | null>;
  /** Beder Durable Object'et om at kalde `alarm()` på dette tidspunkt. */
  setAlarm(scheduledTime: number | Date): Promise<void>;
}

export interface DurableObjectState {
  storage: DurableObjectStorage;
}

export interface DurableObjectId {
  toString(): string;
}

export interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

export interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
