# Companion agent instructions — migration ledger

Status: **IN PROGRESS — NOT COMPLETE**
Companion `main` baseline: `507f2ccfe2f991ea775e1f1aca5ca05e6f4c5218` (2026-10-08).
Scope is docs/discovery only; no runtime, sync or persisted-contract changes.

## Decisions and boundaries

Root `agents.md` remains architecture authority. Root `AGENTS.md` is intentionally absent because it collides with `agents.md` on case-insensitive filesystems. `.github/copilot-instructions.md` points to the canonical docs; automatic Codex discovery remains unverified.

| Rule ID | Source | Obligation | Class | Owner/evidence | Action/destination | Validation |
|---|---|---|---|---|---|---|
| C-BOOT-01 | AGENT_BOOTSTRAP.md | Read vendor contracts, guidelines, agents | procedure | contracts/UPSTREAM.lock.json | Preserve, clarify local specs in bootstrap | Pending |
| C-GUID-01 | guidelines.md 1–5 | Upstream identity, frontmatter preservation, strict TS, no parallel database | data/architecture | shared contracts and core/vault | Preserve in guidelines | Existing tests; not rerun |
| C-GUID-02 | guidelines.md 6–23 | Manual/automatic sync, pairing and Drive safeguards | sync/security | DriveSyncCoordinator and sync tests | Preserve; extract to docs/specs/drive-sync-operational.md after full inventory | Pending |
| C-GUID-03 | guidelines.md 24–33 | Daily schedule and UI policies | product | DailyScheduleEngine, occurrence owner | Preserve; topical headings after rule mapping | Pending |
| C-GUID-04 | guidelines.md duplicated 34–36 | Journal/link capture and object organization | product | capture and object-organization owners | Assign distinct stable IDs before renumbering | Pending |
| C-ARCH-01 | agents.md architecture layers | Core, vault, sync, integrations, platform, UI, local-state boundaries | architecture | agents.md | Preserve; restructure only with traceable mapping | Pending |
| C-RELEASE-01 | README.md and release runbook | Validated BRAT releases; secrets remain secure | security/release | existing release gates | Preserve | Pending |

## Remaining work

Full line-by-line migration of `guidelines.md` and `agents.md` with owner/test evidence, categorization of every duplicate or conflict, sync operational spec, topical organization, automatic documentation-integrity checks in package/CI, and eight clean-agent scenarios (before/after). Current ledger does not claim complete rule preservation or passing gates. Never delete/renumber requirements solely to simplify formatting.
