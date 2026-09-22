# V1 Capability Matrix (Quartzo Obsidian Companion)

This document formalizes the capabilities supported by the **Quartzo Obsidian Companion (V1)**, ensuring alignment with the upstream `QUARTZO_OBSIDIAN_COMPANION_CONTRACT.md` and the `P0_COMPLIANCE_MATRIX.md`.

## Sync & Integrations

| Capability | Status | Notes |
|---|---|---|
| **Google Drive Pairing** | ✅ Full | Supported via Desktop OAuth loopback (no webview). Preserves `Quartzo_hash` and uses raw-byte SHA-256 for legacy resolution. |
| **Incremental Sync** | ✅ Full | Bi-directional (Push/Pull) with conflict detection. Preserves unchanged local bases. |
| **Divergent Resolution** | ✅ Full | UI cards for "Keep local" / "Keep Drive". |
| **Sync Center Diagnostics** | ✅ Full | Exposes pending paths and exact reasons (e.g., local modify, adoption required). |
| **Google Calendar** | 🔶 Read-only | Events project into Home, Planner, and Day Dial. Zero Markdown mutation. Links open externally. |

## Domain Objects (Mutation Support)

The Companion UI allows creating and editing the following object types (via Universal Detail or Quick Add):

| Object Type | Mutation Support | Notes |
|---|---|---|
| **Task** | ✅ Full | Includes recurrence, reminders, and scheduling. |
| **Habit** | ✅ Full | Linked to tracker definitions. |
| **Tracker Definition** | ✅ Full | Defines metrics and habits. |
| **Tracker Entry/Record** | ✅ Full | Logging values. |
| **Note** | ✅ Full | Standard Markdown body edits. |
| **Reminder** | ✅ Full | Cross-client Snooze/Done/Skip projected via local notification. |
| **Resource** | ✅ Full | External links and metadata. |
| **Goal** | 🔶 Read-only | Handled via "Open Markdown". |
| **Project** | 🔶 Read-only | Handled via "Open Markdown". |
| **System/Routine** | 🔶 Limited | Execute steps manually. Recurring definitions are read-only. |

## Features & Surfaces

| Feature | Status | Notes |
|---|---|---|
| **Home (A7)** | ✅ Full | Supports Overdue, Adaptive, Capacity, Essentials, and Parked states. |
| **Planner** | ✅ Full | Day Timeline and Adaptive Planner shared snapshot. |
| **Day Dial** | ✅ Full | Projects NormalizedSchedule to 24h geometry. |
| **Journal** | ✅ Full | Markdown timeline of events/notes. |
| **Focus/Pomodoro** | ✅ Full | Read/write for owned sessions; read-only for foreign sessions. |
| **Search/Browse** | ✅ Full | Canonical object query projection over VaultIndex. |
| **Universal Detail** | ✅ Full | Dirty-tracked form submission without full object re-serialization. |
| **Quick Add** | ✅ Full | Creates supported entities directly into canonical paths. |
| **Shared Settings** | ✅ Full | Re-indexes object identification dynamically on change. |

## Contract Exclusions

The following are explicitly **NOT** supported in V1:
1. Cross-client Pomodoro lease takeover (sessions started elsewhere remain read-only).
2. Background auto-run for Systems/Routines.
3. Second OAuth flow (Calendar uses the same Drive `GoogleOAuthDesktop` credential).
4. Modification of Finance (Data) spreadsheets (remains outside Companion vault pairing).
