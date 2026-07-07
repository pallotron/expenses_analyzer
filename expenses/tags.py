"""Pure helpers for the per-transaction Tags column.

Stored format: lowercase tokens matching [a-z0-9:_-], comma-separated,
no spaces (e.g. "emergency,trip:paris-jun26"). Screens and data_handler
must use these helpers instead of manipulating the string directly.
"""

import re
from typing import List, Optional

import pandas as pd

_INVALID_CHARS = re.compile(r"[^a-z0-9:_-]")


def normalize_tag(raw: str) -> str:
    """Normalize a single tag: lowercase, strip, spaces to '-', drop invalid chars."""
    tag = str(raw).strip().lower().replace(" ", "-")
    return _INVALID_CHARS.sub("", tag)


def parse_tags(cell: Optional[str]) -> List[str]:
    """Split a stored Tags cell into a list. Tolerates None/NaN/empty."""
    if cell is None or (isinstance(cell, float) and pd.isna(cell)):
        return []
    return [t for t in str(cell).split(",") if t]


def join_tags(tags: List[str]) -> str:
    """Normalize, dedup (order-preserving) and join tags for storage."""
    seen = []
    for raw in tags:
        tag = normalize_tag(raw)
        if tag and tag not in seen:
            seen.append(tag)
    return ",".join(seen)


def add_tags_to_cell(cell: Optional[str], tags: List[str]) -> str:
    return join_tags(parse_tags(cell) + list(tags))


def remove_tags_from_cell(cell: Optional[str], tags: List[str]) -> str:
    to_remove = {normalize_tag(t) for t in tags}
    return join_tags([t for t in parse_tags(cell) if t not in to_remove])


def series_has_tag(s: pd.Series, tag: str) -> pd.Series:
    """Exact-token match: 'trip' does not match 'trip:x'."""
    wanted = normalize_tag(tag)
    return s.apply(lambda cell: wanted in parse_tags(cell))


def series_has_tag_prefix(s: pd.Series, prefix: str) -> pd.Series:
    return s.apply(lambda cell: any(t.startswith(prefix) for t in parse_tags(cell)))


def all_tags_in_series(s: pd.Series) -> List[str]:
    tags = set()
    for cell in s:
        tags.update(parse_tags(cell))
    return sorted(tags)
