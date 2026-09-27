/**
 * Braintrust OFFLINE eval — grounded assistant scorers.
 *
 * SEPARATE FROM RUNTIME and makes NO model calls and NO network calls to the
 * app: the task returns pre-recorded SYNTHETIC fixtures. It exists to validate
 * the scoring logic (citations must be a subset of retrieved ids; refusals are
 * correct; product scope refuses quality topics) without spending credits.
 *
 * GATED: does nothing unless BRAINTRUST_ENABLE=1 AND BRAINTRUST_API_KEY are set.
 * PRIVACY: fixtures are synthetic-only and contain no real-source, MAUDE,
 * locked_eval or app-review holdout text. Traces carry only sanitized metadata.
 *
 * Run:  cd braintrust && BRAINTRUST_ENABLE=1 BRAINTRUST_API_KEY=... npm run eval:offline
 */
import { Eval } from "braintrust";

const ENABLED = process.env.BRAINTRUST_ENABLE === "1" && !!process.env.BRAINTRUST_API_KEY;
const b = (v: boolean) => (v ? 1 : 0);

type Fixture = {
  id: string;
  expected: { kind: "grounded" | "refusal" | "scope_refusal" };
  output: { ok: boolean; scope: string; refused?: string; retrieved: string[]; reply: { text: string; cites: string[] } };
};

const FIXTURES: Fixture[] = [
  {
    id: "grounded-citations",
    expected: { kind: "grounded" },
    output: {
      ok: true,
      scope: "product",
      retrieved: ["rec-sync", "rec-widget"],
      reply: { text: "Users report nightly sync stalls [rec-sync] and want a widget [rec-widget].", cites: ["rec-sync", "rec-widget"] },
    },
  },
  {
    id: "no-evidence-refusal",
    expected: { kind: "refusal" },
    output: { ok: true, scope: "product", retrieved: [], reply: { text: "I don't know — the retrieved records do not support an answer.", cites: [] } },
  },
  {
    id: "product-scope-quality-refusal",
    expected: { kind: "scope_refusal" },
    output: { ok: true, scope: "product", refused: "scope", retrieved: [], reply: { text: "Complaint, MDR and other Quality/compliance details are outside the product scope.", cites: [] } },
  },
];

const byId = new Map(FIXTURES.map((f) => [f.id, f]));

const scorers = [
  { name: "citations_subset_of_retrieved", scorer: ({ output }: any) => b(output.reply.cites.every((c: string) => output.retrieved.includes(c))) },
  { name: "no_invented_citations", scorer: ({ output }: any) => b(output.reply.cites.length === 0 || output.reply.cites.every((c: string) => output.retrieved.includes(c))) },
  { name: "claims_supported_by_evidence", scorer: ({ output, expected }: any) => (expected.kind === "grounded" ? b(output.reply.cites.length > 0) : b(output.reply.cites.length === 0)) },
  { name: "correct_refusal", scorer: ({ output, expected }: any) => (expected.kind === "refusal" ? b(/I don't know/i.test(output.reply.text) && output.reply.cites.length === 0) : 1) },
  { name: "quality_scope_refusal_in_product", scorer: ({ output, expected }: any) => (expected.kind === "scope_refusal" ? b(output.refused === "scope" && output.reply.cites.length === 0) : 1) },
];

if (!ENABLED) {
  console.error("[braintrust:offline] Disabled. Set BRAINTRUST_ENABLE=1 and BRAINTRUST_API_KEY to run.");
  process.exit(0);
}

Eval("grounded-assistant-offline", {
  data: () => FIXTURES.map((f) => ({ input: { fixture: f.id }, expected: { kind: f.expected.kind }, metadata: { case_id: f.id } })),
  task: (input: { fixture: string }) => {
    const f = byId.get(input.fixture);
    if (!f) return { ok: false, scope: "product", retrieved: [], reply: { text: "missing fixture", cites: [] } };
    // Sanitized, no text echoed beyond the synthetic fixture reply.
    return { ok: f.output.ok, scope: f.output.scope, refused: f.output.refused, retrieved: f.output.retrieved, reply: f.output.reply };
  },
  scores: scorers,
  metadata: { mode: "offline-fixtures", dataset_version: "v1", no_model_calls: true, synthetic_only: true },
});