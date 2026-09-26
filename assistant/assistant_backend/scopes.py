"""Scope -> classification mapping for the Product/Quality toggle."""

from __future__ import annotations

from typing import Dict, List

from .models import Scope

# The classification labels the classifier emits (schema v1.1 label object).
CLASSIFICATIONS_BY_SCOPE: Dict[Scope, List[str]] = {
    Scope.PRODUCT_ONLY: ["product_feedback"],
    Scope.PRODUCT_AND_QUALITY: ["product_feedback", "complaint"],
}


def classifications_for(scope: Scope) -> List[str]:
    """Return the classification values allowed for a given scope toggle."""
    return list(CLASSIFICATIONS_BY_SCOPE.get(scope, CLASSIFICATIONS_BY_SCOPE[Scope.PRODUCT_ONLY]))


def human_label(scope: Scope) -> str:
    if scope == Scope.PRODUCT_AND_QUALITY:
        return "Product feedback plus Quality/complaint issues"
    return "Product feedback only"