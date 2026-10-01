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
- A release tag is publishable only after **Release Preflight** succeeds for that exact `main` commit SHA.
- The release workflow publishes only artifacts rebuilt and validated by GitHub Actions.
- Do not move/rewrite a tag that already produced a published GitHub Release. A failed/unpublished version should be superseded by the next clean version instead of force-moving published history.

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

## Prepare release metadata

Use the canonical release metadata command instead of editing version files independently:

```bash
npm run release:prepare -- 1.0.26
```

Replace `1.0.26` with the intended version. The command updates together:

- `package.json`
- `manifest.json`
- `versions.json`
- `package-lock.json` when present

Review the diff and commit all generated metadata in the same release-preparation change. Do not create the tag yet.

The current version must satisfy:

- `package.json.version === manifest.json.version`
- `versions.json[package.json.version] === manifest.json.minAppVersion`

CI and `release:validate` enforce these invariants before tagging.

## Production preflight

After the release changes are merged to `main`:

1. Record the exact `main` commit SHA that contains the release metadata.
2. Wait for the normal CI on that commit to finish successfully.
3. Open GitHub Actions.
4. Run **Release Preflight** manually on `main`.
5. Confirm the successful preflight run reports the same exact `head_sha` as the intended release commit.
6. The workflow must pass:
   - OAuth Client ID presence/shape
   - OAuth Client Secret presence and artifact injection for the matching Desktop client
   - canonical contract verification
   - typecheck/lint/tests
   - sync tests
   - architecture gates
   - production build
   - release validation
   - clean artifact smoke
7. Download the generated `quartzo-companion-<sha>` Actions artifact if a manual install test is desired.

A failed or missing exact-commit preflight blocks tagging. The Release workflow independently checks this provenance and refuses to publish a tag whose commit does not have a successful Release Preflight run.

## Publish release

For the current version:

1. Confirm the intended version is still the one in `package.json`, `manifest.json`, and `versions.json`.
2. Confirm `main` has not moved since the successful Release Preflight. If it moved, run Release Preflight again on the new intended release commit.
3. Create the tag with the exact version string, without a leading `v`, pointing to the preflighted commit.
4. Push the tag.
5. The **Release** workflow first verifies that:
   - the tag commit is contained in `main`;
   - a successful Release Preflight exists for that exact commit SHA;
   - release metadata and tag version agree.
6. The workflow then rebuilds from the tagged commit and publishes a GitHub release containing:
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
