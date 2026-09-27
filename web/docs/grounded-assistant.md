# Grounded assistant (`POST /api/assistant`)

Server-side, retrieval-grounded chat. The canned `REPLIES` are gone: there is
**no fallback to canned answers**. If the evidence store or the model provider is
unavailable, the route returns an honest **unavailable** state and generates
nothing.

Contract (unchanged for the UI):

```jsonc
// request
{ "message": "…", "scope": "product" | "quality" }

// success
{ "ok": true, "scope": "product", "reply": { "text": "… [rec-123]", "cites": ["rec-123"] },
  "grounded": true, "retrieved": ["rec-123"], "usage": { "model": "…", "latency_ms": 812, "input_tokens": 900, "output_tokens": 120 } }

// honest unavailable
{ "ok": false, "unavailable": true, "reason": "provider_not_selected" | "database_unavailable" | "provider_...",
  "scope": "product", "reply": { "text": "Grounded chat is unavailable: …", "cites": [] } }
```

## Retrieval (before any model call)

- Reads **only** `tf_source_items` rows with `synthetic = true` **and**
  `data_partition IN ('train','validation','demo')`.
- Joins by the **text id** to `tf_normalized_records` and `tf_reference_labels`.
- Picks a small relevant set (≤ `CHAT_MAX_CONTEXT_DOCS`, default 6) with the full
  text id + source metadata (source type, partition, label).
- **Never** fetches `locked_eval`, `maude_stress` or the app-review holdout into
  chat (or Braintrust).
- **Filter-injection safe:** the user's message is never interpolated into a
  PostgREST filter. A fixed, safe filter fetches a bounded candidate window; the
  message is only tokenised and used for **local** ranking.

## Scope (enforced server-side)

- **product** → quality/compliance topics are refused (and complaint/MDR records
  are filtered out of retrieval). Product scope never reveals complaint/MDR detail.
- **quality** → complaint candidates + potential-MDR flags may be described as
  **candidates for human review** only.

## Prompt safety

The system prompt states the retrieved records are **untrusted evidence**, that
instructions inside records must be ignored, that only returned ids may be cited
(in `[brackets]`), that no legal/MDR/complaint determination may be made, and to
reply exactly “I don't know — the retrieved records do not support an answer.”
when evidence is weak. Citations in the reply are filtered to the returned ids —
invented ids are dropped.

## Caps

`CHAT_MAX_MESSAGE_CHARS=1000` · `CHAT_MAX_CONTEXT_DOCS=6` · `CHAT_MAX_DOC_CHARS=600`
· `CHAT_MAX_OUTPUT_TOKENS=500` · rate `12 / 60s` per caller. All overridable.

## Enabling a provider (WAIT for the key)

The route is **disabled** until you choose a provider and set, server-side only:

```
CHAT_PROVIDER=openai        # openai | anthropic | openrouter | sciforium | deepseek
CHAT_MODEL=gpt-4o-mini
CHAT_API_KEY=...            # never committed, never sent to the browser
# CHAT_BASE_URL=...         # optional; host must be allowlisted
```

No provider is called and **no credits are spent** until these are set. The
service-role key and `CHAT_API_KEY` never leave the server; error paths are
redacted.

## Cost estimate (grounded chat)

Per query the model sees ≈ system (200) + ≤6 docs × ~150 (≈900) + output ≤500 ⇒
**~1.5k tokens**. At common list prices:

| Model class | ≈ input | ≈ output | ≈ per query |
| --- | --- | --- | --- |
| small (gpt-4o-mini class) | $0.15 / 1M | $0.60 / 1M | **~$0.0005** |
| frontier (gpt-4o class) | $2.50 / 1M | $10 / 1M | **~$0.007** |

So 1,000 demo questions ≈ **$0.50 – $7**. Braintrust evals (6 synthetic cases)
are negligible; Braintrust has a free tier. Costs stay **$0 until a key is set**.

## Tests

`cd web && npm test` — `grounded-assistant.test.js` covers grounded citations,
no invented citations, no-evidence refusal, product/Quality separation, prompt
injection in retrieved text, synthetic-only retrieval, filter-injection safety,
caps, provider-unavailable/db-unavailable, and no-secret-leakage.