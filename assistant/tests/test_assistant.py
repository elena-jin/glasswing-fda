"""Tests for the assistant backend (offline; no Supabase / no API key needed)."""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

from assistant_backend.chatbot import FeedbackChatbot  # noqa: E402
from assistant_backend.cli import SAMPLE_ROWS, SampleSupabase  # noqa: E402
from assistant_backend.models import ChatRequest, Scope  # noqa: E402
from assistant_backend.retrieval import build_plan, fetch_evidence  # noqa: E402
from assistant_backend.scopes import classifications_for  # noqa: E402


class FakeModel:
    model = "fake"

    def __init__(self, text: str) -> None:
        self.text = text

    def chat(self, system, messages):
        return self.text


def test_scope_mapping():
    assert classifications_for(Scope.PRODUCT_ONLY) == ["product_feedback"]
    assert classifications_for(Scope.PRODUCT_AND_QUALITY) == ["product_feedback", "complaint"]


def test_plan_product_only_filters_complaints_out():
    req = ChatRequest(question="top feedback", scope=Scope.PRODUCT_ONLY)
    plan = build_plan(req)
    cls_filter = next(f for f in plan.filters if f.startswith("classification="))
    assert cls_filter == 'classification=in.("product_feedback")'
    assert "complaint" not in cls_filter


def test_plan_includes_quality_when_toggled():
    req = ChatRequest(question="issues?", scope=Scope.PRODUCT_AND_QUALITY, days=7)
    plan = build_plan(req)
    cls_filter = next(f for f in plan.filters if f.startswith("classification="))
    assert 'complaint' in cls_filter and 'product_feedback' in cls_filter
    assert any(f.startswith("occurred_at=gte.") for f in plan.filters)


def test_plan_keyword_and_product():
    req = ChatRequest(question="sync", scope=Scope.PRODUCT_ONLY,
                      product="SomniLink CPAP app", keyword="sync")
    plan = build_plan(req)
    assert "product_hint=eq.SomniLink CPAP app" in plan.filters
    assert any(f.startswith("evidence_text=ilike.") for f in plan.filters)


def test_fetch_respects_scope():
    client = SampleSupabase(SAMPLE_ROWS)
    product_plan = build_plan(ChatRequest(question="x", scope=Scope.PRODUCT_ONLY))
    quality_plan = build_plan(ChatRequest(question="x", scope=Scope.PRODUCT_AND_QUALITY))
    product_items = fetch_evidence(client, product_plan)  # type: ignore[arg-type]
    quality_items = fetch_evidence(client, quality_plan)  # type: ignore[arg-type]
    assert {i.classification for i in product_items} == {"product_feedback"}
    assert "complaint" in {i.classification for i in quality_items}
    assert len(quality_items) > len(product_items)


def test_chatbot_returns_and_validates_citations():
    bot = FeedbackChatbot(
        supabase=SampleSupabase(SAMPLE_ROWS),  # type: ignore[arg-type]
        model=FakeModel("Users want an upload progress bar [zd-2001-c1]. Also [made-up-id]."),
    )
    resp = bot.answer(ChatRequest(question="what do users want?", scope=Scope.PRODUCT_ONLY))
    assert resp.scope == Scope.PRODUCT_ONLY
    assert resp.evidence_count == 2  # only product_feedback rows in scope
    assert resp.citations == ["zd-2001-c1"]  # unknown id dropped


def test_chatbot_quality_scope_sees_complaints():
    bot = FeedbackChatbot(
        supabase=SampleSupabase(SAMPLE_ROWS),  # type: ignore[arg-type]
        model=FakeModel("False alarms reported [email-5043]."),
    )
    resp = bot.answer(ChatRequest(question="quality issues", scope=Scope.PRODUCT_AND_QUALITY))
    assert resp.evidence_count == 4
    assert "email-5043" in resp.citations


def test_evidence_text_is_screened_for_the_model():
    from assistant_backend.models import EvidenceItem
    from assistant_backend.prompt import build_context

    items = [EvidenceItem(id="case-1", classification="product_feedback", occurred_at=None,
                          product="App", version=None, theme_id=None,
                          source_type="feedback_mail",
                          text="Email me at a@b.com or see https://x/y")]
    ctx = build_context(items)
    assert "a@b.com" not in ctx
    assert "https://x/y" not in ctx
    assert "[EMAIL]" in ctx


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"PASS {t.__name__}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failures}/{len(tests)} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())