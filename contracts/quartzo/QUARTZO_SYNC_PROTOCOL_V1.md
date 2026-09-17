# Quartzo Sync Protocol V1

Status: canonical contract. Version: 1.0.0.

## Identity

- Remote provider: Google Drive.
- Remote vault identity: Drive folder ID, not folder name.
- File identity: normalized vault-relative path plus remote file ID when known.
- Duplicate remote candidates for one relative path are ambiguous identity and must fail closed.

## File Scope

Sync every canonical vault file unless explicitly excluded.

Included:

- `*.md`
- `*.base`
- `_attachments/**`
- `_deleted/**` as soft-delete state when reconciliation requires it

Excluded from live canonical scans:

- `.obsidian/**`
- `.git/**`
- `.trash/**`
- `_backups/**`
- `_conflicts/**`
- `_diagnostics/**`
- `_cache/**`
- crash reports, temporary editor files and plugin-local sync metadata

Local and remote scans must use the same classification policy.

## Hashing

Canonical hash is `SHA-256(raw file bytes)`.

For Markdown, this equals SHA-256 of the persisted UTF-8 bytes. Clients must not normalize newlines, Unicode, images, audio, or binary assets before hashing.

Remote metadata key: `Quartzo_hash`.

## Local State

Each client stores local sync state outside the vault:

```text
relativePath
localHash
remoteHash
baseHash
remoteFileId
lastSyncedAt
localModifiedAt
remoteModifiedAt
```

This state is device-local and never synchronized.

## Reconciliation Matrix

Let `B = baseHash`, `L = local hash`, and `R = remote hash`.

- `L == R`: no conflict; advance baseline to `L`.
- `L == B && R != B`: pull remote; baseline becomes `R`.
- `L != B && R == B`: push local; baseline becomes `L`.
- `L != B && R != B && L == R`: no conflict; baseline becomes `L`.
- `L != B && R != B && L != R`: true conflict; neither side is overwritten.

## Unknown Base

`baseHash == null` is never overwrite permission.

- Remote exists, local missing: pull.
- Local and remote both exist with identical bytes: establish baseline.
- Local and remote both exist with different bytes: conflict.
- Local exists and remote missing while pairing to an existing remote vault: mark as unpaired/adoption required; do not publish automatically.

## Deletion And Rename

Quartzo uses soft-delete semantics. Active views exclude `_deleted/`.

- Remote deletion + local unchanged: propagate deletion/removal locally.
- Remote deletion + local changed: conflict.
- Local delete + remote unchanged: propagate canonical soft-delete behavior.
- Rename/move is modeled as path identity change plus remote ID preservation when known.

## Conflicts

Conflicts are registered through the single canonical conflict pipeline. Sync code must not silently pick newest, local, or remote. Conflict resolution is explicit and advances `localHash`, `remoteHash`, and `baseHash` to the resolved hash.

## Runtime Rules

- One sync operation at a time; concurrent triggers coalesce.
- Retry 429, 5xx and temporary connectivity errors with backoff.
- One safe credential refresh is allowed for 401 or credential-related 403; persistent auth failure becomes authentication required.
- Watcher loop prevention uses expected post-write hash and sync transaction identity, not a timing-only delay.

## Missing Remote Metadata

`Quartzo_hash` is required for a trusted remote baseline. A remote file whose
metadata is missing the property must not be overwritten merely because its
timestamp is newer or because the local client has no `baseHash`. The client
may download the raw bytes to prove that the remote content is identical; if
the bytes differ, it registers a conflict through the canonical pipeline.

## Pairing And Adoption

Pairing a client to an existing remote vault is a separate state from ordinary
sync. A local-only file with `baseHash == null` is marked as requiring explicit
adoption when the remote vault already contains canonical content. It is never
published as an implicit first-client winner.

## Rename And Move

A rename or move is represented by the new normalized relative path and the
known remote file ID. Clients must not infer a rename from timestamps alone.
When identity cannot be proven, the old path and new path are reconciled as
independent candidates and any destructive operation requires explicit
resolution.

## Compatibility And Migration

The protocol and vault interop versions are recorded in
`contracts/quartzo/contract_manifest.json`. A client that encounters a higher
major version must block unsafe mutations. Minor-compatible additions may be
preserved as unknown metadata. Migrations must be idempotent, recoverable and
must not mass re-upload UTF-8 Markdown whose raw-byte hash is unchanged.

Before a potentially destructive migration, the existing backup service creates
the recovery artifact. Backup and conflict folders are never re-ingested as
live canonical vault content.
