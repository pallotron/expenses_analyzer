export PATH := $(HOME)/.local/bin:$(HOME)/.cargo/bin:$(PATH)

VENV_DIR := .venv
FLAKE8 := $(VENV_DIR)/bin/flake8
BLACK := $(VENV_DIR)/bin/black
PYTEST := $(VENV_DIR)/bin/pytest
UV := uv

.PHONY: all lint format test venv install

all: lint test

install:
	@echo "Installing with pipx..."
	@if ! command -v pipx &> /dev/null; then \
	    echo "pipx not found, installing..."; \
	    python3 -m pip install --user pipx; \
	    python3 -m pipx ensurepath; \
	fi
	pipx install . --force

venv:
	@echo "Setting up virtual environment..."
	@if ! command -v $(UV) &> /dev/null; then \
	    echo "uv not found, installing..."; \
	    curl -LsSf https://astral.sh/uv/install.sh | sh; \
	fi
	@if [ ! -d "$(VENV_DIR)" ]; then \
	    echo "Creating virtual environment in $(VENV_DIR)..."; \
	    $(UV) venv; \
	fi
	@echo "Installing dependencies..."
	$(UV) pip install -r requirements.txt
	$(UV) pip install flake8 pytest black

lint: venv
	@echo "Running flake8 linting..."
	$(FLAKE8) . --count --select=E9,F63,F7,F82 --show-source --statistics
	$(FLAKE8) . --count --exit-zero --max-complexity=10 --max-line-length=110 --statistics

format: venv
	@echo "Running black formatter..."
	$(BLACK) .

test: venv
	@echo "Running pytest tests..."
	PYTHONPATH=. $(PYTEST)
