# Quartzo Sync Failures Found During D1

Date: 2026-09-22
Context: D1 E2E app <-> Drive <-> Obsidian
Companion repo: `C:\Users\lauri\Documents\companion`
Quartzo app repo: `C:\Users\lauri\Documents\aplicativo_v11_1_antigravity`
PC vault / Drive Desktop folder: `C:\Users\lauri\My Drive (obslauri@gmail.com)\os`
Android vault: `/storage/emulated/0/Documents/garden`

## Closeout Status

Companion-side D1 behavior is proven enough to stop spending quota on this pass:
- Android-created Task reached Drive Desktop and the PC vault.
- Companion projected `Prepare campaign` on 2026-09-23 at `10:00` in Home/Planner.
- Companion/Obsidian completion mutation wrote the PC vault task as `stage: finalized`.
- `sessions/shared_occurrence_state_v1.md` contains the completed occurrence response.

The V1 E2E cannot honestly be marked fully closed because the Quartzo Android app did not pull the Obsidian/Drive edit back. The remaining blocker is upstream app sync, not Companion projection.

## D1 Object

- Title: `Prepare campaign`
- ID: `945edb91-f00b-469e-beca-586e6dd968d3`
- Relative path: `tasks/prepare-campaign.md`
- Original Android hash: `c1e9dedf7a2d532ff9c9f171f187bc9358824ba493452b7614e39d7c1a90c022`
- PC vault hash after Obsidian completion: `887c843c0383e67ca36c896f75c018ea2d14b0612d1fff23987108be9efdbc17`
- PC vault final state: `stage: finalized`, `reflection: Completed from occurrence action.`
- Android final observed state: still `stage: "todo"`

## Current Device State Left Behind

- App package: `com.productivity.citrine`
- App was force-stopped at the end of this pass to avoid more background mutation.
- `autoSync` was set back to `true` in `FlutterSharedPreferences.xml`.
- `sync_conflicts` was manually reduced to `0` after user-authorized mass resolution of old `social/...` conflicts.
- No conflict row exists for `tasks/prepare-campaign.md`.
- Android `file_sync_state` for the D1 task still has the old Android-created hash for local/remote/base.

Evidence folder:
- `C:\Users\lauri\Documents\companion\d1_mass_resolve_20260922_1139`
- Important files there:
  - `sync_queue.before.db`
  - `sync_queue.after.db`
  - `resolution_manifest.csv`
  - `pc_backup_before_overwrite`
  - `android_conflicts`
  - `android_stage`

## Failure 1: Stale Drive `Quartzo_hash` Hides External Edits

Drive Desktop / Obsidian changed the file content and Drive modified time, but did not update the app-owned public `Quartzo_hash` custom property. The app trusted the stale `Quartzo_hash`, so it treated remote content as unchanged and did not download the actual bytes.

Local fix already implemented in the Quartzo app worktree, not committed:
- `lib/services/sync_manager.dart`
- `test/drive_sync_safety_contract_test.dart`

Verification already run:
- `flutter test test/drive_sync_safety_contract_test.dart` passed, 20 tests.
- `flutter analyze` passed.
- `flutter build apk --debug` passed.
- Debug APK was installed on device `RQCW303AG1Z`.

Recommended app fix:
- Commit/PR the local `sync_manager.dart` change.
- Keep the regression named `Drive Desktop edits force remote hash verification before reconciliation`.
- In sync, if `remoteFile.modifiedTime` is newer than stored `remoteModifiedAt`, download and hash remote bytes even when `Quartzo_hash` is present.

## Failure 2: Conflict Queue Can Block Practical E2E

Before mass resolution, the app kept generating hundreds of pre-existing conflicts under `social/...`. The D1 task itself did not conflict, but the full sync spent the whole run processing unrelated old conflicts.

Observed counts:
- Before manual intervention: hundreds of `social/...` conflicts, later frozen at `515`.
- After user-authorized mass resolution: `sync_conflicts = 0`.
- `tasks/prepare-campaign.md` conflicts: `0`.

The UI action `Keep newest version` was attempted. It raced with Auto-Sync/full sync creating new conflicts and showed impossible progress such as `1988/508`.

Recommended app fix:
- Conflict resolution should acquire a sync lock or pause full sync while resolving a snapshot.
- Progress should be bounded by the snapshot count.
- Auto-Sync should not create new rows while `resolveAll` is running.
- Add a deterministic "resolve all newest and continue sync" command usable from tests/debug.

## Failure 3: Full Sync Stalls After Bulk Resolution

After conflicts were cleared and Auto-Sync was re-enabled, the app reached:
- `[SyncManager] Startup guard expired - sync now active`
- `[SyncManager] Preparing Drive folder.`
- `[SyncManager] Fetching remote files for queue processing.`
- `[SyncManager] Running full Drive sync.`

But the Android task stayed `stage: "todo"`. UI progress remained around `35, 34%`, and no log appeared for `prepare-campaign`, `Downloaded tasks/prepare-campaign.md`, or `Verified remote content hash`.

Recommended app fix:
- Add per-file or every-N-files full-sync progress logging with the current relative path.
- Add a timeout / watchdog for a single file or folder phase.
- Add a debug API or UI action to sync one relative path, e.g. `tasks/prepare-campaign.md`.

## Failure 4: Legacy Resource Parse Errors Flood Startup/Sync

During restart and sync, logs repeatedly showed many resource parse errors such as:
- `Invalid persisted integer year for Resource: None`
- `Invalid persisted integer year for Resource: 2026-05-20`
- `Invalid persisted enum priority for Resource: [normal]`
- `Invalid persisted enum status for Resource: to-watch`

These files are under `/storage/emulated/0/Documents/garden/03 resources/...`.

Recommended app fix:
- Make Resource parsing tolerant for legacy vault values.
- Treat invalid optional fields as null/default and preserve original markdown where possible.
- Do not let repeated parse errors starve sync progress or flood logs.

## Failure 5: Android MediaProvider Choked After Bulk File Writes

After pushing 515 resolved files into the Android vault, Android logged:

`SQLiteException: Expression tree is too large (maximum depth 1000)`

This came from MediaProvider while querying many changed files.

Recommended app/platform fix:
- Avoid very large file-change batches into MediaStore.
- Debounce or chunk file watcher/media invalidation.
- If the app reacts to a huge file change burst, collapse it into one vault rescan instead of per-file processing.

## Failure 6: Sync Conflict Route Is Hard To Reach Reliably

`quartzo://sync-conflicts` opened the conflict screen once while the app was already alive, but did not reliably route there after a cold restart. The Home status button only opens conflicts when `SyncStatus.conflict` or `SyncStatus.error`; when it is `offline` or `syncing`, it starts manual sync or does nothing useful for debugging.

Recommended app fix:
- Add a reliable debug/deep-link route for `/sync-conflicts`.
- Add a visible More/Settings entry for Sync conflicts when rows exist.

## Suggested Next Work Order

1. Commit/PR the stale `Quartzo_hash` fix and regression test.
2. Fix conflict resolution concurrency: snapshot, lock sync, bounded progress.
3. Add full-sync observability: current file, counts, timeout, targeted path sync.
4. Make Resource parsing tolerant for existing vault data.
5. Re-run D1 with a clean sync queue and without manual DB intervention.

## D1 Rerun Criteria

D1 should only be marked passed when all are true:
- Android-created Task reaches PC vault and Companion.
- Companion Home/Planner shows it on 2026-09-23 at `10:00`.
- Done/completion from Companion writes PC vault state.
- Android app pulls the PC/Drive edit by sync, without manual copying of `tasks/prepare-campaign.md`.
- Android task becomes completed/finalized or otherwise reflects the completed occurrence.
- No duplicate `Prepare campaign`.
- No conflict for `tasks/prepare-campaign.md`.
