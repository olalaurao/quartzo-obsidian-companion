# Quartzo Vault Identity Contract

A canonical Quartzo Vault in Google Drive is defined as a directory matching the following criteria:

- `mimeType`: `application/vnd.google-apps.folder`
- `trashed`: `false`
- `appProperties`: Must contain a key `Quartzo_vault` with the exact value `"true"`.

## Constraints

- Clients (such as the Companion plugin) MUST NOT silently create or populate a second vault if they cannot find one.
- Clients MUST search using pagination to ensure all available candidates are evaluated.
- If no matching folders are found, the client MUST gracefully report "No existing Quartzo vault was found" without initiating uploads or defaulting to arbitrary folders.
