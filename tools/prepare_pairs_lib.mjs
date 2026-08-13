/**
 * TASK-008: rene funktioner bag `prepare_pairs.ts`s høste-tilstand
 * (`--live=<sti>`). Samme mønster som `pair_lookup.mjs`: logikken bor her,
 * som ren ESM uden noget I/O, og testes direkte i
 * `tests/prepare-pairs-lib.test.ts`. `prepare_pairs.ts` selv (kørt via
 * `npx vite-node`) står KUN for filhentning/-skrivning og selve CLI'en.
 *
 * Hvorfor par+DOM, ikke bare par: den eksisterende bagning
 * (`bakedPairKeys` i `pair_lookup.mjs`) ser kun om et PAR overhovedet er
 * bagt, uanset hvilken dom — fordi ingen bagt par i dag har mere end én
 * dom bagt. Men `docs/design/pair-frequency.json`s `verdicts`-opslag viser
 * at samme par ofte møder FLERE domme i praksis (fx "græs+vand" er oftest
 * "near-miss", men også ofte "clash"). Høste-tilstanden retter derfor
 * "uncured" mod den fulde par+dom-nøgle (`bakedLookupKeys`, ikke
 * `bakedPairKeys`), præcis som opgaven beder om — en dom der aldrig er
 * bagt for et par, er stadig en gyldig ny bage-kandidat, selvom PARRET
 * allerede har en anden, bagt dom.
 */

/** Hvor meget mere en ÆGTE, levende forespørgsel vejer end én simuleret møde — ægte trafik er knappere og derfor mere sigende pr. enhed. */
export const LIVE_TRAFFIC_WEIGHT = 10;

/**
 * Flader `pair-frequency.json`s `pairs[]` ud til ÉN indgang pr. par+dom
 * (modsat den eksisterende bagning, der kun ser den dominerende dom pr.
 * par). Falder tilbage til `{[verdict]: met}` hvis en indgang mangler det
 * detaljerede `verdicts`-opslag (ældre frekvensfiler).
 */
export function flattenVerdictCounts(freq) {
  if (!freq || !Array.isArray(freq.pairs)) {
    throw new Error("frekvensdata skal have et pairs-array");
  }
  const out = [];
  for (const p of freq.pairs) {
    const verdicts = p.verdicts && typeof p.verdicts === "object" ? p.verdicts : { [p.verdict]: p.met };
    for (const [verdict, count] of Object.entries(verdicts)) {
      out.push({
        key: `${p.key}:${verdict}`,
        pair: p.key,
        a: p.a,
        b: p.b,
        verdict,
        simulatedMet: count,
      });
    }
  }
  return out;
}

/**
 * Validerer den lokale, tidligere eksporterede levende-trafik-fil (skrevet
 * af `tools/live_pair_export.mjs`) og returnerer dens `entries`-array.
 * Samme defensive stil som `pair_lookup.mjs`s `pairsArray` — kast tydeligt
 * frem for stiltiende at læse `undefined`.
 */
export function liveExportEntries(doc) {
  if (!doc || !Array.isArray(doc.entries)) {
    throw new Error("levende eksport skal have et entries-array");
  }
  for (const e of doc.entries) {
    const ok =
      e &&
      typeof e.aId === "string" &&
      typeof e.bId === "string" &&
      typeof e.verdict === "string" &&
      typeof e.count === "number";
    if (!ok) {
      throw new Error(`ugyldig levende-eksport-indgang: ${JSON.stringify(e)}`);
    }
  }
  return doc.entries;
}

/**
 * Flet simuleret (`flattenVerdictCounts`s output) og ægte, levende
 * trafik sammen til ÉN liste pr. par+dom. En par+dom-nøgle der KUN findes
 * i den levende trafik (aldrig ramt i simuleringen) tages OGSÅ med, med
 * `simulatedMet: 0` — det er stadig et ægte, muligt bage-behov.
 */
export function mergeLiveTraffic(flattened, liveEntries) {
  const byKey = new Map(flattened.map((f) => [f.key, { ...f, liveCount: 0 }]));
  for (const rec of liveEntries ?? []) {
    const [first, second] = rec.aId <= rec.bId ? [rec.aId, rec.bId] : [rec.bId, rec.aId];
    const pair = `${first}+${second}`;
    const key = `${pair}:${rec.verdict}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.liveCount = rec.count;
    } else {
      byKey.set(key, {
        key,
        pair,
        a: first,
        b: second,
        verdict: rec.verdict,
        simulatedMet: 0,
        liveCount: rec.count,
      });
    }
  }
  return [...byKey.values()];
}

/**
 * Udelukker allerede bagte par+dom-nøgler (`curedKeys`, forventet =
 * `bakedLookupKeys(baked)` fra `pair_lookup.mjs`), regner
 * `combinedScore = simulatedMet + liveCount * vægt`, og sorterer
 * DETERMINISTISK: combinedScore faldende → liveCount faldende → nøgle
 * stigende. To kørsler over samme data giver derfor altid samme
 * rækkefølge, uanset input-rækkefølgen.
 */
export function rankUncuredCandidates(merged, curedKeys, opts = {}) {
  const weight = opts.liveTrafficWeight ?? LIVE_TRAFFIC_WEIGHT;
  const limit = opts.limit ?? Infinity;

  const candidates = merged
    .filter((m) => !curedKeys.has(m.key))
    .map((m) => ({ ...m, combinedScore: m.simulatedMet + m.liveCount * weight }));

  candidates.sort((x, y) => {
    if (y.combinedScore !== x.combinedScore) return y.combinedScore - x.combinedScore;
    if (y.liveCount !== x.liveCount) return y.liveCount - x.liveCount;
    if (x.key !== y.key) return x.key < y.key ? -1 : 1;
    return 0;
  });

  return candidates.slice(0, limit).map((c, i) => ({ ...c, rank: i + 1 }));
}

/**
 * Tolker `prepare_pairs.ts`s CLI-flag (`process.argv.slice(2)`). Ren
 * funktion — ingen `process`-adgang her, kun det array scriptet selv
 * giver videre, så den er testbar uden nogen rigtig proces.
 *
 *   --live=<sti>   slår høste-tilstanden til (uden dette: uændret legacy).
 *   --limit=<n>    højst så mange kandidater i forslaget (positivt heltal).
 *   --write        skriv forslaget til disk (uden dette: kun stdout-preview).
 *   --out=<sti>    hvor forslaget skrives, hvis --write er sat.
 *
 * Fejler HØJLYDT (kaster) på et ukendt flag eller en ugyldig værdi — en
 * tastefejl skal aldrig stiltiende blive tolket som "ingen ændring".
 */
export function parseCliArgs(argv) {
  const args = { live: null, limit: null, write: false, out: null };
  for (const raw of argv ?? []) {
    if (raw === "--write") {
      args.write = true;
    } else if (raw.startsWith("--live=")) {
      args.live = raw.slice("--live=".length);
    } else if (raw.startsWith("--limit=")) {
      const n = Number.parseInt(raw.slice("--limit=".length), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`ugyldig --limit (skal være et positivt heltal): ${raw}`);
      args.limit = n;
    } else if (raw.startsWith("--out=")) {
      args.out = raw.slice("--out=".length);
    } else {
      throw new Error(`ukendt flag: ${raw}`);
    }
  }
  return args;
}
