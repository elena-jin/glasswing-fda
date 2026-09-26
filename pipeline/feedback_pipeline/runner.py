"""CLI: run source adapters over a raw-events file and emit standardized JSON.

Usage:
    python -m feedback_pipeline.runner \
        --input fixtures/feedback-raw-source-events.json \
        --output /tmp/standardized.json

Exits non-zero if any emitted record fails schema validation.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List

from .adapters import adapt_event, available_sources
from .schema import validate_record


def run(raw: Dict[str, Any]) -> Dict[str, Any]:
    events = raw.get("events", [])
    records: List[Dict[str, Any]] = []
    skipped: List[str] = []
    invalid: List[Dict[str, str]] = []

    for event in events:
        record = adapt_event(event)
        if record is None:
            skipped.append(event.get("source", "<unknown>"))
            continue
        errors = validate_record(record)
        if errors:
            invalid.append({"id": record.get("id", "?"), "errors": errors})
        records.append(record)

    eligible = [r for r in records if r["intake"]["eligible_for_classification"]]
    excluded = [r for r in records if not r["intake"]["eligible_for_classification"]]

    return {
        "synthetic": raw.get("synthetic", True),
        "description": "Output of deterministic standardization layer; pass eligible records only to classifier.",
        "records": records,
        "summary": {
            "events": len(events),
            "standardized": len(records),
            "eligible": len(eligible),
            "excluded": len(excluded),
            "skipped_no_adapter": sorted(set(skipped)),
            "invalid": invalid,
        },
    }


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="raw source events JSON")
    parser.add_argument("--output", required=True, help="standardized records JSON")
    args = parser.parse_args(argv)

    with open(args.input, "r", encoding="utf-8") as fh:
        raw = json.load(fh)

    result = run(raw)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    s = result["summary"]
    print(f"adapters: {', '.join(available_sources())}")
    print(f"events={s['events']} standardized={s['standardized']} "
          f"eligible={s['eligible']} excluded={s['excluded']}")
    if s["skipped_no_adapter"]:
        print(f"skipped (no adapter): {', '.join(s['skipped_no_adapter'])}")
    for bad in s["invalid"]:
        print(f"INVALID {bad['id']}: {bad['errors']}", file=sys.stderr)
    return 1 if s["invalid"] else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())