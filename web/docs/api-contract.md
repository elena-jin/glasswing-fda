# Test Flight — API contract

All endpoints are Vercel Node serverless functions under `api/`, return JSON,
and are **same-origin by default** (`/api/...`). Every response includes
`ok: boolean`. Errors use `{ ok: false, error: "<code>" }` with the relevant
HTTP status.

The demo functions read the synthetic seed in `data/dataset.json`. Swap the
handler bodies for real services and the frontend does not change, because the
response shapes below are what the UI consumes.

---

## Conventions

- **Records** are the schema v1.1 objects described at the bottom of this file.
- **`data`** is always the payload key the frontend expects. `TF_DATA.apply()`
  merges it over the embedded dataset by key.
- **`bootstrap`** is the only call the frontend makes by default; the rest are
  available for server-side rendering, other clients, or when you wire each
  view to its own request.

---

## Endpoints

### `GET /api/bootstrap`
Everything needed to render every view, in one request.

```json
{ "ok": true, "meta": { "schemaVersion": "1.1", "synthetic": true }, "data": { /* dataset */ } }
```

`data` keys: `sources`, `sourceFeed`, `split`, `trend`, `ideas`, `pods`,
`quality`, `pipeline`, `connectors`, `tech`, `roadmap`, `shipped`, `qms`,
`dests`.

### `GET /api/health`
Liveness + data-status summary (backs the Data status surface).

```json
{ "ok": true, "service": "test-flight-api", "time": "…", "counts": { "ideas": 7, "qualityPending": 6 } }
```

### `GET /api/ideas`
Product-stage ideas (a cross-source feedback cluster with owner + Jira).

| Query     | Effect |
|-----------|--------|
| `pod`     | filter to one pod name |
| `ageDays` | only ideas seen within the last N days |
| `sort`    | `demand` (default) · `priority` · `recent` |
| `id`      | return a single idea with its evidence + Jira fields |

```json
{ "ok": true, "count": 7, "sort": "demand", "pod": null, "data": [ /* ideas */ ] }
```

### `GET /api/quality`
Pending complaint candidates awaiting a human decision.

| Query     | Effect |
|-----------|--------|
| `ageDays` | only candidates seen within the last N days |
| `id`      | a single candidate with its FTA rationale |

```json
{ "ok": true, "count": 6, "potentialMdr": 3, "data": [ /* candidates */ ] }
```

Sort order: highest model confidence first. **Low confidence is shown, never
hidden**, per the brief.

### `POST /api/quality`
Log a reviewer decision. The decision lives in the **approval log**, separate
from the classifier result.

```jsonc
// request
{ "id": "CP-2214", "action": "approve" | "deny" | "skip", "reviewer": "qa.lead", "reason": "optional" }

// response 202
{ "ok": true, "decision": { "id": "CP-2214", "action": "approve", "route": "qms_queue", "decidedAt": "…" },
  "persisted": false, "note": "Stateless demo. Persist decisions and forward approved packets to /api/qms." }
```

`route` is derived: `approve → qms_queue`, `deny → product_feedback`,
`skip → pending`.

> The demo does not persist. In production, write to your datastore here and
> keep `id` + `action` + `reviewer` + `reason` + `timestamp`.

### `GET /api/qms`
Quality platforms, product destinations, tech stack and pipeline health.

```json
{ "ok": true, "providers": [ /* Veeva, MasterControl, … */ ], "destinations": [ /* Jira, CRM, Zendesk */ ],
  "techStack": [ "Zoom", "Google Workspace", … ], "mode": "mock" }
```

### `POST /api/qms`
Export **human-approved** complaint packets to a QMS. This is a **mock** — no
system receives the data.

```jsonc
// request
{ "records": ["appstore-2214", "salesforce-2196"], "provider": "veeva" }

// response 202
{ "ok": true, "provider": "Veeva Vault Quality", "environment": "sandbox",
  "exported": 2, "packets": [ { "packetId": "PKT-…", "object": "complaint__v", "status": "export_mock", "humanApproved": true } ],
  "note": "Mock export. No QMS received this data." }
```

Supported `provider` keys: `veeva`, `mastercontrol`, `greenlight`, `trackwise`,
`compliancequest`. Only `veeva` is seeded as connected/sandbox.

### `POST /api/assistant`
Grounded Q&A over the records.

```jsonc
// request
{ "message": "show me MDR candidates with patient harm", "scope": "product" | "quality" }

// response 200
{ "ok": true, "scope": "quality", "reply": { "text": "…", "cites": ["CP-2208", "CP-2196"] } }
```

**Scope gate:** a quality/compliance question (`mdr|harm|complaint|quality|
compliance`) asked while `scope` is `product` returns the refusal reply and
empty resolution. Only `scope: "quality"` returns MDR/complaint answers. Replace
the deterministic reply table with a real retrieval call over the records, but
keep the `cites` array — the UI renders it and the brief requires every claim to
be traceable.

### `GET /api/sources`
| Query | Effect |
|-------|--------|
| —     | every source with its connector status and volume |
| `id`  | one source + its feedback feed + the ideas built on it |

```json
{ "ok": true, "data": { "source": {…}, "connector": {…}, "feed": [ … ], "ideas": [ … ] } }
```

### `GET /api/integrations`
Everything the Integrations and Data-status surfaces need (QMS, destinations,
tech stack, connectors, pipeline).

### `GET /api/connectors`
Per-connector configuration status. A connector is `live` when its required
environment variables are set, otherwise `synthetic`.

```json
{ "ok": true, "live": ["zoom"], "data": [ { "id": "zoom", "configured": true, "auth": "s2s_oauth", "env": ["ZOOM_ACCOUNT_ID", "…"], "mode": "live" } ] }
```

### `POST /api/connectors`
Read-only live preview from one source. **Never a write.**

```jsonc
// request
{ "id": "zoom" }

// response 200 (configured)
{ "ok": true, "id": "zoom", "mode": "live", "count": 5,
  "items": [ { "t": "Clinic onboarding — 2 recording file(s)", "when": "2026-09-24", "label": "Transcript", "src": "Zoom", "url": "…" } ] }

// response 409 (not configured)
{ "ok": false, "error": "not_configured", "missing": ["ZOOM_ACCOUNT_ID", "…"] }
```

Supported ids: `zoom`, `slack`, `gmail`, `zendesk`, `intercom`, `appstore`,
`salesforce` (adapter stub). Credentials are read from environment variables
only and are never sent to the browser. Setup steps: `docs/connectors.md`.

---

## Schema v1.1 record (input to the classifier)

```
id, schema_version, synthetic
source   { type, native_id, url?, occurred_at }
evidence { text, speaker_provenance, text_kind }        # quote exactly
context  { reported_customer?, account_id_hint?, product_hint?, version? }
intake   { eligible_for_classification, exclusion_reason? }
provenance { kind, basis?, citation? }                    # synthetic vs paraphrased public
label    { classification, route, theme_id, review_required, potential_mdr, priority_subflags }
```

**Separate from `label`:** reviewer `status`, `decision` and `timestamp` belong
to the approval log, never to the model result. Theme, sentiment, ownership and
roadmap matches are **Product-stage outputs**, not classifier input fields.