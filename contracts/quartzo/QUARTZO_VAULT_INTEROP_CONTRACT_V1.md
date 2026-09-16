# Quartzo Vault Interop Contract V1

Status: canonical contract. Version: 1.0.0.

## Storage

The vault is the source of truth. Persisted Quartzo objects are Markdown files with YAML frontmatter plus Markdown body. No client may create a parallel canonical object database.

## Object Identification

Object Identification settings are shared client settings. A client must interpret `TypeSignature` records by marker type, marker value, semantic `iconName`, optional `colorHex`, and priority rules defined by Quartzo.

Hardcoded folder assumptions are forbidden when shared Object Identification says otherwise.



## Cross-Client Drive Metadata

Interoperability across clients (Flutter and Companion) uses the public `properties` channel on Google Drive. Private `appProperties` must NOT be used for shared markers, as they are isolated by OAuth Client ID.

### Vault Identity
- The canonical remote vault is primarily identified by its persisted Drive folder ID.
- Cross-client discovery is done via the public marker: `properties.Quartzo_vault = "true"`.
- Only the **ROOT** of the vault possesses this marker. Child folders DO NOT receive this marker.
- Secondary clients (like the Companion) **DO NOT** create canonical roots. If zero candidates are found, it must report `No existing Quartzo vault was found`. If multiple valid candidates exist, the user must choose.
- An arbitrary folder without the public marker is invalid and cannot be assumed to be a vault.
- Migration to add the public marker is permitted only if the client already knows the canonical remote folder ID.

### Metadata & Hash (Quartzo_hash)
- New file writes must publish the hash in `properties.Quartzo_hash` containing the raw bytes SHA-256 string.
- Reads must prefer `properties.Quartzo_hash`. If absent, the client must fallback to downloading raw bytes to calculate the SHA-256 hash.
- Legacy `appProperties.Quartzo_hash` may only be read as a fallback by the client that created it.
- Hashes must be raw bytes SHA-256 without content normalization.

## Unknown Fields

Unknown frontmatter fields must survive unrelated edits. Read-modify-write operations must change only fields owned by the operation, or must preserve unknown keys centrally before saving.

## Recognized Types

Current recognized type strings are defined by `ObjectTypes.all` in Flutter and covered by contract fixtures:

```text
task, habit, tracker, goal, note, entry, event, reminder, pomodoro, system,
social_post, mood_definition, idea, inbox, shopping_list, template, daily_note,
analysis, wellbeing_indicator, area, project, activity, label, person,
day_theme, time_block, value, routine, pillar, action, monthly_focus, quote
```

## Coverage Matrix

Each persisted object fixture declares:

```text
parse
roundtrip
create support
mutation support
scheduler relevance
reminder relevance
daily-schedule relevance
fixture coverage
```

V1 full mutation support is required for Task, Journal Entry, Note, Reminder, Habit, Tracker Definition and Tracking Record before the Companion exposes save controls for them.

## Shared Time State Files

The legacy `sessions/time_architecture_v2.md` remains readable for migration,
but new writes use these versioned shared files:

- `sessions/shared_occurrence_state_v1.md`
- `sessions/shared_planning_state_v1.md`
- `sessions/shared_focus_execution_state_v1.md`
- `sessions/shared_sleep_availability_state_v1.md`

The files are cohesive conflict domains. A client must preserve fields outside
the domain it mutates and must not continue writing the legacy monolith after
migration. Notification delivery registry, native notification IDs and
permission state are device-local and are not part of these files.
