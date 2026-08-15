/**
 * Værktøjet i tools/verify_live_deploy.mjs findes, fordi PRD'en engang
 * dokumenterede "deploy før rekruttering" ved at skrive de dengang aktuelle
 * asset-hashes ind i prosaen. To commits senere var de forældede, og noten
 * påstod noget usandt om live. Testene her holder på det, der gjorde værktøjet
 * bedre end noten: at det er fail-closed. En 404, et netværksbrud eller en tom
 * kørsel må aldrig kunne læses som "live svarer til main".
 *
 * Kun de rene funktioner testes her — selve sammenligningen kræver netværk og
 * hører til i den manuelle kørsel før en rekrutteringsrunde.
 */
import { describe, expect, it } from "vitest";

import { planFiles, summarise } from "../tools/verify_live_deploy.mjs";

const contract = {
  modules: {
    "assets/index-AAA.js": { sha256: "a" },
    "assets/pairs-act-1-BBB.js": { sha256: "b" },
  },
};

describe("planFiles — hvad sammenlignes mod live", () => {
  it("tager index.html, kontraktens moduler og CSS'en fra HTML med", () => {
    const html =
      '<link rel="stylesheet" href="/assets/index-CCC.css">' +
      '<script type="module" src="/assets/index-AAA.js"></script>';

    expect(planFiles(html, contract)).toEqual([
      "index.html",
      "assets/index-AAA.js",
      "assets/pairs-act-1-BBB.js",
      "assets/index-CCC.css",
    ]);
  });

  it("tager CSS med, selv når den kun optræder i en url() i HTML'en", () => {
    const html = '<style>@import url("./assets/sent-DDD.css");</style>';

    expect(planFiles(html, contract)).toContain("assets/sent-DDD.css");
  });

  it("dublerer ikke en fil, der både står i kontrakten og i HTML'en", () => {
    const html = '<script type="module" src="/assets/index-AAA.js"></script>';
    const files = planFiles(html, contract);

    expect(files.filter((path) => path === "assets/index-AAA.js")).toHaveLength(1);
  });

  it("klarer en kontrakt uden moduler uden at kaste", () => {
    expect(planFiles("<html></html>", {})).toEqual(["index.html"]);
  });
});

describe("summarise — fail-closed", () => {
  it("er kun ok, når hver eneste fil er bekræftet identisk", () => {
    expect(
      summarise([
        { path: "index.html", status: "identisk" },
        { path: "assets/index-AAA.js", status: "identisk" },
      ]).ok,
    ).toBe(true);
  });

  it("er ikke ok ved byte-afvigelse", () => {
    const summary = summarise([
      { path: "index.html", status: "identisk" },
      { path: "assets/index-AAA.js", status: "afviger" },
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.drifted).toHaveLength(1);
  });

  it.each(["HTTP 404", "netværksfejl: ECONNRESET", "mangler lokalt"])(
    "læser ikke %s som en bekræftelse",
    (status) => {
      expect(summarise([{ path: "index.html", status }]).ok).toBe(false);
    },
  );

  it("er ikke ok, når intet blev sammenlignet — tomhed er ikke bevis", () => {
    expect(summarise([]).ok).toBe(false);
  });
});
