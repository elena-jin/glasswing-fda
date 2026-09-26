"""CLI for the AI normalization layer.

    python -m normalizer_layer.runner \
        --input fixtures/sample_raw_reports.json \
        --output /tmp/standardized.json \
        --provider auto        # anthropic | openai-compatible | deterministic

Provider auto-detection: ANTHROPIC_API_KEY -> Claude; else OPENAI_API_KEY /
SCIFORIUM_API_KEY -> OpenAI-compatible; else deterministic offline.

Exits non-zero if any record fails schema validation or a provider call fails.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List

from .normalize import Normalizer
from .providers import get_provider


def _load_reports(path: str) -> List[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if isinstance(data, dict):
        return data.get("reports", data.get("items", []))
    return data


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--provider", default="auto")
    parser.add_argument("--model", default=None)
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--max-repair", type=int, default=1)
    args = parser.parse_args(argv)

    try:
        provider = get_provider(args.provider)
    except Exception:
        provider = None
    if args.model or args.base_url:
        from .providers import AnthropicProvider, OpenAICompatibleProvider

        cls = OpenAICompatibleProvider if provider is None else type(provider)
        if cls is AnthropicProvider:
            provider = AnthropicProvider(model=args.model, api_key=None)
        else:
            provider = OpenAICompatibleProvider(model=args.model, base_url=args.base_url)
    if provider is None:
        provider = get_provider("deterministic")

    reports = _load_reports(args.input)
    result = Normalizer(provider, max_repair=args.max_repair).run(reports)

    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    s = result["summary"]
    print(f"provider={result['provider']}")
    print(f"reports={s['reports']} standardized={s['standardized']} "
          f"eligible={s['eligible']} excluded={s['excluded']} repaired={s['repaired']}")
    for bad in s["invalid"]:
        print(f"INVALID {bad['id']}: {bad['errors']}", file=sys.stderr)
    for fail in s["failed"]:
        print(f"FAILED {fail['id']}: {fail['error']}", file=sys.stderr)
    return 1 if (s["invalid"] or s["failed"]) else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())