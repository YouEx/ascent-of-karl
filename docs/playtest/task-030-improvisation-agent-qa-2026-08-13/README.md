# TASK-030 — agent browser playtest of improvisation

**Date:** 2026-08-13  
**Scope:** agent QA pass, not external-human evidence  
**Feature mode:** `VITE_IMPROVISE_ENABLED=true`, with
`VITE_IMPROVISE_URL` explicitly absent  
**Artifact root:** `docs/playtest/task-030-improvisation-agent-qa-2026-08-13/`

**Balance contract:** cap 6, one summer and reproducibility hash
`fnv1a32:fa873b0e` come from
[`docs/design/improvisation-balance.md`](../../design/improvisation-balance.md).

## Method

The playtest used a real local Vite app and Playwright browser interactions
through the normal UI. No Engine method was called to produce a play outcome.
Each context started with empty browser storage and a fixed boot seed. Run 1
used keyboard activation for the opening combination, run 2 used a 390 px
mobile touch context and `locator.tap()`, and run 3 used desktop mouse input.

Reproduce while the feature-on Vite server is running:

```bash
env -u VITE_IMPROVISE_URL VITE_IMPROVISE_ENABLED=true \
  npm run dev -- --host 127.0.0.1 --port 5199 --strictPort
node docs/playtest/task-030-improvisation-agent-qa-2026-08-13/run-playtest.mjs
node docs/playtest/task-030-improvisation-agent-qa-2026-08-13/verify-evidence.mjs
```

The harness asserts that no browser request reaches `/improvise`, so all
invention copy in these artifacts is the deterministic offline fallback.
Each screenshot is captured to a temporary PNG, converted with ImageMagick 7
to metadata-stripped WebP (`method=6`, single-threaded, sharp YUV, exact,
quality 82), and the temporary PNG is removed. Capture fails before deleting
the previous artifact set if ImageMagick is unavailable.

## Runs

| Run | Seed / input | Required needs | Mechanics exercised | Persistence | Ending |
|---|---|---|---|---|---|
| 1 | 163 · 1440×1000 · keyboard + mouse | Cold: absurd `bautasten+graes`; tools: canonical `sten+pind`; hunger: plausible `baer+stenoekse` | Canon priority, accept, reject, depth 1→2→3, depth-4 reject, reuse, cap 6 | After capped turn 19: reload preserved 19 summers, 6 inventions and drought at 5 turns | Icarus, summer 26 |
| 2 | 230 · 390×844 · mobile taps | Same goal and pairs | Same full mechanic set in mobile layout; chronicle sheet, cards, toast and ending observed | Not reloaded; wolves spawned on capped turn | Icarus, summer 26 |
| 3 | 432 · 1280×900 · mouse | Same goal and pairs | Same full mechanic set with a third narrator seed | Not reloaded; fever spawned on capped turn | Icarus, summer 26 |

All three copied share payloads contain one completed base run and one
completed improvisation run. Each final state has all three required problems
solved, six improvised elements and no Worker request.

## Exact key outcomes

The complete 26-turn records are in each `run-log.json`. Every record includes
the exact pair, outcome, narrator line, solved need/challenge, turn, cap state
and an agent-only feedback assessment.

| Turn | Pair | Outcome |
|---:|---|---|
| 1 | `sten+sten` | Canonical Sparks won priority; no invention was created |
| 4 | `bautasten+graes` | Absurd invention accepted at depth 3; solved cold |
| 5 | `pind+sten` | Canonical Stone axe solved tools |
| 9 | `ler+ler` | Rejected; no cap slot consumed |
| 10 | `graes+sten` | Accepted depth-1 invention |
| 13 | `improv:5:graes:4:sten+stenoekse` | Accepted depth-2 reuse of the invented branch |
| 14 | `baer+stenoekse` | Plausible invention accepted; solved hunger |
| 15 | depth-2 branch + hunger invention | Accepted depth-3 invention |
| 16 | depth-3 branch + cold invention | Rejected at depth 4; one summer consumed |
| 17 | `bautasten+graes` | Existing invention reused; cap remained 5 |
| 18 | `gnister+stenoekse` | Sixth unique invention accepted |
| 19 | `saft+stenoekse` | Valid new idea rejected by run cap; cap remained 6 |

Representative run-1 narrator lines:

- Absurd success: “The cold, beaten by standing stone-dry grass contraption.
  Ridiculous. Effective.”
- Ordinary rejection: “clay and clay: bold, but unsupported.”
- Plausible success: “berries worked by stone axe solves Karl's hunger.
  History adjusts.”
- Depth rejection: “No further branch from …”
- Reuse: “Karl remakes … I recognise it, regrettably.”

## Visual evidence

Each run directory contains its own screenshots, structured log and copied
share payload. The main index is `artifacts/summary.json`.

Key paths:

- Run 1:
  - `artifacts/run-01-desktop-seed-163/03-absurd-cold-invention.webp`
  - `artifacts/run-01-desktop-seed-163/06-depth-3-invention.webp`
  - `artifacts/run-01-desktop-seed-163/09-run-limit-and-challenge.webp`
  - `artifacts/run-01-desktop-seed-163/10-chronicle-six-inventions.webp`
  - `artifacts/run-01-desktop-seed-163/11-reload-continue-title.webp`
  - `artifacts/run-01-desktop-seed-163/12-resumed-challenge.webp`
  - `artifacts/run-01-desktop-seed-163/13-ending-run-summary.webp`
- Run 2:
  - `artifacts/run-02-mobile-seed-230/02a-mobile-tap-selection.webp`
  - `artifacts/run-02-mobile-seed-230/06-depth-3-invention.webp`
  - `artifacts/run-02-mobile-seed-230/09-run-limit-and-challenge.webp`
  - `artifacts/run-02-mobile-seed-230/10-chronicle-six-inventions.webp`
  - `artifacts/run-02-mobile-seed-230/14-copied-playtest-log.webp`
- Run 3:
  - `artifacts/run-03-desktop-seed-432/05-plausible-hunger-invention.webp`
  - `artifacts/run-03-desktop-seed-432/13-ending-run-summary.webp`

Manual screenshot inspection found no clipping or blocked controls in the
desktop cards, 390 px cards, mobile chronicle, status toasts or ending summary.
The deliberately long depth-3 fallback name wraps densely but remains fully
visible and actionable at 390 px.

`verify-evidence.mjs` enforces that all 39 summary/run-log references resolve
to metadata-free WebP files, dimensions remain at their captured desktop or
2× mobile resolution, no PNG file remains, no screenshot exceeds 2 MB, and
the complete evidence root stays at or below 12 MB. The committed package is
2.82 MB.

## Product verdicts

### Is seeking absurd solutions more fun than normal?

**Promising, but not proven.** The absurd cold solution created the strongest
single payoff in all three runs because the goal, strange object and narrator
judgment aligned. The search itself was slower and depended on canonical
discoveries to open useful gaps. This agent knew the system and cannot measure
surprise or laughter; external humans still have to decide whether the peak is
worth the extra search.

### Does narrator payoff distinguish accepted and failed attempts?

**Yes mechanically; unevenly in comic specificity.** Accepted solutions name
the invention and need. Depth-limit and reuse lines are distinct and clear.
The ordinary self-pair rejection is understandable because of the toast, but
its narrator line is more generic than the accepted payoff. On the capped turn
a newly spawned challenge correctly wins narrator priority, so the cap is
communicated only by the status toast on that turn.

### Does cap 6 feel punitive or protective?

**More protective than punitive in this route.** Six slots allowed two required
solutions, an explicit depth 1→2→3 branch and one extra invention before the
boundary. The seventh valid idea being refused is intentionally abrupt, but
the toast is explicit, reuse remains legal, and reload does not refund the
spent summer. A human who wants to keep free-form crafting may judge it more
harshly.

### Does canonical discovery remain relevant?

**Yes, decisively.** Canonical priority was visible on the first pair. Stone
axe was the practical route to the tools need, and canonical Round stone, Ore
and Wheel were needed to clear near-miss space for the depth chain. The ending
also remained wholly canonical. Final runs contained six improvised elements
but 21 canonical elements in the 27-item discovered pool.

## Defects

No reproducible source defect was found. No gameplay, UI, Engine or narrator
source was edited. The evidence harness itself was corrected while being
authored, before the successful recorded runs; those authoring mistakes were
not product defects.

Product observations, not fix requests:

1. A challenge spawn can mask the cap-specific narrator line; the cap toast
   still communicates the rule.
2. Ordinary verdict rejection copy is less specific than accepted solution
   copy.
3. Deep deterministic names become dense, but remained legible in the tested
   desktop and 390 px layouts.

## Validation gates

| Gate | Result |
|---|---|
| `verify-evidence.mjs` | 39/39 WebPs, 2.82 MB, references/dimensions/metadata/size passed |
| Targeted improvisation/playtest/narrator tests | 63/63 passed |
| `npm test` | 889/889 passed |
| `npm run validate` | Passed, 0 warnings |
| `npm run predicates` | Passed, 0 false negatives |
| `npm run build` | Passed, including Worker typecheck and bundle budget |
| Feature-off UX audit | 38/38 passed |
| Feature-on UX audit | 40/40 passed |
| `npm run test:visual` | 2/2 passed |
| `npm run improvise:report:check` | Passed, `fnv1a32:fa873b0e` |

The first visual command was deliberately not accepted as evidence: it found
the still-running feature-on playtest server on the audit port and therefore
failed the feature-off baseline. After both temporary Vite servers were
stopped, the clean rerun passed both visual tests.

## Evidence limitation and external blocker

This is **agent QA**, not external-human playtest evidence. The agent knew the
recipes, predicates and intended jokes, so these runs cannot establish that
new players seek absurdity voluntarily, understand onboarding, or laugh.

The exact blocker to production enablement is an observed external-human
round: 5–10 English-speaking participants across crafting-game- and
low-game-experience groups, playing without explanation under
`docs/playtest/README.md`,
with their reactions and copied logs recorded. Until that evidence exists,
`VITE_IMPROVISE_ENABLED` must remain unset in deploy, and no Worker URL,
secret or production traffic should be configured.
