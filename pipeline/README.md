# Feedback pipeline — source adapters (standardization layer)

Turns provider-shaped raw feedback events into **schema v1.1** standardized
records. Only records with `intake.eligible_for_classification: true` are meant
to reach the classifier. Raw events are read-only and never mutated.

## Scope

This change implements three adapters (task: "Stub 3 source adapters ... emitting
standard JSON"):

| adapter | `source.type` | input shape |
| --- | --- | --- |
| `FeedbackMailAdapter` | `feedback_mail` | feedback inbox email (Message-ID, Body, account hints) |
| `ZendeskCommentAdapter` | `zendesk_comment` | ticket comment (ticket/comment id, org, version custom field) |
| `SlackFeedbackChannelAdapter` | `slack_feedback_channel` | `#customer-feedback` post (channel, ts, text, account hint) |

Out of scope for now (registry is pluggable): `salesforce_case`,
`granola_transcript`, `zoom_transcript`, `zoom_chat`.

## Rules baked in

- **Never invent facts.** `version` stays `null` / `version_evidence: unknown`
  unless the payload states it. An `account_id_hint` is a *proposed link* only.
- **Intake gate** (deterministic): a Slack post that is first-person speculation
  with no linked customer is excluded (`internal_speculation_no_customer_report`);
  a logistical Zoom chat is excluded (`logistical_request_no_feedback`). The gate
  never forces non-feedback into a class.
- **`complaint` is always a human-review candidate**, never a legal
  determination — that decision lives downstream, not here.

## Layout

```
pipeline/
  schema/feedback-classifier-input.schema.v1_1.json   # the contract
  fixtures/                                            # raw + canonical + answer key
  feedback_pipeline/
    adapters.py     # base + 3 adapters + registry + intake gate
    directory.py    # account-id -> name lookup, product default
    schema.py       # jsonschema validation (2020-12, Draft7 fallback)
    runner.py       # CLI: raw events -> standardized JSON
  tests/test_pipeline.py
```

## Run

```bash
python -m pip install -r requirements.txt
python -m feedback_pipeline.runner \
  --input fixtures/feedback-raw-source-events.json \
  --output /tmp/standardized.json
python tests/test_pipeline.py        # or: pytest
```

The runner exits non-zero if any emitted record fails schema validation.