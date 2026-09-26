"""Request/response models and the scope toggle."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


class Scope(str, Enum):
    """Which classified feedback the assistant is allowed to read/answer from.

    This mirrors the UI toggle:

    * PRODUCT_ONLY            -> product_feedback only
    * PRODUCT_AND_QUALITY     -> product_feedback + complaint (Quality review)
    """

    PRODUCT_ONLY = "product_only"
    PRODUCT_AND_QUALITY = "product_and_quality"


@dataclass
class ChatRequest:
    question: str
    scope: Scope = Scope.PRODUCT_ONLY
    # optional narrowing filters (all optional)
    product: Optional[str] = None          # context.product_hint / product_name
    theme: Optional[str] = None            # classification theme_id
    version: Optional[str] = None          # since a released version
    since: Optional[str] = None            # ISO date, e.g. 2026-09-19
    until: Optional[str] = None            # ISO date
    days: Optional[int] = None             # relative window, e.g. 7 -> last 7 days
    keyword: Optional[str] = None          # free-text search over evidence
    limit: int = 60

    def normalized_scope(self) -> Scope:
        if isinstance(self.scope, Scope):
            return self.scope
        try:
            return Scope(str(self.scope))
        except ValueError:
            return Scope.PRODUCT_ONLY


@dataclass
class EvidenceItem:
    id: str
    classification: Optional[str]
    occurred_at: Optional[str]
    product: Optional[str]
    version: Optional[str]
    theme_id: Optional[str]
    source_type: Optional[str]
    text: str
    potential_mdr: Optional[bool] = None
    priority_subflags: List[str] = field(default_factory=list)

    @classmethod
    def from_row(cls, row: Dict[str, Any]) -> "EvidenceItem":
        return cls(
            id=str(row.get("id", "")),
            classification=row.get("classification"),
            occurred_at=row.get("occurred_at") or row.get("created_at"),
            product=row.get("product_hint") or row.get("product_name") or row.get("product"),
            version=row.get("version"),
            theme_id=row.get("theme_id"),
            source_type=row.get("source_type"),
            text=(row.get("evidence_text") or row.get("text") or "").strip(),
            potential_mdr=row.get("potential_mdr"),
            priority_subflags=row.get("priority_subflags") or [],
        )


@dataclass
class ChatResponse:
    answer: str
    scope: Scope
    citations: List[str]
    evidence_count: int
    filters: Dict[str, Any]
    model: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "answer": self.answer,
            "scope": self.scope.value,
            "citations": self.citations,
            "evidence_count": self.evidence_count,
            "filters": self.filters,
            "model": self.model,
        }