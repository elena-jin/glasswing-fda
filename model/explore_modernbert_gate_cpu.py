#!/usr/bin/env python3
"""
Explore a high-recall complaint gate with frozen ModernBERT-base embeddings.

Pipeline
--------
standardized JSON -> eligible records -> deterministic model text
-> frozen ModernBERT embedding (official INT8 ONNX if usable; PyTorch CPU fallback)
-> per-record embedding cache -> linear probe -> small MLP -> threshold analysis

Expected training label (preferred):
    record["annotation"]["gate_label"] in {"ESCALATE_TO_HUMAN", "SAFE_TO_BYPASS"}

The model NEVER receives annotation fields, customer/account IDs, URLs, or native IDs.

Install (CPU):
    pip install -U numpy pandas scikit-learn joblib tqdm huggingface_hub \
        onnxruntime torch "transformers>=4.48"

Example:
    python explore_modernbert_gate_cpu.py \
        --input synthetic_records_labeled.json \
        --output-dir runs/modernbert_cpu_001 \
        --cache-dir cache/modernbert_base \
        --max-length 8192 \
        --input-format metadata \
        --target-recall 0.995

Notes
-----
* --backend auto tries answerdotai/ModernBERT-base/onnx/model_int8.onnx first.
  It inspects ONNX outputs and accepts the graph only if it exposes a token-level
  hidden-state tensor with final dimension 768. If not, it falls back to the
  PyTorch base encoder on CPU. It will NOT use masked-LM vocabulary logits as
  embeddings.
* Cache keys include formatted text, model/backend identity, max_length, pooling,
  and formatter version. Changed records/configs automatically miss the old cache.
* Every new embedding is saved immediately, so an interrupted long CPU run can resume.
* Thresholds are selected ONLY on validation data. The locked test/eval set is
  diagnostic-only and never used to choose a threshold.
* Default threshold policy is conservative: maximize bypass at the required recall,
  then prefer the LOWEST threshold among equivalent operating points.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import random
import re
import sys
import time
from datetime import datetime, timezone
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np


MODEL_ID = "answerdotai/ModernBERT-base"
ONNX_FILENAME = "onnx/model_int8.onnx"
HIDDEN_SIZE = 768
FORMATTER_VERSION = "2.0"
POOLING = "masked_mean"

POSITIVE_LABELS = {
    "ESCALATE_TO_HUMAN",
    "ESCALATE",
    "SERIOUS",
    "REVIEW",
    "1",
}
NEGATIVE_LABELS = {
    "SAFE_TO_BYPASS",
    "BYPASS",
    "NOT_SERIOUS",
    "SAFE",
    "0",
}


def eprint(*args: Any, **kwargs: Any) -> None:
    print(*args, file=sys.stderr, **kwargs)


class TeeStream:
    """Mirror console output to a persistent UTF-8 log file."""

    def __init__(self, primary: Any, log_file: Any):
        self.primary = primary
        self.log_file = log_file

    def write(self, data: str) -> int:
        self.primary.write(data)
        self.log_file.write(data)
        self.log_file.flush()
        return len(data)

    def flush(self) -> None:
        self.primary.flush()
        self.log_file.flush()

    def isatty(self) -> bool:
        return bool(getattr(self.primary, "isatty", lambda: False)())


def setup_run_logging(output_dir: Path) -> Tuple[Path, Any]:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = output_dir / f"run_{stamp}.log"
    fh = log_path.open("a", encoding="utf-8", buffering=1)
    sys.stdout = TeeStream(sys.__stdout__, fh)
    sys.stderr = TeeStream(sys.__stderr__, fh)
    return log_path, fh


def require(pkg: str, import_name: Optional[str] = None) -> Any:
    name = import_name or pkg
    try:
        return __import__(name)
    except ImportError as exc:
        raise SystemExit(
            f"Missing dependency '{pkg}'. Install dependencies with:\n"
            "  pip install -U numpy pandas scikit-learn joblib tqdm huggingface_hub "
            "onnxruntime torch \"transformers>=4.48\"\n"
        ) from exc


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    try:
        import torch

        torch.manual_seed(seed)
    except Exception:
        pass


def nested_get(obj: Dict[str, Any], path: str, default: Any = None) -> Any:
    cur: Any = obj
    for key in path.split("."):
        if not isinstance(cur, dict) or key not in cur:
            return default
        cur = cur[key]
    return cur


def load_records(paths: Sequence[Path]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Load and concatenate records from one or more JSON files.

    Each file may be either:
      * {"dataset": "...", "records": [...]}
      * a bare list of records

    The top-level dataset field is copied into an internal __dataset field on
    each record unless the record itself already has a dataset field. This
    internal field is used only for reporting / IDs and is never sent to the model.
    """
    all_records: List[Dict[str, Any]] = []
    sources: List[Dict[str, Any]] = []

    for path in paths:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)

        dataset_name: Optional[str] = None
        if isinstance(data, dict) and isinstance(data.get("records"), list):
            records = data["records"]
            dataset_name = clean_scalar(data.get("dataset"))
        elif isinstance(data, list):
            records = data
        else:
            raise ValueError(
                f"{path}: input JSON must be either a list of records or "
                "{'dataset': '...', 'records': [...]}"
            )

        if not all(isinstance(r, dict) for r in records):
            raise ValueError(f"{path}: every record must be a JSON object")

        effective_dataset = dataset_name or path.stem
        n_before = len(all_records)

        for r in records:
            rr = dict(r)
            # Prefer an explicit record-level dataset if one exists; otherwise
            # inherit the top-level file dataset.
            record_dataset = clean_scalar(rr.get("dataset")) or effective_dataset
            rr["__dataset"] = record_dataset
            rr["__source_file"] = str(path)
            all_records.append(rr)

        sources.append(
            {
                "path": str(path),
                "dataset": effective_dataset,
                "records": len(all_records) - n_before,
            }
        )

    return all_records, sources


def eligible(record: Dict[str, Any]) -> bool:
    """
    Eligibility rules:
      1) explicit intake.eligible_for_classification == True  -> include
      2) explicit intake.eligible_for_classification == False -> exclude
      3) missing intake eligibility + curated eval-only row
         (split == "eval" and eval_only == True) -> include
      4) otherwise -> exclude, with counts/logging handled upstream

    This allows curated held-out evaluation files (e.g. MAUDE) to participate
    in locked evaluation without weakening the normal upstream intake gate.
    """
    value = nested_get(record, "intake.eligible_for_classification", None)
    if value is True:
        return True
    if value is False:
        return False

    split = clean_scalar(record.get("split"))
    eval_only = record.get("eval_only") is True
    if split == "eval" and eval_only:
        return True

    return False


def eligibility_status(record: Dict[str, Any]) -> str:
    value = nested_get(record, "intake.eligible_for_classification", None)
    if value is True:
        return "explicit_true"
    if value is False:
        return "explicit_false"
    split = clean_scalar(record.get("split"))
    if split == "eval" and record.get("eval_only") is True:
        return "curated_eval_only_missing_intake"
    return "missing_or_unrecognized"


def normalize_speaker(raw: Optional[str]) -> str:
    if not raw:
        return "unknown"
    x = raw.lower()
    if "internal speculation" in x:
        return "internal_speculation"
    if "customer" in x or "patient" in x or "user" in x:
        if "employee" in x or "paraphrase" in x or "recap" in x:
            return "employee_recap_of_external_report"
        return "external_reporter"
    if "doctor" in x or "physician" in x or "clinician" in x:
        return "clinician"
    if "employee" in x or "staff" in x or "recap" in x or "paraphrase" in x:
        return "employee_recap"
    if "speaker" in x or "participant" in x:
        return "unverified_participant"
    return "other_or_unknown"


def clean_scalar(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = re.sub(r"\s+", " ", str(value)).strip()
    return s or None


def format_record(
    record: Dict[str, Any],
    input_format: str,
    include_source_type: bool,
) -> str:
    text = clean_scalar(nested_get(record, "evidence.text"))
    if not text:
        raise ValueError(f"Record {record.get('id', '<no-id>')} has no evidence.text")

    if input_format == "text":
        return text

    lines: List[str] = []
    text_kind = clean_scalar(nested_get(record, "evidence.text_kind")) or "unknown"
    speaker = normalize_speaker(clean_scalar(nested_get(record, "evidence.speaker_provenance")))
    product = clean_scalar(nested_get(record, "context.product_hint"))
    version = clean_scalar(nested_get(record, "context.version"))
    version_evidence = clean_scalar(nested_get(record, "context.version_evidence"))
    source_type = clean_scalar(nested_get(record, "source.type"))

    if include_source_type and source_type:
        lines.append(f"[SOURCE_TYPE] {source_type}")
    lines.append(f"[TEXT_KIND] {text_kind}")
    lines.append(f"[SPEAKER] {speaker}")
    if product:
        lines.append(f"[PRODUCT] {product}")
    if version:
        lines.append(f"[VERSION] {version}")
    elif version_evidence:
        lines.append(f"[VERSION_EVIDENCE] {version_evidence}")
    lines.extend(["", "[EVIDENCE]", text])
    return "\n".join(lines)


def extract_label(record: Dict[str, Any]) -> int:
    """
    Map either the gate-label schema or the dataset v1.1 classification schema
    to the binary recall-gate target.

    Positive (1): complaint / ESCALATE_TO_HUMAN
    Negative (0): product_feedback / SAFE_TO_BYPASS

    Excluded records should already have been removed by the deterministic
    intake gate and must not reach this function.
    """
    raw = nested_get(record, "annotation.gate_label")
    if raw is None:
        raw = record.get("gate_label")

    # Dataset v1.1 schema used by feedback-classifier-dataset.json
    if raw is None:
        classification = nested_get(record, "label.classification")
        if classification is not None:
            c = str(classification).strip().lower()
            if c == "complaint":
                return 1
            if c == "product_feedback":
                return 0
            raise ValueError(
                f"Unknown label.classification {classification!r} for record "
                f"{record.get('id', '<no-id>')}. Expected complaint/product_feedback."
            )

    if raw is None:
        raise ValueError(
            f"Record {record.get('id', '<no-id>')} is eligible but has neither "
            "annotation.gate_label nor label.classification."
        )

    x = str(raw).strip().upper()
    if x in POSITIVE_LABELS:
        return 1
    if x in NEGATIVE_LABELS:
        return 0
    raise ValueError(
        f"Unknown gate label {raw!r} for record {record.get('id', '<no-id>')}. "
        "Use ESCALATE_TO_HUMAN/SAFE_TO_BYPASS or complaint/product_feedback."
    )


def record_id(record: Dict[str, Any], index: int) -> str:
    original = clean_scalar(record.get("id")) or f"row-{index:06d}"
    dataset_name = clean_scalar(record.get("__dataset"))
    if dataset_name:
        return f"{dataset_name}::{original}"
    return original


def original_record_id(record: Dict[str, Any], index: int) -> str:
    return clean_scalar(record.get("id")) or f"row-{index:06d}"


def record_dataset(record: Dict[str, Any]) -> str:
    return clean_scalar(record.get("__dataset")) or clean_scalar(record.get("dataset")) or "<unknown>"


def group_id(record: Dict[str, Any]) -> Optional[str]:
    """
    Grouping key used to reduce source/incident leakage.

    Priority:
      explicit annotation/group ids
      contrast_group_id
      for real-public records, source URL/thread/review
    """
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


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class EmbedConfig:
    model_id: str
    backend: str
    model_artifact: str
    max_length: int
    pooling: str
    formatter_version: str
    input_format: str
    include_source_type: bool

    def fingerprint(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return sha256_text(payload)


def cache_key(formatted_text: str, config: EmbedConfig) -> str:
    payload = config.fingerprint() + "\n" + formatted_text
    return sha256_text(payload)


def masked_mean_pool(hidden: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
    # hidden: [B, T, H], mask: [B, T]
    mask = attention_mask.astype(np.float32)[..., None]
    denom = np.clip(mask.sum(axis=1), 1.0, None)
    pooled = (hidden.astype(np.float32) * mask).sum(axis=1) / denom
    return pooled.astype(np.float32)


class BaseEncoder:
    backend_name: str
    model_artifact: str

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        raise NotImplementedError


class OnnxInt8Encoder(BaseEncoder):
    backend_name = "onnx_int8"
    model_artifact = ONNX_FILENAME

    def __init__(self, model_id: str, max_length: int, threads: int = 0):
        require("onnxruntime")
        require("huggingface_hub")
        require("transformers")
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from transformers import AutoTokenizer

        self.max_length = max_length
        self.tokenizer = AutoTokenizer.from_pretrained(model_id)
        model_path = hf_hub_download(repo_id=model_id, filename=ONNX_FILENAME)

        opts = ort.SessionOptions()
        if threads > 0:
            opts.intra_op_num_threads = threads
            opts.inter_op_num_threads = max(1, threads // 2)
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

        self.session = ort.InferenceSession(
            model_path,
            sess_options=opts,
            providers=["CPUExecutionProvider"],
        )
        self.input_names = {x.name for x in self.session.get_inputs()}
        self.output_meta = self.session.get_outputs()
        print("ONNX inputs:", [(x.name, x.shape, x.type) for x in self.session.get_inputs()])
        print("ONNX outputs:", [(x.name, x.shape, x.type) for x in self.output_meta])

    def _tokenize(self, texts: Sequence[str]) -> Dict[str, np.ndarray]:
        toks = self.tokenizer(
            list(texts),
            padding=True,
            truncation=True,
            max_length=self.max_length,
            return_tensors="np",
        )
        feeds: Dict[str, np.ndarray] = {}
        for name in self.input_names:
            if name in toks:
                arr = toks[name]
                if arr.dtype != np.int64:
                    arr = arr.astype(np.int64)
                feeds[name] = arr
        if "input_ids" not in feeds:
            raise RuntimeError(f"ONNX graph inputs {self.input_names} did not accept tokenizer input_ids")
        return feeds

    @staticmethod
    def _find_hidden(outputs: Sequence[np.ndarray]) -> Optional[np.ndarray]:
        candidates = [
            x
            for x in outputs
            if isinstance(x, np.ndarray) and x.ndim == 3 and x.shape[-1] == HIDDEN_SIZE
        ]
        if not candidates:
            return None
        # Prefer the tensor with the longest sequence axis if there is more than one.
        candidates.sort(key=lambda x: x.shape[1], reverse=True)
        return candidates[0]

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        feeds = self._tokenize(texts)
        outputs = self.session.run(None, feeds)
        hidden = self._find_hidden(outputs)
        if hidden is None:
            shapes = [getattr(x, "shape", None) for x in outputs]
            raise RuntimeError(
                "Official INT8 ONNX export did not expose a [batch, seq, 768] hidden-state "
                f"tensor. Returned shapes: {shapes}. Refusing to use MLM logits as embeddings."
            )
        mask = feeds.get("attention_mask")
        if mask is None:
            mask = np.ones(hidden.shape[:2], dtype=np.int64)
        return masked_mean_pool(hidden, mask)


class TorchEncoder(BaseEncoder):
    backend_name = "torch_fp32"
    model_artifact = "model.safetensors/base-encoder"

    def __init__(
        self,
        model_id: str,
        max_length: int,
        threads: int = 0,
        dynamic_int8: bool = False,
    ):
        require("torch")
        require("transformers")
        import torch
        from transformers import AutoModel, AutoTokenizer

        self.torch = torch
        self.max_length = max_length
        if threads > 0:
            torch.set_num_threads(threads)
        self.tokenizer = AutoTokenizer.from_pretrained(model_id)
        print("Loading PyTorch base encoder on CPU...")
        self.model = AutoModel.from_pretrained(model_id)
        self.model.eval()
        self.model.to("cpu")

        if dynamic_int8:
            print("Attempting PyTorch dynamic INT8 quantization of Linear layers...")
            try:
                self.model = torch.ao.quantization.quantize_dynamic(
                    self.model, {torch.nn.Linear}, dtype=torch.qint8
                )
                self.backend_name = "torch_dynamic_int8"
                self.model_artifact = "model.safetensors/base-encoder+dynamic-int8"
                print("Dynamic INT8 quantization enabled.")
            except Exception as exc:
                eprint(f"WARNING: dynamic INT8 quantization failed; staying FP32: {exc}")

    def encode(self, texts: Sequence[str]) -> np.ndarray:
        torch = self.torch
        toks = self.tokenizer(
            list(texts),
            padding=True,
            truncation=True,
            max_length=self.max_length,
            return_tensors="pt",
        )
        toks = {k: v.to("cpu") for k, v in toks.items()}
        with torch.inference_mode():
            out = self.model(**toks)
            hidden = out.last_hidden_state
            mask = toks.get("attention_mask")
            if mask is None:
                mask = torch.ones(hidden.shape[:2], dtype=torch.long)
            maskf = mask.unsqueeze(-1).to(hidden.dtype)
            pooled = (hidden * maskf).sum(dim=1) / maskf.sum(dim=1).clamp_min(1.0)
        return pooled.float().cpu().numpy().astype(np.float32)


def choose_encoder(args: argparse.Namespace, probe_text: str) -> BaseEncoder:
    errors: List[str] = []
    if args.backend in ("auto", "onnx"):
        try:
            enc = OnnxInt8Encoder(MODEL_ID, args.max_length, args.threads)
            # Preflight before any cache is written, preventing mixed embedding spaces.
            probe = enc.encode([probe_text])
            if probe.shape != (1, HIDDEN_SIZE):
                raise RuntimeError(f"Unexpected ONNX pooled embedding shape {probe.shape}")
            print("Using official INT8 ONNX encoder on CPU.")
            return enc
        except Exception as exc:
            errors.append(f"ONNX INT8: {exc}")
            if args.backend == "onnx":
                raise
            eprint("WARNING: official ONNX INT8 backend is not usable for feature extraction.")
            eprint(f"         {exc}")
            eprint("         Falling back to PyTorch base encoder on CPU.")

    if args.backend in ("auto", "torch"):
        enc = TorchEncoder(
            MODEL_ID,
            args.max_length,
            args.threads,
            dynamic_int8=args.torch_dynamic_int8,
        )
        probe = enc.encode([probe_text])
        if probe.shape != (1, HIDDEN_SIZE):
            raise RuntimeError(f"Unexpected PyTorch pooled embedding shape {probe.shape}")
        print(f"Using {enc.backend_name} encoder on CPU.")
        return enc

    raise RuntimeError("Could not initialize encoder: " + " | ".join(errors))


def get_embeddings(
    encoder: BaseEncoder,
    texts: Sequence[str],
    ids: Sequence[str],
    config: EmbedConfig,
    cache_dir: Path,
    recompute: bool,
    batch_size: int,
) -> np.ndarray:
    cache_dir.mkdir(parents=True, exist_ok=True)
    emb_dir = cache_dir / "embeddings"
    meta_dir = cache_dir / "metadata"
    emb_dir.mkdir(exist_ok=True)
    meta_dir.mkdir(exist_ok=True)

    n = len(texts)
    result = np.empty((n, HIDDEN_SIZE), dtype=np.float32)
    missing: List[Tuple[int, str, str, Path, Path]] = []

    for i, (rid, text) in enumerate(zip(ids, texts)):
        key = cache_key(text, config)
        emb_path = emb_dir / f"{key}.npy"
        meta_path = meta_dir / f"{key}.json"
        if not recompute and emb_path.exists():
            try:
                arr = np.load(emb_path)
                if arr.shape == (HIDDEN_SIZE,):
                    result[i] = arr.astype(np.float32)
                    continue
            except Exception:
                pass
        missing.append((i, rid, text, emb_path, meta_path))

    hits = n - len(missing)
    print(f"Embedding cache: {hits}/{n} hits; {len(missing)} records to encode")
    if not missing:
        return result

    started = time.time()
    completed = 0
    # Long 8k contexts are RAM-heavy; default batch_size=1 is intentionally conservative.
    for start in range(0, len(missing), batch_size):
        batch = missing[start : start + batch_size]
        batch_texts = [x[2] for x in batch]
        batch_embeddings = encoder.encode(batch_texts)
        if batch_embeddings.shape != (len(batch), HIDDEN_SIZE):
            raise RuntimeError(f"Bad embedding batch shape: {batch_embeddings.shape}")

        for emb, (idx, rid, text, emb_path, meta_path) in zip(batch_embeddings, batch):
            emb = np.asarray(emb, dtype=np.float32)
            # Atomic-ish write: save temp file then replace.
            tmp_path = emb_path.with_suffix(".tmp.npy")
            np.save(tmp_path, emb)
            os.replace(tmp_path, emb_path)
            meta = {
                "record_id": rid,
                "cache_key": emb_path.stem,
                "input_hash": sha256_text(text),
                "embed_config": asdict(config),
                "created_at_unix": time.time(),
            }
            tmp_meta = meta_path.with_suffix(".tmp.json")
            with tmp_meta.open("w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)
            os.replace(tmp_meta, meta_path)
            result[idx] = emb
            completed += 1

        elapsed = time.time() - started
        rate = completed / elapsed if elapsed else 0.0
        remaining = (len(missing) - completed) / rate if rate else math.inf
        print(
            f"Encoded {completed}/{len(missing)} missing records | "
            f"{elapsed/60:.1f} min elapsed | ETA {remaining/60:.1f} min",
            flush=True,
        )

    return result


def split_indices(
    labels: np.ndarray,
    groups: Sequence[Optional[str]],
    val_size: float,
    test_size: float,
    seed: int,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    require("scikit-learn", "sklearn")
    from sklearn.model_selection import GroupShuffleSplit, train_test_split

    idx = np.arange(len(labels))
    all_groups_present = bool(groups) and all(g is not None for g in groups)

    if all_groups_present and len(set(groups)) >= 4:
        print("Using group-aware splits (annotation.group_id/group_id detected for every row).")
        temp_fraction = val_size + test_size
        gss1 = GroupShuffleSplit(n_splits=1, test_size=temp_fraction, random_state=seed)
        train_rel, temp_rel = next(gss1.split(idx, labels, groups=np.array(groups)))
        train_idx = idx[train_rel]
        temp_idx = idx[temp_rel]
        temp_groups = np.array(groups, dtype=object)[temp_rel]
        rel_test = test_size / temp_fraction
        gss2 = GroupShuffleSplit(n_splits=1, test_size=rel_test, random_state=seed + 1)
        val_rel, test_rel = next(
            gss2.split(temp_idx, labels[temp_idx], groups=temp_groups)
        )
        return train_idx, temp_idx[val_rel], temp_idx[test_rel]

    print("Using stratified row-level splits. Add annotation.group_id to prevent incident-level leakage.")
    try:
        train_idx, temp_idx = train_test_split(
            idx,
            test_size=val_size + test_size,
            random_state=seed,
            stratify=labels,
        )
        rel_test = test_size / (val_size + test_size)
        val_idx, test_idx = train_test_split(
            temp_idx,
            test_size=rel_test,
            random_state=seed + 1,
            stratify=labels[temp_idx],
        )
    except ValueError as exc:
        raise ValueError(
            f"Could not make stratified train/val/test splits: {exc}. "
            "You likely need more labeled examples from each class."
        ) from exc
    return train_idx, val_idx, test_idx


def binary_metrics(y_true: np.ndarray, prob: np.ndarray, threshold: float) -> Dict[str, float]:
    require("scikit-learn", "sklearn")
    from sklearn.metrics import (
        average_precision_score,
        confusion_matrix,
        precision_score,
        recall_score,
        roc_auc_score,
    )

    pred = (prob >= threshold).astype(np.int64)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    metrics: Dict[str, float] = {
        "threshold": float(threshold),
        "n": int(len(y_true)),
        "tp": int(tp),
        "fp": int(fp),
        "tn": int(tn),
        "fn": int(fn),
        "escalate_recall": float(recall_score(y_true, pred, zero_division=0)),
        "escalate_precision": float(precision_score(y_true, pred, zero_division=0)),
        "false_negative_rate": float(fn / (fn + tp)) if (fn + tp) else 0.0,
        "specificity": float(tn / (tn + fp)) if (tn + fp) else 0.0,
        "traffic_bypassed": float((pred == 0).mean()),
        "safe_bypass_precision": float(tn / (tn + fn)) if (tn + fn) else 1.0,
    }
    if len(np.unique(y_true)) == 2:
        metrics["roc_auc"] = float(roc_auc_score(y_true, prob))
        metrics["pr_auc"] = float(average_precision_score(y_true, prob))
    else:
        metrics["roc_auc"] = float("nan")
        metrics["pr_auc"] = float("nan")
    return metrics


def select_threshold_for_recall(
    y_true: np.ndarray,
    prob: np.ndarray,
    target_recall: float,
    policy: str = "conservative",
    safety_margin_fraction: float = 0.25,
    fixed_threshold: Optional[float] = None,
) -> Tuple[float, Dict[str, float]]:
    """
    Select an operating threshold using VALIDATION DATA ONLY.

    Policies
    --------
    conservative (default):
        Maximize traffic bypassed subject to recall >= target, then maximize
        safe-bypass precision, then choose the LOWEST threshold among otherwise
        equivalent operating points. This is the recall-first tie-break.

    max_bypass:
        Same optimization, but choose the HIGHEST threshold among equivalent
        operating points. This reproduces the earlier/aggressive tie-break.

    safety_margin:
        If validation classes have a clean score gap, choose a threshold inside
        that gap:
            max_negative + fraction * (min_positive - max_negative)
        where fraction defaults to 0.25 (closer to negatives, hence conservative).
        The candidate is accepted only if it still meets target recall. Otherwise
        it falls back to the conservative policy.

    fixed:
        Use --fixed-threshold exactly. Useful only when intentionally evaluating
        a precommitted operating point. No tuning occurs.
    """
    policy = str(policy).strip().lower()
    valid = {"conservative", "max_bypass", "safety_margin", "fixed"}
    if policy not in valid:
        raise ValueError(f"Unknown threshold policy {policy!r}; choose from {sorted(valid)}")

    if policy == "fixed":
        if fixed_threshold is None:
            raise ValueError("threshold policy 'fixed' requires --fixed-threshold")
        if not (0.0 <= fixed_threshold <= 1.0):
            raise ValueError("--fixed-threshold must be in [0,1]")
        m = binary_metrics(y_true, prob, float(fixed_threshold))
        return float(fixed_threshold), m

    # Safety-margin mode is intentionally simple and interpretable. It only
    # activates when validation scores are perfectly separated by class.
    if policy == "safety_margin":
        neg = prob[y_true == 0]
        pos = prob[y_true == 1]
        if len(neg) and len(pos):
            max_neg = float(np.max(neg))
            min_pos = float(np.min(pos))
            if max_neg < min_pos:
                frac = float(safety_margin_fraction)
                if not (0.0 <= frac <= 1.0):
                    raise ValueError("--safety-margin-fraction must be in [0,1]")
                candidate = max_neg + frac * (min_pos - max_neg)
                m = binary_metrics(y_true, prob, candidate)
                if m["escalate_recall"] + 1e-12 >= target_recall:
                    return float(candidate), m
        # If no clean gap, fall through to the conservative recall-constrained policy.
        policy = "conservative"

    # Positive if prob >= threshold. Include both observed scores and the
    # smallest representable value just ABOVE each score. This matters for the
    # conservative policy: an entire open interval can produce the same
    # confusion matrix, and we want the lowest threshold in that equivalent
    # interval rather than being forced onto the next positive's score.
    above = np.nextafter(prob.astype(np.float64), np.inf)
    candidates = np.unique(
        np.concatenate(([0.0], prob.astype(np.float64), above, [1.0 + 1e-8]))
    )
    best: Optional[Dict[str, float]] = None
    best_t = 0.0

    for t in candidates:
        t = float(t)
        m = binary_metrics(y_true, prob, t)
        if m["escalate_recall"] + 1e-12 < target_recall:
            continue

        if best is None:
            best, best_t = m, t
            continue

        # Primary objective: maximize traffic bypassed at required recall.
        # Secondary: maximize precision among bypassed rows.
        # Final tie-break depends on policy.
        if policy == "conservative":
            key = (m["traffic_bypassed"], m["safe_bypass_precision"], -t)
            best_key = (
                best["traffic_bypassed"],
                best["safe_bypass_precision"],
                -best_t,
            )
        else:  # max_bypass / aggressive historical behavior
            key = (m["traffic_bypassed"], m["safe_bypass_precision"], t)
            best_key = (
                best["traffic_bypassed"],
                best["safe_bypass_precision"],
                best_t,
            )

        if key > best_key:
            best, best_t = m, t

    if best is None:
        # Threshold 0 predicts everything positive and should achieve recall 1
        # whenever positives exist.
        best_t = 0.0
        best = binary_metrics(y_true, prob, best_t)

    return best_t, best


def score_distribution(y_true: np.ndarray, prob: np.ndarray) -> Dict[str, Any]:
    """Class-conditional score diagnostics. Never used to tune on locked eval."""
    def summarize(values: np.ndarray) -> Dict[str, float]:
        if len(values) == 0:
            return {}
        qs = np.percentile(values, [0, 1, 5, 50, 95, 99, 100])
        return {
            "n": int(len(values)),
            "min": float(qs[0]),
            "p01": float(qs[1]),
            "p05": float(qs[2]),
            "p50": float(qs[3]),
            "p95": float(qs[4]),
            "p99": float(qs[5]),
            "max": float(qs[6]),
        }

    neg = prob[y_true == 0]
    pos = prob[y_true == 1]
    out: Dict[str, Any] = {
        "safe": summarize(neg),
        "escalate": summarize(pos),
    }
    if len(neg) and len(pos):
        max_neg = float(np.max(neg))
        min_pos = float(np.min(pos))
        out["max_safe_score"] = max_neg
        out["min_escalate_score"] = min_pos
        out["separation_margin"] = float(min_pos - max_neg)
        out["perfectly_separated"] = bool(max_neg < min_pos)
    return out


def print_score_distribution(model_name: str, split_name: str, dist: Dict[str, Any]) -> None:
    print(f"\n{model_name} score distribution [{split_name}]")
    for label in ("safe", "escalate"):
        s = dist.get(label, {})
        if not s:
            print(f"  {label}: <none>")
            continue
        print(
            f"  {label:<8} n={s['n']:>4} "
            f"min={s['min']:.6f} p01={s['p01']:.6f} p05={s['p05']:.6f} "
            f"p50={s['p50']:.6f} p95={s['p95']:.6f} p99={s['p99']:.6f} "
            f"max={s['max']:.6f}"
        )
    if "separation_margin" in dist:
        print(
            f"  max_safe={dist['max_safe_score']:.6f} "
            f"min_escalate={dist['min_escalate_score']:.6f} "
            f"margin={dist['separation_margin']:.6f} "
            f"perfectly_separated={dist['perfectly_separated']}"
        )


def threshold_sweep_rows(
    y_true: np.ndarray,
    prob: np.ndarray,
    max_points: int = 1000,
) -> List[Dict[str, float]]:
    """Return decision metrics across unique score thresholds for audit/plots."""
    candidates = np.unique(np.concatenate(([0.0], prob, [1.0 + 1e-8])))
    if len(candidates) > max_points:
        # Preserve score ordering while keeping output manageable.
        q = np.linspace(0, len(candidates) - 1, max_points).round().astype(int)
        candidates = candidates[q]
    return [binary_metrics(y_true, prob, float(t)) for t in candidates]



def parse_recall_targets(raw: str) -> List[float]:
    values: List[float] = []
    for part in str(raw).split(","):
        part = part.strip()
        if not part:
            continue
        try:
            value = float(part)
        except ValueError as exc:
            raise ValueError(f"Invalid recall target {part!r}") from exc
        if not (0.0 < value <= 1.0):
            raise ValueError(f"Recall targets must be in (0,1], got {value}")
        values.append(value)
    if not values:
        raise ValueError("At least one operating recall target is required")
    return list(dict.fromkeys(values))


def operating_points_for_targets(
    y_val: np.ndarray,
    p_val: np.ndarray,
    y_test: np.ndarray,
    p_test: np.ndarray,
    recall_targets: Sequence[float],
) -> List[Dict[str, Any]]:
    """
    Compare conservative recall-constrained operating points.

    Every threshold is selected using validation data only. Locked-test metrics
    are reported afterward and NEVER influence threshold selection.
    """
    rows: List[Dict[str, Any]] = []
    for target in recall_targets:
        threshold, val_metrics = select_threshold_for_recall(
            y_val,
            p_val,
            float(target),
            policy="conservative",
        )
        rows.append(
            {
                "target_recall": float(target),
                "selected_threshold": float(threshold),
                "validation": val_metrics,
                "test_locked_diagnostic_only": binary_metrics(
                    y_test, p_test, threshold
                ),
            }
        )
    return rows


def flatten_operating_points(
    model_name: str,
    points: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for item in points:
        base = {
            "model": model_name,
            "target_recall": item["target_recall"],
            "selected_threshold": item["selected_threshold"],
        }
        for split_key, split_name in (
            ("validation", "validation"),
            ("test_locked_diagnostic_only", "test_locked_diagnostic_only"),
        ):
            row = dict(base)
            row["split"] = split_name
            row.update(item[split_key])
            rows.append(row)
    return rows


def print_operating_points(
    model_name: str,
    points: Sequence[Dict[str, Any]],
) -> None:
    print(f"\n=== {model_name} conservative operating-point comparison ===")
    print(
        "target  threshold   split       recall    bypass     FN   FP   "
        "safe_bypass_precision"
    )
    for item in points:
        target = item["target_recall"]
        threshold = item["selected_threshold"]
        for key, short in (
            ("validation", "val"),
            ("test_locked_diagnostic_only", "test"),
        ):
            m = item[key]
            print(
                f"{target:>6.3f}  {threshold:>9.6f}   {short:<5}   "
                f"{m['escalate_recall']:>8.4f}  {m['traffic_bypassed']:>8.4f}  "
                f"{m['fn']:>3}  {m['fp']:>3}  {m['safe_bypass_precision']:>8.4f}"
            )


def cohort_eval_metrics(
    records: Sequence[Dict[str, Any]],
    y_true: np.ndarray,
    prob: np.ndarray,
    threshold: float,
) -> Dict[str, Any]:
    """
    Optional locked-eval cohort diagnostics for real/adversarial/hard examples.
    These metrics are never used for threshold tuning.
    """
    fields = {
        "provenance_kind": "provenance.kind",
        "difficulty": "difficulty",
        "annotation_difficulty": "annotation.difficulty",
        "origin": "annotation.origin",
    }
    out: Dict[str, Any] = {}
    for name, path in fields.items():
        buckets: Dict[str, List[int]] = {}
        for i, record in enumerate(records):
            value = nested_get(record, path)
            if value is None:
                continue
            buckets.setdefault(str(value), []).append(i)
        if not buckets:
            continue
        out[name] = {}
        for key, idxs in buckets.items():
            yy = y_true[idxs]
            pp = prob[idxs]
            out[name][key] = binary_metrics(yy, pp, threshold)
    return out


def stratified_eval_metrics(
    records: Sequence[Dict[str, Any]],
    y_true: np.ndarray,
    prob: np.ndarray,
    threshold: float,
) -> Dict[str, Any]:
    """Useful subgroup diagnostics; never used for threshold tuning."""
    out: Dict[str, Any] = {}
    fields = {
        "theme_id": "label.theme_id",
        "source_type": "source.type",
        "potential_mdr": "label.potential_mdr",
        "provenance_kind": "provenance.kind",
    }
    for name, path in fields.items():
        buckets: Dict[str, List[int]] = {}
        for i, r in enumerate(records):
            v = nested_get(r, path)
            key = "<missing>" if v is None else str(v)
            buckets.setdefault(key, []).append(i)
        rows = {}
        for key, idxs in buckets.items():
            if len(idxs) < 5:
                continue
            yy = y_true[idxs]
            pp = prob[idxs]
            rows[key] = binary_metrics(yy, pp, threshold)
        out[name] = rows
    return out



def one_class_safe_metrics(
    y_true: np.ndarray,
    prob: np.ndarray,
    threshold: float,
) -> Dict[str, Any]:
    """
    Metrics that remain meaningful when a dataset contains only one class.

    For all-positive cohorts, recall/FN/escalation rate are meaningful.
    For all-negative cohorts, specificity/FP/bypass rate are meaningful.
    ROC-AUC/PR-AUC are intentionally omitted when only one class is present.
    """
    pred = (prob >= threshold).astype(np.int64)
    n = int(len(y_true))
    positives = int(np.sum(y_true == 1))
    negatives = int(np.sum(y_true == 0))
    tp = int(np.sum((y_true == 1) & (pred == 1)))
    fn = int(np.sum((y_true == 1) & (pred == 0)))
    tn = int(np.sum((y_true == 0) & (pred == 0)))
    fp = int(np.sum((y_true == 0) & (pred == 1)))

    out: Dict[str, Any] = {
        "threshold": float(threshold),
        "n": n,
        "positives": positives,
        "negatives": negatives,
        "tp": tp,
        "fn": fn,
        "tn": tn,
        "fp": fp,
        "traffic_bypassed": float((pred == 0).mean()) if n else 0.0,
        "escalation_rate": float((pred == 1).mean()) if n else 0.0,
    }

    if positives:
        out["escalate_recall"] = float(tp / positives)
        out["false_negative_rate"] = float(fn / positives)
    else:
        out["escalate_recall"] = None
        out["false_negative_rate"] = None

    if negatives:
        out["specificity"] = float(tn / negatives)
        out["false_positive_rate"] = float(fp / negatives)
        out["safe_bypass_precision"] = float(tn / (tn + fn)) if (tn + fn) else 1.0
    else:
        out["specificity"] = None
        out["false_positive_rate"] = None
        out["safe_bypass_precision"] = None

    if positives and negatives:
        out.update(binary_metrics(y_true, prob, threshold))

    return out


def dataset_stratified_metrics(
    records: Sequence[Dict[str, Any]],
    y_true: np.ndarray,
    prob: np.ndarray,
    threshold: float,
) -> Dict[str, Any]:
    """
    Metrics and score distributions stratified by the JSON dataset field.

    Dataset identity is reporting-only and is never used as a model feature.
    """
    buckets: Dict[str, List[int]] = {}
    for i, r in enumerate(records):
        buckets.setdefault(record_dataset(r), []).append(i)

    out: Dict[str, Any] = {}
    for dataset_name, idxs in sorted(buckets.items()):
        yy = y_true[idxs]
        pp = prob[idxs]
        out[dataset_name] = {
            "metrics": one_class_safe_metrics(yy, pp, threshold),
            "score_distribution": score_distribution(yy, pp),
            "n": int(len(idxs)),
            "safe_n": int(np.sum(yy == 0)),
            "escalate_n": int(np.sum(yy == 1)),
        }
    return out


def print_dataset_stratified_metrics(
    model_name: str,
    split_name: str,
    dataset_metrics: Dict[str, Any],
) -> None:
    print(f"\n=== {model_name} metrics by dataset [{split_name}] ===")
    for dataset_name, payload in dataset_metrics.items():
        m = payload["metrics"]
        recall = m.get("escalate_recall")
        precision = m.get("escalate_precision")
        recall_s = "n/a" if recall is None else f"{recall:.4f}"
        precision_s = "n/a" if precision is None else f"{precision:.4f}"
        print(
            f"{dataset_name}: n={payload['n']} "
            f"safe={payload['safe_n']} escalate={payload['escalate_n']} | "
            f"recall={recall_s} "
            f"precision={precision_s} "
            f"bypass={m['traffic_bypassed']:.4f} "
            f"FN={m['fn']} FP={m['fp']}"
        )



def structure_leakage_audit(
    records: Sequence[Dict[str, Any]],
    y_true: np.ndarray,
    split_name: str,
) -> Dict[str, Any]:
    """
    Diagnostic-only audit of structured fields that are NOT part of the default
    text-only model input. High label purity here is a warning that metadata
    could become a shortcut if later added to the model.
    """
    fields = {
        "dataset": "__dataset",
        "source_type": "source.type",
        "text_kind": "evidence.text_kind",
        "speaker_provenance_raw": "evidence.speaker_provenance",
        "product_hint": "context.product_hint",
        "version_evidence": "context.version_evidence",
        "provenance_kind": "provenance.kind",
        "synthetic_flag": "synthetic",
        "eval_only": "eval_only",
        "intake_eligible": "intake.eligible_for_classification",
        "difficulty": "annotation.difficulty",
    }
    out: Dict[str, Any] = {
        "split": split_name,
        "note": (
            "Diagnostic only. These fields are not used by default text-only model input. "
            "Values with near-pure labels indicate shortcut risk if metadata is added later."
        ),
        "fields": {},
    }
    for field_name, path in fields.items():
        buckets: Dict[str, List[int]] = {}
        for i, r in enumerate(records):
            v = nested_get(r, path)
            if v is None and path == "__dataset":
                v = r.get("__dataset")
            if v is None:
                key = "<missing>"
            else:
                key = clean_scalar(v) or "<empty>"
            buckets.setdefault(key, []).append(i)

        rows = []
        weighted_majority_correct = 0
        for value, idxs in sorted(buckets.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            yy = y_true[idxs]
            pos = int(np.sum(yy == 1))
            neg = int(np.sum(yy == 0))
            n = len(idxs)
            pos_rate = float(pos / n) if n else 0.0
            purity = max(pos, neg) / n if n else 0.0
            weighted_majority_correct += max(pos, neg)
            rows.append({
                "value": value,
                "n": n,
                "safe": neg,
                "escalate": pos,
                "escalate_rate": pos_rate,
                "label_purity": float(purity),
            })
        out["fields"][field_name] = {
            "n_values": len(rows),
            "majority_lookup_accuracy": float(weighted_majority_correct / len(y_true)) if len(y_true) else None,
            "values": rows[:100],
        }
    return out


def print_structure_leakage_summary(audit: Dict[str, Any]) -> None:
    print(f"\n=== Structured-field shortcut audit [{audit['split']}] ===")
    print("Default model input is evidence.text ONLY; this audit is diagnostic.")
    for field_name, payload in audit["fields"].items():
        acc = payload["majority_lookup_accuracy"]
        high_purity = sum(
            1 for row in payload["values"]
            if row["n"] >= 5 and row["label_purity"] >= 0.95
        )
        print(
            f"  {field_name:<24} values={payload['n_values']:<4} "
            f"majority_lookup_acc={acc:.3f} high_purity_values(n>=5)={high_purity}"
        )


def fit_linear_probe(
    X_train: np.ndarray,
    y_train: np.ndarray,
    class_weight: Optional[str],
    seed: int,
):
    require("scikit-learn", "sklearn")
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    cw = "balanced" if class_weight == "balanced" else None
    model = Pipeline(
        [
            ("scale", StandardScaler()),
            (
                "clf",
                LogisticRegression(
                    max_iter=5000,
                    class_weight=cw,
                    random_state=seed,
                    solver="lbfgs",
                ),
            ),
        ]
    )
    model.fit(X_train, y_train)
    return model


class TinyMLP:
    # Wrapper to keep torch imports localized.
    def __init__(self, input_dim: int, hidden_dim: int, dropout: float):
        import torch.nn as nn

        self.module = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, 1),
        )


def train_mlp(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    hidden_dim: int,
    dropout: float,
    lr: float,
    weight_decay: float,
    batch_size: int,
    epochs: int,
    patience: int,
    seed: int,
):
    require("torch")
    require("scikit-learn", "sklearn")
    import torch
    from sklearn.preprocessing import StandardScaler
    from torch.utils.data import DataLoader, TensorDataset

    torch.manual_seed(seed)
    scaler = StandardScaler()
    Xtr = scaler.fit_transform(X_train).astype(np.float32)
    Xv = scaler.transform(X_val).astype(np.float32)

    model = TinyMLP(Xtr.shape[1], hidden_dim, dropout).module
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    loss_fn = torch.nn.BCEWithLogitsLoss()

    ds = TensorDataset(
        torch.from_numpy(Xtr), torch.from_numpy(y_train.astype(np.float32))
    )
    loader = DataLoader(ds, batch_size=batch_size, shuffle=True)

    Xv_t = torch.from_numpy(Xv)
    yv_t = torch.from_numpy(y_val.astype(np.float32))

    best_loss = float("inf")
    best_state = None
    bad_epochs = 0
    history: List[Dict[str, float]] = []

    for epoch in range(1, epochs + 1):
        model.train()
        train_loss_sum = 0.0
        count = 0
        for xb, yb in loader:
            opt.zero_grad(set_to_none=True)
            logits = model(xb).squeeze(-1)
            loss = loss_fn(logits, yb)
            loss.backward()
            opt.step()
            train_loss_sum += float(loss.item()) * len(xb)
            count += len(xb)

        model.eval()
        with torch.inference_mode():
            val_logits = model(Xv_t).squeeze(-1)
            val_loss = float(loss_fn(val_logits, yv_t).item())
        train_loss = train_loss_sum / max(1, count)
        history.append({"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss})
        print(f"MLP epoch {epoch:03d}: train_loss={train_loss:.5f} val_loss={val_loss:.5f}")

        if val_loss < best_loss - 1e-6:
            best_loss = val_loss
            best_state = copy.deepcopy(model.state_dict())
            bad_epochs = 0
        else:
            bad_epochs += 1
            if bad_epochs >= patience:
                print(f"MLP early stopping after epoch {epoch}.")
                break

    if best_state is not None:
        model.load_state_dict(best_state)
    model.eval()
    return model, scaler, history


def mlp_predict_proba(model: Any, scaler: Any, X: np.ndarray) -> np.ndarray:
    import torch

    Xs = scaler.transform(X).astype(np.float32)
    with torch.inference_mode():
        logits = model(torch.from_numpy(Xs)).squeeze(-1)
        return torch.sigmoid(logits).cpu().numpy().astype(np.float64)


def to_jsonable(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_jsonable(x) for x in obj]
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    return obj


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, required=True, help="Directory containing input .json datasets (non-recursive)")
    parser.add_argument("--output-dir", type=Path, default=Path("runs/modernbert_gate"))
    parser.add_argument("--cache-dir", type=Path, default=Path("cache/modernbert_base"))
    parser.add_argument("--backend", choices=["auto", "onnx", "torch"], default="auto")
    parser.add_argument(
        "--torch-dynamic-int8",
        action="store_true",
        help="If PyTorch fallback is used, attempt dynamic INT8 quantization of Linear layers.",
    )
    parser.add_argument("--max-length", type=int, default=8192)
    parser.add_argument(
        "--embedding-batch-size",
        type=int,
        default=1,
        help="Keep 1 for ~8k-token CPU inputs unless you have plenty of RAM.",
    )
    parser.add_argument("--threads", type=int, default=0, help="CPU threads; 0 lets runtime decide")
    parser.add_argument("--input-format", choices=["text", "metadata"], default="text", help="Model feature view. Default text uses ONLY evidence.text; metadata is an explicit ablation.")
    parser.add_argument("--include-source-type", action="store_true")
    parser.add_argument("--recompute-embeddings", action="store_true")
    parser.add_argument("--val-size", type=float, default=0.15)
    parser.add_argument("--test-size", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--target-recall", type=float, default=0.995)
    parser.add_argument(
        "--operating-recalls",
        type=str,
        default="1.0,0.995,0.99",
        help=(
            "Comma-separated validation recall targets for conservative operating-point "
            "comparison; thresholds are selected on validation only."
        ),
    )
    parser.add_argument(
        "--threshold-policy",
        choices=["conservative", "max_bypass", "safety_margin", "fixed"],
        default="conservative",
        help=(
            "Threshold selection policy. Default conservative maximizes bypass at the "
            "target recall and prefers the lowest equivalent threshold."
        ),
    )
    parser.add_argument(
        "--safety-margin-fraction",
        type=float,
        default=0.25,
        help=(
            "For --threshold-policy safety_margin, place the threshold this fraction "
            "of the way from max SAFE score toward min ESCALATE score on validation."
        ),
    )
    parser.add_argument(
        "--fixed-threshold",
        type=float,
        default=None,
        help="Required only with --threshold-policy fixed.",
    )
    parser.add_argument("--linear-class-weight", choices=["none", "balanced"], default="none")
    parser.add_argument("--mlp-hidden-size", type=int, default=128)
    parser.add_argument("--mlp-dropout", type=float, default=0.10)
    parser.add_argument("--mlp-lr", type=float, default=1e-3)
    parser.add_argument("--mlp-weight-decay", type=float, default=1e-4)
    parser.add_argument("--mlp-batch-size", type=int, default=64)
    parser.add_argument("--mlp-epochs", type=int, default=50)
    parser.add_argument("--mlp-patience", type=int, default=5)
    args = parser.parse_args()

    if not args.input_dir.exists() or not args.input_dir.is_dir():
        parser.error(f"--input-dir must be an existing directory: {args.input_dir}")
    input_paths = sorted(
        p for p in args.input_dir.glob("*.json")
        if p.is_file() and not p.name.startswith(".")
    )
    if not input_paths:
        parser.error(f"No .json files found in --input-dir: {args.input_dir}")
    print(f"Discovered {len(input_paths)} JSON file(s) in {args.input_dir}:")
    for p in input_paths:
        print(f"  {p.name}")

    if not (1 <= args.max_length <= 8192):
        parser.error("--max-length must be between 1 and 8192 for this experiment")
    if args.input_format == "metadata":
        print(
            "WARNING: --input-format metadata is an explicit ablation and may introduce "
            "shortcut learning from source/product/speaker structure. For deployment/generalization "
            "use the default --input-format text unless metadata is guaranteed at inference and "
            "validated by source-held-out testing."
        )
    if args.include_source_type and args.input_format != "metadata":
        print("NOTE: --include-source-type has no effect with --input-format text.")

    if args.embedding_batch_size < 1:
        parser.error("--embedding-batch-size must be >= 1")
    if args.val_size <= 0 or args.test_size <= 0 or args.val_size + args.test_size >= 1:
        parser.error("val/test sizes must be >0 and sum to <1")
    if not (0 < args.target_recall <= 1):
        parser.error("--target-recall must be in (0,1]")
    try:
        operating_recall_targets = parse_recall_targets(args.operating_recalls)
    except ValueError as exc:
        parser.error(str(exc))
    if not (0.0 <= args.safety_margin_fraction <= 1.0):
        parser.error("--safety-margin-fraction must be in [0,1]")
    if args.threshold_policy == "fixed" and args.fixed_threshold is None:
        parser.error("--threshold-policy fixed requires --fixed-threshold")
    if args.fixed_threshold is not None and not (0.0 <= args.fixed_threshold <= 1.0):
        parser.error("--fixed-threshold must be in [0,1]")

    set_seed(args.seed)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    log_path, _log_fh = setup_run_logging(args.output_dir)
    print(f"Persistent run log: {log_path.resolve()}")
    print(f"Run started (UTC): {datetime.now(timezone.utc).isoformat()}")
    print("Command:", " ".join(sys.argv))

    # Persist the exact CLI/config independently of stdout.
    with (args.output_dir / "run_config.json").open("w", encoding="utf-8") as f:
        json.dump(
            {
                "argv": sys.argv,
                "args": {
                    k: (
                        [str(x) for x in v]
                        if isinstance(v, list) and all(isinstance(x, Path) for x in v)
                        else str(v) if isinstance(v, Path) else v
                    )
                    for k, v in vars(args).items()
                },
                "started_at_utc": datetime.now(timezone.utc).isoformat(),
                "model_id": MODEL_ID,
                "formatter_version": FORMATTER_VERSION,
            },
            f,
            indent=2,
        )

    records_all, input_sources = load_records(input_paths)

    print("Eligibility summary by dataset:")
    eligibility_by_dataset: Dict[str, Dict[str, int]] = {}
    for r in records_all:
        ds = record_dataset(r)
        status = eligibility_status(r)
        eligibility_by_dataset.setdefault(ds, {})
        eligibility_by_dataset[ds][status] = eligibility_by_dataset[ds].get(status, 0) + 1
    for ds, counts_by_status in sorted(eligibility_by_dataset.items()):
        total = sum(counts_by_status.values())
        retained = sum(
            count for status, count in counts_by_status.items()
            if status in {"explicit_true", "curated_eval_only_missing_intake"}
        )
        print(f"  {ds}: total={total} retained={retained} {counts_by_status}")

    eligible_records = [r for r in records_all if eligible(r)]

    # Only adjudicated train/eval rows are allowed into model development/evaluation.
    # Candidate/provisional rows are intentionally loaded for audit visibility but
    # never enter embeddings, training, validation, threshold tuning, or locked eval.
    split_counts: Dict[str, int] = {}
    for r in eligible_records:
        s = clean_scalar(r.get("split")) or "<missing>"
        split_counts[s] = split_counts.get(s, 0) + 1
    print(f"Eligible records by declared split before model filtering: {split_counts}")

    ignored_model_rows = [
        r for r in eligible_records
        if clean_scalar(r.get("split")) not in {"train", "eval"}
    ]
    if ignored_model_rows:
        ignored_counts: Dict[str, int] = {}
        for r in ignored_model_rows:
            s = clean_scalar(r.get("split")) or "<missing>"
            ignored_counts[s] = ignored_counts.get(s, 0) + 1
        print(
            "Ignoring non-adjudicated/non-model splits: "
            f"{ignored_counts}. These rows are NOT embedded or used by the model."
        )

    records = [
        r for r in eligible_records
        if clean_scalar(r.get("split")) in {"train", "eval"}
    ]
    if not records:
        raise ValueError(
            "No eligible adjudicated records with split='train' or split='eval' "
            "were found in the input directory."
        )
    print("Input datasets/files:")
    for src_info in input_sources:
        print(
            f"  dataset={src_info['dataset']!r} "
            f"records={src_info['records']} file={src_info['path']}"
        )

    excluded_upstream = len(records_all) - len(eligible_records)
    ignored_nonmodel = len(eligible_records) - len(records)
    print(
        f"Loaded {len(records_all)} records; {len(eligible_records)} intake-eligible; "
        f"{excluded_upstream} excluded upstream; {ignored_nonmodel} candidate/other rows ignored; "
        f"{len(records)} adjudicated train/eval rows used."
    )
    if not records:
        raise SystemExit("No eligible records to classify.")

    ids: List[str] = []
    original_ids: List[str] = []
    datasets: List[str] = []
    texts: List[str] = []
    labels: List[int] = []
    groups: List[Optional[str]] = []
    kept_records: List[Dict[str, Any]] = []

    for i, r in enumerate(records):
        rid = record_id(r, i)
        try:
            text = format_record(r, args.input_format, args.include_source_type)
            label = extract_label(r)
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc
        ids.append(rid)
        original_ids.append(original_record_id(r, i))
        datasets.append(record_dataset(r))
        texts.append(text)
        labels.append(label)
        groups.append(group_id(r))
        kept_records.append(r)

    y = np.asarray(labels, dtype=np.int64)
    counts = np.bincount(y, minlength=2)
    print(f"Labels: SAFE_TO_BYPASS=0 -> {counts[0]}, ESCALATE_TO_HUMAN=1 -> {counts[1]}")
    print("Eligible records by dataset:")
    for dataset_name in sorted(set(datasets)):
        idxs = [i for i, d in enumerate(datasets) if d == dataset_name]
        dc = np.bincount(y[idxs], minlength=2)
        print(
            f"  {dataset_name}: n={len(idxs)} safe={dc[0]} escalate={dc[1]}"
        )
    if min(counts) < 3:
        raise SystemExit("Need at least a few examples from each label; current labeled set is too small.")

    encoder = choose_encoder(args, texts[0])
    embed_config = EmbedConfig(
        model_id=MODEL_ID,
        backend=encoder.backend_name,
        model_artifact=encoder.model_artifact,
        max_length=args.max_length,
        pooling=POOLING,
        formatter_version=FORMATTER_VERSION,
        input_format=args.input_format,
        include_source_type=args.include_source_type,
    )
    print("Embedding config:", json.dumps(asdict(embed_config), indent=2))

    X = get_embeddings(
        encoder,
        texts,
        ids,
        embed_config,
        args.cache_dir,
        args.recompute_embeddings,
        args.embedding_batch_size,
    )
    np.save(args.output_dir / "all_embeddings.npy", X)
    np.save(args.output_dir / "all_labels.npy", y)

    # Prefer an explicit dataset-level train/eval split when present. The eval
    # partition is treated as a locked final test set and is never used for
    # training, early stopping, or threshold selection.
    declared_splits = [clean_scalar(r.get("split")) for r in kept_records]
    has_declared_split = all(s in {"train", "eval"} for s in declared_splits)

    if not has_declared_split:
        raise RuntimeError(
            "Internal invariant failed: model rows must all have split='train' or split='eval'."
        )
    if "train" not in declared_splits or "eval" not in declared_splits:
        raise ValueError(
            "Input directory must contain at least one eligible split='train' row and "
            "at least one eligible split='eval' row."
        )

    if has_declared_split and "eval" in declared_splits and "train" in declared_splits:
        print(
            "Using dataset-provided splits across ALL input files: "
            "all split=train rows are COMBINED into one development pool; "
            "all split=eval rows form the locked test pool."
        )
        train_pool_idx = np.asarray(
            [i for i, s in enumerate(declared_splits) if s == "train"], dtype=np.int64
        )
        test_idx = np.asarray(
            [i for i, s in enumerate(declared_splits) if s == "eval"], dtype=np.int64
        )

        # Make validation only from the combined training partition.
        # If repeated real-public/source groups exist, keep a whole group on one side
        # so atomic excerpts from the same thread/review cannot straddle train/val.
        from sklearn.model_selection import train_test_split, GroupShuffleSplit

        train_groups = [groups[int(i)] for i in train_pool_idx]
        repeated_groups = {
            g for g in train_groups
            if g is not None and train_groups.count(g) > 1
        }

        if repeated_groups:
            effective_groups = [
                g if g is not None else f"singleton::{int(i)}"
                for i, g in zip(train_pool_idx, train_groups)
            ]
            chosen = None
            # Try several deterministic seeds to get both labels into validation.
            for offset in range(50):
                gss = GroupShuffleSplit(
                    n_splits=1,
                    test_size=args.val_size,
                    random_state=args.seed + offset,
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
                raise ValueError(
                    "Could not create a group-aware train/validation split containing both classes."
                )
            train_idx, val_idx = chosen
            print(
                f"Validation split is group-aware; {len(repeated_groups)} repeated "
                "source/incident groups were kept intact."
            )
        else:
            try:
                train_idx, val_idx = train_test_split(
                    train_pool_idx,
                    test_size=args.val_size,
                    random_state=args.seed,
                    stratify=y[train_pool_idx],
                )
            except ValueError as exc:
                raise ValueError(f"Could not split train partition into train/val: {exc}") from exc

        if not any(g is not None for g in groups):
            print(
                "NOTE: no group/source grouping metadata found. Declared train/eval is "
                "preserved, but duplicate/paraphrase leakage cannot be independently checked."
            )
    else:
        train_idx, val_idx, test_idx = split_indices(
            y, groups, args.val_size, args.test_size, args.seed
        )

    print(
        f"Split sizes: train={len(train_idx)}, val={len(val_idx)}, test={len(test_idx)}"
    )
    for name, idxs in (("train", train_idx), ("val", val_idx), ("test", test_idx)):
        c = np.bincount(y[idxs], minlength=2)
        print(f"  {name}: safe={c[0]} escalate={c[1]}")

    print("Split composition by dataset:")
    for split_name, idxs in (("train", train_idx), ("val", val_idx), ("test", test_idx)):
        buckets: Dict[str, List[int]] = {}
        for i in idxs:
            buckets.setdefault(datasets[int(i)], []).append(int(i))
        print(f"  {split_name}:")
        for dataset_name, ds_idxs in sorted(buckets.items()):
            dc = np.bincount(y[ds_idxs], minlength=2)
            print(
                f"    {dataset_name}: n={len(ds_idxs)} "
                f"safe={dc[0]} escalate={dc[1]}"
            )

    train_records_for_audit = [kept_records[int(i)] for i in train_idx]
    val_records_for_audit = [kept_records[int(i)] for i in val_idx]
    train_structure_audit = structure_leakage_audit(
        train_records_for_audit, y[train_idx], "train"
    )
    val_structure_audit = structure_leakage_audit(
        val_records_for_audit, y[val_idx], "validation"
    )
    print_structure_leakage_summary(train_structure_audit)
    print_structure_leakage_summary(val_structure_audit)
    with (args.output_dir / "structure_leakage_audit.json").open("w", encoding="utf-8") as f:
        json.dump(
            to_jsonable({
                "model_feature_policy": (
                    "Default input-format=text uses only evidence.text. Structured fields "
                    "below are diagnostics and are never model features unless the user "
                    "explicitly runs --input-format metadata."
                ),
                "train": train_structure_audit,
                "validation": val_structure_audit,
            }),
            f,
            indent=2,
        )

    if has_declared_split and "eval" in declared_splits and "train" in declared_splits:
        bad_dev = [
            int(i) for i in np.concatenate([train_idx, val_idx])
            if declared_splits[int(i)] != "train"
        ]
        bad_test = [int(i) for i in test_idx if declared_splits[int(i)] != "eval"]
        if bad_dev or bad_test:
            raise RuntimeError(
                "Split invariant violated: development must contain only split=train "
                "and locked test must contain only split=eval."
            )

    # Save split membership for reproducibility.
    split_map = {}
    for split_name, idxs in (("train", train_idx), ("val", val_idx), ("test", test_idx)):
        for i in idxs:
            ii = int(i)
            split_map[ids[ii]] = {
                "assigned_split": split_name,
                "declared_split": declared_splits[ii],
                "dataset": datasets[ii],
                "original_id": original_ids[ii],
            }
    with (args.output_dir / "splits.json").open("w", encoding="utf-8") as f:
        json.dump(split_map, f, indent=2)

    # ---------- Linear probe ----------
    print("\n=== Linear probe: logistic regression ===")
    linear = fit_linear_probe(
        X[train_idx],
        y[train_idx],
        None if args.linear_class_weight == "none" else "balanced",
        args.seed,
    )
    p_train_linear = linear.predict_proba(X[train_idx])[:, 1]
    p_val_linear = linear.predict_proba(X[val_idx])[:, 1]
    p_test_linear = linear.predict_proba(X[test_idx])[:, 1]
    t_linear, val_linear = select_threshold_for_recall(
        y[val_idx],
        p_val_linear,
        args.target_recall,
        policy=args.threshold_policy,
        safety_margin_fraction=args.safety_margin_fraction,
        fixed_threshold=args.fixed_threshold,
    )
    test_linear = binary_metrics(y[test_idx], p_test_linear, t_linear)
    print("Selected validation threshold:", t_linear)
    print("Linear val @ target recall:", json.dumps(val_linear, indent=2))
    print("Linear TEST @ selected threshold:", json.dumps(test_linear, indent=2))

    # ---------- MLP ----------
    print("\n=== MLP head: 768 -> hidden -> 1 ===")
    mlp, mlp_scaler, mlp_history = train_mlp(
        X[train_idx],
        y[train_idx],
        X[val_idx],
        y[val_idx],
        hidden_dim=args.mlp_hidden_size,
        dropout=args.mlp_dropout,
        lr=args.mlp_lr,
        weight_decay=args.mlp_weight_decay,
        batch_size=args.mlp_batch_size,
        epochs=args.mlp_epochs,
        patience=args.mlp_patience,
        seed=args.seed,
    )
    p_train_mlp = mlp_predict_proba(mlp, mlp_scaler, X[train_idx])
    p_val_mlp = mlp_predict_proba(mlp, mlp_scaler, X[val_idx])
    p_test_mlp = mlp_predict_proba(mlp, mlp_scaler, X[test_idx])
    t_mlp, val_mlp = select_threshold_for_recall(
        y[val_idx],
        p_val_mlp,
        args.target_recall,
        policy=args.threshold_policy,
        safety_margin_fraction=args.safety_margin_fraction,
        fixed_threshold=args.fixed_threshold,
    )
    test_mlp = binary_metrics(y[test_idx], p_test_mlp, t_mlp)
    print("Selected validation threshold:", t_mlp)
    print("MLP val @ target recall:", json.dumps(val_mlp, indent=2))
    print("MLP TEST @ selected threshold:", json.dumps(test_mlp, indent=2))

    # ---------- Score-distribution diagnostics ----------
    # Validation distributions may inform threshold interpretation. Locked test/eval
    # distributions are logged strictly for diagnostics and MUST NOT be used to tune.
    score_distributions = {
        "linear": {
            "train": score_distribution(y[train_idx], p_train_linear),
            "validation": score_distribution(y[val_idx], p_val_linear),
            "test_locked_diagnostic_only": score_distribution(y[test_idx], p_test_linear),
        },
        "mlp": {
            "train": score_distribution(y[train_idx], p_train_mlp),
            "validation": score_distribution(y[val_idx], p_val_mlp),
            "test_locked_diagnostic_only": score_distribution(y[test_idx], p_test_mlp),
        },
    }
    for model_name, splits_d in score_distributions.items():
        for split_name, dist in splits_d.items():
            print_score_distribution(model_name.upper(), split_name, dist)

    with (args.output_dir / "score_distributions.json").open("w", encoding="utf-8") as f:
        json.dump(to_jsonable(score_distributions), f, indent=2)

    try:
        import pandas as pd

        flat_rows = []
        for model_name, splits_d in score_distributions.items():
            for split_name, dist in splits_d.items():
                for label in ("safe", "escalate"):
                    s = dist.get(label, {})
                    if not s:
                        continue
                    flat_rows.append(
                        {
                            "model": model_name,
                            "split": split_name,
                            "class": label,
                            **s,
                            "max_safe_score": dist.get("max_safe_score"),
                            "min_escalate_score": dist.get("min_escalate_score"),
                            "separation_margin": dist.get("separation_margin"),
                            "perfectly_separated": dist.get("perfectly_separated"),
                        }
                    )
        pd.DataFrame(flat_rows).to_csv(
            args.output_dir / "score_distributions.csv", index=False
        )
    except Exception as exc:
        eprint(f"WARNING: could not write score-distribution CSV: {exc}")

    # Save validation threshold sweeps for audit and plotting.
    try:
        import pandas as pd
        pd.DataFrame(threshold_sweep_rows(y[val_idx], p_val_linear)).to_csv(
            args.output_dir / "linear_threshold_sweep_validation.csv", index=False
        )
        pd.DataFrame(threshold_sweep_rows(y[val_idx], p_val_mlp)).to_csv(
            args.output_dir / "mlp_threshold_sweep_validation.csv", index=False
        )
        pd.DataFrame(mlp_history).to_csv(
            args.output_dir / "mlp_training_history.csv", index=False
        )
    except Exception as exc:
        eprint(f"WARNING: could not write threshold/training CSVs: {exc}")

    # ---------- Save models ----------
    require("joblib")
    import joblib
    import torch

    joblib.dump(linear, args.output_dir / "linear_probe.joblib")
    joblib.dump(mlp_scaler, args.output_dir / "mlp_scaler.joblib")
    torch.save(
        {
            "state_dict": mlp.state_dict(),
            "input_dim": HIDDEN_SIZE,
            "hidden_dim": args.mlp_hidden_size,
            "dropout": args.mlp_dropout,
            "threshold": t_mlp,
        },
        args.output_dir / "mlp_head.pt",
    )

    # ---------- Recall/bypass operating-point comparison ----------
    # Always compute these before report construction so they are available
    # regardless of artifact-writing success/failure.
    linear_operating_points = operating_points_for_targets(
        y[val_idx],
        p_val_linear,
        y[test_idx],
        p_test_linear,
        operating_recall_targets,
    )
    mlp_operating_points = operating_points_for_targets(
        y[val_idx],
        p_val_mlp,
        y[test_idx],
        p_test_mlp,
        operating_recall_targets,
    )
    print_operating_points("LINEAR", linear_operating_points)
    print_operating_points("MLP", mlp_operating_points)

    try:
        import pandas as pd
        operating_rows = (
            flatten_operating_points("linear", linear_operating_points)
            + flatten_operating_points("mlp", mlp_operating_points)
        )
        pd.DataFrame(operating_rows).to_csv(
            args.output_dir / "operating_points.csv", index=False
        )
    except Exception as exc:
        eprint(f"WARNING: could not write operating_points.csv: {exc}")

    # ---------- Per-test-row error analysis ----------
    test_rows: List[Dict[str, Any]] = []
    for j, i in enumerate(test_idx):
        i = int(i)
        pl = float(p_test_linear[j])
        pm = float(p_test_mlp[j])
        true = int(y[i])
        row = {
            "id": ids[i],
            "original_id": original_ids[i],
            "dataset": datasets[i],
            "source_file": kept_records[i].get("__source_file"),
            "text": texts[i],
            "true_label": true,
            "true_label_name": "ESCALATE_TO_HUMAN" if true else "SAFE_TO_BYPASS",
            "linear_probability": pl,
            "mlp_probability": pm,
            "linear_prediction": int(pl >= t_linear),
            "mlp_prediction": int(pm >= t_mlp),
            "linear_false_negative": bool(true == 1 and pl < t_linear),
            "mlp_false_negative": bool(true == 1 and pm < t_mlp),
            "group_id": groups[i],
            "source_type": nested_get(kept_records[i], "source.type"),
            "text_kind": nested_get(kept_records[i], "evidence.text_kind"),
            "classification": nested_get(kept_records[i], "label.classification"),
            "route": nested_get(kept_records[i], "label.route"),
            "theme_id": nested_get(kept_records[i], "label.theme_id"),
            "review_required": nested_get(kept_records[i], "label.review_required"),
            "potential_mdr": nested_get(kept_records[i], "label.potential_mdr"),
            "priority_subflags": nested_get(kept_records[i], "label.priority_subflags"),
            "reason_codes": nested_get(kept_records[i], "annotation.reason_codes"),
            "difficulty": nested_get(kept_records[i], "annotation.difficulty"),
            "harm_explicitness": nested_get(
                kept_records[i], "annotation.harm_explicitness"
            ),
        }
        test_rows.append(row)

    # Most important rows first: any FN, then model disagreements, then lowest positive margins.
    def row_priority(r: Dict[str, Any]) -> Tuple[int, int, float]:
        any_fn = r["linear_false_negative"] or r["mlp_false_negative"]
        disagree = r["linear_prediction"] != r["mlp_prediction"]
        margin = min(abs(r["linear_probability"] - t_linear), abs(r["mlp_probability"] - t_mlp))
        return (0 if any_fn else 1, 0 if disagree else 1, margin)

    test_rows.sort(key=row_priority)
    with (args.output_dir / "test_error_analysis.jsonl").open("w", encoding="utf-8") as f:
        for row in test_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    try:
        import pandas as pd

        pd.DataFrame(test_rows).to_csv(args.output_dir / "test_error_analysis.csv", index=False)
    except Exception as exc:
        eprint(f"WARNING: could not write CSV error analysis: {exc}")

    eval_records = [kept_records[int(i)] for i in test_idx]
    linear_subgroups = stratified_eval_metrics(
        eval_records, y[test_idx], p_test_linear, t_linear
    )
    mlp_subgroups = stratified_eval_metrics(
        eval_records, y[test_idx], p_test_mlp, t_mlp
    )
    linear_cohorts = cohort_eval_metrics(
        eval_records, y[test_idx], p_test_linear, t_linear
    )
    mlp_cohorts = cohort_eval_metrics(
        eval_records, y[test_idx], p_test_mlp, t_mlp
    )

    linear_dataset_metrics = dataset_stratified_metrics(
        eval_records, y[test_idx], p_test_linear, t_linear
    )
    mlp_dataset_metrics = dataset_stratified_metrics(
        eval_records, y[test_idx], p_test_mlp, t_mlp
    )
    print_dataset_stratified_metrics(
        "LINEAR", "test_locked_diagnostic_only", linear_dataset_metrics
    )
    print_dataset_stratified_metrics(
        "MLP", "test_locked_diagnostic_only", mlp_dataset_metrics
    )

    report = {
        "input_dir": str(args.input_dir),
        "inputs": [str(p) for p in input_paths],
        "input_sources": input_sources,
        "eligibility_by_dataset": eligibility_by_dataset,
        "run_log": str(log_path),
        "split_policy": (
            "combined_all_files_train_pool_with_locked_eval_stratified_by_dataset"
            if has_declared_split and "eval" in declared_splits and "train" in declared_splits
            else "generated_train_val_test"
        ),
        "n_total_records": len(records_all),
        "n_eligible_labeled_records": len(records),
        "label_counts": {"safe": int(counts[0]), "escalate": int(counts[1])},
        "embed_config": asdict(embed_config),
        "target_recall": args.target_recall,
        "operating_recall_targets": operating_recall_targets,
        "threshold_policy": args.threshold_policy,
        "safety_margin_fraction": args.safety_margin_fraction,
        "fixed_threshold": args.fixed_threshold,
        "score_distributions": score_distributions,
        "model_feature_policy": (
            "Default text-only model view: evidence.text only. label, route, review_required, "
            "reason, potential_mdr, annotation/difficulty, dataset, split, provenance, intake, "
            "source URL/type, IDs, product/version metadata and all other structure are excluded "
            "from model input."
        ),
        "ignored_nonmodel_rows": ignored_nonmodel,
        "training_policy": (
            "Combine all eligible split=train rows across all input files into one "
            "shared development pool; create validation only from that combined train "
            "pool; keep every split=eval row locked from training/tuning; report locked "
            "eval both overall and stratified by dataset."
        ),
        "datasets": sorted(set(datasets)),
        "split_sizes": {
            "train": len(train_idx),
            "val": len(val_idx),
            "test": len(test_idx),
        },
        "linear": {
            "selected_threshold": t_linear,
            "validation": val_linear,
            "test": test_linear,
            "test_at_0_5": binary_metrics(y[test_idx], p_test_linear, 0.5),
            "test_subgroups_at_selected_threshold": linear_subgroups,
            "test_cohorts_at_selected_threshold": linear_cohorts,
            "operating_points_conservative": linear_operating_points,
            "test_by_dataset": linear_dataset_metrics,
        },
        "mlp": {
            "architecture": f"{HIDDEN_SIZE}->{args.mlp_hidden_size}->1",
            "selected_threshold": t_mlp,
            "validation": val_mlp,
            "test": test_mlp,
            "test_at_0_5": binary_metrics(y[test_idx], p_test_mlp, 0.5),
            "test_subgroups_at_selected_threshold": mlp_subgroups,
            "test_cohorts_at_selected_threshold": mlp_cohorts,
            "operating_points_conservative": mlp_operating_points,
            "test_by_dataset": mlp_dataset_metrics,
            "history": mlp_history,
        },
    }
    with (args.output_dir / "report.json").open("w", encoding="utf-8") as f:
        json.dump(to_jsonable(report), f, indent=2)

    with (args.output_dir / "operating_points.json").open("w", encoding="utf-8") as f:
        json.dump(
            to_jsonable(
                {
                    "note": (
                        "Thresholds selected on validation only; locked-test metrics are "
                        "diagnostic and never influence threshold choice."
                    ),
                    "linear": linear_operating_points,
                    "mlp": mlp_operating_points,
                }
            ),
            f,
            indent=2,
        )

    with (args.output_dir / "dataset_metrics.json").open("w", encoding="utf-8") as f:
        json.dump(
            to_jsonable(
                {
                    "note": (
                        "Metrics stratified by each input JSON's top-level dataset field. "
                        "Dataset identity is never used as a model feature. One-class eval "
                        "datasets report only metrics that are meaningful for the observed class."
                    ),
                    "linear": linear_dataset_metrics,
                    "mlp": mlp_dataset_metrics,
                }
            ),
            f,
            indent=2,
        )

    try:
        import pandas as pd
        dataset_rows: List[Dict[str, Any]] = []
        for model_name, payload in (
            ("linear", linear_dataset_metrics),
            ("mlp", mlp_dataset_metrics),
        ):
            for dataset_name, item in payload.items():
                row = {
                    "model": model_name,
                    "dataset": dataset_name,
                    "n": item["n"],
                    "safe_n": item["safe_n"],
                    "escalate_n": item["escalate_n"],
                }
                row.update(item["metrics"])
                dist = item["score_distribution"]
                row["max_safe_score"] = dist.get("max_safe_score")
                row["min_escalate_score"] = dist.get("min_escalate_score")
                row["separation_margin"] = dist.get("separation_margin")
                row["perfectly_separated"] = dist.get("perfectly_separated")
                dataset_rows.append(row)
        pd.DataFrame(dataset_rows).to_csv(
            args.output_dir / "dataset_metrics.csv", index=False
        )
    except Exception as exc:
        eprint(f"WARNING: could not write dataset_metrics.csv: {exc}")

    print("\n=== Summary ===")
    print(f"Threshold policy: {args.threshold_policy}")
    print(
        f"Linear: test recall={test_linear['escalate_recall']:.4f}, "
        f"traffic bypassed={test_linear['traffic_bypassed']:.4f}, "
        f"FN={test_linear['fn']}"
    )
    print(
        f"MLP:    test recall={test_mlp['escalate_recall']:.4f}, "
        f"traffic bypassed={test_mlp['traffic_bypassed']:.4f}, "
        f"FN={test_mlp['fn']}"
    )
    print(f"Artifacts written to: {args.output_dir.resolve()}")
    print(f"Embedding cache:      {args.cache_dir.resolve()}")
    print(f"Run finished (UTC):   {datetime.now(timezone.utc).isoformat()}")
    print(f"Persistent run log:   {log_path.resolve()}")


if __name__ == "__main__":
    main()
