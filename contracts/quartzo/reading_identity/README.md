# Reading Identity V1

Contract candidate implemented in Dart on this branch; not merged or deployed.
See [active spec](../../../docs/specs/reading-integration.md) and [decisions](../../../docs/adrs/reading-integration-v1.md).

`contract.json` defines the ownership and compatibility boundary; `vectors.json` is executed by `test/reading_integration_contract_test.dart`. No runtime ingestion, status mutation or promotion is enabled by these contracts. Companion consumes only after upstream merge through its existing lock workflow.
