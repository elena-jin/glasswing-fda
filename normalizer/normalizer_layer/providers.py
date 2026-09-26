"""Runtime providers for the AI normalization layer.

Per the architecture, the runtime extraction model is Claude. Providers are
pluggable so the layer runs on:
  * AnthropicProvider      - Claude (Messages API, forced tool use). Default when
                             ANTHROPIC_API_KEY is set.
  * OpenAICompatibleProvider - any OpenAI-compatible chat endpoint (works today
                             via SCIFORIUM_API_KEY / OPENAI_API_KEY).
  * DeterministicProvider  - offline, rule-based fallback (no model call).
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from .prompt import SYSTEM_PROMPT, TOOL_NAME, build_messages, tool_schema


class ProviderError(RuntimeError):
    pass


def _extract_first_json(text: str) -> Dict[str, Any]:
    """Extract the first balanced JSON object from model text.

    Handles plain JSON, ```json fenced blocks, and provider tool-call markup
    (e.g. DeepSeek DSML) that wraps the JSON in tags.
    """
    s = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", s, re.S)
    if fence:
        s = fence.group(1).strip()
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj
    except json.JSONDecodeError:
        pass
    start = s.find("{")
    while start != -1:
        depth = 0
        in_str = False
        esc = False
        for i in range(start, len(s)):
            ch = s[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            else:
                if ch == '"':
                    in_str = True
                elif ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        try:
                            obj = json.loads(s[start:i + 1])
                            if isinstance(obj, dict):
                                return obj
                        except json.JSONDecodeError:
                            pass
                        break
        start = s.find("{", start + 1)
    raise ValueError("no JSON object found in model content")


class Provider:
    name = "provider"

    def normalize(self, report: Dict[str, Any], repair: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        raise NotImplementedError


# --------------------------------------------------------------------------- #
# Model providers
# --------------------------------------------------------------------------- #
class ModelProvider(Provider):
    """Shared prompt handling for LLM-backed providers."""

    def __init__(self, model: str, api_key: str, base_url: Optional[str] = None,
                 timeout: float = 60.0, max_tokens: int = 2048) -> None:
        self.model = model
        self.api_key = api_key
        self.base_url = base_url
        self.timeout = timeout
        self.max_tokens = max_tokens

    def normalize(self, report, repair=None):
        system = SYSTEM_PROMPT
        messages = build_messages(report, repair)
        return self._call(system, messages)


class AnthropicProvider(ModelProvider):
    name = "anthropic"
    DEFAULT_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5")
    DEFAULT_URL = os.getenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None, **kw) -> None:
        api_key = api_key or os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ProviderError("ANTHROPIC_API_KEY is not set")
        super().__init__(model or self.DEFAULT_MODEL, api_key, **kw)

    def _call(self, system: str, messages) -> Dict[str, Any]:
        body = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "system": system,
            "tools": [{
                "name": TOOL_NAME,
                "description": "Emit the standardized classifier-input record.",
                "input_schema": tool_schema(),
            }],
            "tool_choice": {"type": "tool", "name": TOOL_NAME},
            "messages": [{"role": m["role"], "content": m["content"]} for m in messages],
        }
        req = urllib.request.Request(
            f"{self.base_url}/v1/messages",
            data=json.dumps(body).encode(),
            headers={
                "x-api-key": self.api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            method="POST",
        )
        try:
            resp = json.load(urllib.request.urlopen(req, timeout=self.timeout))
        except urllib.error.HTTPError as e:
            raise ProviderError(f"Anthropic API {e.code}: {e.read().decode()[:400]}") from e
        except urllib.error.URLError as e:
            raise ProviderError(f"Anthropic API unreachable: {e}") from e
        for block in resp.get("content", []):
            if block.get("type") == "tool_use" and block.get("name") == TOOL_NAME:
                return block.get("input", {})
        raise ProviderError("Anthropic response had no emit_standard_record tool_use block")


class OpenAICompatibleProvider(ModelProvider):
    name = "openai-compatible"
    DEFAULT_MODEL = os.getenv("OPENAI_MODEL", "deepseek-v4.1-flash")
    DEFAULT_URL = os.getenv("OPENAI_BASE_URL") or os.getenv("SCIFORIUM_BASE_URL") or "https://api.sciforium.com/v1"

    def __init__(self, model: Optional[str] = None, api_key: Optional[str] = None,
                 base_url: Optional[str] = None, **kw) -> None:
        api_key = api_key or os.getenv("OPENAI_API_KEY") or os.getenv("SCIFORIUM_API_KEY")
        if not api_key:
            raise ProviderError("OPENAI_API_KEY / SCIFORIUM_API_KEY is not set")
        super().__init__(model or self.DEFAULT_MODEL, api_key, base_url=base_url or self.DEFAULT_URL, **kw)

    def _call(self, system: str, messages) -> Dict[str, Any]:
        body = {
            "model": self.model,
            "max_tokens": self.max_tokens,
            "messages": [{"role": "system", "content": system}]
            + [{"role": m["role"], "content": m["content"]} for m in messages],
            "tools": [{
                "type": "function",
                "function": {
                    "name": TOOL_NAME,
                    "description": "Emit the standardized classifier-input record.",
                    "parameters": tool_schema(),
                },
            }],
            "tool_choice": {"type": "function", "function": {"name": TOOL_NAME}},
        }
        req = urllib.request.Request(
            f"{self.base_url.rstrip('/')}/chat/completions",
            data=json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            resp = json.load(urllib.request.urlopen(req, timeout=self.timeout))
        except urllib.error.HTTPError as e:
            raise ProviderError(f"OpenAI-compatible API {e.code}: {e.read().decode()[:400]}") from e
        except urllib.error.URLError as e:
            raise ProviderError(f"OpenAI-compatible API unreachable: {e}") from e
        message = (resp.get("choices") or [{}])[0].get("message") or {}
        # 1. Standard OpenAI tool call.
        tool_calls = message.get("tool_calls")
        if tool_calls:
            try:
                return json.loads(tool_calls[0]["function"]["arguments"])
            except (KeyError, IndexError, TypeError, json.JSONDecodeError) as e:
                raise ProviderError(f"Could not parse tool call arguments: {e}") from e
        # 2. Fallback: several OpenAI-compatible servers (e.g. DeepSeek) return the
        #    call as text content (DSML markup or plain/fenced JSON).
        content = message.get("content") or ""
        if content:
            try:
                return _extract_first_json(content)
            except ValueError as e:
                raise ProviderError(f"No structured output in model content: {e}") from e
        raise ProviderError("Model response contained neither tool_calls nor content")


# --------------------------------------------------------------------------- #
# Deterministic offline fallback
# --------------------------------------------------------------------------- #
_FAILURE = re.compile(
    r"\b(error|fail|failed|failing|won'?t|stopped|stuck|stall|sync|drop|dropped|"
    r"crash|freeze|froze|alarm|alert|wrong|missing|unavailable|blank|broken|"
    r"incorrect|delay|discrepan|mismatch|leak|wear|never|doesn'?t|didn'?t|isn'?t|"
    r"not working|lost|connect)\b", re.I)
_REQUEST = re.compile(
    r"\b(add|allow|support|integrat|widget|dark mode|font|larger|bigger|reorder|"
    r"pin|export|pdf|localiz|language|notification|suggestion|would be great|"
    r"would love|feature|api|zapier|option|prefer|suggest)\b", re.I)
_PRAISE = re.compile(
    r"\b(best purchase|five stars|5 stars|love it|great app|amazing|awesome|"
    r"changed my life|perfect|thank you|thanks)\b", re.I)
_SPECULATION = re.compile(r"\b(i think|i bet|i reckon|maybe users|probably users|users will)\b", re.I)
_LOGISTICAL = re.compile(r"(screenshot|after the call|reschedule|calendar (link|invite))", re.I)
_BILLING = re.compile(r"\b(auto-?ship|billing|shipping|refund|invoice|payment|order)\b", re.I)
_HOWTO = re.compile(r"^\s*(how|where|what|which|when|who|can i|do i|does|is there)\b", re.I)


def _first(payload: Dict[str, Any], *keys: str) -> Any:
    for k in keys:
        v = payload.get(k)
        if v not in (None, ""):
            return v
    return None


def _iso(value: Any) -> Optional[str]:
    if not value:
        return None
    s = str(value).strip()
    if re.fullmatch(r"\d{8}", s):  # MAUDE YYYYMMDD
        return f"{s[0:4]}-{s[4:6]}-{s[6:8]}T00:00:00Z"
    if re.match(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", s):
        return s if s.endswith("Z") or "+" in s else s + "Z"
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc) \
            .isoformat().replace("+00:00", "Z")
    except ValueError:
        return None


_TENANT = {
    "acct-pine": "Pine Sleep Labs",
    "acct-maple": "Maple Sleep Clinic",
    "acct-cedar": "Cedar Sleep Center",
    "acct-riverbend": "Riverbend Sleep Center",
    "acct-northgate": "Northgate Diabetes Care",
    "acct-aspen": "Aspen Metabolic Clinic",
    "acct-lakeside": "Lakeside Pulmonary",
    "acct-beacon": "Beacon Heart Group",
    "acct-fairview": "Fairview ENT Associates",
}


class DeterministicProvider(Provider):
    """Rule-based fallback: no model call, deterministic field extraction."""

    name = "deterministic"

    def normalize(self, report, repair=None):
        source_type = (report.get("source_type") or report.get("source") or "feedback_mail")
        payload = report.get("raw", report.get("payload", report)) or {}
        extractor = getattr(self, f"_extract_{source_type}", None)
        if extractor is None:
            extractor = self._extract_generic
        record = extractor(source_type, payload)
        record["_source_type"] = source_type
        return record

    # -- per-source extractors -------------------------------------------- #
    def _extract_feedback_mail(self, st, p):
        hint = _first(p, "account_hint", "account_id_hint")
        return self._record(
            st, native=_first(p, "Message-ID", "message_id", "id") or "unknown-message",
            url=_first(p, "url") or "https://mail.example/messages/unknown",
            occurred=_iso(_first(p, "Date", "date", "occurred_at")),
            text=_first(p, "Body", "body", "text") or "",
            speaker="employee recap", kind="staff_note_or_message",
            customer=_first(p, "reported_customer"), hint=hint,
            match="confirmed" if hint else "unverified",
            product=_first(p, "product", "product_name"), version=_first(p, "version", "device_version"),
        )

    def _extract_zendesk_comment(self, st, p):
        tid = p.get("ticket_id", "ticket-unknown"); cid = p.get("comment_id", "comment-1")
        org = _first(p, "organization_external_id", "organization_id")
        ver = _first(p, "version_custom_field", "version")
        end_user = p.get("author_role") == "end_user"
        return self._record(
            st, native=f"{tid}/{cid}",
            url=_first(p, "url") or f"https://support.example/tickets/{str(tid).split('-')[-1]}",
            occurred=_iso(_first(p, "created_at", "timestamp")),
            text=_first(p, "body", "text") or "",
            speaker="customer" if end_user else "support agent",
            kind="customer_quote" if end_user else "staff_note_or_message",
            customer=_TENANT.get(org) if org else None, hint=org,
            match="confirmed" if org else "none",
            product=_first(p, "product_custom_field", "product"), version=ver,
        )

    def _extract_slack_feedback_channel(self, st, p):
        hint = _first(p, "account_hint", "account_id_hint")
        ch = p.get("channel", "CFEEDBACK"); ts = p.get("ts", "")
        return self._record(
            st, native=f"{ch}:{ts}",
            url=_first(p, "url") or f"https://workspace.example/slack/{ch}/{ts}",
            occurred=_iso(_first(p, "event_ts", "timestamp", "ts")),
            text=_first(p, "text", "body") or "",
            speaker="internal speculation" if (not hint and _SPECULATION.search(str(p.get("text", "")))) else "employee recap",
            kind="staff_note_or_message",
            customer=_TENANT.get(hint) if hint else None, hint=hint,
            match="confirmed" if hint else "none",
            product=_first(p, "product"), version=_first(p, "version"),
        )

    def _extract_salesforce_case(self, st, p):
        acct = _first(p, "AccountId", "account_id")
        return self._record(
            st, native=str(_first(p, "Id", "CaseNumber", "case_number") or "CASE-unknown"),
            url=_first(p, "url") or f"https://crm.example/cases/{str(_first(p,'CaseNumber','Id','')).split('-')[-1]}",
            occurred=_iso(_first(p, "CreatedDate", "created_at")),
            text=_first(p, "Description", "description", "Subject") or "",
            speaker="employee paraphrase of customer contact", kind="staff_note_or_message",
            customer=_TENANT.get(acct) if acct else None, hint=acct,
            match="unverified" if acct else "none",
            product=_first(p, "Product__c", "product"), version=_first(p, "AppVersion__c", "version"),
        )

    def _extract_granola_transcript(self, st, p):
        hint = _first(p, "account_hint", "account_id_hint")
        note = _first(p, "note_id", "document_id", "id") or "note-unknown"
        seg = _first(p, "segment_id") or "segment-1"
        return self._record(
            st, native=f"{note}/{seg}",
            url=_first(p, "url", "web_url") or f"https://notes.example/{note}",
            occurred=_iso(_first(p, "start_time", "created_at", "timestamp")),
            text=_first(p, "transcript_text", "notes", "content", "summary") or "",
            speaker="customer on recorded call", kind="transcript_or_chat",
            customer=_TENANT.get(hint) if hint else None, hint=hint,
            match="unverified" if hint else "none",
            product=_first(p, "product"), version=_first(p, "version"),
        )

    def _extract_zoom_transcript(self, st, p):
        return self._extract_zoom(st, p, kind="transcript_or_chat")

    def _extract_zoom_chat(self, st, p):
        return self._extract_zoom(st, p, kind="transcript_or_chat")

    def _extract_zoom(self, st, p, kind):
        hint = _first(p, "account_hint", "account_id_hint")
        meeting = _first(p, "meeting_uuid", "meeting_id", "id") or "meeting-unknown"
        frag = _first(p, "fragment_id", "segment_id") or "0"
        return self._record(
            st, native=f"{meeting}/{frag}",
            url=_first(p, "url", "recording_url") or f"https://video.example/calls/{meeting}",
            occurred=_iso(_first(p, "event_time", "start_time", "timestamp")),
            text=_first(p, "content", "transcript_text", "text") or "",
            speaker=_first(p, "speaker_label", "speaker") or "speaker; identity unverified",
            kind=kind,
            customer=_TENANT.get(hint) if hint else None, hint=hint,
            match="unverified" if hint else "none",
            product=_first(p, "product"), version=_first(p, "version"),
        )

    def _extract_app_store_review(self, st, p):
        hint = _first(p, "account_hint", "account_id_hint")
        ver = _first(p, "version", "app_version")
        return self._record(
            st, native=str(_first(p, "review_id", "id", "native_id") or "review-unknown"),
            url=_first(p, "url") or "https://store.example/reviews/unknown",
            occurred=_iso(_first(p, "date", "occurred_at", "created_at")),
            text=_first(p, "text", "body", "review") or "",
            speaker="app store reviewer; identity unverified", kind="app_store_review_excerpt",
            customer=_TENANT.get(hint) if hint else None, hint=hint,
            match="confirmed" if hint else "unknown",
            product=_first(p, "product", "app"), version=ver,
        )

    def _extract_fda_public_record(self, st, p):
        return self._record(
            st, native=str(_first(p, "mdr_report_key", "report_number", "id") or "maude-unknown"),
            url=_first(p, "query_url", "url") or "",
            occurred=_iso(_first(p, "date_received", "occurred_at")),
            text=_first(p, "narrative", "text", "mdr_text") or "",
            speaker="MAUDE narrative: reporter statement or manufacturer/staff paraphrase",
            kind="fda_public_record_excerpt",
            customer=None, hint=None, match="unknown",
            product=_first(p, "device_brand", "product"), version=None,
            provenance_kind="real_public_maude",
        )

    def _extract_generic(self, st, p):
        return self._record(
            st, native=str(_first(p, "id", "native_id", "message_id") or "unknown"),
            url=_first(p, "url") or "",
            occurred=_iso(_first(p, "occurred_at", "timestamp", "date", "created_at")),
            text=_first(p, "text", "body", "content", "message", "description") or "",
            speaker="unknown source speaker", kind="staff_note_or_message",
            customer=_first(p, "reported_customer"), hint=_first(p, "account_hint"),
            match="unverified" if _first(p, "reported_customer", "account_hint") else "none",
            product=_first(p, "product"), version=_first(p, "version"),
        )

    # -- assembly ---------------------------------------------------------- #
    def _record(self, source_type, *, native, url, occurred, text, speaker, kind,
                customer, hint, match, product, version, provenance_kind=None):
        eligible, reason = self._intake(text, hint)
        return {
            "source": {"type": source_type, "native_id": native, "url": url, "occurred_at": occurred},
            "evidence": {"text": text, "speaker_provenance": speaker, "text_kind": kind},
            "context": {
                "reported_customer": customer, "account_id_hint": hint, "account_match": match,
                "product_hint": product, "version": version,
                "version_evidence": "explicit" if version else "unknown",
            },
            "intake": {"eligible_for_classification": eligible, "exclusion_reason": reason},
            "provenance": {
                "kind": provenance_kind or "synthetic",
                "basis": "Deterministic extraction from raw source envelope",
                "citation": url or None,
            },
        }

    @staticmethod
    def _intake(text, hint):
        t = str(text or "")
        if _LOGISTICAL.search(t):
            return False, "logistical_request_no_feedback"
        if _BILLING.search(t) and not _FAILURE.search(t):
            return False, "billing_shipping_no_product_allegation"
        if _PRAISE.search(t) and not _FAILURE.search(t) and not _REQUEST.search(t):
            return False, "praise_only_no_request_no_allegation"
        if _HOWTO.match(t) and not _FAILURE.search(t) and not _REQUEST.search(t):
            return False, "support_question_no_allegation"
        if not hint and _SPECULATION.search(t):
            return False, "internal_speculation_no_customer_report"
        return True, None


def get_provider(name: Optional[str] = None) -> Provider:
    """Select a provider by name or auto-detect from the environment."""
    name = (name or os.getenv("NORMALIZER_PROVIDER") or "auto").lower()
    if name in ("auto", ""):
        if os.getenv("ANTHROPIC_API_KEY"):
            name = "anthropic"
        elif os.getenv("OPENAI_API_KEY") or os.getenv("SCIFORIUM_API_KEY"):
            name = "openai-compatible"
        else:
            name = "deterministic"
    if name == "anthropic":
        return AnthropicProvider()
    if name in ("openai", "openai-compatible", "openai_compatible"):
        return OpenAICompatibleProvider()
    if name in ("deterministic", "offline", "rules"):
        return DeterministicProvider()
    raise ProviderError(f"Unknown provider '{name}'. Use anthropic | openai-compatible | deterministic.")