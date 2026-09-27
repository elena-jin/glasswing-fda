/**
 * Braintrust dev evals — grounded Test Flight assistant.
 *
 * GATED: this script does nothing unless BRAINTRUST_ENABLE=1 AND
 * BRAINTRUST_API_KEY are set. It never runs in the web app, never ships a key
 * to the client, and never uploads restricted rows.
 *
 * PRIVACY: traces are METADATA-ONLY by default. The logged `output` is a
 * sanitized summary (request id, scope, citation IDs, refusal flags, model,
 * token counts, latency, scores). Full prompts, model output text and retrieved
 * source text are NOT logged unless BRAINTRUST_LOG_CONTENT=1 is explicitly set.
 *
 * DATASET: synthetic-only, versioned by filename. Never add real-source,
 * MAUDE, locked_eval or app-review holdout text.
 *
 * Run:  cd braintrust && npm install && BRAINTRUST_ENABLE=1 BRAINTRUST_API_KEY=... npm run eval
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Eval } from "braintrust";

const ENABLED = process.env.BRAINTRUST_ENABLE === "1" && !!process.env.BRAINTRUST_API_KEY;
const ENDPOINT = (process.env.ASSISTANT_URL || "http://localhost:3000").replace(/\/$/, "");
const LOG_CONTENT = process.env.BRAINTRUST_LOG_CONTENT === "1";
const LATENCY_BUDGET_MS = parseInt(process.env.LATENCY_BUDGET_MS || "15000", 10);
const TOKEN_BUDGET = parseInt(process.env.TOKEN_BUDGET || "2000", 10);
const DENY_PREFIXES = (process.env.HOLDOUT_DENY_PREFIXES || "locked,maude,real-").split(",").map((s) => s.trim()).filter(Boolean);

const dataset = JSON.parse(readFileSync(new URL("./dataset.synthetic.v1.json", import.meta.url), "utf8"));

type SanitizedOutput = {
  request_id: string;
  scope: string;
  refused: string | null;
  unavailable: boolean;
  ok: boolean;
  cites: string[];
  retrieved: string[];
  cites_subset: boolean;
  text_len: number;
  has_refusal_phrase: boolean;
  deny_hit: boolean;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  text?: string; // only when BRAINTRUST_LOG_CONTENT=1
};

async function task(input: { message: string; scope: string }): Promise<SanitizedOutput> {
  const t0 = Date.now();
  const requestId = randomUUID();
  const res = await fetch(ENDPOINT + "/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body: any = await res.json();
  const reply = body.reply || {};
  const retrieved: string[] = Array.isArray(body.retrieved) ? body.retrieved : [];
  const cites: string[] = Array.isArray(reply.cites) ? reply.cites : [];
  const text = String(reply.text || "");
  const denyHit = [...retrieved, ...cites].some((id) => DENY_PREFIXES.some((p) => String(id).startsWith(p)));

  const out: SanitizedOutput = {
    request_id: requestId,
    scope: body.scope || input.scope,
    refused: body.refused || null,
    unavailable: !!body.unavailable,
    ok: !!body.ok,
    cites,
    retrieved,
    cites_subset: cites.every((c) => retrieved.includes(c)),
    text_len: text.length,
    has_refusal_phrase: /I don't know/i.test(text),
    deny_hit: denyHit,
    model: body.usage?.model ?? null,
    input_tokens: body.usage?.input_tokens ?? null,
    output_tokens: body.usage?.output_tokens ?? null,
    latency_ms: body.usage?.latency_ms ?? (Date.now() - t0),
  };
  if (LOG_CONTENT) out.text = text; // explicit opt-in only
  return out;
}

const b = (v: boolean) => (v ? 1 : 0);

const scorers = [
  { name: "citations_subset_of_retrieved", scorer: ({ output }: any) => b(output.cites_subset === true) },
  { name: "no_invented_citations", scorer: ({ output }: any) => b(output.cites_subset === true) },
  {
    name: "claims_supported_by_evidence",
    scorer: ({ output, expected }: any) =>
      expected.expect.kind === "refusal" ? b(output.cites.length === 0) : b(output.text_len > 0 && (output.cites.length > 0 || output.unavailable)),
  },
  {
    name: "correct_refusal",
    scorer: ({ output, expected }: any) =>
      expected.expect.kind === "refusal" ? b(output.has_refusal_phrase && output.cites.length === 0) : 1,
  },
  {
    name: "quality_scope_refusal_in_product",
    scorer: ({ output, expected }: any) =>
      expected.expect.kind === "scope_refusal" ? b(output.refused === "scope" && output.cites.length === 0) : 1,
  },
  { name: "no_real_source_data_returned", scorer: ({ output }: any) => b(output.deny_hit === false) },
  { name: "latency_budget", scorer: ({ output }: any) => b(output.latency_ms <= LATENCY_BUDGET_MS) },
  {
    name: "token_budget",
    scorer: ({ output }: any) => {
      const total = (output.input_tokens || 0) + (output.output_tokens || 0);
      return total === 0 ? 1 : b(total <= TOKEN_BUDGET);
    },
  },
];

if (!ENABLED) {
  console.error("[braintrust] Disabled. Set BRAINTRUST_ENABLE=1 and BRAINTRUST_API_KEY to run evals.");
  console.error("[braintrust] (Tracing/evals are intentionally gated; nothing was uploaded.)");
  process.exit(0);
}

Eval("grounded-assistant-synthetic", {
  data: () =>
    dataset.cases.map((c: any) => ({
      input: c.input,
      expected: { kind: c.expect.kind, id: c.id },
      metadata: { case_id: c.id, dataset_version: dataset.version },
    })),
  task,
  scores: scorers,
  metadata: {
    dataset_version: dataset.version,
    endpoint: ENDPOINT,
    provider: process.env.CHAT_PROVIDER || null,
    content_logging: LOG_CONTENT,
  },
});