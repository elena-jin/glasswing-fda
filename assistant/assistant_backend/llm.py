"""OpenAI-compatible chat client (standard library only).

This talks to the same endpoint OpenCode uses for chat — by default the
Sciforium gateway fronting DeepSeek. Any OpenAI-compatible `/chat/completions`
endpoint works.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional


class LLMError(RuntimeError):
    pass


class ChatModel:
    def __init__(self, base_url: str, api_key: str, model: str, timeout: float = 90.0,
                 temperature: float = 0.2, max_tokens: int = 1200) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.temperature = temperature
        self.max_tokens = max_tokens

    def chat(self, system: str, messages: List[Dict[str, str]]) -> str:
        body: Dict[str, Any] = {
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "messages": [{"role": "system", "content": system}] + messages,
        }
        req = urllib.request.Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise LLMError(f"LLM {e.code}: {e.read().decode()[:400]}") from e
        except urllib.error.URLError as e:
            raise LLMError(f"LLM unreachable: {e}") from e
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as e:
            raise LLMError(f"Unexpected LLM response: {data}") from e