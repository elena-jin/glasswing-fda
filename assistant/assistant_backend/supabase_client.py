"""Minimal Supabase (PostgREST) client using only the standard library.

We hit the REST endpoint directly so the backend has no hard dependency on
`supabase-py`. Point `SUPABASE_URL` at https://<project>.supabase.co and
`SUPABASE_SERVICE_ROLE_KEY` at a server key with read access to the view/table.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Sequence


class SupabaseError(RuntimeError):
    pass


class SupabaseClient:
    def __init__(self, url: str, key: str, table: str = "assistant_feedback_view",
                 timeout: float = 30.0) -> None:
        self.base = url.rstrip("/") + "/rest/v1"
        self.key = key
        self.table = table
        self.timeout = timeout

    def select(
        self,
        filters: Optional[Sequence[str]] = None,
        select: str = "*",
        order: Optional[str] = "occurred_at.desc",
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        params: List[tuple[str, str]] = [("select", select)]
        for f in (filters or []):
            col, _, expr = f.partition("=")
            params.append((col, expr))
        if order:
            params.append(("order", order))
        params.append(("limit", str(limit)))
        url = f"{self.base}/{self.table}?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise SupabaseError(f"Supabase {e.code}: {e.read().decode()[:300]}") from e
        except urllib.error.URLError as e:
            raise SupabaseError(f"Supabase unreachable: {e}") from e


# --- filter helpers (PostgREST operators) --------------------------------- #
def eq(column: str, value: str) -> str:
    return f"{column}=eq.{value}"


def in_(column: str, values: Sequence[str]) -> str:
    joined = ",".join(f'"{v}"' for v in values)
    return f"{column}=in.({joined})"


def gte(column: str, value: str) -> str:
    return f"{column}=gte.{value}"


def lte(column: str, value: str) -> str:
    return f"{column}=lte.{value}"


def ilike(column: str, pattern: str) -> str:
    return f"{column}=ilike.*{pattern}*"