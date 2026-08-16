const TOKEN_VERSION = 1;
const MAX_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

export interface RunCapability {
  version: 1;
  runId: string;
  csrf: string;
  expiresAt: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(bytes = 24): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
  );
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) {
    diff |= left[index]! ^ right[index]!;
  }
  return diff === 0;
}

export async function createRunCapability(options: {
  secret: string;
  runId: string;
  now: number;
  lifetimeSeconds?: number;
}): Promise<{ token: string; capability: RunCapability }> {
  const lifetime = Math.min(
    MAX_LIFETIME_SECONDS,
    Math.max(60, options.lifetimeSeconds ?? MAX_LIFETIME_SECONDS),
  );
  const capability: RunCapability = {
    version: TOKEN_VERSION,
    runId: options.runId,
    csrf: randomToken(18),
    expiresAt: Math.floor(options.now / 1000) + lifetime,
  };
  const payload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(capability)),
  );
  const signature = bytesToBase64Url(await hmac(options.secret, payload));
  return { token: `${payload}.${signature}`, capability };
}

export async function verifyRunCapability(options: {
  secret: string | undefined;
  token: string | null;
  csrf: string | null;
  runId: string;
  now: number;
}): Promise<RunCapability | null> {
  if (!options.secret || !options.token || !options.csrf) return null;
  const parts = options.token.split(".");
  if (parts.length !== 2) return null;
  const [payload, encodedSignature] = parts;
  if (!payload || !encodedSignature) return null;
  let expected: Uint8Array;
  let actual: Uint8Array;
  let capability: RunCapability;
  try {
    expected = await hmac(options.secret, payload);
    actual = base64UrlToBytes(encodedSignature);
    capability = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payload)),
    ) as RunCapability;
  } catch {
    return null;
  }
  if (!timingSafeEqual(expected, actual)) return null;
  if (
    capability.version !== TOKEN_VERSION ||
    capability.runId !== options.runId ||
    capability.csrf !== options.csrf ||
    capability.expiresAt < Math.floor(options.now / 1000)
  ) {
    return null;
  }
  return capability;
}
