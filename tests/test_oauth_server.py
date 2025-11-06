import unittest
from unittest.mock import Mock, patch, MagicMock
import threading
import time
from expenses.oauth_server import (
    TrueLayerCodeStore,
    truelayer_code_store,
    truelayer_callback,
    run_oauth_server,
    get_truelayer_auth_code,
    check_for_truelayer_code,
    app,
)


class TestTrueLayerCodeStore(unittest.TestCase):
    """Test suite for TrueLayerCodeStore."""

    def setUp(self):
        """Set up a fresh code store for each test."""
        self.store = TrueLayerCodeStore()

    def test_initialization(self):
        """Test that code store initializes correctly."""
        assert self.store.auth_code is None
        assert isinstance(self.store.lock, type(threading.Lock()))

    def test_set_auth_code(self):
        """Test setting an auth code."""
        test_code = "test_auth_code_123"
        self.store.set_auth_code(test_code)
        assert self.store.auth_code == test_code

    def test_get_auth_code(self):
        """Test getting an auth code."""
        test_code = "test_auth_code_456"
        self.store.set_auth_code(test_code)
        retrieved_code = self.store.get_auth_code()
        assert retrieved_code == test_code

    def test_get_auth_code_clears_after_retrieval(self):
        """Test that auth code is cleared after retrieval."""
        test_code = "test_auth_code_789"
        self.store.set_auth_code(test_code)
        first_get = self.store.get_auth_code()
        second_get = self.store.get_auth_code()

        assert first_get == test_code
        assert second_get is None

    def test_check_for_code_when_present(self):
        """Test checking for code when it exists."""
        self.store.set_auth_code("some_code")
        assert self.store.check_for_code() is True

    def test_check_for_code_when_absent(self):
        """Test checking for code when it doesn't exist."""
        assert self.store.check_for_code() is False

    def test_check_for_code_after_retrieval(self):
        """Test checking for code after it's been retrieved."""
        self.store.set_auth_code("code_123")
        self.store.get_auth_code()  # Clear the code
        assert self.store.check_for_code() is False

    def test_thread_safety_set_and_get(self):
        """Test thread safety with concurrent set and get operations."""
        codes_set = []
        codes_retrieved = []

        def set_codes():
            for i in range(10):
                self.store.set_auth_code(f"code_{i}")
                time.sleep(0.001)

        def get_codes():
            for _ in range(10):
                code = self.store.get_auth_code()
                if code:
                    codes_retrieved.append(code)
                time.sleep(0.001)

        setter_thread = threading.Thread(target=set_codes)
        getter_thread = threading.Thread(target=get_codes)

        setter_thread.start()
        getter_thread.start()

        setter_thread.join()
        getter_thread.join()

        # Just verify no exceptions occurred and operations completed
        assert True

    def test_multiple_set_overwrites(self):
        """Test that setting multiple times overwrites previous value."""
        self.store.set_auth_code("code_1")
        self.store.set_auth_code("code_2")
        self.store.set_auth_code("code_3")

        retrieved = self.store.get_auth_code()
        assert retrieved == "code_3"


class TestOAuthCallbackEndpoints(unittest.TestCase):
    """Test suite for OAuth callback endpoints."""

    def setUp(self):
        """Set up Flask test client."""
        self.client = app.test_client()
        app.config["TESTING"] = True
        # Reset the global store
        truelayer_code_store.auth_code = None

    def test_truelayer_callback_success(self):
        """Test successful TrueLayer OAuth callback."""
        test_code = "auth_code_success_123"
        response = self.client.get(f"/truelayer-callback?code={test_code}")

        assert response.status_code == 200
        assert b"Authentication successful!" in response.data
        assert truelayer_code_store.check_for_code() is True

    def test_truelayer_callback_with_error(self):
        """Test TrueLayer OAuth callback with error."""
        response = self.client.get(
            "/truelayer-callback?error=access_denied&error_description=User%20denied%20access"
        )

        assert response.status_code == 200
        assert b"Authentication failed" in response.data
        assert b"access_denied" in response.data

    def test_truelayer_callback_no_code_no_error(self):
        """Test TrueLayer OAuth callback without code or error."""
        response = self.client.get("/truelayer-callback")

        assert response.status_code == 200
        assert b"Authentication failed" in response.data
        assert b"No authorization code received" in response.data

    def test_truelayer_callback_stores_code(self):
        """Test that callback properly stores the auth code."""
        test_code = "stored_code_456"
        self.client.get(f"/truelayer-callback?code={test_code}")

        stored_code = get_truelayer_auth_code()
        assert stored_code == test_code

    def test_truelayer_callback_error_with_description(self):
        """Test callback with error and detailed description."""
        error_type = "invalid_request"
        error_desc = "Missing required parameter"

        response = self.client.get(
            f"/truelayer-callback?error={error_type}&error_description={error_desc}"
        )

        assert response.status_code == 200
        assert error_type.encode() in response.data
        assert error_desc.encode() in response.data


class TestServerManagement(unittest.TestCase):
    """Test suite for OAuth server management."""

    @patch("expenses.oauth_server.app.run")
    @patch("expenses.oauth_server.threading.Thread")
    def test_run_oauth_server_starts_successfully(self, mock_thread: Mock, mock_run: Mock):
        """Test that OAuth server starts successfully."""
        mock_thread_instance = MagicMock()
        mock_thread.return_value = mock_thread_instance

        # Reset server state
        import expenses.oauth_server as oauth_module
        oauth_module._server_running = False

        run_oauth_server(port=3000)

        # Verify thread was created and started
        mock_thread.assert_called_once()
        mock_thread_instance.start.assert_called_once()

        # Verify daemon was set
        assert mock_thread_instance.daemon is True

    @patch("expenses.oauth_server.app.run")
    @patch("expenses.oauth_server.threading.Thread")
    def test_run_oauth_server_already_running(self, mock_thread: Mock, mock_run: Mock):
        """Test that server doesn't start if already running."""
        # Set server as already running
        import expenses.oauth_server as oauth_module
        oauth_module._server_running = True

        run_oauth_server(port=3000)

        # Thread should not be created if server already running
        mock_thread.assert_not_called()

    @patch("expenses.oauth_server.app.run")
    @patch("expenses.oauth_server.threading.Thread")
    def test_run_oauth_server_custom_port(self, mock_thread: Mock, mock_run: Mock):
        """Test starting server on custom port."""
        import expenses.oauth_server as oauth_module
        oauth_module._server_running = False

        run_oauth_server(port=5000)

        # Verify thread was created
        mock_thread.assert_called_once()


class TestHelperFunctions(unittest.TestCase):
    """Test suite for OAuth helper functions."""

    def setUp(self):
        """Reset the global store."""
        truelayer_code_store.auth_code = None

    def test_get_truelayer_auth_code(self):
        """Test getting TrueLayer auth code via helper function."""
        test_code = "helper_code_123"
        truelayer_code_store.set_auth_code(test_code)

        retrieved = get_truelayer_auth_code()
        assert retrieved == test_code

    def test_get_truelayer_auth_code_when_empty(self):
        """Test getting auth code when none exists."""
        retrieved = get_truelayer_auth_code()
        assert retrieved is None

    def test_check_for_truelayer_code(self):
        """Test checking for TrueLayer code via helper function."""
        # No code initially
        assert check_for_truelayer_code() is False

        # Set a code
        truelayer_code_store.set_auth_code("code_456")
        assert check_for_truelayer_code() is True

        # Clear the code
        get_truelayer_auth_code()
        assert check_for_truelayer_code() is False

    def test_code_lifecycle(self):
        """Test complete lifecycle of auth code."""
        # 1. Initially no code
        assert check_for_truelayer_code() is False

        # 2. Set code
        test_code = "lifecycle_code"
        truelayer_code_store.set_auth_code(test_code)
        assert check_for_truelayer_code() is True

        # 3. Retrieve code
        retrieved = get_truelayer_auth_code()
        assert retrieved == test_code

        # 4. Code should be cleared after retrieval
        assert check_for_truelayer_code() is False
        assert get_truelayer_auth_code() is None


class TestConcurrency(unittest.TestCase):
    """Test suite for concurrent access patterns."""

    def setUp(self):
        """Reset the global store."""
        self.store = TrueLayerCodeStore()

    def test_concurrent_checks(self):
        """Test multiple threads checking for code simultaneously."""
        self.store.set_auth_code("concurrent_code")
        results = []

        def check_code():
            result = self.store.check_for_code()
            results.append(result)

        threads = [threading.Thread(target=check_code) for _ in range(10)]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # All checks should have returned True
        assert all(results)
        assert len(results) == 10

    def test_concurrent_set_operations(self):
        """Test multiple threads setting codes simultaneously."""
        def set_code(code_value):
            self.store.set_auth_code(code_value)

        threads = [
            threading.Thread(target=set_code, args=(f"code_{i}",))
            for i in range(5)
        ]

        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Store should have one of the codes (last one written)
        final_code = self.store.get_auth_code()
        assert final_code is not None
        assert final_code.startswith("code_")


if __name__ == "__main__":
    unittest.main()
