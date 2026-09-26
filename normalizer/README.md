# AI Normalization Layer (02 / NORMALIZE)

Takes **raw reports** in any source format and emits **standardized records** in
the `feedback-classifier-input` schema (v1.1, validated against the additive
**v1.2** contract) — the input shape consumed by David's classifier.

> Per the architecture diagram, OpenCode *builds* this layer; it is **not** the
> runtime model. Extraction is performed by a pluggable provider — **Claude**
> (Anthropic) in production, an OpenAI-compatible model, or a deterministic
> offline fallback. The layer does **not** classify: `complaint` / `product_feedback`
> / `excluded` labels are the classifier's job, and human Quality reviewers make
> every regulatory determination.

## Pipeline position

```
Raw reports (Salesforce, Zendesk, Email, Slack, Zoom, Granola, app reviews, MAUDE)
        ->  [ THIS: Claude / AI layer  ]  ->  Schema v1.1 JSON  ->  classifier  ->  review
```

## Contract

`normalizer/schema/`
- `feedback-classifier-input.schema.v1_1.json` — team contract.
- `feedback-classifier-input.schema.v1_2.json` — additive: `occurred_at` may be
  `null`, `account_match` adds `"unknown"`, `provenance.kind` adds
  `verbatim_public_excerpt` / `adversarial_synthetic` / `real_public_maude`.
  (Real public excerpts in the v1.2 boundary set require these values.)

The layer sets `schema_version`, `id`, `synthetic`; the provider fills
`source`, `evidence`, `context`, `intake`, `provenance`.

## Rules baked into the layer

- **Never invent facts** — unknown product/account/version → `null` / `"UNKNOWN"`.
- **`evidence.text` is verbatim** — no summarizing or rewriting.
- **Intake gate** (deterministic post-check + model instruction): excludes
  logistics, internal speculation, generic praise, billing/shipping, and pure
  how-to questions, with the matching `exclusion_reason`.
- **Validation + one repair round** — if the model's output violates the schema,
  it is re-prompted once with the validation errors.

## Layout

```
normalizer/
  normalizer_layer/
    prompt.py        # system prompt + forced-tool schema
    schemas.py       # schema load + validation + controlled vocabularies
    providers.py     # Anthropic | OpenAI-compatible | Deterministic
    normalize.py     # orchestrator + postprocess + repair
    runner.py        # CLI
  schema/            # v1.1 + v1.2 contracts
  fixtures/          # one sample raw report per source type
  tests/
```

## Run

```bash
python -m pip install -r requirements.txt

# offline / deterministic (no model call):
python -m normalizer_layer.runner \
  --input fixtures/sample_raw_reports.json --output /tmp/std.json --provider deterministic

# Claude (when ANTHROPIC_API_KEY is set):
export ANTHROPIC_API_KEY=...
python -m normalizer_layer.runner --input ... --output ... --provider anthropic

# any OpenAI-compatible endpoint (e.g. Sciforium):
export SCIFORIUM_API_KEY=...
python -m normalizer_layer.runner --input ... --output ... --provider openai-compatible --model <model>

python tests/test_normalizer.py     # or: pytest
```

Provider auto-detection order: `ANTHROPIC_API_KEY` → Claude;
`OPENAI_API_KEY`/`SCIFORIUM_API_KEY` → OpenAI-compatible; else deterministic.

## Input format

```json
{ "reports": [
  { "id": "optional-stable-id", "source_type": "app_store_review",
    "synthetic": false, "raw": { "...": "verbatim provider payload" } }
] }
```