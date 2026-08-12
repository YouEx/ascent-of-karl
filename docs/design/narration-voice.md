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

## Score-fordelinger

`overall` er et uvægtet gennemsnit af 6 dimensioner (ordlængde, sætningstal, ordtal, ordforråd, nutid, tegnsætning), hver scoret 0-1 via intervalscoring mod korpusets EGEN spredning (se `judge.py`'s docstring — ikke z-score, fordi flere kanaler er nul-tunge). Håndskrevet er scoret mod sit eget fingeraftryk — cirkulært for punchline-afvisning (se nedenfor), men informativt for selve scorefordelingen.

| korpus | n | min | p1 | p5 | p10 | median | middel | max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Håndskrevet (mod eget fingeraftryk) | 866 | 0.727 | 0.814 | 0.887 | 0.912 | 0.992 | 0.972 | 1.000 |
| Grammatik (ekspanderet) | 312 | 0.738 | 0.883 | 0.912 | 0.941 | 0.999 | 0.982 | 1.000 |
| Bagte par (ekspanderet) | 908 | 0.807 | 0.824 | 0.838 | 0.848 | 0.910 | 0.916 | 1.000 |

## Hårde afvisninger

Pr.-kandidat optælling (én kandidat kan ramme flere kategorier, men tælles kun én gang i "mindst én"). Håndskrevet er UDELADT fra denne tabel med vilje: "genbrugt punchline" ville ramme 100 % af det håndskrevne korpus, fordi punchline-blokeringslisten er bygget FRA det — cirkulært, ikke en reel fejl. `gate()` kører derfor aldrig hårde afvisninger mod det håndskrevne korpus, kun mod grammatik og bagte par.

| korpus | n | mindst én | >3 sætninger | >32 ord | fejlmeddelelse | moderne ordforråd | genbrugt punchline |
|---|---:|---:|---:|---:|---:|---:|---:|
| Grammatik | 312 | 24 (7.7 %) | 16 (5.1 %) | 6 (1.9 %) | 0 (0.0 %) | 0 (0.0 %) | 2 (0.6 %) |
| Bagte par | 908 | 460 (50.7 %) | 34 (3.7 %) | 445 (49.0 %) | 0 (0.0 %) | 0 (0.0 %) | 2 (0.2 %) |

**Bagte par: 445/908 (49.0 %) overskrider det hårde ordloft på 32 ord.** Det er den klart største enkeltstående afvisningsårsag i hele målingen, og den peger på en reel arkitektonisk uoverensstemmelse — se "Uoverensstemmelser med planen" nedenfor.

## Tærskel: valg og begrundelse

Tærsklen er en percentil af det håndskrevne korpus' EGEN scorefordeling — aldrig et ønsketal. Testet ved tre kandidat-percentiler mod det faktiske indhold (tærskel KOMBINERET med hårde afvisninger, dvs. den reelle gate-fejlrate):

| percentil | tærskel | grammatik fejler | bagte par fejler |
|---|---:|---:|---:|
| p1 | 0.8135 | 24/312 (7.7 %) | 460/908 (50.7 %) |
| p5 | 0.8871 | 24/312 (7.7 %) | 464/908 (51.1 %) |
| p10 | 0.9121 | 31/312 (9.9 %) | 488/908 (53.7 %) |

**Valgt: p5 = 0.8871.**

- p1 gør den kontinuerlige score redundant: den fanger 0 kandidater ud over hvad de hårde afvisninger allerede fanger, i BÅDE grammatik og par. En tærskel der aldrig selv fælder nogen dom, tester ikke noget — den er der kun på papiret.
- p10 fanger markant flere (se tabellen), men ved manuel gennemlæsning lyder flere af de EKSTRA kandidater tydeligt som fortælleren selv — de straffes reelt for at ligge i den lange hale mellem korpusets typiske spredning og det hårde 32-ords-loft, ikke fordi de lyder forkerte. Eksempler er navngivet i "De værste eksempler" nedenfor.
- p5 rammer midtimellem: den er ikke redundant, og de ekstra kandidater den fanger (ud over p1/hårde afvisninger) er faktisk mere grænseprægede end p10-mængden. De er navngivet nedenfor som kandidater til `docs/design/human-queue.json` — dommeren behøver ikke have ret i hvert enkelt tilfælde, den skal blot flage billigt til menneskelig kontrol.

## De værste eksempler (det vigtigste output)

### Grammatik — hårde afvisninger (24 stk.)

- **grammar:absurd:g-abs-2#3** — 4 sætninger (grænse 3)
  > Not kin. Not neighbours. Not acquaintances. The stone and the stick are, as far as I can tell, complete strangers.
- **grammar:clash:g-clash-2#2** — 35 ord (grænse 32)
  > He held the stone and the stick together a beat too long, as though fragile might quietly become sharp if nobody looked directly at it. Nobody looked away either. Both stayed exactly what they were.
- **grammar:inert:g-inert-2#3** — 33 ord (grænse 32)
  > Somewhere, the world winced on behalf of the bone. Karl did not notice — he was too busy holding the stone in one hand and the stick in the other, waiting for a sign.
- **grammar:inert:g-inert-6#3** — 33 ord (grænse 32)
  > Nothing in this valley has ever found a use for the bone, and nothing, apparently, plans to start — not with the stone, not with the stick, not with anything else Karl has tried.
- **grammar:inert:g-inert-7#5** — 36 ord (grænse 32)
  > One learns, after enough ages, which objects are going somewhere and which are furniture. The bone settled into the furniture category early, and today's attempt — the stone and the stick — did nothing to move things along.
- **grammar:locked:g-locked-3#0** — genbrugt punchline: "not today"
  > Karl isn't ready for what the stone and the stick become. He will be. Not today.
- **grammar:locked:g-locked-3#4** — 33 ord (grænse 32)
  > Some ideas wait for the right version of their inventor. Karl isn't that version yet, not for the stone and the stick. He's working on it, slowly, the way Karl works on everything.
- **grammar:near-miss:g-nm-2#0** — 4 sætninger (grænse 3)
  > I know exactly what the stone and the stick were missing. The stone did fine. The stick, less so. Beyond that, I am under absolutely no obligation to say.
- **grammar:near-miss:g-nm-2#2** — 4 sætninger (grænse 3)
  > The stone tried. The stick tried. Only the stone found a partner that actually works, and I've met it. The stick will not get an introduction today.
- **grammar:near-miss:g-nm-2#4** — 5 sætninger (grænse 3)
  > The stone and the stick were one substitution away from working. The stone did fine as it stood. The stick needed replacing. Which replacement, though? Sealed lips, I'm afraid.
- **grammar:near-miss:g-nm-2#5** — 5 sætninger (grænse 3)
  > Close enough, from the stone to the stick, that it almost hurt to watch. The stone came so close. The stick ruined it. Almost close enough that I nearly helped. Nearly.
- **grammar:near-miss:g-nm-3#4** — 4 sætninger (grænse 3)
  > Somewhere in this valley sits a piece of matching material — hot, to be precise. The stone tried. The stick tried. Only the stone qualified; the stick only looked the part.

### Grammatik — lavest scorende der IKKE er hård-afvist (12 stk.)

- **grammar:inert:g-inert-5#1** — overall 0.890 (wordLength=0.96, sentenceCount=1.00, wordCount=0.57, vocabulary=1.00, presentTense=1.00, punctuation=0.81)
  > Give him credit: Karl has not yet run out of things to try against the bone — today it was the stone and the stick. He is, however, running out of things.
- **grammar:clash:g-clash-7#0** — overall 0.896 (wordLength=0.38, sentenceCount=1.00, wordCount=1.00, vocabulary=1.00, presentTense=1.00, punctuation=1.00)
  > That's a no, from both the stone and the stick. A polite no. But a no.
- **grammar:plausible:g-plaus-6#1** — overall 0.905 (wordLength=0.49, sentenceCount=1.00, wordCount=1.00, vocabulary=1.00, presentTense=1.00, punctuation=0.94)
  > If I kept a book of ideas that deserved to work, the stone and the stick would be in it.
- **grammar:inert:g-inert-5#5** — overall 0.905 (wordLength=1.00, sentenceCount=1.00, wordCount=0.57, vocabulary=1.00, presentTense=1.00, punctuation=0.86)
  > Some things are late bloomers. After this many attempts — the stone, the stick, and everything before them — the bone looked less like a late bloomer and more like a control group.
- **grammar:clash:g-clash-7#1** — overall 0.911 (wordLength=0.68, sentenceCount=1.00, wordCount=1.00, vocabulary=1.00, presentTense=1.00, punctuation=0.78)
  > The stone and the stick considered it, briefly, and declined — courteously, but completely.
- **grammar:inert:g-inert-3#5** — overall 0.912 (wordLength=1.00, sentenceCount=1.00, wordCount=0.51, vocabulary=1.00, presentTense=1.00, punctuation=0.96)
  > One day, perhaps, the bone will find a calling. It did not happen today, with the stone or the stick or anything else, and I suspect it did not happen yesterday either.
- **grammar:inert:g-inert-6#2** — overall 0.912 (wordLength=1.00, sentenceCount=1.00, wordCount=0.51, vocabulary=1.00, presentTense=1.00, punctuation=0.96)
  > Even the boar, who reacts to almost nothing, looked up when Karl brought out the stone and the stick. Only the bone earned a second glance, and even that glance was unimpressed.
- **grammar:inert:g-inert-2#2** — overall 0.917 (wordLength=0.60, sentenceCount=1.00, wordCount=1.00, vocabulary=1.00, presentTense=1.00, punctuation=0.91)
  > That was a quiet failure. It suits the bone rather well, if I'm honest — and I try to be.
- **grammar:inert:g-inert-3#0** — overall 0.922 (wordLength=1.00, sentenceCount=1.00, wordCount=0.57, vocabulary=1.00, presentTense=1.00, punctuation=0.96)
  > Every object gets a purpose eventually, or so the theory goes. Karl has been waiting on the bone to prove the theory wrong ever since the stone first met the stick.
- **grammar:inert:g-inert-6#5** — overall 0.922 (wordLength=1.00, sentenceCount=1.00, wordCount=0.57, vocabulary=1.00, presentTense=1.00, punctuation=0.96)
  > Somewhere out there, everything has a role to play. Word about a role for the bone has apparently not arrived yet, despite the stone and the stick checking the post daily.
- **grammar:self:g-self-1#2** — overall 0.925 (wordLength=0.57, sentenceCount=1.00, wordCount=1.00, vocabulary=1.00, presentTense=1.00, punctuation=0.98)
  > The stone. Then, unmistakably, the stone again. Nothing about that improves with repetition.
- **grammar:plausible:g-plaus-7#1** — overall 0.927 (wordLength=0.69, sentenceCount=1.00, wordCount=1.00, vocabulary=1.00, presentTense=1.00, punctuation=0.88)
  > Call it what it is: hot. The stone and the stick had every reason to click.

### Bagte par — hårde afvisninger, 12 værste efter ordtal

- **pairs:spydspids+vand:near-miss#0** — 58 ord (grænse 32)
  > Karl dipped the stone-tipped spear into the water and swirled it, half-hoping the point might learn something new from the experience. It came out exactly as sharp, exactly as opinionated, and exactly as dry within a minute. The stone-tipped spear had a use for water that had nothing to do with dipping spears in it.
- **pairs:mudderkage+saft:plausible#0** — 57 ord (grænse 32)
  > Karl poured the berry juice over the mud pie, finishing it the way any proper baker finishes a proper cake. The mud pie soaked it up and turned a shade darker, which is further than most of Karl's meals ever get. Whatever separates a glazed mud pie from an actual dessert, Karl has not yet found it.
- **pairs:mudderbad+sten:near-miss#0** — 57 ord (grænse 32)
  > Karl carried the stone to the edge of the mud bath, half expecting his usual conversation partner to climb in with him. It sank a little, said nothing, the way stones do, and stayed exactly as dry as it started. The mud bath was hoping to get wet today; the stone was never going to be it.
- **pairs:baer+stenspil:inert#1** — 56 ord (grænse 32)
  > There is exactly one rule to boules that Karl consistently loses by, and it has nothing to do with fruit. He rolled a handful of the berries into the circle anyway, hoping the game might quietly change its terms. Ugh has never once looked more personally offended on the game's behalf than at that exact moment.
- **pairs:boomerang+reb:near-miss#0** — 54 ord (grænse 32)
  > Karl tied the rope to the boomerang's tip, on the theory that a thing which already comes back could be persuaded to come back faster. It came back the same speed as always, dragging a length of rope behind it like an afterthought. The boomerang had a knot to be part of somewhere else.
- **pairs:hjul+stenoekse:near-miss#0** — 54 ord (grænse 32)
  > Karl wedged the stone axe's blade against the wheel, hoping to give it something to roll toward. It rolled off in an entirely different direction, the same way it always does, and Karl chased it across the valley for a third time. The wheel had a job that had nothing to do with rolling.
- **pairs:galleri+sten:near-miss#0** — 54 ord (grænse 32)
  > Karl set his stone, the nearest thing he has to a best friend, beside the two paintings in the cave gallery, hoping the count might simply expand to three. It ruined the symmetry, and got nudged back outside the wall within the minute. The cave gallery always mattered more than a spare rock did.
- **pairs:bautasten+stenoekse:near-miss#0** — 54 ord (grænse 32)
  > Karl raised the stone axe toward the standing stone the way he raises it at any rock in need of an edge. Halfway through the swing, something made him stop, and the axe came down against nothing but air. The standing stone earned that hesitation; a monument, it turns out, earns something else entirely.
- **pairs:graes+mudderkage:near-miss#1** — 53 ord (grænse 32)
  > Karl tucked the dry grass beneath the mud pie, hoping today was finally the day something caught fire under one of Karl's meals. The mud stayed cold and wet, the grass stayed bone-dry and unlit, and neither improved the other. The dry grass was owed a rather different kind of attention today.
- **pairs:haandkile+ler:inert#0** — 52 ord (grænse 32)
  > Karl pressed the hand axe flat into the clay, curious whether a tool he trusts with everything could also teach the clay to hold a shape on its own. The clay took the impression and forgot it within the minute. The hand axe went back into his hand exactly as it was.
- **pairs:fisk+graes:plausible#1** — 52 ord (grænse 32)
  > The fish arrived from the river already speared, already raw, and already declared 'sushi' ten thousand years ahead of schedule. The dry grass arrived bone-dry and bored, waiting for a job it has always been suited for. Between the two of them, only the small matter of actual cooking went unresolved.
- **pairs:haandkile+mudder:near-miss#0** — 52 ord (grænse 32)
  > Karl pressed the hand axe into a fresh handful of mud, testing whether an edge could shape something that offers no resistance at all. It slid through without a mark, quietly competent at cutting nothing in particular. The hand axe was waiting for an edge like that; the mud never needed one.

### Bagte par — lavest scorende der IKKE er hård-afvist (12 stk.)

- **pairs:graes+hjul:plausible#0** — overall 0.839 (wordLength=1.00, sentenceCount=1.00, wordCount=0.64, vocabulary=0.43, presentTense=1.00, punctuation=0.97)
  > Karl packed dry grass around the wheel's rim, presumably for cushioning, presumably for a smoother ride. The wheel rolled once and left the grass behind entirely, still folded, still hopeful.
- **pairs:honning+ler:inert#1** — overall 0.851 (wordLength=1.00, sentenceCount=1.00, wordCount=1.00, vocabulary=0.31, presentTense=1.00, punctuation=0.79)
  > Honey heals, clay shapes: two proud little talents that, put together, cancel each other out and produce only a faintly sweet, faintly muddy silence.
- **pairs:ler+saft:plausible#1** — overall 0.871 (wordLength=0.78, sentenceCount=1.00, wordCount=0.51, vocabulary=1.00, presentTense=1.00, punctuation=0.93)
  > Clay is, Karl will admit, much like his relationship with good ideas — soft, promising, rarely finished. The berry juice offered exactly the kind of finishing touch that relationship needed. Nobody finished anything.
- **pairs:dyr+lerfigur:inert#1** — overall 0.882 (wordLength=1.00, sentenceCount=1.00, wordCount=0.57, vocabulary=0.76, presentTense=1.00, punctuation=0.96)
  > The clay figurine's entire career consists of resembling Ugh and gathering dust. Today a wild boar sniffed it, found it wanting, and added its verdict to a long and growing list.
- **pairs:bautasten+fugl:absurd#0** — overall 0.890 (wordLength=0.87, sentenceCount=1.00, wordCount=0.51, vocabulary=1.00, presentTense=1.00, punctuation=0.96)
  > The standing stone means something, probably, though Karl has never worked out what. The bird means nothing by anything it does, and somehow still communicates more clearly than several centuries of monuments.
- **pairs:mursten+saft:clash#1** — overall 0.891 (wordLength=1.00, sentenceCount=1.00, wordCount=0.51, vocabulary=1.00, presentTense=1.00, punctuation=0.83)
  > Dry and wet settled their usual argument fast: the mud brick stayed dry, hard, and entirely itself, while the berry juice pooled uselessly on top and went looking for something more absorbent.
- **pairs:dyr+pind:absurd#0** — overall 0.892 (wordLength=0.80, sentenceCount=1.00, wordCount=1.00, vocabulary=0.61, presentTense=1.00, punctuation=0.94)
  > The wild boar and the stick belong to entirely different orders of existence, and neither seemed especially bothered by the introduction.
- **pairs:graes+sten:near-miss#3** — overall 0.897 (wordLength=1.00, sentenceCount=1.00, wordCount=0.51, vocabulary=1.00, presentTense=1.00, punctuation=0.87)
  > One of these two wanted to turn into something different today: the dry grass, be it the dry grass or the stone. The rest of it stayed grey, dry, and completely unchanged.
- **pairs:lerfigur+sten:inert#1** — overall 0.897 (wordLength=1.00, sentenceCount=1.00, wordCount=0.51, vocabulary=1.00, presentTense=1.00, punctuation=0.87)
  > The stone is Karl's most reliable companion; the clay figurine is Ugh's least flattering portrait. Two old friends of Karl's, in other words, that have never once been friends with each other.
- **pairs:fjer+sten:plausible#1** — overall 0.901 (wordLength=1.00, sentenceCount=1.00, wordCount=0.57, vocabulary=1.00, presentTense=1.00, punctuation=0.83)
  > Karl balanced the feather on top of the stone, which held admirably still, being a stone, while the feather did the one thing feathers do near any breeze at all: leave.
- **pairs:fugl+larver:near-miss#1** — overall 0.901 (wordLength=1.00, sentenceCount=1.00, wordCount=0.51, vocabulary=1.00, presentTense=1.00, punctuation=0.89)
  > Karl held the grubs up toward the bird, confident in the obvious plan. The bird had a better use waiting elsewhere — and it wasn't, Karl will be disappointed to learn, this one.
- **pairs:mudderbad+pind:inert#1** — overall 0.902 (wordLength=1.00, sentenceCount=1.00, wordCount=0.57, vocabulary=0.97, presentTense=1.00, punctuation=0.87)
  > A mud bath wants nothing stirred, whisked, or improved by tools — just Karl, rolling, and a boar's nod of approval. However exceptional, a stick was never on that particular guest list.

### Genbrugte punchlines — alle 4 tilfælde

Til kontekst: 108/819 håndskrevne punchlines er 3 ord eller kortere ("not today", "it is not", …) — med 1220 kandidatlinjer der hver slutter med en kort, almindelig negation, er en vis tilfældig sammenfald på netop DE korte, generiske lukninger statistisk venteligt, ikke nødvendigvis et tegn på at kandidatlinjen er en bevidst genbrug af en specifik joke. Alle fire er navngivet her og bør vurderes af et menneske (se `human-queue.json`):

- **grammar:locked:g-locked-3#0** — genbrugt punchline: "not today"
  > Karl isn't ready for what the stone and the stick become. He will be. Not today.
- **grammar:self:g-self-1#1** — genbrugt punchline: "it is not"
  > The stone met the stone. Karl seems to believe that quantity is a substitute for chemistry. It is not.
- **pairs:hulemaleri+vand:absurd#2** — genbrugt punchline: "it is not"
  > The cave painting is meaning, whatever Karl says it means. The water is just water. He introduced the two as though that difference were a technicality. It is not.
- **pairs:hjul+pind:near-miss#0** — genbrugt punchline: "not that"
  > Karl jammed his finest stick through the wheel to stop it rolling, and the wheel, offended, rolled twice as far. The wheel was supposed to go through there. Not that.

## Uoverensstemmelser med planen

1. **71 vs. 74 vs. 61 håndskrevne replikker.** Planen (TASK-015/027) siger 71. Det virkelige tal afhænger af hvad man tæller: 74 `narratorLine`-referencer i `combos.json`, som peger på kun 61 unikke tekster (flere kombinationer deler samme skrevne replik). Ingen af de tre er forkerte — de svarer bare på forskellige spørgsmål. Fingeraftrykket her bruger et fjerde, bevidst bredere tal (866 varianter over 173 replik-definitioner) — se "Korpus" ovenfor.

2. **Det hårde 32-ords-loft passer ikke til bagte par.** TASK-028's tekst specificerer "over 32 ord" som en generel hård afvisning for "enhver kandidat-replik". Men `tools/check_pairs.py` — den EKSISTERENDE, allerede kørte port for bagte par (TASK-023, ✅ færdig) — håndhæver i stedet et loft på **320 tegn** (`if len(v) > 320`). Alle 908 bagte varianter overholder det loft præcist (målt max: 317 tegn, altså under 320) — de er allerede godkendt af et menneske under TASK-023's gennemgang. Men 320 tegn engelsk prosa svarer typisk til omkring 45-50 ord, markant løsere end stemmedommerens 32-ords-loft. Resultatet: at anvende TASK-028's ordtal-regel bogstaveligt på bagte par giver 445/908 (49.0 %) afvisninger — IKKE fordi replikkerne er dårlige (de er allerede skribent-godkendte), men fordi der findes to forskellige, ikke-forenede længdestandarder for samme indholdstype. Jeg har implementeret reglen bogstaveligt, som opgaven beder om, men anbefaler at et menneske afgør: enten (a) det hårde 32-ords-loft gælder kun grammatik/live-genereret tekst og bagte par undtages (de har deres eget etablerede 320-tegns-loft), eller (b) 32-ords-loftet skal gælde overalt, og de 445 lange par skal redigeres ned. Målt: håndskrevne replikker har median 17 ord (p90 26, max 37); bagte par har median 32 ord (p90 43, max 58) — cirka dobbelt så langt i den typiske replik.

3. **Grammatikkens tag-specialiseringer findes ikke i indholdet.** TASK-020 er markeret ✅ færdig (2026-08-12) og påstår "tag-specialiseringer for de 12 hyppigste `stuff`-par" er skrevet. Men `content/narrator/grammar-act-1.json`'s `grammar`-kort har KUN 7 nøgler — de bare domme (`locked`, `near-miss`, `self`, `inert`, `clash`, `plausible`, `absurd`) — ingen `"dom:stuff+stuff"`- eller `"dom:stuff"`-nøgler overhovedet. `src/narrator/grammar.ts`'s `grammarKeys()` prøver netop disse to mere specifikke nøgleformer FØR den falder tilbage til den bare dom (kildekoden bekræfter formatet: `${verdict}:${pair[0]}+${pair[1]}` og `${verdict}:${stuff}`) — så med indholdet som det er nu, rammer `grammarPool()` ALTID den generiske pulje, uanset hvilke to `stuff`-typer der indgår. Tag-specialiseringen er markeret færdig i planen, men findes ikke i det leverede indhold.

4. **Planen siger "otte domme", koden og indholdet har syv.** TASK-020's tekst nævner "de otte domme" — men `src/core/types.ts`'s `Verdict`-type har netop 7 værdier (`locked`, `near-miss`, `self`, `inert`, `clash`, `plausible`, `absurd`), og `grammar-act-1.json` har konsekvent også kun disse 7. Formentlig en efterladt tekst fra en tidligere designfase snarere end et reelt indholdshul — nævnt for fuldstændighedens skyld, i samme ånd som 71-vs-74-fundet.

5. **Planens bogstavelige eksempelord for "fejlmeddelelses-register" er selv falske positiver.** TASK-028's tekst nævner "cannot", "invalid", "try again" som eksempler. Testet ordret som blokerede enkeltord/-fraser mod alle 866 håndskrevne varianter: "cannot" gav 9 reelle hit i ægte, ikke-fejlmeddelelses-brug ("The pose cannot."), "can't" gav 6, "unable to" gav 1. Ordene er eksempler på REGISTERET (softwarefejl-tonefaldet), ikke en ordret liste der kan slås op som understrenge — en bogstavelig implementering ville have underkendt ægte, godkendt fortæller-tekst. `lexicon.json` bruger i stedet mere specifikke, stadig repræsentative fraser ("please try again", "invalid input/selection", …) der rammer samme register uden falske positiver (verificeret: 0 hit i 866 håndskrevne + 312 grammatik- + 908 par-varianter). Se `_forbiddenConstructionsKommentar` i `lexicon.json`.

6. **"car" er en etableret joke i korpus, ikke et stemmebrud.** Testet som moderne ordforråd, gav "car" 7 hit — men alle i en gentaget, tilsigtet anakronisme-joke (`story-flintmobil`, `mem-bilist`, `story-drive-in`: Karl opfinder bilen for tidligt). Fjernet fra `modernVocabulary`; øvrige moderne tech-ord (tv, mikroovn, internet, …) beholdes, da de ikke har samme etablerede kanon-status.

## Wiring into validate

`tools/validate.py` ejes af en anden agent lige nu og røres ikke her. Sådan kobles stemmedommeren ind, når den anden agents arbejde er flettet — indsæt lige før den afsluttende rapportering (før `for note in notes:` nederst i `main()`, efter tjekket af "Flags der kræves men aldrig sættes"):

```python
    # Stemmedommer (tools/voice/) — TASK-030.
    sys.path.insert(0, str(ROOT / "tools" / "voice"))
    import judge as voice_judge
    for f in voice_judge.gate():
        err(f"stemme: {f}")
```

Fem linjer, ét anker-punkt. `voice_judge.gate()` returnerer allerede menneskelæsbare, danske fejlstrenge (streng pr. kandidat-linje der enten rammer en hård afvisning eller scorer under den kalibrerede tærskel) — `err()` lægger dem oveni de eksisterende fejl, så `python3 tools/validate.py` fejler (exit 1) hvis stemmedommeren finder noget. **Bemærk**: se "Uoverensstemmelser med planen" punkt 2 — hvis 32-ords-loftet ikke skal gælde bagte par, bør wiring'en filtrere `voice_judge.gate()`'s output til kun `grammar:`-præfikserede labels, eller `gate()` bør selv få et flag for det, FØR denne snippet indsættes, ellers vil `npm run validate` gå rødt på 445 eksisterende, allerede godkendte par-replikker.

---
_Genereret af `python3 tools/voice/calibrate.py`. Regenerér efter enhver ændring i `content/narrator/*.json`, `tools/voice/lexicon.json`, `tools/voice/metrics.py` eller `tools/voice/judge.py`._
