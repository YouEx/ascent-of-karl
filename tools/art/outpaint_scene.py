"""Udvider titelskærmens maleri til bredformat med Gemini.

Kildepladen er 896x992 — stående. Fylder man en liggende rude med den,
forstørres Karl til det dobbelte, og dalen forsvinder. I stedet males der
mere dal til venstre, så billedet kan `cover`e alt fra 4:3 til ultrabredt
uden at Karl vokser.

Kør: python3 tools/art/outpaint_scene.py [udfil]
"""
import base64, io, json, os, sys, urllib.error, urllib.request
from PIL import Image

REF = "docs/design/reference/title-2026-08-11.webp"
SCENE = (690, 0, 1586, 992)          # malerdelen af referencen
MODEL = "gemini-3-pro-image"

PROMPT = (
    "Extend this painted illustration into an ultra-wide cinematic landscape. "
    "Keep the caveman character EXACTLY as he is: identical face, blond hair and "
    "moustache, fur tunic, same pose sitting on the rock ledge holding the grey "
    "stone, same cliff wall and hanging vines at the right edge, same red ochre "
    "handprints on the cliff. He must stay in the right third of the new wider "
    "image at the same relative size, not enlarged. Paint far more of the same "
    "golden-hour valley to the LEFT: forested hills, a winding river with small "
    "waterfalls, distant mountain ridges, low warm haze, soft sunset clouds, "
    "wildflowers in the foreground. Match the existing palette, brushwork, "
    "lighting direction and soft painterly finish exactly, as one continuous "
    "painting. Absolutely no text, no letters, no logos, no user interface, "
    "no parchment, no frames or borders."
)


def api_key() -> str:
    path = os.path.expanduser("~/.config/gemini-ha.env")
    for line in open(path):
        if line.startswith("GEMINI_API_KEY"):
            return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit(f"ingen nøgle i {path}")


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else "/tmp/scene-wide.png"
    src = Image.open(REF).convert("RGB").crop(SCENE)
    buf = io.BytesIO()
    src.save(buf, "PNG")
    body = {
        "contents": [{"parts": [
            {"inline_data": {"mime_type": "image/png",
                             "data": base64.b64encode(buf.getvalue()).decode()}},
            {"text": PROMPT},
        ]}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": "21:9", "imageSize": "4K"},
        },
    }
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{MODEL}:generateContent?key={api_key()}")
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        res = json.load(urllib.request.urlopen(req, timeout=600))
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"FEJL {exc.code}: {exc.read().decode()[:600]}")
    for part in res["candidates"][0]["content"]["parts"]:
        if "inlineData" in part:
            raw = base64.b64decode(part["inlineData"]["data"])
            open(out, "wb").write(raw)
            print("gemt", out, Image.open(io.BytesIO(raw)).size)
            return
        if "text" in part:
            print("model:", part["text"][:300])
    raise SystemExit("intet billede i svaret")


if __name__ == "__main__":
    main()
