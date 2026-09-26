"""Configuration for the assistant backend (all values from the environment)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional


def _env(*names: str, default: Optional[str] = None) -> Optional[str]:
    for n in names:
        v = os.getenv(n)
        if v:
            return v
    return default


@dataclass
class Config:
    # Supabase (PostgREST)
    supabase_url: Optional[str]
    supabase_key: Optional[str]
    table: str

    # LLM (OpenAI-compatible; same endpoint OpenCode uses -> Sciforium/DeepSeek)
    llm_base_url: str
    llm_api_key: Optional[str]
    llm_model: str

    # Braintrust evals
    braintrust_api_key: Optional[str]
    braintrust_project: str

    @classmethod
    def from_env(cls) -> "Config":
        return cls(
            supabase_url=_env("SUPABASE_URL"),
            supabase_key=_env("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY", "SUPABASE_ANON_KEY"),
            table=_env("ASSISTANT_TABLE", default="assistant_feedback_view") or "assistant_feedback_view",
            llm_base_url=(_env("ASSISTANT_LLM_BASE_URL", "SCIFORIUM_BASE_URL", "OPENAI_BASE_URL")
                          or "https://api.sciforium.com/v1"),
            llm_api_key=_env("SCIFORIUM_API_KEY", "OPENAI_API_KEY"),
            llm_model=(_env("ASSISTANT_LLM_MODEL", "DEEPSEEK_MODEL", "OPENAI_MODEL")
                       or "/deployments/506a9a37/deepseek-ai/DeepSeek-V4.1-Flash"),
            braintrust_api_key=_env("BRAINTRUST_API_KEY"),
            braintrust_project=_env("BRAINTRUST_PROJECT", default="test-flight-assistant") or "test-flight-assistant",
        )

    def require_supabase(self) -> None:
        if not self.supabase_url or not self.supabase_key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

    def require_llm(self) -> None:
        if not self.llm_api_key:
            raise RuntimeError("SCIFORIUM_API_KEY / OPENAI_API_KEY must be set")