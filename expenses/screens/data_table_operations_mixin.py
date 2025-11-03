from textual.widgets import DataTable


class DataTableOperationsMixin:
    """Mixin for common DataTable operations like sorting and selection."""

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

    def action_toggle_selection(self) -> None:
        """Toggle selection for the current row."""
        table = self.query_one("DataTable", DataTable)
        if table.cursor_row is not None:
            if table.cursor_row in self.selected_rows:
                self.selected_rows.remove(table.cursor_row)
            else:
                self.selected_rows.add(table.cursor_row)
            self.update_table()

    def update_table(self):
        """Placeholder method for updating the table.

        This method should be implemented by the class using this mixin.
        """
        raise NotImplementedError(
            "The update_table method must be implemented in the screen."
        )
