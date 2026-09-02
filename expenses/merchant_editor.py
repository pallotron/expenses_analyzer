"""Working out what an alias change would do, before it is saved.

Merchant aliases are regexes applied first-match-wins, so the effect of a
pattern depends on every other pattern around it. Rather than reason about
that, these helpers apply the candidate alias table to the real transactions
and compare the display names it produces with the ones in force today.
"""

import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Dict, Optional

import pandas as pd

from expenses.data_handler import apply_merchant_aliases_to_series


@dataclass(frozen=True)
class AliasPreview:
    """What saving a pattern would do to the stored transactions."""

    matched: int = 0
    total: float = 0.0
    current_categories: Counter = field(default_factory=Counter)
    merchants: Counter = field(default_factory=Counter)
    error: Optional[str] = None


def preview_alias_change(
    pattern: str,
    alias: str,
    transactions: pd.DataFrame,
    aliases: Dict[str, str],
    categories: Dict[str, str],
) -> AliasPreview:
    """Describe the effect of setting `pattern` to display as `alias`.

    Args:
        pattern: The regex the user has typed.
        alias: The display name it should map to.
        transactions: Stored transactions; needs Merchant and Amount columns.
        aliases: The alias table as it stands now.
        categories: Merchant-to-category mappings, keyed on display name.

    Returns:
        Counts and totals for the rows that would end up displaying as `alias`,
        the categories those rows resolve to today, and the merchants being
        swept together, which is how an over-broad pattern gives itself away.
    """
    if not pattern or transactions.empty:
        return AliasPreview()

    try:
        re.compile(pattern)
    except re.error as exc:
        return AliasPreview(error=str(exc))

    # Assigning an existing key keeps its position, so editing a pattern can
    # outrank later ones while a brand new pattern is only tried last.
    # The alias is only a label here; a placeholder lets the preview work while
    # the user is still typing the pattern, before naming the merchant.
    target = alias or "\x00pending-alias"
    candidate = dict(aliases)
    candidate[pattern] = target

    before = apply_merchant_aliases_to_series(transactions["Merchant"], aliases)
    after = apply_merchant_aliases_to_series(transactions["Merchant"], candidate)

    claimed = after == target

    return AliasPreview(
        matched=int(claimed.sum()),
        total=float(transactions.loc[claimed, "Amount"].sum()),
        current_categories=Counter(
            before[claimed].map(lambda m: categories.get(m, "Other"))
        ),
        merchants=Counter(before[claimed]),
    )


def apply_merchant_decision(
    pattern: str,
    alias: str,
    category: Optional[str],
    aliases: Dict[str, str],
    categories: Dict[str, str],
) -> "tuple[Dict[str, str], Dict[str, str]]":
    """Fold one merchant edit into the alias table and the category map.

    Categories are keyed on the display name, so renaming a merchant writes its
    category under the new name; the old key is left alone rather than deleted,
    since another pattern may still resolve to it.

    Returns:
        New (aliases, categories) dicts. The arguments are not modified.
    """
    updated_aliases = dict(aliases)
    updated_aliases[pattern] = alias

    updated_categories = dict(categories)
    if category:
        updated_categories[alias] = category

    return updated_aliases, updated_categories
