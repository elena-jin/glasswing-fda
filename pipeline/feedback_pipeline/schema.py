"""JSON-schema validation for standardized feedback records (schema v1.1).

Uses jsonschema if a 2020-12 validator is available, otherwise falls back to
Draft7, which covers every keyword this schema uses.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, List

from jsonschema import FormatChecker

try:  # jsonschema >= 4.18
    from jsonschema import Draft202012Validator as _Validator  # type: ignore
except Exception:  # pragma: no cover - older jsonschema
    from jsonschema import Draft7Validator as _Validator  # type: ignore

_SCHEMA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "schema",
    "feedback-classifier-input.schema.v1_1.json",
)

with open(_SCHEMA_PATH, "r", encoding="utf-8") as _fh:
    SCHEMA: Dict[str, Any] = json.load(_fh)

_VALIDATOR = _Validator(SCHEMA, format_checker=FormatChecker())


def validate_record(record: Dict[str, Any]) -> List[str]:
    """Return a list of human-readable validation errors (empty if valid)."""
    errors = sorted(_VALIDATOR.iter_errors(record), key=lambda e: list(e.path))
    out = []
    for err in errors:
        path = "/".join(str(p) for p in err.path) or "<root>"
        out.append(f"{path}: {err.message}")
    return out


def is_valid(record: Dict[str, Any]) -> bool:
    return not validate_record(record)