# TrueLayer Integration Setup Guide

This guide explains how to set up and use the TrueLayer bank integration in Expenses Analyzer.

## Prerequisites

1. **TrueLayer Developer Account**
   - Sign up at [TrueLayer Console](https://console.truelayer.com)
   - Create a new application
   - Note your `CLIENT_ID` and `CLIENT_SECRET`

2. **Configure Redirect URI**
   - In TrueLayer Console, add this redirect URI to your application:
     ```
     http://localhost:3000/truelayer-callback
     ```
   - **Important:** The redirect URI must match exactly (including the port 3000)

## Environment Setup

Set the following environment variables:

```bash
export TRUELAYER_CLIENT_ID="your_client_id_here"
export TRUELAYER_CLIENT_SECRET="your_client_secret_here"
export TRUELAYER_ENV="sandbox"  # Use "production" for live banking
```

For persistent configuration, add these to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.).

## Using TrueLayer Integration

### Connecting Your Bank Account

1. Launch the application:
   ```bash
   expenses-analyzer
   ```

2. Press `Shift+L` to open the TrueLayer integration screen

3. Click "Connect Bank Account"
   - A browser window will open with TrueLayer's authentication page
   - Select your bank from the list
   - Log in with your online banking credentials
   - Authorize Expenses Analyzer to access your account data

4. Once connected, you'll see a success message

### Syncing Transactions

1. Press `Shift+L` to open the TrueLayer screen (if not already open)

2. Click "Sync Transactions"
   - The app will fetch transactions from all connected accounts
   - By default, fetches the last 90 days of transactions
   - After first sync, only new transactions are fetched

3. Review the transaction preview (first 10 transactions shown)

4. Click "Import These Transactions" to add them to your expense database

### Data Access Limitations

**Important:** Due to Open Banking regulations, the first time you connect a bank account, TrueLayer can typically only retrieve the last **90 days** of transaction history.

To build a complete financial record, please see the "Recommended Workflow" section in our [Importing Data Guide](IMPORTING_DATA.md) for instructions on combining a one-time CSV import with ongoing bank sync.

### Transaction Processing

- **Debit transactions** (money going out) are imported as expenses
- **Credit transactions** (money coming in) are automatically filtered out
- Amounts are converted to positive numbers for expense tracking
- Each transaction is tagged with source: "TrueLayer - {Bank Name}"
- Duplicates are automatically detected and skipped
- AI categorization runs automatically if `GEMINI_API_KEY` is set

## Architecture

### Files Structure

```
expenses/
├── oauth_server.py              # Unified OAuth server (port 3000)
├── truelayer_handler.py         # Core TrueLayer API logic
├── screens/
│   └── truelayer_screen.py      # TUI interface
└── config.py                    # Environment variables

~/.config/expenses_analyzer/
└── truelayer_connections.json   # Stored access tokens
```

### Data Storage

Connected accounts are stored in `~/.config/expenses_analyzer/truelayer_connections.json`:

```json
[
  {
    "connection_id": "tl_1234567890",
    "access_token": "...",
    "refresh_token": "...",
    "provider_name": "Your Bank",
    "last_sync": "2024-01-15T10:30:00",
    "expires_in": 3600
  }
]
```

**Security:** This file has restricted permissions (600) and should never be committed to version control.

## API Endpoints Used

### Sandbox Environment
- Auth: `https://auth.truelayer-sandbox.com`
- Data API: `https://api.truelayer-sandbox.com/data/v1`

### Production Environment
- Auth: `https://auth.truelayer.com`
- Data API: `https://api.truelayer.com/data/v1`

## Troubleshooting

### "Invalid redirect_uri" Error

**Problem:** TrueLayer shows an error page with "invalid redirect_uri"

**Solution:**
1. Go to [TrueLayer Console](https://console.truelayer.com)
2. Select your application
3. Navigate to Settings → Redirect URIs
4. Add exactly: `http://localhost:3000/truelayer-callback`
5. Save changes and try connecting again

**Note:** The redirect URI must match exactly, including:
- Protocol: `http` (not `https` for localhost)
- Port: `3000`
- Path: `/truelayer-callback`

### "Bad Request" Error

**Problem:** Browser redirects to TrueLayer error page with "bad request"

**Possible causes:**
1. **Client ID not configured** - Ensure `TRUELAYER_CLIENT_ID` is set correctly
2. **Invalid client ID** - Double-check the CLIENT_ID from TrueLayer Console
3. **Environment mismatch** - Ensure `TRUELAYER_ENV` matches your credentials (sandbox vs production)
4. **Redirect URI not registered** - See "Invalid redirect_uri" section above

**Solution:**
1. Verify environment variables are set:
   ```bash
   echo $TRUELAYER_CLIENT_ID
   echo $TRUELAYER_CLIENT_SECRET
   echo $TRUELAYER_ENV
   ```
2. Check that CLIENT_ID matches what's shown in TrueLayer Console
3. Ensure you're using sandbox credentials with `TRUELAYER_ENV=sandbox`
4. Restart the application after setting environment variables

### Connection Expires

TrueLayer access tokens expire after 1 hour. The integration stores refresh tokens to automatically obtain new access tokens. If you encounter authentication errors:

1. Try syncing again - the app will attempt to refresh the token
2. If that fails, disconnect and reconnect your bank account

### No Transactions Imported

Possible reasons:
- All transactions are credits (salary, refunds) - only debits are imported
- Transactions are duplicates of previously imported ones
- Date range doesn't include any transactions

Check the logs at `~/.config/expenses_analyzer/app.log` for details.

### Port 3000 Already in Use

If you see "Address already in use" error:

1. Check what's using port 3000:
   ```bash
   lsof -i :3000
   ```

2. Kill the process or wait for it to finish

3. The unified OAuth server is shared with other integrations, so this shouldn't happen during normal usage

## Supported Regions

TrueLayer supports banks in:
- United Kingdom (primary market)
- Ireland
- France
- Germany
- Spain
- Netherlands
- And other European countries

Check [TrueLayer's coverage](https://truelayer.com/coverage/) for a complete list.

## Testing

Run the TrueLayer test suite:

```bash
PYTHONPATH=. pytest tests/test_truelayer_handler.py -v
```

All 23 tests should pass.

## Switching to Production

When ready to connect real bank accounts:

1. Apply for production access in TrueLayer Console
2. Update environment variable:
   ```bash
   export TRUELAYER_ENV="production"
   ```
3. Update redirect URI in TrueLayer Console to use your production domain
4. Reconnect your bank accounts

## Rate Limits

TrueLayer has rate limits on API calls. The integration includes:
- Automatic pagination for large transaction sets
- Incremental syncing using `last_sync` timestamp
- Error handling for rate limit responses

## Privacy & Security

- All bank credentials are handled by TrueLayer - never stored locally
- Access tokens stored with secure file permissions (600)
- OAuth server only runs during authentication
- Transactions stored in local Parquet file (not sent to external services)
- AI categorization (if enabled) sends merchant names only, not amounts or dates

## Support

For issues specific to:
- **TrueLayer API:** Contact TrueLayer support or check their [documentation](https://docs.truelayer.com)
- **Expenses Analyzer integration:** Open an issue on the GitHub repository

## Advanced: Multiple Bank Connections

The integration supports multiple bank connections:

1. Connect first bank (press `Shift+L`, click Connect)
2. After success, manually edit `~/.config/expenses_analyzer/truelayer_connections.json`
3. Connect additional banks (repeat step 1)
4. All accounts from all connections will be synced

Note: Currently, sync fetches from all accounts but the UI shows aggregated results.
