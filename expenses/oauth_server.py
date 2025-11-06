import threading
import logging
from flask import Flask, request


class TrueLayerCodeStore:
    def __init__(self):
        self.auth_code = None
        self.lock = threading.Lock()

    def set_auth_code(self, code):
        with self.lock:
            self.auth_code = code

    def get_auth_code(self):
        with self.lock:
            code = self.auth_code
            self.auth_code = None  # Clear after retrieval
            return code

    def check_for_code(self):
        with self.lock:
            return self.auth_code is not None


truelayer_code_store = TrueLayerCodeStore()

app = Flask(__name__)
_server_running = False
_server_lock = threading.Lock()


# TrueLayer OAuth endpoint
@app.route("/truelayer-callback")
def truelayer_callback():
    """Endpoint to catch the TrueLayer OAuth redirect and extract the authorization code."""
    code = request.args.get("code")
    error = request.args.get("error")
    error_description = request.args.get("error_description")

    if error:
        logging.error(f"TrueLayer OAuth error: {error} - {error_description}")
        return f"""
            <h1>Authentication failed</h1>
            <p>Error: {error}</p>
            <p>{error_description}</p>
            <p>Please close this tab and try again.</p>
        """

    if code:
        logging.debug("Received authorization code via TrueLayer OAuth callback")
        truelayer_code_store.set_auth_code(code)
        return """
            <h1>Authentication successful!</h1>
            <p>You can now close this browser tab and return to the application.</p>
            <script>window.close();</script>
        """
    else:
        logging.warning("TrueLayer OAuth callback received without a code or error.")
        return """
            <h1>Authentication failed.</h1>
            <p>No authorization code received. Please try again.</p>
        """


def run_oauth_server(port=3000):
    """Runs the unified Flask OAuth server in a separate thread."""
    global _server_running

    with _server_lock:
        if _server_running:
            logging.info(f"OAuth callback server already running on port {port}")
            return

        log = logging.getLogger("werkzeug")
        log.setLevel(logging.ERROR)

        server_thread = threading.Thread(
            target=lambda: app.run(port=port, debug=False, use_reloader=False)
        )
        server_thread.daemon = True
        server_thread.start()
        _server_running = True
        logging.info(f"Unified OAuth callback server started on port {port}")


# TrueLayer-specific functions
def get_truelayer_auth_code():
    """Retrieves the stored TrueLayer authorization code."""
    return truelayer_code_store.get_auth_code()


def check_for_truelayer_code():
    """Checks if a TrueLayer authorization code is available."""
    return truelayer_code_store.check_for_code()
