#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path

from alfaka.analytics.czardas import Ready, analyze_czardas


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate one exact-240 canonical candle JSON file.")
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    rows = json.loads(args.input.read_text(encoding="utf-8"))
    result = analyze_czardas(rows)
    payload = result.content if isinstance(result, Ready) else {"unavailable": result.reason, "details": result.details}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if args.output:
        args.output.write_text(encoded + "\n", encoding="utf-8")
    else:
        print(encoded)
    return 0 if isinstance(result, Ready) else 2


if __name__ == "__main__":
    raise SystemExit(main())
