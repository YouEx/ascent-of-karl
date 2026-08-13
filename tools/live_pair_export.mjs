#!/usr/bin/env node
/**
 * TASK-008: CLI'en der høster ægte, produktions-trafik tilbage til
 * bageprocessen. Henter `GET /admin/pairs` (den autentificerede
 * admin-eksport, se `worker/src/coordinator-do.ts`s `handleAdminExport`),
 * validerer svaret, og skriver et lokalt, versioneret artefakt under
 * docs/design/ — INGEN token i den skrevne fil.
 *
 * Kørsel:
 *   LIVE_NARRATOR_ADMIN_URL=https://narrator.example/admin/pairs \
 *   LIVE_NARRATOR_ADMIN_TOKEN=<hemmeligt token> \
 *   node tools/live_pair_export.mjs
 *
 * Token og endpoint læses UDELUKKENDE fra miljøvariabler, ALDRIG fra
 * kommandolinje-argumenter — et argument ville stå i klartekst i
 * shell-historik og i enhver process-liste (`ps`), som enhver anden
 * bruger på samme maskine kan læse.
 *
 * Al selve logikken (hente sider, validere, bygge artefaktet) bor i
 * `live_pair_export_lib.mjs`s `run()` — ren ESM, INGEN rigtige
 * netværkskald, testet direkte i `tests/live-pair-export.test.ts` med
 * injicerede afhængigheder. Denne fil kalder blot `run()` ubetinget med
 * de RIGTIGE afhængigheder (proces-miljø, globalt `fetch`,
 * `node:fs`-læsning/-skrivning) — samme opdeling som
 * `tools/prepare_pairs.ts` (ubetinget kørsel ved modul-scope) og
 * `tools/prepare_pairs_lib.mjs` (rene, testede funktioner). Denne fil
 * importeres derfor ALDRIG af nogen test.
 *
 * Fejler HØJLYDT (ikke-nul exitkode + tydelig fejlbesked på stderr) ved
 * dårlig godkendelse (401) eller et uventet skema — se kravets egen tekst:
 * "fails loudly on bad auth/schema".
 */

import { readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_OUT_PATH, run } from "./live_pair_export_lib.mjs";

run({ readFile: readFileSync, writeFile: writeFileSync })
  .then((artifact) => {
    console.log(`✅ ${artifact.entries.length} par+dom-poster eksporteret til ${DEFAULT_OUT_PATH}`);
  })
  .catch((err) => {
    console.error(`❌ eksport fejlede: ${err.message}`);
    process.exitCode = 1;
  });
