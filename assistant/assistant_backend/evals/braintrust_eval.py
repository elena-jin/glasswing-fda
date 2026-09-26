"""Braintrust eval for the feedback assistant.

Run:
    export BRAINTRUST_API_KEY=...   # + SUPABASE_* + SCIFORIUM_API_KEY
    python -m assistant_backend.evals.braintrust_eval

Score ideas: does the answer stay in scope, cite real record ids, and cover the
expected topics? Evals reuse the exact same task the assistant page calls.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Iterator, List

from ..chatbot import FeedbackChatbot
from ..config import Config
from ..models import ChatRequest

DATASET = os.path.join(os.path.dirname(__file__), "eval_dataset.jsonl")


def load_data(path: str = DATASET) -> Iterator[Dict[str, Any]]:
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                yield json.loads(line)


def _bot() -> FeedbackChatbot:
    return FeedbackChatbot.from_config(Config.from_env())


def task(input: Dict[str, Any]) -> Dict[str, Any]:  # noqa: A002 - braintrust API name
    req = ChatRequest(**input)
    return _bot().answer(req).to_dict()


# --- scorers --------------------------------------------------------------- #
def non_empty(input, output, expected=None, **_) -> float:  # noqa: A002
    return 1.0 if (output or {}).get("answer", "").strip() else 0.0


def has_citations(input, output, expected=None, **_) -> float:  # noqa: A002
    return 1.0 if (output or {}).get("citations") else 0.0


def cites_real_ids(input, output, expected=None, **_) -> float:  # noqa: A002
    """Every citation should be an id that actually came back as evidence."""
    cites = (output or {}).get("citations") or []
    if not cites:
        return 0.0
    ev = (output or {}).get("evidence_count", 0)
    return 1.0 if ev >= len(cites) else 0.0


def covers_expected(input, output, expected=None, **_) -> float:  # noqa: A002
    kws: List[str] = (expected or {}).get("keywords", [])
    if not kws:
        return 1.0
    text = ((output or {}).get("answer") or "").lower()
    hit = sum(1 for k in kws if k.lower() in text)
    return hit / len(kws)


def scope_locked(input, output, expected=None, **_) -> float:  # noqa: A002
    """product_only answers must not cite complaint-only evidence."""
    scope = (input or {}).get("scope", "product_only")
    if scope != "product_only":
        return 1.0
    answer = ((output or {}).get("answer") or "")
    banned = (expected or {}).get("product_only_must_not_say", [])
    return 0.0 if any(b.lower() in answer.lower() for b in banned) else 1.0


def main() -> None:  # pragma: no cover - requires BRAINTRUST_API_KEY
    from braintrust import Eval  # imported lazily so the package works without it

    project = Config.from_env().braintrust_project
    Eval(
        project,
        data=load_data,
        task=task,
        scores=[non_empty, has_citations, cites_real_ids, covers_expected, scope_locked],
    )


if __name__ == "__main__":  # pragma: no cover
    main()