# Feedback Assistant (backend)

A chatbot for the **assistant page**: PMs ask questions over feedback that has
already been normalized and **classified** by the pipeline (stored in Supabase),
and get cited answers. It uses the **same LLM endpoint OpenCode uses**
(Sciforium → DeepSeek) and logs evals to **Braintrust**.

```
assistant page (Next.js)
        │  POST /assistant/chat  { question, scope, ...filters }
        ▼
assistant_backend  ──►  Supabase (assistant_feedback_view)   [classified feedback]
        │                       ▲
        │                       └── scope toggle filters classification:
        │                            product_only            -> product_feedback
        │                            product_and_quality     -> product_feedback + complaint
        ▼
OpenAI-compatible LLM (Sciforium/DeepSeek)  ──►  cited answer
        │
        ▼
Braintrust evals (assistant_backend/evals)
```

## The Product / Quality toggle

`scope` is sent by the UI and maps to a SQL filter (`scopes.py`):

| scope | `classification` filter |
| --- | --- |
| `product_only` | `product_feedback` |
| `product_and_quality` | `product_feedback`, `complaint` |

So "Product only" narrows the dataset to feature/usability feedback; flipping it
on widens the dataset to include Quality/complaint candidates. The scope is also
written into the prompt so the model stays within it.

Example questions this answers:
- *"What has been the top feedback about sync in the last 7 days?"*
  → `{"question": "...", "scope": "product_only", "days": 7, "keyword": "sync"}`
- *"Anything about false alarms since the last release?"*
  → `{"question": "...", "scope": "product_and_quality", "theme": "false-alarm"}`

## API

`POST /assistant/chat`
```json
{ "question": "...", "scope": "product_only",
  "product": null, "theme": null, "version": null,
  "days": 7, "since": null, "until": null, "keyword": null, "limit": 60 }
```
Response:
```json
{ "answer": "... [zd-2001-c1] ...", "scope": "product_only",
  "citations": ["zd-2001-c1"], "evidence_count": 14,
  "filters": { "scope": "product_only", "classifications": ["product_feedback"], "filters": ["..."] },
  "model": "/deployments/.../DeepSeek-V4.1-Flash" }
```

`GET /assistant/health` → `{ "ok": true }`

## Data model

One flat read view over the pipeline output (see `migrations/assistant_view.sql`):

`assistant_feedback_view(id, classification, route, theme_id, potential_mdr,
priority_subflags, occurred_at, source_type, evidence_text, product_hint,
version, reported_customer, created_at)`

Only `product_feedback` and `complaint` rows are exposed. The backend uses a
**service key**; the browser never queries the view directly.

## Environment

```bash
SUPABASE_URL=...                 # https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...    # server key (read access to the view)
ASSISTANT_TABLE=assistant_feedback_view
SCIFORIUM_API_KEY=...            # same key OpenCode uses
ASSISTANT_LLM_BASE_URL=https://api.sciforium.com/v1
ASSISTANT_LLM_MODEL=/deployments/506a9a37/deepseek-ai/DeepSeek-V4.1-Flash
BRAINTRUST_API_KEY=...           # for evals
BRAINTRUST_PROJECT=test-flight-assistant
```

## Run

```bash
python -m pip install -r requirements.txt

# live API
uvicorn assistant_backend.api:app --port 8000

# ask a question from the CLI
python -m assistant_backend.cli --question "top feedback about sync (7d)" \
  --scope product_only --days 7

# offline demo (no Supabase, no key)
python -m assistant_backend.cli --question "what do users want?" --offline

# tests
python tests/test_assistant.py

# Braintrust evals
python -m assistant_backend.evals.braintrust_eval
```

## Notes

- The core modules use only the Python standard library; `fastapi`/`uvicorn`
  are needed just for the HTTP API, and `braintrust` only for evals.
- `complaint` is a **candidate for human Quality review** — the assistant never
  makes a legal/MDR determination; it only surfaces evidence and flags.
- Retrieval is filter-based (scope + time/product/theme/keyword). Semantic search
  can be layered on later by swapping `retrieval.fetch_evidence`.