import threading
import logging
from flask import Flask, request


# A simple thread-safe way to store the token and oauth_state_id
class TokenStore:
    def __init__(self):
        self.public_token = None
        self.oauth_state_id = None
        self.link_token = None
        self.lock = threading.Lock()

    def set_public_token(self, token):
        with self.lock:
            self.public_token = token

    def get_public_token(self):
        with self.lock:
            token = self.public_token
            self.public_token = None  # Clear after retrieval
            return token

    def set_oauth_state_id(self, state_id):
        with self.lock:
            self.oauth_state_id = state_id

    def get_oauth_state_id(self):
        with self.lock:
            state_id = self.oauth_state_id
            self.oauth_state_id = None  # Clear after retrieval
            return state_id

    def set_link_token(self, token):
        with self.lock:
            self.link_token = token

    def get_link_token(self):
        with self.lock:
            return (
                self.link_token
            )  # Don't clear - we need it for OAuth reinitialization


public_token_store = TokenStore()


app = Flask(__name__)


@app.route("/oauth-callback")
def oauth_callback():
    """Endpoint to catch the Plaid OAuth redirect and extract the public_token or oauth_state_id."""
    public_token = request.args.get("public_token")
    oauth_state_id = request.args.get("oauth_state_id")

    if public_token:
        logging.debug(f"Received public_token via OAuth callback: {public_token}")
        public_token_store.set_public_token(public_token)
        return (
            "<h1>Authentication successful!</h1>"
            "<p>You can now close this browser tab and return to the application.</p>"
            "<script>window.close();</script>"
        )
    elif oauth_state_id:
        # Store the full received redirect URI (not just the state ID)
        received_redirect_uri = request.url
        logging.debug(
            f"OAuth flow redirected with state ID: {oauth_state_id}. "
            f"Storing received redirect URI: {received_redirect_uri}"
        )
        public_token_store.set_oauth_state_id(received_redirect_uri)

        # Return an HTML page that will reinitialize Plaid Link with the received redirect URI
        # We need to get the link token from the store to reinitialize
        link_token = public_token_store.link_token
        if link_token:
            return f"""
            <html>
            <head>
                <title>Completing Bank Connection...</title>
                <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
            </head>
            <body>
                <h1>Completing your bank connection...</h1>
                <p>Please wait while we finalize your connection.</p>
                <script>
                const linkHandler = Plaid.create({{
                    token: '{link_token}',
                    receivedRedirectUri: '{received_redirect_uri}',
                    onSuccess: function(public_token, metadata) {{
                        var url = 'http://localhost:3000/exchange-token?public_token=';
                        fetch(url + public_token).then(() => {{
                            document.body.innerHTML = '<h1>Success!</h1><p>You can now close this tab.</p>';
                            setTimeout(() => window.close(), 2000);
                        }});
                    }},
                    onExit: function(err, metadata) {{
                        if (err) {{
                            document.body.innerHTML = '<h1>Error</h1><p>' + err.error_message + '</p>';
                        }} else {{
                            document.body.innerHTML = '<h1>Cancelled</h1><p>You can close this tab.</p>';
                        }}
                    }}
                }});
                linkHandler.open();
                </script>
            </body>
            </html>
            """
        else:
            logging.error("No link token available for OAuth reinitialization")
            return "<h1>Error</h1><p>Unable to complete authentication. Please try again.</p>"
    else:
        logging.warning(
            "OAuth callback received without a public_token or oauth_state_id."
        )
        return "<h1>Authentication failed.</h1><p>No token or state ID received. Please try again.</p>"


@app.route("/exchange-token")
def exchange_token():
    """Simple endpoint to receive the public token from the frontend."""
    public_token = request.args.get("public_token")
    if public_token:
        logging.debug(f"Received public_token from reinitialized Link: {public_token}")
        public_token_store.set_public_token(public_token)
        return "OK"
    return "ERROR", 400


def run_oauth_server(port=3000):
    """Runs the Flask server in a separate thread."""
    log = logging.getLogger("werkzeug")
    log.setLevel(logging.ERROR)

    server_thread = threading.Thread(
        target=lambda: app.run(port=port, debug=False, use_reloader=False)
    )
    server_thread.daemon = True
    server_thread.start()
    logging.info(
        f"Plaid OAuth callback server started in a background thread on port {port}"
    )


def get_public_token():
    """Retrieves the stored public token."""
    return public_token_store.get_public_token()


def get_oauth_state_id():
    """Retrieves the stored OAuth state ID (actually the full received redirect URI)."""
    return public_token_store.get_oauth_state_id()


def get_received_redirect_uri():
    """Retrieves the stored received redirect URI."""
    return public_token_store.get_oauth_state_id()


def set_link_token(token):
    """Stores the link token for OAuth reinitialization."""
    public_token_store.set_link_token(token)
