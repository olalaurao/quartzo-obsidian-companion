# QUARTZO OBSIDIAN COMPANION — PRODUCT, VAULT, SYNC & RUNTIME CONTRACT

**Status:** Proposed canonical contract — implementation must not begin before P0 prerequisites in this document are resolved  
**Version:** 0.1  
**Date:** 2026-08-31  
**Suggested repository path:** `docs/integrations/obsidian_companion/QUARTZO_OBSIDIAN_COMPANION_CONTRACT.md`

---

# 1. Purpose

Quartzo Obsidian Companion is an Obsidian desktop plugin that acts as a second client for the same Quartzo vault.

Its primary use case is:

> Use the core Quartzo experience on a computer where the Quartzo application cannot be installed, while only requiring Obsidian plus an Obsidian community plugin installed through BRAT.

The Companion must provide:

- a Quartzo-style visual interface inside Obsidian;
- access to the user's existing Quartzo objects;
- Planner/Timeline/Day Dial views derived from the same rules as Quartzo;
- creation and safe mutation of supported Quartzo objects;
- Google Drive synchronization without Obsidian Sync;
- Google Calendar projection when authorized;
- scheduler occurrence calculation;
- reminder interaction while Obsidian is running;
- conflict detection and resolution;
- offline operation;
- zero dependency on the Quartzo executable being installed on the computer.

The architecture is:

```text
Quartzo mobile / personal computer
               ↕
         Google Drive
               ↕
Obsidian + Quartzo Companion
        on work computer
```

The Companion is **not** a remote control for a running Quartzo installation.

It is a real Quartzo client sharing the same canonical data.

---

# 2. Product Principles

## 2.1 One vault, multiple clients

The Markdown vault remains the source of truth.

```text
              Quartzo Flutter
                    │
                    ▼
               Quartzo Vault
                    ▲
                    │
           Obsidian Companion
```

The plugin must never introduce an independent object database.

Local indexes, caches, sync metadata and UI state are projections only.

If all plugin-local caches disappear, the usable Quartzo state must be reconstructible from:

1. the vault;
2. canonical shared state files;
3. remote Google data where applicable.

---

## 2.2 No duplicated business logic without a contract

Flutter and TypeScript obviously cannot share Dart source code directly.

Therefore, shared behavior must be defined through **language-neutral contracts and golden fixtures**.

The implementation architecture must be:

```text
             CANONICAL CONTRACT
                   │
        ┌──────────┴──────────┐
        ▼                     ▼
     Dart engine         TypeScript engine
        │                     │
        ▼                     ▼
 Quartzo Flutter       Obsidian Companion
```

The TypeScript implementation must not infer rules from screenshots or independently reinterpret how Quartzo works.

---

## 2.3 Fail closed, never guess

When the plugin encounters:

- an unsupported schema version;
- malformed scheduler data;
- ambiguous Drive identity;
- an unknown object type;
- an unknown enum value;
- an unsafe concurrent edit;
- an unresolved sync conflict;

it must preserve the original data and enter a safe/read-only or conflict state.

It must never "fix" persisted user data by guessing.

---

## 2.4 Offline first

Normal local edits must:

1. update the local vault immediately;
2. update the UI immediately;
3. enqueue reconciliation with Drive;
4. never block the user on a cloud spinner.

Network availability must not be required for ordinary vault use.

---

# 3. Scope

## 3.1 V1 platform

V1 is **Obsidian Desktop only**:

- Windows;
- macOS;
- Linux.

`manifest.json` should initially declare the plugin desktop-only.

This is intentional.

The immediate product requirement is the work-computer use case, and desktop-only V1 allows:

- Google desktop OAuth loopback flow;
- desktop notification APIs;
- predictable Electron/Node capabilities;
- reduced mobile filesystem complexity;
- reduced testing surface.

Obsidian Mobile support is deferred until a separate mobile compatibility pass.

Nothing in the canonical vault format may prevent mobile support later.

---

## 3.2 No external executable

The Companion must not require:

- Quartzo desktop application;
- Google Drive Desktop;
- a CLI;
- a background daemon;
- a localhost service installed separately;
- Node installed by the user;
- Python;
- Docker.

Everything required at runtime ships within or is already provided by Obsidian.

---

# 4. Installation and Release Contract

Initial distribution is through BRAT.

Suggested repository:

`olalaurao/quartzo-obsidian-companion`

Every distributable release must contain:

```text
manifest.json
main.js
styles.css   # when required
```

Release version, release tag and plugin manifest version must match.

Example:

```text
0.1.0-beta.1
```

CI must build the exact release artifact that BRAT installs.

No locally-built `main.js` should be manually uploaded without CI validation.

Required release gates:

```text
npm ci
typecheck
lint
unit tests
contract tests
sync protocol tests
build
release asset validation
```

---

# 5. Plugin Navigation Model

The Companion should **not reproduce every Quartzo Flutter screen as a separate Obsidian page**.

That would create excessive duplicated UI and maintenance.

Instead, V1 uses one primary `Quartzo` workspace view with internal navigation.

## 5.1 Entry points

The plugin provides:

**Ribbon action**

`Open Quartzo`

**Command Palette**

```text
Quartzo: Open
Quartzo: Open Today
Quartzo: Open Planner
Quartzo: Quick Add
Quartzo: Search
Quartzo: Sync now
Quartzo: View sync status
```

Optional hotkeys may be assigned by the user through Obsidian.

---

# 6. Main Quartzo Shell

The central view contains:

```text
┌────────────────────────────────────────────────────┐
│ QUARTZO          Search     + Add      ☁ Synced    │
├──────────┬─────────────────────────────────────────┤
│ Home     │                                         │
│ Planner  │                                         │
│ Journal  │           CURRENT VIEW                  │
│ Browse   │                                         │
│          │                                         │
│          │                                         │
└──────────┴─────────────────────────────────────────┘
```

Primary navigation intentionally remains small:

1. **Home**
2. **Planner**
3. **Journal**
4. **Browse**

Search, Add, Sync and Settings are actions rather than permanent navigation destinations.

This avoids recreating the full application's navigation complexity inside Obsidian.

---

# 7. Screen Contract

# 7.1 Connection / First Run

Shown when the current vault has not been paired.

Sections:

### Quartzo Companion

Explanation:

> Use this Obsidian vault as a Quartzo client and synchronize it with your existing Quartzo vault in Google Drive.

Actions:

- `Connect Google Drive`
- `Use without sync`

After Google authorization:

### Select Quartzo Vault

The plugin lists candidate Drive folders.

The user explicitly selects the existing Quartzo vault.

The plugin must store and use the **Drive folder ID**, never the folder name as permanent identity.

The Companion must **not silently create a second Quartzo vault**.

If no valid remote vault exists:

> No existing Quartzo vault was found.

Available actions:

- Retry
- Cancel setup

Creation of a new canonical Quartzo vault remains a Quartzo app responsibility in V1.

---

# 7.2 Home / Today

Home is the primary workday surface.

It must be derived from the same canonical daily schedule contract used by Quartzo.

Recommended layout:

```text
MONDAY · AUG 31

┌─────────────────────────────────┐
│             DAY DIAL            │
│                                 │
│              ◯                  │
│                                 │
└─────────────────────────────────┘

NOW
14:30  Work block
       43 min remaining

UP NEXT
15:30  ○ Finish report
16:00  ◇ Eat
17:00  ○ Review proposal

TODAY
Tasks       4 / 7
Habits      3 / 5

OVERDUE
○ Send invoice                 Reschedule

QUICK ACTIONS
+ Task    + Entry    + Note    + Record
```

Home may contain configuration/filter controls, but all data must still originate from the canonical daily snapshot.

Home must never independently calculate:

- recurrence;
- overdue;
- Habit occurrence;
- reminder occurrence;
- rotation occurrence;
- archive filtering.

---

# 7.3 Planner

Planner must expose:

### Day

Two lenses:

- `Timeline`
- `Adaptive`

The selected lens is a projection of the same canonical day snapshot.

### Week

Time-grid style weekly view.

### Month

Calendar overview with daily indicators and counts.

Navigation:

```text
‹    Today    ›
Day | Week | Month
```

Changing dates is purely a view operation.

Viewing another date must never mutate scheduler state.

---

## Planner day item contract

Every rendered item preserves:

```text
occurrenceId
sourceId
sourceType
date
start
end
slotIndex
reminderId
isCompletable
isCompleted
isPlayable
origin
sourceLabel
restrictionMetadata
```

Actions shown depend on canonical capabilities, not on the visual surface.

Typical actions include:

```text
Open
Done
Undo
Already did
Skip
Snooze
Reschedule
Start
```

A Planner-specific mutation path is forbidden.

---

# 7.4 Day Dial

The Day Dial appears:

- prominently on Home;
- optionally as a dedicated enlarged view.

It must consume the same normalized daily data as Planner.

A Day Dial item must never exist because the plugin ran independent date logic.

Color resolution:

```text
explicit object color
→ TypeSignature.colorHex
→ theme fallback
```

Organizer legacy color is not a day-surface color source.

---

# 7.5 Journal

Journal combines:

- daily navigation;
- Daily Note;
- Journal Entries;
- timeline items;
- mood entries when available;
- tracking records;
- relevant overdue projection for today.

The Companion must preserve the distinction between:

- when an Entry was created;
- when an Entry happened.

Editing Markdown directly through Obsidian remains possible.

Changes made in raw Markdown must be detected and reflected in Quartzo views.

---

# 7.6 Browse

Instead of creating 15+ top-level screens, `Browse` is the universal object browser.

Categories/filters may include:

```text
Tasks
Habits
Notes
Ideas
Goals
Projects
Areas
Systems
Routines
Trackers
Reminders
Resources
People
Values
Pillars
Social Posts
Templates
```

The list is driven by the canonical object registry.

Adding a new object type to Quartzo should normally require:

- parser support;
- object registry metadata;
- capability mapping;

not another independent navigation architecture.

---

# 7.7 Universal Object Detail

Selecting a Quartzo item opens its detail view.

Default behavior:

- open in the main Quartzo pane;
- optionally allow `Open in split pane`.

The detail view contains:

```text
Title
Type
Primary properties
Relationships
Schedule
Reminders
Body/content
Timeline/history
Type-specific actions
```

Where an object type does not yet have a safe Companion editor:

> Open Markdown

is preferred over implementing an incomplete editor that may lose fields.

---

# 7.8 Search / Command Center

Search is available from the Quartzo header and Command Palette.

It searches the same normalized object universe used by Quartzo.

Search results must preserve:

```text
object identity
object type
title
path
organizers
relevant metadata
```

There must not be separate search implementations for:

- linking;
- Quick Add;
- Quartzo Search;
- object selection.

One Companion search service owns these queries.

---

# 7.9 Quick Add

Quick Add is a modal inside Obsidian.

V1 high-confidence creation types:

```text
Task
Journal Entry
Note
Reminder
Record
```

Additional types may be exposed only after their complete save→parse contract passes cross-client tests.

Incomplete simplified forms are forbidden.

If the Companion cannot faithfully create a type yet, it should not pretend to support creation of that type.

---

# 7.10 Sync Center

Accessible through the cloud status indicator.

States:

```text
Synced
Local changes
Syncing
Offline
Authentication required
Conflict
Error
```

Information shown:

```text
Last successful sync
Pending local changes
Current Google Drive vault
Google account status
Conflicts
Last error
```

Actions:

```text
Sync now
View conflicts
Reconnect Google
Disconnect this device
Run full reconciliation
```

---

# 7.11 Conflict Resolution

Every conflict shows:

```text
Relative path
Local modified time
Drive modified time
Local content
Drive content
Diff when supported
```

Explicit actions:

```text
Keep local
Keep Drive
Keep newest
```

`Keep newest` is always a user-selected conflict action.

Clock time must never silently determine the winner during ordinary sync.

After resolution:

```text
localHash  = resolvedHash
remoteHash = resolvedHash
baseHash   = resolvedHash
```

and the conflict record is cleared.

---

# 7.12 Settings

Obsidian Settings → Quartzo Companion.

Groups:

### Connection

- Google status
- Drive vault
- Reconnect
- Disconnect

### Sync

- Auto sync
- Remote polling interval
- Sync on Obsidian startup
- Sync on window focus
- Manual full reconciliation

### Calendar

- Google Calendar integration
- Read-only status

### Notifications

- Off
- In-Obsidian only
- Desktop notifications

### Appearance

Only Companion-local presentation differences.

Canonical colors/type identification come from shared Quartzo settings.

### Privacy

Potential work-computer options:

- Hide sensitive previews
- Hide journal preview text
- Hide notification body

These are local presentation settings and never alter shared vault data.

---

# 8. Canonical Vault Contract

The Companion must use the same persisted object format as Quartzo.

For every supported object:

```text
Markdown file
+
YAML frontmatter
+
Markdown body
```

The plugin must not introduce:

```text
*.quartzo
SQLite object storage
JSON copies of Tasks
shadow databases containing canonical object state
```

Local indexing is allowed only as a derived cache.

---

## 8.1 Unknown fields must survive

If a Task contains a field the current plugin version does not understand, editing the Task must not remove that field.

Rule:

> Read-modify-write must change only fields owned by the performed operation.

Never regenerate an entire object from a partial TypeScript interface unless full roundtrip parity has been proven.

---

## 8.2 Safe Obsidian writes

Existing files must be modified using Obsidian vault operations that protect against read/write races.

A write must verify current content at mutation time.

The implementation should favor atomic `Vault.process()`-style mutation semantics.

---

## 8.3 Paths

Object Identification remains authoritative.

The Companion must never assume:

```text
Tasks always live in tasks/
Notes always live in notes/
```

unless the canonical Object Identification contract for that vault says so.

Hardcoded folder classification is prohibited.

---

# 9. Shared Client Settings Contract — P0

This is required before visual parity can be trusted.

Currently, several settings needed by the Companion are Flutter-local settings rather than vault data.

Examples include:

```text
TypeSignatures
folder paths
category colors
accent color
Planner visible kinds
Planner color mode
start of week
day start hour
Day Dial legend preference
```

A second client cannot safely guess these.

Therefore, Quartzo must introduce one canonical **shared client settings document**.

Suggested canonical path:

```text
app/quartzo_shared_settings.md
```

The exact path may change during implementation, but there must be exactly one canonical source.

Example structure:

```yaml
---
type: quartzo_shared_settings
schema_version: 1

type_signatures: ...
folder_paths: ...

accent_color: "#F97316"
category_colors: ...

planner:
  color_mode: category
  visible_kinds: [...]
  show_adaptive_time_blocks: true

calendar:
  start_of_week: 1

day:
  start_hour: 0

day_dial:
  show_legend: true
---
```

Flutter `SharedPreferences` may cache these values but must no longer be their independent source of truth.

---

## 9.1 Settings that must remain device-local

Never sync:

```text
OAuth tokens
refresh tokens
vault filesystem path
Drive polling token
sync queue
baseHash database
clientInstanceId
notification OS registry
window layout
work-PC privacy mode
local notification permission
local notification delivery preference
```

API keys/secrets must not be moved into the shared settings document.

---

# 10. Object Identification Contract

The Companion must consume the same `TypeSignature` definitions as Quartzo.

Object detection must have one contract covering:

```text
marker type
marker value
iconName
colorHex
priority
folder/property/tag identification
```

When an object matches conflicting signatures:

- canonical priority determines the interpreted type;
- conflict state remains visible for cleanup.

The Companion must not invent its own priority order.

---

# 11. Icon Contract

`TypeSignature.iconName` remains the canonical semantic icon identifier.

The Obsidian plugin does not need to use Flutter Material `IconData`.

Instead:

```text
Material semantic iconName
          ↓
Companion Icon Adapter
          ↓
Obsidian/Lucide icon
```

Example:

```text
task     → check-square
habit    → repeat
system   → settings
routine  → refresh-cw
```

If no mapping exists:

- use the canonical generic type fallback;
- never alter the persisted icon;
- never treat the plugin-specific icon name as canonical data.

---

# 12. Canonical Daily Schedule Contract

Every Companion surface answering:

> What belongs on this date?

must use a single TypeScript equivalent of the Quartzo daily schedule contract.

The normalized kinds currently include:

```text
task
habit
event
googleCalendar
reminder
pomodoro
trackerRecord
journalEntry
timeBlock
system
routine
rotationZone
personContact
goal
```

The TypeScript result must be validated against the same golden fixtures as Dart.

---

## 12.1 Global exclusions

Before UI filters:

```text
archived == true       → exclude
path under _deleted/   → exclude
```

Negative Habits follow the canonical Quartzo rule and are not injected into normal daily completion surfaces.

---

## 12.2 Reminder boundary rule

A Reminder scheduled on date `D` belongs to `D`.

An incomplete reminder from `D` must not become a normal occurrence on:

```text
D+1
D+2
D+3
...
```

Overdue is a separate **today projection**.

---

## 12.3 Habit slot identity

Multiple Habit slots on the same day are separate occurrences.

Example:

```text
Eat · 09:00
Eat · 12:00
Eat · 15:00
```

must remain three independently actionable occurrences.

They must never collapse into one generic `Eat` row.

---

# 13. Scheduler Contract

The Companion scheduler engine must implement the same persisted Scheduler model.

Current canonical repeat types:

```text
number_of_days
days_of_week
number_of_weeks
number_of_months
number_of_minutes
number_of_hours
days_after_last_start
days_after_last_end
days_per_period
linked_item_appears
n_days_after_linked_item
first_business_day_of_month
days_after_reference_field
days_of_theme
days_with_block
```

There are currently **15**, not 11.

Scheduler fields include:

```text
rules
exclusions
start_date
end_date
max_occurrences
overdue_policy
time_block
exact_time
item_type
anchor_mode
active_window
```

`next_instance_date` is legacy cache data.

It must never be treated as authoritative.

The next occurrence is derived.

---

## 13.1 Scheduler evaluation context

Contextual rules may depend on:

```text
last completion
last start
last end
occurrence count
linked item occurrence
active Day Theme
active Time Block
reference field date
```

The plugin scheduler must receive these through an explicit evaluation context.

Views may calculate occurrences.

Views must not mutate the source object merely because the user viewed a date.

---

# 14. Scheduler Is Not an Automation Executor

Three concepts must remain distinct:

```text
Scheduler
   ↓
"an occurrence exists"

Daily Schedule
   ↓
"show the occurrence"

Automation Executor
   ↓
"perform a mutation/action"
```

This distinction is mandatory.

A System becoming due at 09:00 does not automatically mean every connected client may independently execute its actions.

---

# 15. Scheduled Systems and Routines

Systems may have:

```text
scheduler
scheduledTime
steps
executionHistory
```

The Companion may:

- calculate when the System belongs in Planner;
- render it;
- open it;
- allow the user to manually run it.

## V1 distributed automation restriction

The Companion must **not automatically execute mutating scheduled Systems/Routines in the background**.

Reason:

```text
Phone sees occurrence
+
Work Companion sees occurrence
=
potential duplicate execution
```

Automatic multi-client execution requires a separate canonical distributed execution/claim protocol.

Until that protocol exists:

```text
scheduled occurrence → visible
manual Run           → allowed
background auto-run  → Quartzo app only / unsupported
```

No client should pretend otherwise.

---

# 16. Automation Action Compatibility

When manually executing an action from the Companion, each action type must declare capability:

```text
supported
unsupported
requires Quartzo app
```

The Companion must never partially execute a System if doing so would violate its semantics.

Examples requiring explicit compatibility review:

```text
add_entry
create_task
create_note
update_kpi
send_notification
open_url
custom_script
```

`custom_script` must be disabled in the Companion unless a future security specification explicitly allows it.

---

# 17. Occurrence Action Contract

Quartzo already distinguishes actions by occurrence identity.

The Companion must preserve:

```text
occurrenceId
sourceId
sourceType
reminderId
slotIndex
dueAt
```

Supported canonical responses:

```text
Done now
Already did
Skip
Clear outcome
Snooze
Dismiss delivery
```

Every mutation has an `actionId`.

Processed action IDs are idempotent.

Example:

```text
client:work-pc:6bfa...:done
```

If the same action arrives twice:

```text
first application → mutate
second application → idempotent no-op
```

This rule applies across clients.

---

# 18. Time Architecture Shared-State Refactor — P0

Current Quartzo persists multiple kinds of time state together.

For multi-client use, **user state and device delivery state must not share the same synchronization identity**.

Shared cross-client state includes concepts such as:

```text
occurrence responses
occurrence overrides
time block execution state
focus records
sleep sessions
availability
daily planning state
execution checkpoints
active quiet window
```

Device-local state includes:

```text
scheduled OS notification IDs
notification registry
local delivery reconciliation
desktop notification permission
suppression bookkeeping specific to that client
```

These must be separated before the Companion relies on the file.

A mobile notification ID has no meaning on the work computer.

The work computer must never overwrite the phone's notification registry.

---

## 18.1 High-churn state

The implementation audit must also determine whether the current monolithic time-state file is safe for frequent multi-client mutation.

If unrelated actions on different devices repeatedly modify the same sidecar, the state must be sharded into canonical merge-safe domains before production release.

This migration must:

1. define the new canonical files;
2. migrate existing data once;
3. stop writing the old representation;
4. provide backward-compatible reading during the migration window;
5. never maintain two active sources of truth.

---

# 19. Reminder Data Contract

`ReminderConfig` remains the universal embedded reminder schema.

Fields include:

```text
id
trigger_time
minutes_before
days_before
time_of_day

type:
  push
  popup
  alarm

notification_body
sound
ring_on_silent
snooze_minutes
popup_color
play_sound
vibrate

is_auto_generated
ignored_count
escalation_level
last_ignored_occurrence_key
```

The Companion must preserve fields even when a desktop platform cannot honor all of them.

---

# 20. Reminder Escalation

Canonical escalation state remains data.

Current behavior:

```text
ignored < 2
→ level 0

ignored >= 2
→ level 1

ignored >= 5
→ level 2
```

Effective mobile delivery may escalate:

```text
push → popup → alarm
```

The desktop Companion must preserve escalation state even when its available delivery mechanism is less intrusive.

---

# 21. Reminder Delivery vs Reminder State

This is a critical cross-client distinction.

## Shared

```text
Reminder definition
Occurrence
Done
Already did
Skip
Snooze-until
Dismiss response
Ignored/escalation state
```

## Device-local

```text
whether this device displays notifications
native notification identifier
permission state
delivery channel
sound availability
desktop notification capability
```

---

# 22. Desktop Reminder Capability Matrix

| Capability | Quartzo Mobile | Obsidian Companion |
|---|---|---|
| Calculate occurrence | Yes | Yes |
| Show in Planner | Yes | Yes |
| Done / Skip / Snooze | Yes | Yes |
| Push while app running | Yes | Yes |
| Desktop/system notification while Obsidian running | N/A | Optional |
| Alarm/full-screen semantics | Yes | Best-effort only |
| Ring on silent semantics | Yes | Platform dependent |
| Guaranteed reminder while application is closed | Yes, where OS scheduling allows | **No** |
| Background scheduling without Obsidian | App/platform service | **No** |

Therefore:

> The Companion is not the user's guaranteed reminder daemon.

The phone Quartzo installation remains the reliable reminder delivery client.

---

## 22.1 Work-PC default

Default setting:

```text
Reminder delivery:
In Obsidian only
```

This avoids every Reminder generating:

```text
phone notification
+
work desktop notification
```

The user may opt into desktop notifications.

---

# 23. Snooze Contract

Snooze is not merely local UI delay.

A canonical Snooze action writes:

```text
occurrenceId
snoozedUntil
actionId
```

Other clients must be able to observe that response after synchronization.

The OS/Desktop notification registry remains local.

---

# 24. Focus / Pomodoro

The Companion must not resurrect the deprecated independent floating Pomodoro overlay architecture.

Inside Obsidian, active focus is represented through:

- Home;
- Planner;
- Quick Add/header;
- optional compact timer pane.

Timer truth must be timestamp/state-based, never a JavaScript interval counter.

```text
startAt
plannedDuration
currentStep
pause/resume state
```

UI timers recalculate elapsed time from timestamps.

Closing and reopening the view must not reset the timer.

Cross-client timer takeover/handoff must be explicitly specified before allowing two devices to control one active session simultaneously.

---

# 25. Google OAuth Contract

The Companion uses a dedicated **Desktop OAuth Client** in the same Google Cloud project used by Quartzo where practical.

It must not contain a client secret.

Desktop installed applications cannot safely keep secrets.

Authorization flow:

```text
1. Generate random state
2. Generate PKCE code_verifier
3. Generate S256 code_challenge
4. Start loopback listener on random 127.0.0.1 port
5. Open Google authorization in system browser
6. Receive authorization code
7. Verify state
8. Exchange code using code_verifier
9. Persist refresh credential securely
10. Keep short-lived access token in memory
```

Redirect:

```text
http://127.0.0.1:<random-port>
```

No deprecated copy/paste/OOB OAuth flow.

If corporate policy blocks the loopback callback:

- show a clear authentication error;
- preserve all local data;
- do not fall back to an insecure custom flow.

---

# 26. OAuth Secret Storage

Refresh credentials must use Obsidian SecretStorage or the current secure equivalent supported by the minimum Obsidian version.

Never store tokens in:

```text
data.json
Markdown
frontmatter
Google Drive
GitHub
logs
sync metadata
```

Plugin-local non-secret settings may contain:

```text
Drive root folder ID
scope set
change page token
client instance ID
last successful sync
```

---

# 27. Drive Scope Decision

V1 prioritizes deterministic compatibility with the existing Quartzo vault.

The current Quartzo client already uses broad Drive authorization.

For the initial private Companion implementation, use the Drive scope required to reliably locate and synchronize the pre-existing Quartzo vault.

Before public/community distribution, explicitly review migration toward:

```text
drive.file + user-selected file/folder authorization
```

if full descendant access can be proven reliable for the Quartzo synchronization model.

Never reduce scope by assumption.

---

# 28. Google Calendar OAuth

Calendar authorization is optional.

V1 Calendar integration is **read-only**.

The Companion may:

- read calendar events;
- inject them into the canonical daily schedule snapshot;
- open relevant Google Calendar URLs.

It does not create/edit/delete Google Calendar events in V1.

If Calendar was not authorized during the first OAuth flow, enabling it later may require a reconnect/consent flow.

---

# 29. Google Calendar Data Contract

Google Calendar events remain external projections.

They are not converted into Quartzo Markdown objects merely because they appear in Planner.

Canonical daily item kind:

```text
googleCalendar
```

The same date/time conversion rules used by Quartzo must be covered by cross-client fixtures.

---

# 30. Sync Protocol

The Companion and Quartzo must implement the same language-neutral:

# Quartzo Sync Protocol v1

Remote:

```text
Google Drive
```

Remote vault identity:

```text
Drive folder ID
```

File identity:

```text
relative path
+
remote file ID where known
```

Content hash:

```text
SHA-256(raw bytes)
```

For UTF-8 Markdown, this is SHA-256 of the UTF-8 file bytes.

Remote metadata:

```text
Quartzo_hash
```

---

# 31. Local Sync State

Every client has its own local sync-state database.

Minimum per-file state:

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

This data is **never synchronized between devices**.

The local database is not user content.

---

# 32. Sync Reconciliation Matrix

Let:

```text
B = baseHash
L = local hash
R = remote hash
```

## Identical

```text
L == R
```

Result:

```text
no conflict
baseHash = L
```

---

## Local unchanged, remote changed

```text
L == B
R != B
```

Result:

```text
pull remote
baseHash = R
```

---

## Local changed, remote unchanged

```text
L != B
R == B
```

Result:

```text
push local
baseHash = L
```

---

## Both changed to same content

```text
L != B
R != B
L == R
```

Result:

```text
no conflict
baseHash = L
```

---

## Both independently changed

```text
L != B
R != B
L != R
```

Result:

```text
CONFLICT
```

Neither side is overwritten.

---

# 33. Unknown Base State

`baseHash == null` is not permission to overwrite.

During first pairing:

### Remote exists, local does not

Download remote.

### Local exists, remote does not

Do not automatically publish an unknown local vault into the selected remote Quartzo vault.

Classify as:

```text
Unpaired local file
```

and require adoption/reconciliation.

### Both exist and content is identical

Establish baseline.

### Both exist and differ

Conflict.

This closes the dangerous "fresh client" overwrite case.

---

# 34. Local Change Pipeline

When Obsidian reports a relevant local file change:

```text
Vault event
↓
debounce
↓
calculate current hash
↓
compare with local sync state
↓
queue reconciliation
↓
push/reconcile with Drive
```

Recommended local debounce:

```text
~1–2 seconds
```

Rapid editor saves should collapse into one network operation.

---

# 35. Remote Change Pipeline

After the initial full inventory, use Google Drive change tracking.

```text
changes.getStartPageToken
↓
persist token locally
↓
periodic changes.list
↓
filter relevant vault descendants
↓
reconcile changed files
↓
persist new token
```

Recommended default while Obsidian is open:

```text
60 seconds
```

Also reconcile:

- on startup;
- when the Obsidian window regains focus;
- on manual `Sync now`.

No remote webhook/server is required.

---

# 36. Sync Mutex

Exactly one Companion sync operation may run at a time.

Triggers that occur during an active sync are coalesced into another pass.

Never run:

```text
startup sync
+
timer sync
+
manual sync
+
local watcher sync
```

concurrently.

---

# 37. Network Retry

Retryable:

```text
429
5xx
temporary connectivity errors
```

Use exponential backoff with jitter.

Authentication errors:

```text
401
credential-related 403
```

trigger one safe refresh attempt.

Persistent authorization failure becomes:

```text
Authentication required
```

and must never cause local deletion or overwrite.

---

# 38. Sync File Scope — P0 Compatibility Change

The synchronization protocol must not be Markdown-only.

A real Obsidian/Quartzo vault requires:

```text
.md
.base
attachments
images
audio
other canonical vault assets
```

V1 protocol rule:

> Sync every canonical vault file unless it matches an explicit local/system exclusion.

Examples of excluded paths:

```text
.obsidian/
.git/
.trash/
_conflicts/
_backups/
temporary editor files
plugin-local sync state
```

`_attachments/` is **included**.

`.base` files are **included**.

This requires updating the Flutter sync implementation before Companion production release so both clients synchronize the same file universe.

---

# 39. Binary Files

Binary files are synchronized as bytes.

Hash:

```text
SHA-256(bytes)
```

Do not:

- decode as UTF-8;
- normalize line endings;
- parse;
- regenerate.

Conflict resolution for binary data uses file-level choices.

---

# 40. Obsidian Bases

Collection/Bases integration requires both:

```text
collection row Markdown files
+
.base definition file
```

to reach every client.

A Collection appearing functional on one device while its `.base` file is absent on another is a sync regression.

---

# 41. Deletion Semantics

Deleting a canonical vault item is never equivalent to silently losing it.

The protocol must preserve Quartzo's soft-delete/trash behavior.

Live views exclude `_deleted/`.

When a previously synchronized remote file disappears from its active path:

### Local unchanged

Propagate deletion/removal locally.

### Local changed since baseline

Conflict:

```text
local edit
vs
remote deletion
```

Never resurrect or delete automatically.

---

# 42. Conflict Artifacts

Conflict artifacts are support/recovery data.

They must not appear as normal objects.

Conflict metadata should include:

```text
relativePath
detectedAt
localModifiedAt
remoteModifiedAt
local hash
remote hash
```

The active conflict pipeline is single and explicit.

No hidden independent auto-merge path.

---

# 43. Remote Identity

Drive folder/file identity must fail closed.

If the protocol sees two remote candidates representing the same expected relative path:

```text
do not choose one
do not use newest
do not overwrite
```

State:

```text
Ambiguous remote identity
```

requires user intervention.

---

# 44. First-Pairing Safety

The work computer must use a dedicated Quartzo Obsidian vault.

Before enabling destructive synchronization:

1. authorize Google;
2. select existing Quartzo Drive folder;
3. validate remote vault marker/content;
4. scan local vault;
5. display pairing summary;
6. establish baselines;
7. only then enable normal auto-sync.

Example summary:

```text
Remote Quartzo files       1,284
Local Quartzo files            0
Will download              1,284
Conflicts                      0

[ Pair vault ]
```

If local canonical files already exist, show them explicitly.

---

# 45. Watcher Loop Prevention

Remote pull:

```text
Drive
→ plugin writes Obsidian file
→ Obsidian emits modify event
```

must not immediately produce a redundant push.

The sync layer suppresses/reconciles this using:

- expected post-write hash;
- current sync transaction identity;
- baseline update.

Do not suppress events based only on a timing delay.

---

# 46. Local Plugin Storage

Plugin-local storage owns only client state such as:

```text
clientInstanceId
driveRootId
changePageToken
sync state
sync queue
local UI preferences
notification preference
```

Use a scalable local store behind an abstraction.

Large per-file sync maps should not be treated as user-facing plugin settings.

---

# 47. Cross-Client Contract Fixtures

A new repository-level language-neutral contract suite is required.

Suggested:

```text
contracts/
└── quartzo/
    ├── README.md
    ├── object_fixtures/
    ├── scheduler/
    ├── daily_schedule/
    ├── occurrence_actions/
    ├── sync/
    └── migrations/
```

Both implementations must consume these fixtures.

---

# 48. Object Golden Tests

For every supported object type:

```text
fixture.md
↓
Dart parse
TypeScript parse
↓
equivalent canonical representation
↓
save
↓
reparse
↓
no data loss
```

Unknown properties must survive an unrelated edit.

---

# 49. Scheduler Golden Tests

Every one of the 15 recurrence types requires shared test vectors.

Required edge cases:

```text
DST transitions
month end
February
leap year
cross-midnight active window
start date
end date
exclusions
max occurrences
completion-anchored recurrence
multiple intraday occurrences
linked-item rules
Day Theme
Time Block
reference fields
```

Dart and TypeScript must return the same occurrence timestamps.

---

# 50. Daily Schedule Golden Tests

At minimum:

- Reminder before/on/after scheduled date;
- timed Reminder before/after current time;
- overdue only on today's overdue projection;
- multiple Habit slots remain distinct;
- all-day Habit fallback;
- negative Habit exclusion;
- archived exclusion;
- `_deleted` exclusion;
- rotation-zone occurrence;
- System occurrence;
- Routine occurrence;
- Planner and Day Dial receive equivalent source identity;
- Google Calendar timezone conversion.

---

# 51. Occurrence Action Tests

Cross-client fixtures must verify:

```text
Done now
Already did
Skip
Undo/Clear
Snooze
Dismiss
```

including:

- stable occurrence identity;
- stable reminder identity;
- Habit slot identity;
- processedActionIds union/idempotence;
- action replay.

---

# 52. Sync Protocol Tests

Mandatory scenarios:

```text
L == R
local-only change
remote-only change
both same change
true conflict
baseHash null
missing Quartzo_hash
remote deletion
local deletion
local edit vs remote deletion
duplicate remote identity
offline queue
retry after 429
401 refresh
remote pull during local edit
watcher loop
UTF-8 Markdown
.base file
binary attachment
large file
path rename/move
```

---

# 53. OAuth Tests

At minimum:

- PKCE verifier/challenge;
- state mismatch rejection;
- loopback callback validation;
- token exchange;
- refresh;
- expired token;
- revoked credential;
- denied consent;
- missing scope;
- corporate/admin policy rejection;
- secrets absent from logs and plugin JSON.

---

# 54. Rendering Consistency Tests

Use fixture vaults to validate that:

```text
Home
Planner
Day Dial
```

show the same occurrence set under equivalent filters.

This is a release gate, not an optional visual test.

---

# 55. Performance Requirements

The plugin must not rescan and parse the entire vault on every render.

Architecture:

```text
initial index
+
Vault events
+
incremental index updates
```

Views consume normalized indexes.

Large object bodies may be lazily loaded when opening detail.

The Planner must not synchronously parse thousands of Markdown files during each date change.

---

# 56. Plugin Lifecycle

All:

```text
Vault subscriptions
workspace subscriptions
intervals
timers
listeners
```

must be registered through lifecycle-managed plugin APIs and disposed on unload.

Disabling/reloading the plugin must not leave:

- orphan timers;
- background polling;
- local HTTP OAuth listener;
- stale event listeners.

---

# 57. Security and Privacy

The Companion must have:

```text
no telemetry by default
no conversation/content analytics
no hidden upload endpoint
no token logging
no vault content in crash telemetry
```

Network access should be limited to explicitly documented integrations.

Core V1:

```text
Google OAuth
Google Drive API
Google Calendar API when enabled
GitHub only through BRAT update/install behavior
```

---

# 58. Schema Versioning

Cross-client contracts require explicit versions.

At minimum:

```text
vault schema version
shared settings schema version
time architecture schema version
sync protocol version
```

If the Companion opens a vault newer than its supported contract:

```text
Compatibility mode
```

Behavior:

- read safely where possible;
- disable unsafe mutations;
- explain that the Companion needs an update.

Never down-migrate data automatically.

---

# 59. Backward Compatibility

When a canonical schema changes:

1. write migration fixture;
2. implement Dart migration;
3. implement TypeScript migration or compatible reader;
4. run old→new roundtrip fixtures;
5. release clients in a compatible order.

No schema change may assume all clients update simultaneously.

---

# 60. V1 Mutation Support Policy

A feature may be:

```text
Full
Read-only
Unsupported
```

A `Full` designation requires:

- parser parity;
- serializer parity;
- mutation parity;
- scheduler integration where applicable;
- reminders integration where applicable;
- sync tests.

A screen may display read-only information earlier.

It may not expose a Save button before full contract coverage.

---

# 61. Recommended V1 Capability Matrix

| Feature | V1 |
|---|---|
| Home / Today | Full |
| Planner Day | Full |
| Planner Adaptive | Full projection/actions |
| Planner Week | Full projection |
| Planner Month | Full projection |
| Day Dial | Full projection |
| Journal | Full |
| Universal Search | Full |
| Browse | Full |
| Object Detail | Full/read-only by type |
| Quick Add Task | Full |
| Quick Add Entry | Full |
| Quick Add Note | Full |
| Quick Add Reminder | Full |
| Quick Add Record | Full after tracker contract tests |
| Task completion | Full |
| Habit occurrence completion | Full |
| Reminder Done/Skip/Snooze | Full |
| Reschedule | Full where canonical occurrence override supports it |
| Systems | View + manual Run |
| Scheduled System auto-execution | No |
| Routines | View + manual execution after parity tests |
| Google Drive Sync | Full |
| Google Calendar | Read-only |
| Desktop reminder delivery | While Obsidian runs |
| Reminder when Obsidian closed | No |
| Focus/Pomodoro | In-app after timer parity tests |
| Obsidian Mobile | Deferred |
| External scripts | No |

---

# 62. P0 Prerequisites Before Plugin Implementation

These are blocking architecture tasks.

## P0.1 Repository bootstrap

`/AGENT_BOOTSTRAP.md` must point developers to the current canonical rules in `/agents.md`, `guidelines.md` and active specs.

The repository must not reintroduce a root `/AGENTS.md` while `/agents.md` exists.

---

## P0.2 Update stale scheduler documentation

Any canonical developer documentation claiming 11 Scheduler repeat types must be updated to the current 15-type contract.

---

## P0.3 Introduce canonical shared client settings

Settings needed for cross-client visual/data interpretation must move from Flutter-only local preferences to a vault-backed shared source.

Flutter local settings become cache/projection where appropriate.

---

## P0.4 Separate shared time state from device-local notification state

Never synchronize OS notification registries between phone and work computer.

---

## P0.5 Audit/shard high-churn time state

Prevent unrelated actions on two clients from repeatedly causing whole-sidecar conflicts.

---

## P0.6 Expand canonical sync file scope

Flutter and Companion must both synchronize:

```text
Markdown
Bases
attachments/assets
```

under the same inclusion/exclusion rules.

---

## P0.7 Formalize Quartzo Sync Protocol v1

The current Dart behavior becomes an explicit language-neutral contract with fixtures.

---

## P0.8 Formalize canonical object fixtures

At least every object surfaced/mutated in the Companion needs save→parse cross-client fixtures.

---

## P0.9 Formalize DailySchedule fixtures

The TypeScript implementation must not be authored solely by translating Flutter UI code.

---

# 63. Required Canonical Documentation Updates

Once this proposal is approved and committed:

### `guidelines.md`

Add:

- Companion as an official Quartzo surface;
- same-source daily surface requirement across Flutter and Companion;
- desktop reminder delivery limitations;
- cross-client settings source;
- plugin UI behavior where it introduces product decisions.

### `agents.md`

Add:

- Companion architecture;
- TypeScript contract implementation rules;
- shared golden fixture requirement;
- sync protocol;
- Obsidian Vault API rules;
- no parallel business logic;
- BRAT/release gates.

### `/AGENT_BOOTSTRAP.md`

Bootstrap correctly.

### Sync specification

Create:

```text
docs/integrations/obsidian_companion/QUARTZO_SYNC_PROTOCOL_V1.md
```

### Vault/object specification

Create:

```text
docs/integrations/obsidian_companion/QUARTZO_VAULT_INTEROP_CONTRACT_V1.md
```

### UI specification

Create:

```text
docs/integrations/obsidian_companion/QUARTZO_COMPANION_UI_SPEC_V1.md
```

This document remains the parent architecture/product contract.

---

# 64. Implementation Order

Implementation must occur in this order:

```text
1. Documentation P0 fixes
2. Shared settings contract
3. Time-state separation
4. Sync protocol + fixtures
5. Flutter sync parity changes
6. Object/scheduler/daily golden fixtures
7. Companion repository skeleton
8. BRAT release pipeline
9. Obsidian local vault/index layer
10. OAuth
11. Initial pairing
12. Drive sync
13. Conflict UI
14. Object parser/model layer
15. Scheduler
16. Daily Schedule
17. Home
18. Planner
19. Day Dial
20. Journal
21. Browse/Search
22. Quick Add
23. Object detail/actions
24. Reminder interactions
25. Optional Calendar integration
26. Performance/security audit
27. Full cross-client test matrix
```

UI work must not precede the data contracts it depends on.

---

# 65. Release Acceptance Scenario

The following scenario is the minimum proof that V1 works:

### Personal device

1. Open Quartzo.
2. Create Task `Prepare campaign`.
3. Schedule it for tomorrow at 10:00.
4. Add Reminder at 09:45.
5. Close Quartzo after sync.

### Work computer

1. Install/update Companion through BRAT.
2. Open Obsidian.
3. Companion synchronizes.
4. Home shows the Task on the correct day.
5. Planner shows it at 10:00.
6. Day Dial represents the same occurrence.
7. Reminder appears at the correct time while Obsidian is running.
8. Click `Done`.

### Personal device again

1. Quartzo synchronizes.
2. Task is completed.
3. Planner agrees.
4. Day Dial agrees.
5. Reminder does not behave as an unhandled occurrence.
6. No duplicate object exists.
7. No sync conflict exists.
8. No frontmatter field was lost.

Then repeat in reverse:

```text
edit in Quartzo → observe in Companion
edit in Companion → observe in Quartzo
```

Then simultaneously edit the same object on both clients.

Expected result:

```text
explicit conflict
zero silent data loss
```

---

# 66. Definition of Done

Quartzo Obsidian Companion V1 is not complete because:

> "the plugin loads."

It is complete only when:

- it can be installed and updated through BRAT;
- no external helper application is required;
- Google OAuth can be completed safely;
- it pairs with an existing Quartzo Drive vault;
- it works offline after pairing;
- Drive sync safely handles concurrent clients;
- `.md`, `.base` and canonical attachments synchronize;
- all supported object mutations roundtrip;
- Home/Planner/Day Dial agree;
- all 15 Scheduler types pass shared fixtures;
- Reminder occurrences agree with Quartzo;
- occurrence actions are idempotent;
- device notification state is not synchronized;
- unsupported capabilities fail closed;
- conflicts never silently choose a winner;
- credentials never enter the vault;
- plugin disable/unload cleans all runtime resources;
- dark/light mode is usable;
- no Quartzo UI overflows;
- no unsupported object is corrupted;
- Dart and TypeScript contract test suites are green.

---

# 67. Final Architectural Rule

The Companion is not:

> "an Obsidian plugin that happens to understand Quartzo files."

It is:

> **another official Quartzo client, hosted inside Obsidian.**

Therefore every important behavior must answer:

> "What is the canonical Quartzo rule?"

before answering:

> "How should the Obsidian plugin implement it?"

When no canonical rule exists, define that rule first.

Never solve ambiguity by creating Companion-only behavior.
