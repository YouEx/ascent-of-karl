/**
 * Kanonisk indholdsopslag (sikkerhedsrunde 2, punkt 3): workeren stoler
 * ALDRIG på klientens egne navne/kind/stuff/traits/flavor/need-tekster —
 * kun på id'er, som slås op i spillets EGET, bundlede indhold. En klient
 * kan ikke digte et navn eller en smagsprøve ind i prompten, for der er
 * ikke noget frit tekstfelt tilbage at digte i: `WireRequest`
 * (`validate.ts`) har kun `aId`/`bId`/`verdict`/`needId?`/`summer?`.
 *
 * Dette lukker to ting på én gang:
 *   1. Prompt-injektion gennem "flavor"/"name" — feltet findes ikke
 *      længere i den validerede krop.
 *   2. Uendeligt mange unikke cache-nøgler fra opdigtede id'er — et ukendt
 *      id afvises her med 400, FØR cache-opslag og budget nogensinde røres
 *      (kaldes tidligt i `coordinator.ts`s `decide()`).
 *
 * Importerer bevidst JSON-DATA fra `content/`, ikke KODE fra `../../src`
 * (den grænse workeren ellers holder, jf. `cache-key.ts`/`clean.ts`'s
 * kommentarer om "ingen import fra ../../src"): `content/` er spillets
 * egen indholds-sandhed — den samme `src/content.ts` selv læser fra — og
 * indhold er DATA, ikke den slags kode-afhængighed, grænsen er sat imod.
 *
 * OBS — ændres `content/elements.json` eller `content/acts/*.json`, skal
 * workeren GENDEPLOYES (`npx wrangler deploy`), for at kende de nye id'er:
 * indholdet bundles ind i workeren ved deploy, det læses ikke live fra
 * spillets side ved hvert kald.
 */

import elementsData from "../../content/elements.json";
import act1 from "../../content/acts/act-1.json";
import act2 from "../../content/acts/act-2.json";
import { KNOWN_VERDICTS, type WireRequest } from "./validate";
import type { ImproviseWireRequest } from "./improvise-validate";

interface ElementRecord {
  id: string;
  name: string;
  act: number;
  kind?: string;
  stuff?: string;
  scale?: string;
  traits?: string[];
  flavor?: string;
  karlMood?: string;
}

interface ProblemRecord {
  id: string;
  description: string;
}

interface ActRecord {
  problems: ProblemRecord[];
}

const elements = elementsData as ElementRecord[];
const elementById = new Map<string, ElementRecord>(elements.map((e) => [e.id, e]));

const needById = new Map<string, string>(
  [...(act1 as ActRecord).problems, ...(act2 as ActRecord).problems].map((p) => [p.id, p.description]),
);

export interface CanonicalThing {
  id: string;
  name: string;
  /** Sat for rigtigt katalogindhold; valgfri så narratorens rene test-fixtures forbliver små. */
  act?: number;
  kind?: string;
  stuff?: string;
  scale?: string;
  traits: string[];
  flavor?: string;
  karlMood?: string;
}

export interface CanonicalBody {
  a: CanonicalThing;
  b: CanonicalThing;
  verdict: WireRequest["verdict"];
  need?: string;
  summer?: number;
}

export type CanonicalResult = { ok: true; body: CanonicalBody } | { ok: false; reason: string };

/** Slår ét element op ved id. `undefined` for et ukendt id — aldrig en gættet standard. */
export function lookupElement(id: string): CanonicalThing | undefined {
  const el = elementById.get(id);
  if (!el) return undefined;
  return {
    id: el.id,
    name: el.name,
    act: el.act,
    kind: el.kind,
    stuff: el.stuff,
    scale: el.scale,
    traits: el.traits ?? [],
    flavor: el.flavor,
    karlMood: el.karlMood,
  };
}

/** Beskrivelsesteksten for et need-id (et akt-problem). `undefined` for et ukendt id. */
export function lookupNeed(id: string): string | undefined {
  return needById.get(id);
}

/**
 * Bygger den fulde, model-klare krop fra id'er alene. Afviser med en
 * begrundet fejl ved et ukendt `aId`/`bId`/`needId` — `coordinator.ts`s
 * `decide()` oversætter det til 400, FØR cache-opslag og budget røres.
 *
 * Dommen er allerede tjekket af `validate.ts`s `validateBody` (typen
 * `WireRequest["verdict"]` garanterer et kendt medlem af `KNOWN_VERDICTS`);
 * genkontrollen her er billig dybde, ikke dobbeltarbejde clienten kan omgå.
 */
export function resolveCanonicalBody(wire: WireRequest): CanonicalResult {
  const a = lookupElement(wire.aId);
  if (!a) return { ok: false, reason: "ukendt aId" };
  const b = lookupElement(wire.bId);
  if (!b) return { ok: false, reason: "ukendt bId" };
  if (!(KNOWN_VERDICTS as readonly string[]).includes(wire.verdict)) {
    return { ok: false, reason: "ukendt verdikt" };
  }
  let need: string | undefined;
  if (wire.needId !== undefined) {
    need = lookupNeed(wire.needId);
    if (need === undefined) return { ok: false, reason: "ukendt needId" };
  }
  return { ok: true, body: { a, b, verdict: wire.verdict, need, summer: wire.summer } };
}

export interface CanonicalImproviseBody {
  a: CanonicalThing;
  b: CanonicalThing;
  act: number;
}

export type CanonicalImproviseResult =
  | { ok: true; body: CanonicalImproviseBody }
  | { ok: false; reason: string };

/**
 * Improvisation accepterer kun bundlede, kanoniske forældre. Runtime-id'er
 * findes ikke i opslaget og kan derfor aldrig blive model-input.
 */
export function resolveCanonicalImproviseBody(wire: ImproviseWireRequest): CanonicalImproviseResult {
  const a = lookupElement(wire.a);
  if (!a) return { ok: false, reason: "unknown a" };
  const b = lookupElement(wire.b);
  if (!b) return { ok: false, reason: "unknown b" };
  if (a.act === undefined || a.act > wire.act) {
    return { ok: false, reason: "a unavailable in act" };
  }
  if (b.act === undefined || b.act > wire.act) {
    return { ok: false, reason: "b unavailable in act" };
  }

  const [first, second] = a.id <= b.id ? [a, b] : [b, a];
  return { ok: true, body: { a: first, b: second, act: wire.act } };
}
