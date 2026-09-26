"""Turn a ChatRequest into a query plan and fetch matching evidence."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .models import ChatRequest, EvidenceItem, Scope
from .scopes import classifications_for
from .supabase_client import SupabaseClient, eq, gte, ilike, in_, lte


@dataclass
class QueryPlan:
    scope: Scope
    classifications: List[str]
    filters: List[str] = field(default_factory=list)
    limit: int = 60

    def describe(self) -> Dict[str, Any]:
        return {"scope": self.scope.value, "classifications": self.classifications,
                "filters": self.filters, "limit": self.limit}


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def resolve_since(req: ChatRequest) -> Optional[str]:
    """Resolve the lower time bound from `since` or `days`."""
    if req.since:
        return req.since
    if req.days is not None and req.days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=req.days)
        return cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    return None


def build_plan(req: ChatRequest) -> QueryPlan:
    scope = req.normalized_scope()
    plan = QueryPlan(scope=scope, classifications=classifications_for(scope), limit=req.limit)
    plan.filters.append(in_("classification", plan.classifications))
    if req.product:
        plan.filters.append(eq("product_hint", req.product))
    if req.theme:
        plan.filters.append(eq("theme_id", req.theme))
    if req.version:
        # "since release" -> treat as the version marker where available
        plan.filters.append(eq("version", req.version))
    since = resolve_since(req)
    if since:
        plan.filters.append(gte("occurred_at", since))
    if req.until:
        plan.filters.append(lte("occurred_at", req.until))
    if req.keyword:
        plan.filters.append(ilike("evidence_text", req.keyword))
    return plan


def fetch_evidence(client: SupabaseClient, plan: QueryPlan) -> List[EvidenceItem]:
    rows = client.select(filters=plan.filters, order="occurred_at.desc", limit=plan.limit)
    return [EvidenceItem.from_row(r) for r in rows]