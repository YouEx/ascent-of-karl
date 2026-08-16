/**
 * Fortællerens stemme, når den skal skrives på stedet.
 *
 * Spillet ligger på GitHub Pages og har ingen server. Denne worker er den
 * eneste grund til at have en: den holder API-nøglen, så den aldrig kommer
 * i nærheden af browseren, og den holder prompten, så replikken lyder som
 * fortælleren og ikke som en assistent.
 *
 * Fase 2 tilføjede en Durable Object ("Coordinator", se `coordinator-do.ts`)
 * som eneste stateful komponent: ét globalt, navngivet objekt holder det
 * rullende rate-limit-vindue pr. IP-hash, det daglige opstrømsloft og den
 * delte cache. Lav spiltrafik gør ét globalt objekt til den simpleste
 * pålidelige løsning — se `plan/feature-live-narrator-1.md`, TASK-002-004.
 *
 * Denne fil håndhæver oprindelsespolitikken (SEC-002) som en RIGTIG 403,
 * før koordinatoren nås — CORS-headere alene stopper ikke en klient, der
 * ikke er en browser (kun browseren selv håndhæver CORS; `curl` sætter
 * bare selv en `Origin`-header og er ligeglad). Men origin er ligeledes
 * blot endnu en header, EN KLIENT SELV SÆTTER — en angriber kan forfalske
 * den lige så let som en browser aldrig ville finde på at gøre det
 * frivilligt. Origin-tjekket er derfor forsvar-i-dybden VED SIDEN AF
 * kvoterne (rate limit + daglige loft), IKKE en erstatning for dem: det
 * stopper en tilfældig fremmed side eller et uændret script fra ved et
 * uheld at ramme endpointet, men stopper ALDRIG en modstander der bevidst
 * sætter `Origin`-headeren til den tilladte værdi. Se
 * `plan/feature-live-narrator-1.md`, RISK-001.
 *
 * Sikkerhedsrunde 2, punkt 1: denne fil er også der, hvor klientens
 * IDENTITET fastslås — og KUN her. Kun kode, der kører direkte på
 * Cloudflares egen netværkskant, kan stole på `cf-connecting-ip` (se
 * `ip.ts`); Durable Object'et længere inde ser aldrig klientens rå IP, kun
 * en allerede-hashet, formvalideret streng, videresendt i en intern header
 * denne fil ALTID overskriver — uanset hvad en anmodning måtte indeholde af
 * den samme header i forvejen.
 *
 * TASK-008 tilføjer `GET /admin/pairs`, og improvisationssporet genbruger
 * samme autentificerede mønster til `GET /admin/improvisations`.
 * `/admin/pairs` er den
 * høstede-efterspørgsel-eksport (se `stats.ts`). Det er BEVIDST IKKE en del
 * af narrator-strømmen ovenfor: det omgår oprindelsespolitikken (det er
 * ikke ment til browserkald — se `tools/live_pair_export.mjs` — og sætter
 * derfor aldrig en meningsfuld `Origin`), men kræver i stedet et
 * bearer-token (`ADMIN_EXPORT_TOKEN`, en obligatorisk hemmelighed, samme
 * "ingen hemmelighed = ingen adgang"-mønster som `IP_HASH_SALT` ovenfor).
 * Selve token-sammenligningen (`admin.ts`s `isValidAdminToken`) sker HER,
 * ved kanten — Durable Object'et ser ALDRIG det rå token, kun en intern
 * markørheader (`ADMIN_VERIFIED_HEADER`), sat KUN efter en bestået
 * kontrol, præcis som `INTERNAL_IP_HASH_HEADER` ovenfor. Det er samme
 * tillidsprincip, anvendt på en anden hemmelighed.
 *
 * Udrulning: se docs/deployment/live-narrator.md.
 *
 * Uden denne worker kører spillet præcis som før. Den er en forbedring af
 * halen, ikke en afhængighed.
 */

import type { DurableObjectNamespace } from "./cf-types";
import type { CoordinatorEnv } from "./coordinator-do";
import { parseAllowedOrigins, isOriginAllowed, corsHeaders } from "./origin";
import { clientIpFromRequest, hashClientIp, INTERNAL_IP_HASH_HEADER } from "./ip";
import { isValidAdminToken, ADMIN_VERIFIED_HEADER } from "./admin";
import {
  createRunCapability,
  verifyRunCapability,
} from "./run-auth";
import {
  RUN_INTERNAL_INIT_HEADER,
  RUN_INTERNAL_VERIFIED_HEADER,
  RUNTIME_COMMENTARY_INTERNAL_HEADER,
} from "./run-do";
import { GENERATED_INTERNAL_CANDIDATES_HEADER } from "./generated-catalog";
import { RUNTIME_TTS_INTERNAL_HEADER } from "./runtime-tts";
import { isBodyTooLarge, isJsonContentType } from "./validate";

export { Coordinator } from "./coordinator-do";
export { Run } from "./run-do";

interface Env extends CoordinatorEnv {
  /** Kommasepareret liste. Tom = alle (kun til lokal brug, SEC-002). */
  ALLOWED_ORIGINS?: string;
  /**
   * Obligatorisk hemmelighed (Worker secret, IKKE en almindelig var) —
   * uden salt er IP-hashen let at regne baglæns for enhver, der allerede
   * kender IP'en, og "hashet, men uden salt" er reelt ingen beskyttelse.
   * Mangler den, fejler denne fil LUKKET (503) frem for at hashe med et
   * gættet standard-salt.
   */
  IP_HASH_SALT?: string;
  /**
   * Obligatorisk hemmelighed (Worker secret, TASK-008) for admin-
   * eksporter. Mangler den, fejler `handleAdminExport` LUKKET (401) for
   * ALLE admin-forsøg — se `admin.ts`s `isValidAdminToken`. Sættes KUN hvis
   * høstningen er aktiveret, aldrig i klartekst i `wrangler.toml`:
   *   npx wrangler secret put ADMIN_EXPORT_TOKEN
   */
  ADMIN_EXPORT_TOKEN?: string;
  /** HMAC secret for run capabilities. Production enable fails closed without it. */
  RUN_AUTH_SECRET?: string;
  COORDINATOR: DurableObjectNamespace;
  RUNS: DurableObjectNamespace;
}

/**
 * De høstede admin-eksporter. Egen,
 * lille funktion (ikke flettet ind i narrator-strømmen nedenfor): den har
 * en helt anden godkendelsesform (bearer-token, ikke oprindelse+IP-hash),
 * og skal ALDRIG kunne nå modellen eller røre budgettet, uanset hvad der
 * sker i resten af filen.
 */
async function handleAdminExport(req: Request, env: Env): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "GET only" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  // Selve sammenligningen er konstant-tids OG fejler LUKKET uden en
  // konfigureret hemmelighed — se `admin.ts`. Ingen begrundelse gives
  // nogensinde tilbage, uanset HVORFOR den fejlede.
  const authorized = await isValidAdminToken(req.headers.get("authorization"), env.ADMIN_EXPORT_TOKEN);
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Klon anmodningen: fjern det RÅ token (Durable Object'et skal aldrig se
  // det), sæt i stedet KUN den interne markørhelt — betingelsesløst, uanset
  // om en klient selv forsøgte at sætte den samme markør (den ville alligevel
  // aldrig kunne bestå token-tjekket ovenfor uden det ægte token, men denne
  // fil gætter aldrig — den sætter altid sin EGEN, netop bekræftede værdi).
  const internalHeaders = new Headers(req.headers);
  internalHeaders.delete("authorization");
  internalHeaders.set(ADMIN_VERIFIED_HEADER, "1");
  const forwarded = new Request(req, { headers: internalHeaders });

  const id = env.COORDINATOR.idFromName("global");
  const stub = env.COORDINATOR.get(id);
  return stub.fetch(forwarded);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/healthz") {
      const ready = Boolean(
        env.RUN_AUTH_SECRET && env.OPENAI_API_KEY && env.IP_HASH_SALT,
      );
      return new Response(
        JSON.stringify({
          status: ready ? "ready" : "misconfigured",
          runtimeCommentaryAvailable: Boolean(env.OPENAI_API_KEY),
          runtimeVoiceAvailable: Boolean(env.CARTESIA_API_KEY),
        }),
        {
          status: ready ? 200 : 503,
          headers: { "content-type": "application/json" },
        },
      );
    }

    // Admin-eksporten omgår oprindelsespolitikken MED VILJE (se
    // fil-kommentaren) — tjekkes FØR Origin/CORS, som slet ikke er
    // relevante for et bearer-token-beskyttet server-til-server-kald.
    if (
      url.pathname === "/admin/pairs" ||
      url.pathname === "/admin/improvisations"
    ) {
      return handleAdminExport(req, env);
    }
    if (url.pathname.startsWith("/internal/")) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    const origin = req.headers.get("origin");
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const kors = corsHeaders(origin, allowed);

    if (req.method === "OPTIONS") return new Response(null, { headers: kors });

    if (!isOriginAllowed(origin, allowed)) {
      return new Response(JSON.stringify({ error: "origin not allowed" }), {
        status: 403,
        headers: { ...kors, "content-type": "application/json" },
      });
    }

    // Identiteten fastslås HER, ved selve kanten — se `ip.ts`s dokumentation.
    // `cf-connecting-ip` kan en klient ikke forfalske; findes den alligevel
    // ikke (fx en forespørgsel udenfor Cloudflares netværk), er der ingen
    // troværdig identitet at hashe, og der er intet fornuftigt at gøre
    // udover at fejle lukket — aldrig at gætte videre med et sentinel.
    const ip = clientIpFromRequest(req);
    if (!ip) {
      return new Response(JSON.stringify({ error: "no trusted client identity" }), {
        status: 503,
        headers: { ...kors, "content-type": "application/json" },
      });
    }
    if (!env.IP_HASH_SALT) {
      return new Response(JSON.stringify({ error: "server misconfigured" }), {
        status: 503,
        headers: { ...kors, "content-type": "application/json" },
      });
    }
    const ipHash = await hashClientIp(ip, env.IP_HASH_SALT);

    if (url.pathname === "/api/v1/session") {
      if (req.method !== "GET") {
        return new Response(JSON.stringify({ error: "GET only" }), {
          status: 405,
          headers: { ...kors, "content-type": "application/json" },
        });
      }
      const activePlayAllowed = Boolean(
        env.RUN_AUTH_SECRET && env.OPENAI_API_KEY,
      );
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          onlineRequired: true,
          status: activePlayAllowed ? "ready" : "network-unavailable",
          activePlayAllowed,
          archivesReadable: true,
          runtimeCommentaryAvailable: Boolean(env.OPENAI_API_KEY),
          runtimeVoiceAvailable: Boolean(env.CARTESIA_API_KEY),
        }),
        {
          status: activePlayAllowed ? 200 : 503,
          headers: { ...kors, "content-type": "application/json" },
        },
      );
    }

    if (url.pathname === "/api/v1/runs") {
      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "POST only" }), {
          status: 405,
          headers: { ...kors, "content-type": "application/json" },
        });
      }
      if (!env.RUN_AUTH_SECRET) {
        return new Response(JSON.stringify({ error: "server misconfigured" }), {
          status: 503,
          headers: { ...kors, "content-type": "application/json" },
        });
      }
      if (!isJsonContentType(req.headers.get("content-type"))) {
        return new Response(
          JSON.stringify({ error: "content type must be application/json" }),
          {
            status: 415,
            headers: { ...kors, "content-type": "application/json" },
          },
        );
      }
      const rawText = await req.text();
      if (isBodyTooLarge(rawText)) {
        return new Response(JSON.stringify({ error: "body too large" }), {
          status: 413,
          headers: { ...kors, "content-type": "application/json" },
        });
      }
      let body: { seed?: unknown };
      try {
        body = JSON.parse(rawText) as { seed?: unknown };
      } catch {
        return new Response(JSON.stringify({ error: "bad json" }), {
          status: 400,
          headers: { ...kors, "content-type": "application/json" },
        });
      }
      const seed =
        Number.isInteger(body.seed) &&
        (body.seed as number) >= 0 &&
        (body.seed as number) <= 0xffffffff
          ? (body.seed as number)
          : crypto.getRandomValues(new Uint32Array(1))[0]!;
      const coordinatorId = env.COORDINATOR.idFromName("global");
      const reservation = await env.COORDINATOR.get(coordinatorId).fetch(
        new Request("https://internal.example/internal/run-create-reserve", {
          method: "POST",
          headers: { [INTERNAL_IP_HASH_HEADER]: ipHash },
        }),
      );
      if (!reservation.ok) {
        const headers = new Headers(reservation.headers);
        for (const [key, value] of Object.entries(kors)) {
          headers.set(key, value);
        }
        return new Response(reservation.body, {
          status: reservation.status,
          headers,
        });
      }
      const runId = crypto.randomUUID();
      const created = await createRunCapability({
        secret: env.RUN_AUTH_SECRET,
        runId,
        now: Date.now(),
      });
      const id = env.RUNS.idFromName(runId);
      const stub = env.RUNS.get(id);
      const initialized = await stub.fetch(
        new Request(`https://internal.example/api/v1/runs/${runId}`, {
          method: "POST",
          headers: {
            [RUN_INTERNAL_INIT_HEADER]: "1",
            [INTERNAL_IP_HASH_HEADER]: ipHash,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            schemaVersion: 1,
            runId,
            seed,
            startedAt: new Date().toISOString(),
          }),
        }),
      );
      if (!initialized.ok) return initialized;
      const snapshot = await initialized.json();
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          runId,
          token: created.token,
          csrf: created.capability.csrf,
          expiresAt: created.capability.expiresAt,
          ...snapshot,
        }),
        {
          status: 201,
          headers: { ...kors, "content-type": "application/json" },
        },
      );
    }

    const runMatch =
      /^\/api\/v1\/runs\/([0-9a-f-]{36})(?:\/(attempts|capability|commentary)(?:\/([^/]+)\/(audio))?)?$/.exec(
        url.pathname,
      );
    if (runMatch) {
      const runId = runMatch[1]!;
      const auth = req.headers.get("authorization");
      const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
      const capability = await verifyRunCapability({
        secret: env.RUN_AUTH_SECRET,
        token,
        csrf: req.headers.get("x-karl-csrf"),
        runId,
        now: Date.now(),
      });
      if (!capability) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { ...kors, "content-type": "application/json" },
        });
      }
      if (runMatch[2] === "capability") {
        if (req.method !== "POST" || !env.RUN_AUTH_SECRET) {
          return new Response(JSON.stringify({ error: "POST only" }), {
            status: 405,
            headers: { ...kors, "content-type": "application/json" },
          });
        }
        const rotated = await createRunCapability({
          secret: env.RUN_AUTH_SECRET,
          runId,
          now: Date.now(),
        });
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            runId,
            token: rotated.token,
            csrf: rotated.capability.csrf,
            expiresAt: rotated.capability.expiresAt,
          }),
          {
            status: 200,
            headers: { ...kors, "content-type": "application/json" },
          },
        );
      }
      const headers = new Headers(req.headers);
      headers.delete("authorization");
      headers.delete("x-karl-csrf");
      headers.delete(RUN_INTERNAL_INIT_HEADER);
      headers.delete(RUN_INTERNAL_VERIFIED_HEADER);
      headers.set(RUN_INTERNAL_VERIFIED_HEADER, "1");
      headers.set(INTERNAL_IP_HASH_HEADER, ipHash);
      let forwarded = req;
      if (req.method === "POST") {
        if (!isJsonContentType(req.headers.get("content-type"))) {
          return new Response(
            JSON.stringify({ error: "content type must be application/json" }),
            {
              status: 415,
              headers: { ...kors, "content-type": "application/json" },
            },
          );
        }
        const rawText = await req.text();
        if (isBodyTooLarge(rawText)) {
          return new Response(JSON.stringify({ error: "body too large" }), {
            status: 413,
            headers: { ...kors, "content-type": "application/json" },
          });
        }
        forwarded = new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: rawText,
        });
      }
      const id = env.RUNS.idFromName(runId);
      const response = await env.RUNS.get(id).fetch(
        new Request(forwarded, { headers }),
      );
      const responseHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(kors)) {
        responseHeaders.set(key, value);
      }
      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    }

    // Klon anmodningen og overskriv den interne header BETINGELSESLØST —
    // uanset om en klient selv forsøgte at sætte den (forfalskning af en
    // andens rate-limit-spand, eller et forsøg på at omgå hashing helt),
    // fjernes/erstattes den her, hver eneste gang, uden undtagelse.
    const internalHeaders = new Headers(req.headers);
    internalHeaders.delete(GENERATED_INTERNAL_CANDIDATES_HEADER);
    internalHeaders.delete(RUNTIME_COMMENTARY_INTERNAL_HEADER);
    internalHeaders.delete(RUNTIME_TTS_INTERNAL_HEADER);
    internalHeaders.set(INTERNAL_IP_HASH_HEADER, ipHash);
    const forwarded = new Request(req, { headers: internalHeaders });

    // Ét globalt, navngivet objekt: al tilstand (rate limit, budget, cache)
    // samles ét sted, jf. kravet om ét stateful binding frem for KV+DO.
    const id = env.COORDINATOR.idFromName("global");
    const stub = env.COORDINATOR.get(id);
    const res = await stub.fetch(forwarded);

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(kors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};
