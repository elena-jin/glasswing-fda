"""Normalizer (AI layer) for the Test Flight feedback pipeline.

02 / NORMALIZE: raw reports in any source format -> standardized records in the
``feedback-classifier-input`` schema (v1.1, extended to v1.2), ready for the
downstream classifier.

This package is built by OpenCode; it is NOT itself the runtime model. The
runtime extraction/standardization is performed by a pluggable provider:
Anthropic Claude (per the architecture diagram), any OpenAI-compatible model,
or a deterministic offline fallback.
"""

from .normalize import Normalizer, NormalizedResult, postprocess
from .providers import (
    Provider,
    AnthropicProvider,
    OpenAICompatibleProvider,
    DeterministicProvider,
    get_provider,
)
from .schemas import validate_record, SOURCE_TYPES, EXCLUSION_REASONS

__all__ = [
    "Normalizer",
    "NormalizedResult",
    "postprocess",
    "Provider",
    "AnthropicProvider",
    "OpenAICompatibleProvider",
    "DeterministicProvider",
    "get_provider",
    "validate_record",
    "SOURCE_TYPES",
    "EXCLUSION_REASONS",
]