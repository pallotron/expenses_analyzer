from typing import Any, Set, Protocol, TypeVar
from textual.widgets import DataTable

_WidgetT = TypeVar("_WidgetT", bound=DataTable)

class HasQueryOne(Protocol):
    selected_rows: Set[Any]
    def query_one(self, query: str, expect_type: type[_WidgetT]) -> _WidgetT: ...
    def update_table(self) -> None: ...


class DataTableOperationsMixin:
    """Mixin for common DataTable operations like sorting and selection."""
    
    sort_column: str
    sort_order: str
    selected_rows: Set[Any]

    def on_data_table_header_selected(self, event: DataTable.HeaderSelected) -> None:
        """Handle column header presses for sorting."""
        column_name = str(event.label).strip()
        if " " in column_name:
            column_name = column_name.split(" ")[0]

        if column_name == self.sort_column:
            self.sort_order = "desc" if self.sort_order == "asc" else "asc"
        else:
            self.sort_column = column_name
            self.sort_order = "asc"
        self.populate_table()

    def action_toggle_selection(self: HasQueryOne) -> None:
        """Toggle selection for the current row."""
        table = self.query_one("DataTable", DataTable)
        if table.cursor_row is not None:
            if table.cursor_row in self.selected_rows:
                self.selected_rows.remove(table.cursor_row)
            else:
                self.selected_rows.add(table.cursor_row)
            self.update_table()

    def update_table(self) -> None:
        """Placeholder method for updating the table.

        This method should be implemented by the class using this mixin.
        """
        raise NotImplementedError(
            "The update_table method must be implemented in the screen."
        )
    
    def populate_table(self) -> None:
        """Placeholder method for populating the table.
        
        This method should be implemented by the class using this mixin.
        """
        raise NotImplementedError(
            "The populate_table method must be implemented in the screen."
        )
