"""Schema loading, validation, and controlled vocabularies for the AI layer.

The classifier-input contract is the authoritative output shape. We ship v1.1
(team contract) and v1.2 (additive: null ``occurred_at``, ``account_match:
"unknown"``, extended ``provenance.kind``), and validate against v1.2 by
default because real public excerpts require those values.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from jsonschema import FormatChecker

try:  # jsonschema >= 4.18
    from jsonschema import Draft202012Validator as _Validator  # type: ignore
except Exception:  # pragma: no cover
    from jsonschema import Draft7Validator as _Validator  # type: ignore

_HERE = os.path.dirname(os.path.dirname(__file__))
_SCHEMA_DIR = os.path.join(_HERE, "schema")

SOURCE_TYPES: List[str] = [
    "feedback_mail",
    "granola_transcript",
    "salesforce_case",
    "slack_feedback_channel",
    "zendesk_comment",
    "zoom_chat",
    "zoom_transcript",
    "app_store_review",
    "fda_public_record",
]

# Intake-gate exclusion taxonomy (from the labeling rubric / v1.2 boundary set).
EXCLUSION_REASONS: List[str] = [
    "praise_only_no_request_no_allegation",
    "support_question_no_allegation",
    "internal_speculation_no_customer_report",
    "logistical_request_no_feedback",
    "billing_shipping_no_product_allegation",
]

TEXT_KINDS: List[str] = [
    "customer_quote",
    "staff_note_or_message",
    "transcript_or_chat",
    "app_store_review_excerpt",
    "fda_public_record_excerpt",
]

ACCOUNT_MATCH: List[str] = ["confirmed", "unverified", "none", "unknown"]
VERSION_EVIDENCE: List[str] = ["explicit", "unknown"]
PROVENANCE_KINDS: List[str] = [
    "synthetic",
    "paraphrased_public_source",
    "verbatim_public_excerpt",
    "adversarial_synthetic",
    "real_public_maude",
]


def _load(name: str) -> Dict[str, Any]:
    with open(os.path.join(_SCHEMA_DIR, name), "r", encoding="utf-8") as fh:
        return json.load(fh)


SCHEMAS: Dict[str, Dict[str, Any]] = {
    "1.1": _load("feedback-classifier-input.schema.v1_1.json"),
    "1.2": _load("feedback-classifier-input.schema.v1_2.json"),
}

_VALIDATOR = _Validator(SCHEMAS["1.2"], format_checker=FormatChecker())


def validate_record(record: Dict[str, Any]) -> List[str]:
    """Return validation errors for a standardized record ([] if valid)."""
    errors = sorted(_VALIDATOR.iter_errors(record), key=lambda e: list(e.path))
    out = []
    for err in errors:
        path = "/".join(str(p) for p in err.path) or "<root>"
        out.append(f"{path}: {err.message}")
    return out


def is_valid(record: Dict[str, Any]) -> bool:
    return not validate_record(record)