/** Fælles læser for det kompakte pairs-format: en liste af "par:dom"-nøgler. */
function pairsArray(doc) {
  if (!doc || !Array.isArray(doc.pairs)) {
    throw new Error("pairs skal være en liste af \"par:dom\"-nøgler");
  }
  for (const key of doc.pairs) {
    if (typeof key !== "string" || key.lastIndexOf(":") <= 0) {
      throw new Error(`ugyldig pair-opslagsnøgle: ${JSON.stringify(key)}`);
    }
  }
  return doc.pairs;
}

/** Alle konkrete par+dom-opslag, præcis som motoren slår dem op. */
export function bakedLookupKeys(doc) {
  return new Set(pairsArray(doc));
}

/** Par uden dom, til bageværktøjer der kun skal vide om parret er skrevet. */
export function bakedPairKeys(doc) {
  return new Set(
    pairsArray(doc).map((key) => key.slice(0, key.lastIndexOf(":"))),
  );
}
