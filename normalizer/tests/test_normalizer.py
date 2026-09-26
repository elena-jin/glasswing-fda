"""Tests for the AI normalization layer.

Run with ``python tests/test_normalizer.py`` or ``pytest``.
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from normalizer_layer.normalize import Normalizer, postprocess  # noqa: E402
from normalizer_layer.providers import DeterministicProvider, ModelProvider  # noqa: E402
from normalizer_layer.schemas import validate_record  # noqa: E402

FIXTURE = os.path.join(ROOT, "fixtures", "sample_raw_reports.json")


def _load_reports():
    with open(FIXTURE, "r", encoding="utf-8") as fh:
        return json.load(fh)["reports"]


class StubProvider(ModelProvider):
    """Model provider with canned outputs for deterministic tests."""

    name = "stub"

    def __init__(self, outputs):
        super().__init__(model="stub", api_key="stub")
        self.outputs = list(outputs)
        self.calls = 0

    def _call(self, system, messages):
        self.calls += 1
        return self.outputs.pop(0)


def _valid_raw(text="The app failed to sync my readings."):
    return {
        "source": {"type": "feedback_mail", "native_id": "m1", "url": None, "occurred_at": None},
        "evidence": {"text": text, "speaker_provenance": "employee recap",
                     "text_kind": "staff_note_or_message"},
        "context": {"reported_customer": None, "account_id_hint": None, "account_match": "none",
                    "product_hint": None, "version": None, "version_evidence": "unknown"},
        "intake": {"eligible_for_classification": True, "exclusion_reason": None},
        "provenance": {"kind": "synthetic", "basis": "b", "citation": None},
    }


def test_all_source_types_standardize_and_validate():
    reports = _load_reports()
    result = Normalizer(DeterministicProvider()).run(reports)
    assert result["summary"]["standardized"] == len(reports), result["summary"]
    assert not result["summary"]["invalid"], result["summary"]["invalid"]
    assert not result["summary"]["failed"]
    types = {r["source"]["type"] for r in result["records"]}
    assert types == {
        "feedback_mail", "zendesk_comment", "slack_feedback_channel", "salesforce_case",
        "granola_transcript", "zoom_transcript", "zoom_chat", "app_store_review",
        "fda_public_record",
    }


def test_null_occurred_at_is_valid():
    record = postprocess({"id": "x", "source_type": "app_store_review"},
                         _valid_raw())
    assert record["source"]["occurred_at"] is None
    assert not validate_record(record), validate_record(record)


def test_intake_gate_excludes_praise_and_speculation():
    det = DeterministicProvider()
    praise = det.normalize({"source_type": "feedback_mail",
                            "raw": {"Body": "Best purchase I've made for my health, honestly.",
                                    "Date": "2026-01-01T00:00:00Z"}})
    assert praise["intake"]["eligible_for_classification"] is False
    assert praise["intake"]["exclusion_reason"] == "praise_only_no_request_no_allegation"

    speculation = det.normalize({"source_type": "slack_feedback_channel",
                                 "raw": {"channel": "CFEEDBACK", "ts": "1.0",
                                         "event_ts": "2026-01-01T00:00:00Z",
                                         "text": "I think users will ask for dark mode soon."}})
    assert speculation["intake"]["eligible_for_classification"] is False
    assert speculation["intake"]["exclusion_reason"] == "internal_speculation_no_customer_report"

    real_bug = det.normalize({"source_type": "zendesk_comment",
                              "raw": {"ticket_id": "ticket-9", "comment_id": "comment-1",
                                      "body": "Readings never upload; sync is stuck at 92%.",
                                      "created_at": "2026-01-01T00:00:00Z",
                                      "author_role": "end_user"}})
    assert real_bug["intake"]["eligible_for_classification"] is True


def test_provider_failure_is_reported_not_crashed():
    class Boom(DeterministicProvider):
        name = "boom"

        def normalize(self, report, repair=None):
            raise RuntimeError("no network")

    result = Normalizer(Boom()).run(_load_reports()[:1])
    assert result["summary"]["standardized"] == 0
    assert result["summary"]["failed"][0]["error"] == "no network"


def test_repair_round_fixes_invalid_model_output():
    bad = _valid_raw(text=123)          # invalid: text must be a string
    good = _valid_raw(text="Fixed verbatim excerpt.")
    provider = StubProvider([bad, good])
    result = Normalizer(provider, max_repair=1).normalize_report(
        {"id": "r1", "source_type": "feedback_mail"})
    assert provider.calls == 2
    assert result.repaired
    assert result.ok, result.errors
    assert result.record["evidence"]["text"] == "Fixed verbatim excerpt."


def test_case_id_is_random_not_derived():
    r = postprocess({"source_type": "feedback_mail"},
                    _valid_raw(text="same text"))
    r2 = postprocess({"source_type": "feedback_mail"},
                     _valid_raw(text="same text"))
    assert r["id"].startswith("case-") and r2["id"].startswith("case-")
    assert r["id"] != r2["id"]  # random case id, not a hash of the text/account


def test_screening_redacts_identifiers_and_drops_identity_keys():
    from normalizer_layer.screening import screen_report, screen_text

    s = screen_text("Email jane.doe@example.com or call +1 415 555 0142 on 2026-03-02. MRN: 88231.")
    assert "[EMAIL]" in s.screened and "[PHONE]" in s.screened and "[DATE]" in s.screened

    rep = screen_report({"source_type": "feedback_mail",
                         "raw": {"url": "https://x/y", "native_id": "acct-1",
                                 "Body": "Contact me at a@b.com"}})
    assert rep["raw"]["url"] == "[REDACTED]"
    assert rep["raw"]["native_id"] == "[REDACTED]"
    assert "[EMAIL]" in rep["raw"]["Body"]


def test_prompt_never_contains_raw_identifiers():
    from normalizer_layer.prompt import build_messages

    msgs = build_messages({"source_type": "feedback_mail",
                           "raw": {"url": "https://secret.example/x",
                                   "Body": "mail me at a@b.com"}})
    content = msgs[0]["content"]
    assert "a@b.com" not in content
    assert "https://secret.example" not in content


def test_extract_json_from_dsml_and_fences():
    from normalizer_layer.providers import _extract_first_json

    dsml = ('<|DSML| invoke name="emit_standard_record">'
            '{"source": {"type": "feedback_mail"}}</|DSML| calls>')
    assert _extract_first_json(dsml)["source"]["type"] == "feedback_mail"
    assert _extract_first_json('```json\n{"a": 1}\n```')["a"] == 1


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
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