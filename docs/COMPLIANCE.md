# Compliance: HIPAA-aware data boundary

> **We do not claim HIPAA compliance.** This is a **HIPAA-aware design** for a
> hackathon demo built on **synthetic and public/de-identified data**. Say
> "HIPAA-aware design," never "HIPAA compliant."
> Not legal advice.

Source: team note *"HIPAA and our feedback data (Test Flight)"*.

## Why HIPAA mostly doesn't apply to the demo
- HIPAA covers **covered entities** (providers, plans, clearinghouses) and their
  **business associates**. Device makers that just make/sell devices usually are
  neither.
- Complaint intake is primarily an **FDA (QMSR/MDR)** obligation, not a HIPAA one.
  HIPAA bites when **PHI moves between organizations or to vendors**.
- Our demo data: v1.3 synthetic (no PHI); MAUDE (FDA de-identified, public);
  a few public app-store reviews (sensitive → internal only, kept out of the repo).
  Live customer channels (Salesforce/Zendesk/Intercom/Slack/email/Zoom) are mocked.

The real exposure is that **PHI can hide inside free-text feedback**, so we build
as if it will appear.

## What we actually implemented (data minimization before the AI boundary)
1. **Deterministic pre-LLM screening** — `normalizer/normalizer_layer/screening.py`
   (and `assistant/assistant_backend/screening.py`) redact emails, URLs, phones,
   SSNs, dates, device/account identifiers and honorific names, and **drop
   identity-bearing keys** (`url`, `native_id`, `account_id_hint`, `from`, …).
   The model **never sees raw text**; the prompt carries only screened text.
2. **Random case IDs** — `screening.new_case_id()` (`case-<uuid>`), **not** a hash
   of a name/account/native id. Output records use it as `id`.
3. **`SourceVault`** — server-side store of the identified original keyed by case
   id, for authorized Quality retrieval; never placed in prompts/logs.
4. **Assistant screening** — `assistant/assistant_backend/prompt.py` screens every
   evidence excerpt before it is sent to the LLM.
5. **Fail-closed** — ambiguous name candidates flag `needs_human_review`; a
   low-confidence case routes to a human instead of being auto-processed.

### Honest limitations
- Regex scrubbing is **minimization, not certified Safe-Harbor de-identification**.
  It can miss identifiers and can over-redact. Do not represent it as HIPAA
  de-identification.
- Opaque case ID + protected re-identification key can be permitted under
  45 CFR 164.514(c), but *replacing a name with a token does not by itself make
  the rest de-identified*.

## Intended production boundary (target design)
```
Customer systems (Slack/tickets/email/calls)
  -> restricted PHI-capable connector + intake service
  -> encrypted original/evidence store  +  random case ID
  -> deterministic scrub / allowlist  +  human exception queue
  -> AI normalizer/classifier  (minimum-necessary redacted text + opaque case ID)
  -> human Quality queue
  -> authorized Quality/QMS service retrieves original by case ID, writes required
     complaint/MDR fields, records QMS ID + audit trail
Product feedback -> clustering/Jira only after the same screening, no identity link
```

## Controls to add before any real PHI
- RBAC + access-controlled "open original"; access/audit logs; retention policy.
- Encryption in transit and at rest; separate original store and token-to-source map.
- **Suppress raw payloads** from application logs, traces, error reports, prompt
  logs, embeddings, analytics, queues and CI.
- **Never** put identifying source URLs, Slack permalinks, device serials or
  reversible tokens into model prompts (enforced above for the AI layer).
- Slack caveat: if a patient is named in Slack, the *customer's* Slack deployment
  must support PHI (Enterprise Grid + BAA + configuration); third-party apps have
  no Slack-provided BAA. Block the Slack connector for real data unless approved.

## Vendor BAA checklist (only needed if real PHI flows)
| Vendor | BAA posture (verify at purchase) |
| --- | --- |
| LLM API (our runtime: Sciforium/DeepSeek) | **No BAA** — must change vendor or obtain a BAA before real PHI |
| OpenAI API | BAA by email request (baa@openai.com) |
| Anthropic | Enterprise HIPAA-ready / sales; excludes connector/MCP egress |
| Vercel | self-serve BAA add-on on **Pro** (we're on Hobby) |
| Supabase | BAA on **paid** HIPAA projects (**hosted only**, not self-hosted) |
| Zendesk | BAA with **Advanced Compliance** add-on |
| Salesforce | BAA for covered services |
| Intercom | unclear — verify before any PHI claim |
| Google Workspace | HIPAA BAA addendum covers Gmail + Drive |
| GitHub | **no BAA**; DPA bars HIPAA data — keep PHI out of code/tests/CI/issues |

## Regulatory references
- 21 CFR 820.35(a) — complaint records (device, received date, UDI, complainant
  name/address/phone, details, corrections, reply).
- 21 CFR 803.52 — manufacturer MDR fields; 21 CFR 803.18 — event-file references.
- 45 CFR 164.512(b)(1)(iii) — providers may share PHI with a device maker for
  quality/safety/effectiveness (public-health rule).
- 45 CFR 164.514 / HHS de-identification guidance.
- 21 CFR 803.9 — MAUDE public disclosure.