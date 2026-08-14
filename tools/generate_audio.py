#!/usr/bin/env python3
"""Batch-TTS af fortællerens replikker (scratch-voice, PRD Step 4).

Genererer én lydfil pr. variant af hver replik og et manifest, som UI'et
bruger til kun at afspille filer der faktisk findes. Varianter med
pladsholdere ({a}, {b}, {element}) springes over — de forbliver tekst-only
(docs/design/fortaelleren.md).

Output:
  public/audio/<replik-id>.v<variant-index>.mp3
  public/audio/manifest.json   → { "<replik-id>": [0, 1, ...] }

Kørsel (kræver `pip install edge-tts` og netadgang):
  python3 tools/generate_audio.py                # alle akter, kun manglende filer
  python3 tools/generate_audio.py --force        # regenerér alt (fx ny stemme)
  python3 tools/generate_audio.py --voice en-GB-ThomasNeural --rate -5%

Stemmen er scratch-voice til playtest — final voice besluttes i Step 4
(menneske eller premium-TTS, afhængigt af playtest).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NARRATOR_DIR = ROOT / "content" / "narrator"
AUDIO_DIR = ROOT / "public" / "audio"

CONCURRENCY = 4
RETRIES = 3

# Hvert lag fortælleren kan sige HØJT står her ved navn. Listen er med vilje
# EKSPLICIT og ikke et glob: et `glob("act-*.json")` udelod i månedsvis hele
# det bagte lag (`pairs-act-1.json`) — 71,2 % af alle møder, altså spillets
# hyppigst hørte replik — uden at nogen kunne se det på koden. Resultatet var,
# at de håndskrevne akt-beats talte med den indspillede stemme, mens hvert
# eneste mislykkede forsøg talte med browserens. Et nyt replik-lag skal
# tilføjes her BEVIDST.
#
# Ikke med, og hvorfor:
#   grammar-act-1.json        alle 312 varianter har {a}/{b} → kan aldrig
#                             indtales på forhånd (se fortaelleren.md).
#   improvisation-act-1.json  samme, og laget er slået fra i produktion.
NARRATOR_SOURCES = ("act-1.json", "act-2.json", "pairs-act-1.json")


def collect_jobs(force: bool) -> tuple[list[tuple[str, int, str, Path]], dict[str, list[int]]]:
    """Find (id, variant-index, tekst, sti) for alle voicebare varianter + fuldt manifest."""
    jobs: list[tuple[str, int, str, Path]] = []
    manifest: dict[str, list[int]] = {}
    for name in NARRATOR_SOURCES:
        path = NARRATOR_DIR / name
        data = json.loads(path.read_text(encoding="utf-8"))
        for line in data["lines"]:
            for i, text in enumerate(line["variants"]):
                if "{" in text:
                    continue  # pladsholder-varianter er tekst-only
                out = AUDIO_DIR / f"{line['id']}.v{i}.mp3"
                manifest.setdefault(line["id"], []).append(i)
                if force or not out.exists() or out.stat().st_size == 0:
                    jobs.append((line["id"], i, text, out))
    return jobs, manifest


async def synth(voice: str, rate: str, pitch: str, jobs) -> list[str]:
    import edge_tts

    sem = asyncio.Semaphore(CONCURRENCY)
    failures: list[str] = []

    async def one(line_id: str, index: int, text: str, out: Path) -> None:
        async with sem:
            for attempt in range(1, RETRIES + 1):
                try:
                    tts = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
                    await tts.save(str(out))
                    if out.stat().st_size == 0:
                        raise RuntimeError("tom fil")
                    print(f"  ✓ {out.name}")
                    return
                except Exception as exc:  # noqa: BLE001 — retry uanset årsag
                    if attempt == RETRIES:
                        failures.append(f"{out.name}: {exc}")
                        out.unlink(missing_ok=True)
                    else:
                        await asyncio.sleep(2 * attempt)

    await asyncio.gather(*(one(*job) for job in jobs))
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice", default="en-GB-RyanNeural", help="Edge TTS-stemme")
    parser.add_argument("--rate", default="-4%", help="Talehastighed, fx -4%%")
    parser.add_argument("--pitch", default="-2Hz", help="Tonehøjde, fx -2Hz")
    parser.add_argument("--force", action="store_true", help="Regenerér også eksisterende filer")
    args = parser.parse_args()

    try:
        import edge_tts  # noqa: F401
    except ImportError:
        sys.exit("edge-tts mangler: pip install edge-tts")

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    jobs, manifest = collect_jobs(args.force)
    total_variants = sum(len(v) for v in manifest.values())
    print(f"{total_variants} voicebare varianter; {len(jobs)} skal genereres ({args.voice})")

    if jobs:
        failures = asyncio.run(synth(args.voice, args.rate, args.pitch, jobs))
        if failures:
            for f in failures:
                print(f"  ✗ {f}")
            print(f"\n{len(failures)} fejlede — kør igen for at forsøge de manglende.")
            # Manifest skrives kun med filer der findes
            manifest = {
                lid: [i for i in idxs if (AUDIO_DIR / f"{lid}.v{i}.mp3").exists()]
                for lid, idxs in manifest.items()
            }
            manifest = {lid: idxs for lid, idxs in manifest.items() if idxs}

    (AUDIO_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    size_mb = sum(f.stat().st_size for f in AUDIO_DIR.glob("*.mp3")) / 1_000_000
    print(f"\n🔊 Manifest: {len(manifest)} replikker, {total_variants} varianter, {size_mb:.1f} MB lyd")
    return 0


if __name__ == "__main__":
    sys.exit(main())
