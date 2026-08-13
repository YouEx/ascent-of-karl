/** Den smalle, eksakte ledningsform for `POST /improvise`. */

export const IMPROVISE_REQUEST_LIMITS = {
  id: 64,
  minAct: 1,
  maxAct: 5,
} as const;

export interface ImproviseWireRequest {
  a: string;
  b: string;
  act: number;
}

export type ImproviseValidationResult =
  | { ok: true; body: ImproviseWireRequest }
  | { ok: false; reason: string };

function isBoundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= IMPROVISE_REQUEST_LIMITS.id
  );
}

/** Afviser også ekstra felter: browseren må kun sende id, id og akt. */
export function validateImproviseBody(raw: unknown): ImproviseValidationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "invalid schema" };
  }

  const body = raw as Record<string, unknown>;
  const keys = Object.keys(body).sort();
  if (keys.length !== 3 || keys[0] !== "a" || keys[1] !== "act" || keys[2] !== "b") {
    return { ok: false, reason: "invalid schema" };
  }
  if (!isBoundedId(body.a)) return { ok: false, reason: "invalid a" };
  if (!isBoundedId(body.b)) return { ok: false, reason: "invalid b" };
  if (
    typeof body.act !== "number" ||
    !Number.isInteger(body.act) ||
    body.act < IMPROVISE_REQUEST_LIMITS.minAct ||
    body.act > IMPROVISE_REQUEST_LIMITS.maxAct
  ) {
    return { ok: false, reason: "invalid act" };
  }

  return { ok: true, body: { a: body.a, b: body.b, act: body.act } };
}
