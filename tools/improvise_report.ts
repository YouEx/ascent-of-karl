/**
 * Kausal balancerapport for runtime-improvisation.
 *
 * Hver konfiguration spiller de samme seeds to gange med den samme spiller-
 * politik: én gang med almindelig `combine`, én gang hvor tomme par går gennem
 * improvisation. Det er derfor parrede kontrafaktiske runs, ikke to uafhængige
 * stikprøver.
 *
 * Politik, fast før resultaterne læses:
 * - 60 % målrettet: vælg den bedste åbne canonical opskrift, prioriteret som
 *   aktivt challenge → obligatorisk problem → age-up → skæbne → nyt fund.
 * - 25 % nysgerrig: vælg det bedste af 12 seedede par, med forkærlighed for de
 *   seks nyeste fund og et endnu uprøvet par.
 * - 15 % blind: vælg det første af de samme 12 seedede par.
 *
 * Der trækkes altid samme antal tilfældige tal pr. sommer. Feature-flaget er
 * ikke en del af politikken; det ændrer kun motorens svar på det valgte par.
 *
 * Kør:
 *   npm run improvise:report
 *   npm run improvise:report -- --write docs/design/improvisation-balance-results.json
 */

import { writeFileSync } from "node:fs";
import { Engine, pairKey } from "../src/core/engine";
import { resolves } from "../src/core/challenge";
import { solvesNeed } from "../src/core/solves";
import { judgePair } from "../src/core/verdict";
import { loadContent } from "../src/content";
import type {
  CombineOutcome,
  ComboDef,
  ContentBundle,
  ElementDef,
  Verdict,
} from "../src/core/types";

const POLICY_SAMPLE_SIZE = 12;
const POLICY_GOAL_SHARE = 0.6;
const POLICY_RECENT_SHARE = 0.25;
const POLICY_RECENT_COUNT = 6;
const REPORT_SCHEMA_VERSION = 1;

export interface ImproviseBalanceConfiguration {
  id: string;
  label: string;
  /** Alle ikke-canonical forsøg betaler denne pris, også afvisning/genbrug. */
  summerCost: number;
  /** Højeste antal nye runtime-elementer i runnet. null = intet loft. */
  runCap: number | null;
}

export interface BalanceThresholds {
  maxFateRateIncreasePoints: number;
  maxAllRequiredRateIncreasePoints: number;
  minCanonicalDiscoveryRetention: number;
  maxMeanPositiveCanonicalDisplacement: number;
  maxImprovisedCreditedShare: number;
  maxImprovisedRequiredSolveShare: number;
}

export const DEFAULT_BALANCE_THRESHOLDS: BalanceThresholds = {
  maxFateRateIncreasePoints: 2,
  maxAllRequiredRateIncreasePoints: 5,
  minCanonicalDiscoveryRetention: 0.95,
  maxMeanPositiveCanonicalDisplacement: 1,
  maxImprovisedCreditedShare: 0.2,
  maxImprovisedRequiredSolveShare: 0.2,
};

export const DEFAULT_BALANCE_CONFIGURATIONS: ImproviseBalanceConfiguration[] = [
  {
    id: "one-summer-no-cap",
    label: "1 summer / no cap",
    summerCost: 1,
    runCap: null,
  },
  {
    id: "one-summer-cap-1",
    label: "1 summer / cap 1",
    summerCost: 1,
    runCap: 1,
  },
  {
    id: "one-summer-cap-2",
    label: "1 summer / cap 2",
    summerCost: 1,
    runCap: 2,
  },
  {
    id: "one-summer-cap-3",
    label: "1 summer / cap 3",
    summerCost: 1,
    runCap: 3,
  },
  {
    id: "one-summer-cap-5",
    label: "1 summer / cap 5",
    summerCost: 1,
    runCap: 5,
  },
  {
    id: "two-summer-no-cap",
    label: "2 summers / no cap",
    summerCost: 2,
    runCap: null,
  },
];

interface RunResult {
  seed: number;
  ending: string | null;
  fateCompleted: boolean;
  anyEnding: boolean;
  automaticEnding: boolean;
  challengeEnding: boolean;
  requiredSolved: number;
  allRequiredSolved: boolean;
  challengesSpawned: number;
  challengesSolved: number;
  challengesFailed: number;
  summersUsed: number;
  successfulImprovisations: number;
  reusedImprovisations: number;
  rejectedImprovisations: number;
  rejectionReasons: Record<string, number>;
  verdicts: { plausible: number; absurd: number };
  inventionsCreated: number;
  inventionsCredited: number;
  totalCreditedInventions: number;
  improvisedRequiredSolves: number;
  requiredSolves: number;
  canonicalDiscoveries: number;
  depthDistribution: Record<string, number>;
}

export interface DistributionSummary {
  mean: number;
  p50: number;
  p90: number;
  p95: number;
  max: number;
}

export interface ModeSummary {
  runs: number;
  seedDigest: string;
  runDigest: string;
  fate: { count: number; rate: number };
  endings: {
    count: number;
    rate: number;
    automatic: number;
    challenge: number;
    byId: Record<string, number>;
  };
  requiredProblems: {
    meanSolved: number;
    allCount: number;
    allRate: number;
    solved: number;
    solvedByImprovisation: number;
    improvisedShare: number;
  };
  challenges: {
    spawned: number;
    solved: number;
    failed: number;
    solveRate: number;
  };
  summersUsed: DistributionSummary;
  improvisations: {
    successful: number;
    reused: number;
    rejected: number;
    rejectionReasons: Record<string, number>;
    verdicts: { plausible: number; absurd: number };
    inventionsCreated: number;
    inventionsCredited: number;
    perRunCreated: DistributionSummary;
    perRunCredited: DistributionSummary;
    depthDistribution: Record<string, number>;
  };
  creditedInventions: {
    total: number;
    improvised: number;
    improvisedShare: number;
  };
  canonicalDiscoveries: DistributionSummary;
}

export interface ConfigurationSafety {
  passed: boolean;
  failures: string[];
  observed: {
    fateRateIncreasePoints: number;
    allRequiredRateIncreasePoints: number;
    canonicalDiscoveryRetention: number;
    meanPositiveCanonicalDisplacement: number;
    improvisedCreditedShare: number;
    improvisedRequiredSolveShare: number;
  };
}

export interface ConfigurationComparison {
  configuration: ImproviseBalanceConfiguration;
  matchedPairs: number;
  baseline: ModeSummary;
  improvisation: ModeSummary;
  canonicalDiscoveriesDisplaced: {
    netMean: number;
    positiveMean: number;
    p50: number;
    p90: number;
    p95: number;
  };
  safety: ConfigurationSafety;
}

export interface ImproviseBalanceReport {
  schemaVersion: number;
  methodology: {
    runsPerMode: number;
    matchedSeeds: true;
    seedFormula: string;
    playerPolicy: {
      goalDirectedShare: number;
      recentCuriosityShare: number;
      blindCuriosityShare: number;
      sampledPairsPerTurn: number;
      recentWindow: number;
      fixedDrawCountPerTurn: boolean;
    };
    costSemantics: string;
    capSemantics: string;
    thresholds: BalanceThresholds;
  };
  configurations: ConfigurationComparison[];
}

export interface BuildReportOptions {
  runsPerMode?: number;
  configurations?: ImproviseBalanceConfiguration[];
  thresholds?: BalanceThresholds;
  content?: ContentBundle;
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function seedForRun(index: number): number {
  return index * 7919 + 13;
}

function fnv1a(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

export function stableReportJson(report: ImproviseBalanceReport): string {
  return `${JSON.stringify(stableValue(report))}\n`;
}

export function reportDigest(report: ImproviseBalanceReport): string {
  return fnv1a(stableReportJson(report));
}

function percentile(values: number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(share * sorted.length) - 1),
  );
  return sorted[index]!;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function distribution(values: number[]): DistributionSummary {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    mean: round(values.length ? total / values.length : 0),
    p50: percentile(values, 0.5),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : 0,
  };
}

function increment(target: Record<string, number>, key: string, amount = 1): void {
  target[key] = (target[key] ?? 0) + amount;
}

function availableCanonicalCombos(
  engine: Engine,
  content: ContentBundle,
): ComboDef[] {
  const discovered = new Set(engine.getState().discovered);
  const seenPairs = new Set<string>();
  const available: ComboDef[] = [];
  for (const defined of content.combos) {
    const key = pairKey(defined.pair[0], defined.pair[1]);
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    if (!discovered.has(defined.pair[0]) || !discovered.has(defined.pair[1])) {
      continue;
    }
    const combo = engine.matchCombo(defined.pair[0], defined.pair[1]);
    if (!combo) continue;
    if (!discovered.has(combo.result) || (combo.ending && engine.endingsUnlocked())) {
      available.push(combo);
    }
  }
  return available;
}

function goalScore(engine: Engine, combo: ComboDef): number {
  const result = engine.element(combo.result);
  const active = engine.activeChallenge();
  let score = 100 - (result.depth ?? 0);
  if (active && resolves(active.def, result, engine.content.predicates)) {
    score += 10_000;
  }
  for (const problem of engine.unsolvedRequiredProblems()) {
    if (solvesNeed(result, problem.id, engine.content.predicates)) {
      score += 5_000;
    }
  }
  if (combo.ageUp && engine.unsolvedRequiredProblems().length === 0) {
    score += 2_000;
  }
  if (combo.ending && engine.endingsUnlocked()) score += 1_000;
  if (combo.spor === "komisk") score += 5;
  return score;
}

function sampledPairScore(
  engine: Engine,
  pair: [string, string],
  tried: Set<string>,
): number {
  const pool = engine.getState().discovered;
  const recent = new Set(pool.slice(Math.max(0, pool.length - POLICY_RECENT_COUNT)));
  let score = 0;
  if (recent.has(pair[0]) || recent.has(pair[1])) score += 4;
  if (!tried.has(pairKey(pair[0], pair[1]))) score += 2;
  if (!engine.matchCombo(pair[0], pair[1])) score += 1;
  return score;
}

function choosePair(
  engine: Engine,
  content: ContentBundle,
  random: () => number,
  tried: Set<string>,
): [string, string] {
  const pool = engine.getState().discovered;
  const mode = random();
  const samples: [string, string][] = [];
  for (let index = 0; index < POLICY_SAMPLE_SIZE; index++) {
    const first = pool[Math.floor(random() * pool.length)]!;
    const second = pool[Math.floor(random() * pool.length)]!;
    samples.push([first, second]);
  }
  const tieDraw = random();

  if (mode < POLICY_GOAL_SHARE) {
    const goals = availableCanonicalCombos(engine, content);
    if (goals.length > 0) {
      const scored = goals.map((combo) => ({
        combo,
        score: goalScore(engine, combo),
      }));
      const high = Math.max(...scored.map((entry) => entry.score));
      const tied = scored
        .filter((entry) => entry.score === high)
        .sort((left, right) =>
          pairKey(left.combo.pair[0], left.combo.pair[1]).localeCompare(
            pairKey(right.combo.pair[0], right.combo.pair[1]),
          ),
        );
      const chosen = tied[Math.floor(tieDraw * tied.length)]!.combo;
      return [chosen.pair[0], chosen.pair[1]];
    }
  }

  if (mode < POLICY_GOAL_SHARE + POLICY_RECENT_SHARE) {
    const scored = samples.map((pair) => ({
      pair,
      score: sampledPairScore(engine, pair, tried),
    }));
    const high = Math.max(...scored.map((entry) => entry.score));
    const tied = scored.filter((entry) => entry.score === high);
    return tied[Math.floor(tieDraw * tied.length)]!.pair;
  }

  return samples[0]!;
}

function simulateRun(
  content: ContentBundle,
  seed: number,
  configuration: ImproviseBalanceConfiguration,
  improvisationEnabled: boolean,
): RunResult {
  const engine = new Engine(content, undefined, {
    improvisationRunCap: configuration.runCap,
    improvisationSummerCost: configuration.summerCost,
  });
  engine.loadState({ ...engine.getState(), seed });
  const random = rng(seed ^ 0x9e3779b9);
  const tried = new Set<string>();
  const requiredIds = new Set(
    content.acts
      .flatMap((act) => act.problems)
      .filter((problem) => problem.required)
      .map((problem) => problem.id),
  );
  const metrics: RunResult = {
    seed,
    ending: null,
    fateCompleted: false,
    anyEnding: false,
    automaticEnding: false,
    challengeEnding: false,
    requiredSolved: 0,
    allRequiredSolved: false,
    challengesSpawned: 0,
    challengesSolved: 0,
    challengesFailed: 0,
    summersUsed: 0,
    successfulImprovisations: 0,
    reusedImprovisations: 0,
    rejectedImprovisations: 0,
    rejectionReasons: {},
    verdicts: { plausible: 0, absurd: 0 },
    inventionsCreated: 0,
    inventionsCredited: 0,
    totalCreditedInventions: 0,
    improvisedRequiredSolves: 0,
    requiredSolves: 0,
    canonicalDiscoveries: 0,
    depthDistribution: {},
  };

  for (let action = 0; action < content.config.turnLimit * 3; action++) {
    if (engine.getState().ended) break;
    const [a, b] = choosePair(engine, content, random, tried);
    tried.add(pairKey(a, b));
    const canonical = engine.matchCombo(a, b);
    let outcome: CombineOutcome;
    let attemptedVerdict: Verdict | undefined;

    if (!improvisationEnabled) {
      outcome = engine.combine(a, b);
    } else {
      if (!canonical) {
        const judgment = judgePair(engine, engine.element(a), engine.element(b));
        attemptedVerdict = judgment.verdict;
      }
      outcome = engine.attempt(a, b);
    }

    const challenge = outcome.challenge;
    if (challenge?.kind === "spawned") metrics.challengesSpawned++;
    if (challenge?.kind === "solved") metrics.challengesSolved++;
    if (challenge?.kind === "failed") metrics.challengesFailed++;

    if (outcome.kind === "improvised") {
      if (attemptedVerdict === "plausible" || attemptedVerdict === "absurd") {
        metrics.verdicts[attemptedVerdict]++;
      }
      if (outcome.reused) {
        metrics.reusedImprovisations++;
      } else {
        metrics.successfulImprovisations++;
        metrics.inventionsCreated++;
        increment(
          metrics.depthDistribution,
          String(outcome.element.depth ?? 0),
        );
      }
      if (outcome.solved?.required) metrics.improvisedRequiredSolves++;
    } else if (outcome.kind === "improvise-rejected") {
      metrics.rejectedImprovisations++;
      increment(metrics.rejectionReasons, outcome.reason);
    }
  }

  const state = engine.getState();
  const ending = engine.activeEnding();
  const solvedRequired = state.solvedProblems.filter((id) =>
    requiredIds.has(id),
  ).length;
  const automaticEnding = Boolean(ending?.automatic);
  const challengeEnding = Boolean(ending?.viaChallenge);
  metrics.ending = ending?.id ?? null;
  metrics.anyEnding = Boolean(ending);
  metrics.automaticEnding = automaticEnding;
  metrics.challengeEnding = challengeEnding;
  metrics.fateCompleted = Boolean(ending && !automaticEnding && !challengeEnding);
  metrics.requiredSolved = solvedRequired;
  metrics.requiredSolves = solvedRequired;
  metrics.allRequiredSolved = solvedRequired === requiredIds.size;
  metrics.summersUsed = state.attempts;
  metrics.inventionsCredited = state.creditedImprovised.length;
  metrics.totalCreditedInventions = engine.inventions();
  metrics.canonicalDiscoveries = state.discovered.filter((id) => {
    const element = engine.element(id);
    return element.origin !== "improvised" && !element.base;
  }).length;
  return metrics;
}

function summarize(runs: RunResult[]): ModeSummary {
  const endingIds: Record<string, number> = {};
  const rejectionReasons: Record<string, number> = {};
  const depthDistribution: Record<string, number> = {};
  let requiredSolved = 0;
  let improvisedRequiredSolves = 0;
  let challengeSpawned = 0;
  let challengeSolved = 0;
  let challengeFailed = 0;
  let successful = 0;
  let reused = 0;
  let rejected = 0;
  let plausible = 0;
  let absurd = 0;
  let created = 0;
  let credited = 0;
  let totalCredited = 0;

  for (const run of runs) {
    if (run.ending) increment(endingIds, run.ending);
    requiredSolved += run.requiredSolved;
    improvisedRequiredSolves += run.improvisedRequiredSolves;
    challengeSpawned += run.challengesSpawned;
    challengeSolved += run.challengesSolved;
    challengeFailed += run.challengesFailed;
    successful += run.successfulImprovisations;
    reused += run.reusedImprovisations;
    rejected += run.rejectedImprovisations;
    plausible += run.verdicts.plausible;
    absurd += run.verdicts.absurd;
    created += run.inventionsCreated;
    credited += run.inventionsCredited;
    totalCredited += run.totalCreditedInventions;
    for (const [reason, count] of Object.entries(run.rejectionReasons)) {
      increment(rejectionReasons, reason, count);
    }
    for (const [depth, count] of Object.entries(run.depthDistribution)) {
      increment(depthDistribution, depth, count);
    }
  }

  const fateCount = runs.filter((run) => run.fateCompleted).length;
  const endingCount = runs.filter((run) => run.anyEnding).length;
  const allRequiredCount = runs.filter((run) => run.allRequiredSolved).length;
  const automaticCount = runs.filter((run) => run.automaticEnding).length;
  const challengeEndingCount = runs.filter((run) => run.challengeEnding).length;
  const runDigestRows = runs.map((run) => ({
    seed: run.seed,
    ending: run.ending,
    requiredSolved: run.requiredSolved,
    summersUsed: run.summersUsed,
    successfulImprovisations: run.successfulImprovisations,
    canonicalDiscoveries: run.canonicalDiscoveries,
  }));

  return {
    runs: runs.length,
    seedDigest: fnv1a(runs.map((run) => run.seed).join(",")),
    runDigest: fnv1a(JSON.stringify(runDigestRows)),
    fate: {
      count: fateCount,
      rate: round(runs.length ? fateCount / runs.length : 0),
    },
    endings: {
      count: endingCount,
      rate: round(runs.length ? endingCount / runs.length : 0),
      automatic: automaticCount,
      challenge: challengeEndingCount,
      byId: endingIds,
    },
    requiredProblems: {
      meanSolved: round(runs.length ? requiredSolved / runs.length : 0),
      allCount: allRequiredCount,
      allRate: round(runs.length ? allRequiredCount / runs.length : 0),
      solved: requiredSolved,
      solvedByImprovisation: improvisedRequiredSolves,
      improvisedShare: round(
        requiredSolved ? improvisedRequiredSolves / requiredSolved : 0,
      ),
    },
    challenges: {
      spawned: challengeSpawned,
      solved: challengeSolved,
      failed: challengeFailed,
      solveRate: round(
        challengeSolved + challengeFailed
          ? challengeSolved / (challengeSolved + challengeFailed)
          : 0,
      ),
    },
    summersUsed: distribution(runs.map((run) => run.summersUsed)),
    improvisations: {
      successful,
      reused,
      rejected,
      rejectionReasons,
      verdicts: { plausible, absurd },
      inventionsCreated: created,
      inventionsCredited: credited,
      perRunCreated: distribution(runs.map((run) => run.inventionsCreated)),
      perRunCredited: distribution(runs.map((run) => run.inventionsCredited)),
      depthDistribution,
    },
    creditedInventions: {
      total: totalCredited,
      improvised: credited,
      improvisedShare: round(credited ? credited / totalCredited : 0),
    },
    canonicalDiscoveries: distribution(
      runs.map((run) => run.canonicalDiscoveries),
    ),
  };
}

function safetyFor(
  baseline: ModeSummary,
  improvisation: ModeSummary,
  positiveDisplacementMean: number,
  thresholds: BalanceThresholds,
): ConfigurationSafety {
  const observed = {
    fateRateIncreasePoints: round(
      (improvisation.fate.rate - baseline.fate.rate) * 100,
      2,
    ),
    allRequiredRateIncreasePoints: round(
      (improvisation.requiredProblems.allRate -
        baseline.requiredProblems.allRate) *
        100,
      2,
    ),
    canonicalDiscoveryRetention: round(
      baseline.canonicalDiscoveries.mean
        ? improvisation.canonicalDiscoveries.mean /
            baseline.canonicalDiscoveries.mean
        : 1,
    ),
    meanPositiveCanonicalDisplacement: round(positiveDisplacementMean),
    improvisedCreditedShare:
      improvisation.creditedInventions.improvisedShare,
    improvisedRequiredSolveShare:
      improvisation.requiredProblems.improvisedShare,
  };
  const failures: string[] = [];
  if (
    observed.fateRateIncreasePoints >
    thresholds.maxFateRateIncreasePoints
  ) {
    failures.push(
      `fate +${observed.fateRateIncreasePoints}pp > ${thresholds.maxFateRateIncreasePoints}pp`,
    );
  }
  if (
    observed.allRequiredRateIncreasePoints >
    thresholds.maxAllRequiredRateIncreasePoints
  ) {
    failures.push(
      `all-required +${observed.allRequiredRateIncreasePoints}pp > ${thresholds.maxAllRequiredRateIncreasePoints}pp`,
    );
  }
  if (
    observed.canonicalDiscoveryRetention <
    thresholds.minCanonicalDiscoveryRetention
  ) {
    failures.push(
      `canonical retention ${round(observed.canonicalDiscoveryRetention * 100, 1)}% < ${thresholds.minCanonicalDiscoveryRetention * 100}%`,
    );
  }
  if (
    observed.meanPositiveCanonicalDisplacement >
    thresholds.maxMeanPositiveCanonicalDisplacement
  ) {
    failures.push(
      `canonical displacement ${observed.meanPositiveCanonicalDisplacement}/run > ${thresholds.maxMeanPositiveCanonicalDisplacement}`,
    );
  }
  if (
    observed.improvisedCreditedShare >
    thresholds.maxImprovisedCreditedShare
  ) {
    failures.push(
      `improvised credited share ${round(observed.improvisedCreditedShare * 100, 1)}% > ${thresholds.maxImprovisedCreditedShare * 100}%`,
    );
  }
  if (
    observed.improvisedRequiredSolveShare >
    thresholds.maxImprovisedRequiredSolveShare
  ) {
    failures.push(
      `improvised required-solve share ${round(observed.improvisedRequiredSolveShare * 100, 1)}% > ${thresholds.maxImprovisedRequiredSolveShare * 100}%`,
    );
  }
  return { passed: failures.length === 0, failures, observed };
}

export function buildImproviseBalanceReport(
  options: BuildReportOptions = {},
): ImproviseBalanceReport {
  const content = options.content ?? loadContent();
  const runsPerMode = options.runsPerMode ?? 2000;
  const configurations =
    options.configurations ?? DEFAULT_BALANCE_CONFIGURATIONS;
  const thresholds = options.thresholds ?? DEFAULT_BALANCE_THRESHOLDS;
  const comparisons: ConfigurationComparison[] = [];

  for (const configuration of configurations) {
    const baselineRuns: RunResult[] = [];
    const improvisationRuns: RunResult[] = [];
    for (let index = 0; index < runsPerMode; index++) {
      const seed = seedForRun(index);
      baselineRuns.push(simulateRun(content, seed, configuration, false));
      improvisationRuns.push(simulateRun(content, seed, configuration, true));
    }
    const baseline = summarize(baselineRuns);
    const improvisation = summarize(improvisationRuns);
    const displacement = baselineRuns.map((run, index) => {
      const treatment = improvisationRuns[index]!;
      return run.canonicalDiscoveries - treatment.canonicalDiscoveries;
    });
    const positive = displacement.map((value) => Math.max(0, value));
    const netMean =
      displacement.reduce((sum, value) => sum + value, 0) /
      Math.max(1, displacement.length);
    const positiveMean =
      positive.reduce((sum, value) => sum + value, 0) /
      Math.max(1, positive.length);
    const displaced = {
      netMean: round(netMean),
      positiveMean: round(positiveMean),
      p50: percentile(positive, 0.5),
      p90: percentile(positive, 0.9),
      p95: percentile(positive, 0.95),
    };
    comparisons.push({
      configuration,
      matchedPairs: runsPerMode,
      baseline,
      improvisation,
      canonicalDiscoveriesDisplaced: displaced,
      safety: safetyFor(
        baseline,
        improvisation,
        positiveMean,
        thresholds,
      ),
    });
  }

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    methodology: {
      runsPerMode,
      matchedSeeds: true,
      seedFormula: "seed = runIndex * 7919 + 13",
      playerPolicy: {
        goalDirectedShare: POLICY_GOAL_SHARE,
        recentCuriosityShare: POLICY_RECENT_SHARE,
        blindCuriosityShare: round(
          1 - POLICY_GOAL_SHARE - POLICY_RECENT_SHARE,
        ),
        sampledPairsPerTurn: POLICY_SAMPLE_SIZE,
        recentWindow: POLICY_RECENT_COUNT,
        fixedDrawCountPerTurn: true,
      },
      costSemantics:
        "Every non-canonical attempt pays the configured summer cost, whether accepted, reused, rejected, or capped. Extra cost consumes lifespan but does not tick a challenge twice, matching canonical combo.cost.",
      capSemantics:
        "The cap counts unique successful runtime inventions. Reuse remains legal; a new no-recipe pair at the boundary is rejected and still consumes its configured cost.",
      thresholds,
    },
    configurations: comparisons,
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function humanReport(report: ImproviseBalanceReport): string {
  const lines = [
    `Improvisation balance · ${report.methodology.runsPerMode} matched seeds per mode`,
    `hash ${reportDigest(report)}`,
    "",
    "configuration          fate Δ   required Δ  canon kept  displaced  credited  verdict     safe",
  ];
  for (const entry of report.configurations) {
    const observed = entry.safety.observed;
    const verdict =
      `${entry.improvisation.improvisations.verdicts.absurd}/` +
      `${entry.improvisation.improvisations.verdicts.plausible}`;
    lines.push(
      [
        entry.configuration.id.padEnd(22),
        `${observed.fateRateIncreasePoints.toFixed(1)}pp`.padStart(8),
        `${observed.allRequiredRateIncreasePoints.toFixed(1)}pp`.padStart(12),
        percent(observed.canonicalDiscoveryRetention).padStart(11),
        observed.meanPositiveCanonicalDisplacement.toFixed(2).padStart(10),
        percent(observed.improvisedCreditedShare).padStart(9),
        verdict.padStart(9),
        (entry.safety.passed ? "PASS" : "FAIL").padStart(6),
      ].join(" "),
    );
  }
  return lines.join("\n");
}

function parseArgs(args: string[]): {
  runsPerMode: number;
  jsonOnly: boolean;
  writePath?: string;
} {
  let runsPerMode = 2000;
  let jsonOnly = false;
  let writePath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--runs") {
      runsPerMode = Number(args[++index]);
    } else if (arg === "--json") {
      jsonOnly = true;
    } else if (arg === "--write") {
      writePath = args[++index];
    }
  }
  if (!Number.isInteger(runsPerMode) || runsPerMode < 1) {
    throw new Error("--runs skal være et positivt heltal");
  }
  return { runsPerMode, jsonOnly, writePath };
}

export function main(args: string[]): void {
  const options = parseArgs(args);
  const report = buildImproviseBalanceReport({
    runsPerMode: options.runsPerMode,
  });
  const json = stableReportJson(report);
  if (options.writePath) writeFileSync(options.writePath, json);
  if (!options.jsonOnly) console.log(humanReport(report));
  console.log(json.trimEnd());
}
