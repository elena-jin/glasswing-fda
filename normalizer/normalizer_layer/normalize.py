"""Orchestrator: raw report -> schema-v1.2 record, with validation + one repair."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .providers import Provider, ModelProvider
from .schemas import ACCOUNT_MATCH, SOURCE_TYPES, VERSION_EVIDENCE, validate_record

SCHEMA_VERSION = "1.1"  # record.version stays 1.1; v1.2 is an additive extension


def _derive_id(source_type: str, native_id: Optional[str], text: str) -> str:
    basis = native_id or text or source_type
    digest = hashlib.sha1(basis.encode("utf-8")).hexdigest()[:12]
    return f"{source_type}-{digest}"


def _pick(value: Any, allowed: List[str], default: str) -> str:
    return value if value in allowed else default


def postprocess(report: Dict[str, Any], raw: Dict[str, Any]) -> Dict[str, Any]:
    """Shape a provider's raw output into a valid classifier-input record.

    Fills the fields the model is not responsible for (schema_version, id,
    synthetic) and repairs any missing/▮invalid sub-fields defensively so we never
    emit a structurally broken record.
    """
    declared = report.get("source_type") or report.get("source")
    raw_source = raw.get("source") or {}
    source_type = raw_source.get("type") if raw_source.get("type") in SOURCE_TYPES else declared
    if source_type not in SOURCE_TYPES:
        source_type = "feedback_mail"

    raw_ev = raw.get("evidence") or {}
    raw_ctx = raw.get("context") or {}
    raw_intake = raw.get("intake") or {}
    raw_prov = raw.get("provenance") or {}

    native_id = raw_source.get("native_id") or report.get("native_id") or "unknown"
    text = raw_ev.get("text") or ""
    occurred_at = raw_source.get("occurred_at") or report.get("occurred_at")
    url = raw_source.get("url")
    if url is None:
        url = report.get("url") or ""

    eligible = raw_intake.get("eligible_for_classification")
    if not isinstance(eligible, bool):
        eligible = True
    exclusion_reason = raw_intake.get("exclusion_reason")
    if eligible:
        exclusion_reason = None
    elif not exclusion_reason:
        exclusion_reason = "unspecified_exclusion"

    synthetic = bool(report.get("synthetic", False))
    provenance = {
        "kind": raw_prov.get("kind") or ("synthetic" if synthetic else "verbatim_public_excerpt"),
        "basis": raw_prov.get("basis") or "Normalized by AI layer",
        "citation": raw_prov.get("citation", url or None),
    }
    for extra in ("challenge_category", "evaluation_only", "contrast_pair_id", "redactions"):
        if extra in raw_prov:
            provenance[extra] = raw_prov[extra]

    record: Dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "id": str(report.get("id") or raw.get("id") or _derive_id(source_type, native_id, text)),
        "synthetic": synthetic,
        "source": {
            "type": source_type,
            "native_id": str(native_id),
            "url": url,
            "occurred_at": occurred_at,
        },
        "evidence": {
            "text": text,
            "speaker_provenance": raw_ev.get("speaker_provenance") or "unknown",
            "text_kind": raw_ev.get("text_kind") or "staff_note_or_message",
        },
        "context": {
            "reported_customer": raw_ctx.get("reported_customer"),
            "account_id_hint": raw_ctx.get("account_id_hint"),
            "account_match": _pick(raw_ctx.get("account_match"), ACCOUNT_MATCH, "unknown"),
            "product_hint": raw_ctx.get("product_hint"),
            "version": raw_ctx.get("version"),
            "version_evidence": _pick(raw_ctx.get("version_evidence"), VERSION_EVIDENCE,
                                      "explicit" if raw_ctx.get("version") else "unknown"),
        },
        "intake": {
            "eligible_for_classification": eligible,
            "exclusion_reason": exclusion_reason,
        },
        "provenance": provenance,
    }
    return record


@dataclass
class NormalizedResult:
    record: Dict[str, Any]
    errors: List[str] = field(default_factory=list)
    provider: str = ""
    repaired: bool = False
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return not self.errors and self.error is None


class Normalizer:
    def __init__(self, provider: Provider, max_repair: int = 1) -> None:
        self.provider = provider
        self.max_repair = max_repair if isinstance(provider, ModelProvider) else 0

    def normalize_report(self, report: Dict[str, Any]) -> NormalizedResult:
        try:
            raw = self.provider.normalize(report)
        except Exception as exc:  # provider/network failure
            return NormalizedResult(record={}, provider=self.provider.name, error=str(exc))

        record = postprocess(report, raw)
        errors = validate_record(record)
        repaired = False

        if errors and self.max_repair:
            try:
                raw = self.provider.normalize(report, repair={"previous": raw, "errors": errors})
                record2 = postprocess(report, raw)
                errors2 = validate_record(record2)
                if len(errors2) <= len(errors):
                    record, errors, repaired = record2, errors2, True
            except Exception:
                pass

        return NormalizedResult(record=record, errors=errors,
                                provider=self.provider.name, repaired=repaired)

    def run(self, reports: List[Dict[str, Any]]) -> Dict[str, Any]:
        results = [self.normalize_report(r) for r in reports]
        records = [r.record for r in results if r.record]
        invalid = [{"id": r.record.get("id"), "errors": r.errors}
                   for r in results if r.record and r.errors]
        failed = [{"id": r.record.get("id") if r.record else None, "error": r.error}
                  for r in results if r.error]
        eligible = [x for x in records if x["intake"]["eligible_for_classification"]]
        return {
            "provider": self.provider.name,
            "records": records,
            "summary": {
                "reports": len(reports),
                "standardized": len(records),
                "eligible": len(eligible),
                "excluded": len(records) - len(eligible),
                "repaired": sum(1 for r in results if r.repaired),
                "invalid": invalid,
                "failed": failed,
            },
        }


def run_reports(reports: List[Dict[str, Any]], provider: Optional[Provider] = None) -> Dict[str, Any]:
    from .providers import get_provider

    return Normalizer(provider or get_provider()).run(reports)