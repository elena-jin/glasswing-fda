"""Source adapter + standardization layer for the Test Flight feedback pipeline.

Raw provider-shaped envelopes in -> schema-v1.1 standardized records out.
Only records with ``intake.eligible_for_classification: true`` should be sent
to the classifier. Raw events are never mutated.
"""

from .adapters import adapt_event, get_adapter, available_sources
from .schema import validate_record, is_valid

__all__ = [
    "adapt_event",
    "get_adapter",
    "available_sources",
    "validate_record",
    "is_valid",
]