"""Tests for the source adapters.

Runs the three in-scope adapters over the raw fixture envelopes and checks:
  1. every emitted record validates against schema v1.1;
  2. the deterministic fields match the canonical standardized fixture;
  3. the intake gate excludes the internal-speculation control.

Run with ``python tests/test_pipeline.py`` or ``pytest``.
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from feedback_pipeline.adapters import adapt_event, available_sources  # noqa: E402
from feedback_pipeline.runner import run  # noqa: E402
from feedback_pipeline.schema import validate_record  # noqa: E402

RAW = os.path.join(ROOT, "fixtures", "feedback-raw-source-events.json")
CANON = os.path.join(ROOT, "fixtures", "canonical-standardized.json")

# Fields the adapter deterministically derives. ``speaker_provenance`` and
# ``url`` are intentionally excluded: the canonical sample was hand-authored
# and its provenance phrasing / link ids vary in ways the raw payloads cannot
# reconstruct.
COMPARE_FIELDS = [
    ("source", "type"),
    ("source", "native_id"),
    ("source", "occurred_at"),
    ("evidence", "text"),
    ("evidence", "text_kind"),
    ("context", "reported_customer"),
    ("context", "account_id_hint"),
    ("context", "account_match"),
    ("context", "product_hint"),
    ("context", "version"),
    ("context", "version_evidence"),
    ("intake", "eligible_for_classification"),
    ("intake", "exclusion_reason"),
]


def _load(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _dig(record, keys):
    value = record
    for key in keys:
        value = value[key]
    return value


def _adapted():
    raw = _load(RAW)
    return [adapt_event(e) for e in raw["events"] if adapt_event(e) is not None]


def test_all_records_valid():
    records = _adapted()
    assert records, "no records produced"
    for record in records:
        errors = validate_record(record)
        assert not errors, f"{record['id']} invalid: {errors}"


def test_semantic_match_against_canonical():
    canonical = {r["id"]: r for r in _load(CANON)["records"]}
    checked = 0
    for record in _adapted():
        expected = canonical.get(record["id"])
        if expected is None:
            continue
        checked += 1
        for field in COMPARE_FIELDS:
            got = _dig(record, field)
            want = _dig(expected, field)
            assert got == want, f"{record['id']} {field}: got {got!r}, want {want!r}"
    assert checked == 7, f"expected to compare 7 records, compared {checked}"


def test_intake_gate_excludes_speculation():
    by_id = {r["id"]: r for r in _adapted()}
    control = by_id["slack-3002"]
    assert control["intake"]["eligible_for_classification"] is False
    assert control["intake"]["exclusion_reason"] == "internal_speculation_no_customer_report"
    # the linked-customer slack post stays eligible
    assert by_id["slack-3001"]["intake"]["eligible_for_classification"] is True


def test_counts():
    result = run(_load(RAW))
    s = result["summary"]
    assert s["events"] == 12
    assert s["standardized"] == 7
    assert s["eligible"] == 6
    assert s["excluded"] == 1
    assert not s["invalid"]
    # out-of-scope sources are reported, not silently dropped
    assert s["skipped_no_adapter"] == ["salesforce_case"] or "salesforce_case" in s["skipped_no_adapter"]


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    print(f"adapters registered: {', '.join(available_sources())}")
    failures = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except AssertionError as exc:
            failures += 1
            print(f"FAIL {test.__name__}: {exc}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())