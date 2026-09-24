# Quartzo Companion Release Runbook

This runbook covers installable releases of the Quartzo Obsidian Companion.

The final V1 support envelope is tracked in [`docs/v1/COMPANION_V1_CAPABILITY_MATRIX.md`](v1/COMPANION_V1_CAPABILITY_MATRIX.md).

## Release invariants

- Desktop only.
- OAuth uses a Google **Desktop app** client with loopback `127.0.0.1` and PKCE.
- The release build embeds the Google Desktop OAuth **Client ID** and matching **Client Secret/client credential** for the same Desktop app client. Google requires both at the token endpoint for this project type; PKCE remains mandatory.
- User refresh tokens remain in Obsidian `SecretStorage`.
- Release tags must point to commits contained in `main`.
- `package.json`, `manifest.json`, `versions.json`, and the Git tag must describe the same release version.
- The release workflow publishes only artifacts rebuilt and validated by GitHub Actions.

## Google Cloud setup

1. Create or select the Google Cloud project used for Quartzo Companion.
2. Enable:
   - Google Drive API
   - Google Calendar API
3. In **Google Auth Platform**, configure the app branding and audience.
4. For beta testing, add the intended Google accounts as test users while the app remains in Testing.
5. In **Data Access**, configure exactly the scopes requested by the Companion:
   - `https://www.googleapis.com/auth/drive`
   - `https://www.googleapis.com/auth/calendar.readonly`
6. In **Clients**, create a client with application type **Desktop app**.
7. Copy the generated **Client ID** ending in `.apps.googleusercontent.com` and its generated **Client Secret**.
   - Do not commit either value to the repository source tree.
   - Store both only as GitHub Actions repository secrets for release builds.
   - The desktop loopback flow uses Client ID + Client Secret + PKCE; per-user refresh tokens remain the runtime security boundary and stay in Obsidian `SecretStorage`.
   - Do not create a Web application client for the desktop loopback flow.

## GitHub repository setup

Create these repository secrets:

- `QUARTZO_GOOGLE_DESKTOP_CLIENT_ID` — the Desktop OAuth Client ID from Google Cloud.
- `QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET` — the Client Secret/client credential from the same Desktop OAuth Client.

Never paste either OAuth build credential into committed source files, issue comments or release notes.

The existing `QUARTZO_UPSTREAM_TOKEN` remains responsible only for reading the private canonical upstream contracts during CI/release.

## Production preflight

After the release changes are on `main`:

1. Open GitHub Actions.
2. Run **Release Preflight** manually.
3. The workflow must pass:
   - OAuth Client ID presence/shape
   - OAuth Client Secret presence and artifact injection for the matching Desktop client
   - canonical contract verification
   - typecheck/lint/tests
   - sync tests
   - architecture gates
   - production build
   - release validation
   - clean artifact smoke
4. Download the generated `quartzo-companion-<sha>` Actions artifact if a manual install test is desired.

A failed preflight blocks tagging.

## Publish release

For the current version:

1. Confirm `package.json`, `manifest.json`, and `versions.json` all contain the intended version.
2. Create the tag with the exact version string, without a leading `v`.
3. Push the tag.
4. The **Release** workflow rebuilds from the tagged commit and publishes a GitHub release containing:
   - `main.js`
   - `manifest.json`
   - `styles.css`
   - `SHA256SUMS.txt`

Do not manually upload a locally built `main.js` as the canonical release.

## Install with BRAT

1. Install and enable BRAT in Obsidian Desktop.
2. Choose **Add Beta plugin**.
3. Enter `olalaurao/quartzo-obsidian-companion`.
4. Let BRAT install the latest validated release.
5. Enable **Quartzo Companion** in Community plugins.

## OAuth beta caveat

Google projects in **Testing** are intended for development/test users. Their authorizations can expire and require reauthorization. Broader production distribution using sensitive/restricted Google scopes requires completing the applicable Google OAuth verification process.

The Companion currently requests full Drive access because its sync protocol inventories an existing Quartzo vault and uses Drive change tracking. That scope is intentionally not weakened merely to avoid verification.
