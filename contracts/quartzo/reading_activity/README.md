# Reading Activity V1

Implementation candidate with production ingestion and effects gated. Importing
these contracts does not deploy or enable the integration.
See [active spec](../../../docs/specs/reading-integration.md) and [decisions](../../../docs/adrs/reading-integration-v1.md).

`vectors.json` also supplies 15 opaque-hash sync lifecycle cases and 14 exact
path cases, executed against the existing `SyncReconciliationPolicy` and
`ReadingActivityShards` by `test/reading_sync_lifecycle_vectors_test.dart`.
The canonical path includes both 64-hex device and epoch scopes before YYYY/MM;
hash-named files outside that namespace retain ordinary sync behavior. Divergent
immutable bytes and remote absence after baseline preserve conflict evidence;
duplicate identity takes precedence, and watcher echoes cannot hide divergence.
Remote-only restoration and explicitly authorized initial publication remain
distinct from deletion intent. `relative_path` in these fixtures is classification
input, not a new wire/event field or a credential. Companion must consume and
execute this same matrix through upstream merge and its normal lock workflow.
No event parser or parallel sync owner is added by the fixtures.

The separate `readingTransportContractVersion: 1.0.0` candidate is defined in
`transport.contract.json`, `transport.schema.json` and `transport_vectors.json`.
Raw native event/shard schemas remain 1.0.0. Pure `ReadingTransportRequest`
requires explicit current pairing/vault/device/epoch context and UTC clock,
canonical bounded bytes, a five-minute maximum window, immutable per-line input
and scope-bound batch SHA-256. A fresh attempt nonce binds each response while
retries retain the original batch. Malformed/unsupported lines are independently
inspectable; conflicting native payloads quarantine all matching positions before
commit. The response parser verifies every ordered input position, line/native
digest and exact context. Staging/noncommitted outcomes cannot carry a canonical
revision. Its result remains **untrusted claims**, never an authenticated or
durable receipt, accepted-event list, source cursor or canonical ACK factory.

The eventual authenticated canonical owner must verify current credential
binding/revocation, persistent replay/idempotency and actual durable native facts
before issuing any per-event canonical revision. None is supplied by the local
store, cache index or synthetic TLS diagnostic. No receiver, credential source,
outbox mutation or production caller is registered by this parser. Companion's
lock/consumer update and Lua parity follow the upstream adoption workflow; the
candidate schemas alone do not pass G03/G04/0C.

`test/reading_transport_test.dart` runs the shared twelve negative vectors plus
scope/window/digest/isolation/retry/immutability/bounds tests. Independent Python
validation now checks four schemas and event/shard/batch/native-payload goldens:
install the test-only `tool/requirements-reading-contracts.txt` outside application
runtime, then run `python tool/validate_reading_contracts.py`. Hosted CI runs this
validator with Python 3.12, alongside the complete Flutter suite.

`verifyLocalShards` checks every canonical file observed by bounded local discovery, with one bounded shard decoded at a time and no caller-selected subset. The existing SyncQueueService supplies a disposable SQLite digest workspace in private app cache; it is not another reading source/index and never changes the queue schema or canonical files. Native payload digests exclude observation time. Limits: one million input facts including overlaps, 1000 digest inputs per batch and 256 MiB of database pages. Fresh path/conflict checks and a second byte pass detect observed changes. Any conflict/missing/corrupt input, cancellation/retarget or scratch I/O/budget failure returns no counts and deletes scratch. A killed process may leave cache files, which are never reused. Immutable result counts are local observations, not an atomic/cloud snapshot, effect grant or ACK. Serialized schemas remain 1.0.0. Host behavior tests live in `test/reading_activity_verification_test.dart` and `test/transient_digest_index_test.dart`; explicit synthetic stress uses `flutter test --no-pub tool/benchmark_reading_verification.dart --dart-define=READING_VERIFICATION_EVENTS=100000 --reporter expanded` (also 500000).

`contract.json` defines the ownership and compatibility boundary; `vectors.json` is executed by `test/reading_integration_contract_test.dart` and `test/reading_activity_shards_test.dart`, with independent Python event/shard digest verification in `tool/validate_reading_contracts.py`. The bounded shard planner verifies canonical paths/bytes but performs no I/O or ACK. No runtime ingestion, status mutation or promotion is enabled by these contracts. Companion consumes only after upstream merge through its existing lock workflow.

The optional unregistered `commitWithPublicationSync` now sequences explicit native file/ancestor synchronization before captured queue insertion through the same existing owner/kernel lease. Opened bytes are length/digest checked; handled Linux/Android x64/arm64 uses no-follow descriptor traversal and fsync from file to existing root, with complete descriptor cleanup and no unsupported fallback. The transient observation flag is distinct from weak commit and cannot authorize canonical ACK. It proves neither root anchoring, actual hardware/SQLite power loss, global native consistency nor all-client cooperation. No serialized key/version changes. Android diagnostic v3 requires actual private/external synchronization and queue/file recovery after process stop; older reports remain source-specific.

Mobile immutable lifecycle guards reuse this same pure path/digest layout without parsing event schemas in transport. Established-baseline remote absence/local delete intent becomes preserved conflict evidence; generic conflict deletion cannot purge history. Explicit repair and outbound Drive writes must retain the filename's exact byte digest, including opaque future-schema transport. Bulk orphan sweeps require zero selected failures and an empty authoritative scoped conflict queue. These transient APIs change no serialized key/version and issue no ACK. File-ID relocation, external writers, live Drive/Companion and directory/power-loss proof remain open; see STATUS for source-specific tests.

Subsequent explicit `recoverLocalStaging` coordinates through ObsidianService's local kernel lease, with empty control files in private app support outside the vault. New internal staging names end in `.<v4-uuid>.qip1.tmp`; raw event/shard/wire schema versions do not change. Bounded complete inventory preflight precedes effects. Valid stages are canonically written, enqueued under the captured scope, then preserved without replacement; invalid/partial/oversized stages are preserved for review without fact/queue-success acceptance. Original relative paths and bytes remain under `_conflicts/immutable_staging_v1/<uuid>/`. Legacy/unknown artifacts still block discovery/recovery; cancellation, conflicts and retarget do not become success. Transient owner capabilities drain pending operations before release, expire and retain caught failures. This supplies neither an accepted-event/cursor grant nor global/Drive/Companion/power-loss/ACK proof. The older Android native-publication report certifies only b539db4d, not this newer lease/recovery implementation; consult STATUS for its separate validation.

`ReadingActivityLocalStore` remains unregistered. Its existing ObsidianService owner now publishes exclusively allocated/flushed UUID sibling temporaries using native no-replace operations off the UI isolate: Windows MoveFileExW without replacement/copy permission and Linux/Android renameat2 RENAME_NOREPLACE when supported. No unsafe fallback is allowed. After a failed syscall, observed source/destination state and owner path/scope revalidation plus exact bytes decide whether a retry matches; native error codes alone are advisory. Only owned staging is cleaned. Native Windows/Linux tests exercise actual independent process races, with additional Windows long-path coverage. The fresh [Android native-publication report](../../../docs/reading-integration/android-native-publication-probe-2026-10-17.json) binds clean b539db4d, 12 source hashes and its APK digest: private/external publication, independent owner conflicts/retry/cleanup and actual process stop/relaunch PASS, with test package removed and production metadata unchanged. The initial locked/Dozing attempt remains FAILED. No result certifies cloud/global durability, directory power-loss persistence, Companion behavior or ACK. Crash-orphan temporaries still block discovery pending safe owner recovery. Serialized contracts are unchanged.

`discoverLocalShards` enumerates local candidate paths through the existing ObsidianService, with a default 4096-entry limit including directories (hard maximum 10000), depth five, strict directory/file grammar and no link traversal. Unexpected/temp/conflict artifacts and overflow fail without a partial inventory. SyncQueueService checks authoritative unresolved conflicts before/after the scan without deleting rows; artifact files outside this subtree still block through their scoped rows. This does not validate contents, freeze a mutable filesystem, establish complete cloud/cross-batch consistency or authorize effects. `test/reading_activity_inventory_test.dart` exercises the host boundaries. No serialized schema change is introduced.

`readVerifiedBatch` uses that same adapter and ObsidianService for read-only validation of an explicitly supplied selection: at most 32 input paths, at most 1000 input facts including overlapping retries, and the configured shard byte cap (at most 512 KiB). Every path is preflighted before I/O; each file is bounded-read and schema/digest/partition/canonical-byte validated. Union uses native event IDs and rejects payload conflicts across the selected files. Any failure returns no partial batch and leaves artifacts/queue untouched. This is not whole-ledger discovery, a global conflict index, a durable receipt or an ACK. Production callers must establish completeness and cross-batch consistency before effects. `test/reading_activity_local_read_test.dart` exercises these host-only boundaries. No serialized schema/key/version changes are introduced by the transient read API.

The isolated [Android probe](../../../tool/reading_activity_android_probe.dart) and [executor](../../../tool/run_reading_android_probe.ps1) also exercise local file/queue/restart behavior on a real Android device with synthetic facts only. See [physical evidence](../../../docs/reading-integration/android-local-probe-2026-10-16.json) and [scope/reproduction](../../../docs/reading-integration/STATUS.md). The raw report field `native_seconds` means 120 seconds of synthetic input duration, not measured user reading time. Physical Android process recovery does not prove Kindle transport, Drive/cross-client durability, phone power loss or canonical ACK.

The subsequent [discovery physical report](../../../docs/reading-integration/android-discovery-probe-2026-10-16.json) records clean source e8c79a06, a new APK digest and all source fingerprints. In addition to local recovery, the native Android run verifies candidate enumeration, scan overflow, unresolved-conflict blocking and unexpected-artifact rejection with preserved evidence/queue. Its explicit false cloud/Kindle/power-loss/ACK flags remain unchanged.

The [observed-local verifier physical report](../../../docs/reading-integration/android-verification-probe-2026-10-16.json) and [100k/500k host stress](../../../docs/reading-integration/host-verification-stress-2026-10-16.json) both name clean 754a2d57 and exact tested fingerprints. The first Android verifier attempt failed because its driver rejected a returning mmap pragma through `execute`; the corrected `rawQuery` path then passed. The new physical run covers whole-observed native-ID checks/conflict and scratch cleanup, not just discovery. Host memory/timing includes the complete Flutter test process; real-device scale budgets, atomic/global/cloud consistency and canonical ACK remain unproven. No raw serialized contract version changed.

The [leased staging recovery physical report](../../../docs/reading-integration/android-staging-recovery-probe-2026-10-18.json) names clean 544c55c0, all 12 runtime/runner source hashes and the APK digest. Real Android process termination releases a held native lease; the next process passes recovery/replay in private and external storage and preserves invalid staging for review. The bounded private-file collector verifies the short marker's phase, revision, byte length and SHA-256, avoiding the first incomplete attempt's log truncation. The isolated package was removed and production metadata remained unchanged. This proves local process recovery only; directory/power-loss/global/Drive/Companion durability and canonical ACK remain open.
