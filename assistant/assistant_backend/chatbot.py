"""The assistant: retrieve classified feedback -> answer with the LLM."""

from __future__ import annotations

import json
import re
from typing import List, Optional

from .config import Config
from .llm import ChatModel
from .models import ChatRequest, ChatResponse
from .prompt import SYSTEM_PROMPT, build_messages
from .retrieval import build_plan, fetch_evidence
from .supabase_client import SupabaseClient

_CITE = re.compile(r"\[([A-Za-z0-9._:-]+)\]")


class FeedbackChatbot:
    def __init__(self, supabase: SupabaseClient, model: ChatModel) -> None:
        self.supabase = supabase
        self.model = model

    @classmethod
    def from_config(cls, config: Optional[Config] = None) -> "FeedbackChatbot":
        config = config or Config.from_env()
        config.require_supabase()
        config.require_llm()
        return cls(
            supabase=SupabaseClient(config.supabase_url, config.supabase_key, config.table),
            model=ChatModel(config.llm_base_url, config.llm_api_key, config.llm_model),
        )

    def answer(self, req: ChatRequest) -> ChatResponse:
        plan = build_plan(req)
        items = fetch_evidence(self.supabase, plan)
        messages = build_messages(
            req.question, items, plan.scope,
            filters_summary=json.dumps(plan.describe()),
        )
        answer = self.model.chat(SYSTEM_PROMPT, messages)

        known = {i.id for i in items}
        cited = [c for c in dict.fromkeys(_CITE.findall(answer)) if c in known]

        return ChatResponse(
            answer=answer.strip(),
            scope=plan.scope,
            citations=cited,
            evidence_count=len(items),
            filters=plan.describe(),
            model=getattr(self.model, "model", ""),
        )