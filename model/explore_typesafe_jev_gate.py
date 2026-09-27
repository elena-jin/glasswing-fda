#!/usr/bin/env python3
"""
explore_typesafe_jev_gate.py

Zero-shot TypeSafe Jev evaluation for the same complaint-gate datasets used by the
ModernBERT experiment.

Design:
- Reads every *.json file from --input-dir (non-recursive).
- Model state is ONLY evidence.text.
- Keeps the same upstream eligibility rules and declared train/eval boundaries.
- Reproduces a group-aware train -> validation split for threshold selection.
- Jev is NOT trained on split=train. The train partition is retained for parity;
  use --score-train only if you want diagnostic train scores.
- Uses a single Noul question. The returned `noul` value is the escalation score.
- Selects a validation-only threshold with a recall-first conservative policy.
- Evaluates the locked eval split overall and by dataset.
- Deduplicates identical evidence.text values BEFORE API submission, so one
  unique text produces at most one new Jev request per rubric/model.
- Fans the unique-text score back out to every duplicate record.
- Uses bounded async concurrency for wall-clock throughput.
- Caches API responses by (model, rubric, evidence.text) so reruns do not
  unnecessarily repeat paid API calls.
- Writes comparison artifacts with metric names/schema intentionally aligned
  to the ModernBERT v8 experiment where meaningful.

Requires:
    pip install typesafe-sdk numpy pandas scikit-learn python-dotenv

Environment:
    Put TYPESAFE_API_KEY=... in a .env file beside this script.

Docs:
    https://docs.typesafe.ai/
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import hashlib
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from sklearn.metrics import (
    average_precision_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupShuffleSplit, train_test_split


SAFE = 0
ESCALATE = 1

QUESTION_ID = "should_escalate"

# Keep this rubric stable if you want cached scores / run-to-run comparison.
RUBRIC_VERSION = "complaint-gate-jev-v1"

QUESTION_INSTRUCTIONS = (
    "Does this communication contain an allegation or plausible indication of a "
    "possible deficiency in the identity, quality, durability, reliability, safety, "
    "effectiveness, or performance of a medical device or its companion app/software, "
    "labeling, packaging, connectivity, data, alerts, or related functionality, such "
    "that human Quality review is warranted?"
)

TRUE_CRITERIA = (
    "Yes. Escalate when the text alleges or plausibly indicates a device/software "
    "deficiency, malfunction, incorrect/stale/missing data, connectivity/signal problem, "
    "missed/false alert, therapy-delivery problem, unexpected performance, premature "
    "failure, safety concern, adverse consequence, or an incomplete/uncertain statement "
    "that still plausibly indicates such a problem. Suspected user error does not by "
    "itself make a possible product problem safe to bypass."
)

FALSE_CRITERIA = (
    "No. Safe to bypass only when the text is clearly administrative, informational, "
    "commercial, positive feedback, or a pure feature/enhancement request and it does "
    "not allege any product/device/software failure, deficiency, clinical effect, "
    "unexpected behavior, or plausible safety/performance concern."
)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--input-dir",
        type=Path,
        required=True,
        help="Directory containing input .json datasets (non-recursive).",
    )
    p.add_argument("--output-dir", type=Path, required=True)
    p.add_argument("--cache-dir", type=Path, default=Path("cache/typesafe_jev"))
    p.add_argument("--model", default="jev-latest")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--val-size", type=float, default=0.15)
    p.add_argument("--target-recall", type=float, default=0.995)
    p.add_argument(
        "--operating-recalls",
        default="1.0,0.995,0.99",
        help="Comma-separated recall targets to report.",
    )
    p.add_argument(
        "--concurrency",
        type=int,
        default=8,
        help="Maximum concurrent Jev API requests.",
    )
    p.add_argument(
        "--score-train",
        action=argparse.BooleanOptionalAction,
        default=True,
        help=(
            "Score train rows too so score-distribution artifacts match the ModernBERT run. "
            "This does NOT train/fine-tune Jev. Use --no-score-train to reduce API usage."
        ),
    )
    p.add_argument(
        "--recompute",
        action="store_true",
        help="Ignore cached Jev scores and call the API again.",
    )
    return p.parse_args()


def clean_scalar(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, bool):
        return str(value)
    s = str(value).strip()
    return s if s else None


def nested_get(obj: Dict[str, Any], path: str, default: Any = None) -> Any:
    cur: Any = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return default
        cur = cur[part]
    return cur


def load_json_records(path: Path) -> Tuple[List[Dict[str, Any]], str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        records = data
        dataset_name = path.stem
    elif isinstance(data, dict) and isinstance(data.get("records"), list):
        records = data["records"]
        dataset_name = clean_scalar(data.get("dataset")) or path.stem
    else:
        raise ValueError(
            f"{path}: expected top-level list or object containing records[]"
        )

    out: List[Dict[str, Any]] = []
    for i, record in enumerate(records):
        if not isinstance(record, dict):
            continue
        r = dict(record)
        r["__dataset"] = clean_scalar(record.get("dataset")) or dataset_name
        r["__source_file"] = str(path)
        r["__source_index"] = i
        out.append(r)
    return out, dataset_name


def load_all(input_dir: Path) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    paths = sorted(p for p in input_dir.glob("*.json") if p.is_file())
    if not paths:
        raise ValueError(f"No .json files found in {input_dir}")

    all_records: List[Dict[str, Any]] = []
    sources: List[Dict[str, Any]] = []
    print(f"Discovered {len(paths)} JSON file(s) in {input_dir}:")
    for path in paths:
        records, dataset_name = load_json_records(path)
        all_records.extend(records)
        sources.append(
            {"file": str(path), "dataset": dataset_name, "records": len(records)}
        )
        print(f"  {path.name}: dataset={dataset_name!r} records={len(records)}")
    return all_records, sources


def eligibility_reason(record: Dict[str, Any]) -> str:
    value = nested_get(record, "intake.eligible_for_classification", None)
    if value is True:
        return "explicit_true"
    if value is False:
        return "explicit_false"

    split = clean_scalar(record.get("split"))
    eval_only = record.get("eval_only") is True
    if split == "eval" and eval_only:
        return "curated_eval_only_missing_intake"
    return "missing_or_not_eligible"


def eligible(record: Dict[str, Any]) -> bool:
    return eligibility_reason(record) in {
        "explicit_true",
        "curated_eval_only_missing_intake",
    }


def extract_label(record: Dict[str, Any]) -> Optional[int]:
    classification = clean_scalar(nested_get(record, "label.classification"))
    route = clean_scalar(nested_get(record, "label.route"))

    if classification is not None:
        c = classification.lower()
        if c == "complaint":
            return ESCALATE
        if c == "product_feedback":
            return SAFE

    if route is not None:
        r = route.lower()
        if r in {"human_quality_review", "escalate_to_human", "escalate"}:
            return ESCALATE
        if r in {"safe_to_bypass", "product_triage", "bypass"}:
            return SAFE

    return None


def evidence_text(record: Dict[str, Any]) -> str:
    text = nested_get(record, "evidence.text")
    if text is None:
        return ""
    return str(text).strip()


def group_id(record: Dict[str, Any]) -> Optional[str]:
    for path in (
        "annotation.group_id",
        "group_id",
        "incident_group_id",
        "contrast_group_id",
        "annotation.contrast_group_id",
    ):
        g = clean_scalar(nested_get(record, path))
        if g:
            return f"explicit::{g}"

    provenance_kind = clean_scalar(nested_get(record, "provenance.kind")) or ""
    source_url = clean_scalar(nested_get(record, "source.url"))
    if source_url and provenance_kind.startswith("real_public"):
        return f"source::{source_url}"
    return None


@dataclass
class SplitBundle:
    train_idx: np.ndarray
    val_idx: np.ndarray
    test_idx: np.ndarray


def build_splits(records: Sequence[Dict[str, Any]], y: np.ndarray, seed: int, val_size: float) -> SplitBundle:
    declared = np.array([clean_scalar(r.get("split")) for r in records], dtype=object)
    if not np.all(np.isin(declared, ["train", "eval"])):
        bad = Counter(str(x) for x in declared if x not in {"train", "eval"})
        raise ValueError(f"Model rows must be split=train/eval only; found {dict(bad)}")

    train_pool_idx = np.where(declared == "train")[0]
    test_idx = np.where(declared == "eval")[0]
    if len(train_pool_idx) == 0 or len(test_idx) == 0:
        raise ValueError("Need at least one train row and one eval row.")

    groups = [group_id(r) for r in records]
    train_groups = [groups[int(i)] for i in train_pool_idx]
    counts = Counter(g for g in train_groups if g is not None)
    repeated_groups = {g for g, n in counts.items() if n > 1}

    if repeated_groups:
        effective_groups = [
            g if g is not None else f"singleton::{int(i)}"
            for i, g in zip(train_pool_idx, train_groups)
        ]
        chosen = None
        for offset in range(50):
            gss = GroupShuffleSplit(
                n_splits=1, test_size=val_size, random_state=seed + offset
            )
            tr_local, va_local = next(
                gss.split(train_pool_idx, y[train_pool_idx], effective_groups)
            )
            tr_idx = train_pool_idx[tr_local]
            va_idx = train_pool_idx[va_local]
            if len(np.unique(y[tr_idx])) == 2 and len(np.unique(y[va_idx])) == 2:
                chosen = (tr_idx, va_idx)
                break
        if chosen is None:
            raise ValueError("Could not create group-aware train/validation split with both classes.")
        train_idx, val_idx = chosen
        print(
            f"Validation split is group-aware; {len(repeated_groups)} repeated "
            "source/incident groups were kept intact."
        )
    else:
        train_idx, val_idx = train_test_split(
            train_pool_idx,
            test_size=val_size,
            random_state=seed,
            stratify=y[train_pool_idx],
        )

    return SplitBundle(
        train_idx=np.asarray(train_idx, dtype=int),
        val_idx=np.asarray(val_idx, dtype=int),
        test_idx=np.asarray(test_idx, dtype=int),
    )


def cache_key(text: str, model: str) -> str:
    payload = json.dumps(
        {
            "rubric_version": RUBRIC_VERSION,
            "model": model,
            "instructions": QUESTION_INSTRUCTIONS,
            "true": TRUE_CRITERIA,
            "false": FALSE_CRITERIA,
            "state": text,
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def read_cache(cache_file: Path) -> Dict[str, Dict[str, Any]]:
    if not cache_file.exists():
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    with cache_file.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if "key" in obj:
                    out[obj["key"]] = obj
            except json.JSONDecodeError:
                pass
    return out


def append_cache(cache_file: Path, item: Dict[str, Any]) -> None:
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    with cache_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(item, ensure_ascii=False) + "\n")


async def score_records_jev(
    records: Sequence[Dict[str, Any]],
    indices: Sequence[int],
    model: str,
    cache_file: Path,
    concurrency: int,
    recompute: bool,
) -> Tuple[np.ndarray, Dict[str, Any]]:
    """
    Score one split with Jev.

    Performance behavior:
    - group rows by cache key BEFORE requests;
    - issue exactly one request for each missing unique text;
    - bounded async concurrency;
    - fan the resulting score back to all duplicate rows;
    - persistent JSONL cache across runs.

    This is request-level parallelism, not a guessed/undocumented multi-state
    batch endpoint.
    """
    try:
        from typesafe_sdk import AsyncTypeSafeClient, Noul
    except ImportError as exc:
        raise RuntimeError(
            "typesafe-sdk is not installed. Run: "
            "pip install typesafe-sdk numpy pandas scikit-learn python-dotenv"
        ) from exc

    if not os.environ.get("TYPESAFE_API_KEY"):
        raise RuntimeError(
            "TYPESAFE_API_KEY is not set. Put TYPESAFE_API_KEY=... in the .env "
            "file beside this script."
        )

    cache = {} if recompute else read_cache(cache_file)
    sem = asyncio.Semaphore(max(1, concurrency))
    write_lock = asyncio.Lock()
    scores = np.empty(len(indices), dtype=np.float64)

    # Group rows by the exact request cache key so duplicates are never launched
    # concurrently as separate paid requests.
    groups_by_key: Dict[str, Dict[str, Any]] = {}
    cache_hits_rows = 0
    for out_pos, record_idx in enumerate(indices):
        text = evidence_text(records[int(record_idx)])
        if not text:
            raise ValueError(
                f"Empty evidence.text for record {records[int(record_idx)].get('id')}"
            )
        key = cache_key(text, model)
        if key in cache:
            scores[out_pos] = float(cache[key]["score"])
            cache_hits_rows += 1
            continue

        bucket = groups_by_key.setdefault(
            key,
            {
                "text": text,
                "positions": [],
                "record_indices": [],
            },
        )
        bucket["positions"].append(out_pos)
        bucket["record_indices"].append(int(record_idx))

    unique_missing = list(groups_by_key.items())
    missing_rows = sum(len(item["positions"]) for _, item in unique_missing)
    duplicate_rows_saved = missing_rows - len(unique_missing)

    print(
        f"Jev cache: {cache_hits_rows}/{len(indices)} row hits; "
        f"{missing_rows} uncached row(s) collapse to {len(unique_missing)} unique API call(s) "
        f"({duplicate_rows_saved} duplicate request(s) avoided)."
    )

    usage = {
        "input_tokens": 0,
        "output_tokens": 0,
        "api_calls": 0,
        "rows_scored": int(len(indices)),
        "cache_hit_rows": int(cache_hits_rows),
        "uncached_rows": int(missing_rows),
        "unique_new_requests": int(len(unique_missing)),
        "duplicate_requests_avoided": int(duplicate_rows_saved),
    }
    start = time.time()
    completed = 0

    question = Noul(
        instructions=QUESTION_INSTRUCTIONS,
        criteria={"true": TRUE_CRITERIA, "false": FALSE_CRITERIA},
    )

    async with AsyncTypeSafeClient(model=model) as client:

        async def one(item: Tuple[str, Dict[str, Any]]) -> None:
            nonlocal completed
            key, bucket = item
            text = bucket["text"]

            async with sem:
                result = await client.system_one(
                    state=text,
                    questions={QUESTION_ID: question},
                )

            answer = result.nouls[QUESTION_ID]
            score = float(answer.noul)
            if not (0.0 <= score <= 1.0):
                raise ValueError(f"Invalid Jev Noul score {score}")

            usage_obj = getattr(result, "usage", None)
            in_tok = int(getattr(usage_obj, "input_tokens", 0) or 0)
            out_tok = int(getattr(usage_obj, "output_tokens", 0) or 0)

            # One unique response populates every matching row.
            for out_pos in bucket["positions"]:
                scores[int(out_pos)] = score

            first_record_idx = int(bucket["record_indices"][0])
            item_cache = {
                "key": key,
                "model": model,
                "rubric_version": RUBRIC_VERSION,
                "score": score,
                "representative_record_id": records[first_record_idx].get("id"),
                "representative_dataset": records[first_record_idx].get("__dataset"),
                "duplicate_row_count": len(bucket["positions"]),
                "input_tokens": in_tok,
                "output_tokens": out_tok,
            }

            async with write_lock:
                append_cache(cache_file, item_cache)
                usage["input_tokens"] += in_tok
                usage["output_tokens"] += out_tok
                usage["api_calls"] += 1
                completed += 1
                if (
                    completed == 1
                    or completed % 25 == 0
                    or completed == len(unique_missing)
                ):
                    elapsed = time.time() - start
                    rate = completed / elapsed if elapsed > 0 else 0.0
                    print(
                        f"Jev scored {completed}/{len(unique_missing)} unique new texts "
                        f"| {rate:.2f} req/s | concurrency={concurrency}"
                    )

        await asyncio.gather(*(one(x) for x in unique_missing))

    return scores, usage

def metrics_at_threshold(
    y: np.ndarray, scores: np.ndarray, threshold: float
) -> Dict[str, Any]:
    """Metric definitions intentionally mirror ModernBERT v8 binary_metrics()."""
    pred = (scores >= threshold).astype(np.int64)
    tp = int(np.sum((pred == 1) & (y == 1)))
    fp = int(np.sum((pred == 1) & (y == 0)))
    tn = int(np.sum((pred == 0) & (y == 0)))
    fn = int(np.sum((pred == 0) & (y == 1)))

    metrics: Dict[str, Any] = {
        "threshold": float(threshold),
        "n": int(len(y)),
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "escalate_recall": float(tp / (tp + fn)) if (tp + fn) else 0.0,
        "escalate_precision": float(tp / (tp + fp)) if (tp + fp) else 0.0,
        "false_negative_rate": float(fn / (fn + tp)) if (fn + tp) else 0.0,
        "specificity": float(tn / (tn + fp)) if (tn + fp) else 0.0,
        "traffic_bypassed": float((pred == 0).mean()) if len(pred) else 0.0,
        "safe_bypass_precision": float(tn / (tn + fn)) if (tn + fn) else 1.0,
    }
    if len(np.unique(y)) == 2:
        metrics["roc_auc"] = float(roc_auc_score(y, scores))
        metrics["pr_auc"] = float(average_precision_score(y, scores))
    else:
        metrics["roc_auc"] = float("nan")
        metrics["pr_auc"] = float("nan")
    return metrics

def threshold_candidates(scores: np.ndarray) -> np.ndarray:
    above = np.nextafter(scores.astype(np.float64), np.inf)
    return np.unique(
        np.concatenate(
            ([0.0], scores.astype(np.float64), above, [1.0 + 1e-8])
        )
    )


def select_conservative_threshold(
    y: np.ndarray, scores: np.ndarray, target_recall: float
) -> Tuple[float, pd.DataFrame]:
    """
    Mirrors ModernBERT v8 conservative threshold policy:
      1) recall >= target;
      2) maximize traffic bypassed;
      3) maximize safe-bypass precision;
      4) choose LOWEST threshold among otherwise equivalent points.
    """
    rows: List[Dict[str, Any]] = []
    best: Optional[Dict[str, Any]] = None
    best_t = 0.0

    for t in threshold_candidates(scores):
        t = float(t)
        m = metrics_at_threshold(y, scores, t)
        rows.append(m)
        if m["escalate_recall"] + 1e-12 < target_recall:
            continue

        if best is None:
            best = m
            best_t = t
            continue

        key = (
            m["traffic_bypassed"],
            m["safe_bypass_precision"],
            -t,
        )
        best_key = (
            best["traffic_bypassed"],
            best["safe_bypass_precision"],
            -best_t,
        )
        if key > best_key:
            best = m
            best_t = t

    if best is None:
        best_t = 0.0
        best = metrics_at_threshold(y, scores, best_t)

    return float(best_t), pd.DataFrame(rows)

def describe_scores(name: str, y: np.ndarray, scores: np.ndarray) -> Dict[str, Any]:
    result: Dict[str, Any] = {"split": name}
    for label, label_name in [(SAFE, "safe"), (ESCALATE, "escalate")]:
        s = scores[y == label]
        if len(s) == 0:
            result[label_name] = None
            continue
        result[label_name] = {
            "n": int(len(s)),
            "min": float(np.min(s)),
            "p01": float(np.quantile(s, 0.01)),
            "p05": float(np.quantile(s, 0.05)),
            "p50": float(np.quantile(s, 0.50)),
            "p95": float(np.quantile(s, 0.95)),
            "p99": float(np.quantile(s, 0.99)),
            "max": float(np.max(s)),
        }
    if result.get("safe") and result.get("escalate"):
        max_safe = result["safe"]["max"]
        min_esc = result["escalate"]["min"]
        result["margin"] = float(min_esc - max_safe)
        result["perfectly_separated"] = bool(max_safe < min_esc)
    return result


def print_metric_block(title: str, m: Dict[str, Any]) -> None:
    print(f"\n{title}")
    print(json.dumps(m, indent=2))


def dataset_metrics(
    records: Sequence[Dict[str, Any]],
    indices: np.ndarray,
    y: np.ndarray,
    scores: np.ndarray,
    threshold: float,
) -> List[Dict[str, Any]]:
    positions: Dict[str, List[int]] = defaultdict(list)
    for local_pos, record_idx in enumerate(indices):
        positions[str(records[int(record_idx)].get("__dataset", "<unknown>"))].append(local_pos)

    rows = []
    for dataset, local_positions in sorted(positions.items()):
        pos = np.asarray(local_positions, dtype=int)
        m = metrics_at_threshold(y[pos], scores[pos], threshold)
        rows.append({"dataset": dataset, **m})
    return rows


def write_predictions(
    path: Path,
    records: Sequence[Dict[str, Any]],
    indices: np.ndarray,
    y: np.ndarray,
    scores: np.ndarray,
    threshold: float,
) -> None:
    rows = []
    for local_pos, record_idx in enumerate(indices):
        r = records[int(record_idx)]
        pred = int(scores[local_pos] >= threshold)
        rows.append(
            {
                "id": r.get("id"),
                "dataset": r.get("__dataset"),
                "source_file": r.get("__source_file"),
                "true_label": "ESCALATE_TO_HUMAN" if int(y[local_pos]) else "SAFE_TO_BYPASS",
                "predicted_label": "ESCALATE_TO_HUMAN" if pred else "SAFE_TO_BYPASS",
                "score": float(scores[local_pos]),
                "threshold": float(threshold),
                "is_error": bool(pred != int(y[local_pos])),
                "evidence_text": evidence_text(r),
                "source_url": nested_get(r, "source.url"),
            }
        )
    pd.DataFrame(rows).to_csv(path, index=False)


async def async_main(args: argparse.Namespace) -> int:
    # Load secrets/config from .env beside this script. Existing process
    # environment variables take precedence over .env values.
    env_path = Path(__file__).resolve().with_name(".env")
    load_dotenv(dotenv_path=env_path, override=False)
    if env_path.exists():
        print(f"Loaded environment settings from: {env_path}")
    else:
        print(
            f"NOTE: no .env found beside script ({env_path}). "
            "TYPESAFE_API_KEY must already exist in the process environment."
        )
    if args.concurrency < 1:
        raise ValueError("--concurrency must be >= 1")
    if not (0.0 < args.val_size < 1.0):
        raise ValueError("--val-size must be between 0 and 1")
    if not (0.0 < args.target_recall <= 1.0):
        raise ValueError("--target-recall must be in (0,1]")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    records_all, input_sources = load_all(args.input_dir)

    reason_counts = Counter(eligibility_reason(r) for r in records_all)
    eligible_records = [r for r in records_all if eligible(r)]

    # Candidate and other non-model splits are loaded but ignored exactly as in v8.
    ignored = [
        r for r in eligible_records
        if clean_scalar(r.get("split")) not in {"train", "eval"}
    ]
    records = [
        r for r in eligible_records
        if clean_scalar(r.get("split")) in {"train", "eval"}
    ]

    # Must have a usable label and text.
    filtered: List[Dict[str, Any]] = []
    labels: List[int] = []
    for r in records:
        label = extract_label(r)
        text = evidence_text(r)
        if label is None or not text:
            continue
        filtered.append(r)
        labels.append(label)
    records = filtered
    y = np.asarray(labels, dtype=np.int64)

    print(
        f"Loaded {len(records_all)} records; {len(eligible_records)} intake-eligible; "
        f"{len(ignored)} candidate/other rows ignored; {len(records)} labeled train/eval rows used."
    )
    print(f"Eligibility reasons: {dict(reason_counts)}")
    print(
        f"Labels: SAFE_TO_BYPASS={int(np.sum(y==0))}, "
        f"ESCALATE_TO_HUMAN={int(np.sum(y==1))}"
    )

    splits = build_splits(records, y, args.seed, args.val_size)

    def split_summary(name: str, idx: np.ndarray) -> None:
        yy = y[idx]
        print(
            f"{name}: n={len(idx)} safe={int(np.sum(yy==0))} "
            f"escalate={int(np.sum(yy==1))}"
        )
        comp = Counter(str(records[int(i)].get("__dataset")) for i in idx)
        for ds, n in sorted(comp.items()):
            local = [int(i) for i in idx if str(records[int(i)].get("__dataset")) == ds]
            ly = y[local]
            print(
                f"  {ds}: n={n} safe={int(np.sum(ly==0))} "
                f"escalate={int(np.sum(ly==1))}"
            )

    print("\nSplit composition:")
    split_summary("train", splits.train_idx)
    split_summary("val", splits.val_idx)
    split_summary("test", splits.test_idx)

    cache_file = args.cache_dir / "jev_scores.jsonl"

    # Jev is zero-shot here. Validation tunes only the operating threshold.
    val_scores, usage_val = await score_records_jev(
        records, splits.val_idx, args.model, cache_file, args.concurrency, args.recompute
    )
    test_scores, usage_test = await score_records_jev(
        records, splits.test_idx, args.model, cache_file, args.concurrency, args.recompute
    )

    train_scores = None
    usage_train = {"input_tokens": 0, "output_tokens": 0, "api_calls": 0}
    if args.score_train:
        train_scores, usage_train = await score_records_jev(
            records, splits.train_idx, args.model, cache_file, args.concurrency, args.recompute
        )

    threshold, sweep = select_conservative_threshold(
        y[splits.val_idx], val_scores, args.target_recall
    )

    val_metrics = metrics_at_threshold(y[splits.val_idx], val_scores, threshold)
    test_metrics = metrics_at_threshold(y[splits.test_idx], test_scores, threshold)

    print(f"\nSelected validation threshold: {threshold}")
    print_metric_block("Jev val @ target recall", val_metrics)
    print_metric_block("Jev TEST @ selected threshold", test_metrics)

    operating_targets = [
        float(x.strip()) for x in args.operating_recalls.split(",") if x.strip()
    ]
    operating_rows: List[Dict[str, Any]] = []
    for target in operating_targets:
        t, _ = select_conservative_threshold(y[splits.val_idx], val_scores, target)
        vm = metrics_at_threshold(y[splits.val_idx], val_scores, t)
        tm = metrics_at_threshold(y[splits.test_idx], test_scores, t)
        operating_rows.append({"target_recall": target, "split": "val", **vm})
        operating_rows.append({"target_recall": target, "split": "test", **tm})

    ds_metrics = dataset_metrics(
        records,
        splits.test_idx,
        y[splits.test_idx],
        test_scores,
        threshold,
    )

    print("\n=== Jev metrics by dataset [test_locked_diagnostic_only] ===")
    for row in ds_metrics:
        print(
            f"{row['dataset']}: n={row['n']} "
            f"recall={row['escalate_recall']} precision={row['escalate_precision']} "
            f"bypass={row['traffic_bypassed']} FN={row['fn']} FP={row['fp']}"
        )

    # ---------- Comparison-oriented artifacts ----------
    # Match the ModernBERT run's core filenames wherever one Jev model maps
    # naturally to the same concept.
    sweep.to_csv(args.output_dir / "jev_threshold_sweep_validation.csv", index=False)
    # Alias with generic naming for easier side-by-side automation.
    sweep.to_csv(args.output_dir / "threshold_sweep_validation.csv", index=False)

    pd.DataFrame(operating_rows).to_csv(
        args.output_dir / "operating_points.csv", index=False
    )

    # Dataset-stratified metrics with the ModernBERT-style columns.
    dataset_rows: List[Dict[str, Any]] = []
    for row in ds_metrics:
        dataset_name = row["dataset"]
        local_positions = [
            j for j, record_idx in enumerate(splits.test_idx)
            if str(records[int(record_idx)].get("__dataset", "<unknown>")) == dataset_name
        ]
        pos = np.asarray(local_positions, dtype=int)
        dist = describe_scores(
            "test_locked_diagnostic_only",
            y[splits.test_idx][pos],
            test_scores[pos],
        )
        safe_dist = dist.get("safe") or {}
        esc_dist = dist.get("escalate") or {}
        dataset_rows.append(
            {
                "model": "jev",
                "dataset": dataset_name,
                "n": row["n"],
                "safe_n": int(np.sum(y[splits.test_idx][pos] == SAFE)),
                "escalate_n": int(np.sum(y[splits.test_idx][pos] == ESCALATE)),
                **{k: v for k, v in row.items() if k != "dataset"},
                "max_safe_score": safe_dist.get("max"),
                "min_escalate_score": esc_dist.get("min"),
                "separation_margin": dist.get("margin"),
                "perfectly_separated": dist.get("perfectly_separated"),
            }
        )
    pd.DataFrame(dataset_rows).to_csv(
        args.output_dir / "dataset_metrics.csv", index=False
    )

    # Score distributions in the same flat shape used by ModernBERT.
    distributions: Dict[str, Any] = {
        "jev": {
            "validation": describe_scores(
                "validation", y[splits.val_idx], val_scores
            ),
            "test_locked_diagnostic_only": describe_scores(
                "test_locked_diagnostic_only", y[splits.test_idx], test_scores
            ),
        }
    }
    if train_scores is not None:
        distributions["jev"]["train"] = describe_scores(
            "train", y[splits.train_idx], train_scores
        )

    (args.output_dir / "score_distributions.json").write_text(
        json.dumps(distributions, indent=2), encoding="utf-8"
    )

    flat_dist_rows: List[Dict[str, Any]] = []
    for model_name, split_payload in distributions.items():
        for split_name, dist in split_payload.items():
            for cls in ("safe", "escalate"):
                s = dist.get(cls)
                if not s:
                    continue
                flat_dist_rows.append(
                    {
                        "model": model_name,
                        "split": split_name,
                        "class": cls,
                        **s,
                        "max_safe_score": (dist.get("safe") or {}).get("max"),
                        "min_escalate_score": (dist.get("escalate") or {}).get("min"),
                        "separation_margin": dist.get("margin"),
                        "perfectly_separated": dist.get("perfectly_separated"),
                    }
                )
    pd.DataFrame(flat_dist_rows).to_csv(
        args.output_dir / "score_distributions.csv", index=False
    )

    # Per-row locked-test analysis, shaped similarly to ModernBERT's CSV.
    test_rows: List[Dict[str, Any]] = []
    for j, i in enumerate(splits.test_idx):
        i = int(i)
        true = int(y[i])
        score = float(test_scores[j])
        pred = int(score >= threshold)
        r = records[i]
        test_rows.append(
            {
                "id": r.get("id"),
                "original_id": r.get("id"),
                "dataset": r.get("__dataset"),
                "source_file": r.get("__source_file"),
                "text": evidence_text(r),
                "true_label": true,
                "true_label_name": (
                    "ESCALATE_TO_HUMAN" if true else "SAFE_TO_BYPASS"
                ),
                "jev_probability": score,
                "jev_prediction": pred,
                "jev_false_negative": bool(true == ESCALATE and pred == SAFE),
                "jev_false_positive": bool(true == SAFE and pred == ESCALATE),
                "group_id": group_id(r),
                "source_type": nested_get(r, "source.type"),
                "text_kind": nested_get(r, "evidence.text_kind"),
                "classification": nested_get(r, "label.classification"),
                "route": nested_get(r, "label.route"),
                "review_required": nested_get(r, "label.review_required"),
                "potential_mdr": nested_get(r, "label.potential_mdr"),
                "difficulty": nested_get(r, "annotation.difficulty"),
                "source_url": nested_get(r, "source.url"),
            }
        )

    # Same philosophy as ModernBERT: false negatives first, then all other
    # errors, then examples closest to the selected threshold.
    test_rows.sort(
        key=lambda r: (
            0 if r["jev_false_negative"] else 1,
            0 if (r["jev_false_negative"] or r["jev_false_positive"]) else 1,
            abs(float(r["jev_probability"]) - threshold),
        )
    )
    pd.DataFrame(test_rows).to_csv(
        args.output_dir / "test_error_analysis.csv", index=False
    )
    with (args.output_dir / "test_error_analysis.jsonl").open(
        "w", encoding="utf-8"
    ) as f:
        for row in test_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    # Errors-only convenience file in addition to the ModernBERT-compatible
    # all-row error-analysis artifact.
    pd.DataFrame(
        [
            r for r in test_rows
            if r["jev_false_negative"] or r["jev_false_positive"]
        ]
    ).to_csv(args.output_dir / "test_errors_only.csv", index=False)

    usage_total = {
        k: usage_val.get(k, 0) + usage_test.get(k, 0) + usage_train.get(k, 0)
        for k in {
            "input_tokens",
            "output_tokens",
            "api_calls",
            "rows_scored",
            "cache_hit_rows",
            "uncached_rows",
            "unique_new_requests",
            "duplicate_requests_avoided",
        }
    }

    # Single-row summary for easy concatenation with a ModernBERT summary.
    pd.DataFrame(
        [
            {
                "model": "jev",
                "model_id": args.model,
                "threshold_policy": "conservative",
                "target_recall": args.target_recall,
                **test_metrics,
            }
        ]
    ).to_csv(args.output_dir / "comparison_summary.csv", index=False)

    report = {
        "system": "TypeSafe Jev complaint gate",
        "model": args.model,
        "rubric_version": RUBRIC_VERSION,
        "model_feature_policy": "Only evidence.text is sent as Jev state.",
        "question": {
            "type": "noul",
            "instructions": QUESTION_INSTRUCTIONS,
            "criteria": {"true": TRUE_CRITERIA, "false": FALSE_CRITERIA},
        },
        "training_note": (
            "Jev is used zero-shot. split=train is not used to fine-tune Jev. "
            "The train partition exists to reproduce the same train/validation split; "
            "validation selects the operating threshold. Train can be scored only for "
            "diagnostic score distributions."
        ),
        "comparison_note": (
            "Metric names, threshold policy, split construction, operating recall targets, "
            "dataset stratification, score distributions and error-analysis outputs are "
            "aligned to the ModernBERT v8 experiment where meaningful. Unlike ModernBERT, "
            "Jev receives no supervised fitting on the train partition."
        ),
        "request_efficiency": (
            "Identical evidence.text values are deduplicated before requests, then one "
            "Jev score is fanned back to all duplicate rows. Missing unique texts are "
            "evaluated concurrently up to --concurrency."
        ),
        "input_sources": input_sources,
        "n_records_used": len(records),
        "split_sizes": {
            "train": int(len(splits.train_idx)),
            "val": int(len(splits.val_idx)),
            "test": int(len(splits.test_idx)),
        },
        "threshold_policy": "conservative",
        "target_recall": args.target_recall,
        "operating_recall_targets": operating_targets,
        "selected_threshold": threshold,
        "validation_metrics": val_metrics,
        "test_metrics": test_metrics,
        "score_distributions": distributions,
        "dataset_metrics": dataset_rows,
        "api_usage_new_calls_only": usage_total,
        "env_file": str(Path(__file__).resolve().with_name(".env")),
    }
    (args.output_dir / "jev_report.json").write_text(
        json.dumps(report, indent=2), encoding="utf-8"
    )

    split_map = []
    val_set = set(map(int, splits.val_idx))
    train_set = set(map(int, splits.train_idx))
    test_set = set(map(int, splits.test_idx))
    for i, r in enumerate(records):
        if i in train_set:
            assigned = "train"
        elif i in val_set:
            assigned = "val"
        elif i in test_set:
            assigned = "test"
        else:
            continue
        split_map.append(
            {
                "id": r.get("id"),
                "dataset": r.get("__dataset"),
                "declared_split": r.get("split"),
                "assigned_split": assigned,
                "group_id": group_id(r),
                "source_file": r.get("__source_file"),
            }
        )
    (args.output_dir / "jev_split_map.json").write_text(
        json.dumps(split_map, indent=2), encoding="utf-8"
    )

    print("\n=== Summary ===")
    print(f"Model: {args.model}")
    print(f"Threshold: {threshold:.6f}")
    print(
        f"TEST recall={test_metrics['escalate_recall']:.4f}, "
        f"bypass={test_metrics['traffic_bypassed']:.4f}, "
        f"FN={test_metrics['fn']}, FP={test_metrics['fp']}"
    )
    print(f"New API calls this run: {usage_total['api_calls']}")
    print(
        f"Reported token usage from new calls: input={usage_total['input_tokens']}, "
        f"output={usage_total['output_tokens']}"
    )
    print(f"Artifacts written to: {args.output_dir}")
    print("Comparison artifacts: dataset_metrics.csv, operating_points.csv, "
          "score_distributions.csv, test_error_analysis.csv, comparison_summary.csv")
    return 0


def main() -> int:
    args = parse_args()
    try:
        return asyncio.run(async_main(args))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
