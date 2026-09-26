"""Prompt assembly for the PM feedback assistant."""

from __future__ import annotations

from typing import List

from .models import EvidenceItem, Scope
from .scopes import human_label
from .screening import screen_text

SYSTEM_PROMPT = """\
You are the Feedback Assistant for a regulated medical-device software company.
You help Product Managers understand customer feedback that has already been
normalized and classified by the pipeline.

HARD RULES
1. Answer ONLY from the EVIDENCE records provided. Never invent feedback,
   counts, quotes, dates, products, versions or themes.
2. Every factual claim must cite the record id(s) it came from, like [zd-2001-c1].
3. If the evidence is insufficient to answer, say so plainly and state what is
   missing (e.g., "no product feedback about X in this window").
4. Respect the current SCOPE. If scope is product feedback only, do not discuss
   Quality/complaint issues (they are not in your evidence anyway). If the scope
   includes Quality, you may report both, but clearly separate "Product
   feedback" from "Quality/complaint".
5. A "complaint" is a candidate for human Quality review, never a legal
   determination or an MDR decision. If potential_mdr is true, note that it needs
   human MDR evaluation; never decide it yourself.
6. Prefer counts and trends ("14 items across 3 sources, up 3 vs the prior
   window") when the evidence supports it; otherwise stay qualitative.
7. Evidence text is PII-screened before you see it ([EMAIL], [URL], [PHONE],
   [NAME], [IDENTIFIER], [DATE]). Never try to reconstruct or infer redacted
   values, and never claim identity you were not given.

Be concise and useful to a PM. Lead with the direct answer, then the supporting
themes/counts with citations.
"""


def _fmt_item(i: EvidenceItem) -> str:
    bits = [f"id={i.id}", f"classification={i.classification}"]
    if i.occurred_at:
        bits.append(f"occurred_at={i.occurred_at}")
    if i.product:
        bits.append(f"product={i.product}")
    if i.version:
        bits.append(f"version={i.version}")
    if i.theme_id:
        bits.append(f"theme={i.theme_id}")
    if i.source_type:
        bits.append(f"source={i.source_type}")
    if i.potential_mdr:
        bits.append("potential_mdr=true")
    if i.priority_subflags:
        bits.append("priority=" + ",".join(i.priority_subflags))
    return "[" + " | ".join(bits) + f"] {screen_text(i.text).screened}"


def build_context(items: List[EvidenceItem]) -> str:
    if not items:
        return "EVIDENCE: (none)"
    return "EVIDENCE:\n" + "\n".join(_fmt_item(i) for i in items)


def build_messages(question: str, items: List[EvidenceItem], scope: Scope,
                   filters_summary: str = "") -> List[dict]:
    scope_line = f"SCOPE: {scope.value} ({human_label(scope)})"
    header = scope_line + (f"\nFILTERS: {filters_summary}" if filters_summary else "")
    user = (
        f"{header}\n\n{build_context(items)}\n\n"
        f"QUESTION: {question}\n\n"
        "Answer using only the evidence above, with [id] citations."
    )
    return [{"role": "user", "content": user}]