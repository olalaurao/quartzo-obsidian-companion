# Companion documentation map

Status: CURRENT INDEX — reconciliation in progress  
Baseline Companion `main`: `507f2ccfe2f991ea775e1f1aca5ca05e6f4c5218` (2026-10-08).

## Reading order and authority

1. Current user request.
2. Vendorized contracts in [contracts/](../contracts/) for cross-client data and behavior, plus an applicable current local spec.
3. [guidelines.md](../guidelines.md) for Companion product and UI/UX.
4. [agents.md](../agents.md) for local architecture/owners.
5. Existing implementation and tests.

The source of shared contracts is the Quartzo upstream; [contracts/UPSTREAM.lock.json](../contracts/UPSTREAM.lock.json) pins the imported upstream revision and hashes. Do not change vendorized contracts independently of upstream. See [AGENT_BOOTSTRAP.md](../AGENT_BOOTSTRAP.md) before editing.

## Document directory

- [docs/specs/object-organization.md](specs/object-organization.md): local object-organization specification; inspect status and its upstream dependencies before editing.
- `docs/specs/`: current operational/feature specs as their headers permit. Proposed Drive sync operational extraction is not yet available.
- `docs/v1/`: V1 capability matrices and execution evidence; do not assume every past plan is an active contract.
- [docs/BETA_RELEASE_RUNBOOK.md](BETA_RELEASE_RUNBOOK.md): release procedure.
- [README.md](../README.md): onboarding, local-first usage and installation.
- [docs/audits/agent-docs-reconciliation.md](audits/agent-docs-reconciliation.md): evidence and unresolved migration work, not a second authority.

## Lifecycle

Shared contract change → change upstream, regenerate/vendor and verify lock.  
Companion behavior change → update applicable local spec and/or guidelines.  
Local owner/architecture change → update agents.md.  
Permanent machine-verifiable invariant → extend corresponding architecture test/gate.

Do not classify a spec as active solely because the file exists; evidence and status must be reconciled.
