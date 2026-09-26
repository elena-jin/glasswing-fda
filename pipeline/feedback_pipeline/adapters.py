"""Source adapters that turn provider-shaped raw events into schema-v1.1
standardized records.

Scope of this stub (task: "Stub 3 source adapters ... emitting standard JSON"):
    * feedback_mail          (support / feedback inbox email)
    * zendesk_comment        (Zendesk-like ticket comment)
    * slack_feedback_channel (Slack-like #customer-feedback post)

Other source types in the fixture set (salesforce_case, granola_transcript,
zoom_transcript, zoom_chat) are intentionally left out of this change; the
registry is pluggable so they drop in later.

Design notes
------------
* ``evidence.text`` is copied verbatim from the source. Adapters never invent a
  customer name or app version: ``version``/``version_evidence`` stay null /
  "unknown" unless the payload states a version explicitly.
* ``account_id_hint`` is a proposed link only; ``account_match`` records how
  strong that link is ("confirmed" when the source supplied a structured org
  id, "unverified" when merely hinted, "none" when absent).
* The intake gate is a deterministic rule set; excluded records keep their raw
  derivation but are flagged ``eligible_for_classification: false`` with an
  ``exclusion_reason``.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from .directory import DEFAULT_PRODUCT, resolve_account

# --- canonical link bases (fixtures use example.* hosts) ---------------------
MAIL_BASE = "https://mail.example"
SUPPORT_BASE = "https://support.example"
SLACK_BASE = "https://workspace.example"


def _trailing_digits(value: Optional[str]) -> str:
    """Pull the trailing number out of an id for building a canonical URL."""
    text = value or ""
    match = re.search(r"(\d+)(?!.*\d)", text)
    if match:
        return match.group(1)
    return re.sub(r"\W+", "-", text).strip("-").lower() or "unknown"


# --- intake gate -------------------------------------------------------------
# First-person speculation with no linked customer is not customer feedback.
_SPECULATION = re.compile(
    r"\b(I think|I bet|I reckon|we should|maybe users|probably users|users will)\b",
    re.IGNORECASE,
)
_LOGISTICAL = re.compile(
    r"(screenshot|send .*after the call|reschedule|calendar (link|invite))",
    re.IGNORECASE,
)


def _intake_decision(record: Dict[str, Any]) -> Dict[str, Any]:
    source_type = record["source"]["type"]
    text = record["evidence"]["text"]
    account_hint = record["context"]["account_id_hint"]

    if source_type == "zoom_chat" and _LOGISTICAL.search(text):
        return {"eligible_for_classification": False,
                "exclusion_reason": "logistical_request_no_feedback"}

    if source_type == "slack_feedback_channel" and account_hint is None \
            and _SPECULATION.search(text):
        return {"eligible_for_classification": False,
                "exclusion_reason": "internal_speculation_no_customer_report"}

    return {"eligible_for_classification": True, "exclusion_reason": None}


def build_record(
    *,
    record_id: str,
    source_type: str,
    native_id: str,
    url: str,
    occurred_at: str,
    text: str,
    speaker_provenance: str,
    text_kind: str,
    reported_customer: Optional[str],
    account_id_hint: Optional[str],
    account_match: str,
    product_hint: Optional[str],
    version: Optional[str],
    version_evidence: str,
    synthetic: bool = True,
    provenance: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    record: Dict[str, Any] = {
        "schema_version": "1.1",
        "id": record_id,
        "synthetic": synthetic,
        "source": {
            "type": source_type,
            "native_id": native_id,
            "url": url,
            "occurred_at": occurred_at,
        },
        "evidence": {
            "text": text,
            "speaker_provenance": speaker_provenance,
            "text_kind": text_kind,
        },
        "context": {
            "reported_customer": reported_customer,
            "account_id_hint": account_id_hint,
            "account_match": account_match,
            "product_hint": product_hint,
            "version": version,
            "version_evidence": version_evidence,
        },
        "intake": {"eligible_for_classification": True, "exclusion_reason": None},
    }
    if synthetic and provenance is None:
        provenance = {
            "kind": "synthetic",
            "basis": "Invented provider-shaped fixture envelope",
            "citation": None,
        }
    if provenance is not None:
        record["provenance"] = provenance
    record["intake"] = _intake_decision(record)
    return record


class Adapter:
    """Base class. Subclasses set ``source_type`` and implement ``adapt``."""

    source_type: str = ""

    def matches(self, event: Dict[str, Any]) -> bool:
        return event.get("source") == self.source_type

    def adapt(self, event: Dict[str, Any]) -> Dict[str, Any]:  # pragma: no cover
        raise NotImplementedError


class FeedbackMailAdapter(Adapter):
    """Support / feedback inbox email (human recap of a customer message)."""

    source_type = "feedback_mail"

    def adapt(self, event: Dict[str, Any]) -> Dict[str, Any]:
        payload = event["payload"]
        message_id = payload.get("Message-ID") or event["fixture_id"]
        account_hint = payload.get("account_hint")
        return build_record(
            record_id=event["fixture_id"],
            source_type=self.source_type,
            native_id=message_id,
            url=f"{MAIL_BASE}/message/{_trailing_digits(message_id)}",
            occurred_at=payload["Date"],
            text=payload.get("Body", ""),
            speaker_provenance="employee recap",
            text_kind="staff_note_or_message",
            reported_customer=payload.get("reported_customer"),
            account_id_hint=account_hint,
            account_match="confirmed" if account_hint else "unverified",
            product_hint=DEFAULT_PRODUCT,
            version=None,
            version_evidence="unknown",
        )


class ZendeskCommentAdapter(Adapter):
    """Zendesk-like ticket comment."""

    source_type = "zendesk_comment"

    def adapt(self, event: Dict[str, Any]) -> Dict[str, Any]:
        payload = event["payload"]
        ticket_id = payload["ticket_id"]
        comment_id = payload["comment_id"]
        org = payload.get("organization_external_id")
        version = payload.get("version_custom_field")
        is_customer = payload.get("author_role") == "end_user"
        return build_record(
            record_id=event["fixture_id"],
            source_type=self.source_type,
            native_id=f"{ticket_id}/{comment_id}",
            url=f"{SUPPORT_BASE}/tickets/{ticket_id.split('-')[-1]}",
            occurred_at=payload["created_at"],
            text=payload.get("body", ""),
            speaker_provenance="customer" if is_customer else "support agent",
            text_kind="customer_quote" if is_customer else "staff_note_or_message",
            reported_customer=resolve_account(org),
            account_id_hint=org,
            account_match="confirmed" if org else "none",
            product_hint=payload.get("product_custom_field") or DEFAULT_PRODUCT,
            version=version,
            version_evidence="explicit" if version else "unknown",
        )


class SlackFeedbackChannelAdapter(Adapter):
    """Slack-like post in a #customer-feedback channel."""

    source_type = "slack_feedback_channel"

    def adapt(self, event: Dict[str, Any]) -> Dict[str, Any]:
        payload = event["payload"]
        account_hint = payload.get("account_hint")
        text = payload.get("text", "")
        speculation = account_hint is None and bool(_SPECULATION.search(text))
        return build_record(
            record_id=event["fixture_id"],
            source_type=self.source_type,
            native_id=f"{payload['channel']}:{payload['ts']}",
            url=f"{SLACK_BASE}/slack/{payload['channel']}/"
                f"{_trailing_digits(event['fixture_id'])}",
            occurred_at=payload["event_ts"],
            text=text,
            speaker_provenance="internal speculation" if speculation else "employee recap",
            text_kind="staff_note_or_message",
            reported_customer=resolve_account(account_hint),
            account_id_hint=account_hint,
            account_match="confirmed" if account_hint else "none",
            product_hint=DEFAULT_PRODUCT,
            version=None,
            version_evidence="unknown",
        )


ADAPTERS: List[Adapter] = [
    FeedbackMailAdapter(),
    ZendeskCommentAdapter(),
    SlackFeedbackChannelAdapter(),
]

_REGISTRY: Dict[str, Adapter] = {adapter.source_type: adapter for adapter in ADAPTERS}


def available_sources() -> List[str]:
    return sorted(_REGISTRY)


def get_adapter(source_type: str) -> Optional[Adapter]:
    return _REGISTRY.get(source_type)


def adapt_event(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Standardize one raw event, or return None if no adapter is registered."""
    adapter = get_adapter(event.get("source"))
    if adapter is None:
        return None
    return adapter.adapt(event)