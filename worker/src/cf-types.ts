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
