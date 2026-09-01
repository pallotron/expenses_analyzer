"""Inline completion for the free-text tag fields.

Textual's Input renders ``suggestion[len(value):]`` as greyed-out ghost text and
swaps the whole value in when the user presses right-arrow, so a suggestion must
always be the full intended field value, prefixed by exactly what was typed.
That rules out normalizing the fragment before matching: a fragment the user
could not have typed would make the ghost text disagree with the field.
"""

from typing import Iterable, List, Optional

from textual.suggester import Suggester


class TagSuggester(Suggester):
    """Suggest a known tag from what the user has typed so far.

    Args:
        tags: The tags in use; deduplicated and sorted, first match wins.
        last_segment: Complete only the text after the final comma, keeping the
            earlier segments verbatim. Set for comma-separated fields.
    """

    def __init__(self, tags: Iterable[str], *, last_segment: bool = False) -> None:
        super().__init__(use_cache=True, case_sensitive=False)
        self._tags: List[str] = sorted({t for t in tags if t})
        self._last_segment = last_segment

    async def get_suggestion(self, value: str) -> Optional[str]:
        if self._last_segment:
            _, _, tail = value.rpartition(",")
        else:
            tail = value

        # A space typed after the comma belongs to the head, not to the fragment.
        fragment = tail.lstrip()
        if not fragment:
            return None
        head = value[: len(value) - len(fragment)]

        for tag in self._tags:
            if tag.startswith(fragment):
                return head + tag
        return None
