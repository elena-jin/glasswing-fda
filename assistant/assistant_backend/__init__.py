"""Feedback assistant backend.

Raw -> normalized -> classified feedback lives in Supabase. This package lets
the assistant page ask PM questions over that classified feedback, scoped by the
Product/Quality toggle, with citations, plus Braintrust evals.
"""

from .models import ChatRequest, ChatResponse, EvidenceItem, Scope
from .chatbot import FeedbackChatbot
from .config import Config
from .scopes import classifications_for, human_label

__all__ = [
    "ChatRequest",
    "ChatResponse",
    "EvidenceItem",
    "Scope",
    "FeedbackChatbot",
    "Config",
    "classifications_for",
    "human_label",
]