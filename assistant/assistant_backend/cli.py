"""CLI for the feedback assistant.

Live:
    python -m assistant_backend.cli --question "top feedback about sync in the last 7 days" \
        --scope product_and_quality --days 7

Offline demo (no Supabase / no API key), uses sample records + a stub model:
    python -m assistant_backend.cli --question "what are users asking for?" --offline
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any, Dict, List

from .chatbot import FeedbackChatbot
from .config import Config
from .models import ChatRequest, Scope
from .prompt import SYSTEM_PROMPT
from .scopes import human_label

SAMPLE_ROWS: List[Dict[str, Any]] = [
    {"id": "zd-2001-c1", "classification": "product_feedback", "occurred_at": "2026-09-22T15:18:00Z",
     "product_hint": "SomniLink CPAP app", "version": "5.0.0", "theme_id": "upload-stall",
     "source_type": "zendesk_comment", "evidence_text": "Users ask for a progress bar during nightly upload."},
    {"id": "asr-5161", "classification": "product_feedback", "occurred_at": "2026-08-11T13:46:00Z",
     "product_hint": "SomniLink CPAP app", "version": None, "theme_id": "widget-watch",
     "source_type": "app_store_review", "evidence_text": "A widget with the weekly trend sparkline would motivate me."},
    {"id": "email-5043", "classification": "complaint", "occurred_at": "2026-09-20T21:36:00Z",
     "product_hint": "SomniLink CPAP app", "version": None, "theme_id": "false-alarm",
     "source_type": "feedback_mail", "potential_mdr": False, "priority_subflags": ["clinical_risk_without_known_harm"],
     "evidence_text": "I get woken up by false low alerts most nights."},
    {"id": "zd-2003-c1", "classification": "complaint", "occurred_at": "2026-09-25T13:00:00Z",
     "product_hint": "SomniLink CPAP app", "version": None, "theme_id": "status-mismatch",
     "source_type": "zendesk_comment", "potential_mdr": True, "priority_subflags": ["possible_recurrent_harmful_malfunction"],
     "evidence_text": "App said treatment complete but the alarm was still sounding."},
]


class SampleSupabase:
    """Filter-aware in-memory stand-in for offline runs / tests."""

    def __init__(self, rows: List[Dict[str, Any]]) -> None:
        self.rows = rows

    def select(self, filters=None, select: str = "*", order: str | None = None, limit: int = 100):
        rows = list(self.rows)

        def keep(row: Dict[str, Any], f: str) -> bool:
            col, _, expr = f.partition("=")
            op, _, val = expr.partition(".")
            if op == "in":
                allowed = [v.strip('"') for v in val.strip("()").split(",")]
                return str(row.get(col)) in allowed
            if op == "eq":
                return str(row.get(col)) == val
            if op == "gte":
                return str(row.get(col) or "") >= val
            if op == "lte":
                return str(row.get(col) or "") <= val
            if op == "ilike":
                needle = val.strip("*").lower()
                return needle in str(row.get("evidence_text", "")).lower()
            return True

        for f in (filters or []):
            rows = [r for r in rows if keep(r, f)]
        if order == "occurred_at.desc":
            rows.sort(key=lambda r: r.get("occurred_at") or "", reverse=True)
        return rows[:limit]


class StubModel:
    """Deterministic offline 'model': counts evidence and lists top items."""

    model = "stub-extractive"

    def chat(self, system: str, messages: List[Dict[str, str]]) -> str:
        user = messages[-1]["content"]
        ids = re.findall(r"\[id=([^\s|]+)", user)
        lines = re.findall(r"\[id=[^\]]+\]\s*(.+)", user)
        scope = re.search(r"SCOPE:\s*(\S+)", user)
        if not ids:
            return "I don't have any matching feedback in this scope/window."
        top = "\n".join(f"- {t[:100]} [{i}]" for i, t in list(zip(ids, lines))[:5])
        return (f"{len(ids)} matching records in scope {scope.group(1) if scope else '?'}.\n"
                f"Top items:\n{top}")


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Feedback assistant CLI")
    p.add_argument("--question", required=True)
    p.add_argument("--scope", default=Scope.PRODUCT_ONLY.value,
                   choices=[s.value for s in Scope])
    p.add_argument("--product")
    p.add_argument("--theme")
    p.add_argument("--version")
    p.add_argument("--days", type=int)
    p.add_argument("--since")
    p.add_argument("--keyword")
    p.add_argument("--limit", type=int, default=60)
    p.add_argument("--offline", action="store_true")
    args = p.parse_args(argv)

    req = ChatRequest(question=args.question, scope=Scope(args.scope), product=args.product,
                      theme=args.theme, version=args.version, days=args.days, since=args.since,
                      keyword=args.keyword, limit=args.limit)

    cfg = Config.from_env()
    if args.offline or not cfg.supabase_url or not cfg.llm_api_key:
        bot = FeedbackChatbot(SampleSupabase(SAMPLE_ROWS), StubModel())  # type: ignore[arg-type]
        mode = "offline"
    else:
        bot = FeedbackChatbot.from_config(cfg)
        mode = "live"

    resp = bot.answer(req)
    print(f"[{mode}] scope={resp.scope.value} ({human_label(resp.scope)}) "
          f"evidence={resp.evidence_count} filters={json.dumps(resp.filters)}")
    print("-" * 70)
    print(resp.answer)
    if resp.citations:
        print("\ncitations:", ", ".join(resp.citations))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())