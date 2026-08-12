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
 * Denne fil selv er bevidst tynd: den håndhæver kun oprindelsespolitikken
 * (SEC-002) som en RIGTIG 403, før koordinatoren nås — CORS-headere alene
 * stopper ikke en klient der ikke er en browser (`curl` er ligeglad med
 * CORS), så dette er en ægte port, ikke kun en høflig header på et svar der
 * alligevel blev lavet. Selve rate-limit/budget/cache-beslutningen bor i
 * `coordinator.ts` og dens rene hjælpemoduler.
 *
 * Udrulning: se docs/deployment/live-narrator.md.
 *
 * Uden denne worker kører spillet præcis som før. Den er en forbedring af
 * halen, ikke en afhængighed.
 */

import type { DurableObjectNamespace } from "./cf-types";
import type { CoordinatorEnv } from "./coordinator-do";
import { parseAllowedOrigins, isOriginAllowed, corsHeaders } from "./origin";

export { Coordinator } from "./coordinator-do";

interface Env extends CoordinatorEnv {
  /** Kommasepareret liste. Tom = alle (kun til lokal brug, SEC-002). */
  ALLOWED_ORIGINS?: string;
  COORDINATOR: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("origin");
    const allowed = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const kors = corsHeaders(origin, allowed);

    if (req.method === "OPTIONS") return new Response(null, { headers: kors });

    if (!isOriginAllowed(origin, allowed)) {
      // Ægte 403 — ikke kun manglende CORS-header. Dette stopper curl,
      // hvilket CORS aldrig gjorde (RISK-001).
      return new Response(JSON.stringify({ error: "origin not allowed" }), {
        status: 403,
        headers: { ...kors, "content-type": "application/json" },
      });
    }

    // Ét globalt, navngivet objekt: al tilstand (rate limit, budget, cache)
    // samles ét sted, jf. kravet om ét stateful binding frem for KV+DO.
    const id = env.COORDINATOR.idFromName("global");
    const stub = env.COORDINATOR.get(id);
    const res = await stub.fetch(req);

    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(kors)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
  },
};
