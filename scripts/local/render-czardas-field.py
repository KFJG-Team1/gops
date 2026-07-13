#!/usr/bin/env python3
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a compact SVG inspection of a Czardas pack Field.")
    parser.add_argument("pack", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    pack = json.loads(args.pack.read_text(encoding="utf-8"))
    field = pack["czardasField"]
    modes = [*field.get("hlineModes", []), *field.get("trendModes", [])]
    rows = []
    for index, mode in enumerate(modes):
        label = f'{mode["role"]} · {mode["modeState"]} · {mode["fieldModeId"][-8:]}'
        rows.append(f'<text x="16" y="{28 + index * 22}" font-size="13">{html.escape(label)}</text>')
    height = max(80, 48 + len(rows) * 22)
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="720" height="{height}" viewBox="0 0 720 {height}"><rect width="100%" height="100%" fill="#10151f"/><g fill="#dce7f7">{"".join(rows)}</g></svg>'
    args.output.write_text(svg, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
