"""Prompt construction for the AI extraction/standardization layer.

The model's only job is EXTRACTION into the classifier-input contract. It does
NOT classify (that is David's classifier) and never fabricates facts.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from .screening import screen_report
from .schemas import (
    ACCOUNT_MATCH,
    EXCLUSION_REASONS,
    PROVENANCE_KINDS,
    SOURCE_TYPES,
    TEXT_KINDS,
    VERSION_EVIDENCE,
)

TOOL_NAME = "emit_standard_record"

SYSTEM_PROMPT = """\
You are the NORMALIZATION layer of an FDA medical-device feedback pipeline.

Your ONLY job is to EXTRACT and STANDARDIZE one raw report into the classifier
input contract. You do NOT decide whether something is legally a complaint, an
MDR, or a QMS record, and you do NOT write labels. A downstream classifier and
human Quality reviewers do that.

HARD RULES
1. NEVER invent facts. If the raw report does not state a product, account,
   version, customer or exact wording, use null (or "UNKNOWN" only where the
   field description says so). Do not guess a version from a date. Do not
   resolve an ambiguous account.
2. evidence.text is the VERBATIM wording from the report. Never summarize,
   rewrite, translate, fix typos, or add context. If the source provides only a
   paraphrase (e.g., a staff note or manufacturer narrative), keep it verbatim
   and record that it is a paraphrase in speaker_provenance.
3. source.native_id is the source's own identifier (ticket/comment id, Slack
   channel:ts, message-id, review id, MAUDE report key, meeting/segment id).
4. occurred_at is ISO 8601 UTC. If the source has no usable timestamp, use null.
5. context.account_match: "confirmed" only when the source supplies a
   structured account/organization id that resolves to a customer; "unverified"
   when there is only a hint or paraphrase; "none" when there is no customer
   link; "unknown" when it cannot be determined.
6. context.version_evidence is "explicit" only when the report literally states
   a version; otherwise "unknown" with version = null.
7. intake.eligible_for_classification: send a report to the classifier only if
   it is customer/user feedback about the product. Exclude at intake (false) and
   give the matching exclusion_reason for: logistics-only requests, internal
   speculation with no customer report, generic praise with no request or
   allegation, billing/shipping with no product allegation, and pure how-to
   support questions. Otherwise eligible = true and exclusion_reason = null.
8. provenance.kind: "synthetic" for invented fixtures; "verbatim_public_excerpt"
   for an exact public excerpt; "paraphrased_public_source" for a paraphrase of
   a public source; "real_public_maude" for a MAUDE narrative. Put the public
   URL in provenance.citation when one exists, else null.

9. The input may already be PII-screened ([EMAIL], [URL], [PHONE], [NAME],
   [IDENTIFIER], [DATE] placeholders). Treat any placeholder as unknown; never
   try to reconstruct, guess, or re-identify a redacted value.

Return the result ONLY by calling the emit_standard_record tool. Do not add
prose, explanations, or extra fields.\
"""


def tool_schema() -> Dict[str, Any]:
    """JSON schema for the model's structured output (source/evidence/context/intake/provenance)."""
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["source", "evidence", "context", "intake", "provenance"],
        "properties": {
            "source": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "native_id", "url", "occurred_at"],
                "properties": {
                    "type": {"type": "string", "enum": SOURCE_TYPES},
                    "native_id": {"type": "string"},
                    "url": {"type": ["string", "null"]},
                    "occurred_at": {
                        "type": ["string", "null"],
                        "description": "ISO 8601 UTC or null if unknown",
                    },
                },
            },
            "evidence": {
                "type": "object",
                "additionalProperties": False,
                "required": ["text", "speaker_provenance", "text_kind"],
                "properties": {
                    "text": {"type": "string"},
                    "speaker_provenance": {"type": "string"},
                    "text_kind": {"type": "string", "enum": TEXT_KINDS},
                },
            },
            "context": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "reported_customer",
                    "account_id_hint",
                    "account_match",
                    "product_hint",
                    "version",
                    "version_evidence",
                ],
                "properties": {
                    "reported_customer": {"type": ["string", "null"]},
                    "account_id_hint": {"type": ["string", "null"]},
                    "account_match": {"type": "string", "enum": ACCOUNT_MATCH},
                    "product_hint": {"type": ["string", "null"]},
                    "version": {"type": ["string", "null"]},
                    "version_evidence": {"type": "string", "enum": VERSION_EVIDENCE},
                },
            },
            "intake": {
                "type": "object",
                "additionalProperties": False,
                "required": ["eligible_for_classification", "exclusion_reason"],
                "properties": {
                    "eligible_for_classification": {"type": "boolean"},
                    "exclusion_reason": {
                        "type": ["string", "null"],
                        "enum": EXCLUSION_REASONS + [None],
                    },
                },
            },
            "provenance": {
                "type": "object",
                "additionalProperties": False,
                "required": ["kind", "basis", "citation"],
                "properties": {
                    "kind": {"type": "string", "enum": PROVENANCE_KINDS},
                    "basis": {"type": "string"},
                    "citation": {"type": ["string", "null"]},
                },
            },
        },
    }


def _user_content(report: Dict[str, Any]) -> str:
    source_type = report.get("source_type") or report.get("source") or "feedback_mail"
    raw = report.get("raw", report.get("payload", {}))
    return (
        "Standardize this raw report.\n\n"
        f"source_type: {source_type}\n"
        f"report_id (use as-is if present for reference): {report.get('id')}\n\n"
        "raw report JSON:\n"
        "```json\n" + json.dumps(raw, ensure_ascii=False, indent=2)[:120000] + "\n```"
    )


def build_messages(
    report: Dict[str, Any], repair: Optional[Dict[str, Any]] = None, screen: bool = True
) -> List[Dict[str, Any]]:
    """Build the chat messages for one report, optionally with a repair round.

    ``screen=True`` sends only a PII-screened copy of the report to the model:
    text identifiers are redacted and identity-bearing keys (url, native_id, …)
    are dropped, so raw/identifying text never reaches the LLM.
    """
    model_report = screen_report(report) if screen else report
    messages: List[Dict[str, Any]] = [
        {"role": "user", "content": _user_content(model_report)}
    ]
    if repair:
        messages.append(
            {
                "role": "assistant",
                "content": "Earlier structured output:\n"
                + json.dumps(repair.get("previous", {}), ensure_ascii=False),
            }
        )
        messages.append(
            {
                "role": "user",
                "content": "That output failed schema validation with:\n"
                + "\n".join(f"- {e}" for e in repair.get("errors", []))
                + "\n\nRe-emit a corrected record by calling the tool. Change ONLY "
                "what is needed to satisfy the contract; do not invent facts.",
            }
        )
    return messages