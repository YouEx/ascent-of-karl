# Stemmedommer: kalibrering af fingeraftryk og tærskel

Samme metode som den visuelle dommer (`tools/judge/`): mål afstanden til referencen, afvis på tallet, ikke på fornemmelsen. Referencen her er ikke ét billede men fordelingen af de håndskrevne replikkers egne tal — tærsklen er derfor udledt af korpusset selv, ikke et ønsketal (se "Tærskel" nedenfor).

## Korpus: hvor mange håndskrevne replikker er der?

Tre forskellige, alle rigtige tal, alt efter hvad man spørger om:

- **61** unikke replik-TEKSTER er markeret `narratorLine` i `content/combos.json` (efter at have fjernet dubletter — flere kombinationer kan pege på samme skrevne replik).
- **74** er antallet af `narratorLine`-REFERENCER i `combos.json` (én pr. kombination, inklusive gentagelser af samme replik).
- **71** er tallet planens tekst selv nævner (TASK-015/027) — hverken 74 eller 61. Se "Uoverensstemmelser med planen" nedenfor.

Fingeraftrykket i dette dokument er bygget af et FJERDE, bevidst bredere tal: **173** replik-definitioner (168 i akt 1, 5 i akt 2) fra `lines`-nøglen i `act-1.json`/`act-2.json`, med **866** varianttekster i alt. `lines` er det eneste sted håndskrevet fortæller-tekst rent faktisk STÅR — nøgler som `genericFailure`, `deflectedEndingLine`, `discoveryFallback`, `challengeWarningLine`, `defiance`, `defianceComic` og `obeyedFailure` er rene ID-pointere IND i `lines`, ikke egen tekst (efterset i `act-1.json`/`act-2.json` — ingen af dem har en `text`- eller `variants`-nøgle af egen kraft). At måle stemmen på kun de 61/74 `narratorLine`-mærkede replikker ville udelukke hundredvis af replikker der er lige så håndskrevne — blot brugt et andet sted i flowet (fejl-tekst, afvisninger, opdagelsesfald-tilbage). Se docstringen øverst i `metrics.py` for den fulde begrundelse.

## Fingeraftrykket — nøgletal

- **Ordlængde** (bogstaver/ord, alle ord poolet): median 4.0, middel 4.42, spredning 2.23.
- **Sætninger pr. replik**: median 2, middel 2.56, p90 4. **144/866 (16.6 %)** af de HÅNDSKREVNE varianter har selv mere end 3 sætninger — stakkato-stilen ("Sparks fly. Karl gasps. I gasp. The boar leaves.") er ægte, ikke en fejl i optællingen. Se "Hård afvisning af sætningstal" i `judge.py`'s docstring.
- **Ord pr. replik**: median 17, p90 26, max 37. 17/866 håndskrevne varianter overstiger selv det hårde loft på 32 ord.
- **Nutid**: 64.1 % af de sætninger der overhovedet kan afgøres (resten er tidsløse/uafgørbare), 32.8 % af ALLE sætninger.
- **Faste figurer**: Karl nævnt i 48 % af replikkerne, vildsvinet i 4 %, "Grub Man" i 0.8 %. Ikke en scoringsdimension pr. kandidat (se `judge.py`) — kun beskrivende, fordi over halvdelen af ægte replikker ikke nævner nogen af dem.
- **Ordforråd**: 2682 unikke ord over 14853 tokens.
- **Punchlines**: 819 unikke, normaliserede slutlinjer. 108/819 (13.2 %) er 3 ord eller kortere ("a bold choice, evolutionarily speaking" …) — relevant for genbrugs-afvisningen nedenfor.

## Politik: kilde-sammensatte gates (2026-08-12, udvidet 2026-08-13)

En hård port der fældede 488 allerede godkendte replikker kunne ikke lukke TASK-030 — se punkt 2/9 i "Uoverensstemmelser med planen" for den fulde historik. Beslutningen, truffet eksplicit denne runde, er at PORTEN er sammensat af to kilde-specifikke regelsæt i stedet for ét fælles regelsæt — ikke en svækkelse af nogen af dem:

1. **32-ords-/3-sætnings-loftet håndhæves kun for `source="grammar"`** (grammatik og fremtidig live-genereret tekst). Bagte par har deres eget, allerede godkendte kontraktloft — 320 tegn, `tools/check_pairs.py`, TASK-023 — og håndhæves IKKE mod grammatikkens ordtal-loft. Stemmescore, moderne/fejlmeddelelses-register og meningsfuld punchline-genbrug gælder fortsat for bagte par UÆNDRET; kun de to hårde længde-tal er kilde-betingede. Se `hard_reject()`'s docstring i `judge.py`.
2. **Punchline-genbrug hård-afvises for ALT undtagen en lille, håndklassificeret liste af genuint generiske lukninger** (`genericPunchlineExemptions` i `lexicon.json`, TASK-030-opfølgning 2026-08-13). Første udgave af denne regel brugte et blankt ordtals-loft ("under 4 ord tæller ikke") — men kodegennemgang viste at det var for groft: et vilkårligt ordtal fritog IKKE KUN generiske negationer som "not today", men også korpussets EGNE korte, distinkte punchlines ("grub man", "we have fire") hvis en kandidat tilfældigvis genbrugte præcis dem. Listen er derfor nu 14 håndklassificerede lukninger, hver vurderet mod sin FULDE oprindelseslinje i korpus (ikke bare den isolerede slutning) efter en skarp regel: enten (a) rent grammatisk — kun pronominer/hjælpeverber/negation/konjunktioner, intet selvstændigt indholdsord — eller (b) et bogstaveligt, gentaget strukturmærke ("the end", som optræder i 35+ forskellige slut-replikker som titelkort, ikke en vittighed). 14/819 håndskrevne punchlines matcher listen. Se `lexicon.json`'s `_genericPunchlineExemptionsKommentar` for den fulde, replik-for-replik begrundelse, og `judge.py`'s selftest for et eksplicit bevis på begge retninger: alle 14 undtagelser består, og de fire eksempler kodegennemgangen selv navngav som SKAL blive ved med at fælde en kandidat ("grub man"/"we have fire"/"onward, humanity"/"third time, harpoon") gør netop det.

**Et tredje, mindre indlysende problem dukkede op EFTER at have implementeret punkt 1 og 2 ovenfor: fjernelse af det hårde ordtal-loft for bagte par løste kun den HÅRDE afvisning — men den KONTINUERLIGE `wordCount`-dimension i `score()` målte stadig bagte pars ordtal mod det HÅNDSKREVNE korpus' egen ordtal-fordeling** (median 17, p90 26 — se "Fingeraftrykket" ovenfor). Bagte par er systematisk cirka dobbelt så lange (selv-målt: median 32, p90 43) under deres egen 320-tegns-kontrakt — så selv efter punkt 1 blev **327 af 908 bagte par-varianter** ved en fejl ved at falde under tærsklen alene på grund af denne ene dimension, hvilket reelt genindførte næsten den samme straf som punkt 1 lige havde fjernet, bare via en blødere mekanisme. Diagnosticeret præcist: `wordCount`-dimensionen scorede i gennemsnit 0.226 blandt de fejlende mod 0.731 blandt de bestående, mens alle 5 øvrige dimensioner lå 0.94-1.0 i BEGGE grupper — dvs. denne ene dimension var eneste årsag.

**Første løsning (2026-08-12)** var `pairs_wordcount_band()`: bagte pars `wordCount`-dimension scoret mod bagte pars EGEN, LIVE-genberegnede ordtal-fordeling i stedet for det håndskrevne korpus'. Effekt dengang: bagte par-fejl faldt fra 327 til 12.

**Kodegennemgang (2026-08-13) fandt et selv-modsigende problem i netop den løsning**: et bånd der altid genberegnes fra netop de kandidater det dømmer, kan definitorisk aldrig opdage at kandidaterne SOM HELHED er skredet — båndet flytter sig MED dem og finder dem for evigt "normale", uanset hvor lange de bliver. Løsningen er at FRYSE båndet: `tools/voice/pairs_baseline.json` er et øjebliksbillede af ordtal-fordelingen taget DA de 908 varianter var menneske-godkendte (TASK-023) og bestod stemmedommeren — ikke et tal der opdaterer sig selv. Genkalibrering kræver nu en eksplicit, synlig handling (`python3 tools/voice/freeze_pairs_baseline.py`), aldrig en stiltiende bivirkning af at dømme. `judge.py`'s selftest beviser det konkret: rigtige par scorer i snit 0.958 mod det frosne bånd; de SAMME par, kunstigt oppustet med 40 fyldord hver, scorer 0.079 mod DET SAMME frosne bånd (skredet fanges) — men ville scoret 0.958 igen mod et bånd genberegnet FRA netop den oppustede mængde (det er præcis den blindhed frysningen forhindrer). `calibrate.py` (denne rapport) viser til sammenligning begge tal — det frosne bånd og hvad en live-genberegning ville sige lige nu — i "Frosset ordtal-bånd for bagte par" nedenfor.

**Talrækken gennem hele runden** (grammatik + bagte par, tilsammen): 488 fejl under den bogstavelige, fælles 32-ords-/3-sætnings-regel (24 grammatik + 464 par) → 349 efter punkt 1+2's kode var på plads, men FØR `pairs_wordcount_band()`-fundet (22 grammatik + 327 par) → 34 efter `pairs_wordcount_band()`-rettelsen (22 grammatik + 12 par) → **0** efter at alle 34 replikker er omskrevet indholdsmæssigt (se `gate.py`'s output i rapporten). Ingen af de tre mellemliggende tal er forkerte — de er øjebliksbilleder af samme mængde arbejde, målt før hvert af de tre efterfølgende rettelsestrin.

## Frosset ordtal-bånd for bagte par (2026-08-13)

Frosset version 2, 2026-08-13, fra commit `0cb91b78469c` (404 par, 908 varianter). Genkalibrering: `python3 tools/voice/freeze_pairs_baseline.py` — aldrig automatisk.

| | median | p10 | p90 | n |
|---|---:|---:|---:|---:|
| Frosset (bruges af gate()) | 32 | 24 | 43 | 908 |
| Live genberegnet lige nu | 32 | 24 | 43 | 908 |

Frosset og live matcher fuldstændigt — ingen indholdsskred siden frysningen.

**Drift-beviset (samme tal som selftesten i `judge.py`, her mod det faktiske aktuelle indhold i stedet for en fixture):**

- Rigtige par mod det frosne bånd: gennemsnitlig ordtal-score **0.958**.
- De SAMME par, hver oppustet med 40 fyldord, mod det SAMME frosne bånd: **0.079** — skredet fanges.
- De oppustede par mod et bånd genberegnet FRA den oppustede mængde selv: **0.958** — ville set normalt ud, hvis båndet ikke var frosset. Det er præcis den blindhed frysningen forhindrer.

## Rettede replikker denne runde (34 stk., audit trail)

Data-kilde: `calibration_history.json` (dateret 2026-08-12) — den ENESTE statiske undtagelse fra denne rapports ellers levende, genberegnede tal (se modulets docstring). Før/efter-teksten herunder er verificeret mod det faktiske git-diff på redigeringstidspunktet, ikke gengivet fra hukommelsen. Fremtidige kørsler af dette script GENBEREGNER ikke denne liste — den er en logbog over ÉN runde rettelser, ikke en løbende måling.

### Grammatik (22 varianter)

- **g-locked-3#4** — 33 ord (grænse: 3 sætninger / 32 ord)
  - Før: *Some ideas wait for the right version of their inventor. Karl isn't that version yet, not for the {a} and the {b}. He's working on it, slowly, the way Karl works on everything.*
  - Efter: *Some ideas wait for the right version of their inventor. Karl isn't that version yet, not for the {a} and the {b}. He's working on it, slowly, the way Karl always does.*
- **g-nm-2#0** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *I know exactly what the {a} and the {b} were missing. The {right} did fine. The {wrong}, less so. Beyond that, I am under absolutely no obligation to say.*
  - Efter: *I know exactly what the {a} and the {b} were missing. The {right} did fine, the {wrong} less so. Beyond that, I am under absolutely no obligation to say.*
- **g-nm-2#2** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *The {a} tried. The {b} tried. Only the {right} found a partner that actually works, and I've met it. The {wrong} will not get an introduction today.*
  - Efter: *The {a} and the {b} both tried. Only the {right} found a partner that actually works, and I've met it. The {wrong} will not get an introduction today.*
- **g-nm-2#4** — 5 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *The {a} and the {b} were one substitution away from working. The {right} did fine as it stood. The {wrong} needed replacing. Which replacement, though? Sealed lips, I'm afraid.*
  - Efter: *The {a} and the {b} were one substitution away from working. The {right} did fine as it stood; the {wrong} needed replacing. Which replacement, though — sealed lips, I'm afraid.*
- **g-nm-2#5** — 5 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *Close enough, from the {a} to the {b}, that it almost hurt to watch. The {right} came so close. The {wrong} ruined it. Almost close enough that I nearly helped. Nearly.*
  - Efter: *Close enough, from the {a} to the {b}, that it almost hurt to watch. The {right} came so close, and the {wrong} ruined it. Almost close enough that I nearly helped — nearly.*
- **g-nm-3#4** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *Somewhere in this valley sits a piece of matching material — {shared}, to be precise. The {a} tried. The {b} tried. Only the {right} qualified; the {wrong} only looked the part.*
  - Efter: *Somewhere in this valley sits a piece of matching material — {shared}, to be precise. The {a} and the {b} both tried. Only the {right} qualified; the {wrong} only looked the part.*
- **g-nm-5#3** — 5 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *The judges' scores are in: the {right} earned a correct-impulse medal, the {wrong} earned 'wrong specimen' stamped on its file. No discovery either way. Tough crowd. It's me. I'm the crowd.*
  - Efter: *The {right} earned full marks, the {wrong} earned none. No discovery either way. Tough crowd — it's me, I'm the crowd.*
- **g-nm-7#0** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *You're closer than you think. The {right} already belonged here. The {wrong} held you back. Keep going.*
  - Efter: *You're closer than you think. The {right} already belonged here. The {wrong} held you back — keep going.*
- **g-nm-7#1** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *The {a} tried. The {b} tried. Only the {right} belonged in this story. Go find out where.*
  - Efter: *The {a} and the {b} both tried. Only the {right} belonged in this story. Go find out where.*
- **g-nm-7#3** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *You are one swap away. Keep the {right}. Swap out the {wrong}. That's the {a} and the {b} sorted, in theory.*
  - Efter: *You are one swap away. Keep the {right}, swap out the {wrong}. That's the {a} and the {b} sorted, in theory.*
- **g-nm-7#5** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *This was not nothing. The {a} and the {b} came close. The {right} nearly got there. Go find what it actually pairs with, and leave the {wrong} out of it.*
  - Efter: *This was not nothing — the {a} and the {b} came close. The {right} nearly got there. Go find what it actually pairs with, and leave the {wrong} out of it.*
- **g-nm-generous-1#5** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *Fine. The answer is the {partner}. The {a}, the {b}, and now you know: it replaces the {wrong}. The {right} had it right all along.*
  - Efter: *Fine — the answer is the {partner}. The {a}, the {b}, and now you know: it replaces the {wrong}. The {right} had it right all along.*
- **g-self-3#3** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *He turned the {a} over, considered it, and tried again with a second one. Same {a}. Same result. Same Karl.*
  - Efter: *He turned the {a} over, considered it, and tried again with a second one. Same {a}. Same result, same Karl.*
- **g-self-4#3** — 33 ord (grænse: 3 sætninger / 32 ord)
  - Før: *I have seen empires rise on stranger ideas than this. I have not seen one rise on the {a} meeting the {a}. That idea remains untested, and after today, untested for a reason.*
  - Efter: *I have seen empires rise on stranger ideas than this. I have not seen one rise on the {a} meeting the {a}. That idea remains untested, and after today, still is.*
- **g-inert-2#3** — 33 ord (grænse: 3 sætninger / 32 ord)
  - Før: *Somewhere, the world winced on behalf of the {deadEnd}. Karl did not notice — he was too busy holding the {a} in one hand and the {b} in the other, waiting for a sign.*
  - Efter: *Somewhere, the world winced on behalf of the {deadEnd}. Karl did not notice — too busy holding the {a} in one hand and the {b} in the other, waiting for a sign.*
- **g-inert-6#3** — 33 ord (grænse: 3 sætninger / 32 ord)
  - Før: *Nothing in this valley has ever found a use for the {deadEnd}, and nothing, apparently, plans to start — not with the {a}, not with the {b}, not with anything else Karl has tried.*
  - Efter: *Nothing in this valley has ever found a use for the {deadEnd}, and nothing plans to start — not with the {a}, not with the {b}, not with anything Karl has tried.*
- **g-inert-7#5** — 36 ord (grænse: 3 sætninger / 32 ord)
  - Før: *One learns, after enough ages, which objects are going somewhere and which are furniture. The {deadEnd} settled into the furniture category early, and today's attempt — the {a} and the {b} — did nothing to move things along.*
  - Efter: *One learns, after enough ages, which objects are going somewhere and which are furniture. The {deadEnd} settled into that category early; today's attempt, the {a} and the {b}, changed nothing.*
- **g-clash-2#2** — 35 ord (grænse: 3 sætninger / 32 ord)
  - Før: *He held the {a} and the {b} together a beat too long, as though {trait} might quietly become {trait2} if nobody looked directly at it. Nobody looked away either. Both stayed exactly what they were.*
  - Efter: *He held the {a} and the {b} together a beat too long, as though {trait} might quietly become {trait2} if nobody looked. Both stayed exactly what they were.*
- **g-plaus-2#5** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *My sympathies to the {a}. My sympathies to the {b}. Both showed up. Neither was met halfway.*
  - Efter: *My sympathies to the {a} and the {b}. Both showed up. Neither was met halfway.*
- **g-plaus-3#3** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *I checked. There is no rule against the {a} and the {b} working together. There's also no rule for it yet. Someone should fix that.*
  - Efter: *I checked. There is no rule against the {a} and the {b} working together. There's also no rule for it yet — someone should fix that.*
- **g-plaus-5#0** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *Karl isn't wrong to try the {a} with the {b}. He's just early. Someone will get credit for this eventually. Possibly not him.*
  - Efter: *Karl isn't wrong to try the {a} with the {b}. He's just early. Someone will get credit for this eventually — possibly not him.*
- **g-abs-2#3** — 4 sætninger (grænse: 3 sætninger / 32 ord)
  - Før: *Not kin. Not neighbours. Not acquaintances. The {a} and the {b} are, as far as I can tell, complete strangers.*
  - Efter: *Not kin. Not neighbours, not acquaintances. The {a} and the {b} are, as far as I can tell, complete strangers.*

### Bagte par (12 varianter)

- **pair-dyr-pind-absurd#0** — score 0.840 (tærskel 0.8871), 21 ord
  - Før: *The wild boar and the stick belong to entirely different orders of existence, and neither seemed especially bothered by the introduction.*
  - Efter: *The wild boar looked at the stick for exactly as long as courtesy demanded, which was not long. Nothing about the introduction changed either one of them.*
- **pair-vand-vand-self#3** — score 0.851 (tærskel 0.8871), 12 ord
  - Før: *Water meeting water. Not a discovery — a puddle, mildly larger than before.*
  - Efter: *Water meeting water, introduced by Karl with the gravity of a real discovery. It was not one — only a puddle, mildly larger than before.*
- **pair-ler-ler-self#3** — score 0.885 (tærskel 0.8871), 16 ord
  - Før: *Clay against clay, wet meeting wet. What began as two is now, technically, one indistinct blob.*
  - Efter: *Clay against clay, wet meeting wet, exactly as unsurprising as it sounds. What began as two separate lumps is now, technically, one larger and equally indistinct blob.*
- **pair-honning-ler-inert#1** — score 0.851 (tærskel 0.8871), 24 ord
  - Før: *Honey heals, clay shapes: two proud little talents that, put together, cancel each other out and produce only a faintly sweet, faintly muddy silence.*
  - Efter: *Honey is good at healing. Clay is good at shaping. Put together, neither wins — only a quiet, sweet, muddy nothing.*
- **pair-boomerang-reb-near-miss#0** — score 0.886 (tærskel 0.8871), 54 ord
  - Før: *Karl tied the rope to the boomerang's tip, on the theory that a thing which already comes back could be persuaded to come back faster. It came back the same speed as always, dragging a length of rope behind it like an afterthought. The {right} had a knot to be part of somewhere else.*
  - Efter: *Karl tied the rope to the boomerang's tip, hoping a thing that already comes back might come back faster. It came back at the same old speed, dragging the rope behind it like an afterthought. The {right} had a knot to be part of somewhere else.*
- **pair-hjul-stenoekse-near-miss#0** — score 0.886 (tærskel 0.8871), 54 ord
  - Før: *Karl wedged the stone axe's blade against the wheel, hoping to give it something to roll toward. It rolled off in an entirely different direction, the same way it always does, and Karl chased it across the valley for a third time. The {right} had a job that had nothing to do with rolling.*
  - Efter: *Karl wedged the stone axe's blade against the wheel, hoping to give it something to roll toward. It rolled off in its usual direction instead, and Karl chased it across the valley for a third time. The {right} had a job that had nothing to do with rolling.*
- **pair-baer-stenspil-inert#1** — score 0.875 (tærskel 0.8871), 56 ord
  - Før: *There is exactly one rule to boules that Karl consistently loses by, and it has nothing to do with fruit. He rolled a handful of the berries into the circle anyway, hoping the game might quietly change its terms. Ugh has never once looked more personally offended on the game's behalf than at that exact moment.*
  - Efter: *There is exactly one rule to boules that Karl consistently loses by, and it has nothing to do with fruit. He rolled a handful of berries into the circle anyway, hoping the game might quietly change its terms. Ugh has never looked more personally offended on the game's behalf.*
- **pair-mudderkage-saft-plausible#0** — score 0.870 (tærskel 0.8871), 57 ord
  - Før: *Karl poured the berry juice over the mud pie, finishing it the way any proper baker finishes a proper cake. The mud pie soaked it up and turned a shade darker, which is further than most of Karl's meals ever get. Whatever separates a glazed mud pie from an actual dessert, Karl has not yet found it.*
  - Efter: *Karl poured the berry juice over the mud pie, finishing it the way a baker finishes a cake. The mud pie soaked it up and turned a shade darker, further than most of Karl's meals get. Whatever separates a glazed mud pie from a dessert, Karl has not found it.*
- **pair-spydspids-vand-near-miss#0** — score 0.866 (tærskel 0.8871), 58 ord
  - Før: *Karl dipped the stone-tipped spear into the water and swirled it, half-hoping the point might learn something new from the experience. It came out exactly as sharp, exactly as opinionated, and exactly as dry within a minute. The {right} had a use for water that had nothing to do with dipping spears in it.*
  - Efter: *Karl dipped the stone-tipped spear into the water and swirled it, half-hoping it might learn something new. It came out just as sharp, just as opinionated, and just as dry within a minute. The {right} had a use for water that had nothing to do with this.*
- **pair-galleri-sten-near-miss#0** — score 0.886 (tærskel 0.8871), 54 ord
  - Før: *Karl set his stone, the nearest thing he has to a best friend, beside the two paintings in the cave gallery, hoping the count might simply expand to three. It ruined the symmetry, and got nudged back outside the wall within the minute. The {right} always mattered more than a spare rock did.*
  - Efter: *Karl set his stone, the nearest thing he has to a best friend, beside the two paintings in the cave gallery, hoping the count might reach three. It ruined the symmetry, and got nudged back outside within the minute. The {right} always mattered more than a spare rock did.*
- **pair-bautasten-stenoekse-near-miss#0** — score 0.876 (tærskel 0.8871), 54 ord
  - Før: *Karl raised the stone axe toward the standing stone the way he raises it at any rock in need of an edge. Halfway through the swing, something made him stop, and the axe came down against nothing but air. The {right} earned that hesitation; a monument, it turns out, earns something else entirely.*
  - Efter: *Karl raised the stone axe toward the standing stone, the way he raises it at any rock needing an edge. Halfway through the swing, he stopped, and the axe came down against nothing but air. The {right} earned that hesitation; a monument earns something else.*
- **pair-mudderbad-sten-near-miss#0** — score 0.861 (tærskel 0.8871), 57 ord
  - Før: *Karl carried the stone to the edge of the mud bath, half expecting his usual conversation partner to climb in with him. It sank a little, said nothing, the way stones do, and stayed exactly as dry as it started. The {right} was hoping to get wet today; the stone was never going to be it.*
  - Efter: *Karl carried the stone to the edge of the mud bath, half expecting his usual partner to climb in with him. It sank a little, said nothing, the way stones do, and stayed dry. The {right} was hoping to get wet today; the stone was never it.*

## Score-fordelinger

`overall` er et uvægtet gennemsnit af 6 dimensioner (ordlængde, sætningstal, ordtal, ordforråd, nutid, tegnsætning), hver scoret 0-1 via intervalscoring mod korpusets EGEN spredning (se `judge.py`'s docstring — ikke z-score, fordi flere kanaler er nul-tunge). Håndskrevet er scoret mod sit eget fingeraftryk — cirkulært for punchline-afvisning (se nedenfor), men informativt for selve scorefordelingen.

| korpus | n | min | p1 | p5 | p10 | median | middel | max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Håndskrevet (mod eget fingeraftryk) | 866 | 0.727 | 0.814 | 0.887 | 0.912 | 0.992 | 0.972 | 1.000 |
| Grammatik (ekspanderet) | 312 | 0.890 | 0.904 | 0.922 | 0.946 | 0.998 | 0.983 | 1.000 |
| Bagte par (ekspanderet) | 908 | 0.888 | 0.898 | 0.922 | 0.949 | 0.992 | 0.984 | 1.000 |

## Hårde afvisninger

Pr.-kandidat optælling (én kandidat kan ramme flere kategorier, men tælles kun én gang i "mindst én"). Håndskrevet er UDELADT fra denne tabel med vilje: "genbrugt punchline" ville ramme en stor del af det håndskrevne korpus, fordi punchline-blokeringslisten er bygget FRA det — cirkulært, ikke en reel fejl. `gate()` kører derfor aldrig hårde afvisninger mod det håndskrevne korpus, kun mod grammatik og bagte par.

**Kolonnerne ">3 sætninger"/">32 ord" er, efter politik 2026-08-12 (se "Politik" ovenfor), kun HÅNDHÆVET for grammatik — for bagte par håndhæves i stedet `tools/check_pairs.py`'s 320-tegns-loft (en ekstern, allerede eksisterende port; se `_length_overage()`'s docstring i `calibrate.py`). Bagte par viser derfor altid 0 her, ikke fordi de er korte, men fordi denne specifikke regel ikke gælder for dem.

| korpus | n | mindst én | >3 sætninger (håndhævet) | >32 ord (håndhævet) | fejlmeddelelse | moderne ordforråd | genbrugt punchline |
|---|---:|---:|---:|---:|---:|---:|---:|
| Grammatik | 312 | 0 (0.0 %) | 0 (0.0 %) | 0 (0.0 %) | 0 (0.0 %) | 0 (0.0 %) | 0 (0.0 %) |
| Bagte par | 908 | 0 (0.0 %) | 0 (0.0 %) | 0 (0.0 %) | 0 (0.0 %) | 0 (0.0 %) | 0 (0.0 %) |

**Bagte par, til orientering (IKKE håndhævet — kun beskrivende længde): 34/908 ville overskride 3-sætnings-loftet og 445/908 (49.0 %) ville overskride 32-ords-loftet, HVIS grammatikkens loft blev anvendt bogstaveligt på dem.** Det er præcis den observation der begrundede politikbeslutningen 2026-08-12: bagte par er en strukturelt længere indholdstype under sin egen, allerede godkendte 320-tegns-kontrakt (TASK-023), og at måle dem mod grammatikkens korte skabelonloft ville straffe allerede godkendt indhold for en regel der aldrig var skrevet til dem. Se "Politik" ovenfor og "Uoverensstemmelser med planen" nedenfor for den fulde historik.

## Tærskel: valg og begrundelse

Tærsklen er en percentil af det håndskrevne korpus' EGEN scorefordeling — aldrig et ønsketal. Testet ved tre kandidat-percentiler mod det faktiske indhold (tærskel KOMBINERET med hårde afvisninger, dvs. den reelle gate-fejlrate):

| percentil | tærskel | grammatik fejler | bagte par fejler |
|---|---:|---:|---:|
| p1 | 0.8135 | 0/312 (0.0 %) | 0/908 (0.0 %) |
| p5 | 0.8871 | 0/312 (0.0 %) | 0/908 (0.0 %) |
| p10 | 0.9121 | 11/312 (3.5 %) | 24/908 (2.6 %) |

**Valgt: p5 = 0.8871.**

- p1 gør den kontinuerlige score redundant: den fanger 0 kandidater ud over hvad de hårde afvisninger allerede fanger, i BÅDE grammatik og par. En tærskel der aldrig selv fælder nogen dom, tester ikke noget — den er der kun på papiret.
- p10 fanger markant flere (se tabellen), men ved manuel gennemlæsning lyder flere af de EKSTRA kandidater tydeligt som fortælleren selv — de straffes reelt for at ligge i den lange hale mellem korpusets typiske spredning og det hårde 32-ords-loft, ikke fordi de lyder forkerte. Eksempler er navngivet i "De værste eksempler" nedenfor.
- p5 rammer midtimellem: den er ikke redundant, og de ekstra kandidater den fanger (ud over p1/hårde afvisninger) er faktisk mere grænseprægede end p10-mængden. De er navngivet nedenfor som kandidater til `docs/design/human-queue.json` — dommeren behøver ikke have ret i hvert enkelt tilfælde, den skal blot flage billigt til menneskelig kontrol.

## De værste eksempler (det vigtigste output)

### Grammatik — hårde afvisninger (0 stk.)

Ingen.

### Grammatik — lavest scorende der IKKE er hård-afvist (12 stk.)

- **grammar:inert:g-inert-5#1** — overall 0.890 (wordLength=0.96, sentenceCount=1.00, wordCount=0.57, vocabulary=1.00, presentTense=1.00, punctuation=0.81)
  > Give him credit: Karl has not yet run out of things to try against the bone — today it was the stone and the stick. He is, however, running out of things.
- **grammar:clash:g-clash-7#0** — overall 0.896 (wordLength=0.38, sentenceCount=1.00, wordCount=1.00, vocabulary=1.00, presentTense=1.00, punctuation=1.00)
  > That's a no, from both the stone and the stick. A polite no. But a no.
- **grammar:near-miss:g-nm-3#4** — overall 0.903 (wordLength=1.00, sentenceCount=1.00, wordCount=0.57, vocabulary=1.00, presentTense=1.00, punctuation=0.84)
  > Somewhere in this valley sits a piece of matching material — hot, to be precise. The stone and the stick both tried. Only the stone qualified; the stick only looked the part.
- **grammar:inert:g-inert-6#3** — overall 0.904 (wordLength=1.00, sentenceCount=1.00, wordCount=0.57, vocabulary=1.00, presentTense=1.00, punctuation=0.85)
  > Nothing in this valley has ever found a use for the bone, and nothing plans to start — not with the stone, not with the stick, not with anything Karl has tried.
- **grammar:plausible:g-plaus-6#1** — overall 0.905 (wordLength=0.49, sentenceCount=1.00, wordCount=1.00, vocabulary=1.00, presentTense=1.00, punctuation=0.94)
  > If I kept a book of ideas that deserved to work, the stone and the stick would be in it.
- **grammar:inert:g-inert-5#5** — overall 0.905 (wordLength=1.00, sentenceCount=1.00, wordCount=0.57, vocabulary=1.00, presentTense=1.00, punctuation=0.86)
  > Some things are late bloomers. After this many attempts — the stone, the stick, and everything before them — the bone looked less like a late bloomer and more like a control group.
- **grammar:near-miss:g-nm-2#5** — overall 0.908 (wordLength=1.00, sentenceCount=1.00, wordCount=0.51, vocabulary=1.00, presentTense=1.00, punctuation=0.93)
  > Close enough, from the stone to the stick, that it almost hurt to watch. The stone came so close, and the stick ruined it. Almost close enough that I nearly helped — nearly.
- **grammar:clash:g-clash-7#1** — overall 0.911 (wordLength=0.68, sentenceCount=1.00, wordCount=1.00, vocabulary=1.00, presentTense=1.00, punctuation=0.78)
  > The stone and the stick considered it, briefly, and declined — courteously, but completely.
- **grammar:inert:g-inert-2#3** — overall 0.911 (wordLength=1.00, sentenceCount=1.00, wordCount=0.57, vocabulary=1.00, presentTense=1.00, punctuation=0.89)
  > Somewhere, the world winced on behalf of the bone. Karl did not notice — too busy holding the stone in one hand and the stick in the other, waiting for a sign.
- **grammar:inert:g-inert-3#5** — overall 0.912 (wordLength=1.00, sentenceCount=1.00, wordCount=0.51, vocabulary=1.00, presentTense=1.00, punctuation=0.96)
  > One day, perhaps, the bone will find a calling. It did not happen today, with the stone or the stick or anything else, and I suspect it did not happen yesterday either.
- **grammar:inert:g-inert-6#2** — overall 0.912 (wordLength=1.00, sentenceCount=1.00, wordCount=0.51, vocabulary=1.00, presentTense=1.00, punctuation=0.96)
  > Even the boar, who reacts to almost nothing, looked up when Karl brought out the stone and the stick. Only the bone earned a second glance, and even that glance was unimpressed.
- **grammar:inert:g-inert-2#2** — overall 0.917 (wordLength=0.60, sentenceCount=1.00, wordCount=1.00, vocabulary=1.00, presentTense=1.00, punctuation=0.91)
  > That was a quiet failure. It suits the bone rather well, if I'm honest — and I try to be.

### Bagte par — hårde afvisninger (0 stk.)

Ingen — forventet efter politik 2026-08-12: sætnings-/ordtal-loftet håndhæves ikke for bagte par, så denne liste kan kun fyldes af score/register/moderne-ordforråd/punchline-hits, som alle er 0 lige nu (se "Hårde afvisninger"-tabellen ovenfor).

### Bagte par — lavest scorende der IKKE er hård-afvist (12 stk.)

- **pairs:haandkile+mudder:near-miss#0** — overall 0.888 (wordLength=1.00, sentenceCount=1.00, wordCount=0.44, vocabulary=1.00, presentTense=1.00, punctuation=0.89)
  > Karl pressed the hand axe into a fresh handful of mud, testing whether an edge could shape something that offers no resistance at all. It slid through without a mark, quietly competent at cutting nothing in particular. The hand axe was waiting for an edge like that; the mud never needed one.
- **pairs:galleri+pind:near-miss#0** — overall 0.888 (wordLength=1.00, sentenceCount=1.00, wordCount=0.44, vocabulary=1.00, presentTense=1.00, punctuation=0.89)
  > Karl propped his exceptional stick up between the two paintings, hoping it might read as a third exhibit, or at least a frame. The cave gallery's arrangement absorbed it exactly as well as it absorbs everything that isn't paint: not at all. The cave gallery had an actual frame waiting somewhere else.
- **pairs:froe+gnister:near-miss#0** — overall 0.888 (wordLength=1.00, sentenceCount=1.00, wordCount=0.44, vocabulary=1.00, presentTense=1.00, punctuation=0.89)
  > Karl scattered a handful of seeds across a shower of sparks, hoping heat might finally explain what they were for. The sparks died before the seeds even warmed through, and the mystery stayed exactly as unsolved as before. The seeds was going to answer that question eventually; this was not the afternoon.
- **pairs:graes+mudderkage:near-miss#1** — overall 0.892 (wordLength=1.00, sentenceCount=1.00, wordCount=0.40, vocabulary=1.00, presentTense=1.00, punctuation=0.95)
  > Karl tucked the dry grass beneath the mud pie, hoping today was finally the day something caught fire under one of Karl's meals. The mud stayed cold and wet, the grass stayed bone-dry and unlit, and neither improved the other. The dry grass was owed a rather different kind of attention today.
- **pairs:toemmerflaade+vand:plausible#3** — overall 0.893 (wordLength=0.58, sentenceCount=1.00, wordCount=0.78, vocabulary=1.00, presentTense=1.00, punctuation=1.00)
  > A raft, built to float. Water, built to hold it up. On paper, this was never going to be the hard part.
- **pairs:malm+mudder:near-miss#0** — overall 0.895 (wordLength=1.00, sentenceCount=1.00, wordCount=0.48, vocabulary=1.00, presentTense=1.00, punctuation=0.89)
  > Karl pressed a glittering piece of ore into a handful of mud, hoping the shine might rub off and improve the mud's prospects. The mud stayed exactly as plain and sticky as before, decoration or not. The ore has a future waiting for it; the mud has, at best, an afternoon.
- **pairs:malm+rullesten:near-miss#0** — overall 0.895 (wordLength=1.00, sentenceCount=1.00, wordCount=0.48, vocabulary=1.00, presentTense=1.00, punctuation=0.89)
  > Karl held his glittering ore up beside 'the good rock,' half expecting one treasure to recognise the other. The round stone stayed exactly as guarded and ordinary as ever, unmoved by a rival with a better future ahead of it. The ore was worth guarding; the other never entered this contest.
- **pairs:agern+graes:near-miss#1** — overall 0.896 (wordLength=0.70, sentenceCount=1.00, wordCount=0.78, vocabulary=1.00, presentTense=1.00, punctuation=0.89)
  > Dry grass insulates against the cold; an acorn, guarded this fiercely, apparently needed insulating from something else. The acorn knew exactly what.
- **pairs:haandkile+ler:inert#0** — overall 0.898 (wordLength=1.00, sentenceCount=1.00, wordCount=0.44, vocabulary=1.00, presentTense=1.00, punctuation=0.95)
  > Karl pressed the hand axe flat into the clay, curious whether a tool he trusts with everything could also teach the clay to hold a shape on its own. The clay took the impression and forgot it within the minute. The hand axe went back into his hand exactly as it was.
- **pairs:fisk+graes:plausible#1** — overall 0.898 (wordLength=1.00, sentenceCount=1.00, wordCount=0.44, vocabulary=1.00, presentTense=1.00, punctuation=0.95)
  > The fish arrived from the river already speared, already raw, and already declared 'sushi' ten thousand years ahead of schedule. The dry grass arrived bone-dry and bored, waiting for a job it has always been suited for. Between the two of them, only the small matter of actual cooking went unresolved.
- **pairs:boomerang+haandkile:inert#1** — overall 0.899 (wordLength=1.00, sentenceCount=1.00, wordCount=0.53, vocabulary=1.00, presentTense=1.00, punctuation=0.86)
  > One of these is famously good at nearly everything it touches; the other is famously good at exactly one trick, and only that trick. Introduced to each other, the hand axe and the boomerang picked up nothing from one another, and went back to being exactly what they already were.
- **pairs:galleri+hulemaleri:inert#0** — overall 0.899 (wordLength=1.00, sentenceCount=1.00, wordCount=0.53, vocabulary=1.00, presentTense=1.00, punctuation=0.86)
  > The cave gallery already holds its two paintings, nudged exactly into place, finger-width by finger-width, until Karl called it perfect. Handing over a third cave painting didn't earn it a place on the wall; the gallery was already exactly as perfect as it was ever going to be.

### Genbrugte punchlines — alle 0 tilfælde

Til kontekst: 14/819 håndskrevne punchlines står i `genericPunchlineExemptions` ("not today", "it is not", "the end", …) og tæller efter politik-punkt 2 ovenfor IKKE som genbrug uanset tilfældigt sammenfald — kun de resterende, DISTINKTE punchlines kan udløse denne afvisning (se "Politik" ovenfor for hvordan listen er afgrænset, replik for replik, fra korpussets egne korte-men-distinkte punchlines som "grub man"). Før 2026-08-13's data-drevne liste gav en tidligere, blank "<4 ord"-regel falsk alarm på netop denne slags korte, generiske negationer; de kandidatlinjer der ramte den er nu omskrevet (se "Rettede replikker denne runde" ovenfor). Med både den data-drevne undtagelseslisten og indholdsrettelserne på plads er der nu reelt 0 tilfælde tilbage. Selftesten i `judge.py` beviser begge retninger eksplicit: alle 14 undtagelser der matcher korpus består, OG de fire eksempler kodegennemgangen selv navngav som distinkte ("grub man"/"we have fire"/"onward, humanity"/"third time, harpoon") fælder stadig en kandidat, så denne sektion er ikke afskaffet — kun tømt indtil en fremtidig kandidatlinje faktisk genbruger en reel joke.

Ingen — se forklaringen ovenfor.

## Uoverensstemmelser med planen

1. **71 vs. 74 vs. 61 håndskrevne replikker.** Planen (TASK-015/027) siger 71. Det virkelige tal afhænger af hvad man tæller: 74 `narratorLine`-referencer i `combos.json`, som peger på kun 61 unikke tekster (flere kombinationer deler samme skrevne replik). Ingen af de tre er forkerte — de svarer bare på forskellige spørgsmål. Fingeraftrykket her bruger et fjerde, bevidst bredere tal (866 varianter over 173 replik-definitioner) — se "Korpus" ovenfor.

2. **Det hårde 32-ords-loft passer ikke til bagte par — løst denne runde ved eksplicit brugerbeslutning (2026-08-12).** TASK-028's tekst specificerede "over 32 ord" som en generel hård afvisning for "enhver kandidat-replik". Men `tools/check_pairs.py` — den EKSISTERENDE, allerede kørte port for bagte par (TASK-023, ✅ færdig) — håndhæver i stedet et loft på **320 tegn** (`if len(v) > 320`). Alle 908 bagte varianter overholder det loft præcist (målt max: 306 tegn) — de var allerede godkendt af et menneske under TASK-023's gennemgang. En bogstavelig anvendelse af TASK-028's ordtal-regel på bagte par gav oprindeligt 445/908 (49.0 %) afvisninger af allerede godkendte replikker — en hård port der fælder 488 godkendte linjer kunne ikke lukke opgaven. **Besluttet og implementeret denne runde**: det hårde 32-ords-/3-sætnings-loft gælder KUN `source="grammar"` (grammatik og fremtidig live-genereret tekst); bagte par bruger deres eget, allerede godkendte 320-tegns-kontraktloft via `check_pairs.py` i stedet — se "Politik: kilde-sammensatte gates" ovenfor for den fulde begrundelse og talrækken. Dette er en sammensætning af to gates efter kildetype, ikke en svækkelse af nogen af dem: stemmescore, moderne/fejlmeddelelses-register og meningsfuld punchline-genbrug gælder fortsat for bagte par uændret. Målt: håndskrevne replikker har median 17 ord (p90 26, max 37); bagte par har median 32 ord (p90 43, max 53) — cirka dobbelt så langt i den typiske replik, og det er den etablerede norm for denne kildetype, ikke en fejl.

3. **Grammatikkens tag-specialiseringer findes ikke i indholdet.** TASK-020 er markeret ✅ færdig (2026-08-12) og påstår "tag-specialiseringer for de 12 hyppigste `stuff`-par" er skrevet. Men `content/narrator/grammar-act-1.json`'s `grammar`-kort har KUN 7 nøgler — de bare domme (`locked`, `near-miss`, `self`, `inert`, `clash`, `plausible`, `absurd`) — ingen `"dom:stuff+stuff"`- eller `"dom:stuff"`-nøgler overhovedet. `src/narrator/grammar.ts`'s `grammarKeys()` prøver netop disse to mere specifikke nøgleformer FØR den falder tilbage til den bare dom (kildekoden bekræfter formatet: `${verdict}:${pair[0]}+${pair[1]}` og `${verdict}:${stuff}`) — så med indholdet som det er nu, rammer `grammarPool()` ALTID den generiske pulje, uanset hvilke to `stuff`-typer der indgår. Tag-specialiseringen er markeret færdig i planen, men findes ikke i det leverede indhold.

4. **Planen siger "otte domme", koden og indholdet har syv.** TASK-020's tekst nævner "de otte domme" — men `src/core/types.ts`'s `Verdict`-type har netop 7 værdier (`locked`, `near-miss`, `self`, `inert`, `clash`, `plausible`, `absurd`), og `grammar-act-1.json` har konsekvent også kun disse 7. Formentlig en efterladt tekst fra en tidligere designfase snarere end et reelt indholdshul — nævnt for fuldstændighedens skyld, i samme ånd som 71-vs-74-fundet.

5. **Planens bogstavelige eksempelord for "fejlmeddelelses-register" er selv falske positiver.** TASK-028's tekst nævner "cannot", "invalid", "try again" som eksempler. Testet ordret som blokerede enkeltord/-fraser mod alle 866 håndskrevne varianter: "cannot" gav 9 reelle hit i ægte, ikke-fejlmeddelelses-brug ("The pose cannot."), "can't" gav 6, "unable to" gav 1. Ordene er eksempler på REGISTERET (softwarefejl-tonefaldet), ikke en ordret liste der kan slås op som understrenge — en bogstavelig implementering ville have underkendt ægte, godkendt fortæller-tekst. `lexicon.json` bruger i stedet mere specifikke, stadig repræsentative fraser ("please try again", "invalid input/selection", …) der rammer samme register uden falske positiver (verificeret: 0 hit i 866 håndskrevne + 312 grammatik- + 908 par-varianter). Se `_forbiddenConstructionsKommentar` i `lexicon.json`.

6. **"car" er en etableret joke i korpus, ikke et stemmebrud.** Testet som moderne ordforråd, gav "car" 7 hit — men alle i en gentaget, tilsigtet anakronisme-joke (`story-flintmobil`, `mem-bilist`, `story-drive-in`: Karl opfinder bilen for tidligt). Fjernet fra `modernVocabulary`; øvrige moderne tech-ord (tv, mikroovn, internet, …) beholdes, da de ikke har samme etablerede kanon-status.

7. **`pairs_wordcount_band()` var en dømmekraftsbeslutning ud over den bogstavelige instruks — flagget til menneskelig kontrol i sidste runde, nu AFGJORT via en anden dømmekraftsbeslutning (2026-08-13).** Politik-punkt 1 (se ovenfor) fjernede det HÅRDE 32-ords-loft for bagte par, men løste ikke at den KONTINUERLIGE `wordCount`-scoringsdimension stadig målte bagte par mod det håndskrevne korpus' ordtal-fordeling — hvilket genindførte næsten samme straf via en blødere mekanisme (327/908 par faldt under tærsklen alene på denne ene dimension). Første løsning (2026-08-12) scorede bagte pars `wordCount` mod bagte pars EGEN, LIVE-genberegnede fordeling — men kodegennemgang påpegede at et bånd der altid genberegnes fra netop de kandidater det dømmer aldrig kan opdage at kandidaterne SOM HELHED er skredet. Løsningen (`tools/voice/pairs_baseline.json` + `freeze_pairs_baseline.py`, se "Frosset ordtal-bånd" ovenfor) er MIN egen dømmekraft ud over den bogstavelige instruks igen (brugeren bad om at fryse båndet, men ikke om de KONKRETE tal der udgør den første frysning — dem har jeg selv sat fra det aktuelle, menneske-godkendte indhold). Dokumenteret i `human-queue.json` som løst, med den nye mekanisme forklaret, ikke bare slettet.

8. **`genericPunchlineExemptions`-listens 14 konkrete ord er min egen klassificering, ikke brugerens.** Brugeren gav tre sædfrø-eksempler ("not today", "it is not", "not that") og et princip ("1-3-ords generisk lukning er ikke en punchline"). De øvrige 11 (`it does not`, `it wasn't`, `neither did we`, `there is none`, `no`, `he did not`, `you shouldn't`, `why not`, `and yet`, `but still`, `the end`) er fundet ved selv at læse alle 819 håndskrevne punchlines' FULDE oprindelseslinjer og afgøre hvilke der er rent sproglige mønstre versus fortællerens distinkte stemme-teknik (se `lexicon.json`'s kommentar for hvorfor fx `down`/`one`/`unfortunately` bevidst IKKE er på listen, selvom de er lige så korte). Flagget i `human-queue.json` til menneskelig sanity-check — rubrikken er stram og dokumenteret, men den endelige liste er en tolkning, ikke et objektivt udledt tal som fx tærsklen.

9. **`gate()` komponerer nu `check_pairs.py` — en udvidelse af TASK-030's scope, ikke en bogstavelig instruks.** Den oprindelige opgavetekst bad om at "give judge.py en ren indgang" for STEMME-scoring; kodegennemgang bad specifikt om at `gate()` også skulle bevise par-KONTRAKTEN (navn, dom, dublet, længde) i stedet for at antage et menneske huskede at køre `check_pairs.py` separat. Implementeret ved import (ikke subprocess) af en ny, ren `check_pairs_data()`/`check_pairs_file()`-kerne udtrukket af den eksisterende fil — `main()`'s CLI-adfærd er verificeret uændret (samme udskrift, samme returkode på alle 10 udkast-batches). Ikke en judgment call i samme forstand som punkt 7/8 (brugeren bad eksplicit om præcis dette), men nævnt her fordi det udvider hvad `gate()` dømmer ud over den oprindelige opgavetekst.

10. **`gate()` komponerer nu OGSÅ begge facit-filers reproducerbarhed fra drafts — sidste blokerende kodegennemgang-punkt (2026-08-13), ikke en bogstavelig instruks.** `tools/voice/check_grammar_assembly.py` (forrige runde) og `tools/voice/check_pairs_assembly.py` (denne runde) beviser hver især at `content/narrator/{grammar,pairs}-act-1.json` er byte-for-byte reproducerbare fra deres egne drafts under `content/narrator/drafts/`. Begge var tidligere kun selvstændigt kørbare filer — kodegennemgang påpegede at et menneske der glemmer at køre dem separat efterlader præcis det hul der tidligere lod grammatikkens facit gå ud af trit med sine drafts. Begge er nu refaktoreret til et importerbart kerneindgangspunkt (`check_grammar_assembly(real_out=...)`/`check_pairs_assembly(real_out=...)` → liste af problemer, tom = bestået) som `gate()` kalder direkte, FØR den dømmer noget indhold — bevist ved to niveauer i `judge.py`'s selftest: kontrolfunktionen alene, og den FULDE `gate()`, fanger begge et bevidst injiceret, afdrevet facit via en midlertidig sti (aldrig det rigtige indhold). Samtidig blev `hardCap`/`overHardCap` fjernet fra det frosne par-ordtalsbånd (`pairs_baseline.json`, version 1→2, se "Frosset ordtal-bånd" ovenfor) — de beskriver et 32-ords GENERATOR-loft (grammatik) som bagte par aldrig har haft; deres reelle grænse er check_pairs.py's 320-tegns kontrakt. Ingen af fordelingstallene (mean/median/stdev/percentiler) ændrede sig ved fjernelsen, kun de to meningsløse nøgler forsvandt.

## Wiring into validate

`tools/validate.py` ejes af en anden agent lige nu og røres ikke her. Sådan kobles stemmedommeren ind, når den anden agents arbejde er flettet — indsæt lige før den afsluttende rapportering (før `for note in notes:` nederst i `main()`, efter tjekket af "Flags der kræves men aldrig sættes"):

```python
    # Stemmedommer (tools/voice/) — TASK-030.
    sys.path.insert(0, str(ROOT / "tools" / "voice"))
    import judge as voice_judge
    for f in voice_judge.gate():
        err(f"stemme: {f}")
```

Fem linjer, ét anker-punkt. `voice_judge.gate()` returnerer allerede menneskelæsbare, danske fejlstrenge (streng pr. kandidat-linje der enten rammer en hård afvisning eller scorer under den kalibrerede tærskel, PLUS en streng pr. facit-fil der ikke er reproducerbar fra sine drafts) — `err()` lægger dem oveni de eksisterende fejl, så `python3 tools/validate.py` fejler (exit 1) hvis stemmedommeren finder noget. `gate()` håndterer selv kilde-sammensætningen internt (se "Politik: kilde-sammensatte gates" ovenfor) — grammatik og bagte par scores hver mod deres egen kontrakt, uden at wiring'en her behøver filtrere labels efter præfiks. Verificeret: `python3 tools/voice/gate.py` slutter med exit 0 på det nuværende indhold (0 grammatik-fejl, 0 par-fejl, begge facit-filer reproducerbare fra drafts), så denne snippet kan indsættes direkte uden at gøre `npm run validate` rød.

---
_Genereret af `python3 tools/voice/calibrate.py`. Regenerér efter enhver ændring i `content/narrator/*.json`, `tools/voice/lexicon.json`, `tools/voice/metrics.py` eller `tools/voice/judge.py`._
