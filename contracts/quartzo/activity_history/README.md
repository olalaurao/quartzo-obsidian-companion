# Activity History Contract

Activity History V1 defines the shared, append-only Quartzo activity log consumed by every client, including the Obsidian Companion.

The contract is intentionally cross-client. It is not an Obsidian-local mtime scan, not a UI analytics stream, and not a second object index.

Canonical source files:

- `contract.json` defines the event model, taxonomy, persistence, privacy, projection, filtering, aggregation, and owner boundaries.
- `vectors.json` defines executable conformance scenarios for idempotency, projection, filtering, privacy, unsupported capabilities, and aggregation.

