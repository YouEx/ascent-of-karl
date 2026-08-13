#!/usr/bin/env node
/**
 * Rapporten — sløjfens eneste menneskevendte output.
 *
 * Skriver en SELVSTÆNDIG `<run>/report.html`: ingen CDN, intet netværk,
 * kun relative stier ind i samme kørselsmappe (overlay-billederne, som
 * overlay.py allerede har gemt der). Et udviklerartefakt under den
 * ignorerede `.judge/` — ikke en holdbar spillervendt side, og derfor
 * lægges den ikke i docs/design/ eller noget versioneret sted.
 *
 * `renderReport` er ren streng-bygning: intet filsystem, intet netværk.
 * Kalderen (main() nedenfor) læser ledger.json/scores.json/køerne fra disk
 * og giver dem videre som allerede-parsede objekter. Det er det, der gør
 * hele rapportens indhold testbart med håndlavede fixtures.
 *
 * ALT modelgenereret og journalbåret fritekst (evidence, spec, change,
 * reason, token-navne, stiangivelser) sendes igennem `escapeHtml` før det
 * sættes ind i markup — en dommer er en sandsynlighedsmaskine, og dens rå
 * output er lige så utroværdigt at indsætte urenset i HTML, som enhver
 * anden brugerleveret streng. Rapporten kan stadig åbnes i en browser og
 * eksekvere script, selvom den kun ligger lokalt.
 *
 * Kør:
 *   node tools/judge/report.mjs [--run .judge/<run>] [--open]
 * Uden --open udskrives kun stien (CI/headless-sikkert, TASK-028's krav).
 * Se plan/architecture-visual-judge-1.md TASK-025, TASK-026, TASK-028.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRY_PATH = path.join(ROOT, "docs/design/reference/registry.json");
const ASSET_QUEUE = path.join(ROOT, "docs/design/asset-queue.json");
const HUMAN_QUEUE = path.join(ROOT, "docs/design/human-queue.json");

const readJson = (p, fallback) =>
  fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : fallback;

/**
 * HTML-escape. ALT modeltekst og journaldata SKAL igennem denne, før det
 * sættes ind i markup — se filens toptekst for hvorfor.
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const fmt = (n) => (typeof n === "number" ? n.toFixed(3) : "–");
const fmtSigned = (n) => (typeof n === "number" ? `${n >= 0 ? "+" : ""}${n.toFixed(3)}` : "–");

function badgeColour(verdict) {
  if (verdict === "accepted") return "#7fae6a";
  if (verdict === "rejected") return "#c97a6a";
  if (verdict === "blocked") return "#c9a24a";
  return "#8a7d6e";
}

/** Regionens tærskelstatus for ÉN skærm — bruges af scoretabellen. */
function renderScoreTable(scores) {
  if (!scores || !scores.screens) {
    return `<p class="muted">ingen scores.json fundet for denne kørsel.</p>`;
  }
  // metrics.py scorer ALLE registry-skærme hver gang, også dem der ikke
  // blev optaget i denne kørsel (fx en `--screen title`-kørsel) — de får en
  // stub med overall 0 og EVERY region missing:true. Uden dette filter
  // ville rapporten pege på overlay-billeder, der aldrig blev genereret.
  const isScreenCaptured = (s) => Object.values(s.regions ?? {}).some((r) => !r.missing);
  const sections = Object.entries(scores.screens)
    .filter(([, s]) => isScreenCaptured(s))
    .map(([sid, s]) => {
    const rows = Object.entries(s.regions ?? {})
      .sort((a, b) => a[1].overall - b[1].overall)
      .map(([rid, r]) => {
        const passing = typeof r.threshold === "number" ? r.overall >= r.threshold : null;
        // r.missing: regionens anker blev ikke fundet i optagelsen — det er
        // IKKE det samme som at bestå eller fejle en visuel sammenligning,
        // og skal ikke fremstå som "under tærskel" (som ville antyde et
        // faktisk set, men dårligt, resultat).
        const status = r.missing ? "mangler" : passing === null ? "–" : passing ? "består" : "under tærskel";
        const statusColour = r.missing ? "#c9a24a" : passing === null ? "#8a7d6e" : passing ? "#7fae6a" : "#c97a6a";
        return `<tr>
          <td>${escapeHtml(rid)}</td>
          <td>${fmt(r.overall)}</td>
          <td>${fmt(r.threshold)}</td>
          <td style="color:${statusColour}">${status}</td>
        </tr>`;
      })
      .join("");
    return `<section class="screen">
      <h2>${escapeHtml(sid)} <em>samlet ${fmt(s.overall)}</em></h2>
      <div class="images">
        <figure><img src="overlay/${encodeURIComponent(sid)}.png" loading="lazy" alt="${escapeHtml(sid)}: 50/50-overlejring"><figcaption>50/50-overlejring</figcaption></figure>
        <figure><img src="overlay/${encodeURIComponent(sid)}-heat.png" loading="lazy" alt="${escapeHtml(sid)}: afvigelseskort"><figcaption>afvigelseskort</figcaption></figure>
      </div>
      <table>
        <thead><tr><th>region</th><th>overall</th><th>tærskel</th><th>status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  });
  return sections.join("\n");
}

function renderFixSummary(fix) {
  if (!fix) return "–";
  if (fix.kind === "token") {
    return `<code>${escapeHtml(fix.token)}</code>: ${escapeHtml(fix.from)} → ${escapeHtml(fix.to)}`;
  }
  if (fix.kind === "asset") {
    return `aktiv <code>${escapeHtml(fix.assetId)}</code> — ${escapeHtml(fix.spec)}`;
  }
  if (fix.kind === "structure") {
    return `struktur i <code>${escapeHtml(fix.file)}</code> — ${escapeHtml(fix.change)}`;
  }
  return escapeHtml(JSON.stringify(fix));
}

function renderFindingsList(findings) {
  if (!findings?.length) return `<p class="muted">ingen fund.</p>`;
  return `<ul class="findings">${findings
    .map(
      (f) => `<li>
        <strong>${escapeHtml(f.region)}</strong> · ${escapeHtml(f.defect)} · sværhedsgrad ${escapeHtml(f.severity)}
        <div class="evidence">${escapeHtml(f.evidence)}</div>
        <div class="fix">${renderFixSummary(f.fix)}</div>
      </li>`,
    )
    .join("")}</ul>`;
}

/** Før/efter-delta pr. region, for de skærme iterationen rørte. */
function renderDeltaTable(before, after) {
  if (!before?.screens || !after?.screens) return "";
  const rows = [];
  for (const [sid, sAfter] of Object.entries(after.screens)) {
    const sBefore = before.screens[sid];
    if (!sBefore) continue;
    for (const [rid, rAfter] of Object.entries(sAfter.regions ?? {})) {
      const rBefore = sBefore.regions?.[rid];
      if (!rBefore) continue;
      // Begge sider "missing" betyder metrics.py's stub for en skærm, som
      // denne kørsel slet ikke optog (fx en --screen title-kørsel, hvor
      // "game" stadig scores som alt-nul) — ikke en reel ændring at vise.
      if (rBefore.missing && rAfter.missing) continue;
      const delta = rAfter.overall - rBefore.overall;
      rows.push(`<tr>
        <td>${escapeHtml(sid)}/${escapeHtml(rid)}</td>
        <td>${fmt(rBefore.overall)}</td>
        <td>${fmt(rAfter.overall)}</td>
        <td style="color:${delta >= 0 ? "#7fae6a" : "#c97a6a"}">${fmtSigned(delta)}</td>
      </tr>`);
    }
  }
  if (!rows.length) return "";
  return `<table class="delta"><thead><tr><th>region</th><th>før</th><th>efter</th><th>delta</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function renderIteration(iter) {
  const applied = iter.applied ?? iter.attempted ?? [];
  const appliedLabel = iter.verdict === "accepted" ? "anvendt" : iter.verdict === "rejected" ? "forsøgt (rullet tilbage)" : "ingen";
  const regressionsHtml = iter.regressions?.length
    ? `<p class="regressions">regression: ${iter.regressions.map((r) => `${escapeHtml(r.region)} (${fmtSigned(-r.drop)})`).join(", ")}</p>`
    : "";
  return `<article class="iteration">
    <header>
      <span class="badge" style="background:${badgeColour(iter.verdict)}">${escapeHtml(iter.verdict)}</span>
      <strong>iteration ${escapeHtml(iter.n)}</strong>
      <time>${escapeHtml(iter.at)}</time>
      ${typeof iter.gain === "number" ? `<span class="gain">gevinst ${fmtSigned(iter.gain)}</span>` : ""}
    </header>
    <p class="reason">${escapeHtml(iter.reason)}</p>
    ${regressionsHtml}
    <h4>fund</h4>
    ${renderFindingsList(iter.findings)}
    <h4>${appliedLabel}</h4>
    ${applied.length ? `<ul class="applied">${applied.map((t) => `<li>${renderFixSummary(t.fix)} <small>(${escapeHtml(t.region)}/${escapeHtml(t.defect)})</small></li>`).join("")}</ul>` : `<p class="muted">ingen.</p>`}
    ${renderDeltaTable(iter.before, iter.after)}
  </article>`;
}

function renderRejectedMemory(rejected) {
  if (!rejected?.length) return `<p class="muted">intet afvist endnu.</p>`;
  return `<ul class="rejected">${rejected
    .map((r) => {
      const keys = [r.key, ...(r.consolidatedFrom ?? [])];
      return `<li><code>${keys.map(escapeHtml).join("</code>, <code>")}</code> — ${renderFixSummary(r.fix)} <small>(iteration ${escapeHtml(r.iteration)})</small></li>`;
    })
    .join("")}</ul>`;
}

function renderQueue(title, queue) {
  const items = queue?.items ?? [];
  if (!items.length) return `<section class="queue"><h3>${escapeHtml(title)}</h3><p class="muted">tom.</p></section>`;
  return `<section class="queue">
    <h3>${escapeHtml(title)} <em>${items.length}</em></h3>
    <ul>${items
      .map(
        (it) => `<li>
          <strong>${escapeHtml(it.region)}</strong> · sværhedsgrad ${escapeHtml(it.severity)} · ${escapeHtml(it.status ?? "open")}
          <div>${renderFixSummary(it.fix)}</div>
        </li>`,
      )
      .join("")}</ul>
  </section>`;
}

const STYLE = `
:root{color-scheme:light dark}
body{font:15px/1.55 ui-sans-serif,system-ui,sans-serif;margin:0;padding:32px;
background:#14110f;color:#efe4d6;max-width:1100px}
h1{font-size:26px;margin:0 0 6px} h1 em{font-weight:400;opacity:.6;font-size:16px}
h2{font-size:20px;margin:40px 0 12px;border-bottom:1px solid #3a2f28;padding-bottom:8px}
h2 em{font-weight:400;opacity:.65;font-size:15px}
h3{font-size:16px;margin:0 0 8px} h3 em{font-style:normal;opacity:.6;font-size:13px}
h4{font-size:13px;text-transform:uppercase;letter-spacing:.04em;opacity:.65;margin:16px 0 6px}
.muted{opacity:.55}
.images{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
figure{margin:0} figure img{width:100%;border-radius:8px;display:block}
figcaption{opacity:.6;font-size:13px;padding-top:5px}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th,td{text-align:left;padding:4px 8px 4px 0;font-size:13px}
thead th{opacity:.6;font-weight:500;border-bottom:1px solid #3a2f28}
code{background:#241d18;padding:1px 5px;border-radius:4px;font-size:12.5px}
.summary{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0 20px;font-size:13px;opacity:.85}
.summary b{color:#e0b98f}
.iteration{border:1px solid #3a2f28;border-radius:10px;padding:14px 16px;margin-bottom:14px}
.iteration header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.badge{color:#14110f;font-weight:700;font-size:11px;text-transform:uppercase;
padding:2px 8px;border-radius:999px}
.gain{margin-left:auto;opacity:.75;font-size:13px}
time{opacity:.5;font-size:12px}
.reason{opacity:.8;font-size:13.5px;margin:8px 0}
.regressions{color:#c97a6a;font-size:13px}
.findings li,.rejected li,.applied li{margin-bottom:8px;font-size:13.5px}
.evidence{opacity:.75;font-size:12.5px;margin-top:2px}
.fix{margin-top:2px}
.queue{margin-bottom:18px}
`;

/**
 * Ren renderfunktion — intet filsystem, intet netværk. `ledger` kan være
 * null (ingen sløjfekørsel er lavet endnu for denne mappe, kun optag+scor)
 * uden at rapporten krakker: scoretabellen vises stadig, resten udelades
 * med en tydelig besked.
 */
export function renderReport({ run, ledger, registry, scores, assetQueue, humanQueue }) {
  const effectiveScores = scores ?? ledger?.finalScores ?? ledger?.bestScores ?? ledger?.baselineScores ?? null;
  const screenIds = ledger?.screens ?? registry?.screens?.map((s) => s.id) ?? [];

  const summary = ledger
    ? `<div class="summary">
        <span>udfald: <b>${escapeHtml(ledger.outcome)}</b></span>
        <span>stop: <b>${escapeHtml(ledger.stopReason)}</b></span>
        <span>iterationer: <b>${escapeHtml(ledger.iterations?.length ?? 0)}</b></span>
        <span>startet: ${escapeHtml(ledger.startedAt)}</span>
        <span>afsluttet: ${escapeHtml(ledger.finishedAt)}</span>
      </div>`
    : `<p class="muted">ingen journal (ledger.json) fundet for denne kørsel — viser kun optag/scor, sløjfen er ikke kørt her endnu.</p>`;

  const iterationsHtml = ledger?.iterations?.length
    ? `<h2>Iterationer</h2>${ledger.iterations.map(renderIteration).join("\n")}`
    : "";

  const rejectedHtml = ledger
    ? `<h2>Afvist hukommelse <em>fodres tilbage til dommeren næste gang</em></h2>${renderRejectedMemory(ledger.rejected)}`
    : "";

  const queuesHtml = assetQueue || humanQueue
    ? `<h2>Blokerende fund <em>venter på aktiv eller menneske</em></h2>
       ${renderQueue("aktiv-kø (asset-queue.json)", assetQueue)}
       ${renderQueue("menneske-kø (human-queue.json)", humanQueue)}`
    : "";

  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<title>Visuel dommer — kørselsrapport ${escapeHtml(run)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>Visuel dommer <em>— ${escapeHtml(run)}</em></h1>
<p class="muted">Udviklerartefakt. Genereret af tools/judge/report.mjs, ikke en spillervendt side.</p>
${summary}
<h2>Scorer${screenIds.length ? ` <em>${screenIds.map(escapeHtml).join(", ")}</em>` : ""}</h2>
${renderScoreTable(effectiveScores)}
${iterationsHtml}
${rejectedHtml}
${queuesHtml}
</body>
</html>`;
}

function valueOf(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function main() {
  const args = process.argv.slice(2);
  const run = path.resolve(ROOT, valueOf(args, "--run") ?? ".judge/latest");
  const open = args.includes("--open");

  const ledger = readJson(path.join(run, "ledger.json"), null);
  const scores = readJson(path.join(run, "scores.json"), null);
  const registry = readJson(REGISTRY_PATH, { screens: [], allowedDeviations: [] });
  const assetQueue = readJson(ASSET_QUEUE, { items: [] });
  const humanQueue = readJson(HUMAN_QUEUE, { items: [] });

  const html = renderReport({ run, ledger, registry, scores, assetQueue, humanQueue });
  fs.mkdirSync(run, { recursive: true });
  const outPath = path.join(run, "report.html");
  fs.writeFileSync(outPath, html);

  // Uden --open udskrives KUN stien — CI/headless-sikkert (opgavens krav).
  console.log(`→ ${outPath}`);
  if (open) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    execFile(opener, [outPath], () => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
