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
 * Kontrakten (pages-build.json) er allerede sandheden om hvilke moduler der
 * indgår i en variant — den læses her i stedet for at gætte ud fra HTML.
 * index.html og CSS'en tages med, fordi netop CSS-driften var den, der ramte:
 * det live layout manglede mobilreglerne, mens JS'en så rigtig ud.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Varianter i artifactet: mappe under dist/ og deres offentlige rod. */
export const VARIANTS = [
  { label: "root", dir: ".", indexPath: "index.html" },
  {
    label: "playtest",
    dir: "playtest/improvisation",
    indexPath: "playtest/improvisation/index.html",
  },
];

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Hvilke filer skal sammenlignes for én variant? Ren funktion: HTML og
 * kontrakt ind, relative stier ud. Rækkefølgen er stabil, så output kan
 * diffes mellem kørsler.
 */
export function planFiles(html, contract) {
  const modules = Object.keys(contract?.modules ?? {});
  const css = [...html.matchAll(/["'(]([^"'()]*assets\/[^"'()]+\.css)["')]/g)]
    .map((match) => match[1].replace(/^\.?\//, ""));
  const seen = new Set();
  const files = [];
  for (const path of ["index.html", ...modules, ...css]) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    files.push(path);
  }
  return files;
}

/**
 * Fail-closed: alt andet end en bekræftet identisk byte-sammenligning tæller
 * som afvigelse. En 404 eller et netværksbrud må aldrig læses som "OK".
 */
export function summarise(results) {
  const drifted = results.filter((entry) => entry.status !== "identisk");
  return {
    ok: drifted.length === 0 && results.length > 0,
    checked: results.length,
    drifted,
  };
}

async function compareOne(publicUrl, dir, path) {
  const localPath = resolve(dir, path);
  if (!existsSync(localPath)) {
    return { path, status: "mangler lokalt" };
  }
  const local = sha256(readFileSync(localPath));
  let response;
  try {
    response = await fetch(new URL(path, publicUrl));
  } catch (error) {
    return {
      path,
      status: `netværksfejl: ${error instanceof Error ? error.message : String(error)}`,
    };
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

export async function verifyLiveDeploy({ root = resolve(REPO_ROOT, "dist") } = {}) {
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
    for (const path of planFiles(html, contract)) {
      const result = await compareOne(publicUrl, dir, path);
      results.push({ ...result, variant: variant.label, publicUrl });
    }
  }
  return summarise(results);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  try {
    const summary = await verifyLiveDeploy();
    for (const entry of summary.drifted) {
      console.error(`❌ ${entry.variant}/${entry.path}: ${entry.status}`);
    }
    if (summary.ok) {
      console.log(
        `✅ Live svarer til det lokale artifact: ${summary.checked} filer byte-identiske.`,
      );
    } else {
      console.error(
        `❌ Live afviger fra det lokale artifact (${summary.drifted.length} af ${summary.checked}).\n` +
          "   Push main og lad Pages-deployet køre færdigt, FØR deltagere rekrutteres.",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
