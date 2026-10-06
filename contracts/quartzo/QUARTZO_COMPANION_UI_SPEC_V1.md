# Quartzo Companion UI Spec V1

Status: canonical UI contract. Version: 1.0.0.

The Companion is an official Quartzo surface hosted in Obsidian Desktop. It is not a remote control for a running Flutter app.

## Shell

V1 uses one primary `Quartzo` workspace view with internal navigation:

```text
Home
Planner
Journal
Browse
Activity
```

Search, Add, Sync and Settings are actions, not independent top-level clones of every Flutter screen.

## Activity

Activity is a primary V1 surface backed by the Activity History contract, not a decorative local log. It shows cross-client Quartzo history from the canonical append-only log in `contracts/quartzo/activity_history/contract.json`.

Activity must render Day, Week, Month and Year periods with functional date navigation. Filters, folder selection, timeline groups, charts, heatmaps, by-type breakdowns and totals all come from one filtered Activity projection. A UI surface may not recalculate or hardcode separate counts.

Activity events are emitted by the canonical owners of completed operations: Object Creation, Safe Object Mutation, Object Organization, Capture, Occurrence Actions, Occurrence Reschedule, Tracking Record, Manual System/Routine Execution and Focus Runtime. Home, Planner, Journal, Browse, Search, Activity and Quick Add must not emit their own duplicate activity events.

Activity never invents data to match a mockup. Provider labels appear only from real provenance. Canvas/snippet filters remain hidden unless a future contract adds real Canvas activity support. Excerpts are optional and privacy-gated; full note bodies and full diffs are never stored in Activity events.

## Daily Surfaces

Home, Planner, Day Dial, Journal day context, widgets and the future Companion answer "what belongs on this date?" from the same Daily Schedule contract.

No UI surface may independently calculate recurrence, overdue, Habit slots, Reminder occurrences, rotation zones, archived filtering or `_deleted/` filtering.

Day Dial presentation is derived only from those normalized items. Canonical timed occurrences of 24 minutes or less render as icon markers; occurrences of 25 minutes or more render as arcs. Overlaps are separated geometrically without changing occurrence identity. All-day/anytime facts stay outside the timed ring. A canonical timed item may not be silently dropped by the renderer: malformed temporal metadata must be surfaced by tests/diagnostics. Icon resolution follows explicit object metadata / shared TypeSignature first, then a canonical type fallback; color resolution remains explicit object/event color → shared TypeSignature color → theme fallback.

## Actions

Rendered daily items preserve:

```text
occurrenceId, sourceId, sourceType, date, start, end, slotIndex, reminderId,
isCompletable, isCompleted, origin and sourceLabel
```

Actions route through the canonical occurrence action policy/coordinator. Surface-specific Done, Skip, Snooze or Reschedule paths are forbidden.

## Mutation Policy

Expose creation/editing only for object types with full parser, serializer, mutation, scheduler/reminder and fixture coverage. Otherwise show read-only details and an `Open Markdown` affordance.

## Notifications

V1 desktop reminder delivery is available only while Obsidian is running. OS delivery identifiers and notification permission state are device-local and never shared through the vault.
