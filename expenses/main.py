from .app import ExpensesApp


def main() -> None:
    """Run the expense analyzer application."""
    app = ExpensesApp()
    app.run()


if __name__ == "__main__":
    main()
