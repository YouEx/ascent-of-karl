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
 * Udrulning: se docs/deployment/live-narrator.md.
 *
 * Uden denne worker kører spillet præcis som før. Den er en forbedring af
 * halen, ikke en afhængighed.
 */

import type { DurableObjectNamespace } from "./cf-types";
import type { CoordinatorEnv } from "./coordinator-do";
import { parseAllowedOrigins, isOriginAllowed, corsHeaders } from "./origin";
import { clientIpFromRequest, hashClientIp, INTERNAL_IP_HASH_HEADER } from "./ip";

export { Coordinator } from "./coordinator-do";

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
  COORDINATOR: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
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

    // Klon anmodningen og overskriv den interne header BETINGELSESLØST —
    // uanset om en klient selv forsøgte at sætte den (forfalskning af en
    // andens rate-limit-spand, eller et forsøg på at omgå hashing helt),
    // fjernes/erstattes den her, hver eneste gang, uden undtagelse.
    const internalHeaders = new Headers(req.headers);
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
