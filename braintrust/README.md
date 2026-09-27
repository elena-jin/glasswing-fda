# Braintrust evals — grounded assistant (synthetic-only)

Dev-only evaluation harness for `POST /api/assistant`, using the Braintrust
**TypeScript SDK** `Eval()`.

Project: <https://www.braintrust.dev/app/Hackathon%20Team%201/p/My%20Project>

## Status: waiting on keys

**These evals do not run until `BRAINTRUST_ENABLE=1` and `BRAINTRUST_API_KEY`
are set**, and the chat provider key (`CHAT_API_KEY`) is set on the deployment.
Until then the script prints a notice and exits — nothing is uploaded, no
credits are spent.

## Setup

```bash
cd braintrust
npm install
cp .env.example .env      # fill BRAINTRUST_API_KEY (+ BRAINTRUST_ENABLE=1)
npm run eval             # hits ASSISTANT_URL (may make model calls via the route)
npm run eval:offline     # fixtures only — NO model calls, NO network to the app
```

`eval.offline.ts` scores pre-recorded synthetic fixtures (grounded citations,
no-evidence refusal, product-scope quality refusal) — it validates the scorers
without spending credits. `ASSISTANT_URL` only applies to the online script.

## Dataset

`dataset.synthetic.v1.json` — **synthetic-only**, versioned by filename (never
edited in place; new versions are new files). No real-source, MAUDE,
`locked_eval` or app-review holdout text may be added.

## Scorers

| Scorer | Checks |
| --- | --- |
| `citations_subset_of_retrieved` | every citation id is one of the retrieved ids |
| `no_invented_citations` | no citation outside the retrieved set |
| `claims_supported_by_evidence` | grounded answers carry citations; refusals carry none |
| `correct_refusal` | no-evidence case → “I don't know”, no cites |
| `quality_scope_refusal_in_product` | quality topic under product scope → refused |
| `no_real_source_data_returned` | no deny-listed (`locked`/`maude`/`real-`) id appears |
| `latency_budget` | `latency_ms ≤ LATENCY_BUDGET_MS` (default 15 000) |
| `token_budget` | input+output tokens ≤ `TOKEN_BUDGET` (default 2 000) |

## Privacy

Traces are **metadata-only by default**: request id, scope, citation ids,
retrieval ids, refusal flags, model, token counts, latency, scores. Full prompts,
model output text and retrieved source text are **not** logged unless
`BRAINTRUST_LOG_CONTENT=1` is explicitly set. No keys are committed and none are
sent to the browser.

**Runtime tracing is opt-in.** The chat route traces only when `CHAT_TRACE=1`
*and* `BRAINTRUST_API_KEY` are set, and only emits the same sanitized metadata
(request id, scope, outcome, synthetic citation ids, model, tokens, latency,
score) — never prompt/output/evidence text or real rows.

## Not run here

This harness is not executed in CI and requires the keys above; it is provided so
the evals can be run once a provider and Braintrust key are chosen.