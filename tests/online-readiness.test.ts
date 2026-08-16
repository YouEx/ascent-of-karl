import { describe, expect, it } from "vitest";
import mainSource from "../src/ui/main.ts?raw";
import buildPagesSource from "../tools/build_pages.mjs?raw";
import workerSource from "../worker/src/index.ts?raw";
import viteConfigSource from "../vite.config.ts?raw";

describe("online-required production readiness gate", () => {
  it("requires an explicit readiness attestation beside online-required mode", () => {
    expect(mainSource).toContain(
      'import.meta.env.VITE_ONLINE_TARGET_READY !== "true"',
    );
    expect(mainSource).toContain(
      "VITE_ONLINE_REQUIRED requires VITE_ONLINE_TARGET_READY=true",
    );
    expect(viteConfigSource).toContain(
      'config.env.VITE_ONLINE_REQUIRED === "true"',
    );
  });

  it("keeps both public Pages variants offline-compatible and endpoint-free", () => {
    expect(buildPagesSource).toContain('VITE_GAME_API_URL: ""');
    expect(buildPagesSource).toContain('VITE_ONLINE_REQUIRED: "false"');
    expect(buildPagesSource).toContain('VITE_ONLINE_TARGET_READY: "false"');
  });

  it("fails Worker health closed without run auth, model key and IP salt", () => {
    expect(workerSource).toContain(
      "env.RUN_AUTH_SECRET && env.OPENAI_API_KEY && env.IP_HASH_SALT",
    );
    expect(workerSource).toContain(
      "runtimeVoiceAvailable: Boolean(env.CARTESIA_API_KEY)",
    );
  });

  it("locks controller mutation commands and active-play controls during outage", () => {
    expect(mainSource).toContain("let activePlayBlocked");
    expect(mainSource).toContain("function setActivePlayBlocked(");
    expect(mainSource).toMatch(
      /async function clearSave\(\): Promise<boolean> \{\s+if \(activePlayBlocked \|\| profileMigrationError\) return false;/,
    );
    expect(mainSource).toMatch(
      /async function performCombine[\s\S]*?if \(activePlayBlocked\) return;/,
    );
    expect(mainSource).toMatch(
      /function selectElement[\s\S]*?if \(activePlayBlocked\) return;/,
    );
    expect(mainSource).toContain('toggleAttribute("inert", locked)');
    expect(mainSource).toContain("button.disabled = locked");
    expect(mainSource).toMatch(
      /button\.addEventListener\("click", \(\) => \{\s+if \(activePlayBlocked \|\| profileMigrationError\) return;/,
    );
  });
});
