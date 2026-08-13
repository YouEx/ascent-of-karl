import { spawn } from "node:child_process";

const POSIX = process.platform !== "win32";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function treeAlive(child) {
  if (!child?.pid) return false;
  if (!POSIX) return child.exitCode == null && child.signalCode == null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (err) {
    if (err?.code === "ESRCH") return false;
    throw err;
  }
}

function signalTree(child, signal) {
  if (!child?.pid) return false;
  try {
    return POSIX ? (process.kill(-child.pid, signal), true) : child.kill(signal);
  } catch (err) {
    if (err?.code === "ESRCH") return false;
    throw err;
  }
}

async function waitUntilDead(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!treeAlive(child)) return true;
    await sleep(25);
  }
  return !treeAlive(child);
}

/** Stopper den eksakte procesgruppe, aldrig et navn. På POSIX får hver
 * kommando sin egen gruppe (`detached:true`), så barn og barnebørn rammes af
 * samme negative PID. Windows falder tilbage til den direkte proces. */
export async function stopProcessGroup(child, {
  graceMs = 250,
  killWaitMs = 2_000,
} = {}) {
  if (!child?.pid || !treeAlive(child)) return;
  signalTree(child, "SIGTERM");
  if (await waitUntilDead(child, graceMs)) return;
  signalTree(child, "SIGKILL");
  if (!(await waitUntilDead(child, killWaitMs))) {
    throw new Error(`procesgruppen ${child.pid} kunne ikke standses`);
  }
}

/** Asynkron erstatning for execFileSync i langsomme browserkørsler. Ejer en
 * separat procesgruppe og rydder den på timeout, spawn-fejl, non-zero exit
 * og efter succes (sidste trin fanger efterkommere, som forælderen glemte). */
export function runProcessGroup(file, args = [], {
  cwd,
  timeoutMs = 0,
  env = process.env,
} = {}) {
  const child = spawn(file, args, {
    cwd,
    env,
    detached: POSIX,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => { stdout += chunk; });
  child.stderr?.on("data", (chunk) => { stderr += chunk; });

  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;

    const finish = async ({ error, code, signal, timedOut = false }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        await stopProcessGroup(child);
      } catch (cleanupError) {
        if (!error) error = cleanupError;
      }

      if (timedOut) {
        reject(new Error(`${file} timeout efter ${timeoutMs} ms${stderr ? `:\n${stderr}` : ""}`));
      } else if (error) {
        reject(error);
      } else if (code !== 0) {
        reject(new Error(`${file} fejlede (kode ${code ?? signal ?? "ukendt"}):\n${stderr}`));
      } else {
        resolve({ stdout, stderr, code: 0 });
      }
    };

    child.once("error", (error) => { void finish({ error }); });
    // `close`, ikke `exit`: stdout/stderr er først garanteret tømt, når de
    // underliggende pipes er lukket. metrics.py's JSON må aldrig parses halvt.
    child.once("close", (code, signal) => { void finish({ code, signal }); });
    if (timeoutMs > 0) {
      timer = setTimeout(() => { void finish({ timedOut: true }); }, timeoutMs);
    }
  });
}
