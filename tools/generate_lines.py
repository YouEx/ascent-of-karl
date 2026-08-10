#!/usr/bin/env python3
"""AI-førsteudkast til fortæller-varianter (PRD §5: altid håndredigeret bagefter).

Finder replikker med for få varianter og beder en hurtig, gratis sprogmodel om
udkast i fortællerens stemme. Skriver ALDRIG direkte i content/ — udkast lander
i content/narrator/drafts/, hvor skribenten redigerer og selv flytter dem ind.

Anbefalet model (gratis + hurtig, se docs/design/fortaelleren.md):
  1. Groq free tier, `llama-3.3-70b-versatile`  → GROQ_API_KEY
  2. Lokal Ollama, fx `llama3.1:8b`             → --provider ollama (helt gratis/offline)

Kørsel:
  GROQ_API_KEY=... python3 tools/generate_lines.py --act 1 --min 5
  python3 tools/generate_lines.py --act 1 --provider ollama --model llama3.1:8b
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
DRAFTS = CONTENT / "narrator" / "drafts"

VOICE = """You write lines for The Narrator in the game "The Ascent of Karl": a pompous,
sarcastic, theatrical documentary narrator watching Karl, a lovably incompetent
stone-age man, reinvent civilization. The narrator mocks Karl warmly — never
cruel, always laughing WITH the player. Lines are 1-3 sentences, punchy,
present tense, in English. Recurring cast: Karl, a skeptical wild boar,
"Grub Man" (Karl's nickname after eating grubs). Placeholders {a}, {b} and
{element} may appear and will be replaced with element names at runtime —
reuse them only if the sample lines do."""


def call_groq(model: str, prompt: str) -> str:
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        sys.exit("GROQ_API_KEY er ikke sat. Alternativ: --provider ollama (lokal og helt gratis).")
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": VOICE},
            {"role": "user", "content": prompt},
        ],
        "temperature": 1.1,
    }).encode()
    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    return data["choices"][0]["message"]["content"]


def call_ollama(model: str, prompt: str) -> str:
    body = json.dumps({
        "model": model,
        "system": VOICE,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 1.1},
    }).encode()
    req = urllib.request.Request(
        "http://localhost:11434/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        return json.load(resp)["response"]


def draft_variants(provider: str, model: str, line: dict, count: int) -> list[str]:
    samples = "\n".join(f"- {v}" for v in line["variants"])
    prompt = (
        f"Existing variants of the line '{line['id']}':\n{samples}\n\n"
        f"Write {count} NEW variants of the same beat — same meaning and tone, "
        f"fresh wording and fresh jokes. Reply with ONLY a JSON array of strings."
    )
    raw = call_groq(model, prompt) if provider == "groq" else call_ollama(model, prompt)
    start, end = raw.find("["), raw.rfind("]")
    if start == -1 or end == -1:
        raise ValueError(f"Modellen svarede ikke med et JSON-array for '{line['id']}':\n{raw}")
    variants = json.loads(raw[start : end + 1])
    return [v for v in variants if isinstance(v, str) and v.strip()]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--act", type=int, default=1)
    parser.add_argument("--min", type=int, default=5, help="Ønsket antal varianter pr. replik")
    parser.add_argument("--provider", choices=["groq", "ollama"], default="groq")
    parser.add_argument("--model", default=None)
    parser.add_argument("--only", default=None, help="Kun denne replik-id")
    args = parser.parse_args()
    model = args.model or ("llama-3.3-70b-versatile" if args.provider == "groq" else "llama3.1:8b")

    path = CONTENT / "narrator" / f"act-{args.act}.json"
    data = json.loads(path.read_text(encoding="utf-8"))

    drafts: dict[str, list[str]] = {}
    for line in data["lines"]:
        if args.only and line["id"] != args.only:
            continue
        missing = args.min - len(line["variants"])
        if missing <= 0 and not args.only:
            continue
        count = max(missing, 3)
        print(f"→ {line['id']}: genererer {count} udkast ({args.provider}/{model})")
        drafts[line["id"]] = draft_variants(args.provider, model, line, count)

    if not drafts:
        print(f"Alle replikker i akt {args.act} har allerede ≥{args.min} varianter.")
        return 0

    DRAFTS.mkdir(parents=True, exist_ok=True)
    out = DRAFTS / f"act-{args.act}.draft.json"
    out.write_text(json.dumps(drafts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"\n✍️  Udkast skrevet til {out.relative_to(ROOT)}")
    print("Redigér dem i hånden og flyt de gode ind i content/narrator/ — udkast shippes aldrig råt.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
