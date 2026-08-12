# Udrulning af live-fortælleren

Denne opskrift er **klar til brug, ikke en instruks om at bruge den**.
TASK-006 (`plan/feature-live-narrator-1.md`) — beslutningen om laget
overhovedet skal stå åbent for rigtige spillere — er Martins, ikke en del af
denne fase, og er bevidst stadig ikke truffet. Ingen af trinene herunder er
udført som en del af dette arbejde: der er ikke deployet noget, og der er
ikke sat en rigtig `OPENAI_API_KEY` noget sted.

Spillet er **fuldstændig komplet uden dette lag** — uden en sat
`VITE_NARRATOR_URL` gør hele klientmodulet ingenting, og fortælleren taler
udelukkende ud fra de bagte replikker og grammatikken, præcis som i dag.

## Arkitektur i to sætninger

Én Cloudflare Worker (`worker/`) proxyer modellen, så nøglen aldrig kommer i
nærheden af browseren. Foran modellen sidder ét globalt, navngivet Durable
Object (`Coordinator`, se `worker/src/coordinator-do.ts`) som den ENESTE
stateful komponent: det håndhæver et rullende rate-limit pr. IP-hash
(TASK-002), et dagligt UTC-udgiftsloft over kald der når modellen (TASK-003),
og en delt cache nøglet på par + dom (TASK-004) — alt sammen i objektets
egen SQLite-baserede storage, uden en KV ved siden af.

## 1. Forudsætninger

- Et Cloudflare-login med adgang til Workers og Durable Objects
  (`npx wrangler login` fra `worker/`). SQLite-baserede Durable Objects
  (den slags `Coordinator` bruger) findes på både Free- og Paid-planen;
  spillets meget lave, målte trafik (afsnit 4) ligger fjernt fra
  Free-planens grænser — ingen omtale af priser her, kun at ingen
  planopgradering er nødvendig for denne skala.
- En OpenAI API-nøgle til rådighed — **den sættes aldrig i en fil i dette
  repo**, kun som Worker-secret (trin 4).
- `worker/` har ingen installerede afhængigheder eller lockfile i dette
  worktree. Før `wrangler dev`/`wrangler deploy` kan køre, skal
  `npm install` køres inde i `worker/` (opretter `worker/package-lock.json`
  første gang — commit den, så CI og fremtidige deploys er reproducerbare).

## 2. Durable Object-migration og binding

Migrationen og bindingen står allerede i `worker/wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "COORDINATOR"
class_name = "Coordinator"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Coordinator"]
```

Der er intet separat migrations-trin at køre: `wrangler deploy` (trin 5)
læser `[[migrations]]` og opretter/opdaterer klassen som en del af selve
deployet, første gang såvel som ved senere ændringer. Tilføjes en fremtidig
ændring af `Coordinator`'s lagrede form, skal den have sin egen nye
`tag` (fx `"v2"`) — aldrig en redigering af `"v1"` i produktion.

## 3. Nøglen som secret

Fra `worker/`:

```bash
npx wrangler secret put OPENAI_API_KEY
```

Wrangler beder om værdien interaktivt og gemmer den krypteret hos
Cloudflare — den står aldrig i `wrangler.toml`, aldrig i git, og
`worker/src/model.ts` logger hverken nøglen, prompten eller modellens svar.

Valgfrit ekstra dybde-lag: `IP_HASH_SALT` som endnu en secret
(`npx wrangler secret put IP_HASH_SALT`). Uden den bruger koden en fast
indbygget fallback — rå IP-adresser gemmes ALDRIG i nogen af tilfældene,
kun en hash.

## 4. Sikre `[vars]`

`worker/wrangler.toml`'s `[vars]`-blok har allerede alle fire tal, med
udledningen skrevet ind som kommentarer (se også
`plan/feature-live-narrator-1.md`, afsnittet "Fase 2 — målte tal"):

| Var | Default | Betyder |
|---|---|---|
| `ALLOWED_ORIGINS` | `https://youex.github.io` | Kommasepareret liste over tilladte `Origin`-headere. En anmodning uden en tilladt origin får 403, FØR den når koordinatoren (SEC-002) — ikke kun en manglende CORS-header. |
| `RATE_LIMIT_WINDOW_SECONDS` / `RATE_LIMIT_MAX` | `60` / `20` | Rullende vindue pr. IP-hash (TASK-002). |
| `DAILY_MAX_UPSTREAM_CALLS` | `350` | Globalt UTC-døgnloft over kald der når modellen (TASK-003) — se afsnit 7 for nødstoppet. |

Ret kun `ALLOWED_ORIGINS`, hvis spillets rigtige URL ændrer sig. De tre
tal-vars bør ikke ændres uden ny måling — se plan-dokumentet for hvordan de
blev udregnet, og genbrug samme metode, når der findes rigtig trafik at måle
på i stedet for den simulerede.

## 5. Deploy

Fra `worker/`:

```bash
npx wrangler deploy
```

Dette bygger og uploader workeren, anvender migrationen fra trin 2, og
udskriver den tildelte `*.workers.dev`-adresse (eller et fast domæne, hvis
et sådant er sat op separat i Cloudflare — uden for denne opskrift).

## 6. `VITE_NARRATOR_URL` ved spillets build

Klienten (`src/narrator/live.ts`) læser `import.meta.env.VITE_NARRATOR_URL`
ved build-tid via Vite. Uden den er `ENDPOINT` en tom streng, og laget er
slået fra — det er den nuværende, afleverede tilstand.

- **Lokal afprøvning**: opret `.env.local` i **repo-roden** (matcher
  `.gitignore`'s `*.local`, committes aldrig) med:
  ```
  VITE_NARRATOR_URL=https://<den-adresse-wrangler-gav-i-trin-5>
  ```
  og kør `npm run dev` som vanligt.
- **Den rigtige, udrullede build** (GitHub Pages via
  `.github/workflows/deploy.yml`): denne fil sætter IKKE
  `VITE_NARRATOR_URL` i dag — det er selve grunden til, at laget er slået
  fra i det spil, der ligger live nu. At tænde for laget i produktion
  betyder at tilføje variablen til workflowets build-trin (som et
  repository-/environment-variable, ikke en secret — værdien er en URL,
  synlig i browserens netværksfane under alle omstændigheder). **Denne
  opskrift redigerer bevidst ikke `deploy.yml`** — at gøre det ER
  TASK-006-beslutningen, ikke en del af fase 2.

## 7. Sådan verificeres opførslen efter et deploy

Ingen af disse rører spillets rigtige budget ud over de allerede tilsigtede
1-2 kald i det første eksempel.

**Et gyldigt kald (den "sunde" vej):**

```bash
curl -i -X POST "https://<worker-adressen>" \
  -H "content-type: application/json" \
  -H "origin: https://youex.github.io" \
  -d '{"a":{"id":"baer","name":"Berries","traits":[]},
       "b":{"id":"ler","name":"Clay","traits":[]},
       "verdict":"inert"}'
```
Forventet: `200` med `{"text": "..."}`. Kald det samme par+dom igen — andet
svar bør komme markant hurtigere (cache-hit i Durable Object'et, TASK-004,
og bruger intet af det daglige budget).

**403 — oprindelse afvist (SEC-002):**
```bash
curl -i -X POST "https://<worker-adressen>" \
  -H "content-type: application/json" \
  -d '{"a":{"id":"baer","name":"Berries"},"b":{"id":"ler","name":"Clay"},"verdict":"inert"}'
```
(Ingen `origin`-header, eller en der ikke står på `ALLOWED_ORIGINS`.)
Forventet: `403` — FØR koordinatoren eller modellen nås.

**429 — rate limit (TASK-002):** send samme gyldige kald som ovenfor
`RATE_LIMIT_MAX + 1` gange i træk fra samme klient inden for vinduet (brug
gerne varierende par, så alle rammer rate-limiteren og ikke bare cachen).
Forventet på det sidste kald: `429` med en `retry-after`-header i sekunder.

**503 — dagligt loft (TASK-003):** for at afprøve dette uden at bruge hele
det rigtige døgnbudget, sæt midlertidigt en meget lav
`DAILY_MAX_UPSTREAM_CALLS` (fx `"1"`) med `npx wrangler deploy` til en
**separat, midlertidig** afprøvning — aldrig på selve produktions-workeren
med det rigtige tal. Forventet efter loftet er nået: `503` med en
`retry-after`-header i sekunder frem til næste UTC-midnat. Husk at sætte
værdien tilbage bagefter.

## 8. Nødstop

To uafhængige måder at slukke laget på, uden at ændre spillets øvrige kode:

1. **Fjern `VITE_NARRATOR_URL` fra buildet** (eller sæt den aldrig). Klienten
   falder tilbage til den tomme streng, `LiveNarrator.enabled` er `false`,
   og intet kald forlader nogensinde browseren. Dette er den nuværende,
   afleverede tilstand — der er intet at "fjerne" endnu, fordi variablen
   aldrig er blevet sat i produktion.
2. **Sæt `DAILY_MAX_UPSTREAM_CALLS = "0"`** i `worker/wrangler.toml` og
   deploy igen. Workeren bliver stående og svarer stadig — cache-hits
   virker fortsat — men ethvert cache-miss får `503` med det samme, uden at
   noget kald når OpenAI. `"0"` er med vilje IKKE det samme som "ikke sat":
   `worker/src/env.ts`'s `toNonNegativeInt` lader en eksplicit nul passere
   uændret i stedet for at falde tilbage til defaulten (350) — se
   `tests/worker-security.test.ts` for beviset, og
   `plan/feature-live-narrator-1.md`'s FILE-006/TEST-009 for historien om
   hvorfor det er sin egen funktion.

Begge kan bruges samtidig eller hver for sig; ingen af dem kræver at slette
Durable Object'et eller dets lagrede tilstand.

## 9. Hvad denne opskrift bevidst IKKE dækker

- Ingen priser eller token-forbrug — se OpenAI's og Cloudflares egne,
  aktuelle sider, hvis det skal indgå i TASK-006-beslutningen.
- Ingen hemmelige værdier — hverken nøgler, salt eller reelle URL'er ud over
  dem der allerede er offentlige (spillets egen GitHub Pages-adresse).
- Ingen ændring af `.github/workflows/deploy.yml` — at tænde laget i den
  rigtige build er selve TASK-006-beslutningen.
