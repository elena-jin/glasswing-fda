"""FastAPI surface for the assistant page (guarded import).

POST /assistant/chat  ->  { question, scope, product?, theme?, version?, days?, since?, until?, keyword? }
GET  /assistant/health

Run: uvicorn assistant_backend.api:app --port 8000
"""

from __future__ import annotations

from typing import List, Optional

from .config import Config
from .chatbot import FeedbackChatbot
from .models import ChatRequest, Scope

try:  # pragma: no cover - FastAPI is an optional runtime dependency
    from fastapi import FastAPI
    from pydantic import BaseModel

    app = FastAPI(title="Test Flight Feedback Assistant")

    class ChatBody(BaseModel):
        question: str
        scope: str = Scope.PRODUCT_ONLY.value
        product: Optional[str] = None
        theme: Optional[str] = None
        version: Optional[str] = None
        days: Optional[int] = None
        since: Optional[str] = None
        until: Optional[str] = None
        keyword: Optional[str] = None
        limit: int = 60

    _bot: List[FeedbackChatbot] = []

    def _get_bot() -> FeedbackChatbot:
        if not _bot:
            _bot.append(FeedbackChatbot.from_config(Config.from_env()))
        return _bot[0]

    @app.get("/assistant/health")
    def health() -> dict:
        return {"ok": True}

    @app.post("/assistant/chat")
    def chat(body: ChatBody) -> dict:
        req = ChatRequest(**body.model_dump())
        return _get_bot().answer(req).to_dict()

except Exception:  # pragma: no cover
    app = None  # type: ignore