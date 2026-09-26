"""Deterministic PII/PHI screening for the AI boundary.

IMPORTANT — scope and honesty
    This is **data minimization, not certified HIPAA de-identification.** Regex
    scrubbing can miss identifiers and can over-redact. When ambiguity is
    detected we **fail closed** (flag the case for human review). The identified
    original is kept in a server-side `SourceVault` under a **random case id** and
    never goes to the model.

Matches the design in "HIPAA and our feedback data": screen identifiers before
the LLM, keep the original for authorized Quality handling, use random case ids
(not hashes of names/account ids), and never put identifying URLs/ids into model
prompts.
"""

from __future__ import annotations

import copy
import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple

# --- identifier patterns (Safe-Harbor-oriented, heuristic) ----------------- #
_PATTERNS = [
    ("email", r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    ("url", r"https?://[^\s<>)\"']+"),
    ("ssn", r"\b\d{3}-\d{2}-\d{4}\b"),
    ("date", r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}/\d{1,2}/\d{2,4}|"
             r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b"),
    ("identifier", r"\b(?:MRN|SSN|ID|Account|Acct|Device|Serial|UDI|DOB)[:#\s-]{0,2}[A-Z0-9][A-Z0-9-]{3,}\b"),
    ("name", r"\b(?:Mr|Mrs|Ms|Dr|Patient)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?"),
    ("phone", r"(?<!\d)(?:\+?\d[\d\s().-]{7,}\d)(?!\d)"),
]
_COMPILED = [(name, re.compile(rx, re.I if name in ("identifier", "name") else 0))
             for name, rx in _PATTERNS]
_AMBIGUOUS_NAME = re.compile(r"\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b")
_ALLOW_NAME = {"United", "New", "North", "South", "San", "Los", "Palo", "Red"}

# Keys we never send to the model (identity-bearing or reversible).
DENY_KEYS = {
    "url", "permalink", "native_id", "message_id", "message-id", "account_id_hint",
    "accountid", "organization_external_id", "serial", "udi", "contactid",
    "from", "to", "email", "phone", "contact", "subject",
}


@dataclass
class ScreenResult:
    screened: str
    detections: Dict[str, int] = field(default_factory=dict)
    needs_human_review: bool = False

    @property
    def found(self) -> bool:
        return bool(self.detections)


def screen_text(text: str) -> ScreenResult:
    """Redact high-confidence identifiers; flag ambiguous names for human review."""
    if not isinstance(text, str) or not text:
        return ScreenResult("", {}, False)
    out = text
    detections: Dict[str, int] = {}
    for name, rx in _COMPILED:
        def _repl(_m, _n=name):
            detections[_n] = detections.get(_n, 0) + 1
            return f"[{_n.upper()}]"
        out = rx.sub(_repl, out)
    ambiguous = [m.group(0) for m in _AMBIGUOUS_NAME.finditer(out)
                 if m.group(0).split()[0] not in _ALLOW_NAME]
    return ScreenResult(out, detections, needs_human_review=bool(ambiguous))


def new_case_id() -> str:
    """Random, opaque case id (do NOT derive from names/account ids)."""
    return "case-" + uuid.uuid4().hex


def _scrub_obj(obj: Any, det: Dict[str, int]) -> Any:
    if isinstance(obj, dict):
        return {k: ("[REDACTED]" if str(k).lower() in DENY_KEYS else _scrub_obj(v, det))
                for k, v in obj.items()}
    if isinstance(obj, list):
        return [_scrub_obj(x, det) for x in obj]
    if isinstance(obj, str):
        r = screen_text(obj)
        for k, v in r.detections.items():
            det[k] = det.get(k, 0) + v
        return r.screened
    return obj


def screen_payload(payload: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, int], bool]:
    det: Dict[str, int] = {}
    scrubbed = _scrub_obj(copy.deepcopy(payload), det)
    review = any(screen_text(str(v)).needs_human_review for v in _strings(payload))
    return scrubbed, det, review


def _strings(obj: Any):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _strings(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _strings(v)
    elif isinstance(obj, str):
        yield obj


def screen_report(report: Dict[str, Any]) -> Dict[str, Any]:
    """Return a copy of a raw *report* safe to put in a model prompt.

    Text strings are screened and identity-bearing keys (url, native_id, …) are
    dropped/replaced. The original `report` is left untouched.
    """
    r = copy.deepcopy(report)
    payload = report.get("raw", report.get("payload", {}))
    scrubbed, _, _ = screen_payload(payload if isinstance(payload, dict) else {"text": payload})
    r["raw"] = scrubbed
    r.pop("payload", None)
    return r


class SourceVault:
    """Server-side store of identified originals, keyed by random case id.

    Never expose the contents to the model or put them in prompts/logs. In a real
    deployment this is the restricted, access-controlled evidence store with a
    separate token-to-source map.
    """

    def __init__(self) -> None:
        self._items: Dict[str, Dict[str, Any]] = {}

    def put(self, case_id: str, original: Dict[str, Any]) -> str:
        self._items[case_id] = original
        return case_id

    def get(self, case_id: str) -> Optional[Dict[str, Any]]:
        return self._items.get(case_id)

    def __len__(self) -> int:
        return len(self._items)