#!/usr/bin/env python3
"""Lille robust screenshot-signatur: 8×8 RGB-blokke, JSON til regressionstest."""

import json
import sys
from PIL import Image


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("usage: screenshot_signature.py <png>")
    image = Image.open(sys.argv[1]).convert("RGB").resize(
        (8, 8),
        Image.Resampling.LANCZOS,
    )
    print(json.dumps([channel for pixel in image.getdata() for channel in pixel]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
