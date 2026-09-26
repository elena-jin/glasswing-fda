# Synthetic feedback pipeline fixture

All names, accounts, devices, conversations, links and events are invented. The JSON events approximate source envelopes for a demo; they are not actual vendor payloads, patient records or production-ready adapters.

1. `feedback-raw-source-events.json` has 12 source-shaped envelopes: Salesforce Case, Zendesk comments, Slack posts, Granola transcript segment, feedback inbox mail, and Zoom transcript/chat.
2. The source adapter/standardization layer extracts exact text, native ID, URL, event time, speaker provenance and *hints*, then emits `feedback-classifier-inputs.json`. Validate each `records[]` object against `feedback-classifier-input.schema.json`. Keep the raw event separately, immutable. `account_id_hint` is not proof of the customer speaker's identity; `version: null` means unknown. Ingest time would be set by the actual adapter and is intentionally absent in historical fixture source events.
3. Send only records with `intake.eligible_for_classification: true` to the classifier. Two negative controls (logistics-only Zoom chat and internal Slack speculation) are excluded at this intake gate. Do not force non-feedback into either class.
4. The classifier should return `{id, classification, route, theme_id, review_required, reason}`. Compare to `feedback-expected-outputs.json`, an answer key withheld from inference. The `complaint` label is a *candidate for human Quality review* and never a legal complaint determination, MDR decision, or QMS write. `product_feedback` routes to Product triage. A model may add confidence and evidence span; preserve uncertainty rather than inventing account/version.

These 12 examples test a contract and edge cases, not model accuracy or a training corpus. Make a larger, independently labeled set and hold out evaluation records before tuning. Never call real customer or patient data synthetic merely by changing a name.
