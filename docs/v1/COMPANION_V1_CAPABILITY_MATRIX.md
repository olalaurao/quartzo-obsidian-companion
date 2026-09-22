# Companion V1 Capability Matrix

This matrix is status evidence for the V1 release candidate. Canonical behavior remains defined by the vendored Quartzo contracts, executable vectors, Companion architecture gates and the current implementation owners.

## Release Envelope

| Area | V1 status | Canonical owner | Contract/vector | Test/gate | Platform | V1 limitations |
| --- | --- | --- | --- | --- | --- | --- |
| Obsidian plugin shell | Full | `src/main.ts`, `src/ui/shell/view.ts` | `QUARTZO_COMPANION_UI_SPEC_V1.md` | `tests/contracts/ui_shell.test.ts`, `architecture:check` | Obsidian Desktop on Windows/macOS/Linux | Obsidian Mobile is out of scope. |
| Google OAuth | Full | `src/integrations/google/auth/loopback.ts`, `src/main.ts` | `QUARTZO_OBSIDIAN_COMPANION_CONTRACT.md` Google OAuth section | `tests/integrations/google-oauth-loopback.test.ts`, `release:validate`, `architecture:check` | Desktop browser loopback | Client ID + loopback PKCE only; no Client Secret; refresh token stays in Obsidian SecretStorage. |
| Google Drive sync | Full | `DriveSyncCoordinator`, `GoogleDriveAdapter`, `VaultSyncFilePolicy` | `QUARTZO_SYNC_PROTOCOL_V1.md`, `sync/vectors.json` | `test:sync`, `tests/contracts/sync.test.ts`, `architecture:check` | Windows/macOS/Linux | Manual mode is default; Automatic is opt-in; no silent newest-wins conflict resolution. |
| Pairing and Sync Center | Full | `DriveSyncCoordinator`, `src/ui/shell/view.ts` | Sync protocol plus C/B diagnostics tracker evidence | `tests/sync/runtime.test.ts`, `architecture:check` | Windows/macOS/Linux | Diagnostics are read-only projections over coordinator state, not a second sync queue. |
| Release pipeline | Full | GitHub Actions workflows, release validator/package scripts | Beta release runbook | CI Linux/Windows/macOS, `release:validate`, `smoke:clean-artifact`, `release:package` | GitHub Actions | Release artifacts must be rebuilt by CI; do not upload local `main.js`. |

## Object Model and Mutation Support

| Object/domain | V1 status | Canonical owner | Contract/vector | Test/gate | Platform | V1 limitations |
| --- | --- | --- | --- | --- | --- | --- |
| Task | Full | `ObjectParser`, `SafeObjectMutationRepository`, occurrence action owners | `object_fixtures/coverage.json`, priority mutation vectors | `tests/contracts/objects.test.ts`, `tests/contracts/mutations.test.ts` | Desktop | Full mutation only inside localized safe writer; protected identity fields are immutable. |
| Habit | Full | Same object/mutation owners plus occurrence action service | `object_fixtures/coverage.json`, occurrence action vectors | Contract and occurrence action tests | Desktop | Habit occurrence actions route through canonical occurrence owner. |
| Tracker definition and tracker record | Full | Object parser/mutation, Quick Add record creation | `coverage.json`, tracker vectors | `tests/contracts/tracking-record.test.ts`, UI shell Quick Add tests | Desktop | Quick Add creates records, not arbitrary tracker schema editors. |
| Entry | Full | Object parser/mutation, Quick Add | `coverage.json` | Object/mutation/UI shell tests | Desktop | Journal projection is separate from mutation support. |
| Note | Full | Object parser/mutation, Quick Add | `coverage.json` | Object/mutation/UI shell tests | Desktop | Generic rich-text editing is Markdown/body based. |
| Reminder object | Full | Object parser/mutation, reminder projection/service, occurrence action service | `coverage.json`, occurrence action vectors | Reminder, occurrence and sync regression tests | Desktop while Obsidian is open | Delivery is best effort/device-local; synced state is canonical, notification delivery registry is local. |
| Resource | Full | Resource capture policy, object parser/mutation, Quick Add | `resource_capture/vectors.json`, `coverage.json` | `tests/contracts/resource-capture-policy.test.ts`, `tests/contracts/resource-object.test.ts` | Desktop | External metadata lookup is not required for manual Resource creation. |
| Goal/Event/Pomodoro/System/Routine/Social Post/Mood/Idea/Inbox/Shopping List/Template/Analysis/Wellbeing/Area/Project/Activity/Label/Person/Day Theme/Time Block/Value/Pillar/Action/Monthly Focus/Quote | Read-only plus limited safe display/open Markdown | Object parser, VaultIndex, Detail/Browse/Search | `coverage.json` rows with `mutationSupport: limited` | Object fixture roundtrip tests, Detail architecture gate | Desktop | No generic editor unless coverage says parse + roundtrip + full mutation + concrete mutation fixture. |
| `daily_note` | Read-only/raw | Object parser raw projection, Journal | `coverage.json` raw_read_only row | `tests/contracts/objects.test.ts`, Journal projection tests | Desktop | No distinct DailyNote model parser/serializer in V1; open Markdown for edits. |

## Product Surfaces

| Feature | V1 status | Canonical owner | Contract/vector | Test/gate | Platform | V1 limitations |
| --- | --- | --- | --- | --- | --- | --- |
| Home | Full | Home projection/view plus canonical Daily Schedule, Overdue and occurrence actions | UI spec, Daily Schedule and Overdue vectors | `tests/ui/home-projection.test.ts`, architecture gate | Desktop | Home composes canonical projections; it does not own scheduler/overdue logic. |
| Planner Day/Week/Month | Full | Planner projection/view, Daily Schedule, Calendar projection | UI spec, Daily Schedule vectors | Planner UI tests, architecture gate | Desktop | Week/Month are projections; no local scheduler. |
| Adaptive planning | Full within V1 boundary | `SharedPlanningStateRepository`, adaptive projection | `adaptive_planning/vectors.json` | `tests/ui/planner-adaptive-projection.test.ts`, architecture gate | Desktop | Reads exact Essentials/Parked IDs and `capacity_mode`; numeric capacity remains unavailable/null. |
| Overdue | Full | `src/core/overdue_projection.ts`, Home/Journal consumers | `overdue_projection/vectors.json` | Overdue contract tests, architecture gate | Desktop | Only real deadline/due-time breaches qualify; missed planned slots are Fell Behind, not Overdue. |
| Day Dial | Full | Day Dial view over normalized Daily Schedule items | UI spec | `tests/ui/day-dial-projection.test.ts`, accessibility test | Desktop | Visual projection only; occurrence mutations still route through canonical action owners. |
| Journal | Full | Journal projection/view, Daily Note raw handling, Overdue projection | UI spec | `tests/ui/journal-projection.test.ts`, architecture gate | Desktop | Daily Note remains raw/read-only. |
| Browse/Search/Object pickers | Full read-only query | `src/core/object-query`, VaultIndex | UI spec | `tests/ui/object-query.test.ts`, architecture gate | Desktop | Query is read-only; unsupported objects open Markdown. |
| Universal Detail | Full for covered mutations; read-only otherwise | Detail view/editor plus SafeObjectMutationRepository | `coverage.json` | `tests/ui/object-detail.test.ts`, `tests/ui/object-mutation.test.ts`, architecture gate | Desktop | Edit appears only for full mutation coverage. |
| Quick Add | Full for Task, Entry, Note, Reminder, Tracker Record and Resource | `src/core/object-creation.ts`, `QuickAddModal` | Object fixtures and shared settings paths | `tests/contracts/ui_shell.test.ts` | Desktop | No Quick Add for limited/read-only types. |
| Google Calendar | Read-only | Google Calendar adapter and Daily Schedule external projection | OAuth scopes and UI spec | `tests/integrations/google-calendar.test.ts`, `tests/integrations/google-scopes.test.ts`, architecture gate | Desktop | No create/update/delete; external event links open HTTPS only. |
| System manual Run | Full | Manual execution policy/service, System finalization owner | `system_routine_execution/vectors.json` | `tests/contracts/system-routine-execution.test.ts` | Desktop | No background auto-run; Run is distinct from occurrence Done. |
| Routine manual execution | Full | Routine execution owner | `system_routine_execution/vectors.json` | System/Routine contract tests | Desktop | No distributed/background automatic execution. |
| Scheduled System occurrence completion | Full | System execution evidence plus occurrence action policy | A6 contract vectors | System/Routine contract tests, occurrence action tests | Desktop | Exact `occurrence_id + scheduled_for` evidence is required. |
| Focus/Pomodoro runtime | Full within V1 boundary | Focus runtime repository/controller and vendored Focus contract | `focus_runtime/vectors.json` | `tests/contracts/focus-runtime.test.ts`, architecture gate | Desktop while Obsidian is open | Foreign controller is read-only; no takeover/lease protocol; no closed-app timer guarantee. |
| Reminder delivery | Full best effort | Reminder service, device-local delivery registry, Obsidian notification gateway | Reminder and occurrence action contracts | Reminder tests, B2 regression coverage | Desktop while Obsidian is open | Desktop notifications depend on OS/Obsidian permission; delivery history is device-local. |

## Explicitly Unsupported in V1

| Feature | V1 status | Owner/boundary | Evidence | Limitation |
| --- | --- | --- | --- | --- |
| Obsidian Mobile | Unsupported | Desktop-only manifest and plugin runtime | `manifest.json`, README | V1 supports Obsidian Desktop only. |
| `custom_script` and external daemons | Unsupported | Manual execution policy | README, handoff exclusions | No automatic script execution. |
| Google Calendar mutation | Unsupported | Calendar integration is read-only | Calendar architecture gate and tests | No event create/update/delete. |
| Numeric DayCapacitySummary in Companion | Unsupported | Quartzo runtime derivation only | Adaptive vectors and architecture gate | Companion must not invent a capacity number. |
| Finance Google Sheet vault sync | Unsupported | Finance is outside Companion vault sync | Sync file policy gates | Finance sheets are not synced as vault Markdown. |
| Full multi-client Focus takeover | Unsupported | Focus controller boundary | Focus vectors/tests | Offline controller collision resolves through sync conflict, not takeover. |

## Remaining V1 Proof Gates

The code and documentation gates above do not replace the final manual proof items:

- E2E Quartzo app to Drive to Obsidian Companion and back.
- BRAT clean install.
- BRAT update over an existing install.
- Release Preflight on final `main`.
- Release Candidate installation from the GitHub-generated artifact.
