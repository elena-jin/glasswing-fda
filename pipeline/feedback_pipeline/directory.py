"""Account directory + product defaults used by the standardization layer.

In production this is the customer/account table the adapter resolves hints
against. Here it is a small synthetic lookup so fixtures resolve to names.
``account_id_hint`` from a source is never proof of the speaker's identity; it
is only used to propose a link.
"""

from __future__ import annotations

from typing import Dict, Optional

# organization_external_id / account_hint -> human-readable customer name
ACCOUNTS: Dict[str, str] = {
    "acct-pine": "Pine Sleep Labs",
    "acct-maple": "Maple Sleep Clinic",
    "acct-cedar": "Cedar Sleep Center",
}

# Default product context when a source envelope carries no product field.
DEFAULT_PRODUCT = "SomniLink CPAP app"


def resolve_account(account_id_hint: Optional[str]) -> Optional[str]:
    if not account_id_hint:
        return None
    return ACCOUNTS.get(account_id_hint)