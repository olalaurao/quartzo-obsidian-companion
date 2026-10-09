# Quartzo Companion Agent Bootstrap

Read this file first. This repository has a root `agents.md`: do not add a root `AGENTS.md` alongside it on a case-insensitive filesystem without an explicit migration.

1. Read the applicable vendorized upstream contracts in `contracts/` and the local active spec under `docs/specs/`. The upstream Quartzo contract is authoritative for shared types and semantics.
2. Read the relevant sections of local `guidelines.md` for Companion product/UI behavior.
3. Read the relevant sections of local `agents.md` for the actual architecture, owners, implementations and local platform responsibilities.
4. Use `docs/README.md` for the documentation map and to distinguish current specs from `docs/v1/` plans and historical evidence.
5. Preserve the existing canonical owners. Do not introduce parallel source-of-truth stores, Drive coordinators, object queries, OAuth clients or mutation paths.
6. Update the canonical source whenever a permanent decision changes, without silently changing upstream semantics.
7. Run relevant contract, sync, architecture, typecheck, lint, test, build and release gates before concluding; explicitly report any that were not run.
