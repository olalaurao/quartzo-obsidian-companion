# Quartzo Companion Beta Release Runbook

This runbook covers the first installable beta of the Quartzo Obsidian Companion.

## Release invariants

- Desktop only.
- OAuth uses a Google **Desktop app** client with loopback `127.0.0.1` and PKCE.
- The release build embeds the Google Desktop OAuth **Client ID** and its generated **client credential** because Google's token endpoint requires that value for this client. Desktop/native apps are public clients and cannot keep this credential confidential; PKCE remains mandatory and user tokens remain device-secret.
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
7. Copy the generated **Client ID** ending in `.apps.googleusercontent.com` and the **Client secret** generated for that same Desktop app client.
   - Do not commit either credential to the repository source tree.
   - Store both values only as GitHub Actions repository secrets for release builds.
   - The Desktop client credential is bundled into the distributed desktop artifact and therefore is not a confidentiality boundary; authorization-code PKCE and per-user tokens remain the security boundary.
   - Do not create a Web application client for the desktop loopback flow.

## GitHub repository setup

Create these repository secrets:

- `QUARTZO_GOOGLE_DESKTOP_CLIENT_ID` — the Desktop OAuth Client ID from Google Cloud.
- `QUARTZO_GOOGLE_DESKTOP_CLIENT_SECRET` — the Client secret generated for that same Desktop OAuth client.

Never paste either value into committed source files or release notes.

The existing `QUARTZO_UPSTREAM_TOKEN` remains responsible only for reading the private canonical upstream contracts during CI/release.

## Production preflight

After the release changes are on `main`:

1. Open GitHub Actions.
2. Run **Release Preflight** manually.
3. The workflow must pass:
   - OAuth secret presence/shape
   - canonical contract verification
   - typecheck/lint/tests
   - sync tests
   - architecture gates
   - production build
   - release validation
   - clean artifact smoke
4. Download the generated `quartzo-companion-<sha>` Actions artifact if a manual install test is desired.

A failed preflight blocks tagging.

## Publish beta

For the current beta version:

1. Confirm `package.json`, `manifest.json`, and `versions.json` all contain the intended version.
2. Create the tag with the exact version string, without a leading `v`.
3. Push the tag.
4. The **Release** workflow rebuilds from the tagged commit and publishes a GitHub prerelease containing:
   - `main.js`
   - `manifest.json`
   - `styles.css`
   - `SHA256SUMS.txt`

Do not manually upload a locally built `main.js` as the canonical beta release.

## Install with BRAT

1. Install and enable BRAT in Obsidian Desktop.
2. Choose **Add Beta plugin**.
3. Enter `olalaurao/quartzo-obsidian-companion`.
4. Let BRAT install the latest validated prerelease.
5. Enable **Quartzo Companion** in Community plugins.

## OAuth beta caveat

Google projects in **Testing** are intended for development/test users. Their authorizations can expire and require reauthorization. Broader production distribution using sensitive/restricted Google scopes requires completing the applicable Google OAuth verification process.

The Companion currently requests full Drive access because its sync protocol inventories an existing Quartzo vault and uses Drive change tracking. That scope is intentionally not weakened merely to avoid verification.
