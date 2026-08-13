// Valideringslaget mellem en vision-model og resten af sløjfen. Modellen er
// en sandsynlighedsmaskine, ikke en garanti — dette er det eneste sted, dens
// output rent faktisk stoppes, både på SKEMAFORM (finding.schema.json) og på
// RUNTIME-fakta skemaet ikke kan kende (findes tokenet? matcher "from" den
// faktiske nuværende værdi, eller er målet hallucineret? er "to" en sikker
// CSS-værdi, ikke en injektion?).
//
// Se plan/architecture-visual-judge-1.md REQ-005, REQ-006, TASK-018/019/020.
import { describe, expect, it } from "vitest";
// @ts-expect-error — værktøjet er ren JS uden typedeklaration.
import { DEFECTS, NEVER_TOKEN, isSafeCssValue, loadKnownTokens, matchesCurrentValue, safeCssValueErrors, validateFindings } from "../tools/judge/validate-finding.mjs";

const REGIONS = new Set(["grid", "chips", "search", "combine", "slots"]);
const TOKENS = new Map([
  ["--slot-fill", "#111111"],
  ["--chronicle", "#eee0cd"],
]);
const ctx = () => ({ knownRegions: REGIONS, knownTokens: TOKENS });

// Faktisk kun ét fund pr. dokument i alle disse tests — en 1-tuple frem for
// et åbent array betyder findings[0] er kendt defineret, ikke
// `Finding | undefined`, uden at spredte ikke-null-postulater er nødvendige.
const validDoc = (): { screen: string; findings: [any] } => ({
  screen: "game",
  findings: [
    {
      region: "grid",
      defect: "color",
      severity: 3,
      evidence: "tone 0.62 mod tærskel 0.75, ΔE 9.1 målt på regionens median",
      fix: { kind: "token", token: "--chronicle", from: "#eee0cd", to: "#d8ba9b" },
    },
  ],
});

describe("validateFindings — skemaform (finding.schema.json)", () => {
  it("accepterer et gyldigt dokument", () => {
    expect(validateFindings(validDoc(), ctx())).toEqual([]);
  });

  it("afviser en ukendt region", () => {
    const doc = validDoc();
    doc.findings[0].region = "does-not-exist";
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("region") && e.includes("does-not-exist"))).toBe(true);
  });

  it("afviser en defekt uden for det lukkede ordforråd", () => {
    const doc = validDoc();
    (doc.findings[0] as any).defect = "vibes";
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("defect"))).toBe(true);
  });

  it("afviser evidence uden talbelæg", () => {
    const doc = validDoc();
    doc.findings[0].evidence = "ser bare forkert ud på en eller anden måde synes jeg";
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("evidence"))).toBe(true);
  });

  it("afviser evidence under 20 tegn selv med et tal", () => {
    const doc = validDoc();
    doc.findings[0].evidence = "tone 0.6";
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("evidence"))).toBe(true);
  });

  it("afviser manglende from/to i en tokenrettelse", () => {
    const doc = validDoc();
    delete (doc.findings[0].fix as any).from;
    delete (doc.findings[0].fix as any).to;
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("fix.from"))).toBe(true);
    expect(errs.some((e: string) => e.includes("fix.to"))).toBe(true);
  });

  it("afviser ekstra egenskaber på et fund", () => {
    const doc = validDoc();
    (doc.findings[0] as any).confidence = 0.9;
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("confidence"))).toBe(true);
  });

  it("afviser ekstra egenskaber i en tokenrettelse", () => {
    const doc = validDoc();
    (doc.findings[0].fix as any).priority = "high";
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("priority"))).toBe(true);
  });

  it("afviser en assetFix uden gyldigt assetId-mønster", () => {
    const doc = validDoc();
    (doc.findings[0] as any).fix = {
      kind: "asset", assetId: "not valid",
      spec: "en helt igennem detaljeret specifikation af det manglende aktiv",
    };
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("assetId"))).toBe(true);
  });

  it("afviser en structureFix uden nok change-tekst", () => {
    const doc = validDoc();
    (doc.findings[0] as any).fix = { kind: "structure", file: "src/ui/style.css", change: "for kort" };
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("change"))).toBe(true);
  });

  it("afviser en ukendt fix.kind", () => {
    const doc = validDoc();
    (doc.findings[0] as any).fix = { kind: "vibes" };
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("kind"))).toBe(true);
  });

  it("afviser severity uden for 1-5", () => {
    const doc = validDoc();
    doc.findings[0].severity = 9;
    expect(validateFindings(doc, ctx()).length).toBeGreaterThan(0);
  });

  it("afviser et dokument uden findings-liste", () => {
    const errs = validateFindings({ screen: "game" } as any, ctx());
    expect(errs.some((e: string) => e.includes("findings"))).toBe(true);
  });

  it("afviser ekstra egenskaber på øverste niveau", () => {
    const doc: any = validDoc();
    doc.model = "gpt-x";
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("model"))).toBe(true);
  });
});

describe("validateFindings — runtime/registry-tjek ud over skemaet", () => {
  it("afviser et token der ikke findes i tokens.css/tuning.css", () => {
    const doc = validDoc();
    doc.findings[0].fix.token = "--does-not-exist";
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("--does-not-exist") && e.includes("findes ikke"))).toBe(true);
  });

  it("afviser en 'from' der ikke matcher den faktiske nuværende værdi (hallucineret mål)", () => {
    const doc = validDoc();
    doc.findings[0].fix.from = "#ffffff"; // aktuel --chronicle er #eee0cd i test-konteksten
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("from") && e.includes("matcher ikke"))).toBe(true);
  });

  it("tolererer en 'from' skrevet i et andet format men samme farve", () => {
    const doc = validDoc();
    doc.findings[0].fix.from = "rgb(238, 224, 205)"; // == #eee0cd
    expect(validateFindings(doc, ctx())).toEqual([]);
  });

  it("nægter automatisk tokenrettelse for en NEVER_TOKEN-defekt", () => {
    const doc = validDoc();
    (doc.findings[0] as any).defect = "missing-asset";
    doc.findings[0].evidence = "der mangler et malet aktiv, målt 0 dækning i regionen ved kant";
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("kan ikke rettes med et token"))).toBe(true);
  });

  it("afviser en usikker CSS-værdi i fix.to selv når resten er gyldig", () => {
    const doc = validDoc();
    doc.findings[0].fix.to = "#000} body{display:none";
    const errs = validateFindings(doc, ctx());
    expect(errs.some((e: string) => e.includes("fix.to"))).toBe(true);
  });
});

describe("isSafeCssValue / safeCssValueErrors", () => {
  it("godkender almindelige tokenværdier", () => {
    for (const v of ["#eee0cd", "16px", "1.5rem", "rgba(0,0,0,.15)", '"Georgia", serif']) {
      expect(isSafeCssValue(v)).toBe(true);
    }
  });
  it("afviser url()", () => expect(isSafeCssValue("url(javascript:alert(1))")).toBe(false));
  it("afviser !important", () => expect(isSafeCssValue("red !important")).toBe(false));
  it("afviser semikolon-injektion", () => expect(isSafeCssValue("red; } body { display: none")).toBe(false));
  it("afviser krøllede parenteser", () => expect(isSafeCssValue("red}*{color:blue")).toBe(false));
  it("afviser at-regler", () => expect(isSafeCssValue("red } @import 'evil.css'")).toBe(false));
  it("afviser expression()", () => expect(isSafeCssValue("expression(alert(1))")).toBe(false));
  it("afviser tom værdi", () => expect(isSafeCssValue("")).toBe(false));
  it("afviser tegn uden for det tilladte tegnsæt", () => expect(isSafeCssValue("red`; evil")).toBe(false));
  it("returnerer en begrundelse pr. brud", () => {
    expect(safeCssValueErrors("url(x) !important;").length).toBeGreaterThanOrEqual(2);
  });
});

describe("matchesCurrentValue", () => {
  it("matcher identiske hex-farver uafhængigt af store/små bogstaver", () => {
    expect(matchesCurrentValue("#EEE0CD", "#eee0cd")).toBe(true);
  });
  it("matcher hex mod rgb() med samme farve", () => {
    expect(matchesCurrentValue("#eee0cd", "rgb(238, 224, 205)")).toBe(true);
  });
  it("matcher tal med samme enhed inden for tolerance", () => {
    expect(matchesCurrentValue("16px", "16.4px")).toBe(true);
  });
  it("afviser tal med forskellig enhed", () => {
    expect(matchesCurrentValue("16px", "16rem")).toBe(false);
  });
  it("afviser en tydeligt anderledes farve", () => {
    expect(matchesCurrentValue("#000000", "#eee0cd")).toBe(false);
  });
  it("falder tilbage til eksakt tekstlighed for ikke-farve/ikke-tal-værdier", () => {
    expect(matchesCurrentValue("Georgia, serif", "Georgia, serif")).toBe(true);
    expect(matchesCurrentValue("Georgia, serif", "Times, serif")).toBe(false);
  });
});

describe("loadKnownTokens", () => {
  it("læser rigtige --token-navne fra tokens.css og tuning.css", () => {
    const tokens = loadKnownTokens();
    expect(tokens.has("--chronicle")).toBe(true);
    expect(tokens.get("--chronicle")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("lader et injiceret tuning.css-token overskygge tokens.css, som importrækkefølgen tilsiger", () => {
    // tuning.css importeres SIDST (TASK-022) — en test-sti med samme token i
    // begge filer skal derfor give tuning.css' værdi, ikke tokens.css'.
    const tokens = loadKnownTokens(
      "tests/fixtures/judge/tokens-base.css",
      "tests/fixtures/judge/tuning-override.css",
    );
    expect(tokens.get("--chronicle")).toBe("#123456");
  });
});

describe("DEFECTS / NEVER_TOKEN — udledt af finding.schema.json", () => {
  it("DEFECTS matcher det lukkede ordforråd i skemaet", () => {
    expect(DEFECTS.has("missing-asset")).toBe(true);
    expect(DEFECTS.has("color")).toBe(true);
    expect(DEFECTS.has("vibes")).toBe(false);
  });
  it("NEVER_TOKEN er en delmængde af DEFECTS", () => {
    for (const d of NEVER_TOKEN) expect(DEFECTS.has(d)).toBe(true);
  });
});
