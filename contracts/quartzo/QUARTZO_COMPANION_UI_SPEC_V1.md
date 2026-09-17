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
```

Search, Add, Sync and Settings are actions, not independent top-level clones of every Flutter screen.

## Daily Surfaces

Home, Planner, Day Dial, Journal day context, widgets and the future Companion answer "what belongs on this date?" from the same Daily Schedule contract.

No UI surface may independently calculate recurrence, overdue, Habit slots, Reminder occurrences, rotation zones, archived filtering or `_deleted/` filtering.

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
