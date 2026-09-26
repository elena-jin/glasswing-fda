"""PII/PHI screening shared by the assistant (data minimization, not certified
de-identification). Screen evidence text before it reaches the model; fail closed
by flagging ambiguous cases for human review.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict

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
_COMPILED = [(n, re.compile(p, re.I if n in ("identifier", "name") else 0)) for n, p in _PATTERNS]
_AMBIGUOUS_NAME = re.compile(r"\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b")
_ALLOW_NAME = {"United", "New", "North", "South", "San", "Los", "Palo", "Red"}


@dataclass
class ScreenResult:
    screened: str
    detections: Dict[str, int] = field(default_factory=dict)
    needs_human_review: bool = False


def screen_text(text: str) -> ScreenResult:
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