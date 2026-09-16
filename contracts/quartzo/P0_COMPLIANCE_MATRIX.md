# Quartzo Companion P0 Compliance Matrix

This matrix is the implementation index for P0. It is intentionally smaller
than the parent contract: each row points to the canonical implementation and
the executable verification that proves the behavior.

| Requirement | Canonical implementation | Executable verification | Gate |
| --- | --- | --- | --- |
| P0.1 bootstrap | [`AGENT_BOOTSTRAP.md`](../../../AGENT_BOOTSTRAP.md), [`agents.md`](../../../agents.md), [`.agents/AGENTS.md`](../../../.agents/AGENTS.md) | `test/agent_contract_bootstrap_test.dart`, `tool/agent_preflight.dart` | architecture and preflight gates |
| P0.2 scheduler documentation | parent contract plus [`scheduler/vectors.json`](../../../contracts/quartzo/scheduler/vectors.json) | exact repeat-type and expected-output assertions in `test/obsidian_companion_contracts_test.dart` | contract fixture gate |
| P0.3 shared settings | `QuartzoSharedSettings`, `SharedSettingsRepository`, `SettingsNotifier.reloadSharedSettingsFromVault` | `test/shared_settings_repository_contract_test.dart` migration, malformed, cache, external-change and no-write-loop tests | shared settings gate |
| P0.4 device notification state | `TimeArchitectureState`, `TimeArchitectureRepository`, `DeviceNotificationRegistryRepository` | `test/obsidian_companion_contracts_test.dart`, `test/time_architecture_sharding_test.dart` | time-state gate |
| P0.5 high-churn state | four versioned shared time sidecars | shard isolation, restart and repeated-migration tests in `test/time_architecture_sharding_test.dart` | time-state gate |
| P0.6 file scope | `VaultSyncFilePolicy` used by local and remote scans | classifier parity, `.base`, `_attachments`, deletion and excluded-system paths in `test/obsidian_companion_contracts_test.dart` | sync classifier gate |
| P0.7 sync protocol | `QUARTZO_SYNC_PROTOCOL_V1.md`, `SyncReconciliationPolicy`, byte-safe Drive sync | executable B/L/R, null-base, deletion, missing-hash, adoption and duplicate-identity vectors | sync protocol gate |
| P0.8 DONE vault interoperability | [`object_fixtures/fixtures.json`](../../../contracts/quartzo/object_fixtures/fixtures.json), [`coverage.json`](../../../contracts/quartzo/object_fixtures/coverage.json), `priority_vectors.json`, canonical model serializers | 31 model-level parse -> serialize -> parse fixtures, 1 documented raw/read-only `daily_note` fixture, and 7 parse/mutate/roundtrip mutation fixtures in `test/obsidian_companion_contracts_test.dart` | interop and fixture gates |
| P0.9 DONE daily and scheduler contracts | `SchedulerService`, `DailyScheduleAggregator`, `TimelineAggregatorService` | 26 deterministic self-contained scheduler vectors, 21 JSON-input-driven canonical daily vectors with identity/timing assertions, binary conflict pipeline coverage and occurrence-action vectors | contract fixture and architecture gates |

The matrix is descriptive metadata only. Models, parsers and runtime behavior
remain defined by the canonical Flutter services and the language-neutral
fixtures consumed by each client.
