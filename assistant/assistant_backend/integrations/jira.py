"""Jira integration — the Product handoff action.

Approved **product_feedback** items become a Jira issue (source/evidence case IDs
included, no raw PHI). Uses the Jira Cloud REST API v3 with an API token for the
internal prototype. For a real tenant, use OAuth 2.0 (3LO) and the customer's own
project, per the team API guide.

Guardrails (per "HIPAA and our feedback data"):
- Only **human-approved product items** are sent here (never complaints/MDR).
- Never include sensitive transcript text by default; include case IDs + a
  PII-screened summary/description.
- No secrets in the browser bundle; credentials are server-only env vars.
"""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class JiraConfig:
    base_url: str
    email: str
    api_token: str
    project_key: str
    issue_type: str = "Task"

    @classmethod
    def from_env(cls) -> "JiraConfig":
        def req(*names: str) -> str:
            for n in names:
                v = os.getenv(n)
                if v:
                    return v
            raise RuntimeError(f"Missing required env var: {'/'.join(names)}")
        return cls(
            base_url=req("JIRA_BASE_URL", "ATLASSIAN_BASE_URL").rstrip("/"),
            email=req("JIRA_EMAIL", "ATLASSIAN_EMAIL"),
            api_token=req("JIRA_API_TOKEN", "ATLASSIAN_API_TOKEN"),
            project_key=req("JIRA_PROJECT_KEY"),
            issue_type=os.getenv("JIRA_ISSUE_TYPE", "Task"),
        )

    @classmethod
    def from_env_optional(cls) -> Optional["JiraConfig"]:
        if not (os.getenv("JIRA_BASE_URL") and os.getenv("JIRA_EMAIL") and os.getenv("JIRA_API_TOKEN")):
            return None
        return cls.from_env()


def to_adf(text: str) -> Dict[str, Any]:
    """Convert plain text to an Atlassian Document Format doc (paragraph per line)."""
    content = []
    for line in (text or "").splitlines():
        if line.strip():
            content.append({"type": "paragraph",
                            "content": [{"type": "text", "text": line}]})
    if not content:
        content = [{"type": "paragraph", "content": [{"type": "text", "text": ""}]}]
    return {"type": "doc", "version": 1, "content": content}


class JiraError(RuntimeError):
    pass


class JiraClient:
    def __init__(self, config: JiraConfig, timeout: float = 30.0) -> None:
        self.config = config
        self.timeout = timeout

    # -- transport (override/monkeypatch in tests) ------------------------- #
    def _request(self, method: str, path: str, body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        auth = base64.b64encode(f"{self.config.email}:{self.config.api_token}".encode()).decode()
        req = urllib.request.Request(
            f"{self.config.base_url}{path}",
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json",
                     "Accept": "application/json"},
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            raise JiraError(f"Jira {e.code}: {e.read().decode()[:400]}") from e
        except urllib.error.URLError as e:
            raise JiraError(f"Jira unreachable: {e}") from e

    # -- API --------------------------------------------------------------- #
    def create_issue(
        self,
        summary: str,
        description: str,
        *,
        labels: Optional[List[str]] = None,
        case_ids: Optional[List[str]] = None,
        project_key: Optional[str] = None,
        issue_type: Optional[str] = None,
    ) -> Dict[str, str]:
        """Create a Jira issue and return {key, url, id}."""
        from ..screening import screen_text

        summary = screen_text(summary).screened
        description = screen_text(description).screened
        if case_ids:
            description += "\n\nEvidence: " + ", ".join(case_ids)

        fields: Dict[str, Any] = {
            "project": {"key": project_key or self.config.project_key},
            "issuetype": {"name": issue_type or self.config.issue_type},
            "summary": summary,
            "description": to_adf(description),
        }
        if labels:
            fields["labels"] = labels

        result = self._request("POST", "/rest/api/3/issue", {"fields": fields})
        key = result.get("key", "")
        return {"id": str(result.get("id", "")), "key": key,
                "url": f"{self.config.base_url}/browse/{key}"}

    def get_issue(self, key: str) -> Dict[str, Any]:
        return self._request("GET", f"/rest/api/3/issue/{key}?fields=key,summary,status")


def create_product_issue(
    summary: str,
    description: str,
    case_ids: List[str],
    labels: Optional[List[str]] = None,
    config: Optional[JiraConfig] = None,
) -> Optional[Dict[str, str]]:
    """Convenience: create a Product handoff issue if Jira is configured, else return None."""
    config = config or JiraConfig.from_env_optional()
    if config is None:
        return None
    return JiraClient(config).create_issue(
        summary, description, labels=labels or ["test-flight", "product-feedback"],
        case_ids=case_ids,
    )