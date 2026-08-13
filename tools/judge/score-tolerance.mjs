export const SCORE_ASPECTS = Object.freeze([
  "overall",
  "structure",
  "tone",
  "ink",
  "geometry",
  "materiality",
]);

/** Samme fire decimaler som acceptGate historisk har dømt på. Normalisering
 * sker FØR grænsesammenligningen, så 0,0200 består og 0,0201 fejler overalt. */
export function normalizedDrop(before, after) {
  return +(before - after).toFixed(4);
}

export function exceedsMaxDrop(before, after, maxDrop) {
  return normalizedDrop(before, after) > maxDrop;
}

/** Finder både regions-overall og de fem ortogonale aspektfald. Gamle,
 * syntetiske fixtures med kun `overall` virker fortsat; rigtige scores får
 * den stærkere per-aspekt-port, som forhindrer at fx tone ofres for struktur. */
export function collectScoreRegressions(before, after, {
  maxDrop = 0.02,
  screenIds = null,
} = {}) {
  const regressions = [];
  for (const [screenId, screenAfter] of Object.entries(after?.screens ?? {})) {
    if (screenIds && !screenIds.includes(screenId)) continue;
    for (const [regionId, regionAfter] of Object.entries(screenAfter.regions ?? {})) {
      const regionBefore = before?.screens?.[screenId]?.regions?.[regionId];
      if (!regionBefore) continue;
      for (const aspect of SCORE_ASPECTS) {
        if (typeof regionBefore[aspect] !== "number" || typeof regionAfter[aspect] !== "number") continue;
        const drop = normalizedDrop(regionBefore[aspect], regionAfter[aspect]);
        if (!exceedsMaxDrop(regionBefore[aspect], regionAfter[aspect], maxDrop)) continue;
        regressions.push({
          region: aspect === "overall"
            ? `${screenId}/${regionId}`
            : `${screenId}/${regionId}/${aspect}`,
          ...(aspect === "overall" ? {} : { aspect }),
          drop,
        });
      }
    }
  }
  return regressions;
}
