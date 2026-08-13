import { describe, expect, it, vi } from "vitest";
import { constantTimeEquals, isValidAdminToken, ADMIN_VERIFIED_HEADER } from "../worker/src/admin";
import { INTERNAL_IP_HASH_HEADER } from "../worker/src/ip";

/**
 * TASK-008: admin-adgang til `/admin/pairs`-eksporten. Ingen
 * tidsmåling her (flaky i CI) — i stedet et STRUKTURELT bevis på, at
 * sammenligningen rent faktisk hasher begge sider FØR den sammenligner
 * (samme primitiv som `ip.ts`s `hashClientIp`), plus fuld funktionel
 * korrekthed af selve godkendelsen.
 */

describe("constantTimeEquals: hasher FØRST, sammenligner bagefter", () => {
  it("to ens strenge er ens", async () => {
    await expect(constantTimeEquals("hemmelig-token-123", "hemmelig-token-123")).resolves.toBe(true);
  });

  it("to forskellige strenge er ikke ens", async () => {
    await expect(constantTimeEquals("hemmelig-token-123", "hemmelig-token-124")).resolves.toBe(false);
  });

  it("strenge af FORSKELLIG længde er stadig sikkert sammenlignelige (kaster ikke, er blot ikke ens)", async () => {
    await expect(constantTimeEquals("kort", "meget-meget-langt-token-derimod")).resolves.toBe(false);
  });

  it("to tomme strenge er ens (kantfilfælde, ingen krasch)", async () => {
    await expect(constantTimeEquals("", "")).resolves.toBe(true);
  });

  it("kalder crypto.subtle.digest på BEGGE inputs — beviser hash-først, ikke en naiv ===/substring", async () => {
    const spy = vi.spyOn(crypto.subtle, "digest");
    await constantTimeEquals("a", "b");
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});

describe("isValidAdminToken: fejler LUKKET i alle uklare tilfælde, afslører aldrig hvorfor", () => {
  it("afviser hvis expectedToken (hemmeligheden) slet ikke er sat — ingen gættet standard", async () => {
    await expect(isValidAdminToken("Bearer whatever", undefined)).resolves.toBe(false);
  });

  it("afviser hvis Authorization-headeren mangler helt", async () => {
    await expect(isValidAdminToken(null, "det-rigtige-token")).resolves.toBe(false);
    await expect(isValidAdminToken(undefined, "det-rigtige-token")).resolves.toBe(false);
  });

  it("afviser et forkert skema (ikke 'Bearer ')", async () => {
    await expect(isValidAdminToken("Basic det-rigtige-token", "det-rigtige-token")).resolves.toBe(false);
    await expect(isValidAdminToken("det-rigtige-token", "det-rigtige-token")).resolves.toBe(false);
  });

  it("afviser 'Bearer ' med tomt token efter selve ordet", async () => {
    await expect(isValidAdminToken("Bearer ", "det-rigtige-token")).resolves.toBe(false);
  });

  it("afviser et forkert token, selv med rigtigt skema", async () => {
    await expect(isValidAdminToken("Bearer forkert-token", "det-rigtige-token")).resolves.toBe(false);
  });

  it("godkender PRÆCIS det rigtige 'Bearer <token>'", async () => {
    await expect(isValidAdminToken("Bearer det-rigtige-token", "det-rigtige-token")).resolves.toBe(true);
  });

  it("er følsom over for store/små bogstaver i selve tokenet (ingen normalisering)", async () => {
    await expect(isValidAdminToken("Bearer Det-Rigtige-Token", "det-rigtige-token")).resolves.toBe(false);
  });
});

describe("ADMIN_VERIFIED_HEADER: intern markørheader, samme mønster som INTERNAL_IP_HASH_HEADER", () => {
  it("er en ikke-tom streng, forskellig fra IP-hash-headeren", () => {
    expect(typeof ADMIN_VERIFIED_HEADER).toBe("string");
    expect(ADMIN_VERIFIED_HEADER.length).toBeGreaterThan(0);
    expect(ADMIN_VERIFIED_HEADER).not.toBe(INTERNAL_IP_HASH_HEADER);
  });
});
