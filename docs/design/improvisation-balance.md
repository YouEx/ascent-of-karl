# Improvisation balance

**Version:** 1.0

**Measured:** 2026-08-13

**Artifact:** `docs/design/improvisation-balance-results.json`

**Reproducibility hash:** `fnv1a32:e2e20ef3`

## Decision

Recommend **1 summer per non-canonical attempt and at most 5 unique
improvised inventions per run**.

This is a source recommendation, not a deployment decision.
`VITE_IMPROVISE_ENABLED` remains unset in production. Browser playtesting and
TASK-030 belong on the later playtest branch.

The cap counts successful unique runtime inventions. Reusing an existing
invention remains legal. A new invention beyond the boundary returns
`improvise-rejected: run-limit` and still consumes the measured one summer.
The count is derived from the serialized, validated
`GameState.improvisedElements`, so reload cannot reset it.

## Thresholds fixed before reading results

A configuration passed only if all six conditions held against its matched
no-improvisation baseline:

1. Fate-completion increase ≤ **+2.0 percentage points**.
2. All-required-problems completion increase ≤ **+5.0 points**.
3. Mean canonical discoveries retained ≥ **95%**.
4. Mean positive matched canonical displacement ≤ **1.0 discovery/run**.
5. Improvised share of all credited inventions ≤ **20%**.
6. Improvised share of required-problem solves ≤ **20%**.

Selection rule, also fixed first: choose the most permissive passing
**1-summer capped** configuration; otherwise try 2 summers/no cap; otherwise
recommend leaving the feature off.

## Method

`npm run improvise:report` runs 2,000 seeds per side of every configuration.
Seed `i` is `i * 7919 + 13`; baseline and treatment use the same seed and the
same policy. Each turn consumes a fixed number of policy RNG draws, whether
improvisation is enabled or not.

The documented player policy is:

- **60% goal-directed:** best open canonical recipe, prioritized as active
  challenge → required problem → age-up → unlocked fate → other new discovery.
- **25% recent curiosity:** best of 12 seeded pairs, preferring the six newest
  discoveries and untried pairs.
- **15% blind curiosity:** first of the same 12 seeded pairs.

The policy never chooses “use improvisation.” It chooses a pair. The feature
changes only what the engine does when that pair has no canonical recipe.
Trajectories can diverge after an invention changes the available pool; the
matched seed represents the same player tendencies under both counterfactuals.

Two-summer attempts consume lifespan twice but tick a challenge once, matching
the existing semantics of canonical `combo.cost`.

## Results

Every row is 2,000 baseline plus 2,000 treatment runs.

| Configuration | Fate baseline → improv | All required | Canon retained | Positive displacement/run | Successful / reused / rejected | Absurd / plausible | Credited share | Created p50 / p95 | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 summer, no cap | 2.40% → 1.85% | 100% → 100% | 99.57% | 0.410 | 16,129 / 150 / 21,345 | 7,103 / 9,176 | 4.21% | 8 / 12 | PASS |
| 1 summer, cap 1 | 2.40% → 1.80% | 100% → 100% | 99.92% | 0.275 | 2,000 / 66 / 35,182 | 502 / 1,564 | 1.39% | 1 / 1 | PASS |
| 1 summer, cap 2 | 2.40% → 2.20% | 100% → 100% | 99.64% | 0.369 | 3,998 / 111 / 33,269 | 1,295 / 2,814 | 2.40% | 2 / 2 | PASS |
| 1 summer, cap 3 | 2.40% → 1.90% | 100% → 100% | 99.68% | 0.385 | 5,990 / 123 / 31,365 | 2,255 / 3,858 | 3.08% | 3 / 3 | PASS |
| **1 summer, cap 5** | **2.40% → 1.70%** | **100% → 100%** | **99.61%** | **0.393** | **9,836 / 141 / 27,613** | **4,151 / 5,826** | **3.76%** | **5 / 5** | **PASS** |
| 2 summers, no cap | 2.40% → 0.40% | 100% → 99.95% | 73.62% | 8.165 | 12,452 / 114 / 14,703 | 5,461 / 7,105 | 5.37% | 6 / 9 | **FAIL** |

All modes reached some ending in 100% of runs. The chosen configuration used
49.896 summers on average, solved 6,491 challenges and failed 0. Its 9,836 new
inventions were distributed as depth 1: **1,034**, depth 2: **3,726**, depth 3:
**5,076**. Credited inventions per run were p50 **1**, p90 **2**, p95 **3**.
Matched positive canonical displacement was p50 **0**, p90 **1**, p95 **2**.

## Rationale

- Raising the cost to two summers did not protect canon. It shortened the
  useful life: canonical discoveries fell from 30.84 to 22.71 per run.
- One-summer configurations did not increase fate completion or required
  completion and retained at least 99.57% of canonical discovery volume.
- Five is the most permissive capped candidate that passed the predefined
  rules. Its improvised required-solve share, **19.87%**, is close to the 20%
  boundary; that is a reason to keep the production flag off until people play
  it, not a reason to move the threshold after seeing the result.
- The explicit client cap is still required by SEC-003 even though the
  one-summer/no-cap balance row also passed.

## Honest limitations

- This is one deterministic, competent policy, not a population of humans. It
  solved every required problem and failed no challenges, so it cannot estimate
  novice challenge failure or whether the run-limit feels frustrating.
- The policy kept testing otherwise-valid empty pairs after reaching the cap, producing 7,455
  `run-limit` rejections in the chosen treatment. Humans may adapt sooner after
  hearing the narrator; only browser observation can answer that.
- The simulation measures mechanical displacement, not whether absurd play is
  funnier. TASK-030 still requires three human “absurd-only” runs.
- No network, live copy, voice playback, visual UI, production flag, or deploy
  was exercised here. Late copy is mechanically copy-only and cannot create a
  sixth element, but its perceived timing still needs browser playtesting.

## Changelog

- **1.0 (2026-08-13):** Initial matched-seed measurement, thresholds, chosen
  one-summer/cap-five recommendation, deterministic artifact, and human-test
  caveats.
