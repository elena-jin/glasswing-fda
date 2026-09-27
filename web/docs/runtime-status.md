# Runtime status — truthful source/health surfaces

Replaces the hardcoded status strings ("Synced 4m ago", "Healthy", "90% classifier", green toggles) on the **Overview**, **Integrations** page and **Data status popup** with evidence fetched at load.

## Endpoints

| Endpoint | Returns | Notes |
| --- | --- | --- |
| `GET /api/connectors` | Per-source runtime state, `next` list, checked_at | No credential values; env-var **names** only. Public-safe. |
| `POST /api/connectors` `{id}` | Read-only preview items | **Internal only** (`TF_INTERNAL_TOKEN` + `x-tf-internal`), fails closed (401). Records `connector.preview.ok` for the "tested live" badge. |
| `GET /api/data/health` | Supabase connection + `checked_at` + **aggregate counts** | Counts only — never rows/text/ids/credentials. |
| `GET /api/classifier/summary` | Model status from real runs | "offline code only / no runs" until `tf_model_runs` + predictions exist. |

## Truthful badges (server-derived)

| Condition | State | Label |
| --- | --- | --- |
| No credentials | `not_connected` | synthetic demo / not connected |
| Credentials present, never pulled | `configured_untested` | configured, untested |
| Successful preview recorded | `tested_live` | tested live · `<time>` |
| Salesforce (no adapter) | `stub` | stub — no live reads |
| Granola / Jira / QMS | `next` | shown under **Next** |

A provisioned vendor trial with no successful pull is **never** shown as working.
Credential values and private previews are never returned to anonymous viewers.

## What changed in the UI

- **Overview:** a `Runtime evidence` strip (Supabase / Model / Sources badges + checked time + partition counts). KPI figures tagged **synthetic scenario**; live Supabase counts shown separately. "Live triage stream" no longer claims auto-refresh.
- **Integrations:** source cards render server state (no fake green dots); the CSS/toast-only toggles are removed and replaced with a **"Test read (internal)"** action and a **demo only** note; a **Next** section lists Granola, Jira and QMS.
- **Data status popup:** the Pipeline chip and stage bars are replaced by the real Supabase connection + counts, model status and per-source states; the fake "Run sync now" is a **Refresh status** button.

## Tests

`cd web && npm test` — includes `connector-state`, `runtime-badges`, `connectors-endpoint` (empty creds, configured-untested, preview success/failure, no-leak) and `data-health`.

## Not claimed

All Aeris Health figures are a fictional **synthetic scenario**, not live data. No PHI connectors. Jira/QMS/Granola are deliberately unwired.