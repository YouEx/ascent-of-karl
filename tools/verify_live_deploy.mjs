#!/usr/bin/env node
/**
 * Verificerer at det, der ligger LIVE på GitHub Pages, er de samme bytes som
 * det lokale artifact — altså at deltagerne møder nuværende `main`.
 *
 * Hvorfor et værktøj og ikke en note i PRD'en: forudsætningen "deploy før
 * rekruttering" blev første gang dokumenteret ved at skrive de aktuelle
 * asset-hashes ind i PRD.md. To commits senere var de hashes forældede, og
 * noten påstod noget usandt. En påstand om foranderlig tilstand hører hjemme i
 * en kørsel, ikke i prosa. Kør derfor denne før hver rekrutteringsrunde:
 *
 *     npm run build:pages && npm run verify:live
 *
 * DÆKNING: hver eneste fil i artifactet sammenlignes — ikke kun de hashede
 * assets. Første udgave af værktøjet læste kun index.html, kontraktens moduler
 * og CSS'en fra HTML'en: 8 filer ud af 2.936. Alt, der kopieres uændret fra
 * public/ under STABILE navne, var dermed usynligt — først og fremmest de
 * 1.415 lydfiler pr. variant og audio/manifest.json, som src/ui/audio.ts
 * henter på fast sti. Netop den slags var den oprindelige hændelse: den danske
 * fortællerstemme blev rettet i public/audio/, og et hashet bundt ville aldrig
 * have afsløret, om rettelsen var nået live. Et værktøj, der siger "live
 * svarer til det lokale artifact", skal have set hele artifactet.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Hvor mange filer hentes samtidig.
 *
 * Målt mod den rigtige udgivelse, 2.936 filer: ~8 s ved 12 samtidige, når
 * CDN'et er køligt. Ved 24 blev grænsen ramt på anden kørsel i træk (HTTP 429
 * på alle 2.936 filer), så tallet er sat efter hvad der holder i træk, ikke
 * efter hvad der er hurtigst én gang.
 */
const CONCURRENCY = 12;

/** Efter et 429 fortsætter kørslen med så få samtidige hentninger. */
const THROTTLED_CONCURRENCY = 3;

/** Så mange gange må grænsen rammes, før genforsøg opgives som formålsløse. */
const MAX_THROTTLE_TRIPS = 12;

/** Kontraktskemaet værktøjet er skrevet til. */
export const SUPPORTED_CONTRACT_SCHEMA = 2;

/**
 * Varianter i artifactet: mappe under dist/ og deres offentlige rod.
 *
 * Listen SKAL svare til createPagesBuildPlan i tools/build_pages.mjs. Den er
 * ikke importeret derfra, fordi planen kræver et miljø og bygger env ind i
 * hvert trin; i stedet holder tests/verify-live-deploy.test.ts de to lister
 * fast på hinanden, så en tredje variant ikke kan tilføjes uden at blive
 * verificeret. `nested` er de undermapper, der er selvstændige varianter og
 * derfor ikke må tælles med i rodens gennemgang.
 */
export const VARIANTS = [
  {
    label: "root",
    dir: ".",
    indexPath: "index.html",
    nested: ["playtest"],
  },
  {
    label: "playtest",
    dir: "playtest/improvisation",
    indexPath: "playtest/improvisation/index.html",
    nested: [],
  },
];

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Alle filer under en variantmappe, som relative POSIX-stier. Undermapper, der
 * selv er varianter, springes over, så de ikke tælles to gange.
 */
export function listVariantFiles(dir, nested = []) {
  const skip = new Set(nested);
  const files = [];
  const walk = (absolute, prefix) => {
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (prefix === "" && skip.has(entry.name)) continue;
      const relative = prefix ? posix.join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(resolve(absolute, entry.name), relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  };
  walk(dir, "");
  return files.sort();
}

/**
 * Hvilke filer skal sammenlignes for én variant? Ren funktion: HTML, kontrakt
 * og den faktiske filliste ind, relative stier ud.
 *
 * Hele `walked` sammenlignes — kontrakten og HTML'en bruges nu udelukkende til
 * at bevise, at gennemgangen er komplet, og til at hente de vigtigste filer
 * FØRST. Rækkefølgen fremskynder ikke rapporten: intet skrives, før begge
 * varianter er gennemløbet. Den afgør dækningen, hvis kørslen ikke når til
 * ende — afbrydes den, eller lukker CDN'et ned undervejs, er bundtet og
 * indgangs-HTML'en allerede sammenlignet, i stedet for at 1.400 lydfiler var
 * nået først.
 *
 * Fail-closed på skemadrift: hvis pages-build.json skifter form, må værktøjet
 * ikke stille og roligt konkludere "ingen moduler at tjekke" og alligevel
 * skrive ✅. Så hellere kaste og blive rettet.
 */
export function planFiles(html, contract, walked = []) {
  if (contract?.schema !== SUPPORTED_CONTRACT_SCHEMA) {
    throw new Error(
      `pages-build.json har skema ${JSON.stringify(contract?.schema)}, forventet ${SUPPORTED_CONTRACT_SCHEMA} — opdatér verify_live_deploy.mjs sammen med kontrakten`,
    );
  }
  const modules = Object.keys(contract.modules ?? {});
  if (modules.length === 0) {
    throw new Error(
      "pages-build.json angiver ingen moduler — en variant uden JS er ikke et gyldigt artifact",
    );
  }
  const css = [...html.matchAll(/["'(]([^"'()]*assets\/[^"'()]+\.css)["')]/g)]
    .map((match) => match[1].replace(/^\.?\//, ""));

  const known = new Set(walked);
  const seen = new Set();
  const files = [];
  for (const path of ["index.html", ...modules, ...css]) {
    if (!path || seen.has(path)) continue;
    if (walked.length > 0 && !known.has(path)) {
      throw new Error(
        `${path} står i kontrakten eller HTML'en, men findes ikke i artifactet`,
      );
    }
    seen.add(path);
    files.push(path);
  }
  for (const path of walked) {
    if (seen.has(path)) continue;
    seen.add(path);
    files.push(path);
  }
  return files;
}


/**
 * Fail-closed: alt andet end en bekræftet identisk byte-sammenligning tæller
 * som afvigelse. En 404 eller et netværksbrud må aldrig læses som "OK".
 *
 * Listen sorteres, fordi 24 arbejdere afleverer i den rækkefølge, svarene
 * tilfældigvis kommer. Uden sortering ville to kørsler med samme fund udskrive
 * dem i forskellig orden, og så kan en operatør ikke diffe den ene mod den
 * anden.
 */
export function summarise(results) {
  const drifted = results
    .filter((entry) => entry.status !== "identisk")
    .sort(
      (a, b) =>
        String(a.variant).localeCompare(String(b.variant)) ||
        String(a.path).localeCompare(String(b.path)),
    );
  return {
    ok: drifted.length === 0 && results.length > 0,
    checked: results.length,
    drifted,
    unreachable: drifted.filter((entry) => entry.transport === true),
  };
}

/**
 * Et svar, der ikke er et svar: netværksbrud, 429 og 5xx. De siger intet om,
 * hvad der ligger live, og skal forsøges igen. Ved 2.936 hentninger rammer man
 * CDN'ets tilfældige 503'ere — uden genforsøg ville værktøjet melde "live
 * afviger, push main igen", hvilket er den forkerte handling på en blip. Et
 * værktøj, der råber ulv, bliver ignoreret.
 */
export function isTransient(status) {
  return status === 429 || status >= 500;
}

export const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * En FÆLLES bremse for alle arbejdere.
 *
 * Målt mod den rigtige udgivelse: to fulde gennemgange i træk (2×2.936 filer
 * ved 24 samtidige) fik GitHub Pages til at svare HTTP 429 — først på 869
 * filer, og på næste kørsel på alle 2.936. Værktøjet meldte altså rødt på en
 * udgivelse, der var fuldstændig i orden. Det er præcis den ulvehylen,
 * genforsøgene skulle forhindre.
 *
 * Genforsøg pr. arbejder kan ikke løse en hastighedsgrænse: mens den ene
 * venter, bliver de 23 andre ved med at banke på, så grænsen aldrig får luft.
 * Bremsen her er derfor global — ser ÉN arbejder et 429, standser de alle
 * sammen indtil `until`, og resten af kørslen fortsætter med færre samtidige
 * hentninger. En langsom, grøn kørsel er svaret; en hurtig, rød er ikke.
 */
export function createThrottle({ now = Date.now, wait = sleep } = {}) {
  let until = 0;
  let trips = 0;
  return {
    get tripped() {
      return trips > 0;
    },
    get trips() {
      return trips;
    },
    /**
     * Har grænsen ramt så mange gange, at flere genforsøg kun gør skade?
     *
     * Målt: fem fulde gennemgange i træk fik en kørsel op på 311 sekunder,
     * fordi 52 stædige filer hver især gik hele genforsøgsstigen igennem bag
     * en fælles pause. Fem minutters formaling for til sidst at melde det
     * samme som efter ti sekunder er den forkerte slags tålmodighed: svaret
     * er at holde op og sige HVORFOR.
     */
    get exhausted() {
      return trips >= MAX_THROTTLE_TRIPS;
    },
    async settle() {
      const remaining = until - now();
      if (remaining > 0) await wait(remaining);
    },
    pause(ms) {
      trips += 1;
      until = Math.max(until, now() + ms);
    },
  };
}

/**
 * `Retry-After` er CDN'ets eget svar på "hvor længe skal du holde dig væk".
 * Den vejer tungere end vores egen stige — men aldrig lavere end den, og
 * aldrig længere end et minut, så en fjendtlig header ikke kan hænge kørslen.
 */
export function retryAfterMs(header, fallback) {
  if (!header) return fallback;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(seconds * 1000, fallback), 60_000);
  }
  const at = Date.parse(header);
  if (Number.isFinite(at)) {
    return Math.min(Math.max(at - Date.now(), fallback), 60_000);
  }
  return fallback;
}

export async function fetchLive(
  url,
  delays = RETRY_DELAYS_MS,
  throttle = createThrottle(),
) {
  let last;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (attempt > 0) await sleep(delays[attempt - 1]);
    await throttle.settle();
    try {
      const response = await fetch(url);
      if (!isTransient(response.status)) return { response };
      if (response.status === 429) {
        throttle.pause(
          retryAfterMs(
            response.headers?.get?.("retry-after"),
            delays[Math.min(attempt, delays.length - 1)] ?? 1_000,
          ),
        );
      }
      last = { status: `HTTP ${response.status}`, transport: true };
      if (throttle.exhausted) return { failure: last };
    } catch (error) {
      last = {
        status: `netværksfejl: ${error instanceof Error ? error.message : String(error)}`,
        transport: true,
      };
    }
  }
  return { failure: last };
}

async function compareOne(publicUrl, dir, path, throttle, delays) {
  const localPath = resolve(dir, path);
  if (!existsSync(localPath)) {
    return { path, status: "mangler lokalt" };
  }
  const local = sha256(readFileSync(localPath));
  const { response, failure } = await fetchLive(
    new URL(path, publicUrl),
    delays,
    throttle,
  );
  if (failure) {
    return { path, ...failure };
  }
  if (!response.ok) {
    return { path, status: `HTTP ${response.status}` };
  }
  const live = sha256(Buffer.from(await response.arrayBuffer()));
  return {
    path,
    status: live === local ? "identisk" : "afviger",
    local,
    live,
  };
}

export async function verifyLiveDeploy({
  root = resolve(REPO_ROOT, "dist"),
  onProgress,
  // Sømmene findes, for at en test kan bevise adfærden under en
  // hastighedsgrænse uden at vente rigtige sekunder på den.
  delays = RETRY_DELAYS_MS,
  // Én bremse for hele kørslen: rammer playtest-varianten en grænse, skal
  // root-varianten heller ikke banke videre.
  throttle = createThrottle(),
} = {}) {
  const results = [];
  for (const variant of VARIANTS) {
    const dir = resolve(root, variant.dir);
    const contractPath = resolve(dir, "pages-build.json");
    const indexPath = resolve(root, variant.indexPath);
    if (!existsSync(contractPath) || !existsSync(indexPath)) {
      throw new Error(
        `artifactet mangler ${variant.label}-varianten — kør \`npm run build:pages\` først`,
      );
    }
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    const html = readFileSync(indexPath, "utf8");
    const publicUrl = contract.publicUrl;
    if (typeof publicUrl !== "string" || !publicUrl.endsWith("/")) {
      throw new Error(
        `${variant.label}: publicUrl i pages-build.json skal være en URL der slutter på "/"`,
      );
    }
    const walked = listVariantFiles(dir, variant.nested ?? []);
    const files = planFiles(html, contract, walked);
    onProgress?.({ variant: variant.label, total: files.length });

    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        // Har grænsen ramt igen og igen, er der ikke mere at lære af at blive
        // ved. Målt: en gennemgang bag gentagne `Retry-After: 60` tog 310
        // sekunder for til sidst at sige præcis det samme som efter de første
        // ti. Kørslen opgives derfor — men de filer, der aldrig blev forsøgt,
        // skrives ind som netop dét nedenfor. En afkortet kørsel må ALDRIG
        // kunne ende som et ✅.
        if (throttle.exhausted) return;
        // Er bremsen trådt i kraft, trækker de overskydende arbejdere sig helt.
        // Det er dét, der giver grænsen luft; ellers venter de blot synkront og
        // fortsætter med samme tryk bagefter.
        if (throttle.tripped && active > THROTTLED_CONCURRENCY) {
          active -= 1;
          return;
        }
        const path = files[next++];
        const result = await compareOne(publicUrl, dir, path, throttle, delays);
        results.push({ ...result, variant: variant.label, publicUrl });
      }
    };
    let active = Math.min(
      throttle.tripped ? THROTTLED_CONCURRENCY : CONCURRENCY,
      files.length,
    );
    await Promise.all(Array.from({ length: active }, worker));

    for (const path of files.slice(next)) {
      results.push({
        path,
        status: "ikke forsøgt — hastighedsgrænse",
        transport: true,
        variant: variant.label,
        publicUrl,
      });
    }
  }
  return { ...summarise(results), rateLimited: throttle.tripped };
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  try {
    const summary = await verifyLiveDeploy({
      onProgress: ({ variant, total }) =>
        console.log(`… sammenligner ${total} filer i ${variant}-varianten`),
    });
    for (const entry of summary.drifted) {
      console.error(`❌ ${entry.variant}/${entry.path}: ${entry.status}`);
    }
    if (summary.ok) {
      console.log(
        `✅ Live svarer til det lokale artifact: hele artifactet, ${summary.checked} filer, byte-identisk.`,
      );
    } else {
      const unreachable = summary.unreachable.length;
      // Rækkefølgen er ikke tilfældig: en hastighedsgrænse ligner en nedbrudt
      // udgivelse, og den forkerte diagnose sender operatøren ud i et
      // gen-deploy, der ikke fejler noget. Er der ikke fundet én eneste
      // bytedrift, og har Pages bremset os, SIGES det.
      const remedy =
        unreachable < summary.drifted.length
          ? "   Push main og lad Pages-deployet køre færdigt, FØR deltagere rekrutteres."
          : summary.rateLimited
            ? "   Ingen byte-afvigelser. GitHub Pages hastighedsbegrænsede opslagene (HTTP 429) — udgivelsen fejler intet.\n" +
              "   Vent et par minutter og kør igen; værktøjet henter 2.936 filer, og det tåler CDN'et ikke i tæt rækkefølge."
            : "   Ingen byte-afvigelser — kun filer, der ikke kunne hentes. Kør igen; holder det ved, er det Pages selv, der er nede.";
      console.error(
        `❌ Live afviger fra det lokale artifact (${summary.drifted.length} af ${summary.checked}` +
          (unreachable > 0 ? `, heraf ${unreachable} uden svar` : "") +
          `).\n` +
          remedy,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
