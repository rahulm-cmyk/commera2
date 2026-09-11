# UTM Sheet

The merchant page at `/campaigns` is now UTM Sheet. Campaign creation and link building are no longer shown. Existing campaign records are retained.

## Administrator Setup

1. Enable Google Sheets API in the Google Cloud project used for Commera2 Google login.
2. Add the Google OAuth scope `https://www.googleapis.com/auth/spreadsheets` to the consent screen. Add test users while the OAuth app is in testing; complete Google's verification requirements before wider release.
3. Add the exact callback URL to the OAuth web client's authorized redirect URIs: `https://commera2.onrender.com/api/integrations/google-sheets/callback` for the hosted app. Use the corresponding origin for local authenticated testing.
4. Set `GOOGLE_SHEETS_REDIRECT_URI` to that URL and `GOOGLE_SHEETS_CREDENTIALS_SECRET` to a stable, randomly generated secret of at least 32 bytes. Retain the secret across deployments. Existing `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are reused. Do not commit secrets.
5. Restart the server. Sign in, open UTM Sheet, and connect Google. Google login itself does not authorize Sheets access.

## Merchant Flow

Connect Google, paste a Google Sheet URL, choose the worksheet, confirm column matching, and start auto-sync. Column names must be on the first row. Order ID must map to exactly one column. Unmatched columns are left empty on newly appended rows. Existing rows and formulas are not rewritten. Uploaded XLSX files must first be opened as Google Sheets.

Only orders created after first enabling a destination are exported. Resuming the same destination also exports orders accumulated during a pause. Exports run every 30 seconds while the server is running, including orders without UTM values. Monetary totals are in the store currency. No customer contact data is exported.

Failed exports retain pending orders for retries; the page shows the error. An Order ID check in the destination handles retries after an uncertain append response. Keep order IDs intact and do not share the same destination worksheet between stores with overlapping order numbers. Existing manual rows with the same order ID are treated as already exported. This is an append-only order export, not a refund/status-update feed.

Disconnect deletes the locally stored OAuth credential and stops exports. Google account permissions can also be removed from the Google account's third-party connections page.

The unauthenticated local UI preview cannot connect Google. Test real authorization on the authenticated app. Automated tests use fake Google responses and do not write to a real spreadsheet.

References: https://developers.google.com/workspace/sheets/api/scopes and https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append
