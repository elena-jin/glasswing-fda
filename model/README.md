# model/ — offline exploratory classifier artifacts

**Status: OFFLINE / EXPLORATORY ONLY. Nothing here is a deployed model, and no
metric from these scripts is live production performance.** The web app does not
import these files; the classifier panel reads `tf_predictions` that must be
written by a separate, controlled run. Do not advertise these accuracies
(ModernBERT ≈ 99.4% recall / 87% specificity; Jev ≈ 99.3% / 93% on ~1,300 test
cases) as shipped behaviour.

## Contents

| File | What it is | sha256 |
| --- | --- | --- |
| `explore_modernbert_gate_cpu.py` | Frozen **ModernBERT-base** embedding + linear-probe + small-MLP gate experiment (CPU). Uses the official INT8 ONNX graph when usable, else a PyTorch CPU encoder. | `6738285895ec8ee58405b753d473c8a05dde9f246e456bd7424d251fb223706d` |
| `explore_typesafe_jev_gate.py` | Zero-shot **TypeSafe Jev** gate: scores each record's `evidence.text` via a single Noul question; validation-only thresholding. | `884c39c7b44903162538c264b85dede1444c08295c29889adda1e2149df14afb` |
| `mlp_head.pt` | Trained MLP head over the ModernBERT embedding (PyTorch). Exploratory artifact. | `5bb3168e27ba6a73510e1af3dbbdb72cac01786a12d271f107efd6d8ba13e0b3` |
| `mlp_scaler.joblib` | Feature scaler paired with `mlp_head.pt` (scikit-learn). | `89e287acc3f050af1b4a7831427a69a15fc45e1b959260b00d28d092dba199f9` |

> `mlp_head.pt` and `mlp_scaler.joblib` were supplied alongside the scripts; the
> exact training run/config that produced them is not recorded here. Treat them
> as exploratory weights, not a validated release. If they are superseded,
> update the hashes above.

## Dependencies

`explore_modernbert_gate_cpu.py` (CPU):
```
pip install -U numpy pandas scikit-learn joblib tqdm huggingface_hub \
    onnxruntime torch "transformers>=4.48"
```

`explore_typesafe_jev_gate.py`:
```
pip install typesafe-sdk numpy pandas scikit-learn python-dotenv
```

## Dataset contract

Both scripts ingest the **same** JSON records used by the pipeline (schema v1.1
+ the fields below). Key rules:

- **Model text is `evidence.text` only.** The model never receives annotation
  fields, customer/account IDs, URLs, native IDs, or `context` identity hints.
- **Training label** (ModernBERT): `record["annotation"]["gate_label"]` in
  `{"ESCALATE_TO_HUMAN","SAFE_TO_BYPASS"}`.
- **Splits**: `train` is for fitting; a `validation` split selects the threshold;
  the `locked_eval` set is **diagnostic-only** and is never used to choose a
  threshold. MAUDE is positive-only (recall only, no specificity).
- The scripts read a **directory of `*.json` files** (`--input-dir`), not the DB.

## Artifact provenance & reproducibility

Each run writes `run_config.json`, `report.json`, `operating_points.json`,
`dataset_metrics.json`, `score_distributions.json`, `structure_leakage_audit.json`
and `splits.json` into `--output-dir`. Embedding caches are content-addressed
(text + model/backend + pooling + formatter version), so config changes miss the
cache. Threshold policy: maximise bypass at the required recall
(default `--target-recall 0.995`), then prefer the lowest threshold among
equivalent operating points.

## Guardrails for this repo

- **Do not commit API keys, `.env`, caches, `runs/`, `output/`, ONNX/weights
  downloads, real eval texts, or the app-review holdout.** `model/.gitignore`
  enforces the local ones.
- **Typesafe makes paid API calls.** Do **not** run
  `explore_typesafe_jev_gate.py` without explicit cost approval. It reads
  `TYPESAFE_API_KEY` from the environment / a local `.env` (never committed) and
  refuses to start without it.
- These scripts are **offline evaluators**. Wiring them into a retraining worker
  (queue + container, immutable `tf_model_runs` artifact, held-out eval gate,
  manual promotion) is future work and is **not implemented**.