# Udrulning af live-fortælleren

Denne opskrift er **kold reserve, ikke en instruks om at bruge den**.
TASK-006 (`plan/feature-live-narrator-1.md`) blev afgjort 13-08-2026:
laget udrulles ikke nu. Den gratis fortællerkæde er allerede målt komplet
(72,4 % bagt, 27,6 % grammatik, 0 % tavshed), og der findes ingen playtest-
eller spillerdata, der retfærdiggør den ekstra betalte driftsflade.

Ingen af trinene herunder er udført: der er ikke deployet noget, der er ikke
sat en rigtig `OPENAI_API_KEY`, og buildet har ingen `VITE_NARRATOR_URL`.
Improvisationsruten, som nu ligger i samme kilde, er heller ikke deployet,
har ingen klient og har ingen `VITE_IMPROVISE_URL`.
Runbooken bevares, fordi beslutningen er reversibel, hvis senere data viser
en konkret kvalitetskløft i grammatikhalen.

Spillet er **fuldstændig komplet uden dette lag** — uden en sat
`VITE_NARRATOR_URL` gør hele klientmodulet ingenting, og fortælleren taler
udelukkende ud fra de bagte replikker og grammatikken, præcis som i dag.

## Arkitektur i to sætninger

Én Cloudflare Worker (`worker/`) rummer de to uafhængige, valgfrie
modelruter (`/narrate`/den eksisterende rodsti og `/improvise`), så nøglen
aldrig kommer i nærheden af browseren. Foran modellen sidder ét globalt, navngivet Durable
Object (`Coordinator`, se `worker/src/coordinator-do.ts`) som den ENESTE
stateful komponent: det håndhæver et rullende rate-limit pr. IP-hash
(TASK-002), et dagligt UTC-udgiftsloft over kald der når modellen (TASK-003),
og en delt cache nøglet på par + dom (TASK-004). Improvisation har egne
kvote-/budget-/cache-nøgler i samme storage. Alt ligger i objektets egen
SQLite-baserede storage, uden en KV ved siden af.

## 1. Forudsætninger

- Et Cloudflare-login med adgang til Workers og Durable Objects
  (`npx wrangler login` fra `worker/`). SQLite-baserede Durable Objects
  (den slags `Coordinator` bruger) findes på både Free- og Paid-planen;
  spillets meget lave, målte trafik (afsnit 4) ligger fjernt fra
  Free-planens grænser — ingen omtale af priser her, kun at ingen
  planopgradering er nødvendig for denne skala.
- En OpenAI API-nøgle til rådighed — **den sættes aldrig i en fil i dette
  repo**, kun som Worker-secret (trin 3).
- `worker/` har sin egen `package-lock.json` (checket ind, se afsnit 10) —
  kør `npm ci` (ikke `npm install`) inde i `worker/`, før noget af det
  følgende (`wrangler dev`/`wrangler deploy`/`npm run typecheck`) kan køre,
  for at få præcis de afhængigheder, lockfilen beskriver.

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

## 3. Nøglerne som secrets

Fra `worker/`:

```bash
npx wrangler secret put OPENAI_API_KEY
```

Wrangler beder om værdien interaktivt og gemmer den krypteret hos
Cloudflare — den står aldrig i `wrangler.toml`, aldrig i git, og
`worker/src/model.ts` logger hverken nøglen, prompten eller modellens svar.

```bash
npx wrangler secret put IP_HASH_SALT
```

Denne anden secret er **OBLIGATORISK, ikke valgfri** (sikkerhedsrunde 2,
punkt 1) — der er intet indbygget standard-salt at falde tilbage til.
Uden den fejler `worker/src/index.ts` LUKKET: enhver anmodning får 503
("server misconfigured"), FØR IP'en overhovedet hashes eller Durable
Object'et nås. Grunden: en SHA-256-hash af en IP UDEN salt er i praksis en
opslagstabel væk fra klartekst (IPv4-rummet er lille nok til at regne alle
hashes ud på forhånd) — "hashet, men usaltet" er reelt ingen beskyttelse.
Vælg en tilfældig, lang værdi (fx `openssl rand -hex 32`); den behøver ikke
huskes af et menneske, kun genbruges konsistent af workeren selv.

## 4. Sikre `[vars]`

`worker/wrangler.toml`'s `[vars]`-blok har allerede alle tal, med
udledningen skrevet ind som kommentarer (se også
`plan/feature-live-narrator-1.md`, afsnittet "Fase 2 — målte tal"):

| Var | Default | Betyder |
|---|---|---|
| `ALLOWED_ORIGINS` | `https://youex.github.io` | Kommasepareret liste over tilladte `Origin`-headere. En anmodning uden en tilladt origin får 403, FØR den når koordinatoren (SEC-002) — ikke kun en manglende CORS-header. **Men:** `Origin` er en klient-sat header, som en angriber (fx `curl`) kan forfalske lige så let som en browser aldrig ville gøre frivilligt. Denne kontrol er forsvar-i-dybden VED SIDEN AF kvoterne nedenfor, ikke en erstatning for dem — den stopper en tilfældig fremmed side, aldrig en modstander der bevidst sætter en tilladt `Origin`. |
| `RATE_LIMIT_WINDOW_SECONDS` / `RATE_LIMIT_MAX` | `60` / `20` | Rullende vindue pr. IP-hash (TASK-002). IP-identiteten bag hashen fastslås udelukkende ved Cloudflares kant (`cf-connecting-ip`, se afsnit 3's `IP_HASH_SALT`) — ikke af en klient-oplyst header. |
| `DAILY_MAX_UPSTREAM_CALLS` | `350` | Globalt UTC-døgnloft over kald der når modellen (TASK-003) — se afsnit 8 for nødstoppet. Ramt: 503. |
| `DAILY_MAX_UPSTREAM_CALLS_PER_IP` | `165` | Én IP-hashs egen andel af samme døgn (sikkerhedsrunde 2, punkt 2) — forhindrer at én spiller alene opbruger hele det globale loft. Meningsfuldt under halvdelen af det globale loft. Ramt (men globalt loft har stadig plads): 429, ikke 503. |
| `IMPROVISE_RATE_LIMIT_WINDOW_SECONDS` / `IMPROVISE_RATE_LIMIT_MAX` | `60` / `10` | Eget rullende vindue for `/improvise`, med samme kant-fastslåede IP-hash men en separat storage-spand. Konservativ før-trafik-standard, ikke en måling. |
| `IMPROVISE_DAILY_MAX_UPSTREAM_CALLS` | `100` | Eget globalt UTC-døgnloft for improvisations-cache-misses. Konservativ før-trafik-standard; ingen trafik findes endnu. |
| `IMPROVISE_DAILY_MAX_UPSTREAM_CALLS_PER_IP` | `25` | Egen dagsandel pr. IP-hash for improvisation. En fremtidig klient-cap er UX/balance og må aldrig regnes som sikkerhed. |

Ret kun `ALLOWED_ORIGINS`, hvis spillets rigtige URL ændrer sig. De fire
tal-vars bør ikke ændres uden ny måling — se plan-dokumentet for hvordan de
blev udregnet, og genbrug samme metode (`npm run pairs`,
`tools/pair_frequency.ts`), når der findes rigtig trafik at måle på i
stedet for den simulerede.

### 4a. Indholdsændringer kræver gendeploy

Siden sikkerhedsrunde 2 (punkt 3) genopbygger workeren selv prompten fra
`content/elements.json` og `content/acts/*.json` — bundlet IND i workeren
ved `wrangler deploy` (afsnit 5), ikke læst live fra spillets side.
Klienten sender kun id'er (`{aId, bId, verdict, needId?, summer?}`); et
ukendt id afvises 400. Det betyder: **ændres et elements navn/flavor/kind,
eller tilføjes/omdøbes et element- eller need-id i `content/`, skal
workeren gendeployes** (`npx wrangler deploy` igen, ingen ny migration
nødvendig), ellers kender den gamle worker-instans ikke de nye id'er, eller
serverer den gamle beskrivelse for et ændret element.

### 4b. Cache-navnerum — udledes automatisk, ingen manuel handling

Cache-nøglen (`worker/src/cache-key.ts`) har et navnerum som præfiks.
Siden sikkerhedsrunde 3 (punkt 3), udvidet i en opfølgende gennemgang,
udledes dette navnerum **automatisk** af `promptNamespace(PROMPT_VERSION_INPUT, model)`
— en deterministisk, ikke-kryptografisk hash af DEN FULDE prompt-kontrakt
(`worker/src/model.ts`s `PROMPT_VERSION_INPUT`) og den konfigurerede model
(`MODEL`-varen, eller `DEFAULT_MODEL` hvis den mangler).

**Nøjagtig dækning** — `PROMPT_VERSION_INPUT` indeholder, i denne
rækkefølge:

1. `SYSTEM` — hele system-prompten, ordret;
2. **alle** `DOMME`-forklaringer (nøgle+værdi for hver dom: `plausible`,
   `near-miss`, `clash`, `absurd`, `self`, `inert`, `locked`), slået op i
   STABIL (sorteret) rækkefølge, så selve indsættelsesordenen i
   `DOMME`-objektet er ligegyldig — kun indholdet tæller;
3. `USER_PROMPT_TEMPLATE_FRAGMENTS` — samtlige faste tekstbidder i selve
   brugerprompt-skabelonen (`beskriv`/`buildUserPrompt` i `model.ts`):
   indledningssætningen, FIRST/SECOND-mærkaterne, "WHY IT FAILED"-
   omslaget, need- og summer-linjernes præfikser/suffikser, og alle
   separatorer/parenteser brugt til at sætte et tings kind/stuff/scale/
   traits/flavor/karlMood sammen. Disse bidder er navngivne `TPL_*`-
   konstanter, som `beskriv`/`buildUserPrompt` selv bruger til at
   RENDERE teksten — ikke en hånd-skrevet kopi af dem — så en ændring i
   én skabelon-sætning automatisk ændrer fingeraftrykket, uden at nogen
   skal huske at opdatere noget ved siden af.

Der er intet versionstal at huske at bumpe:

- ændres system-prompten (`SYSTEM`), ÉN dom-forklaring (`DOMME`), ELLER
  selve brugerprompt-skabelonen (en `TPL_*`-konstant i `model.ts`),
  ændres navnerummet af sig selv ved næste deploy;
- ændres `MODEL`-varen i `wrangler.toml`, ændres navnerummet ligeledes af
  sig selv;
- er alle disse uændrede, er navnerummet stabilt, og eksisterende
  cache-poster fortsætter med at blive ramt.

En deploy skaber en FRISK Durable Object-instans (eller genstarter den
eksisterende kode), så navnerummet genudregnes netop dér — gamle
cache-nøgler under et andet navnerum bliver uopslåelige med det samme,
uden migrering og uden at nogen skal huske at redigere en konstant. De
fysiske, nu-uopslåelige poster rømmes senere af den daglige
oprydningsalarm (afsnit 4c), men er allerede uskadelige fra første
forespørgsel efter deploy.

**Hvad dækkes IKKE**: rækkefølgen, `beskriv`/`buildUserPrompt` selv sætter
de faste bidder sammen i (f.eks. om FIRST nævnes før SECOND), er ikke en
del af fingeraftrykket — kun selve TEKST-INDHOLDET af hver bid. En
omrokering af de statiske sammensætningstrin uden at ændre nogen literal
tekst er en teoretisk, ekstremt usandsynlig ændring, der ikke automatisk
ville bumpe navnerummet; den er bevidst ikke løst generisk og forventes
aldrig at forekomme i praksis (enhver reel tekstændring rammer altid en
`TPL_*`-konstant og bumper dermed navnerummet).

### 4c. Lagerlivscyklus (oprydning)

Durable Object storage har ingen indbygget TTL. `Coordinator` sætter selv
en daglig alarm (`worker/src/coordinator-do.ts`s `ensureCleanupScheduled`/
`alarm()`) der rydder tre ting:

- rate-limit-poster hvor ALLE tidsstempler er faldet ud af det rullende
  vindue;
- cache-poster ældre end 30 dage (`CACHE_MAX_AGE_MS`);
- pr.-IP-budgetposter (sikkerhedsrunde 2, punkt 2) hvis gemte UTC-dato
  hverken er i dag eller i går (sikkerhedsrunde 3, punkt 2) — "i dag eller
  i går" er en bevidst tolerance for uret mellem hvornår en post blev
  skrevet og hvornår alarmen tilfældigvis kører, så en post skrevet få
  sekunder før UTC-midnat ikke rømmes, blot fordi alarmen kører få
  sekunder inde i den nye dag.

Dette kræver ingen handling ved deploy — alarmen planlægger sig selv ved
første forespørgsel til objektet, og genplanlægger sig selv for evigt,
uanset om en given omgang går helt godt.

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

`VITE_NARRATOR_URL` og en fremtidig `VITE_IMPROVISE_URL` er bevidst to
uafhængige build-kontrakter. Denne ændring sætter ingen af dem. Senere
klientarbejde må pege `VITE_IMPROVISE_URL` på `/improvise` uden at tænde
live-fortælleren, og omvendt.

## 7. Sådan verificeres opførslen efter et deploy

Ingen af disse rører spillets rigtige budget ud over de allerede tilsigtede
1-2 kald i det første eksempel. Ledningsformen er bevidst SMAL
(sikkerhedsrunde 2, punkt 3): kun id'er og dom — aldrig navne, kind, stuff,
traits eller flavor. Se `content/elements.json` for gyldige id'er (fx
`baer`, `ler`).

**Et gyldigt kald (den "sunde" vej):**

```bash
curl -i -X POST "https://<worker-adressen>" \
  -H "content-type: application/json" \
  -H "origin: https://youex.github.io" \
  -d '{"aId":"baer","bId":"ler","verdict":"inert"}'
```
Forventet: `200` med `{"text": "..."}`. Kald det samme par+dom igen — andet
svar bør komme markant hurtigere (cache-hit i Durable Object'et, TASK-004,
og bruger intet af det daglige budget, hverken det globale eller
pr.-IP-andelen).

**403 — oprindelse afvist (SEC-002):**
```bash
curl -i -X POST "https://<worker-adressen>" \
  -H "content-type: application/json" \
  -d '{"aId":"baer","bId":"ler","verdict":"inert"}'
```
(Ingen `origin`-header, eller en der ikke står på `ALLOWED_ORIGINS`.)
Forventet: `403` — FØR koordinatoren eller modellen nås. Husk: dette
stopper kun en uændret browser eller et script, der ikke selv sætter
`Origin` — en `curl` der bevidst sætter en tilladt `Origin` (som eksemplet
ovenfor gør) kommer igennem præcis som en rigtig browser ville. Det er
derfor kvoterne nedenfor er de reelle grænser, ikke dette tjek alene.

**400 — ukendt id (sikkerhedsrunde 2, punkt 3):**
```bash
curl -i -X POST "https://<worker-adressen>" \
  -H "content-type: application/json" \
  -H "origin: https://youex.github.io" \
  -d '{"aId":"dette-id-findes-ikke","bId":"ler","verdict":"inert"}'
```
Forventet: `400` med `{"error":"bad request","reason":"ukendt aId"}` — FØR
cache-opslag og FØR noget af det daglige budget røres. Samme svar for et
opdigtet navn/flavor-felt: feltet findes slet ikke i den validerede form,
så der er intet sted at digte en prompt-injektion ind.

**429 — rate limit (TASK-002, `reason: "rate limit"`):** send samme
gyldige kald som ovenfor `RATE_LIMIT_MAX + 1` gange i træk fra samme klient
inden for vinduet (brug gerne varierende par, så alle rammer
rate-limiteren og ikke bare cachen). Forventet på det sidste kald: `429`
med en `retry-after`-header i sekunder (vinduets restløbetid).

**429 — pr.-IP dagligt loft (sikkerhedsrunde 2, punkt 2,
`reason: "per-ip daily budget"`):** for at afprøve dette uden at ramme det
rigtige tal, sæt midlertidigt en meget lav `DAILY_MAX_UPSTREAM_CALLS_PER_IP`
(fx `"1"`) på en **separat, midlertidig** afprøvnings-deploy, og send to
FORSKELLIGE par+dom-kombinationer (så det andet kald garanteret er et
cache-miss, ikke bare et hit). Forventet på det andet kald: `429` med
`retry-after` frem til næste UTC-midnat — men andre IP'er ville stadig få
et almindeligt svar, fordi kun denne ene IP's andel er brugt, ikke det
globale loft.

**503 — globalt dagligt loft (TASK-003, `reason: "daily budget"`):** samme
fremgangsmåde, men sæt i stedet `DAILY_MAX_UPSTREAM_CALLS` lavt på en
midlertidig afprøvnings-deploy. Forventet efter loftet er nået: `503` med
`retry-after` frem til næste UTC-midnat. Husk at sætte begge værdier
tilbage bagefter, og aldrig at gøre dette på selve produktions-workeren.

**De tre ikke-200-svar opsummeret** — status alene er ikke nok til at vide
hvorfor; se altid `reason`-feltet i JSON-kroppen:

| Status | `reason` | Hvad betyder det | `retry-after` |
|---|---|---|---|
| `429` | `"rate limit"` | Denne IP spurgte for tit for hurtigt (sekunder). | Vinduets restløbetid. |
| `429` | `"per-ip daily budget"` | Denne IP har brugt sin egen andel af dagens opstrømskald — andre kan stadig få svar. | Til næste UTC-midnat. |
| `503` | `"daily budget"` | HELE dagens globale opstrømsloft er brugt — ingen kan få et nyt (ikke-cachet) svar lige nu. | Til næste UTC-midnat. |
| `503` | (ingen — `"server misconfigured"` eller `"no trusted client identity"`) | `IP_HASH_SALT` mangler, eller anmodningen kom uden en Cloudflare-betroet IP. Driftsfejl, ikke normal kvote. | — |

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
   hvorfor det er sin egen funktion. Det globale loft tjekkes FØR
   pr.-IP-loftet (`coordinator.ts`s `decide()`, trin 5a før 5b) — sat til
   nul rammer derfor ALLE IP'er ens, uden at `DAILY_MAX_UPSTREAM_CALLS_PER_IP`
   behøver ændres separat.

Begge kan bruges samtidig eller hver for sig; ingen af dem kræver at slette
Durable Object'et eller dets lagrede tilstand.

## 9. Høst af rigtig trafik tilbage til bagning (TASK-008, valgfrit)

Dette lag bygger OVEN PÅ alt ovenstående — det kræver ikke en ny worker,
kun én ny secret og ét nyt (bevidst smalt) endpoint. Det er lige så
valgfrit som resten af laget: uden `ADMIN_EXPORT_TOKEN` sat, er
`/admin/pairs` blot altid 401, og intet af det følgende har nogen effekt.

### 9a. Hvad der tælles — og hvad der bevidst IKKE gør

`worker/src/stats.ts` tæller hver forespørgsel der består validering OG
kanonisering (samme kanoniske par+dom-nøgle som cachen, se afsnit 4b) —
cache-hit, et nyt opstrømskald, et tilsluttet-i-gang-værende kald, ELLER et
budget-afvist forsøg (429/503). Kun 400-afvisninger (ugyldig form/ukendt
id) tæller ikke, fordi de aldrig når et kanonisk par+dom. Tællingen sker
UBETINGET som en del af `coordinator.ts`s eksisterende, atomiske
`decide()`-kald — den er altid aktiv, uanset om `ADMIN_EXPORT_TOKEN` er
sat. Planlægges høstning aldrig brugt, er der intet at slå fra: posterne
ligger blot urørte i Durable Object'ets storage og aldres væk af sig selv
(afsnit 9e).

Hver post (`PairStatsRecord`) er bevidst SMAL: `aId`, `bId`, `verdict`, tre
tællere (`count`, `cacheHits`, `upstreamCalls`) og to tidsstempler
(`firstSeen`, `lastSeen`) — **aldrig** en IP (hverken rå eller hashet),
**aldrig** den genererede tekst, prompten eller noget model-relateret. Det
er selve garantien bag "no raw IPs or generated text in stats/export".

### 9b. `ADMIN_EXPORT_TOKEN` — obligatorisk hemmelighed, kun hvis høstning bruges

Fra `worker/`:

```bash
npx wrangler secret put ADMIN_EXPORT_TOKEN
```

Samme "ingen hemmelighed = ingen adgang"-mønster som `IP_HASH_SALT`
(afsnit 3): mangler den, fejler `/admin/pairs` LUKKET (401) for ALLE
forsøg, uanset hvad et `Authorization`-headerfelt måtte indeholde — der
er intet gættet standard-token at falde tilbage til. Vælg en tilfældig,
lang værdi (fx `openssl rand -hex 32`), præcis som `IP_HASH_SALT`.

Selve sammenligningen (`worker/src/admin.ts`s `isValidAdminToken`) hasher
begge sider med SHA-256 og sammenligner de to faste 64-hex-tegns digests
konstant-tids (en manuel XOR-akkumulering over HELE strengen) — samme
begrundelse som IP-hashen i afsnit 3: en naiv `===`/substring-sammenligning
ville kunne lække tokenets længde eller indhold via timing. Enhver
afvisning (manglende token, forkert præfiks, forkert token, eller slet
ingen konfigureret hemmelighed) giver samme generiske `401`, uden
begrundelse — der er intet at lække ved et uheld.

### 9c. `GET /admin/pairs` — selve eksport-endpointet

Endpointet er BEVIDST IKKE en del af narrator-strømmen: det tjekkes i
`index.ts`s `fetch()` FØR Origin/CORS-logikken (det er ikke ment til
browserkald — se `tools/live_pair_export.mjs` — og sætter derfor aldrig en
meningsfuld `Origin`), men kræver i stedet et bearer-token. Kun `GET`
accepteres (`405` for alt andet); den kan ALDRIG nå modellen eller røre
budgettet, uanset hvad en anmodning sender.

```bash
curl -i "https://<worker-adressen>/admin/pairs?limit=50" \
  -H "authorization: Bearer <ADMIN_EXPORT_TOKEN-værdien>"
```

Ledningen: `index.ts` verificerer tokenet, fjerner den RÅ
`Authorization`-header helt, og sætter i stedet en intern markørheader
(`x-internal-admin-verified: 1`), FØR anmodningen videresendes til Durable
Object'et — objektet ser derfor ALDRIG det rå token. Objektet stoler
alligevel ikke blindt på markørens tilstedeværelse alene (forsvar i
dybden): det anvender desuden den SAMME rate-limit-mekanisme som
narrator-strømmen (`RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW_SECONDS`, afsnit 4),
men med en fast intern nøgle (`"admin:pairs-export"`) der aldrig kan
kollidere med en rigtig IP-hash — et for-ivrigt eksport-script kan derfor
selv blive `429`'et, ligesom en almindelig klient.

Svaret er en stabil, versioneret JSON (`schemaVersion`, `cacheNamespace`,
`voiceProfileVersion`, `voiceProfileHash`, `generatedAt`, `total`,
`entries`, `nextCursor`) — sorteret deterministisk (antal faldende, dernæst
senest set faldende, dernæst par+dom stigende), sideinddelt med
`?limit=`/`?cursor=` (standard 200 poster, hårdt loft 500 uanset hvad der
bedes om). `nextCursor` er `null` på sidste side. Ingen IP-hash, intet
tekstfelt, ingen hemmelighed optræder nogensinde i svaret.

### 9d. `tools/live_pair_export.mjs` — CLI'en der henter og gemmer lokalt

Fra repo-roden (ikke `worker/`):

```bash
LIVE_NARRATOR_ADMIN_URL="https://<worker-adressen>/admin/pairs" \
LIVE_NARRATOR_ADMIN_TOKEN="<ADMIN_EXPORT_TOKEN-værdien>" \
node tools/live_pair_export.mjs
```

(Der findes også `npm run pairs:export`, som blot kører samme kommando —
miljøvariablerne skal stadig sættes af den, der kalder den.)

Token og URL læses UDELUKKENDE fra miljøvariabler, ALDRIG fra
kommandolinje-argumenter — et argument ville stå i klartekst i
shell-historik og i enhver process-liste (`ps`), som enhver anden bruger på
samme maskine kan læse. En valgfri tredje variabel,
`LIVE_NARRATOR_ADMIN_LIMIT`, styrer sidestørrelsen (samme loft som
afsnit 9c gælder stadig).

CLI'en følger `nextCursor` automatisk til alle sider er hentet, validerer
hver indgang mod BÅDE den kendte dom-liste OG den kanoniske element-liste
(`content/elements.json` — uafhængigt af hvad workeren selv mener er
gyldigt), og skriver derefter et lokalt, versioneret artefakt til
`docs/design/live-pair-stats.json` — **uden noget token-felt**
(`buildLocalArtifact` modtager strukturelt aldrig et token som parameter,
så der ikke er noget at glemme at fjerne). Den fejler HØJLYDT (ikke-nul
exitkode, tydelig besked på stderr, intet skrevet til disk) ved 401
(forkert/manglende token) eller et uventet `schemaVersion` — en fremtidig,
inkompatibel eksport-form bliver aldrig stiltiende fejltolket.

### 9e. Brug eksporten i næste bagerunde

```bash
npm run pairs:prepare -- --live=docs/design/live-pair-stats.json --limit=50
```

Uden `--live` er `tools/prepare_pairs.ts`s opførsel PRÆCIS som før TASK-008
(byte-identisk, verificeret ved diff mod den tidligere, ubagte adfærd) —
dette er en tilføjelse, ikke en erstatning. Med `--live` slås det målte,
simulerede signal (`docs/design/pair-frequency.json`) sammen med den
rigtige, høstede trafik, og resultatet er en RANGERET liste over
**ukurerede** par+dom-nøgler (dem der endnu ikke er bagt til netop den
dom — se afsnit 4b's pointe om at et par kan være bagt til én dom, men
ikke en anden). Uden `--write` skrives INTET til disk — kun en
JSON-forhåndsvisning på stdout. Kun med `--write` (og et `--out=<sti>`, der
selv vælger en NY undermappe adskilt fra de eksisterende, godkendte
bage-batches) skrives et forslag til disk, sammen med en
menneskelæsbar `harvest-preview.md` der eksplicit minder om: dette er et
RÅT forslag, ikke en godkendt batch.

**TASK-008 er en KILDE til håndskrivning, ALDRIG en erstatning for den:**
et forslag herfra går stadig igennem den SAMME menneske-gennemgang,
`check_pairs.py` og `assemble_pairs.py` som ethvert andet bage-forslag —
intet live-modeltekst bliver nogensinde automatisk forfremmet til rigtigt
indhold.

### 9f. Opbevaring — lageret vokser ikke ubegrænset

Samme daglige oprydningsalarm som afsnit 4c (`ensureCleanupScheduled`/
`alarm()`) rydder også stats-poster, hvis `lastSeen` er mere end 90 dage
gammel (`stats.ts`s `STATS_MAX_AGE_MS`) — baseret på SENEST set, ikke
FØRST set, så et par der stadig aktivt bliver spurgt om aldrig rømmes,
uanset hvor gammel dets første forekomst er. Ingen manuel handling
nødvendig.

### 9g. Ingen følsomme data, nogen steder i denne kæde

Hverken tælleren (9a), eksport-endpointet (9c), CLI'en (9d) eller
høste-tilstanden i `prepare_pairs.ts` (9e) håndterer på noget tidspunkt en
IP (rå eller hashet), den genererede tekst, prompten eller
`ADMIN_EXPORT_TOKEN`s værdi i noget skrevet artefakt. Det lokale artefakt
under `docs/design/` indeholder udelukkende kanoniske id'er, domme,
tællere og tidsstempler — det kan committes uden bekymring, præcis som
`docs/design/pair-frequency.json` allerede gør for den simulerede side.

## 10. Hvad denne opskrift bevidst IKKE dækker

- Ingen priser eller token-forbrug — se OpenAI's og Cloudflares egne,
  aktuelle sider, hvis det skal indgå i TASK-006-beslutningen.
- Ingen hemmelige værdier — hverken nøgler, salt eller reelle URL'er ud over
  dem der allerede er offentlige (spillets egen GitHub Pages-adresse).
- Ingen ændring af `.github/workflows/deploy.yml` — at tænde laget i den
  rigtige build er selve TASK-006-beslutningen.

## 11. Workerens egen CI (sikkerhedsrunde 2, punkt 6)

Workeren har nu sin egen `package-lock.json` (checket ind i git, ligesom
rodprojektets) og tre npm-scripts, kørt fra `worker/`:

```bash
npm ci               # reproducerbar installation fra lockfilen
npm run typecheck    # tsc --noEmit — samme strenghed som roden
npm run dry-run      # wrangler deploy --dry-run — bundler uden at deploye
```

`npm run dry-run` kræver INTET Cloudflare-login og ingen `account_id` i
`wrangler.toml` — den bundler koden lokalt og validerer den, men sender
intet og deployer intet. Derfor kan den køre i CI uden nogen hemmelighed.

`.github/workflows/ci.yml` har et selvstændigt job, `worker-typecheck`, der
kører alle tre kommandoer ovenfor på hver push/PR — adskilt fra
spillets egen `test-and-build`-job og fra den urørte `deploy.yml`. Rodens
egen `npm run build` kører også `typecheck:worker`
(`tsc --noEmit -p worker/tsconfig.json`) som et af sine trin, så en
type-fejl i workeren fejler samme kommando, en udvikler alligevel kører
lokalt før commit.

**Om `wrangler types`:** Wrangler kan generere en `Env`-grænseflade fra
`wrangler.toml`. Det blev afprøvet og bevidst FRAVALGT som erstatning for
den håndskrevne `worker/src/cf-types.ts`: den genererede type låser hver
var til dens PRÆCISE nuværende strengværdi (fx `MODEL: "gpt-4o-mini"` som
en literal-type, ikke `string`) i stedet for at tillade en anden værdi ved
runtime, og den dækker slet ikke `DurableObject`/`Request`/`Response` (det
ville kræve `@cloudflare/workers-types` som ny afhængighed — vurderet
overflødigt for en fil på 41 linjer med fem minimale grænseflader). De
håndskrevne typer i `cf-types.ts` er derfor stadig autoritative; en
prøvekørsel af `npx wrangler types` er tilføjet til `.gitignore`
(`worker-configuration.d.ts`) med en kommentar om hvorfor, så den aldrig
ved et uheld committes.

## 12. `POST /improvise` — kildekontrakt, fortsat slukket

Dette endpoint er implementeret i den **samme** Worker og det **samme**
`Coordinator`-objekt. Der er ikke oprettet `proxy/`, ingen KV-binding og
ingen ekstra secret. Det er kun kilde: ingen secret er provisioneret, intet
er deployet, ingen Pages-/Vite-variabel er sat, og der findes ingen trafik
eller høstede resultater.

### 12a. Offentlig ledning

```http
POST /improvise
content-type: application/json

{"a":"sten","b":"pind","act":1}
```

- Kroppen er **eksakt** `{a: string, b: string, act: number}`; ekstra felter
  afvises.
- `a` og `b` er kanoniske element-id'er. Workeren slår navn, flavor og
  taksonomi op i det bundlede `content/elements.json`; ukendte,
  runtime-opfundne eller endnu ikke akt-tilgængelige id'er afvises før
  cache og budget.
- Paridentiteten sorteres internt **sammen med aktnummeret**.
  `sten+pind` og `pind+sten` er samme opfindelse i samme akt; samme par i
  akt 1 og akt 2 er to forskellige, deterministiske identiteter.
- Et succes-svar er **kun**:

```json
{"name":"Flint club","flavor":"A stone tied to a stick. Karl has invented confidence with a handle."}
```

Modellen kan ikke returnere eller kontrollere `kind`, `stuff`, `traits`,
`scale`, `solves`, flags, `ageUp`, `ending`, id'er, forældre, origin eller
dybde. Den deterministiske klientkerne leverer klassifikationen separat;
Workeren forbedrer kun copy.

### 12b. Prompt og output-port

Prompten bruger kun serveropslåede kanoniske forældrenavne, flavor og
taksonomi samt aktnummeret. Tre håndskrevne toneeksempler følger med:
mudderkage, ristede larver og klyngen.

OpenAI kaldes med et strikt JSON-schema med præcis `name` og `flavor`.
Workeren validerer derefter svaret igen: eksakte felter, navn på højst tre
ord, ingen URL'er/citationstegn/kontroltegn/tegnsætningsvildnis og flavor på
højst 240 tegn. Et ugyldigt modelsvar giver en eksplicit 502
(`reason: "invalid model output"`), retries ikke automatisk og caches
aldrig. Den senere klient ejer den deterministiske fallback.

### 12c. Durable Object storage-kontrakt

Alle nøgler ligger i den eksisterende `Coordinator`-storage:

| Formål | Nøgle |
|---|---|
| Sorteret, namespaced copy-cache | `improv-cache:<promptNamespace>:<a>+<b>:act:<act>` |
| Rullende rate limit pr. IP-hash | `rl:improvise:<ipHash>` |
| Globalt UTC-dagsbudget | `budget:improvise` |
| UTC-dagsbudget pr. IP-hash | `budget:improvise:ip:<ipHash>` |
| Smalle efterspørgselstællinger | `improv-stats:<a>+<b>:act:<act>` |

`promptNamespace` udledes automatisk af den **faktiske runtime-renderer**:
samme message-builder og `describeParent`-serialisering køres med en fuldt
udfyldt sentinel, så alle labels, separatorer, kanoniske parent-felter og
de tre eksempler indgår præcis som de renderes. Det færdige fingeraftryk
indeholder desuden systemprompten/rollerne, det faktiske response-format og
JSON-schema, modeloptionerne, output-grænserne og modelnavnet. Der findes
ingen separat, ubrugt skabelonstreng, som kan drive fra runtime-prompten.

Cache-hit undgår både modelkald og budgetreservation. Samtidige misses på
samme sorterede **par+akt** deler ét kald via den eksisterende
`InFlightRegistry`; forskellige akter deler aldrig cache eller in-flight.
Ved et cache-miss indfanges ét request-tidspunkt før storage-awaits, og
både det globale og pr.-IP UTC-dagsbudget reserveres mod netop den samme
UTC-dato — også hvis anmodningen krydser midnat undervejs.

Den eksisterende daglige alarm rydder også udløbne
improvisations-rate-limit-poster, cache-poster over 30 dage,
forældede pr.-IP-budgetposter og stats uden aktivitet i 90 dage.

### 12d. Autentificeret eksport — serverhalvdelen af TASK-029

```http
GET /admin/improvisations?limit=200&cursor=...
authorization: Bearer <ADMIN_EXPORT_TOKEN>
```

Endpointet genbruger præcis samme fail-closed tokenkontrol og interne
markørheader som `/admin/pairs`. Det eksporterer kun den aktuelle
prompt-namespaces cachede improvisationer i stabil, leksikalsk
`pair+act`-rækkefølge med en cursor-after-key. Ændringer i `count` eller
`lastSeen` mellem sider kan derfor ikke flytte en allerede set række og
skabe dubletter/huller. Hver række bevarer stadig de aktuelle,
sorterede forældre,
`name`/`flavor`, oprettelsestid og smalle tællinger (`count`,
`cacheHits`, `upstreamCalls`, `firstSeen`, `lastSeen`). Ingen rå eller
hashet IP, ingen prompt, intet token og ingen anden storage-post kan
optræde.

Dette er kun **server/export-halvdelen**. Der er ikke bygget et
`tools/harvest.mjs`, ikke skrevet noget til
`content/drafts/harvested.json`, og intet forfremmes automatisk. Faktisk
trafik, høst og menneskelig kuratering er fortsat eksternt og åbent arbejde.
