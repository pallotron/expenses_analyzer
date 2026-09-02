from textual.app import ComposeResult
from textual.screen import ModalScreen
from textual.widgets import Button, Static, Input, Label, Select
from textual.containers import Vertical, Horizontal
from textual.binding import Binding
import logging
import pandas as pd

from expenses.data_handler import get_category_spending_type
from expenses.merchant_editor import pattern_claiming, preview_alias_change
from expenses.tag_suggester import TagSuggester
from expenses.tags import normalize_tag


class EditMerchantScreen(ModalScreen[bool]):
    """A modal screen to add/edit merchant alias for a transaction."""

    DEFAULT_CSS = """
    EditMerchantScreen {
        align: center middle;
    }

    EditMerchantScreen #dialog {
        width: 70;
        height: auto;
        max-height: 90%;
        overflow-y: auto;
        padding: 1 2;
        background: $surface;
        border: solid $primary;
    }

    EditMerchantScreen #title {
        text-align: center;
        text-style: bold;
        margin-bottom: 1;
    }

    EditMerchantScreen #instruction {
        color: $text-muted;
        margin-bottom: 1;
    }

    EditMerchantScreen #original_merchant {
        text-style: bold;
    }

    EditMerchantScreen #pattern_help {
        color: $text-muted;
    }

    EditMerchantScreen #budget_display {
        color: $text-muted;
    }

    EditMerchantScreen #match_preview {
        color: $text-muted;
        margin-top: 1;
    }

    EditMerchantScreen #button_container {
        margin-top: 1;
        align: center middle;
    }

    EditMerchantScreen #help_text {
        text-align: center;
        color: $text-muted;
        margin-top: 1;
    }
    """

    BINDINGS = [
        Binding("escape", "cancel", "Cancel", show=False),
        Binding("ctrl+s", "save", "Save", show=False),
    ]

    def __init__(
        self,
        original_merchant: str,
        current_alias: str | None = None,
        *,
        transactions: "pd.DataFrame | None" = None,
        aliases: dict | None = None,
        categories: dict | None = None,
        category_types: dict | None = None,
        available_categories: list[str] | None = None,
        known_tags: list[str] | None = None,
    ) -> None:
        """Initialize the edit screen.

        Args:
            original_merchant: The original merchant name from the transaction
            current_alias: The current alias (if one exists), or None
            transactions: Stored transactions, used to preview what a pattern claims
            aliases: The alias table as it stands now
            categories: Merchant-to-category mappings, keyed on display name
            category_types: Essential/discretionary classification of categories
            available_categories: Categories offered in the dropdown
            known_tags: Tags already in use, for typeahead
        """
        self.original_merchant = original_merchant
        self.current_alias = current_alias
        self.suggested_pattern = self._suggest_pattern(original_merchant)
        self.transactions = transactions
        self.aliases = aliases or {}
        # Editing an existing merchant should start from the rule in force, so
        # saving replaces that rule rather than appending a second one.
        self.current_pattern = pattern_claiming(original_merchant, self.aliases)
        self.categories = categories or {}
        self.category_types = category_types or {}
        display_name = current_alias or original_merchant
        self.current_category = self.categories.get(display_name)
        options = list(available_categories or sorted(set(self.categories.values())))
        if self.current_category and self.current_category not in options:
            options.insert(0, self.current_category)
        self.category_options = options
        self.known_tags = known_tags or []
        super().__init__()

    def _suggest_pattern(self, merchant: str) -> str:
        """Suggest a regex pattern based on the merchant name.

        Args:
            merchant: The merchant name to analyze

        Returns:
            A suggested regex pattern
        """
        # Remove trailing dates, numbers, and common transaction IDs
        # Example: "POS APPLE.COM/BI 02/08 1" -> "POS APPLE\.COM/BI.*"
        import re

        # First, remove common variable parts before escaping
        # - Dates like 02/08, 12/31
        cleaned = re.sub(r"\s+\d{2}/\d{2}", "", merchant)
        # - Trailing numbers/IDs and extra spaces
        cleaned = re.sub(r"\s+\d+$", "", cleaned)
        # - Normalize multiple spaces to single space
        cleaned = re.sub(r"\s+", " ", cleaned).strip()

        # Now escape special regex characters (but not spaces)
        # We'll manually escape the important ones
        escaped = cleaned
        # Escape special regex chars: . * + ? ^ $ { } [ ] ( ) | \
        for char in [
            ".",
            "*",
            "+",
            "?",
            "^",
            "$",
            "{",
            "}",
            "[",
            "]",
            "(",
            ")",
            "|",
            "\\",
        ]:
            escaped = escaped.replace(char, "\\" + char)

        # Replace single spaces with \s+ to match one or more whitespace chars
        escaped = escaped.replace(" ", r"\s+")

        # Add .* at the end to match any trailing content
        if escaped and not escaped.endswith(".*"):
            escaped += ".*"

        return escaped

    def compose(self) -> ComposeResult:
        title = "Edit Merchant Alias"
        if self.current_alias:
            instruction = f"Editing alias for: {self.original_merchant}"
        else:
            instruction = f"Create alias for: {self.original_merchant}"

        yield Vertical(
            Static(title, id="title"),
            Static(instruction, id="instruction"),
            Label("Original Merchant Name:"),
            Static(self.original_merchant, id="original_merchant"),
            Label("Regex Pattern (leave empty to remove alias):"),
            Input(
                value=self.current_pattern or self.suggested_pattern,
                placeholder="e.g., POS APPLE\\.COM/BI.*",
                id="pattern_input",
            ),
            Static(
                "Tip: Use .* to match anything, \\d for digits, \\s for spaces",
                id="pattern_help",
            ),
            Label("Display Alias:"),
            Input(
                value=self.current_alias or "",
                placeholder="e.g., Apple",
                id="alias_input",
            ),
            Label("Category:"),
            Select(
                [(name, name) for name in self.category_options],
                value=self.current_category or Select.BLANK,
                allow_blank=True,
                id="category_select",
            ),
            Static("", id="budget_display"),
            Label("Tags (added to matching transactions):"),
            Input(
                placeholder="comma separated",
                id="tags_input",
                suggester=TagSuggester(self.known_tags),
            ),
            Static("", id="match_preview"),
            Horizontal(
                Button("Save", variant="success", id="save"),
                Button("Cancel", variant="error", id="cancel"),
                id="button_container",
            ),
            Static(
                "Press Ctrl+S to save, Escape to cancel",
                id="help_text",
            ),
            id="dialog",
        )

    def on_mount(self) -> None:
        """Focus the pattern input on mount."""
        self._refresh_budget()
        self._refresh_preview()
        # If there's already an alias, focus on the alias input
        # Otherwise focus on the pattern input
        if self.current_alias:
            self.query_one("#alias_input", Input).focus()
        else:
            self.query_one("#pattern_input", Input).focus()

    def on_input_changed(self, event: Input.Changed) -> None:
        """Re-run the preview as the pattern is typed."""
        if event.input.id in ("pattern_input", "alias_input", "tags_input"):
            self._refresh_preview()

    def on_select_changed(self, event: Select.Changed) -> None:
        """Budget type is derived from the category, so it follows the dropdown."""
        if event.select.id == "category_select":
            self._refresh_budget()
            self._refresh_preview()

    def _typed_tags(self) -> list[str]:
        """The tags box, normalised into storable tokens."""
        raw = self.query_one("#tags_input", Input).value
        return [tag for tag in (normalize_tag(t) for t in raw.split(",")) if tag]

    def _selected_category(self) -> str | None:
        value = self.query_one("#category_select", Select).value
        return None if value is Select.BLANK else str(value)

    def _refresh_budget(self) -> None:
        """Show which side of the budget the chosen category falls on."""
        category = self._selected_category()
        if not category:
            text = ""
        else:
            spending_type = get_category_spending_type(category, self.category_types)
            text = f"Budget: {spending_type.capitalize()} (from category)"
        self.query_one("#budget_display", Static).update(text)

    def _refresh_preview(self) -> None:
        """Describe what the current pattern would do to the stored transactions."""
        display = self.query_one("#match_preview", Static)
        if self.transactions is None:
            display.update("")
            return

        pattern = self.query_one("#pattern_input", Input).value.strip()
        alias = self.query_one("#alias_input", Input).value.strip()
        preview = preview_alias_change(
            pattern, alias, self.transactions, self.aliases, self.categories
        )

        if preview.error:
            display.update(f"⚠ invalid pattern: {preview.error}")
            return
        if not preview.matched:
            display.update("")
            return

        lines = [f"▸ matches {preview.matched} transactions · {preview.total:,.2f}"]
        was = ", ".join(
            f"{count} {name}"
            for name, count in preview.current_categories.most_common()
        )
        chosen = self._selected_category()
        if was:
            lines.append(f"  currently {was}" + (f" → {chosen}" if chosen else ""))
        lines.append("  claims: " + ", ".join(sorted(preview.merchants)))
        tags = self._typed_tags()
        if tags:
            lines.append(f"  + tags {preview.matched} rows {', '.join(tags)}")
        display.update("\n".join(lines))

    def on_button_pressed(self, event: Button.Pressed) -> None:
        """Handle button presses."""
        if event.button.id == "save":
            self._save_alias()
        else:
            self.dismiss(False)

    def action_save(self) -> None:
        """Save action triggered by Ctrl+S."""
        self._save_alias()

    def action_cancel(self) -> None:
        """Cancel action triggered by Escape."""
        self.dismiss(False)

    def _save_alias(self) -> None:
        """Validate and save the alias."""
        pattern = self.query_one("#pattern_input", Input).value.strip()
        alias = self.query_one("#alias_input", Input).value.strip()

        # If pattern is empty, we're removing the alias
        if not pattern:
            if not alias:
                # Both empty, just cancel
                self.dismiss(False)
                return
            else:
                # Alias without pattern doesn't make sense
                self.notify(
                    "Pattern is required when setting an alias", severity="error"
                )
                return

        # Validate the regex pattern
        import re

        try:
            re.compile(pattern)
        except re.error as e:
            self.notify(f"Invalid regex pattern: {e}", severity="error")
            logging.warning(f"User entered invalid regex pattern: {pattern} - {e}")
            return

        # Both pattern and alias are provided
        if not alias:
            self.notify("Alias name is required", severity="error")
            return

        # Return the merchant-level decision: how to match it, what to call it,
        # and what it counts as.
        self.dismiss((pattern, alias, self._selected_category(), self._typed_tags()))
