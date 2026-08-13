# Improvisation balance

**Version:** 1.1

**Measured:** 2026-08-13

**Artifact:** `docs/design/improvisation-balance-results.json`

**Reproducibility hash:** `fnv1a32:fa873b0e`

## Decision

Recommend **1 summer per non-canonical attempt and at most 6 unique
improvised inventions per run**.

This is still a source recommendation, not a deployment decision.
`VITE_IMPROVISE_ENABLED` remains unset in production. Browser playtesting and
TASK-030 belong on the later playtest branch.

The cap counts successful unique runtime inventions. Reuse remains legal. A
new invention beyond the boundary returns `improvise-rejected: run-limit` and
still consumes one summer. Usage derives from the validated, serialized
`GameState.improvisedElements`, so reload cannot reset it.

## Rules fixed before the robust rerun

### Candidate range

- Measure the one-summer/no-cap reference first, then test **every integer cap
  from 1 through that same run set's observed per-run maximum**. This prevents
  a new policy from silently moving the no-cap tail beyond a stale fixed range.
- Also test one-summer/no-cap and two-summer/no-cap as non-selectable stress
  references.

### Exact causal policy

Baseline generates one 50-pair action plan. Treatment replays that exact pair
sequence until its own run ends. Treatment state never influences pair choice,
and sampled-pair scoring has no preference for recipe gaps.

The plan generator itself remains:

- **60% goal-directed:** challenge → required problem → age-up → fate → other
  canonical discovery.
- **25% recent curiosity:** best of 12 seeded pairs, preferring the six newest
  canonical discoveries and untried pairs.
- **15% blind curiosity:** first of the same 12 seeded pairs.

### Robustness

Every configuration runs 2,000 matched pairs under each predefined schedule:

1. `seed = i * 7919 + 13`
2. `seed = i * 104729 + 97`
3. `seed = uint32((i + 1) * 2654435761 + 1013904223)`

A selectable cap must pass every schedule under the guard-banded limits:

| Metric | Outer threshold | Robust selection threshold |
|---|---:|---:|
| Fate-completion increase | ≤ +2.0pp | **≤ +1.5pp** |
| All-required completion increase | ≤ +5.0pp | **≤ +4.0pp** |
| Canonical discoveries retained | ≥ 95% | **≥ 96%** |
| Positive canonical displacement | ≤ 1.0/run | **≤ 0.8/run** |
| Improvised credited share | ≤ 20% | **≤ 18%** |
| Improvised required-solve share | ≤ 20% | **≤ 18%** |

Gray-goo guard: created inventions p95 must be at most **20% of baseline
canonical-discovery p50** in every schedule. Baseline p50 was 32, so the
measured limit was 6.

Selection rule: choose the highest finite one-summer integer cap passing every
robust threshold and the gray-goo guard in all schedules. No-cap can never be
selected.

## Results

Across all 6,000 matched pairs, every one-summer configuration had fate delta
0.00pp, required-completion delta 0.00pp, canonical retention at least 100.00%,
and positive canonical displacement at most 0.001/run. The selection boundary
was therefore the independently declared gray-goo guard, not an unreported
balance preference.

| Configuration | Required solves by improv | Credited share | Created p95 | Gray-goo limit | Robust |
|---|---:|---:|---:|---:|---|
| cap 1 | 8.40% | 1.26% | 1 | 6 | PASS |
| cap 2 | 12.96% | 2.09% | 2 | 6 | PASS |
| cap 3 | 15.05% | 2.65% | 3 | 6 | PASS |
| cap 4 | 16.01% | 3.02% | 4 | 6 | PASS |
| cap 5 | 16.42% | 3.26% | 5 | 6 | PASS |
| **cap 6** | **16.54%** | **3.41%** | **6** | **6** | **PASS — selected** |
| cap 7 | 16.61% | 3.53% | 7 | 6 | FAIL gray-goo |
| cap 8 | 16.62% | 3.60% | 8 | 6 | FAIL gray-goo |
| cap 9 | 16.62% | 3.65% | 9 | 6 | FAIL gray-goo |
| cap 10 | 16.63% | 3.69% | 10 | 6 | FAIL gray-goo |
| cap 11 | 16.63% | 3.71% | 11 | 6 | FAIL gray-goo |
| cap 12 | 16.63% | 3.72% | 12 | 6 | FAIL gray-goo |
| cap 13 | 16.63% | 3.73% | 13 | 6 | FAIL gray-goo |
| cap 14 | 16.63% | 3.73% | 13 | 6 | FAIL gray-goo |
| cap 15 | 16.63% | 3.74% | 13 | 6 | FAIL gray-goo |
| cap 16 | 16.63% | 3.74% | 13 | 6 | FAIL gray-goo |
| cap 17 | 16.63% | 3.74% | 13 | 6 | FAIL gray-goo |
| cap 18 | 16.63% | 3.74% | 13 | 6 | FAIL gray-goo |
| cap 19 | 16.63% | 3.74% | 13 | 6 | FAIL gray-goo |
| 1 summer, no cap | 16.63% | 3.74% | 13 | 6 | FAIL gray-goo |
| 2 summers, no cap | 16.64% | 4.85% | 10 | 6 | FAIL balance + gray-goo |

Two-summer/no-cap additionally failed with fate delta **-3.82pp**, required
completion **-0.25pp**, canonical retention **77.16%**, and displacement
**7.293/run**.

### Selected cap 6

- Fate: **6.62% baseline → 6.62% treatment**
- All required problems: **100% → 100%**
- Canonical discoveries: **31.920 → 31.923/run**
- Positive canonical displacement: **0.0005/run**
- Successful / reused / rejected: **34,313 / 569 / 65,662**
- Absurd / plausible accepted attempts: **16,590 / 18,292**
- Improvised inventions credited: **6,769**
- Created inventions: p50 **6**, p90 **6**, p95 **6**, max **6**
- Credited inventions/run: p50 **1**, p90 **2**, p95 **3**
- Depth distribution: depth 1 **2,777**, depth 2 **12,166**, depth 3 **19,370**

Per schedule, improvised required-solve share was **16.30% / 16.80% / 16.53%**,
credited share **3.39% / 3.37% / 3.48%**, and positive displacement
**0.0005 / 0 / 0.001**. All robust guards passed. Cap 7 failed the gray-goo
guard in all three schedules.

## Persistence and reproducibility

Feature-on UI now saves every state-changing outcome. Verdict, depth-limit and
run-limit rejection therefore preserve both the spent summer and any challenge
tick across reload. Feature-off persistence behavior is unchanged.

`npm run improvise:report:check` regenerates the report, byte-compares the
committed artifact, verifies `fnv1a32:fa873b0e`, requires the selected row to be
robust, and checks production cost/cap constants. The existing
`test-and-build` CI job runs this check.

## Honest limitations

- Exact replay is the primary causal comparison, so treatment-only inventions
  are not selected as later parents. This removes hidden treatment preference,
  but human gray-goo behavior still requires playtesting.
- The competent policy solved every required problem and almost every
  challenge. It does not estimate novice failure or whether the sixth-invention
  boundary feels satisfying.
- The simulation measures mechanics, not whether absurd-only play is funnier.
  TASK-030 remains open.
- No network, voice playback, visual UI, production flag or deploy was
  exercised.

## Changelog

- **1.1 (2026-08-13):** Replaced the invalid sparse cap search with a dynamic
  1..observed-no-cap-maximum range (1–19 in this run), exact action replay,
  three seed schedules, guard bands, a gray-goo selection rule, cap-six
  recommendation, rejection persistence, and deterministic artifact/default
  CI checking.
- **1.0 (2026-08-13):** Initial single-schedule cap-five recommendation;
  superseded by 1.1.
