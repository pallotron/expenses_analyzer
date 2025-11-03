# TODO - Expenses Analyzer Improvements

## 🚨 High Priority

### Security & Data Protection

- [ ] Add input validation for CSV imports to prevent malicious file uploads
- [ ] Implement data encryption for sensitive financial data at rest
- [ ] Add configuration option to exclude sensitive merchants from logs
- [ ] Sanitize file paths in file browser to prevent directory traversal attacks
- [ ] Add rate limiting for Gemini API calls to prevent excessive costs
- [ ] Store API keys more securely (consider using keyring library)

### Testing & Quality Assurance

- [x] Increase test coverage to 80%+ ✅ (currently 81%, 15 test files, 146 tests)
  - [x] Add tests for all screen components ✅
  - [x] Add tests for gemini_utils.py ✅
  - [x] Add tests for transaction_filter.py ✅
  - [x] Add integration tests for complete workflows ✅
  - [x] Add extended tests for transaction_screen.py ✅
  - [x] Add extended tests for data_handler.py ✅
- [x] Add test coverage reporting (pytest-cov) ✅
- [x] Set up continuous integration test coverage badges ✅
- [x] Add property-based testing for data handling functions ✅
- [x] Add UI/TUI testing using Textual's testing framework ✅

### Data Integrity

- [ ] Add database migration system for schema changes
- [ ] Implement backup/restore functionality for transactions
- [ ] Add data validation before saving to Parquet
- [ ] Handle corrupted Parquet files gracefully
- [ ] Add transaction versioning/audit trail
- [ ] Implement soft delete instead of hard delete for transactions

## 📈 Medium Priority

### Features & Functionality

- [ ] Add export functionality (CSV, Excel, PDF reports)
- [ ] Implement budget tracking and alerts
- [ ] Add recurring transaction detection and management
- [ ] Support multiple currencies with conversion
- [ ] Add split transactions (e.g., single purchase multiple categories)
- [ ] Implement tags for transactions (in addition to categories)
- [ ] Add search functionality across all transactions
- [ ] Create custom date range filtering
- [ ] Add year-over-year comparison charts
- [ ] Implement income tracking (not just expenses)
- [ ] Add savings goals tracking
- [ ] Support for multiple accounts/profiles

### User Experience

- [ ] Add undo/redo functionality for bulk operations
- [ ] Implement keyboard shortcuts help screen
- [ ] Add progress indicators for long-running operations (imports, AI categorization)
- [ ] Improve error messages with actionable suggestions
- [ ] Add confirmation dialogs for destructive operations
- [ ] Implement transaction editing (currently read-only after import)
- [ ] Add bulk editing capabilities
- [ ] Create onboarding tutorial for first-time users
- [ ] Add dark/light theme switching
- [ ] Implement custom column visibility in tables

### Performance

- [ ] Optimize DataFrame operations for large datasets (>100k transactions)
- [ ] Implement lazy loading for transaction tables
- [ ] Add pagination for large result sets
- [ ] Cache category mappings in memory
- [ ] Optimize Parquet read/write operations
- [ ] Profile and optimize slow operations

### AI & Categorization

- [ ] Support multiple AI providers (OpenAI, Claude, local models)
- [ ] Add confidence scores for AI categorization
- [ ] Implement learning from user corrections
- [ ] Batch AI requests to reduce API costs
- [ ] Add option to categorize by transaction amount patterns
- [ ] Create merchant name normalization (e.g., "AMZN" → "Amazon")
- [ ] Add smart category suggestions based on transaction history

## 🔧 Low Priority

### Code Quality & Architecture

- [ ] Add type hints to all functions (partially done)
- [ ] Set up mypy for static type checking
- [ ] Add pre-commit hooks (black, flake8, mypy, tests)
- [ ] Refactor large screen files into smaller components
- [ ] Implement dependency injection for better testability
- [ ] Add docstrings to all public functions
- [ ] Create architecture documentation
- [ ] Set up code complexity monitoring
- [ ] Add logging levels configuration
- [ ] Implement proper error handling hierarchy

### Documentation

- [ ] Create API documentation (Sphinx or MkDocs)
- [ ] Add inline code examples in docstrings
- [ ] Create troubleshooting guide
- [ ] Document CSV format requirements
- [ ] Add architecture diagrams
- [ ] Create video tutorial/demo
- [ ] Add FAQ section
- [ ] Document performance best practices
- [ ] Create contributor guidelines (CONTRIBUTING.md)
- [ ] Add changelog (CHANGELOG.md)

### DevOps & Distribution

- [ ] Add automated version bumping
- [ ] Create release workflow (GitHub Actions)
- [ ] Publish to PyPI
- [ ] Add Docker support
- [ ] Create Homebrew formula for macOS
- [ ] Add Windows installer
- [ ] Set up automated dependency updates (Dependabot)
- [ ] Add security scanning (Snyk, Safety)
- [ ] Create performance benchmarks
- [ ] Add telemetry (opt-in) for error reporting

### Configuration & Customization

- [ ] Add configuration file support (YAML/TOML)
- [ ] Make UI colors customizable
- [ ] Allow custom category lists without editing JSON
- [ ] Add user preferences screen in TUI
- [ ] Support custom date formats
- [ ] Allow custom CSV import templates
- [ ] Add plugin system for custom importers

### Data Analysis & Visualization

- [ ] Add more chart types (pie charts, line graphs, heatmaps)
- [ ] Implement forecasting based on historical data
- [ ] Add anomaly detection for unusual spending
- [ ] Create spending insights/recommendations
- [ ] Add comparative analysis (this month vs. last month)
- [ ] Implement category drill-down analysis
- [ ] Add merchant spending trends
- [ ] Create custom reports builder

## 🐛 Known Issues / Technical Debt

- [x] `load_transactions_from_csvs()` function in data_handler.py is unused dead code (remove it) ✅
  - CSV imports work through ImportScreen.import_data() → append_transactions()
- [ ] Inconsistent error handling across screens
- [ ] Some widgets lack proper accessibility features
- [ ] Git history shows fragmented commits (consider squashing)
- [ ] No version pinning in requirements.txt (use specific versions)
- [ ] Missing `.python-version` file for consistent Python version
- [ ] Gemini API model hardcoded to "gemini-flash-latest" (should be configurable)
- [ ] No timeout handling for API calls
- [ ] Category file structure inconsistency (sometimes list, sometimes dict)

## 🎯 Quick Wins (Easy Improvements)

- [x] Remove unused `load_transactions_from_csvs()` function from data_handler.py ✅
- [ ] Add version flag (`expenses-analyzer --version`)
- [ ] Pin dependency versions in requirements.txt
- [ ] Add `.python-version` file (Python 3.12)
- [ ] Create CONTRIBUTING.md file
- [ ] Add issue templates for GitHub
- [ ] Create pull request template
- [ ] Add badges to README (CI status, license, version)
- [ ] Set up GitHub Discussions for community
- [ ] Add example CSV files in examples/ directory
- [ ] Create quick start guide (5-minute setup)
- [ ] Add shell completion scripts (bash, zsh, fish)
- [ ] Improve logging output format
- [ ] Add `--debug` flag for verbose logging

## 📊 Metrics to Track

- [ ] Test coverage percentage (goal: >80%)
- [ ] Code complexity (cyclomatic complexity)
- [ ] Performance benchmarks (import speed, query speed)
- [ ] User satisfaction (GitHub stars, feedback)
- [ ] Bug resolution time
- [ ] Documentation completeness

## 🔮 Future Ideas (Long-term)

- [ ] Web interface (in addition to TUI)
- [ ] Mobile companion app
- [ ] Bank account direct integration (Open Banking API)
- [ ] Receipt scanning with OCR
- [ ] Multi-user support with sync
- [ ] Cloud backup integration
- [ ] Integration with accounting software
- [ ] Tax report generation
- [ ] Investment tracking
- [ ] Net worth calculator

---

## Notes

**Strengths of Current Implementation:**

- Clean TUI with Textual framework
- Good separation of concerns (screens, widgets, data handlers)
- Efficient data storage with Parquet
- AI-powered categorization
- Basic CI/CD setup
- MIT license (open source friendly)
- Good README with screenshots

**Architecture Considerations:**

- Current codebase: ~2,400 lines of Python
- Well-structured with screens, widgets, and utilities
- Could benefit from a service layer for business logic
- Consider moving to a more formal state management pattern for complex operations

**Priority Recommendation:**
Focus on security, testing, and data integrity first before adding new features. The foundation is solid, but these areas need strengthening for production use with sensitive financial data.
